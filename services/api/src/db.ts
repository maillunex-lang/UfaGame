import pg from 'pg';
import type {PoolClient} from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const createPool = () => new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,statement_timeout:10000});
export async function transaction<T>(pool:pg.Pool, work:(client:PoolClient)=>Promise<T>):Promise<T> {
 const client=await pool.connect();
 try {await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function migrate(pool:pg.Pool) {
 const client=await pool.connect();
 try {
  await client.query('SELECT pg_advisory_lock(783104)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
   const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');const sha=createHash('sha256').update(sql).digest('hex');
   const old=await client.query('SELECT sha256 FROM schema_migrations WHERE name=$1',[name]);
   if(old.rowCount){if(old.rows[0].sha256!==sha)throw new Error('Migration checksum mismatch');continue;}
   try {await client.query('BEGIN');await client.query(sql);await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,sha]);await client.query('COMMIT');}
   catch(error){await client.query('ROLLBACK');throw error;}
  }
 }finally{await client.query('SELECT pg_advisory_unlock(783104)');client.release();}
}
