import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {validate} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const combat={hp:1000000,attack:1,defense:0,speed:0,range:20000,attack_interval_ms:500,energy_start:1000,energy_per_second:0,energy_per_attack:0};
const content=()=>({schema_version:1,content_version:'fixture_001',required_capabilities:['content.core.v1','battle.combat.v1'],entities:[
 {id:'faction_one',kind:'faction',name:'Faction',data:{advantage_ids:[]}},
 {id:'ability_one',kind:'ability',name:'Ability',data:{effect:'damage',power:40,cooldown_ms:1000}},
 {id:'hero_one',kind:'hero',name:'Hero',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat}},
 {id:'enemy_one',kind:'hero',name:'Enemy',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat}},
 {id:'stage_one',kind:'stage',name:'Stage',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000}}]});
async function publish(){
 const c=content(),client=await pool.connect();try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(783120)');
  const id=Number((await client.query("SELECT nextval(pg_get_serial_sequence('content_versions','id')) AS id")).rows[0].id),version='pub_'+String(id).padStart(6,'0');
  await client.query('INSERT INTO content_versions(id,content_version,sha256,content,resources,required_capabilities,source_draft_id,source_draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[id,version,createHash('sha256').update(version+randomUUID()).digest('hex'),{...c,content_version:version},'[]',c.required_capabilities,randomUUID()]);
  const row=(await client.query("SELECT revision FROM content_pointer WHERE channel='test' FOR UPDATE")).rows[0];
  await client.query("INSERT INTO content_pointer(channel,version_id,revision) VALUES('test',$1,$2) ON CONFLICT (channel) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision",[id,(row?.revision??0)+1]);
  await client.query('COMMIT');return version;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
function inbox(socket){
 const values=[],waiters=[];socket.on('message',data=>{const msg=JSON.parse(data.toString());const index=waiters.findIndex(w=>w.predicate(msg));if(index>=0){const w=waiters.splice(index,1)[0];clearTimeout(w.timer);w.resolve(msg);}else values.push(msg);});
 return predicate=>{const index=values.findIndex(predicate);if(index>=0)return Promise.resolve(values.splice(index,1)[0]);return new Promise((resolve,reject)=>{const w={predicate,resolve,timer:null};w.timer=setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(new Error('WebSocket message timeout'));},10000);waiters.push(w);});};
}
async function connect(url,token){
 const ws=new WebSocket(url,{headers:{authorization:`Bearer ${token}`}}),receive=inbox(ws);
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return {ws,receive};
}
test('live battle: authenticated stream, manual step, retries, reconnect, offline auto and pinned version',{timeout:60000},async()=>{
 let api=await buildApp(pool);const sockets=[];try{
  const guest=async()=>(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
  const me=await guest(),other=await guest(),headers={authorization:`Bearer ${me.access_token}`},version=await publish();
  const body={request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']};
  assert.equal((await api.inject({method:'POST',url:'/v1/live-battles',payload:body})).statusCode,401);
  const created=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:body});assert.equal(created.statusCode,200,created.body);
  const initial=created.json();assert.equal(validate('live_battle_snapshot',initial).ok,true);assert.equal(initial.content_version,version);
  assert.equal((await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:body})).json().battle_id,initial.battle_id);
  assert.equal((await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{...body,hero_ids:['enemy_one']}})).statusCode,409);
  assert.equal((await api.inject({url:'/v1/live-battles/'+initial.battle_id,headers:{authorization:`Bearer ${other.access_token}`}})).statusCode,404);
  await api.listen({host:'127.0.0.1',port:0});const port=api.server.address().port,url=`ws://127.0.0.1:${port}/v1/live-battles/${initial.battle_id}/stream`;
  const anonymous=new WebSocket(url);sockets.push(anonymous);
  const anonymousStatus=await new Promise((resolve,reject)=>{anonymous.once('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);});anonymous.once('open',()=>reject(new Error('Anonymous connection allowed')));anonymous.once('error',reject);});assert.equal(anonymousStatus,401);
  const first=await connect(url,me.access_token);sockets.push(first.ws);const snapshot=await first.receive(m=>m.type==='snapshot');assert.equal(snapshot.snapshot.step,0);
  const forbidden=new WebSocket(url,{headers:{authorization:`Bearer ${other.access_token}`}});sockets.push(forbidden);
  const denied=await new Promise((resolve,reject)=>{forbidden.once('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);});forbidden.once('open',()=>reject(new Error('Another player connected')));forbidden.once('error',reject);});assert.equal(denied,404);
  first.ws.send(JSON.stringify({type:'ability',seq:1,for_step:1,actor_id:'atk_0'}));const ack=await first.receive(m=>m.type==='ack');assert.equal(ack.ack.status,'queued');
  const event=await first.receive(m=>m.type==='frame'&&m.frame.seq===1);assert.equal(validate('live_battle_frame',event.frame).ok,true);
  assert.deepEqual(event.frame.command_results,[{seq:1,status:'applied'}]);assert.ok(event.frame.events.some(e=>e.source_id==='atk_0'&&e.ability_id==='ability_one'));
  first.ws.send(JSON.stringify({type:'ability',seq:1,for_step:1,actor_id:'atk_0'}));assert.equal((await first.receive(m=>m.type==='ack'&&m.ack.seq===1)).ack.replayed,true);
  first.ws.send(JSON.stringify({type:'ability',seq:1,for_step:1,actor_id:'atk_1'}));assert.equal((await first.receive(m=>m.type==='error'&&m.seq===1)).code,'SEQUENCE_CONFLICT');
  first.ws.send(JSON.stringify({type:'reward',seq:2,for_step:2}));assert.equal((await first.receive(m=>m.type==='error'&&m.seq===2)).code,'INVALID_REQUEST');
  first.ws.send(JSON.stringify({type:'ability',seq:2,for_step:1,actor_id:'atk_0'}));assert.ok((await first.receive(m=>m.type==='ack'&&m.ack.seq===2)).ack.for_step>1,'a slightly late tap moves to the next step');
  first.ws.send(JSON.stringify({type:'ability',seq:3,for_step:900,actor_id:'atk_0'}));assert.equal((await first.receive(m=>m.type==='error'&&m.seq===3)).code,'STALE_COMMAND');
  first.ws.send(JSON.stringify({type:'ability',seq:5,for_step:900,actor_id:'atk_0'}));assert.equal((await first.receive(m=>m.type==='error'&&m.seq===5)).code,'OUT_OF_ORDER');
  await publish();assert.equal((await api.inject({url:'/v1/live-battles/'+initial.battle_id,headers})).json().content_version,version);
  const retryAfterPublish=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:body});assert.equal(retryAfterPublish.json().battle_id,initial.battle_id);assert.equal(retryAfterPublish.json().content_version,version);
  first.ws.close();await new Promise(resolve=>first.ws.once('close',resolve));await new Promise(resolve=>setTimeout(resolve,700));
  const offline=(await api.inject({url:'/v1/live-battles/'+initial.battle_id,headers})).json();assert.equal(offline.auto,true);assert.ok(offline.step>1);
  const second=await connect(url+'?after=0',me.access_token);sockets.push(second.ws);const resumed=await second.receive(m=>m.type==='snapshot');assert.equal(resumed.snapshot.content_version,version);
  const replay=await second.receive(m=>m.type==='frame'&&m.frame.seq===1);assert.equal(replay.replayed,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger WHERE player_id=$1',[me.player_id])).rows[0].n,0);
  second.ws.terminate();await new Promise(resolve=>second.ws.once('close',resolve));await api.close();
  await pool.query("UPDATE live_battles SET connection_id=$2,connected_until=clock_timestamp()-interval '3 seconds' WHERE id=$1",[initial.battle_id,randomUUID()]);
  const beforeRestart=(await pool.query('SELECT session_state FROM live_battles WHERE id=$1',[initial.battle_id])).rows[0].session_state.state.step;
  api=await buildApp(pool);await api.listen({host:'127.0.0.1',port:0});await new Promise(resolve=>setTimeout(resolve,800));
  const afterRestart=(await api.inject({url:'/v1/live-battles/'+initial.battle_id,headers})).json();assert.ok(afterRestart.step>beforeRestart);assert.equal(afterRestart.content_version,version);assert.equal(afterRestart.auto,true);
  const restartedUrl=`ws://127.0.0.1:${api.server.address().port}/v1/live-battles/${initial.battle_id}/stream`;
  const third=await connect(restartedUrl,me.access_token);sockets.push(third.ws);await third.receive(m=>m.type==='snapshot');
  third.ws.send(JSON.stringify({type:'ability',seq:1,for_step:1,actor_id:'atk_0'}));assert.equal((await third.receive(m=>m.type==='ack'&&m.ack.seq===1)).ack.replayed,true);
 }finally{for(const socket of sockets)socket.terminate();await api.close();}
});

test('DB lease replacement, concurrent duplicate commands and server-clock deadline',{timeout:60000},async()=>{
 const {attachLive,submitLive}=await import('../../services/api/src/live-battles.ts');
 const api=await buildApp(pool);try{
  const response=await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}}),user=response.json();
  await publish();const headers={authorization:`Bearer ${user.access_token}`},body={request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']};
  const created=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:body});assert.equal(created.statusCode,200,created.body);const id=created.json().battle_id;
  await pool.query("UPDATE live_battles SET next_tick_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",[id]);
  const first=randomUUID(),second=randomUUID();await attachLive(pool,user.access_token,id,first);await attachLive(pool,user.access_token,id,second);
  await api.close(); // Exercise the transactional service without a concurrent timer.
  const command={type:'ability',seq:1,for_step:1,actor_id:'atk_0'};
  await assert.rejects(submitLive(pool,user.access_token,id,first,command),error=>error.status===409&&error.detail==='CONNECTION_REPLACED');
  const result=await Promise.all([submitLive(pool,user.access_token,id,second,command),submitLive(pool,user.access_token,id,second,command)]);
  assert.deepEqual(result.map(a=>a.replayed).sort(),[false,true]);
  await pool.query("UPDATE live_battles SET next_tick_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
  await assert.rejects(submitLive(pool,user.access_token,id,second,{type:'auto',seq:2,for_step:2,enabled:true}),error=>error.status===409&&error.detail==='STALE_COMMAND');
  const state=(await pool.query('SELECT session_state FROM live_battles WHERE id=$1',[id])).rows[0].session_state;assert.equal(state.last_command_seq,1);assert.equal(state.pending.length,1);
 }finally{await api.close();}
});

test('live stream stops after session revocation',{timeout:30000},async()=>{
 const api=await buildApp(pool);let socket;try{
  const guest=await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}}),user=guest.json();
  await publish();const headers={authorization:`Bearer ${user.access_token}`};
  const created=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']}});assert.equal(created.statusCode,200,created.body);
  await api.listen({host:'127.0.0.1',port:0});const url=`ws://127.0.0.1:${api.server.address().port}/v1/live-battles/${created.json().battle_id}/stream`;
  const peer=await connect(url,user.access_token);socket=peer.ws;await peer.receive(m=>m.type==='snapshot');
  const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('revoked socket stayed open')),8000);socket.once('close',code=>{clearTimeout(timer);resolve(code);});});
  await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE player_id=$1',[user.player_id]);assert.equal(await closed,1008);
  assert.equal((await api.inject({url:'/v1/live-battles/'+created.json().battle_id,headers})).statusCode,401);
 }finally{if(socket)socket.terminate();await api.close();}
});

test('after extended outage the stored battle advances offline to timeout without rewards',{timeout:60000},async()=>{
 const {advanceDue}=await import('../../services/api/src/live-battles.ts');
 const api=await buildApp(pool);try{
  const guest=await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}}),user=guest.json();
  await publish();const headers={authorization:`Bearer ${user.access_token}`};
  const created=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']}});assert.equal(created.statusCode,200,created.body);const id=created.json().battle_id;
  await api.close();await pool.query("UPDATE live_battles SET next_tick_at=clock_timestamp()-interval '1000 seconds',connection_id=NULL,connected_until=NULL WHERE id=$1",[id]);
  for(let i=0;i<900;i++)assert.equal(await advanceDue(pool),true);
  const row=(await pool.query('SELECT session_state,completed_at FROM live_battles WHERE id=$1',[id])).rows[0];
  assert.equal(row.session_state.state.step,900);assert.equal(row.session_state.state.result,'attacker_loss');assert.equal(row.session_state.auto,true);assert.ok(row.completed_at);
  const frames=(await pool.query('SELECT count(*)::int AS n,min(seq)::int AS first,max(seq)::int AS last FROM live_battle_frames WHERE battle_id=$1',[id])).rows[0];assert.deepEqual(frames,{n:900,first:1,last:900});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger WHERE player_id=$1',[user.player_id])).rows[0].n,0);
 }finally{await api.close();}
});

test('live socket rejects oversized input and never accepts a token in the URL',{timeout:30000},async()=>{
 const api=await buildApp(pool);let socket;try{
  const guest=await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}}),user=guest.json();
  await publish();const headers={authorization:`Bearer ${user.access_token}`};
  const created=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']}});assert.equal(created.statusCode,200,created.body);
  await api.listen({host:'127.0.0.1',port:0});const url=`ws://127.0.0.1:${api.server.address().port}/v1/live-battles/${created.json().battle_id}/stream`;
  const invalid=new WebSocket(url+'?token=forbidden',{headers});
  const status=await new Promise((resolve,reject)=>{invalid.once('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);});invalid.once('open',()=>reject(new Error('Token in URL accepted')));invalid.once('error',reject);});assert.equal(status,400);
  const peer=await connect(url,user.access_token);socket=peer.ws;await peer.receive(m=>m.type==='snapshot');
  const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Oversized socket stayed open')),8000);socket.once('close',code=>{clearTimeout(timer);resolve(code);});});
  socket.send('x'.repeat(4096));assert.equal(await closed,1009);
 }finally{if(socket)socket.terminate();await api.close();}
});

test('active live battle can be found after an app restart; none means 404',{timeout:30000},async()=>{
 const api=await buildApp(pool);try{
  const me=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
  const headers={authorization:`Bearer ${me.access_token}`};
  assert.equal((await api.inject({url:'/v1/live-battles/active'})).statusCode,401);
  assert.equal((await api.inject({url:'/v1/live-battles/active',headers})).statusCode,404);
  await publish();
  const created=(await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']}})).json();
  const active=await api.inject({url:'/v1/live-battles/active',headers});assert.equal(active.statusCode,200);
  assert.equal(active.json().battle_id,created.battle_id);assert.equal(validate('live_battle_snapshot',active.json()).ok,true);
  const busy=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_one']}});
  assert.equal(busy.statusCode,409);assert.equal(busy.json().error.message,'ACTIVE_BATTLE_EXISTS');
 }finally{await api.close();}
});
