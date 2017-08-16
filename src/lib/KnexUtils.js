// this file is using common-js instead of import because
// it can used from places where babel is not available
const Knex = require('knex');
const knexfile = require('../../knexfile');

/*
 * Create (or recreate) the database for an environment
 */
async function recreateDb(env) {
	if (process.env.NODE_ENV === 'production') {
		throw new Error("Can't use this in production. Too dangerous.");
	}

	const dbConfig = knexfile[env];
	if (!dbConfig) {
		throw new Error(`Config for environment ${env} does not exist`);
	}

	const dbName = dbConfig.connection.database;
	if (!dbName) {
		throw new Error('database name does not exist in the config');
	}

	// remove database name from config
	dbConfig.connection.database = undefined;

	// since database may not exist, so we first create knex with no db selected
	// and then create the database using raw queries
	let knex = Knex(dbConfig);
	await knex.raw(`DROP DATABASE IF EXISTS ${dbName}`);
	await knex.raw(`CREATE DATABASE ${dbName}`);
	await knex.destroy();

	dbConfig.connection.database = dbName;

	knex = Knex(dbConfig);
	return knex;
}

/*
 * Recreate the database for an environment and fill it with test data. Useful in development.
 */
async function refreshDb(env) {
	const knex = await recreateDb(env);

	// no need to rollback as we just recreated the database
	// await knex.migrate.rollback();

	// migrate and seed the database with test data
	await knex.migrate.latest();
	await knex.seed.run();

	return knex;
}

module.exports = {
	recreateDb,
	refreshDb,
};
