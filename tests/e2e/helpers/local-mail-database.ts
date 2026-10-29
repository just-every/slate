import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

/** A real SQLite database behind D1's test-only statement interface. */
export function localMailDatabase(options: {enableDoubleQuotedStringLiterals?: boolean} = {}) {
  const sql = new DatabaseSync(':memory:', options);
  const migrations = readdirSync('migrations/core').filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) if (name < '0018') sql.exec(readFileSync(`migrations/core/${name}`, 'utf8'));
  let batchTail: Promise<unknown> = Promise.resolve();
  const db = {
    prepare(query: string) {
      let args: any[] = [];
      const execute = () => sql.prepare(query);
      const statement = {
        bind(...values: any[]) { args = values; return statement; },
        async first(column?: string) { const row = execute().get(...args); return column ? row?.[column] ?? null : row ?? null; },
        async raw() { const stmt = execute(); stmt.setReturnArrays(true); return stmt.all(...args); },
        async all() { return {success: true, results: execute().all(...args), meta: {}}; },
        async run() { const stmt = execute(); if (stmt.columns().length) return {success: true, results: stmt.all(...args), meta: {}}; const result = stmt.run(...args); return {success:true,results:[],meta:{changes:result.changes}}; },
      };
      return statement;
    },
    batch(statements: any[]) {
      const result=batchTail.then(async()=>{
        sql.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
        catch (cause) { sql.exec('ROLLBACK'); throw cause; }
      });
      batchTail=result.catch(()=>{});
      return result;
    },
    // This single SQLite connection is always the primary; native request reads
    // still execute their real statements in the same transactional batch.
    withSession() { return {prepare:db.prepare,batch:db.batch,getBookmark:()=>null}; },
  } as unknown as D1Database;
  return { sql, db, migrate() { for (const name of migrations) if (name >= '0018') sql.exec(readFileSync(`migrations/core/${name}`, 'utf8')); }, close() { sql.close(); } };
}
