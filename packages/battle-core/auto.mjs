import Ajv from 'ajv/dist/2020.js';
import {readFileSync} from 'node:fs';
const valid=new Ajv({strict:true}).compile(JSON.parse(readFileSync(new URL('./auto.schema.json',import.meta.url))));
const STEP=100,LIMIT=900;
const lane=[3500,6500,2000,5000,8000];
const cmp=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function rng(value){let x=value||0x6d2b79f5;x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
/** Internal simulation v2, not the external battle_snapshot contract. */
export function createAutoBattle(input) {
 if(!valid(input))throw new Error('INVALID_SETUP');
 const ids=new Set(),slots=new Set(),factions=new Map();
 for(const f of input.factions){if(factions.has(f.id))throw new Error('DUPLICATE_FACTION');factions.set(f.id,f);}
 for(const f of input.factions)if(f.advantage_ids.some(id=>!factions.has(id)||id===f.id))throw new Error('INVALID_FACTION_LINK');
 for(const a of input.actors){const slot=`${a.team}:${a.slot}`;if(ids.has(a.id)||slots.has(slot))throw new Error('DUPLICATE_ACTOR_OR_SLOT');if(!factions.has(a.faction_id))throw new Error('UNKNOWN_FACTION');if(a.auto_abilities&&new Set(a.auto_abilities.map(ability=>ability.id)).size!==a.auto_abilities.length)throw new Error('DUPLICATE_ABILITY');ids.add(a.id);slots.add(slot);}
 if(!input.actors.some(a=>a.team==='attacker')||!input.actors.some(a=>a.team==='defender'))throw new Error('MISSING_TEAM');
 const actors=input.actors.map(a=>({...structuredClone(a),max_hp:a.hp,x:a.team==='attacker'?(a.slot<2?1500:500):(a.slot<2?8500:9500),y:lane[a.slot],next_attack_step:0,next_ability_step:0,stunned_until_step:0,auto_state:Object.fromEntries((a.auto_abilities??[]).map(ab=>[ab.id,{next:0,done:false}]))})).sort(cmp);
 return {simulation_version:2,seed:input.seed,rng_state:input.seed,step:0,result:null,advantage_bp:input.advantage_bp,factions:structuredClone(input.factions).sort(cmp),actors};
}
const MAX_STUN_STEPS=50,MAX_KNOCKBACK=5000;
const ratio=(a,b)=>a.hp*b.max_hp-b.hp*a.max_hp;
/** Targets chosen by the ability's rule, from the state at the start of the step. */
function targetsFor(actor,mode,nearest,live){
 const allies=live.filter(a=>a.team===actor.team),inRange=live.filter(a=>a.team!==actor.team&&distance(actor,a)<=actor.range);
 if(mode==='self')return [actor];
 if(mode==='ally_lowest')return [allies.sort((a,b)=>ratio(a,b)||cmp(a,b))[0]];
 if(mode==='all_enemies')return inRange.length?inRange.sort(cmp):[nearest];
 if(mode==='weakest_enemy')return [(inRange.length?inRange:[nearest]).sort((a,b)=>a.hp-b.hp||cmp(a,b))[0]];
 return [nearest];
}
function effectsOf(state,factions,actor,ability,nearest,live,extra){
 const mode=ability.target??(ability.effect==='heal'?'ally_lowest':'enemy'),out=[];
 for(const target of targetsFor(actor,mode,nearest,live)){
  let amount=ability.power;
  if(ability.effect==='damage'){const f=factions.get(actor.faction_id);if(f.advantage_ids.includes(target.faction_id))amount=Math.floor(amount*(f.advantage_bp??state.advantage_bp)/10000);}
  else if(ability.effect==='stun')amount=Math.min(amount,MAX_STUN_STEPS);
  else if(ability.effect==='knockback')amount=Math.min(amount,MAX_KNOCKBACK);
  out.push({kind:ability.effect,source_id:actor.id,target_id:target.id,amount,...extra});
 }
 return out;
}
/** Main effect plus up to two extra effects of the same ability (each with its own target rule). */
function actionsOf(state,factions,actor,ability,nearest,live,extra){
 const out=effectsOf(state,factions,actor,ability,nearest,live,extra);
 for(const more of ability.extra_effects??[])out.push(...effectsOf(state,factions,actor,more,nearest,live,extra));
 return out;
}
const MAX_STATE_STEPS=900;
/**
 * Trigger blocks of automatic abilities. `interval` (default) keeps the original
 * rule step % interval === 0; condition triggers fire when the condition holds and
 * the ability's own cooldown has passed; battle_start fires once on first contact.
 */
function triggered(actor,updated,ability,live,step){
 const kind=ability.trigger?.kind??'interval';
 if(kind==='interval')return step%ability.interval_steps===0;
 const own=updated.auto_state?.[ability.id]??{next:0,done:false};
 if(own.done||step<own.next)return false;
 const percent=ability.trigger.percent??50;
 const low=a=>a.hp*100<percent*a.max_hp;
 const ok=kind==='battle_start'?true:kind==='self_hp_below'?low(actor):live.some(a=>a.team===actor.team&&a.id!==actor.id&&low(a));
 if(!ok)return false;
 updated.auto_state={...updated.auto_state,[ability.id]:{next:Math.min(MAX_STATE_STEPS,step+ability.interval_steps),done:kind==='battle_start'}};
 return true;
}
/** One fixed 100ms server step. All actions use the state at the start of the tick. */
export function stepAutoBattle(state,options={}) {
 if(state.result!==null||state.step>=LIMIT)throw new Error('BATTLE_FINISHED');
 const {autoAttacker=true,manualActorIds=[]}=options;
 if(typeof autoAttacker!=='boolean'||!Array.isArray(manualActorIds)||manualActorIds.length>5||new Set(manualActorIds).size!==manualActorIds.length||manualActorIds.some(id=>!state.actors.some(a=>a.id===id&&a.team==='attacker'&&a.hp>0)))throw new Error('INVALID_COMMANDS');
 const manual=new Set(manualActorIds);
 const next=structuredClone(state);next.step++;
 const live=state.actors.filter(a=>a.hp>0),byId=new Map(next.actors.map(a=>[a.id,a]));
 const factions=new Map(state.factions.map(f=>[f.id,f]));
 const effects=[],events=[];
 for(const actor of live){
  const updated=byId.get(actor.id);updated.energy=Math.min(1000,actor.energy+actor.energy_per_step);
  if(state.step<(actor.stunned_until_step??0))continue;
  const enemies=live.filter(a=>a.team!==actor.team).sort((a,b)=>distance(actor,a)-distance(actor,b)||cmp(a,b));
  if(!enemies.length)continue;
  const closest=distance(actor,enemies[0]);const tied=enemies.filter(a=>distance(actor,a)===closest);
  let target=tied[0];if(tied.length>1){next.rng_state=rng(next.rng_state);target=tied[next.rng_state%tied.length];}
  if(closest>actor.range){
   let remaining=actor.speed,dx=target.x-actor.x,move=Math.min(Math.abs(dx),remaining);updated.x+=Math.sign(dx)*move;remaining-=move;
   const dy=target.y-actor.y;move=Math.min(Math.abs(dy),remaining);updated.y+=Math.sign(dy)*move;
   if(updated.x!==actor.x||updated.y!==actor.y)events.push({kind:'move',actor_id:actor.id,x:updated.x,y:updated.y});
   continue;
  }
  for(const ability of actor.auto_abilities??[]){
   if(!triggered(actor,updated,ability,live,state.step))continue;
   effects.push(...actionsOf(state,factions,actor,ability,target,live,{ability_id:ability.id}));
  }
  if(state.step<actor.next_attack_step)continue;
  const ready=state.step>=(actor.next_ability_step??0);
  const useAbility=ready&&updated.energy>=actor.ability.cost&&(actor.team==='defender'||autoAttacker||manual.has(actor.id));
  updated.next_attack_step=state.step+actor.interval_steps;
  if(useAbility){
   updated.energy-=actor.ability.cost;updated.next_ability_step=state.step+(actor.ability.cooldown_steps??0);
   effects.push(...actionsOf(state,factions,actor,actor.ability,target,live,actor.ability.id?{ability_id:actor.ability.id}:{}));
  }else{
   updated.energy=Math.min(1000,updated.energy+actor.energy_per_attack);
   effects.push(...effectsOf(state,factions,actor,{effect:'damage',power:Math.max(1,actor.attack-target.defense),target:'enemy'},target,live,{}));
  }
 }
 const totals=new Map();
 for(const effect of effects){
  events.push(effect);
  if(effect.kind!=='damage'&&effect.kind!=='heal')continue;
  const t=totals.get(effect.target_id)??{damage:0,heal:0};t[effect.kind]+=effect.amount;totals.set(effect.target_id,t);
 }
 for(const [id,total] of totals){const a=byId.get(id);a.hp=Math.max(0,Math.min(a.max_hp,a.hp+total.heal-total.damage));}
 // Control effects apply after damage, only to survivors; simultaneous, order independent.
 for(const effect of effects){
  const target=byId.get(effect.target_id);if(target.hp<=0)continue;
  if(effect.kind==='stun')target.stunned_until_step=Math.max(target.stunned_until_step??0,next.step+effect.amount);
 }
 const pushes=new Map();
 for(const effect of effects){
  if(effect.kind!=='knockback')continue;
  const source=state.actors.find(a=>a.id===effect.source_id),target=state.actors.find(a=>a.id===effect.target_id);
  const dir=Math.sign(target.x-source.x)||(target.team==='defender'?1:-1);pushes.set(effect.target_id,(pushes.get(effect.target_id)??0)+dir*effect.amount);
 }
 for(const [id,dx] of pushes){const a=byId.get(id);if(a.hp>0)a.x=Math.max(0,Math.min(10000,a.x+dx));}
 if(!next.actors.some(a=>a.team==='attacker'&&a.hp>0))next.result='attacker_loss';
 else if(!next.actors.some(a=>a.team==='defender'&&a.hp>0))next.result='attacker_win';
 else if(next.step>=LIMIT)next.result='attacker_loss';
 return {state:next,events,at_ms:next.step*STEP};
}
