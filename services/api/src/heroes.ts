import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.ts';
import {authorize,bearer,lockAuthorized,requireBody} from './auth.ts';
import {currentPointer} from './content.ts';
import {applyDeltaTx} from './economy.ts';
import {DomainError} from './errors.ts';
import {progressionOf,levelCost,rankCap,upgradeCost,itemStats,heroStats,effectiveLevels} from '../../../packages/battle-core/progression.mjs';

/**
 * Player heroes and items (S23 levels/ranks, S24 main five + sync, S28 equipment;
 * ADR 0021). Every spending action is guarded by the expected current state
 * (from_level / from_rank / from_upgrade) under a per-player row lock, and pays
 * through the ledger with a key derived from that state, so a double tap or a
 * race never spends twice. The client never sends stats, levels or results.
 */
type Db=Pool|PoolClient;
const conflict=(detail:string)=>new DomainError('CONFLICT',409,detail);

async function content(db:Db){
 const v=await currentPointer(db as Pool);if(!v)throw new DomainError('NOT_FOUND',404,'NO_CONTENT');
 const p=progressionOf(v.content);if(!p)throw conflict('PROGRESSION_DISABLED');
 return {version:v,content:v.content,p,byId:new Map<string,any>(v.content.entities.map((e:any)=>[e.id,e]))};
}
async function lockPlayer(c:PoolClient,token:string){const s=await lockAuthorized(c,token);await c.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[s.player_id]);return s.player_id as string;}
async function load(db:Db,playerId:string){
 const heroes=(await db.query('SELECT id,hero_id,level,rank,protected,created_at FROM player_heroes WHERE player_id=$1 AND consumed_at IS NULL ORDER BY seq',[playerId])).rows;
 const team=(await db.query('SELECT role,slot,instance_id FROM player_team WHERE player_id=$1 ORDER BY role,slot',[playerId])).rows;
 const items=(await db.query('SELECT id,item_id,slot,upgrade,equipped_on FROM player_items WHERE player_id=$1 ORDER BY seq',[playerId])).rows;
 return {heroes,items,main:team.filter(t=>t.role==='main').map(t=>t.instance_id as string),sync:team.filter(t=>t.role==='sync').map(t=>t.instance_id as string)};
}

/** Starter heroes/items once per player (source keys); fills an empty main five. */
export async function grantStarters(c:PoolClient,playerId:string,content:any){
 const p=progressionOf(content);if(!p)return;
 let added=0;
 for(const [i,heroId] of (p.starter_hero_ids??[]).entries())added+=(await c.query('INSERT INTO player_heroes(id,player_id,hero_id,source_key) VALUES($1,$2,$3,$4) ON CONFLICT (player_id,source_key) DO NOTHING',[randomUUID(),playerId,heroId,`starter:hero:${i}:${heroId}`])).rowCount??0;
 for(const [i,itemId] of (p.starter_item_ids??[]).entries())await grantItem(c,playerId,itemId,`starter:item:${i}:${itemId}`,content);
 if(added){
  const team=(await c.query('SELECT 1 FROM player_team WHERE player_id=$1 LIMIT 1',[playerId])).rowCount;
  if(!team){const ids=(await c.query('SELECT id FROM player_heroes WHERE player_id=$1 AND consumed_at IS NULL ORDER BY seq LIMIT 5',[playerId])).rows;
   for(const [slot,row] of ids.entries())await c.query("INSERT INTO player_team(player_id,role,slot,instance_id) VALUES($1,'main',$2,$3)",[playerId,slot,row.id]);}
 }
}
export async function grantHero(c:PoolClient,playerId:string,heroId:string,key:string){
 await c.query('INSERT INTO player_heroes(id,player_id,hero_id,source_key) VALUES($1,$2,$3,$4) ON CONFLICT (player_id,source_key) DO NOTHING',[randomUUID(),playerId,heroId,key]);
}
export async function grantItem(c:PoolClient,playerId:string,itemId:string,key:string,content:any){
 // The slot is copied from content at grant time; validation guarantees a real slot.
 const item=content.entities.find((e:any)=>e.id===itemId&&e.kind==='item');
 if(!item||item.data.slot==='none')return;
 await c.query('INSERT INTO player_items(id,player_id,item_id,slot,source_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT (player_id,source_key) DO NOTHING',[randomUUID(),playerId,itemId,item.data.slot,key]);
}

/** Full state with costs and the rank plan, as the Game shows it. */
export async function heroesView(db:Db,playerId:string,ctx:{version:any;p:any;byId:Map<string,any>}){
 const {p,byId}=ctx,s=await load(db,playerId);
 const eff=effectiveLevels(p,s.heroes,s.main,s.sync),role=new Map<string,[string,number]>();
 s.main.forEach((id,i)=>role.set(id,['main',i]));s.sync.forEach((id,i)=>role.set(id,['sync',i]));
 const balances=Object.fromEntries((await db.query('SELECT currency,amount FROM balances WHERE player_id=$1',[playerId])).rows.map(r=>[r.currency,Number(r.amount)]));
 const itemsOn=(heroId:string)=>s.items.filter(i=>i.equipped_on===heroId);
 const heroes=s.heroes.map(h=>{
  const def=byId.get(h.hero_id),available=def?.kind==='hero'&&!!def.data.combat,[r,slot]=role.get(h.id)??[null,null];
  const level=eff.level(h),cap=rankCap(p,h.rank),next=p.ranks[h.rank+1];
  const free=s.heroes.filter(o=>o.id!==h.id&&o.hero_id===h.hero_id&&!o.protected&&!role.has(o.id)&&!itemsOn(o.id).length).map(o=>o.id);
  return {id:h.id,hero_id:h.hero_id,name:def?.name??h.hero_id,faction_id:def?.data.faction_id??null,available,
   level:h.level,effective_level:level,rank:h.rank,rank_name:p.ranks[Math.min(h.rank,p.ranks.length-1)].name,max_level:cap,protected:h.protected,role:r,slot,
   equipped:itemsOn(h.id).map(i=>i.id),
   stats:available?heroStats(p,def.data.combat,{level,rank:h.rank,items:itemsOn(h.id).map(i=>({item_id:i.item_id,upgrade:i.upgrade}))},byId):null,
   next_level:r==='main'&&h.level<cap?levelCost(p,h.level):null,
   rank_up:next?{to_rank_name:next.name,copies:next.copies,material_per_copy:p.material_per_copy,max_level_after:next.max_level,candidates:free}:null};
 });
 const items=s.items.map(i=>{const def=byId.get(i.item_id),max=def?.data.upgrade_max??0;
  return {id:i.id,item_id:i.item_id,name:def?.name??i.item_id,slot:i.slot,rarity:def?.data.rarity??'common',upgrade:i.upgrade,upgrade_max:max,equipped_on:i.equipped_on,
   faction_ids:def?.data.faction_ids??null,stats:def?itemStats(def,i.upgrade):{},next_upgrade_gold:def&&i.upgrade<max?upgradeCost(def,i.upgrade):null};});
 return {api_version:1,content_version:ctx.version.content_version,sync_slots:p.sync_slots,sync_level:eff.sync_level,proposed:p.proposed??false,
  main:s.main,sync:s.sync,balances,heroes,items};
}

/** Instances → content heroes + stat modifiers for a battle (ownership checked). */
export async function resolveTeam(db:Db,playerId:string,content:any,instanceIds:string[]){
 const p=progressionOf(content);if(!p)throw conflict('PROGRESSION_DISABLED');
 const s=await load(db,playerId),eff=effectiveLevels(p,s.heroes,s.main,s.sync),byId=new Map<string,any>(content.entities.map((e:any)=>[e.id,e]));
 const heroIds:string[]=[],mods:any[]=[];
 for(const id of instanceIds){
  const h=s.heroes.find(x=>x.id===id);if(!h)throw conflict('HERO_NOT_OWNED');
  const def=byId.get(h.hero_id);if(def?.kind!=='hero'||!def.data.combat)throw conflict('HERO_UNAVAILABLE');
  heroIds.push(h.hero_id);mods.push({level:eff.level(h),rank:h.rank,items:s.items.filter(i=>i.equipped_on===id&&byId.get(i.item_id)?.kind==='item').map(i=>({item_id:i.item_id,upgrade:i.upgrade}))});
 }
 return {hero_ids:heroIds,attacker_mods:mods};
}

export async function registerHeroes(app:FastifyInstance,pool:Pool){
 const act=(path:string,schema:string,work:(c:PoolClient,playerId:string,body:any,ctx:any)=>Promise<void>)=>app.post(path,{config:{rateLimit:{max:120,timeWindow:60000}}},async request=>{
  const body=request.body as any;requireBody(schema,body);const ctx=await content(pool);
  return transaction(pool,async c=>{const playerId=await lockPlayer(c,bearer(request));await grantStarters(c,playerId,ctx.content);await work(c,playerId,body,ctx);return heroesView(c,playerId,ctx);});
 });
 app.get('/v1/heroes',async request=>{
  const ctx=await content(pool);
  return transaction(pool,async c=>{const playerId=await lockPlayer(c,bearer(request));await grantStarters(c,playerId,ctx.content);return heroesView(c,playerId,ctx);});
 });
 const hero=async(c:PoolClient,playerId:string,id:string)=>{const h=(await c.query('SELECT * FROM player_heroes WHERE id=$1 AND player_id=$2 AND consumed_at IS NULL FOR UPDATE',[id,playerId])).rows[0];if(!h)throw conflict('HERO_NOT_OWNED');return h;};
 const teamRole=async(c:PoolClient,id:string)=>(await c.query('SELECT role FROM player_team WHERE instance_id=$1',[id])).rows[0]?.role??null;

 act('/v1/heroes/level','hero_level_request',async(c,playerId,b,{p})=>{
  const h=await hero(c,playerId,b.instance_id);
  if(h.level!==b.from_level)throw conflict('STALE_STATE');
  if(await teamRole(c,h.id)!=='main')throw conflict('NOT_MAIN_HERO');
  if(h.level>=rankCap(p,h.rank))throw conflict('LEVEL_CAP');
  const cost=levelCost(p,h.level);
  for(const [currency,amount] of Object.entries(cost))if(amount>0)await applyDeltaTx(c,{playerId,currency,delta:-amount,reason:'hero_level_up',sourceId:h.id,key:`hero:${h.id}:level:${h.level}:${currency}`});
  await c.query('UPDATE player_heroes SET level=level+1 WHERE id=$1',[h.id]);
 });

 act('/v1/heroes/rank','hero_rank_request',async(c,playerId,b,{p})=>{
  const h=await hero(c,playerId,b.instance_id);
  if(h.rank!==b.from_rank)throw conflict('STALE_STATE');
  const next=p.ranks[h.rank+1];if(!next)throw conflict('RANK_MAX');
  if(b.copy_instance_ids.length>next.copies)throw conflict('TOO_MANY_COPIES');
  for(const id of b.copy_instance_ids){
   if(id===h.id)throw conflict('COPY_NOT_ALLOWED');
   const copy=(await c.query('SELECT * FROM player_heroes WHERE id=$1 AND player_id=$2 AND consumed_at IS NULL FOR UPDATE',[id,playerId])).rows[0];
   if(!copy)throw conflict('HERO_NOT_OWNED');
   if(copy.hero_id!==h.hero_id||copy.protected||await teamRole(c,id)||(await c.query('SELECT 1 FROM player_items WHERE equipped_on=$1',[id])).rowCount)throw conflict('COPY_NOT_ALLOWED');
  }
  const material=(next.copies-b.copy_instance_ids.length)*p.material_per_copy;
  if(material>0)await applyDeltaTx(c,{playerId,currency:'rank_material',delta:-material,reason:'hero_rank_up',sourceId:h.id,key:`hero:${h.id}:rank:${h.rank}:rank_material`});
  if(b.copy_instance_ids.length)await c.query('UPDATE player_heroes SET consumed_at=now() WHERE id=ANY($1::uuid[])',[b.copy_instance_ids]);
  await c.query('UPDATE player_heroes SET rank=rank+1 WHERE id=$1',[h.id]);
 });

 act('/v1/heroes/team','hero_team_request',async(c,playerId,b,{p})=>{
  if(b.sync.length>p.sync_slots)throw conflict('SYNC_SLOTS_EXCEEDED');
  if(b.main.some((id:string)=>b.sync.includes(id)))throw conflict('HERO_IN_TWO_PLACES');
  for(const id of [...b.main,...b.sync])await hero(c,playerId,id);
  await c.query('DELETE FROM player_team WHERE player_id=$1',[playerId]);
  for(const [slot,id] of b.main.entries())await c.query("INSERT INTO player_team(player_id,role,slot,instance_id) VALUES($1,'main',$2,$3)",[playerId,slot,id]);
  for(const [slot,id] of b.sync.entries())await c.query("INSERT INTO player_team(player_id,role,slot,instance_id) VALUES($1,'sync',$2,$3)",[playerId,slot,id]);
 });

 act('/v1/heroes/protect','hero_protect_request',async(c,playerId,b)=>{
  await hero(c,playerId,b.instance_id);await c.query('UPDATE player_heroes SET protected=$2 WHERE id=$1',[b.instance_id,b.protected]);
 });

 act('/v1/items/equip','item_equip_request',async(c,playerId,b,{byId})=>{
  const item=(await c.query('SELECT * FROM player_items WHERE id=$1 AND player_id=$2 FOR UPDATE',[b.item_instance_id,playerId])).rows[0];
  if(!item)throw conflict('ITEM_NOT_OWNED');
  if(b.hero_instance_id===null){await c.query('UPDATE player_items SET equipped_on=NULL WHERE id=$1',[item.id]);return;}
  const h=await hero(c,playerId,b.hero_instance_id);
  const def=byId.get(item.item_id),heroDef=byId.get(h.hero_id);
  if(def?.kind!=='item'||!def.data.stats||heroDef?.kind!=='hero')throw conflict('ITEM_UNAVAILABLE');
  if(def.data.faction_ids&&!def.data.faction_ids.includes(heroDef.data.faction_id))throw conflict('ITEM_INCOMPATIBLE');
  if(item.equipped_on===h.id)return;
  // The slot's previous item goes back to the bag; the item leaves its old hero.
  await c.query('UPDATE player_items SET equipped_on=NULL WHERE equipped_on=$1 AND slot=$2',[h.id,item.slot]);
  await c.query('UPDATE player_items SET equipped_on=$2 WHERE id=$1',[item.id,h.id]);
 });

 act('/v1/items/upgrade','item_upgrade_request',async(c,playerId,b,{byId})=>{
  const item=(await c.query('SELECT * FROM player_items WHERE id=$1 AND player_id=$2 FOR UPDATE',[b.item_instance_id,playerId])).rows[0];
  if(!item)throw conflict('ITEM_NOT_OWNED');
  if(item.upgrade!==b.from_upgrade)throw conflict('STALE_STATE');
  const def=byId.get(item.item_id);if(def?.kind!=='item')throw conflict('ITEM_UNAVAILABLE');
  if(item.upgrade>=(def.data.upgrade_max??0))throw conflict('UPGRADE_MAX');
  const gold=upgradeCost(def,item.upgrade);
  if(gold>0)await applyDeltaTx(c,{playerId,currency:'gold',delta:-gold,reason:'item_upgrade',sourceId:item.id,key:`item:${item.id}:upgrade:${item.upgrade}:gold`});
  await c.query('UPDATE player_items SET upgrade=upgrade+1 WHERE id=$1',[item.id]);
 });
}
