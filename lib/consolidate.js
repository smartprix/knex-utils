const Knex = require('knex');
const {file, Str} = require('sm-utils');
const d = require('sm-utils/d');
const {getKnex, getLogger} = require('./index');

const tablesToIgnore = ['knex_migrations', 'knex_migrations_lock'];

/**
 * @typedef {{table_schema: string, table_name: string, table_type: string}} table
 */

/**
 * @returns {Promise<table[]>}
 */
async function getTables() {
	return (await getKnex().from('information_schema.tables').where('table_schema', 'public')
		).filter((table) => {
			if (tablesToIgnore.includes(table.table_name)) return false;
			return true;
		});
}

/**
 * Row from information_schema.columns
 * listing only important stuff
 * @typedef {object} detailedColumnInfo
 * @property {string} table_name
 * @property {string} column_name
 * @property {number} ordinal_position
 * @property {string} column_default
 * @property {string} data_type
 * @property {number | null} character_maximum_length
 * @property {number | null} numeric_precision
 */

/**
 * @typedef {Knex.ColumnInfo & {detailedInfo: detailedColumnInfo}} columnInfo 
 */

/**
 * @param {string} tableName 
 * @returns {Promise<{[key: string]: columnInfo}>}
 */
async function getColumns(tableName) {
	const columnInfo = await getKnex().table(tableName).columnInfo();
	const detailedInfo = await getKnex().from('information_schema.columns').where('table_name', tableName);
	detailedInfo.forEach((columnDetailed) => {
		columnInfo[columnDetailed.column_name].detailedInfo = columnDetailed;
	});
	return columnInfo;
}

/**
 * @param {columnInfo} columnInfo 
 */
function getType(columnInfo) {
	/** @type {{[key: string]: string}} */
	const map = {
		'integer': 'integer',
		'character varying': 'string',
		'jsonb': 'jsonb',
		'timestamp with time zone': 'timestamp',
		'text': 'text',
		'boolean': 'boolean',
		'real': 'float',
		'numeric': 'decimal',
		'USER-DEFINED': 'specificType',
	};
	let type = map[columnInfo.type];
	if (!type) throw new Error('invalid type');

	/** @type {string[]} */
	let extraParams;

	switch(type) {
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
		case 'numeric': {
			if (columnInfo.detailedInfo.numeric_precision) {
				extraParams = [columnInfo.detailedInfo.numeric_precision];
			}
			break;
		}
	}

	return {type, extraParams};
}

/**
 * 
 * @param {columnInfo} columnInfo 
 */
function nullable(columnInfo) {
	// TODO: add cases for primary and unique where notNullable is implied
	if (columnInfo.nullable === true) return '.nullable()';
	if (columnInfo.nullable === false) return '.notNullable()';
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
 * 
 * @param {table} table 
 * @param {{[key: string]: columnInfo}} columnsInfo
 */
async function singleTableGenerator(table, columnsInfo) {
	let extra = '';
	let extrasDone = {
		citext: false,
	}
	const columns = Object.keys(columnsInfo).map((columnName) => {
		const columnInfo = columnsInfo[columnName];

		let {type, extraParams} = getType(columnInfo);
		if (type === 'specificType') {
			if (extraParams[0] === "'citext'") {
				if (!extrasDone.citext)
			extra += "\n\t\t.raw('CREATE EXTENSION IF NOT EXISTS CITEXT')"
			extrasDone.citext = true;
		}
			else {
				getLogger().warn(`[knex-utils] the specified type "${extraParams}" may not exist for column: "${columnName}" in table "${table.table_name}"`);
			}
		}

		if (extraParams && extraParams.length) extraParams = `, ${extraParams.join(', ')}`;
		else extraParams = '';
		return `\
			table.${type}('${columnName}'${extraParams})${nullable(columnInfo)}${defaults(columnInfo)};`;
	}).join('\n');

	return `\
exports.up = async function (knex) {
	return knex.schema${extra}
		.createTable('${table.table_name}', (table) => {\n${columns}
		});
};

exports.down = async function (knex) {
	return knex.schema
		.dropTableIfExists('${table.table_name}');
};`
}

async function generate() {
	const tables = await getTables();
	await file(`${process.cwd()}/migrations/tables`).mkdirp();
	await Promise.all(tables.map(async (table) => {
		const columnInfo = await getColumns(table.table_name);
		const tableMigration = await singleTableGenerator(table, columnInfo);
		file(`${process.cwd()}/migrations/tables/${table.table_name}.js`).write(tableMigration);
	}))

}

if (require.main === module) {
	generate().catch(err => {
		console.error(err);
		process.exit(1);
	}).then(() => {
		process.exit(0);
	});
}