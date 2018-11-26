#! /usr/bin/env node
const _ = require('lodash');
const program = require('commander');
const {version} = require('../package.json');
const knexUtils = require('../lib/index');

const env = process.env.NODE_ENV || 'development';

program
	.command('refresh')
	.action(async () => {
		try {
			await knexUtils.refreshDb(env);
			process.exit(0);
		}
		catch (err) {
			console.error('Error while refreshing', err);
			process.exit(1);
		}
	});

program
	.command('create')
	.option('-m, --migrate', 'Run migrations too after creating DB', false)
	.action(async (cmd) => {
		let options = {};
		if (cmd.migrate) {
			options.migrate = true;
		}
		try {
			await knexUtils.createDb(env, options);
			process.exit(0);
		}
		catch (err) {
			console.error('Error while creating DB', err);
			process.exit(1);
		}
	});

program
	.version(version)
	.parse(process.argv);