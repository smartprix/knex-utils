#! /usr/bin/env node
const _ = require('lodash');
const program = require('commander');
const {version} = require('../package.json');
const knexUtils = require('../index');

const env = process.env.NODE_ENV || 'development';

program
	.command('refresh')
	.action(async () => {
		await knexUtils.refreshDb(env);
	});

program
	.command('create')
	.option('-m, --migrate', 'Run migrations too after creating DB', false)
	.action(async (cmd) => {
		let options = {};
		if (cmd.migrate) {
			options.migrate = true;
		}
		await knexUtils.createDb(env, options);
	});

program
	.version(version)
	.parse(process.argv);