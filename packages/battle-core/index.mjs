import Ajv from 'ajv/dist/2020.js';
import {readFileSync} from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('./setup.schema.json',import.meta.url)));
const valid=new Ajv({strict:true}).compile(schema);
const MAX_HP=2147483647;
export const STEP_MS=100;
export const MAX_STEPS=900;
export function createBattle(setup) {
 if(!valid(setup)) throw new Error('Invalid battle setup');
 const ids=new Set(),slots=new Set(),teams=new Set();
 for(const actor of setup.actors) {
  const slot=`${actor.team}:${actor.slot}`;
  if(ids.has(actor.id)||slots.has(slot)) throw new Error('Duplicate actor or slot');
  ids.add(actor.id);slots.add(slot);teams.add(actor.team);
 }
 if(teams.size!==2) throw new Error('Both teams required');
 return {simulation_version:1,seed:setup.seed,step:0,result:null,actors:structuredClone(setup.actors)};
}
export function stepBattle(state,effects=[]) {
 if(state.result!==null) throw new Error('Battle already finished');
 if(!Array.isArray(effects)||effects.length>10) throw new Error('Invalid effects');
 const actors=new Map(state.actors.map(a=>[a.id,a]));
 const damage=new Map();
 for(const effect of effects) {
  if(!effect||typeof effect!=='object'||Array.isArray(effect)||Object.keys(effect).sort().join(',')!=='amount,kind,target_id'||effect.kind!=='damage'||!actors.has(effect.target_id)||!Number.isInteger(effect.amount)||effect.amount<0||effect.amount>MAX_HP) throw new Error('Invalid effect');
  damage.set(effect.target_id,(damage.get(effect.target_id)??0)+effect.amount);
 }
 const next={...state,step:state.step+1,actors:state.actors.map(a=>({...a,hp:Math.max(0,a.hp-(damage.get(a.id)??0))}))};
 const alive=team=>next.actors.some(a=>a.team===team&&a.hp>0);
 if(!alive('attacker')) next.result='attacker_loss';
 else if(!alive('defender')) next.result='attacker_win';
 else if(next.step>=MAX_STEPS) next.result='attacker_loss';
 return next;
}
