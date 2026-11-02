import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
import {digest} from '../../services/api/src/auth.ts';
import {validate} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const send=(app,url,payload,token)=>app.inject({method:'POST',url,payload,headers:token?{authorization:`Bearer ${token}`}:{}});
test('two isolated guests, bootstrap retry/network loss, persisted progress and hashed-only sessions',async()=>{
 const app=await buildApp(pool);try{
  const secret=randomBytes(32).toString('base64url');
  const replies=await Promise.all([send(app,'/v1/guests',{installation_secret:secret}),send(app,'/v1/guests',{installation_secret:secret})]);
  assert.ok(replies.every(r=>r.statusCode===200));const a=replies[0].json();assert.deepEqual(a,replies[1].json());assert.equal(validate('session',a).ok,true);
  const b=(await send(app,'/v1/guests',{installation_secret:randomBytes(32).toString('base64url')})).json();assert.notEqual(a.player_id,b.player_id);
  await applyDelta(pool,{playerId:a.player_id,currency:'gold',delta:5,reason:'test_reward',sourceId:'guesttest',key:randomUUID()});
  const progress=token=>app.inject({url:'/v1/progress',headers:{authorization:`Bearer ${token}`}});
  assert.equal((await progress(a.access_token)).json().balances[0].amount,5);assert.deepEqual((await progress(b.access_token)).json().balances,[]);
  assert.equal((await app.inject({url:`/v1/progress?player_id=${a.player_id}`,headers:{authorization:`Bearer ${b.access_token}`}})).statusCode,400);
  assert.equal((await progress('device_id')).statusCode,401);
  const stored=(await pool.query('SELECT * FROM sessions WHERE player_id=$1',[a.player_id])).rows[0];assert.equal(stored.access_hash,digest(a.access_token));assert.ok(!JSON.stringify(stored).includes(a.access_token));
 }finally{await app.close();}
});
test('expiration, refresh lost-response retry, stale replay and revoke',async()=>{
 const app=await buildApp(pool);try{
  const secret=randomBytes(32).toString('base64url'),a=(await send(app,'/v1/guests',{installation_secret:secret})).json();
  await pool.query("UPDATE sessions SET access_expires_at=now()-interval '1 second' WHERE player_id=$1",[a.player_id]);
  assert.equal((await app.inject({url:'/v1/progress',headers:{authorization:`Bearer ${a.access_token}`}})).statusCode,401);
  const request={refresh_token:a.refresh_token,request_id:randomUUID()};const rotated=await send(app,'/v1/sessions/refresh',request);assert.equal(rotated.statusCode,200);const b=rotated.json();
  assert.deepEqual((await send(app,'/v1/sessions/refresh',request)).json(),b);
  assert.equal((await send(app,'/v1/sessions/refresh',{...request,request_id:randomUUID()})).statusCode,401);
  assert.equal((await send(app,'/v1/guests',{installation_secret:secret})).statusCode,401);
  assert.equal((await send(app,'/v1/sessions/revoke',{all_sessions:true},b.access_token)).statusCode,200);
  assert.equal((await app.inject({url:'/v1/progress',headers:{authorization:`Bearer ${b.access_token}`}})).statusCode,401);
  assert.equal((await send(app,'/v1/sessions/refresh',request)).statusCode,401);
  const c=(await send(app,'/v1/guests',{installation_secret:randomBytes(32).toString('base64url')})).json();
  await pool.query("UPDATE sessions SET refresh_expires_at=now()-interval '1 second' WHERE player_id=$1",[c.player_id]);
  assert.equal((await send(app,'/v1/sessions/refresh',{refresh_token:c.refresh_token,request_id:randomUUID()})).statusCode,401);
 }finally{await app.close();}
});
test('refresh race with different request IDs has one winner; rate limit and no extra fields',async()=>{
 const app=await buildApp(pool);try{
  const a=(await send(app,'/v1/guests',{installation_secret:randomBytes(32).toString('base64url')})).json();
  const races=await Promise.all(Array.from({length:2},()=>send(app,'/v1/sessions/refresh',{refresh_token:a.refresh_token,request_id:randomUUID()})));
  assert.deepEqual(races.map(r=>r.statusCode).sort(),[200,401]);
  assert.equal((await send(app,'/v1/guests',{installation_secret:randomBytes(32).toString('base64url'),player_id:a.player_id})).statusCode,400);
  let last;for(let i=0;i<12;i++)last=await send(app,'/v1/guests',{});assert.equal(last.statusCode,429);
 }finally{await app.close();}
});
