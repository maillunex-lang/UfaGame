import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
import {validate} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const secret=()=>randomBytes(32).toString('base64url');
const login=()=>`u${randomUUID().replaceAll('-','').slice(0,25)}`;
const send=(app,url,payload,token)=>app.inject({method:'POST',url,payload,headers:token?{authorization:`Bearer ${token}`}:{}});
const guest=async app=>(await send(app,'/v1/guests',{installation_secret:secret()})).json();
const progress=(app,token)=>app.inject({url:'/v1/progress',headers:{authorization:`Bearer ${token}`}});
test('bind preserves ID and progress, login normalizes case, credentials are hashes only',async()=>{
 const app=await buildApp(pool);try{
  const a=await guest(app),name=login(),password=secret();
  await applyDelta(pool,{playerId:a.player_id,currency:'gold',delta:17,reason:'test_reward',sourceId:'bindtest',key:randomUUID()});
  const bound=await send(app,'/v1/account/bind',{login:name.toUpperCase(),password},a.access_token);assert.equal(bound.statusCode,200);const b=bound.json();assert.equal(validate('bound_session',b).ok,true);assert.equal(b.session.player_id,a.player_id);
  assert.equal((await progress(app,a.access_token)).statusCode,401);assert.equal((await progress(app,b.session.access_token)).json().balances[0].amount,17);
  const signed=await send(app,'/v1/sessions/login',{login:name,password});assert.equal(signed.statusCode,200);assert.equal(signed.json().player_id,a.player_id);
  assert.equal((await send(app,'/v1/sessions/login',{login:name,password:secret()})).statusCode,401);
  const row=(await pool.query('SELECT * FROM players WHERE id=$1',[a.player_id])).rows[0];assert.ok(row.password_hash.startsWith('scrypt$131072$8$1$'));assert.ok(!JSON.stringify(row).includes(password));assert.ok(!JSON.stringify(row).includes(b.recovery_code));
 }finally{await app.close();}
});
test('same normalized login race has one winner; losing guest still works',async()=>{
 const app=await buildApp(pool);try{
  const a=await guest(app),b=await guest(app),name=login();
  const responses=await Promise.all([send(app,'/v1/account/bind',{login:name,password:secret()},a.access_token),send(app,'/v1/account/bind',{login:name.toUpperCase(),password:secret()},b.access_token)]);
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
  const loser=responses[0].statusCode===409?a:b;assert.equal((await progress(app,loser.access_token)).statusCode,200);
  assert.equal((await pool.query('SELECT * FROM players WHERE login=$1',[name])).rowCount,1);
 }finally{await app.close();}
});
test('recovery race consumes code once, rotates code/password and revokes all old sessions',async()=>{
 const app=await buildApp(pool);try{
  const a=await guest(app),name=login(),password=secret();const bound=(await send(app,'/v1/account/bind',{login:name,password},a.access_token)).json();
  const another=(await send(app,'/v1/sessions/login',{login:name,password})).json();
  assert.equal((await send(app,'/v1/account/recover',{login:name,recovery_code:secret(),new_password:secret()})).statusCode,401);
  const newPassword=secret(),payload={login:name,recovery_code:bound.recovery_code,new_password:newPassword};
  const results=await Promise.all([send(app,'/v1/account/recover',payload),send(app,'/v1/account/recover',payload)]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,401]);
  const changed=results.find(r=>r.statusCode===200).json();assert.equal(changed.session.player_id,a.player_id);assert.notEqual(changed.recovery_code,bound.recovery_code);
  for(const s of [bound.session,another])assert.equal((await progress(app,s.access_token)).statusCode,401);
  assert.equal((await send(app,'/v1/sessions/login',{login:name,password})).statusCode,401);
  assert.equal((await send(app,'/v1/sessions/login',{login:name,password:newPassword})).statusCode,200);
  assert.equal((await send(app,'/v1/account/recover',payload)).statusCode,401);
  const rotated=await send(app,'/v1/account/recovery/rotate',{password:newPassword},changed.session.access_token);assert.equal(rotated.statusCode,200);
  assert.equal((await send(app,'/v1/account/recover',{login:name,recovery_code:changed.recovery_code,new_password:secret()})).statusCode,401);
  assert.equal((await send(app,'/v1/account/recover',{login:name,recovery_code:rotated.json().recovery_code,new_password:secret()})).statusCode,200);
 }finally{await app.close();}
});

test('login limit returns sanitized429, unauthenticated bind cannot modify guest',async()=>{
 const app=await buildApp(pool);try{
  const a=await guest(app);
  assert.equal((await send(app,'/v1/account/bind',{login:login(),password:secret()})).statusCode,401);
  assert.equal((await pool.query('SELECT account_type FROM players WHERE id=$1',[a.player_id])).rows[0].account_type,'guest');
  let response;for(let i=0;i<12;i++)response=await send(app,'/v1/sessions/login',{});
  assert.equal(response.statusCode,429);assert.equal(validate('error',response.json()).ok,true);
 }finally{await app.close();}
});
