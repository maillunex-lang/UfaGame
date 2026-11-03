import type {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {Worker} from 'node:worker_threads';
import {randomInt,randomUUID} from 'node:crypto';
import {DomainError} from './errors.ts';
import {authorize,bearer,requireBody} from './auth.ts';
import {currentPointer} from './content.ts';

const WORKER=new URL('./battle-worker.mjs',import.meta.url);
const TIMEOUT_MS=5000;
let running=0;
const MAX_PARALLEL=2;

/** Computes a battle in a worker thread with memory/time limits (protects the API loop). */
export function computeBattle(content:any,request:any):Promise<any>{
 if(running>=MAX_PARALLEL)return Promise.reject(new DomainError('SERVICE_UNAVAILABLE',503,'BATTLE_BUSY'));
 running++;
 return new Promise<any>((resolve,reject)=>{
  const worker=new Worker(WORKER,{workerData:{content,request},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:32}});
  let settled=false;
  const done=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);running--;void worker.terminate();fn();};
  const timer=setTimeout(()=>done(()=>reject(new DomainError('SERVICE_UNAVAILABLE',503,'BATTLE_TIMEOUT'))),TIMEOUT_MS);
  worker.once('message',message=>done(()=>{
   if(message.ok)resolve(message.result);
   else if(message.code==='BATTLE_FAILED')reject(new Error('Battle worker failed'));
   else reject(new DomainError('INVALID_REQUEST',422,message.entity_id?`${message.code}:${message.entity_id}`:message.code));
  }));
  worker.once('error',error=>done(()=>reject(error)));
  worker.once('exit',code=>done(()=>reject(new Error('Battle worker exited '+code))));
 });
}

const record=(row:any,result:any)=>({api_version:1,battle_id:row.id,content_version:row.content_version,stage_id:row.stage_id,rewards:[],...result});

/**
 * Player battles (S17): the server picks the seed, pins the published content
 * version and stores the outcome. The client sends only the stage and heroes and
 * can never submit a result. No rewards are granted yet (campaign: S22/S23).
 */
export async function registerBattles(app:FastifyInstance,pool:Pool){
 app.post('/v1/battles',{config:{rateLimit:{max:30,timeWindow:60000}}},async request=>{
  const session=await authorize(pool,bearer(request));const b=request.body as any;requireBody('battle_start_request',b);
  const old=(await pool.query('SELECT * FROM battles WHERE player_id=$1 AND request_id=$2',[session.player_id,b.request_id])).rows[0];
  if(old){
   if(old.stage_id!==b.stage_id||JSON.stringify(old.hero_ids)!==JSON.stringify(b.hero_ids))throw new DomainError('CONFLICT',409);
   return replay(old);
  }
  const version=await currentPointer(pool);
  if(!version)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');
  const stage=version.content.entities.find((e:any)=>e.id===b.stage_id&&e.kind==='stage');
  if(!stage)throw new DomainError('INVALID_REQUEST',422,`UNKNOWN_STAGE:${b.stage_id}`);
  const seed=randomInt(0,4294967296);
  const result=await computeBattle(version.content,{attacker_hero_ids:b.hero_ids,stage_id:b.stage_id,seed});
  const id=randomUUID();
  const row=(await pool.query('INSERT INTO battles(id,player_id,request_id,content_version,stage_id,hero_ids,seed,result,steps,event_log_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (player_id,request_id) DO NOTHING RETURNING *',[id,session.player_id,b.request_id,version.content_version,b.stage_id,b.hero_ids,seed,result.result,result.steps,result.event_log_sha256])).rows[0];
  if(!row){
   // A concurrent retry with the same request_id won the insert: return its battle.
   const winner=(await pool.query('SELECT * FROM battles WHERE player_id=$1 AND request_id=$2',[session.player_id,b.request_id])).rows[0];
   if(winner.stage_id!==b.stage_id||JSON.stringify(winner.hero_ids)!==JSON.stringify(b.hero_ids))throw new DomainError('CONFLICT',409);
   return replay(winner);
  }
  return record(row,result);
 });
 app.get('/v1/battles/:id',async request=>{
  const session=await authorize(pool,bearer(request));const id=(request.params as any).id;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new DomainError('INVALID_REQUEST');
  const row=(await pool.query('SELECT * FROM battles WHERE id=$1 AND player_id=$2',[id,session.player_id])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);
  return replay(row);
 });
 /** Recomputes the stored battle from its pinned version and seed; the hash must match. */
 async function replay(row:any){
  const content=(await pool.query('SELECT content FROM content_versions WHERE content_version=$1',[row.content_version])).rows[0].content;
  const result=await computeBattle(content,{attacker_hero_ids:row.hero_ids,stage_id:row.stage_id,seed:Number(row.seed)});
  if(result.event_log_sha256!==row.event_log_sha256||result.result!==row.result)throw new DomainError('INTERNAL_ERROR',500,'REPLAY_MISMATCH');
  return record(row,result);
 }
}
