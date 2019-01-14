<a href="https://www.npmjs.com/package/@smpx/knex-utils"><img src="https://img.shields.io/npm/v/@smpx/knex-utils.svg" alt="Version"></a>
<a href="https://www.npmjs.com/package/@smpx/knex-utils"><img src="https://img.shields.io/npm/dm/@smpx/knex-utils.svg" alt="Downloads"></a>
<a href="https://www.npmjs.com/package/@smpx/knex-utils"><img src="https://img.shields.io/npm/l/@smpx/knex-utils.svg" alt="License"></a>
<a href="https://david-dm.org/smartprix/knex-utils"><img src="https://david-dm.org/smartprix/knex-utils/status.svg" alt="Dependencies"></a>
<a href="https://david-dm.org/smartprix/knex-utils?type=dev"><img src="https://david-dm.org/smartprix/knex-utils/dev-status.svg" alt="Dev Dependencies"></a>

# knex-utils

It is a set of utility functions for use with knex and knex migrations. Mostly aimed at PostgreSQL.

## CLI:

```
Usage: knex-utils [options] [command]

Options:
  -V, --version     output the version number
  -h, --help        output usage information

Commands:
  refresh
  create [options]
```

### For `knex-utils create` :
```
Usage: knex-utils create [options]

Options:
  -m, --migrate  Run migrations too after creating DB
  -h, --help     output usage information
```

## KnexFile:

The cwd should have a knexfile.js, this is used by knex to connect to the DB.

Reference : https://knexjs.org/#knexfile


## Consolidate:

** ONLY WORKS WITH POSTGRESQL **

Tool to consolidate all existing schema migrations into one migration and corresponding tables folder with one file for each table.

### Supported types for columns:

- integer
- increments
- string
- jsonb
- timestamp
- text
- boolean
- float
- decimal
- enum
- specificType :
	- citext

### Supported Modifiers:

- unique
- index
- primary
- composite primary keys
- nullable
- notNullable
- defaultTo
- maxLength for string
- numeric_precision for numeric
		
### TODO: 

- Handle Partitions:
  - Could look at code for [Migra](https://github.com/djrobstep/migra)
  - https://dba.stackexchange.com/questions/40441/get-all-partition-names-for-a-table

### Not supported (for now?):
- Custom indexes not on columns directly
- Functions
- native types
