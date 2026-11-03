import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance} from 'fastify';
import {campaignStages} from '@ufagame/contracts';
import {DomainError} from './errors.ts';
import {authorize,bearer} from './auth.ts';
import {currentPointer} from './content.ts';
import {applyDeltaTx} from './economy.ts';
import {grantHero,grantItem} from './heroes.ts';
import {settleAfkBeforeProgress} from './economy-routes.ts';

type Querier=Pool|PoolClient;
const cleared=async(db:Querier,playerId:string)=>new Map<string,string>((await db.query('SELECT stage_id,battle_id FROM campaign_progress WHERE player_id=$1',[playerId])).rows.map(r=>[r.stage_id,r.battle_id]));

/**
 * Linear access (S22): the first campaign stage is open; any other stage opens when
 * the previous one is cleared. Stages outside chapters are free training (no
 * progress, no rewards). Attempts are free: losing changes nothing.
 */
export function stageStatus(content:any,done:Map<string,string>,stageId:string):'cleared'|'open'|'locked'|'training'{
 const order:{stage_id:string}[]=campaignStages(content),index=order.findIndex(s=>s.stage_id===stageId);
 if(index<0)return 'training';
 if(done.has(stageId))return 'cleared';
 return index===0||done.has(order[index-1].stage_id)?'open':'locked';
}

/** Refuses to start a locked campaign stage (called before a live battle is created). */
export async function assertStageOpen(db:Querier,playerId:string,content:any,stageId:string){
 if(stageStatus(content,await cleared(db,playerId),stageId)==='locked')throw new DomainError('CONFLICT',409,'STAGE_LOCKED');
}

/**
 * Called in the same transaction as the winning battle step. Records the first
 * clear and pays the stage's first-clear rewards from the battle's pinned content
 * version; a repeat win, a duplicate tick or a race pays nothing (PK + ledger key).
 */
export async function recordWin(c:PoolClient,row:{id:string;player_id:string;stage_id:string;content_version:string}){
 const content=(await c.query('SELECT content FROM content_versions WHERE content_version=$1',[row.content_version])).rows[0]?.content;
 if(!content||stageStatus(content,new Map(),row.stage_id)==='training')return;
 // AFK income speed depends on progress: close the running segment first (S29).
 if(!(await c.query('SELECT 1 FROM campaign_progress WHERE player_id=$1 AND stage_id=$2',[row.player_id,row.stage_id])).rowCount)await settleAfkBeforeProgress(c,row.player_id);
 const inserted=(await c.query('INSERT INTO campaign_progress(player_id,stage_id,content_version,battle_id) VALUES($1,$2,$3,$4) ON CONFLICT (player_id,stage_id) DO NOTHING RETURNING stage_id',[row.player_id,row.stage_id,row.content_version,row.id])).rowCount;
 if(!inserted)return;
 const stage=content.entities.find((e:any)=>e.id===row.stage_id&&e.kind==='stage');
 for(const reward of stage?.data?.rewards_first??[])
  await applyDeltaTx(c,{playerId:row.player_id,currency:reward.currency,delta:reward.amount,reason:'campaign_first_clear',sourceId:row.stage_id,key:`campaign:first:${row.stage_id}:${reward.currency}`});
 // Hero and item rewards (ADR 0021): one instance each, keyed by stage and position.
 for(const [i,heroId] of (stage?.data?.rewards_first_heroes??[]).entries())await grantHero(c,row.player_id,heroId,`campaign:${row.stage_id}:hero:${i}`);
 for(const [i,itemId] of (stage?.data?.rewards_first_items??[]).entries())await grantItem(c,row.player_id,itemId,`campaign:${row.stage_id}:item:${i}`,content);
}

export async function registerCampaign(app:FastifyInstance,pool:Pool){
 app.get('/v1/campaign',async request=>{
  const auth=await authorize(pool,bearer(request));
  const version=await currentPointer(pool);if(!version)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');
  const content=version.content,done=await cleared(pool,auth.player_id),byId=new Map<string,any>(content.entities.map((e:any)=>[e.id,e]));
  const chapters=content.entities.filter((e:any)=>e.kind==='chapter').sort((a:any,b:any)=>a.data.order-b.data.order).map((ch:any)=>({
   id:ch.id,name:ch.name,order:ch.data.order,location_id:ch.data.location_id??null,proposed:ch.data.proposed??false,
   stages:ch.data.stage_ids.map((id:string)=>{const st=byId.get(id);return {id,name:st.name,boss:st.data.boss??false,status:stageStatus(content,done,id),rewards_first:st.data.rewards_first??[],location_id:st.data.location_id??null,enemy_hero_ids:st.data.enemy_hero_ids,cleared_battle_id:done.get(id)??null,...(st.data.enemy_level?{enemy_level:st.data.enemy_level}:{}),...(st.data.rewards_first_heroes?{rewards_heroes:st.data.rewards_first_heroes.map((h:string)=>byId.get(h)?.name??h)}:{}),...(st.data.rewards_first_items?{rewards_items:st.data.rewards_first_items.map((h:string)=>byId.get(h)?.name??h)}:{})};}),
  }));
  return {api_version:1,content_version:version.content_version,chapters};
 });
}
