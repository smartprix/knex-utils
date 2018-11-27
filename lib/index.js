const path = require('path');
const fs = require('fs');
const Knex = require('knex');

let logger = console;
let globalKnex;
let knexfile;

function getKnexFile() {
	if (knexfile) return knexfile;
	try {
		knexfile = require(path.join(process.cwd(), 'knexfile'));
	}
	catch (err) {
		logger.error('[knex-utils] No knexfile found or error in knexfile');
		throw err;
	}
	return knexfile;
}

/**
 * set knex object
 */
function setKnex(knex) {
	globalKnex = knex;
}

/**
 * get knex object
 * @returns {Knex}
 */
function getKnex() {
	if (!globalKnex) {
		const knexfile = getKnexFile();
		const env = process.env.NODE_ENV || 'development';
		const dbConfig = knexfile[env];
		globalKnex = Knex(dbConfig);
	}

	return globalKnex;
}

/**
 * @param {Partial<logger>} loggerInstance
 */
function setLogger(loggerInstance) {
	logger = loggerInstance;
}

function getLogger() {
	return logger;
}

function _reducePoolToOne(dbConfig) {
	return {
		...dbConfig,
		pool: {
			min: 1,
			max: 1,
		},
	};
}

function _setDb(dbConfig, dbName) {
	const connection = dbConfig.connection;
	const originalDb = connection.database;
	if (originalDb === dbName) {
		return dbConfig;
	}

	const dbConfigCopy = {...dbConfig};
	dbConfigCopy.connection = {...connection};
	dbConfigCopy.connection.database = dbName;
	return dbConfigCopy;
}

/**
 * reset postgres sequences after importing data
 * postgresql does not set sequence values automatically
 * so we have to set sequence values to max of the id manually
 */
async function resetPgSequences() {
	const knex = getKnex();

	if (knex.client.config.client !== 'pg') {
		return;
	}

	// Find queries to fix all sequences
	// taken from: https://wiki.postgresql.org/wiki/Fixing_Sequences
	const result = await knex.raw(`
		SELECT 'SELECT SETVAL(' ||
			quote_literal(quote_ident(PGT.schemaname) || '.' || quote_ident(S.relname)) ||
			', COALESCE(MAX(' ||quote_ident(C.attname)|| '), 1) ) FROM ' ||
			quote_ident(PGT.schemaname)|| '.'||quote_ident(T.relname)|| ';'
			AS query
		FROM pg_class AS S,
			pg_depend AS D,
			pg_class AS T,
			pg_attribute AS C,
			pg_tables AS PGT
		WHERE S.relkind = 'S'
			AND S.oid = D.objid
			AND D.refobjid = T.oid
			AND D.refobjid = C.attrelid
			AND D.refobjsubid = C.attnum
			AND T.relname = PGT.tablename
		ORDER BY S.relname;
	`);

	await Promise.all(result.rows.map(async query => knex.raw(query.query)));
}

/**
 * insert seed data from a folder
 * data should be in json format
 */
async function seedFolder(folderPath) {
	const self = this;
	const knex = getKnex();

	return new Promise((resolve, reject) => {
		fs.readdir(folderPath, (err, tables) => {
			if (err) {
				reject(err);
				return;
			}

			tables = tables.filter(
				table => table.endsWith('.json') || table.endsWith('.json.js')
			).map((table) => {
				const type = table.endsWith('.json.js') ? 'js' : 'json';
				const name = table.endsWith('.json.js') ? table.slice(0, -8) : table.slice(0, -5);

				return {name, type};
			});

			Promise.all(tables.map((tableData) => {
				return knex(tableData.name).then(() => {
					const importFileName = (tableData.type === 'json') ?
						tableData.name :
						`${tableData.name}.json`;

					// eslint-disable-next-line
					const table = require(`${folderPath}/${importFileName}`);
					return knex(tableData.name).insert(table[tableData.name]);
				});
			})).then(() => {
				// fix autoincrement on postgres
				return self.resetPgSequences();
			}).then(() => {
				resolve();
			}).catch(e => reject(e));
		});
	});
}

/**
 * create a table from schema, generally used in migrations
 */
/* async function createTable(knex, tableName, schema) {
	knex.schema.createTable(tableName, (table) => {
		_.forEach(schema, (type, columnName) => {
			type = type.toLowerCase();

			switch (type) {
				case 'string!':
					table.string(columnName).notNullable().defaultTo('');
					break;

				case 'string':
					table.string(columnName).nullable();
					break;

				case 'id':
					table.increments(columnName).primary();

				case

				default:
					throw new Error(`Unknown Type ${type}`);
			}
		});
	});
	table.increments('id').primary();
	table.string('name', 100).notNullable();
	table.string('shortName', 100).notNullable();
	table.text('link').notNullable();
	table.integer('image').notNullable().defaultTo(0);
	table.integer('imageSquare').notNullable().defaultTo(0);
	table.string('domain', 100).notNullable();
	table.jsonb('data').notNullable().defaultTo('{}');
	table.string('status', 100).notNullable();
	table.boolean('featured').defaultTo(false).notNullable();
	table.integer('rating').notNullable().defaultTo(0);
	table.float('priceBoost').defaultTo(1).notNullable();
	table.timestamp('createdAt').nullable();
	table.timestamp('updatedAt').nullable();
	table.timestamp('deletedAt').nullable();
} */

async function dropDb(env) {
	if (process.env.NODE_ENV === 'production' || env === 'production') {
		throw new Error("Can't use this in production. Too dangerous.");
	}

	const dbConfig = getKnexFile()[env];
	if (!dbConfig) {
		throw new Error(`Config for environment ${env} does not exist`);
	}

	const dbName = dbConfig.connection.database;
	if (!dbName) {
		throw new Error('database name does not exist in the config');
	}

	const isPostgres = dbConfig.client === 'pg';

	if (isPostgres) {
		// since postgres uses default database name as <user>, we need to set the database
		dbConfig.connection.database = 'postgres';
	}
	else {
		// remove database name from config
		// since database may not exist, so we first create knex with no db selected
		dbConfig.connection.database = undefined;
	}

	const knex = Knex(_reducePoolToOne(dbConfig));
	dbConfig.connection.database = dbName;

	if (dbConfig.client === 'pg') {
		try {
			// postgres doesn't allow dropping database while other user are connected
			// so force other users to disconnect
			await knex.raw(`ALTER DATABASE "${dbName}" CONNECTION LIMIT 1`);
			await knex.raw(`
				SELECT pg_terminate_backend(pid)
				FROM pg_stat_activity
				WHERE datname = '${dbName}'
			`);
		}
		catch (e) {
			// Ignore errors
		}
	}
	await knex.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
	await knex.destroy();
}

async function dropDbKnex(knex) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error("Can't use this in production. Too dangerous.");
	}

	if (!knex) {
		throw new Error("Knex is required");
	}

	// destroy existing connections
	await knex.destroy();

	const dbConfig = knex.client.config;
	const dbName = dbConfig.connection.database;
	if (!dbName) {
		throw new Error('database name does not exist in the config');
	}

	const tempKnex = Knex(_setDb(_reducePoolToOne(dbConfig), 'postgres'));

	try {
		// postgres doesn't allow dropping database while other user are connected
		// so force other users to disconnect
		await tempKnex.raw(`ALTER DATABASE "${dbName}" CONNECTION LIMIT 1`);
		await tempKnex.raw(`
			SELECT pg_terminate_backend(pid)
			FROM pg_stat_activity
			WHERE datname = '${dbName}'
		`);
	}
	catch (e) {
		// Ignore errors
	}
	await tempKnex.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
	await tempKnex.destroy();
}

/**
 * Create db if not exists, else do nothing
 */
async function createDb(env, {migrate = false} = {}) {
	const dbConfig = getKnexFile()[env];
	const dbName = dbConfig.connection.database;

	const isPostgres = dbConfig.client === 'pg';
	let knex;

	// since database may not exist, so we first create knex with no db selected
	// remove database name from config
	if (isPostgres) {
		// since postgres uses default database name as <user>, we need to set the database
		dbConfig.connection.database = 'postgres';
		knex = Knex(_reducePoolToOne(dbConfig));

		const res = await knex.raw(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
		if (!res.rowCount) {
			await knex.raw(`CREATE DATABASE "${dbName}"`);
		}
		else {
			logger.log(`DB ${dbName} already exists`);
		}
	}
	else {
		dbConfig.connection.database = undefined;
		knex = Knex(_reducePoolToOne(dbConfig));
		await knex.raw(`CREATE DATABASE IF NOT EXISTS "${dbName}"`);
	}
	logger.log(`Created database ${dbName}`);
	dbConfig.connection.database = dbName;
	await knex.destroy();

	if (migrate) {
		knex = getKnex();
		await knex.migrate.latest();
	}
}


/**
 * Create (or recreate) the database for an environment
 */
async function recreateDb(env) {
	const dbConfig = getKnexFile()[env];
	logger.log(`Recreating DB: ${dbConfig.connection.database}`);

	await dropDb(env);
	await createDb(env);

	const dbName = dbConfig.connection.database;
	dbConfig.connection.database = dbName;

	if (globalKnex) await globalKnex.destroy();
	globalKnex = Knex(dbConfig);

	dbConfig.connection.database = dbName;
	dbConfig.originalDatabase = dbName;
	return globalKnex;
}

function getDbName(env) {
	if (!env) env = process.env.NODE_ENV || 'development';
	const dbConfig = getKnexFile()[env];
	return dbConfig.connection.database;
}

/**
 * create a new database from the old database for an environment
 */
async function copyDb(knex, oldDbName, newDbName) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error("Can't use this in production. Too dangerous.");
	}

	if (!knex) {
		throw new Error("Knex is required");
	}
	if (oldDbName === newDbName) {
		throw new Error(`oldDb can't be same as newDb [${oldDbName}].`);
	}

	// destroy existing connections
	await knex.destroy();

	const dbConfig = knex.client.config;
	const user = dbConfig.connection.user;
	const tempKnex = Knex(_setDb(_reducePoolToOne(dbConfig), 'postgres'));
	logger.log(`Copying DB: ${oldDbName} to ${newDbName}`);

	// close connections to the database
	await tempKnex.raw(`
		SELECT pg_terminate_backend(pid)
		FROM pg_stat_activity
		WHERE datname = '${oldDbName}'
	`);

	// copy database
	await tempKnex.raw(`
		CREATE DATABASE "${newDbName}"
		WITH TEMPLATE "${oldDbName}"
		OWNER '${user}';
	`);

	await tempKnex.destroy();
	return Knex(_setDb(dbConfig, newDbName));
}

/**
 * create a new database from the old database for testing
 */
async function copyDbForTest(knex, originalDb) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error("Can't use this in production. Too dangerous.");
	}

	if (!knex) {
		throw new Error("Knex is required");
	}

	if (!originalDb) {
		originalDb = getDbName(process.env.NODE_ENV || 'test');
	}
	if (!originalDb) {
		throw new Error(`original database not found for env ${env}`);
	}
	if (originalDb === 'postgres') {
		throw new Error(`original database can not be postgres`);
	}

	const random = Math.random().toString(36).substring(2);
	const newDb = `${originalDb}_copy_${random}`;
	const result = await copyDb(knex, originalDb, newDb);
	return result;

}

/**
 * rollback the created new database for testing
 */
async function rollbackCopyDbForTest(knex, originalDb) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error("Can't use this in production. Too dangerous.");
	}

	if (!knex) {
		throw new Error("Knex is required");
	}

	const dbConfig = knex.client.config;
	const currentDb = dbConfig.connection.database;

	if (!originalDb) {
		originalDb = getDbName(process.env.NODE_ENV || 'test');
	}
	if (!originalDb) {
		throw new Error(`original database not found for env ${env}`);
	}
	if (originalDb === 'postgres') {
		throw new Error(`original database can not be postgres`);
	}

	if (currentDb === originalDb) {
		// nothing to do here
		logger.warn(`Rollback DB: current db '${currentDb}' is same as original db`);
		return knex;
	}

	logger.log(`Rollback DB: ${currentDb} to ${originalDb}`);

	// drop the database
	await dropDbKnex(knex);

	return Knex(_setDb(dbConfig, originalDb));
}

/*
 * Recreate the database for an environment and fill it with test data. Useful in development.
 */
async function refreshDb(env) {
	const knex = await recreateDb(env);

	// migrate and seed the database with test data
	await knex.migrate.latest();
	logger.log('Ran migrations')
	await knex.seed.run();
	logger.log('Seeded data')

	return knex;
}

async function updateColumnInBatch({
	table: tableName,
	column,
	update,
}) {
	const knex = getKnex();

	await knex(tableName).update({[column]: update});

	// This is very slow, so disabling for now
	// const limit = 10000;
	// let numUpdated = limit;
	// let totalUpdated = 0;
	// while (numUpdated >= limit) {
	// 	numUpdated = await knex(tableName)
	// 		.update({[column]: update})
	// 		.whereIn(
	// 			'ctid',
	// 			knex(tableName)
	// 				.select('ctid')
	// 				.whereNot(column, update)
	// 				.orWhereNull(column)
	// 				.limit(limit)
	// 		);
	// 	totalUpdated += numUpdated;
	// 	logger.log(`updated ${totalUpdated} rows in ${tableName}.${column}`);
	// 	await Promise.delay(500);
	// }
}

/**
 * add a column to a table with default value efficiently
 */
async function addColumn({
	table: tableName,
	column,
	type,
	default: defaultValue,
	update,
	updateInBatch = true,
	index = false,
	indexConcurrent = false,
}) {
	const knex = getKnex();

	logger.log(`adding column ${column} to ${tableName}`);
	await knex.schema.alterTable(tableName, (table) => {
		table[type](column).nullable();
	});

	logger.log(`setting default value of ${column} in ${tableName}`);
	await knex.raw(
		`ALTER TABLE :tableName: ALTER COLUMN :column: SET DEFAULT '${defaultValue}'`,
		{tableName, column},
	);

	logger.log(`updating ${column} in ${tableName}`);
	if (updateInBatch) {
		await updateColumnInBatch({
			table: tableName,
			column,
			update,
		});
	}
	else {
		await knex(tableName).update({[column]: update});
	}

	logger.log(`setting ${column} to not null in ${tableName}`);
	await knex.raw(
		'ALTER TABLE :tableName: ALTER COLUMN :column: SET NOT NULL',
		{tableName, column},
	);

	if (index) {
		logger.log(`creating index for ${column} in ${tableName}`);
		if (indexConcurrent) {
			const indexName = `${tableName.toLowerCase()}_${column.toLowerCase()}_index`;
			await knex.raw(`CREATE INDEX CONCURRENTLY "${indexName}" ON "${tableName}" ("${column}")`);
		}
		else {
			await knex.schema.alterTable(tableName, (table) => {
				table.index(column);
			});
		}
	}
}

module.exports = {
	getKnexFile,
	getKnex,
	setKnex,
	getDbName,
	getLogger,
	setLogger,
	dropDb,
	createDb,
	recreateDb,
	refreshDb,
	copyDb,
	copyDbForTest,
	rollbackCopyDbForTest,
	resetPgSequences,
	seedFolder,
	addColumn,
	updateColumnInBatch,
};
