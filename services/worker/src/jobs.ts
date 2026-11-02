import type {Pool,PoolClient} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {transaction} from '../../api/src/db.ts';
import {applyDeltaTx} from '../../api/src/economy.ts';
import {DomainError} from '../../api/src/errors.ts';
export async function enqueue(pool:Pool,key:string,payload:any){
 if(key.length<16||key.length>128)throw new DomainError('INVALID_REQUEST');
 const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return transaction(pool,async c=>{
  await c.query('INSERT INTO jobs(id,dedupe_key,kind,payload,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[randomUUID(),key,'ledger_delta',payload,fingerprint]);
  const row=(await c.query('SELECT * FROM jobs WHERE dedupe_key=$1',[key])).rows[0];
  if(row.fingerprint!==fingerprint)throw new DomainError('CONFLICT',409);return row;
 });
}
export async function claim(pool:Pool,worker:string,seconds=30){
 if(!Number.isInteger(seconds)||seconds<1||seconds>300)throw new Error('Invalid lease');
 await pool.query("UPDATE jobs SET status='failed',lease_until=NULL WHERE status='running' AND attempts>=5 AND lease_until<now()");
 const result=await pool.query(`WITH candidate AS (
 SELECT id FROM jobs WHERE attempts<5 AND ((status='pending' AND run_at<=now()) OR(status='running' AND lease_until<now()))
 ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE jobs j SET status='running',attempts=attempts+1,worker_id=$1,lease_token=$2,lease_until=now()+($3::integer*interval '1 second')
 FROM candidate c WHERE j.id=c.id RETURNING j.*`,[worker,randomUUID(),seconds]);
 return result.rows[0]??null;
}
export async function renew(pool:Pool,id:string,token:string){return Boolean((await pool.query("UPDATE jobs SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() RETURNING id",[id,token])).rowCount);}
export async function finish(pool:Pool,id:string,token:string){
 return transaction(pool,async(c:PoolClient)=>{
  const row=(await c.query("SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",[id,token])).rows[0];
  if(!row)return false;
  if(row.kind!=='ledger_delta')throw new DomainError('INVALID_REQUEST');
  await applyDeltaTx(c,{...row.payload,key:`job_${id}`});
  const ack=await c.query("UPDATE jobs SET status='succeeded',lease_until=NULL WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id",[id,token]);
  if(!ack.rowCount)throw new DomainError('CONFLICT',409);return true;
 });
}
export async function runOnce(pool:Pool,worker:string){
 const job=await claim(pool,worker);if(!job)return false;
 try{await finish(pool,job.id,job.lease_token);}catch{
  await pool.query("UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,run_at=now()+interval '1 second',lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,job.lease_token]);
 }return true;
}
