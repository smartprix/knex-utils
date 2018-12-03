const {cfg, file, Str} = require('sm-utils');
const {getKnex, getKnexFile, getLogger} = require('./index');

const tablesToIgnore = ['knex_migrations', 'knex_migrations_lock'];

/**
 * @param {string} str
 */
function cleanComments(str) {
	return str
		.replace(/([`'"])/g, '\\`')
		.replace(/\$/g, '\\$')
		.split(/[\t\n]+/g)
		.filter(Boolean)
		.map(s => s.trim())
		.join(' ` +\n\t\t\t\t\t`');
}

/**
 * @typedef {object} table
 * @property {string} table_schema
 * @property {string} table_name
 * @property {string} table_type
 * @property {string | null} comment
 */

/**
 * @returns {Promise<table[]>}
 */
async function getTables() {
	return (await getKnex()
		.from('information_schema.tables')
		.where('table_schema', 'public')
		.select('*', getKnex().raw('obj_description((\'"\' || table_name || \'"\')::REGCLASS, \'pg_class\') as comment'))
	).filter((table) => {
		if (tablesToIgnore.includes(table.table_name)) return false;
		return true;
	});
}

/**
 * @param {string} tableName
 */
async function isPartitioned(tableName) {
	// https://dba.stackexchange.com/a/40614
	const partitions = (await getKnex().raw(`\
	SELECT
		nmsp_parent.nspname AS parent_schema,
		parent.relname      AS parent,
		nmsp_child.nspname  AS child_schema,
		child.relname       AS child
	FROM pg_inherits
		JOIN pg_class parent            ON pg_inherits.inhparent = parent.oid
		JOIN pg_class child             ON pg_inherits.inhrelid   = child.oid
		JOIN pg_namespace nmsp_parent   ON nmsp_parent.oid  = parent.relnamespace
		JOIN pg_namespace nmsp_child    ON nmsp_child.oid   = child.relnamespace
	WHERE parent.relname='${tableName}';`)).rows;

	if (partitions && partitions.length) return true;
	return false;
}

/**
 * @typedef {object} constraintInfo
 * @property {string} constraint_name
 * @property {string} constraint_def
 * @property {string} constraint_type
 */

/**
  * @see https://dba.stackexchange.com/a/214877
  * @see https://stackoverflow.com/a/49646508/9485498
  * @param {string} tableName
  * @returns {Promise<constraintInfo[]>}
  */
async function getConstraints(tableName) {
	return (await getKnex().raw(`\
	SELECT conname as constraint_name, pg_get_constraintdef(c.oid) as constraint_def , contype as constraint_type
		FROM pg_constraint c 
		WHERE conrelid=(
			SELECT attrelid FROM pg_attribute
			WHERE attrelid = (
				SELECT oid FROM pg_class WHERE relname = '${tableName}'
			) AND attname='tableoid'
		)
		AND contype != 'p' 
		AND contype != 'u'`)
	// Primary and unique key is already handled
	).rows;
}

/**
 * @typedef {object} indexInfo
 * @property {string} index_name
 * @property {string} table_name
 * @property {string[]} indexed_columns
 * @property {boolean} is_unique
 * @property {boolean} is_primary
 */

/**
 * @see https://stackoverflow.com/a/6777904/9485498
 * @param {string} tableName
 * @returns {Promise<indexInfo[]>}
 */
async function getIndexes(tableName) {
	return (await getKnex().raw(`\
		SELECT
		U.usename                AS user_name,
		ns.nspname               AS schema_name,
		idx.indrelid :: REGCLASS AS table_name,
		i.relname                AS index_name,
		idx.indisunique          AS is_unique,
		idx.indisprimary         AS is_primary,
		am.amname                AS index_type,
		idx.indkey,
		ARRAY(
			SELECT pg_get_indexdef(idx.indexrelid, k + 1, TRUE)
			FROM
			generate_subscripts(idx.indkey, 1) AS k
			ORDER BY k
		) AS indexed_columns,
		(idx.indexprs IS NOT NULL) OR (idx.indkey::int[] @> array[0]) AS is_functional,
		idx.indpred IS NOT NULL AS is_partial
		FROM pg_index AS idx
		
		JOIN pg_class AS i ON i.oid = idx.indexrelid
		JOIN pg_am AS am ON i.relam = am.oid
		JOIN pg_namespace AS NS ON i.relnamespace = NS.OID
		JOIN pg_user AS U ON i.relowner = U.usesysid
		
		AND idx.indrelid :: REGCLASS = '"${tableName}"' :: REGCLASS;`)
	).rows;
}

/**
 * Row from information_schema.columns and col_description result
 * listing only important stuff
 * @typedef {object} detailedColumnInfo
 * @property {string} table_name
 * @property {string} column_name
 * @property {number} ordinal_position
 * @property {string} column_default
 * @property {string} data_type
 * @property {string | null} comment
 * @property {number | null} character_maximum_length
 * @property {number | null} numeric_precision
 */

/**
 * @typedef {import('knex').ColumnInfo & {detailedInfo: detailedColumnInfo}} columnInfoSimple
 */

/**
 * @typedef {columnInfoSimple & {index?: indexInfo}} columnInfo
 */

/**
 * @see https://github.com/tgriesser/knex/issues/1135#issuecomment-293405104
 * @param {string} tableName
 * @returns {Promise<{[key: string]: columnInfoSimple}>}
 */
async function getColumns(tableName) {
	const columnsInfo = await getKnex().table(tableName).columnInfo();
	const detailedInfo = await getKnex()
		.from('information_schema.columns')
		.where('table_name', tableName)
		.select('*', getKnex().raw(`col_description('"${tableName}"' :: REGCLASS, ordinal_position) as comment`));
	detailedInfo.forEach((columnDetailed) => {
		columnsInfo[columnDetailed.column_name].detailedInfo = columnDetailed;
	});
	return columnsInfo;
}

/**
 * @param {columnInfo} columnInfo
 */
function getType(columnInfo) {
	/** @type {{[key: string]: string}} */
	const map = {
		integer: 'integer',
		'character varying': 'string',
		jsonb: 'jsonb',
		'timestamp with time zone': 'timestamp',
		text: 'text',
		boolean: 'boolean',
		real: 'float',
		numeric: 'decimal',
		'USER-DEFINED': 'specificType',
	};
	let type = map[columnInfo.type];
	if (!type) {
		getLogger().error(`[knex-utils] Invalid type for column: ${columnInfo.type}`);
		throw new Error('invalid type');
	}

	/** @type {string[]} */
	let extraParams;

	switch (type) {
		case 'specificType':
			extraParams = [`'${columnInfo.defaultValue.match(/::([\s\w]+)$/)[1]}'`];
			break;
		case 'integer':
			if (columnInfo.defaultValue && columnInfo.defaultValue.startsWith('nextval')) {
				type = 'increments';
			}
			break;
		case 'string':
			if (columnInfo.detailedInfo.character_maximum_length) {
				extraParams = [columnInfo.detailedInfo.character_maximum_length];
			}
			break;
		case 'decimal':
			if (columnInfo.detailedInfo.numeric_precision) {
				extraParams = [columnInfo.detailedInfo.numeric_precision];
			}
			break;
		default:
			break;
	}

	return {type, extraParams};
}

/**
 *
 * @param {columnInfo} columnInfo
 */
function nullable(columnInfo) {
	if (columnInfo.index && columnInfo.index.is_primary) return '';
	if (columnInfo.nullable === true) return '.nullable()';
	return '.notNullable()';
}

/**
 * @param {columnInfo} columnInfo
 */
function defaults(columnInfo) {
	if (columnInfo.defaultValue === null) return '';
	const {type} = getType(columnInfo);
	if (type === 'increments') return '';

	let defaultVal = columnInfo.defaultValue.match(/^('.*')(::[\w\s]+)?$/);
	if (defaultVal) {
		defaultVal = defaultVal[1].replace(/\\'/, "'");
	}
	else if (type === 'numeric' || type === 'integer') {
		defaultVal = Number(columnInfo.defaultValue.replace("'", ''));
		if (Number.isNaN(defaultVal)) {
			getLogger().warn(`[knex-utils] default value is invalid, ${columnInfo.defaultValue}, for type ${type}.`,
				`Table ${columnInfo.detailedInfo.table_name}, Column ${columnInfo.detailedInfo.column_name}`);
			return '';
		}
	}
	else if (type === 'boolean') {
		defaultVal = Str.tryParseJson(columnInfo.defaultValue.replace("'", ''));
		if (defaultVal === null) {
			getLogger().warn(`[knex-utils] default value is invalid, ${columnInfo.defaultValue}, for type ${type}.`,
				`Table ${columnInfo.detailedInfo.table_name}, Column ${columnInfo.detailedInfo.column_name}`);
			return '';
		}
	}
	else {
		return '';
	}
	return `.defaultTo(${defaultVal})`;
}

/**
 * @param {columnInfo} columnInfo
 */
function indexed(columnInfo) {
	if (!columnInfo.index || !columnInfo.index.single) return '';
	if (columnInfo.index.is_primary) return '';
	if (columnInfo.index.is_unique) return '.unique()';
	return '.index()';
}

/**
 * @param {columnInfo} columnInfo
 */
function primary(columnInfo) {
	if (!columnInfo.index || !columnInfo.index.single) return '';
	if (columnInfo.index.is_primary) return '.primary()';
	return '';
}

/**
 * @param {columnInfo} columnInfo
 */
function comment(columnInfo) {
	if (!columnInfo.detailedInfo.comment) return '';
	return `\n\t\t\t\t.comment(\`${cleanComments(columnInfo.detailedInfo.comment)}\`)`;
}

/**
 *
 * @param {table & {indexes: indexInfo[], constraints: constraintInfo[]}} table
 * @param {{[key: string]: columnInfo}} columnsInfo
 * @param {indexInfo[]} indexInfo
 */
async function singleTableGenerator(table, columnsInfo) {
	let extra = '';
	const extrasDone = {
		citext: false,
	};

	const columns = Object.keys(columnsInfo).map((columnName) => {
		const columnInfo = columnsInfo[columnName];
		const {type, extraParams} = getType(columnInfo);

		if (type === 'specificType') {
			if (extraParams[0] === "'citext'") {
				// So that query is not added multiple times
				if (!extrasDone.citext) extra += "\n\t\t.raw('CREATE EXTENSION IF NOT EXISTS CITEXT')";
				extrasDone.citext = true;
			}
			else {
				getLogger().warn(`[knex-utils] the specified type "${extraParams}" may not exist for column: "${columnName}" in table "${table.table_name}"`);
			}
		}
		let extraParamsString;
		if (extraParams && extraParams.length) extraParamsString = `, ${extraParams.join(', ')}`;
		else extraParamsString = '';

		return `\
			table.${type}('${columnName}'${extraParamsString})${primary(columnInfo)}` +
			`${nullable(columnInfo)}${defaults(columnInfo)}` +
			`${indexed(columnInfo)}${comment(columnInfo)};`;
	}).join('\n');

	const indexes = table.indexes.filter(i => !i.single).map((index) => {
		if (index.multiple) {
			const columnsArrStr = index.indexed_columns.map(c => `'${c.replace(/"/g, '')}'`).join(', ');
			if (index.is_primary) {
				return `\
			table.primary([${columnsArrStr}]);`;
			}
			if (index.is_unique && index.multiple) {
				return `\
			table.unique([${columnsArrStr}]);`;
			}
			return `\
			table.index([${columnsArrStr}]);`;
		}

		getLogger().warn('[knex-utils] Unknown index type', index);
		return '';
	}).filter(Boolean).join('\n');

	const constraints = table.constraints.map((constraint) => {
		// CHECK type
		if (constraint.constraint_type === 'c') {
			// https://github.com/tgriesser/knex/issues/1699#issuecomment-402603481
			return `\
		.raw(\`ALTER TABLE "${table.table_name}" ADD CONSTRAINT "${constraint.constraint_name}" ${constraint.constraint_def}\`)`;
		}

		getLogger().warn('[knex-utils] Unknown constraint type', constraint);
		return '';
	}).filter(Boolean).join('\n');

	const tableComment = table.comment ? `\
			table.comment(\`${cleanComments(table.comment)}\`);` : '';

	return `\
exports.up = async function (knex) {
	return knex.schema${extra}
		.createTable('${table.table_name}', (table) => {
${columns}\
${indexes ? '\n' : ''}${indexes}\
${tableComment ? '\n' : ''}${tableComment}
		})\
${constraints ? '\n' : ''}${constraints};
};

exports.down = async function (knex) {
	return knex.schema
		.dropTableIfExists('${table.table_name}');
};`;
}

/**
 * Main entry function
 */
async function generate() {
	let tables = await getTables();
	// We haven't handled partitioned table so will be skipping these
	tables = (await Promise.all(tables.map(async (table) => {
		if (await isPartitioned(table.table_name)) return null;
		return table;
	}))).filter(Boolean);

	await file(`${process.cwd()}/migrations/tables`).mkdirp();
	await Promise.all(tables.map(async (table) => {
		const columnsInfo = await getColumns(table.table_name);
		table.indexes = (await getIndexes(table.table_name)).map((i) => {
			if (i.indexed_columns.length === 1) {
				const col = columnsInfo[i.indexed_columns[0].replace(/"/g, '')];
				if (!col) {
					i.error = true;
					getLogger().warn(Object.keys(columnsInfo), i.indexed_columns[0].replace(/"/g, ''));
					return i;
				}
				i.single = true;
				col.index = i;
			}
			else i.multiple = true;
			return i;
		});
		table.constraints = await getConstraints(table.table_name);

		const tableMigration = await singleTableGenerator(table, columnsInfo);
		return file(`${process.cwd()}/migrations/tables/create${table.table_name}.js`).write(tableMigration);
	}));

	const indexFile = `\
${tables.map(table => `const ${table.table_name} = require('./tables/create${table.table_name}');`).join('\n')}

exports.up = async function (knex) {
	await Promise.all([
		${tables.map(table => `${table.table_name}.up(knex),`).join('\n\t\t')}
	])
};

exports.down = async function (knex) {
	await Promise.all([
		${tables.map(table => `${table.table_name}.down(knex),`).join('\n\t\t')}
	])
};`;
	await file(`${process.cwd()}/migrations/0_public.js`).write(indexFile);
}

if (require.main === module) {
	const dbName = getKnexFile()[cfg.getEnv()].connection.database;
	getLogger().time(`Consolidated ${dbName} DB`);
	generate().catch((err) => {
		console.error(err);
		getLogger().timeEnd(`Consolidated ${dbName} DB`);
		process.exit(1);
	}).then(() => {
		getLogger().timeEnd(`Consolidated ${dbName} DB`);
		process.exit(0);
	});
}
