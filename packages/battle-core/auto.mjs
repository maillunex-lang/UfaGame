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
 const actors=input.actors.map(a=>({...structuredClone(a),max_hp:a.hp,x:a.team==='attacker'?(a.slot<2?1500:500):(a.slot<2?8500:9500),y:lane[a.slot],next_attack_step:0})).sort(cmp);
 return {simulation_version:2,seed:input.seed,rng_state:input.seed,step:0,result:null,advantage_bp:input.advantage_bp,factions:structuredClone(input.factions).sort(cmp),actors};
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
   if(state.step%ability.interval_steps!==0)continue;
   let abilityTarget=target,abilityAmount=ability.power;
   if(ability.effect==='heal')abilityTarget=live.filter(a=>a.team===actor.team).sort((a,b)=>a.hp*b.max_hp-b.hp*a.max_hp||cmp(a,b))[0];
   else if(factions.get(actor.faction_id).advantage_ids.includes(abilityTarget.faction_id))abilityAmount=Math.floor(abilityAmount*state.advantage_bp/10000);
   effects.push({kind:ability.effect,source_id:actor.id,target_id:abilityTarget.id,amount:abilityAmount,ability_id:ability.id});
  }
  if(state.step<actor.next_attack_step)continue;
  const useAbility=updated.energy>=actor.ability.cost&&(actor.team==='defender'||autoAttacker||manual.has(actor.id));let amount,kind='damage';
  if(useAbility){
   updated.energy-=actor.ability.cost;kind=actor.ability.effect;amount=actor.ability.power;
   if(kind==='heal')target=live.filter(a=>a.team===actor.team).sort((a,b)=>a.hp*b.max_hp-b.hp*a.max_hp||cmp(a,b))[0];
  }else{amount=Math.max(1,actor.attack-target.defense);updated.energy=Math.min(1000,updated.energy+actor.energy_per_attack);}
  if(kind==='damage'&&factions.get(actor.faction_id).advantage_ids.includes(target.faction_id))amount=Math.floor(amount*state.advantage_bp/10000);
  updated.next_attack_step=state.step+actor.interval_steps;
  effects.push(useAbility&&actor.ability.id?{kind,source_id:actor.id,target_id:target.id,amount,ability_id:actor.ability.id}:{kind,source_id:actor.id,target_id:target.id,amount});
 }
 const totals=new Map();
 for(const effect of effects){const t=totals.get(effect.target_id)??{damage:0,heal:0};t[effect.kind]+=effect.amount;totals.set(effect.target_id,t);events.push(effect);}
 for(const [id,total] of totals){const a=byId.get(id);a.hp=Math.max(0,Math.min(a.max_hp,a.hp+total.heal-total.damage));}
 if(!next.actors.some(a=>a.team==='attacker'&&a.hp>0))next.result='attacker_loss';
 else if(!next.actors.some(a=>a.team==='defender'&&a.hp>0))next.result='attacker_win';
 else if(next.step>=LIMIT)next.result='attacker_loss';
 return {state:next,events,at_ms:next.step*STEP};
}
