import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance} from 'fastify';
import {transaction} from './db.ts';
import {authorize,bearer,lockAuthorized,requireBody} from './auth.ts';
import {currentPointer} from './content.ts';
import {applyDeltaTx} from './economy.ts';
import {grantHero} from './heroes.ts';
import {DomainError} from './errors.ts';

/**
 * S30 quests (ADR 0023). Events are written only by the server inside the action's
 * own transaction; the event key makes each event count once. Rewards are paid by
 * server state (progress, period, series) through ledger keys.
 */
type Db=Pool|PoolClient;
const conflict=(detail:string)=>new DomainError('CONFLICT',409,detail);
const UFA_DAY="(clock_timestamp() AT TIME ZONE 'Asia/Yekaterinburg')::date";
export type QuestEvent='battle_win'|'campaign_clear'|'hero_level_up'|'hero_rank_up'|'summon_pull'|'afk_claim'|'item_upgrade';
const today=async(db:Db)=>(await db.query(`SELECT ${UFA_DAY}::text AS d`)).rows[0].d as string;
const periodOf=(q:any,day:string)=>q.data.period==='daily'?day:'';
async function claimedAny(db:Db,playerId:string,questId:string,period:string|null){
 return (await db.query(`SELECT 1 FROM quest_progress WHERE player_id=$1 AND quest_id=$2 AND claimed_at IS NOT NULL${period===null?'':' AND period=$3'}`,period===null?[playerId,questId]:[playerId,questId,period])).rowCount!>0;
}
async function unlocked(db:Db,playerId:string,q:any,byId:Map<string,any>,day:string){
 const req=q.data.requires_quest_id;if(!req)return true;
 const prev=byId.get(req);if(!prev)return false;
 return claimedAny(db,playerId,req,prev.data.period==='daily'?day:'');
}

/** Counts one server event for every matching, unlocked quest (once per event key). */
export async function recordQuestEvent(c:PoolClient,playerId:string,event:QuestEvent,key:string,{stageId,amount=1}:{stageId?:string;amount?:number}={}){
 const version=await currentPointer(c as any);if(!version)return;
 const quests=version.content.entities.filter((e:any)=>e.kind==='quest'&&e.data.event===event&&(e.data.stage_id===undefined||e.data.stage_id===stageId));
 if(!quests.length)return;
 if(!(await c.query('INSERT INTO quest_event_keys(player_id,event_key) VALUES($1,$2) ON CONFLICT DO NOTHING',[playerId,`${event}:${key}`])).rowCount)return;
 const day=await today(c),byId=new Map<string,any>(version.content.entities.map((e:any)=>[e.id,e]));
 for(const q of quests){
  if(!await unlocked(c,playerId,q,byId,day))continue;
  await c.query(`INSERT INTO quest_progress(player_id,quest_id,period,progress) VALUES($1,$2,$3,LEAST($4::int,$5::int)) ON CONFLICT (player_id,quest_id,period) DO UPDATE SET progress=LEAST($5::int,quest_progress.progress+$4::int)`,[playerId,q.id,periodOf(q,day),amount,q.data.target]);
 }
}

async function view(db:Db,playerId:string,content:any,claimed:string|null=null){
 const day=await today(db),byId=new Map<string,any>(content.entities.map((e:any)=>[e.id,e]));
 const rows=new Map((await db.query('SELECT quest_id,period,progress,claimed_at FROM quest_progress WHERE player_id=$1 AND period IN ($2,$3)',[playerId,day,''])).rows.map(r=>[r.quest_id+'|'+r.period,r]));
 const tomorrow=(await db.query(`SELECT ((${UFA_DAY}+1)::timestamp AT TIME ZONE 'Asia/Yekaterinburg') AS t`)).rows[0].t.toISOString();
 const quests=content.entities.filter((e:any)=>e.kind==='quest').sort((a:any,b:any)=>(a.data.order??0)-(b.data.order??0)||a.id.localeCompare(b.id));
 const out=[];
 for(const q of quests){
  const r=rows.get(q.id+'|'+periodOf(q,day)),progress=r?.progress??0;
  const status=r?.claimed_at?'claimed':!await unlocked(db,playerId,q,byId,day)?'locked':progress>=q.data.target?'ready':'active';
  out.push({id:q.id,name:q.name,description:q.data.description??'',period:q.data.period,event:q.data.event,stage_name:q.data.stage_id?byId.get(q.data.stage_id)?.name??null:null,
   target:q.data.target,progress,status,rewards:q.data.rewards,reward_heroes:(q.data.reward_heroes??[]).map((id:string)=>byId.get(id)?.name??id),expires_at:q.data.period==='daily'?tomorrow:null});
 }
 return {api_version:1,quests:out,claimed};
}

export async function registerQuests(app:FastifyInstance,pool:Pool){
 app.get('/v1/quests',async request=>{const s=await authorize(pool,bearer(request));const v=await currentPointer(pool);if(!v)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');return view(pool,s.player_id,v.content);});
 app.post('/v1/quests/claim',{config:{rateLimit:{max:60,timeWindow:60000}}},async request=>{
  const b=request.body as any;requireBody('quest_claim_request',b);
  return transaction(pool,async c=>{
   const s=await lockAuthorized(c,bearer(request));await c.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[s.player_id]);
   const v=await currentPointer(c as any);if(!v)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');
   const byId=new Map<string,any>(v.content.entities.map((e:any)=>[e.id,e])),q=byId.get(b.quest_id);
   if(q?.kind!=='quest')throw conflict('QUEST_UNKNOWN');
   const day=await today(c),period=periodOf(q,day);
   if(!await unlocked(c,s.player_id,q,byId,day))throw conflict('QUEST_LOCKED');
   const row=(await c.query('SELECT progress,claimed_at FROM quest_progress WHERE player_id=$1 AND quest_id=$2 AND period=$3 FOR UPDATE',[s.player_id,q.id,period])).rows[0];
   if(row?.claimed_at)throw conflict('ALREADY_CLAIMED');
   if((row?.progress??0)<q.data.target)throw conflict('QUEST_NOT_COMPLETE');
   const tag=`quest:${q.id}:${period||'once'}`;
   for(const r of q.data.rewards)await applyDeltaTx(c,{playerId:s.player_id,currency:r.currency,delta:r.amount,reason:'quest_reward',sourceId:q.id,key:`${tag}:${r.currency}`});
   for(const [i,heroId] of (q.data.reward_heroes??[]).entries())await grantHero(c,s.player_id,heroId,`${tag}:hero:${i}`);
   await c.query('UPDATE quest_progress SET claimed_at=clock_timestamp() WHERE player_id=$1 AND quest_id=$2 AND period=$3',[s.player_id,q.id,period]);
   return view(c,s.player_id,v.content,q.id);
  });
 });
}
