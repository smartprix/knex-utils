#! /usr/bin/env node
const program = require('commander');
const {version} = require('../package.json');
const knexUtils = require('../lib/index');
const consolidate = require('../lib/consolidate');

const env = process.env.NODE_ENV || 'development';

program
	.command('refresh')
	.action(async () => {
		try {
			await knexUtils.refreshDb(env);
			process.exit(0);
		}
		catch (err) {
			knexUtils.getLogger().error('Error while refreshing', err);
			process.exit(1);
		}
	});

program
	.command('create')
	.option('-m, --migrate', 'Run migrations too after creating DB', false)
	.action(async (cmd) => {
		const options = {};
		if (cmd.migrate) {
			options.migrate = true;
		}
		try {
			await knexUtils.createDb(env, options);
			process.exit(0);
		}
		catch (err) {
			knexUtils.getLogger().error('Error while creating DB', err);
			process.exit(1);
		}
	});

program
	.command('consolidate')
	.action(async () => {
		await consolidate.main();
	});

// TODO: show error on unknown command

program
	.version(version)
	.parse(process.argv);
