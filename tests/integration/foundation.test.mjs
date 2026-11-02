import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool,transaction} from '../../services/api/src/db.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {enqueue,claim,finish,renew} from '../../services/worker/src/jobs.ts';
const pool=createPool();after(()=>pool.end());
async function player(){const id=randomUUID();await pool.query('INSERT INTO players(id) VALUES($1)',[id]);return id;}
const args=(playerId,delta,key=randomUUID())=>({playerId,currency:'gold',delta,key,reason:'test_reward',sourceId:'integration'});
test('health 200, ready 503 on DB failure; no public currency grant',async()=>{
 const app=await buildApp(pool);try{
  assert.equal((await app.inject('/health/live')).statusCode,200);assert.equal((await app.inject('/health/ready')).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/grant',payload:{amount:10}})).statusCode,404);
 }finally{await app.close();}
 const unavailable=await buildApp({query:async()=>{throw new Error('offline');}});
 try{assert.equal((await unavailable.inject('/health/ready')).statusCode,503);}finally{await unavailable.close();}
});
test('rollback does not keep balance or ledger; duplicate/conflicting keys; overspend race',async()=>{
 const id=await player();
 await assert.rejects(transaction(pool,async c=>{await c.query('INSERT INTO balances VALUES($1,$2,$3)',[id,'gold',99]);throw new Error('rollback');}));
 assert.equal((await pool.query('SELECT * FROM balances WHERE player_id=$1',[id])).rowCount,0);
 const request=args(id,100);const results=await Promise.all(Array.from({length:5},()=>applyDelta(pool,request)));
 assert.equal(new Set(results.map(x=>x.id)).size,1);
 await assert.rejects(applyDelta(pool,{...request,delta:101}),e=>e.code==='CONFLICT');
 const spent=await Promise.allSettled([applyDelta(pool,args(id,-80)),applyDelta(pool,args(id,-80))]);
 assert.equal(spent.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(Number((await pool.query('SELECT amount FROM balances WHERE player_id=$1',[id])).rows[0].amount),20);
 await assert.rejects(applyDelta(pool,args(id,2147483647)));
 assert.equal((await pool.query('SELECT * FROM ledger WHERE player_id=$1',[id])).rowCount,2);
});
test('jobs dedupe, exclusive claim, expired lease fencing, atomic reward/ack',async()=>{
 const id=await player();const key=randomUUID(),payload=args(id,7);delete payload.key;
 const j=await enqueue(pool,key,payload);assert.equal((await enqueue(pool,key,payload)).id,j.id);
 await assert.rejects(enqueue(pool,key,{...payload,delta:8}),e=>e.code==='CONFLICT');
 const jobs=await Promise.all([claim(pool,'worker_a'),claim(pool,'worker_b')]);const owned=jobs.filter(Boolean);assert.equal(owned.length,1);
 const old=owned[0];assert.equal(await renew(pool,old.id,old.lease_token),true);
 await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[old.id]);
 const fresh=await claim(pool,'worker_c');assert.equal(fresh.id,j.id);
 assert.equal(await finish(pool,j.id,old.lease_token),false);assert.equal(await renew(pool,j.id,old.lease_token),false);
 assert.equal(await finish(pool,j.id,fresh.lease_token),true);assert.equal(await finish(pool,j.id,fresh.lease_token),false);
 assert.equal(Number((await pool.query('SELECT amount FROM balances WHERE player_id=$1',[id])).rows[0].amount),7);
});
