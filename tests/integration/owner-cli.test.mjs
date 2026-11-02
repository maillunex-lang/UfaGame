import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPool} from '../../services/api/src/db.ts';
const pool=createPool();after(()=>pool.end());
test('owner CLI requires private password file and creates exactly one audited owner',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ufagame-owner-cli-'));const file=join(dir,'password');
 const schema='s08_cli_'+randomUUID().replaceAll('-',''),password=randomBytes(32).toString('base64url');
 await pool.query(`CREATE SCHEMA ${schema}`);
 try{
  const env={...process.env,PGOPTIONS:`-c search_path=${schema}`,UFAGAME_OWNER_LOGIN:'cli_owner',UFAGAME_OWNER_PASSWORD_FILE:file};
  const migrate=spawnSync(process.execPath,['services/api/src/migrate.ts'],{env,encoding:'utf8'});assert.equal(migrate.status,0,migrate.stderr);
  await writeFile(file,password,{mode:0o600});await chmod(file,0o644);
  const bad=spawnSync(process.execPath,['services/api/src/create-owner.ts'],{env,encoding:'utf8'});assert.notEqual(bad.status,0);assert.ok(!bad.stderr.includes(password));
  assert.equal((await pool.query(`SELECT * FROM ${schema}.owner_accounts`)).rowCount,0);
  await chmod(file,0o600);
  const created=spawnSync(process.execPath,['services/api/src/create-owner.ts'],{env,encoding:'utf8'});assert.equal(created.status,0,created.stderr);assert.ok(!created.stdout.includes(password));
  assert.equal((await pool.query(`SELECT * FROM ${schema}.owner_accounts`)).rowCount,1);assert.equal((await pool.query(`SELECT * FROM ${schema}.owner_audit`)).rowCount,1);
  const duplicate=spawnSync(process.execPath,['services/api/src/create-owner.ts'],{env,encoding:'utf8'});assert.notEqual(duplicate.status,0);assert.equal((await pool.query(`SELECT * FROM ${schema}.owner_accounts`)).rowCount,1);
 }finally{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await rm(dir,{recursive:true,force:true});}
});
