import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance} from 'fastify';
import {randomInt,randomUUID} from 'node:crypto';
import {transaction} from './db.ts';
import {authorize,bearer,lockAuthorized,requireBody} from './auth.ts';
import {currentPointer} from './content.ts';
import {applyDeltaTx} from './economy.ts';
import {grantHero} from './heroes.ts';
import {DomainError} from './errors.ts';
import {tableOf,vipLevel,freeDays,summonOdds,pull,afkRate,accrue,payable,AFK_BASE_HOURS,HOUR_MS} from '../../../packages/battle-core/economy.mjs';

/**
 * S25 VIP + tutorial, S27 summon, S29 AFK (ADR 0022). Every grant/spend goes
 * through the ledger with a deterministic key; time is the database clock; the
 * client sends only intents (request_id), never amounts, levels or results.
 */
type Db=Pool|PoolClient;
const conflict=(detail:string)=>new DomainError('CONFLICT',409,detail);
const UFA_DAY="(clock_timestamp() AT TIME ZONE 'Asia/Yekaterinburg')::date";
async function world(db:Db){const v=await currentPointer(db as Pool);if(!v)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');return v;}
async function lockPlayer(c:PoolClient,token:string){const s=await lockAuthorized(c,token);await c.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[s.player_id]);return s.player_id as string;}
const balance=async(db:Db,playerId:string,currency:string)=>Number((await db.query('SELECT amount FROM balances WHERE player_id=$1 AND currency=$2',[playerId,currency])).rows[0]?.amount??0);
const balances=async(db:Db,playerId:string)=>Object.fromEntries((await db.query('SELECT currency,amount FROM balances WHERE player_id=$1',[playerId])).rows.map(r=>[r.currency,Number(r.amount)]));
const keyed=async(db:Db,playerId:string,key:string)=>(await db.query('SELECT 1 FROM ledger WHERE player_id=$1 AND idempotency_key=$2',[playerId,key])).rowCount!>0;

// ---------- VIP and tutorial (S25) ----------
async function tutorialSteps(db:Db,playerId:string,content:any){
 const has=(kind:string)=>content.entities.some((e:any)=>e.kind===kind);
 const steps=[{id:'first_win',name:'Победи в первом бою кампании',done:(await db.query('SELECT 1 FROM campaign_progress WHERE player_id=$1 LIMIT 1',[playerId])).rowCount!>0}];
 if(has('progression')){
  steps.push({id:'level_up',name:'Повысь уровень героя',done:(await db.query('SELECT 1 FROM player_heroes WHERE player_id=$1 AND consumed_at IS NULL AND level>1 LIMIT 1',[playerId])).rowCount!>0});
  if(has('item'))steps.push({id:'equip',name:'Надень предмет на героя',done:(await db.query('SELECT 1 FROM player_items WHERE player_id=$1 AND equipped_on IS NOT NULL LIMIT 1',[playerId])).rowCount!>0});
 }
 return steps;
}
async function winPointsToday(db:Db,playerId:string){
 return Number((await db.query(`SELECT COALESCE(sum(delta),0) AS n FROM ledger WHERE player_id=$1 AND reason='vip_win' AND (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date=${UFA_DAY}`,[playerId])).rows[0].n);
}
async function vipView(db:Db,playerId:string,content:any){
 const vip=tableOf(content,'vip');if(!vip)throw conflict('VIP_DISABLED');
 const points=await balance(db,playerId,'vip_points'),lv=vipLevel(vip,points),days=freeDays(vip);
 const today=(await db.query(`SELECT ${UFA_DAY}::text AS d`)).rows[0].d;
 return {api_version:1,points,level:lv.level,next_points:lv.next_points,afk_hours:lv.afk_hours,
  levels:vip.levels.map((l:any,i:number)=>({level:i+1,points:l.points,perks_text:l.perks_text??'',afk_hours:l.afk_hours??0,free_days:days[i]})),
  daily:{points:vip.daily_points,available:vip.daily_points>0&&!await keyed(db,playerId,`vip:daily:${today}`)},
  wins:{points:vip.win_points??0,today:await winPointsToday(db,playerId),cap:vip.win_points_daily_cap??0},
  tutorial:{points:vip.tutorial_points,claimed:await keyed(db,playerId,'tutorial:vip:once'),steps:await tutorialSteps(db,playerId,content)},
  proposed:vip.proposed??false};
}
/** Called in the winning battle step: renewable VIP points, capped per Ufa day. */
export async function grantWinVip(c:PoolClient,row:{id:string;player_id:string;content_version:string}){
 const content=(await c.query('SELECT content FROM content_versions WHERE content_version=$1',[row.content_version])).rows[0]?.content;
 const vip=tableOf(content,'vip');if(!vip?.win_points||!vip.win_points_daily_cap)return;
 const room=vip.win_points_daily_cap-await winPointsToday(c,row.player_id),amount=Math.min(vip.win_points,room);
 if(amount>0)await applyDeltaTx(c,{playerId:row.player_id,currency:'vip_points',delta:amount,reason:'vip_win',sourceId:row.id,key:`vip:win:${row.id}`});
}

// ---------- AFK (S29) ----------
type AfkState={window_started_at:number;segment_at:number;accrued_ms:number;units:Record<string,number>;rate:Record<string,number>;rate_version:string;rate_cleared:number};
const nowMs=async(db:Db)=>Number((await db.query('SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint AS t')).rows[0].t);
const cleared=async(db:Db,playerId:string)=>Number((await db.query('SELECT count(*)::int AS n FROM campaign_progress WHERE player_id=$1',[playerId])).rows[0].n);
async function capMs(db:Db,playerId:string,content:any){return (AFK_BASE_HOURS+vipLevel(tableOf(content,'vip'),await balance(db,playerId,'vip_points')).afk_hours)*HOUR_MS;}
async function loadAfk(db:Db,playerId:string):Promise<AfkState|null>{
 const r=(await db.query('SELECT (extract(epoch FROM window_started_at)*1000)::bigint AS w,(extract(epoch FROM segment_at)*1000)::bigint AS s,accrued_ms,units,rate,rate_version,rate_cleared FROM afk_state WHERE player_id=$1',[playerId])).rows[0];
 return r?{window_started_at:Number(r.w),segment_at:Number(r.s),accrued_ms:Number(r.accrued_ms),units:r.units,rate:r.rate,rate_version:r.rate_version,rate_cleared:r.rate_cleared}:null;
}
/**
 * Brings the AFK window to `now`. A new content version takes effect from its
 * publication time; progress changes are settled at the win itself (see
 * settleAfkBeforeProgress), so the past is never recomputed with a new rate.
 */
async function settleAfk(db:Db,playerId:string,version:{content_version:string;content:any}):Promise<{state:AfkState;now:number}>{
 const now=await nowMs(db),afk=tableOf(version.content,'afk'),cap=await capMs(db,playerId,version.content),count=await cleared(db,playerId);
 let state=await loadAfk(db,playerId);
 if(!state)return {state:{window_started_at:now,segment_at:now,accrued_ms:0,units:{},rate:afkRate(afk,count),rate_version:version.content_version,rate_cleared:count},now};
 if(state.rate_version!==version.content_version){
  const released=(await db.query('SELECT (extract(epoch FROM max(r.created_at))*1000)::bigint AS t FROM content_releases r JOIN content_versions v ON v.id=r.to_version_id WHERE v.content_version=$1',[version.content_version])).rows[0].t;
  const switchAt=released===null?now:Math.min(now,Math.max(state.segment_at,Number(released)));
  state={...accrue(state,switchAt,cap),rate:afkRate(afk,count),rate_version:version.content_version,rate_cleared:count};
 }else if(state.rate_cleared!==count)state={...accrue(state,now,cap),rate:afkRate(afk,count),rate_cleared:count};
 return {state:accrue(state,now,cap),now};
}
async function saveAfk(c:PoolClient,playerId:string,s:AfkState){
 await c.query(`INSERT INTO afk_state(player_id,window_started_at,segment_at,accrued_ms,units,rate,rate_version,rate_cleared) VALUES($1,to_timestamp($2/1000.0),to_timestamp($3/1000.0),$4,$5,$6,$7,$8)
  ON CONFLICT (player_id) DO UPDATE SET window_started_at=EXCLUDED.window_started_at,segment_at=EXCLUDED.segment_at,accrued_ms=EXCLUDED.accrued_ms,units=EXCLUDED.units,rate=EXCLUDED.rate,rate_version=EXCLUDED.rate_version,rate_cleared=EXCLUDED.rate_cleared`,
 [playerId,s.window_started_at,s.segment_at,s.accrued_ms,JSON.stringify(s.units),JSON.stringify(s.rate),s.rate_version,s.rate_cleared]);
}
/** Called before a first clear is recorded: the old rate runs until this moment. */
export async function settleAfkBeforeProgress(c:PoolClient,playerId:string){
 if(!await loadAfk(c,playerId))return;
 const version=await currentPointer(c as any);if(!version||!tableOf(version.content,'afk'))return;
 const {state}=await settleAfk(c,playerId,version);
 // The stage being recorded counts from this moment on.
 const count=state.rate_cleared+1;
 await saveAfk(c,playerId,{...state,rate:afkRate(tableOf(version.content,'afk'),count),rate_cleared:count});
}
async function afkView(db:Db,playerId:string,version:any,claimed:Record<string,number>|null=null){
 const afk=tableOf(version.content,'afk');if(!afk)throw conflict('AFK_DISABLED');
 const {state,now}=await settleAfk(db,playerId,version);
 return {view:{api_version:1,per_hour:state.rate,accrued:payable(state.units),accrued_ms:state.accrued_ms,cap_hours:(await capMs(db,playerId,version.content))/HOUR_MS,
  window_started_at:new Date(state.window_started_at).toISOString(),server_time:new Date(now).toISOString(),claimed,proposed:afk.proposed??false},state,now};
}

// ---------- Summon (S27) ----------
async function summonView(db:Db,playerId:string,version:any,last:any[]|null=null){
 const content=version.content,byId=new Map<string,any>(content.entities.map((e:any)=>[e.id,e])),name=(id:string)=>byId.get(id)?.name??id;
 const pools=content.entities.filter((e:any)=>e.kind==='summon_pool');if(!pools.length)throw conflict('SUMMON_DISABLED');
 const state=new Map((await db.query('SELECT pool_id,since_guarantee FROM summon_state WHERE player_id=$1',[playerId])).rows.map(r=>[r.pool_id,r.since_guarantee]));
 const all=await balances(db,playerId);
 return {api_version:1,content_version:version.content_version,balances:all,
  pools:pools.map((p:any)=>({id:p.id,name:p.name,description:p.data.description??'',cost:p.data.cost,odds:summonOdds(p.data).map((o:any)=>({...o,name:name(o.hero_id)})),
   guarantee:p.data.guarantee?{every:p.data.guarantee.every,hero_names:p.data.guarantee.hero_ids.map(name),pulls_left:Math.max(1,p.data.guarantee.every-(Number(state.get(p.id)??0)))}:null,
   shards_per_hero:p.data.shards_per_hero??null,proposed:p.data.proposed??false})),
  shards:Object.entries(all).filter(([c,n])=>c.startsWith("shard_")&&Number(n)>0).map(([c,n])=>({hero_id:c.slice(6),name:name(c.slice(6)),amount:Number(n)})),
  last};
}

export async function registerEconomy(app:FastifyInstance,pool:Pool){
 const tx=<T>(request:any,work:(c:PoolClient,playerId:string,version:any)=>Promise<T>)=>transaction(pool,async c=>{const playerId=await lockPlayer(c,bearer(request));return work(c,playerId,await world(c));});
 const limited={config:{rateLimit:{max:60,timeWindow:60000}}};

 app.get('/v1/vip',async request=>{const s=await authorize(pool,bearer(request));return vipView(pool,s.player_id,(await world(pool)).content);});
 app.post('/v1/vip/daily',limited,async request=>{requireBody('vip_claim_request',request.body);return tx(request,async(c,playerId,v)=>{
  const vip=tableOf(v.content,'vip');if(!vip)throw conflict('VIP_DISABLED');if(!vip.daily_points)throw conflict('DAILY_DISABLED');
  const today=(await c.query(`SELECT ${UFA_DAY}::text AS d`)).rows[0].d;
  if(await keyed(c,playerId,`vip:daily:${today}`))throw conflict('ALREADY_CLAIMED_TODAY');
  await applyDeltaTx(c,{playerId,currency:'vip_points',delta:vip.daily_points,reason:'vip_daily',sourceId:today,key:`vip:daily:${today}`});
  return vipView(c,playerId,v.content);
 });});
 app.post('/v1/tutorial/claim',limited,async request=>{requireBody('vip_claim_request',request.body);return tx(request,async(c,playerId,v)=>{
  const vip=tableOf(v.content,'vip');if(!vip)throw conflict('VIP_DISABLED');
  if(await keyed(c,playerId,'tutorial:vip:once'))throw conflict('TUTORIAL_ALREADY_CLAIMED');
  if((await tutorialSteps(c,playerId,v.content)).some(s=>!s.done))throw conflict('TUTORIAL_NOT_FINISHED');
  if(vip.tutorial_points>0)await applyDeltaTx(c,{playerId,currency:'vip_points',delta:vip.tutorial_points,reason:'tutorial_vip',sourceId:'tutorial',key:'tutorial:vip:once'});
  return vipView(c,playerId,v.content);
 });});

 // The first look at AFK starts the window (server time), so income runs from the first visit.
 app.get('/v1/afk',async request=>{const s=await authorize(pool,bearer(request));const v=await world(pool);
  if(tableOf(v.content,'afk')&&!await loadAfk(pool,s.player_id))await transaction(pool,async c=>{await c.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[s.player_id]);if(!await loadAfk(c,s.player_id)){const {state}=await settleAfk(c,s.player_id,v);await saveAfk(c,s.player_id,state);}});
  return (await afkView(pool,s.player_id,v)).view;});
 app.post('/v1/afk/claim',limited,async request=>{const b=request.body as any;requireBody('afk_claim_request',b);return tx(request,async(c,playerId,v)=>{
  const old=(await c.query('SELECT response FROM afk_claims WHERE player_id=$1 AND request_id=$2',[playerId,b.request_id])).rows[0];if(old)return old.response;
  const {state,now}=await afkView(c,playerId,v);
  const pay=payable(state.units),units={...state.units};
  for(const [currency,amount] of Object.entries(pay))if(amount>0){
   await applyDeltaTx(c,{playerId,currency,delta:amount,reason:'afk_claim',sourceId:b.request_id,key:`afk:${b.request_id}:${currency}`});
   units[currency]-=amount*HOUR_MS;
  }
  await saveAfk(c,playerId,{...state,units,accrued_ms:0,window_started_at:now,segment_at:now});
  const response=(await afkView(c,playerId,v,Object.fromEntries(Object.entries(pay).filter(([,n])=>n>0)))).view;
  await c.query('INSERT INTO afk_claims(player_id,request_id,response) VALUES($1,$2,$3)',[playerId,b.request_id,response]);
  return response;
 });});

 app.get('/v1/summon',async request=>{const s=await authorize(pool,bearer(request));return summonView(pool,s.player_id,await world(pool));});
 app.post('/v1/summon',limited,async request=>{const b=request.body as any;requireBody('summon_request',b);return tx(request,async(c,playerId,v)=>{
  const saved=(await c.query('SELECT results,pool_id,pull_count FROM summon_pulls WHERE player_id=$1 AND request_id=$2',[playerId,b.request_id])).rows[0];
  if(saved){if(saved.pool_id!==b.pool_id||saved.pull_count!==b.count)throw conflict('REQUEST_ID_REUSED');return summonView(c,playerId,v,saved.results);}
  const p=v.content.entities.find((e:any)=>e.id===b.pool_id&&e.kind==='summon_pool');if(!p)throw conflict('POOL_UNKNOWN');
  const byId=new Map<string,any>(v.content.entities.map((e:any)=>[e.id,e]));
  await applyDeltaTx(c,{playerId,currency:p.data.cost.currency,delta:-p.data.cost.amount*b.count,reason:'summon',sourceId:p.id,key:`summon:${b.request_id}`});
  await c.query('INSERT INTO summon_state(player_id,pool_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[playerId,p.id]);
  let since=Number((await c.query('SELECT since_guarantee FROM summon_state WHERE player_id=$1 AND pool_id=$2 FOR UPDATE',[playerId,p.id])).rows[0].since_guarantee);
  const results:any[]=[];
  for(let i=0;i<b.count;i++){
   const r=pull(p.data,since,(n:number)=>randomInt(n));since=r.since;
   let instance:string|null=null;
   if(r.entry.shards)await applyDeltaTx(c,{playerId,currency:`shard_${r.entry.hero_id}`,delta:r.entry.shards,reason:'summon',sourceId:p.id,key:`summon:${b.request_id}:${i}`});
   else{const key=`summon:${b.request_id}:${i}`;await grantHero(c,playerId,r.entry.hero_id,key);instance=(await c.query('SELECT id FROM player_heroes WHERE player_id=$1 AND source_key=$2',[playerId,key])).rows[0]?.id??null;}
   results.push({hero_id:r.entry.hero_id,name:byId.get(r.entry.hero_id)?.name??r.entry.hero_id,shards:r.entry.shards??null,guaranteed:r.guaranteed,new_instance_id:instance});
  }
  await c.query('UPDATE summon_state SET since_guarantee=$3,total_pulls=total_pulls+$4 WHERE player_id=$1 AND pool_id=$2',[playerId,p.id,since,b.count]);
  await c.query('INSERT INTO summon_pulls(id,player_id,request_id,pool_id,content_version,pull_count,results) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),playerId,b.request_id,p.id,v.content_version,b.count,JSON.stringify(results)]);
  return summonView(c,playerId,v,results);
 });});
 app.post('/v1/summon/assemble',limited,async request=>{const b=request.body as any;requireBody('summon_assemble_request',b);return tx(request,async(c,playerId,v)=>{
  const key=`assemble:${b.request_id}`;
  if(!await keyed(c,playerId,key)){
   const p=v.content.entities.find((e:any)=>e.id===b.pool_id&&e.kind==='summon_pool');if(!p?.data.shards_per_hero)throw conflict('POOL_UNKNOWN');
   if(!p.data.entries.some((x:any)=>x.hero_id===b.hero_id&&x.shards))throw conflict('NO_SHARDS_FOR_HERO');
   await applyDeltaTx(c,{playerId,currency:`shard_${b.hero_id}`,delta:-p.data.shards_per_hero,reason:'assemble',sourceId:b.hero_id,key});
   await grantHero(c,playerId,b.hero_id,key);
  }
  return summonView(c,playerId,v);
 });});
}
