import Knex, {Config} from 'knex'

declare module '@smpx/knex-utils' {
	function getKnexFile(): {[environment: string]: Config};
	function getKnex(): Knex;
	function setKnex(knex: Knex): void;
	function getDbName(env?: string): string;
	function getLogger(): Console;
	function setLogger(logger: Console): void;
	function dropDb(env: string): Promise<void>;
	function createDb(env: string, opts?: {migrate?: boolean}): Promise<void>;
	function recreateDb(env: string): Promise<Knex>;
	function refreshDb(env: string): Promise<Knex>;
	function copyDb(knex: Knex, oldDbName: string, newDbName: string): Promise<Knex>;
	function copyDbForTest(knex: Knex, originalDb?: string): Promise<Knex>;
	function rollbackCopyDbForTest(knex: Knex, originalDb?: string): Promise<Knex>;
	function resetPgSequences(): Promise<void>;
	function seedFolder(folderPath: string): Promise<void>;
	function addColumn(opts: {
		table: string,
		column: string, 
		type: string,
		default: any,
		update: any,
		updateInBatch?: boolean,
		index?: boolean,
		indexConcurrent?: boolean,
	}): Promise<void>;
	function updateColumnInBatch(opts: {table: string, column: string, update: any}): Promise<void>;
}