import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createPool,transaction} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
import {grantWinVip} from '../../services/api/src/economy-routes.ts';
import {validate} from '@ufagame/contracts';
import {economyContent} from '../fixtures/progression.mjs';
const pool=createPool();after(()=>pool.end());
async function publish(c,{releasedHoursAgo=null}={}){
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(783120)');
  const id=Number((await db.query("SELECT nextval(pg_get_serial_sequence('content_versions','id')) AS id")).rows[0].id),label='pub_'+String(id).padStart(6,'0');
  await db.query('INSERT INTO content_versions(id,content_version,sha256,content,resources,required_capabilities,source_draft_id,source_draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[id,label,createHash('sha256').update(label+randomUUID()).digest('hex'),{...c,content_version:label},'[]',c.required_capabilities,randomUUID()]);
  const cur=(await db.query("SELECT revision FROM content_pointer WHERE channel='test' FOR UPDATE")).rows[0],rev=(cur?.revision??0)+1;
  await db.query("INSERT INTO content_pointer(channel,version_id,revision) VALUES('test',$1,$2) ON CONFLICT (channel) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision",[id,rev]);
  if(releasedHoursAgo!==null)await db.query("INSERT INTO content_releases(channel,action,to_version_id,pointer_revision,reason,request_id,created_at) VALUES('test','publish',$1,$2,'economy test',$3,now()-make_interval(hours=>$4))",[id,rev,randomUUID(),releasedHoursAgo]);
  await db.query('COMMIT');return label;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function player(api){
 const g=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
 const headers={authorization:`Bearer ${g.access_token}`};
 return {g,headers,get:async(url,schema)=>{const r=await api.inject({url,headers});assert.equal(r.statusCode,200,r.body);if(schema){const v=validate(schema,r.json());assert.equal(v.ok,true,url+JSON.stringify(v));}return r.json();},
  post:(url,payload={})=>api.inject({method:'POST',url,headers,payload}),
  give:(currency,delta)=>applyDelta(pool,{playerId:g.player_id,currency,delta,reason:'test_grant',sourceId:'test',key:'test-grant-'+randomUUID()}),
  bal:async c=>Number((await pool.query('SELECT amount FROM balances WHERE player_id=$1 AND currency=$2',[g.player_id,c])).rows[0]?.amount??0)};
}
const win=async(api,p,stage,instances)=>{
 const r=await p.post('/v1/live-battles',{request_id:randomUUID(),stage_id:stage,instance_ids:instances});assert.equal(r.statusCode,200,r.body);
 for(let i=0;i<120;i++){const x=(await api.inject({url:'/v1/live-battles/'+r.json().battle_id,headers:p.headers})).json();if(x.result)return x.result;await new Promise(res=>setTimeout(res,500));}
 throw new Error('battle did not finish');
};
const shift=(playerId,hours)=>pool.query("UPDATE afk_state SET segment_at=segment_at-make_interval(hours=>$2),window_started_at=window_started_at-make_interval(hours=>$2) WHERE player_id=$1",[playerId,hours]);

test('S25 VIP: tutorial once after real steps, daily once, win points capped, level from points and current table, big thresholds',{timeout:120000},async()=>{
 const api=await buildApp(pool);await api.ready();try{
  await publish(economyContent());const p=await player(api);
  let v=await p.get('/v1/vip','vip');
  assert.equal(v.level,0);assert.deepEqual(v.tutorial.steps.map(s=>[s.id,s.done]),[['first_win',false],['level_up',false],['equip',false]]);
  assert.deepEqual(v.levels.map(l=>l.free_days),[0,5,12499999],'every level reachable without paying (tutorial + 50 daily + 30 wins a day)');
  let r=await p.post('/v1/tutorial/claim',{request_id:randomUUID()});assert.equal(r.json().error.message,'TUTORIAL_NOT_FINISHED');
  const [d1,d2]=await Promise.all([p.post('/v1/vip/daily',{request_id:randomUUID()}),p.post('/v1/vip/daily',{request_id:randomUUID()})]);
  assert.deepEqual([d1.statusCode,d2.statusCode].sort(),[200,409]);assert.equal(await p.bal('vip_points'),50,'daily once per day');
  // Tutorial steps from real server state.
  const h=await p.get('/v1/heroes');await p.give('gold',100);await p.give('hero_exp',100);
  assert.equal((await p.post('/v1/heroes/level',{instance_id:h.main[0],from_level:1})).statusCode,200);
  assert.equal((await p.post('/v1/items/equip',{item_instance_id:h.items.find(i=>i.item_id==='item_sword').id,hero_instance_id:h.main[0]})).statusCode,200);
  assert.equal(await win(api,p,'stage_one',[h.main[0]]),'attacker_win');
  v=await p.get('/v1/vip','vip');assert.ok(v.tutorial.steps.every(s=>s.done));assert.equal(v.wins.today,10,'win gives VIP points');
  r=await p.post('/v1/tutorial/claim',{request_id:randomUUID()});assert.equal(r.statusCode,200);assert.equal(r.json().level,1,'VIP 1 from the tutorial');
  r=await p.post('/v1/tutorial/claim',{request_id:randomUUID()});assert.equal(r.json().error.message,'TUTORIAL_ALREADY_CLAIMED');
  assert.equal(await p.bal('vip_points'),160);
  // Win points stop at the daily cap.
  const row={player_id:p.g.player_id,content_version:(await pool.query("SELECT v.content_version FROM content_pointer p JOIN content_versions v ON v.id=p.version_id")).rows[0].content_version};
  for(let i=0;i<5;i++)await transaction(pool,c=>grantWinVip(c,{...row,id:randomUUID()}));
  assert.equal((await p.get('/v1/vip')).wins.today,30);assert.equal(await p.bal('vip_points'),180);
  // Table change: same points, level recomputed; client cannot set VIP (no such API).
  await publish(economyContent({vip:{levels:[{points:150},{points:170,afk_hours:3},{points:1000000000}]}}));
  v=await p.get('/v1/vip','vip');assert.equal(v.level,2);assert.equal(v.afk_hours,3);
  assert.equal((await p.post('/v1/vip',{level:7})).statusCode,404);
 }finally{await api.close();}
});

test('S27 summon: shortage, odds, 10-pull replay, guarantee boundary, parallel pulls, shards, guarantee kept on content change',{timeout:120000},async()=>{
 const api=await buildApp(pool);await api.ready();try{
  await publish(economyContent());const p=await player(api);await p.get('/v1/heroes');
  let s=await p.get('/v1/summon','summon');
  assert.deepEqual(s.pools[0].odds.map(o=>o.chance_pct),['20.00','20.00','40.00','20.00']);assert.equal(s.pools[0].guarantee.pulls_left,3);
  let r=await p.post('/v1/summon',{request_id:randomUUID(),pool_id:'pool_main',count:1});assert.equal(r.json().error.code,'INSUFFICIENT_BALANCE');
  assert.equal((await pool.query('SELECT count(*)::int n FROM summon_pulls WHERE player_id=$1',[p.g.player_id])).rows[0].n,0);
  await p.give('gems',1000);
  const id=randomUUID();r=await p.post('/v1/summon',{request_id:id,pool_id:'pool_main',count:10});assert.equal(r.statusCode,200,r.body);
  const first=r.json().last;assert.equal(first.length,10);
  const replay=await p.post('/v1/summon',{request_id:id,pool_id:'pool_main',count:10});assert.deepEqual(replay.json().last,first,'same request_id returns the saved result');
  assert.equal(await p.bal('gems'),900,'paid once');
  assert.equal((await p.post('/v1/summon',{request_id:id,pool_id:'pool_main',count:1})).json().error.message,'REQUEST_ID_REUSED');
  // Parallel pulls with different ids both succeed and are counted.
  const par=await Promise.all([1,2,3].map(()=>p.post('/v1/summon',{request_id:randomUUID(),pool_id:'pool_main',count:10})));
  assert.ok(par.every(x=>x.statusCode===200));assert.equal(await p.bal('gems'),600);
  const all=(await pool.query('SELECT results FROM summon_pulls WHERE player_id=$1 ORDER BY created_at',[p.g.player_id])).rows.flatMap(x=>x.results);
  assert.equal(all.length,40);assert.equal(Number((await pool.query("SELECT total_pulls FROM summon_state WHERE player_id=$1",[p.g.player_id])).rows[0].total_pulls),40);
  // Guarantee boundary: never 3 pulls in a row without hero_f.
  let gap=0,maxGap=0;for(const x of all){if(x.hero_id==='hero_f'&&!x.shards)gap=0;else gap++;maxGap=Math.max(maxGap,gap);}assert.ok(maxGap<=2,'guarantee every 3 pulls, gap '+maxGap);
  assert.ok(all.some(x=>x.guaranteed),'some pulls were forced by the guarantee');
  const heroes=(await p.get('/v1/heroes')).heroes.length,nonShard=all.filter(x=>!x.shards).length;assert.equal(heroes,8+nonShard,'every hero pull is an instance');
  const shards=all.filter(x=>x.shards).length*5;assert.equal(await p.bal('shard_hero_c'),shards);
  // Shards: assemble once per 10, shortage refused.
  await p.give('shard_hero_c',20);
  const before=await p.bal('shard_hero_c');
  r=await p.post('/v1/summon/assemble',{request_id:randomUUID(),pool_id:'pool_main',hero_id:'hero_c'});assert.equal(r.statusCode,200);assert.equal(await p.bal('shard_hero_c'),before-10);
  assert.equal((await p.post('/v1/summon/assemble',{request_id:randomUUID(),pool_id:'pool_main',hero_id:'hero_a'})).json().error.message,'NO_SHARDS_FOR_HERO');
  const poor=await player(api);await poor.get('/v1/heroes');
  assert.equal((await poor.post('/v1/summon/assemble',{request_id:randomUUID(),pool_id:'pool_main',hero_id:'hero_c'})).json().error.code,'INSUFFICIENT_BALANCE');
  // Content change: counter is kept; a smaller `every` makes the next pull guaranteed.
  const fresh=await player(api);await fresh.get('/v1/heroes');await fresh.give('gems',100);
  await pool.query("INSERT INTO summon_state(player_id,pool_id,since_guarantee) VALUES($1,'pool_main',4)",[fresh.g.player_id]);
  await publish(economyContent({pool:{guarantee:{every:5,hero_ids:['hero_f']}}}));
  assert.equal((await fresh.get('/v1/summon')).pools[0].guarantee.pulls_left,1);
  r=await fresh.post('/v1/summon',{request_id:randomUUID(),pool_id:'pool_main',count:1});assert.deepEqual([r.json().last[0].hero_id,r.json().last[0].guaranteed],['hero_f',true]);
 }finally{await api.close();}
});

test('S29 AFK: server time only, 12 h cap (+VIP hours), claim once, parallel claims, progress and version changes split the interval',{timeout:120000},async()=>{
 const api=await buildApp(pool);await api.ready();try{
  await publish(economyContent());const p=await player(api);const h=await p.get('/v1/heroes');
  let a=await p.get('/v1/afk','afk');assert.deepEqual(a.per_hour,{gold:3600,hero_exp:360});assert.equal(a.cap_hours,12);
  await shift(p.g.player_id,1);a=await p.get('/v1/afk');assert.ok(a.accrued.gold>=3600,'window started at the first look, not at the first claim');
  let r=await p.post('/v1/afk/claim',{request_id:randomUUID()});assert.equal(r.statusCode,200);assert.ok(r.json().claimed.gold>=3600);
  await shift(p.g.player_id,2);
  a=await p.get('/v1/afk','afk');assert.ok(a.accrued.gold>=7200&&a.accrued.gold<7260,JSON.stringify(a.accrued));
  const id=randomUUID(),gold0=await p.bal('gold');
  const [c1,c2]=await Promise.all([p.post('/v1/afk/claim',{request_id:id}),p.post('/v1/afk/claim',{request_id:randomUUID()})]);
  const got=[c1.json().claimed.gold??0,c2.json().claimed.gold??0].sort((x,y)=>y-x);assert.ok(got[0]>=7200&&got[1]<10,'second parallel claim gets only seconds: '+got);
  assert.deepEqual((await p.post('/v1/afk/claim',{request_id:id})).json(),c1.json(),'same request_id replays');
  assert.equal(await p.bal('gold'),gold0+got[0]+got[1]);
  // Cap: 20 h away → 12 h.
  await p.post('/v1/afk/claim',{request_id:randomUUID()});await shift(p.g.player_id,20);
  a=await p.get('/v1/afk');assert.equal(a.accrued.gold,43200);assert.equal(a.accrued_ms,12*3600000);
  // VIP afk_hours raises the cap (VIP 2 = +2 h).
  await p.give('vip_points',500);a=await p.get('/v1/afk');assert.equal(a.cap_hours,14);
  await p.post('/v1/afk/claim',{request_id:randomUUID()});
  // Progress: 1 h at the old rate, the win closes the segment, then 1 h at +50%.
  await shift(p.g.player_id,1);
  assert.equal(await win(api,p,'stage_one',[h.main[0]]),'attacker_win');
  await shift(p.g.player_id,1);
  a=await p.get('/v1/afk');assert.deepEqual(a.per_hour,{gold:5400,hero_exp:540});
  assert.ok(Math.abs(a.accrued.gold-(3600+5400))<120,'1 h old + 1 h new rate: '+a.accrued.gold);
  // New version published 1 h ago, segment started 3 h ago: 2 h old rate + 1 h new.
  await p.post('/v1/afk/claim',{request_id:randomUUID()});await shift(p.g.player_id,3);
  await publish(economyContent({afk:{per_hour:[{currency:'gold',amount:36000}],stage_bonus_bp:0}}),{releasedHoursAgo:1});
  a=await p.get('/v1/afk','afk');assert.deepEqual(a.per_hour,{gold:36000});
  assert.ok(Math.abs(a.accrued.gold-(2*5400+36000))<200,'split at publication time: '+a.accrued.gold);
  assert.equal(a.accrued.hero_exp,1080,'old-rate exp kept for the 2 h before the change');
 }finally{await api.close();}
});
