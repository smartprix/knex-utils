# knex-utils

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

#### Special handling of enum (which is implemented through constraints in knex by default):

*Before:*
```
table.enum('matchStatus', ['unmatched', 'matched', 'archived', 'ignored'])
				.notNullable().defaultTo('unmatched');
```

*After:*
```
 	table.text('matchStatus').notNullable().defaultTo('unmatched');
})
.raw(`ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_matchStatus_check" CHECK (("matchStatus" = ANY (ARRAY['unmatched'::text, 'matched'::text, 'archived'::text, 'ignored'::text])))`)
```
		
### TODO: 

- comments
- parse enum constraint and use enum syntax

### Not supported (for now?):
- Custom indexes not on columns directly
- Functions
- native enum/types