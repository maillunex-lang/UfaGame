import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
import {validate,questProblems} from '@ufagame/contracts';
import {speedQuestContent} from '../fixtures/progression.mjs';
// Battles left running would tick inside later test files: finish them.
const pool=createPool();after(async()=>{await pool.query('UPDATE live_battles SET completed_at=clock_timestamp() WHERE completed_at IS NULL');await pool.end();});
async function publish(c){
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(783120)');
  const id=Number((await db.query("SELECT nextval(pg_get_serial_sequence('content_versions','id')) AS id")).rows[0].id),label='pub_'+String(id).padStart(6,'0');
  await db.query('INSERT INTO content_versions(id,content_version,sha256,content,resources,required_capabilities,source_draft_id,source_draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[id,label,createHash('sha256').update(label+randomUUID()).digest('hex'),{...c,content_version:label},'[]',c.required_capabilities,randomUUID()]);
  const cur=(await db.query("SELECT revision FROM content_pointer WHERE channel='test' FOR UPDATE")).rows[0];
  await db.query("INSERT INTO content_pointer(channel,version_id,revision) VALUES('test',$1,$2) ON CONFLICT (channel) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision",[id,(cur?.revision??0)+1]);
  await db.query('COMMIT');return label;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function player(api){
 const g=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
 const headers={authorization:`Bearer ${g.access_token}`};
 return {g,headers,get:async url=>(await api.inject({url,headers})).json(),post:(url,payload={})=>api.inject({method:'POST',url,headers,payload}),
  give:(currency,delta)=>applyDelta(pool,{playerId:g.player_id,currency,delta,reason:'test_grant',sourceId:'test',key:'test-grant-'+randomUUID()})};
}
const finish=async(api,p,id)=>{for(let i=0;i<200;i++){const x=(await api.inject({url:'/v1/live-battles/'+id,headers:p.headers})).json();if(x.result)return x;await new Promise(r=>setTimeout(r,500));}throw new Error('not finished');};
function socket(url,token){
 const ws=new WebSocket(url,{headers:{authorization:`Bearer ${token}`}}),msgs=[];ws.on('message',d=>msgs.push(JSON.parse(d.toString())));
 const wait=async(pred,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){const i=msgs.findIndex(pred);if(i>=0)return msgs.splice(i,1)[0];await new Promise(r=>setTimeout(r,20));}throw new Error('timeout');};
 return {ws,msgs,wait,open:new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);})};
}

test('S26 speeds: ×1 only at start, ×2 after progress, ×4 by VIP, 90 game seconds kept, instant only for VIP repeats',{timeout:180000},async()=>{
 const api=await buildApp(pool);await api.listen({host:'127.0.0.1',port:0});const port=api.server.address().port;const sockets=[];try{
  await publish(speedQuestContent());const p=await player(api);const h=await p.get('/v1/heroes');
  let v=await p.get('/v1/vip');assert.equal(validate('vip',v).ok,true);assert.deepEqual(v.battle,{speeds:[1],instant:false,x2_stages_left:1,x4_level:2,instant_level:3});
  // Instant calculation: refused without VIP and for an uncleared stage.
  let r=await p.post('/v1/battles',{request_id:randomUUID(),stage_id:'stage_one',instance_ids:[h.main[0]]});assert.equal(r.json().error.message,'INSTANT_NOT_ALLOWED');
  // Live battle: ×2 refused before progress.
  const start=async stage=>{const x=await p.post('/v1/live-battles',{request_id:randomUUID(),stage_id:stage,instance_ids:[h.main[0]]});assert.equal(x.statusCode,200,x.body);return x.json();};
  let b=await start('stage_one');
  const s1=socket(`ws://127.0.0.1:${port}/v1/live-battles/${b.battle_id}/stream`,p.g.access_token);sockets.push(s1.ws);await s1.open;await s1.wait(m=>m.type==='snapshot');
  s1.ws.send(JSON.stringify({type:'speed',seq:1,for_step:Math.min(900,b.step+2),value:2}));
  assert.equal((await s1.wait(m=>m.type==='error'||m.type==='ack')).code,'SPEED_NOT_ALLOWED');
  await finish(api,p,b.battle_id);s1.ws.close();
  v=await p.get('/v1/vip');assert.deepEqual(v.battle.speeds,[1,2],'×2 after one cleared stage');
  // ×4 needs VIP 2 (500 points): give points, then a long battle at ×4 runs 4 times faster.
  await p.give('vip_points',500);v=await p.get('/v1/vip');assert.deepEqual(v.battle.speeds,[1,2,4]);assert.equal(v.battle.instant,false);
  b=await start('stage_long');
  const s2=socket(`ws://127.0.0.1:${port}/v1/live-battles/${b.battle_id}/stream`,p.g.access_token);sockets.push(s2.ws);await s2.open;const snap=await s2.wait(m=>m.type==='snapshot');
  s2.ws.send(JSON.stringify({type:'speed',seq:1,for_step:Math.min(900,snap.snapshot.step+2),value:4}));
  assert.equal((await s2.wait(m=>m.type==='ack'||m.type==='error')).type,'ack');
  const fast=await s2.wait(m=>m.type==='frame'&&m.frame.speed===4,15000);
  const t0=Date.now(),step0=fast.frame.seq;await new Promise(res=>setTimeout(res,2000));
  const steps=(await p.get('/v1/live-battles/'+b.battle_id)).step-step0,rate=steps/((Date.now()-t0)/1000);
  assert.ok(rate>25,'about 40 steps per real second at ×4, got '+rate.toFixed(1));
  // Timeout at ×4: 900 steps (90 game seconds) in about 22.5 real seconds, then a loss.
  const end=await finish(api,p,b.battle_id),real=(Date.now()-t0)/1000+fast.frame.seq/40;
  assert.equal(end.step,900,'exactly 90 game seconds');assert.equal(end.result,'attacker_loss');assert.equal(end.speed,4);
  assert.ok(real<35,'×4 timeout took about 22.5 s, measured '+real.toFixed(1));
  s2.ws.close();
  // Instant: VIP 3 needed; the cleared stage only; the result comes from the server.
  await p.give('vip_points',1000000000);
  r=await p.post('/v1/battles',{request_id:randomUUID(),stage_id:'stage_two',instance_ids:[h.main[0]]});assert.equal(r.json().error.message,'FIRST_CLEAR_REQUIRES_BATTLE');
  r=await p.post('/v1/battles',{request_id:randomUUID(),stage_id:'stage_one',instance_ids:[h.main[0]],result:'attacker_win'});assert.equal(r.statusCode,400,'client cannot send a result');
  r=await p.post('/v1/battles',{request_id:randomUUID(),stage_id:'stage_one',instance_ids:[h.main[0]]});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().result,'attacker_win');assert.ok(r.json().steps<=900);
 }finally{for(const s of sockets)s.terminate();await api.close();}
});

test('S30 quests: events counted once, series, rewards by server state, daily expiry, claim after reconnect, broken target blocks publish',{timeout:180000},async()=>{
 const api=await buildApp(pool);await api.ready();try{
  await publish(speedQuestContent());const p=await player(api);const h=await p.get('/v1/heroes');
  let q=await p.get('/v1/quests');assert.equal(validate('quests',q).ok,true);
  const st=id=>q.quests.find(x=>x.id===id);
  assert.deepEqual(q.quests.map(x=>[x.id,x.status,x.progress]),[['quest_daily_wins','active',0],['quest_clear_one','active',0],['quest_level_after','locked',0],['quest_summon_ten','active',0]]);
  assert.ok(st('quest_daily_wins').expires_at,'daily quest shows when it expires');
  assert.equal((await p.post('/v1/quests/claim',{request_id:randomUUID(),quest_id:'quest_clear_one'})).json().error.message,'QUEST_NOT_COMPLETE');
  // Locked series: a level-up before unlocking does not count.
  await p.give('gold',1000);await p.give('hero_exp',1000);
  assert.equal((await p.post('/v1/heroes/level',{instance_id:h.main[0],from_level:1})).statusCode,200);
  q=await p.get('/v1/quests');assert.equal(st('quest_level_after').progress,0);
  // Win stage_one: battle_win + campaign_clear; the same battle recorded twice counts once.
  const b=(await p.post('/v1/live-battles',{request_id:randomUUID(),stage_id:'stage_one',instance_ids:[h.main[0]]})).json();
  await finish(api,p,b.battle_id);
  const {recordQuestEvent}=await import('../../services/api/src/quests.ts');const {transaction}=await import('../../services/api/src/db.ts');
  await Promise.all([1,2].map(()=>transaction(pool,c=>recordQuestEvent(c,p.g.player_id,'battle_win',b.battle_id,{stageId:'stage_one'}))));
  q=await p.get('/v1/quests');assert.equal(st('quest_daily_wins').progress,1,'one battle = one event');assert.equal(st('quest_clear_one').status,'ready');
  // Claim (after "reconnect": a new app instance, same server state).
  await api.close();const api2=await buildApp(pool);await api2.ready();
  try{
   const post=(u,x)=>api2.inject({method:'POST',url:u,headers:p.headers,payload:x}),get=async u=>(await api2.inject({url:u,headers:p.headers})).json();
   const [c1,c2]=await Promise.all([post('/v1/quests/claim',{request_id:randomUUID(),quest_id:'quest_clear_one'}),post('/v1/quests/claim',{request_id:randomUUID(),quest_id:'quest_clear_one'})]);
   assert.deepEqual([c1.statusCode,c2.statusCode].sort(),[200,409],'reward once');
   const gems=Number((await pool.query("SELECT amount FROM balances WHERE player_id=$1 AND currency='gems'",[p.g.player_id])).rows[0].amount);assert.equal(gems,50);
   assert.ok((await get('/v1/heroes')).heroes.some(x=>x.hero_id==='hero_f'),'reward hero');
   q=await get('/v1/quests');assert.equal(st('quest_level_after').status,'active','series opens after the previous reward');
   assert.equal((await post('/v1/heroes/level',{instance_id:h.main[0],from_level:2})).statusCode,200);
   q=await get('/v1/quests');assert.equal(st('quest_level_after').status,'ready');
   // Summon events add the pull count.
   await p.give('gems',1000);assert.equal((await post('/v1/summon',{request_id:randomUUID(),pool_id:'pool_main',count:10})).statusCode,200);
   q=await get('/v1/quests');assert.equal(st('quest_summon_ten').status,'ready');
   // Daily expiry: yesterday's progress cannot be claimed today.
   await pool.query("UPDATE quest_progress SET progress=2,period=to_char((clock_timestamp() AT TIME ZONE 'Asia/Yekaterinburg')::date-1,'YYYY-MM-DD') WHERE player_id=$1 AND quest_id='quest_daily_wins'",[p.g.player_id]);
   q=await get('/v1/quests');assert.deepEqual([st('quest_daily_wins').status,st('quest_daily_wins').progress],['active',0]);
   assert.equal((await post('/v1/quests/claim',{request_id:randomUUID(),quest_id:'quest_daily_wins'})).json().error.message,'QUEST_NOT_COMPLETE');
  }finally{await api2.close();}
  // Broken target: a quest naming a deleted stage or a series cycle is invalid content.
  const broken=speedQuestContent({quests:[{id:'quest_bad',kind:'quest',name:'Плохой',data:{period:'once',event:'campaign_clear',stage_id:'stage_gone',target:1,rewards:[{currency:'gold',amount:1}]}}]});
  assert.deepEqual(questProblems(broken).map(x=>x.code),['QUEST_STAGE_INVALID']);assert.equal(validate('content',broken).ok,false);
  const cycle=speedQuestContent();cycle.entities.find(e=>e.id==='quest_clear_one').data.requires_quest_id='quest_level_after';
  assert.ok(questProblems(cycle).some(x=>x.code==='QUEST_SERIES_CYCLE'));
 }finally{await api.close().catch(()=>{});}
});
