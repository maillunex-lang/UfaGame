import type {Pool} from 'pg';
import {Worker} from 'node:worker_threads';
import {randomInt,randomUUID} from 'node:crypto';
import {transaction} from './db.ts';
import {authorize,lockAuthorized,requireBody} from './auth.ts';
import {currentPointer} from './content.ts';
import {assertStageOpen,recordWin} from './campaign.ts';
import {DomainError} from './errors.ts';
import {createLiveBattle,queueLiveCommand,advanceLiveBattle,disconnectLiveBattle,LATE_STEPS} from '../../../packages/battle-core/live.mjs';

const MAX_ACTIVE=16;
const workerUrl=new URL('./live-battle-worker.mjs',import.meta.url);
let workers=0;
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function compile(content:any,request:any):Promise<any>{
 if(workers>=2)return Promise.reject(new DomainError('SERVICE_UNAVAILABLE',503,'BATTLE_BUSY'));
 workers++;
 return new Promise((resolve,reject)=>{
  let worker:Worker;
  try{worker=new Worker(workerUrl,{workerData:{content,request},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:32}});}
  catch{workers--;reject(new Error('Battle worker failed to start'));return;}
  let done=false;const finish=(error?:Error,value?:any)=>{if(done)return;done=true;clearTimeout(timer);workers--;void worker.terminate();if(error)reject(error);else resolve(value);};
  const timer=setTimeout(()=>finish(new DomainError('SERVICE_UNAVAILABLE',503,'BATTLE_TIMEOUT')),5000);
  worker.once('message',(message:any)=>{if(message.ok)finish(undefined,message.compiled);else if(message.code==='BATTLE_FAILED')finish(new Error('Battle setup failed'));else finish(new DomainError('INVALID_REQUEST',422,message.entity_id?`${message.code}:${message.entity_id}`:message.code));});
  worker.once('error',()=>finish(new Error('Battle setup failed')));worker.once('exit',()=>finish(new Error('Battle worker stopped')));
 });
}
function view(s:any){return {api_version:1,battle_id:s.battle_id,content_version:s.content_version,heroes:s.heroes,step:s.state.step,auto:s.auto,last_command_seq:s.last_command_seq,event_seq:s.event_seq,result:s.state.result,actors:s.state.actors.map((a:any)=>({id:a.id,team:a.team,slot:a.slot,hp:a.hp,max_hp:a.max_hp,x:a.x,y:a.y,energy:a.energy}))};}
function match(row:any,body:any){return row.stage_id===body.stage_id&&JSON.stringify(row.hero_ids)===JSON.stringify(body.hero_ids);}
export async function startLiveBattle(pool:Pool,token:string,body:any){
 requireBody('battle_start_request',body);const auth=await authorize(pool,token);
 const existing=(await pool.query('SELECT * FROM live_battles WHERE player_id=$1 AND request_id=$2',[auth.player_id,body.request_id])).rows[0];
 if(existing){if(!match(existing,body))throw new DomainError('CONFLICT',409);return view(existing.session_state);}
 const version=await currentPointer(pool);if(!version)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');
 await assertStageOpen(pool,auth.player_id,version.content,body.stage_id);
 const seed=randomInt(0,4294967296),compiled=await compile(version.content,{attacker_hero_ids:body.hero_ids,stage_id:body.stage_id,seed});
 const id=randomUUID(),initial=createLiveBattle({battleId:id,contentVersion:version.content_version,setup:compiled.setup,heroes:compiled.heroes,auto:false});
 return transaction(pool,async c=>{
  const locked=await lockAuthorized(c,token);await c.query('SELECT pg_advisory_xact_lock(783112)');
  const old=(await c.query('SELECT * FROM live_battles WHERE player_id=$1 AND request_id=$2',[locked.player_id,body.request_id])).rows[0];
  if(old){if(!match(old,body))throw new DomainError('CONFLICT',409);return view(old.session_state);}
  const usage=(await c.query('SELECT count(*)::integer AS n FROM live_battles WHERE completed_at IS NULL')).rows[0].n;
  if(usage>=MAX_ACTIVE)throw new DomainError('SERVICE_UNAVAILABLE',503,'BATTLE_BUSY');
  try{await c.query("INSERT INTO live_battles(id,player_id,request_id,content_version,stage_id,hero_ids,session_state,next_tick_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '1 second')",[id,locked.player_id,body.request_id,version.content_version,body.stage_id,body.hero_ids,initial]);}
  catch(error){if((error as any).code==='23505')throw new DomainError('CONFLICT',409,'ACTIVE_BATTLE_EXISTS');throw error;}
  return view(initial);
 });
}
export async function liveSnapshot(pool:Pool,token:string,id:string){
 if(!validId(id))throw new DomainError('INVALID_REQUEST');const auth=await authorize(pool,token);
 const row=(await pool.query('SELECT session_state FROM live_battles WHERE id=$1 AND player_id=$2',[id,auth.player_id])).rows[0];
 if(!row)throw new DomainError('NOT_FOUND',404);return view(row.session_state);
}
export async function submitLive(pool:Pool,token:string,id:string,connectionId:string,command:any){
 if(!validId(id)||!validId(connectionId))throw new DomainError('INVALID_REQUEST');requireBody('live_battle_command',command);
 return transaction(pool,async c=>{
  const auth=await lockAuthorized(c,token);
  const row=(await c.query('SELECT session_state,next_tick_at,connection_id,connected_until FROM live_battles WHERE id=$1 AND player_id=$2 FOR UPDATE',[id,auth.player_id])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);
  const serverNow=(await c.query('SELECT clock_timestamp() AS server_wall_time')).rows[0].server_wall_time;
  if(row.connection_id!==connectionId||!row.connected_until||row.connected_until.getTime()<=serverNow.getTime())throw new DomainError('CONFLICT',409,'CONNECTION_REPLACED');
  // First step whose server-clock deadline has not passed yet; a command up to
  // LATE_STEPS late is moved there (mobile lag), older ones are stale.
  const overdue=serverNow.getTime()-row.next_tick_at.getTime();
  const earliestStep=row.session_state.state.step+1+(overdue>=0?Math.floor(overdue/100)+1:0);
  if(!row.session_state.acks.some((item:any)=>item.seq===command.seq)&&Number.isSafeInteger(command?.for_step)&&earliestStep-command.for_step>=LATE_STEPS)throw new DomainError('CONFLICT',409,'STALE_COMMAND');
  let result;try{result=queueLiveCommand(row.session_state,command,{earliestStep});}catch(error){const code=(error as Error).message;throw new DomainError(code==='INVALID_COMMAND'?'INVALID_REQUEST':'CONFLICT',code==='INVALID_COMMAND'?400:409,code);}
  await c.query('UPDATE live_battles SET session_state=$2 WHERE id=$1',[id,result.session]);return result.ack;
 });
}
export async function readFrames(pool:Pool,token:string,id:string,after:number){
 if(!validId(id)||!Number.isSafeInteger(after)||after<0||after>900)throw new DomainError('INVALID_REQUEST');const auth=await authorize(pool,token);
 const exists=(await pool.query('SELECT 1 FROM live_battles WHERE id=$1 AND player_id=$2',[id,auth.player_id])).rowCount;
 if(!exists)throw new DomainError('NOT_FOUND',404);
 return (await pool.query('SELECT frame FROM live_battle_frames WHERE battle_id=$1 AND seq>$2 ORDER BY seq LIMIT 100',[id,after])).rows.map(row=>row.frame);
}
/** Lock one due battle; disconnected battles proceed in auto. Frames and state commit together. */
export async function advanceDue(pool:Pool){
 return transaction(pool,async c=>{
  const row=(await c.query('SELECT *,connected_until>clock_timestamp() AS online FROM live_battles WHERE completed_at IS NULL AND next_tick_at<=clock_timestamp() ORDER BY next_tick_at FOR UPDATE SKIP LOCKED LIMIT 1')).rows[0];
  if(!row)return false;
  const online=row.online===true,current=online?row.session_state:disconnectLiveBattle(row.session_state);
  const next=advanceLiveBattle(current,{forceAuto:!online});
  await c.query('INSERT INTO live_battle_frames(battle_id,seq,frame) VALUES($1,$2,$3)',[row.id,next.frame.seq,next.frame]);
  if(next.session.state.result==='attacker_win')await recordWin(c,row);
  await c.query("UPDATE live_battles SET session_state=$2,next_tick_at=next_tick_at+interval '100 milliseconds',completed_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END WHERE id=$1",[row.id,next.session,next.session.state.result!==null]);
  return true;
 });
}
/** A short DB lease prevents stale sockets from taking over newer connections. */
export async function attachLive(pool:Pool,token:string,id:string,connectionId:string){
 if(!validId(id)||!validId(connectionId))throw new DomainError('INVALID_REQUEST');
 return transaction(pool,async c=>{
  const auth=await lockAuthorized(c,token);
  const row=(await c.query("UPDATE live_battles SET connection_id=$3,connected_until=clock_timestamp()+interval '2 seconds' WHERE id=$1 AND player_id=$2 RETURNING session_state",[id,auth.player_id,connectionId])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);return view(row.session_state);
 });
}
export async function renewLive(pool:Pool,token:string,id:string,connectionId:string){
 const auth=await authorize(pool,token);
 const row=(await pool.query("UPDATE live_battles SET connected_until=clock_timestamp()+interval '2 seconds' WHERE id=$1 AND player_id=$2 AND connection_id=$3 RETURNING session_state",[id,auth.player_id,connectionId])).rows[0];
 if(!row)throw new DomainError('CONFLICT',409,'CONNECTION_REPLACED');return view(row.session_state);
}
export async function detachLive(pool:Pool,id:string,connectionId:string){
 if(!validId(id)||!validId(connectionId))return;
 await pool.query('UPDATE live_battles SET connection_id=NULL,connected_until=NULL WHERE id=$1 AND connection_id=$2',[id,connectionId]);
}
