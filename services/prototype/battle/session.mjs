import {createAutoBattle,stepAutoBattle} from '../../../packages/battle-core/auto.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=['actor_id','battle_id','for_step','seq'];
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
/** In-memory test harness only: no transport, persistence, player authentication or rewards. */
export class BattleSession {
 #state;#battleId;#contentVersion;#auto;#lastSeq=0;#acks=new Map();#pending=new Map();
 constructor({battleId,contentVersion,setup,auto=false}) {
  if(typeof battleId!=='string'||!uuid.test(battleId)||typeof contentVersion!=='string'||!/^[-a-z0-9_]{3,80}$/.test(contentVersion)||typeof auto!=='boolean')throw new Error('INVALID_SESSION');
  this.#battleId=battleId;this.#contentVersion=contentVersion;this.#auto=auto;this.#state=createAutoBattle(setup);
 }
 snapshot(){return {battle_id:this.#battleId,content_version:this.#contentVersion,auto:this.#auto,last_seq:this.#lastSeq,state:structuredClone(this.#state)};}
 setAuto(enabled){if(typeof enabled!=='boolean'||this.#state.result!==null)throw new Error('INVALID_MODE');this.#auto=enabled;}
 submit(command){
  if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).sort().join(',')!==fields.join(',')||command.battle_id!==this.#battleId||!Number.isSafeInteger(command.seq)||command.seq<1||!Number.isSafeInteger(command.for_step)||typeof command.actor_id!=='string')throw new Error('INVALID_COMMAND');
  const fingerprint=JSON.stringify([command.battle_id,command.seq,command.for_step,command.actor_id]);
  const prior=this.#acks.get(command.seq);
  if(prior){if(prior.fingerprint!==fingerprint)throw new Error('SEQUENCE_CONFLICT');return {...prior.ack,replayed:true};}
  if(command.seq!==this.#lastSeq+1)throw new Error('OUT_OF_ORDER');
  if(this.#state.result!==null)throw new Error('BATTLE_FINISHED');
  if(command.for_step!==this.#state.step+1)throw new Error('STALE_COMMAND');
  const actor=this.#state.actors.find(a=>a.id===command.actor_id&&a.team==='attacker'&&a.hp>0);
  if(!actor||this.#pending.has(actor.id))throw new Error('INVALID_ACTOR');
  const enemies=this.#state.actors.filter(a=>a.team!==actor.team&&a.hp>0);
  if(this.#state.step<actor.next_attack_step||Math.min(1000,actor.energy+actor.energy_per_step)<actor.ability.cost||!enemies.some(e=>distance(actor,e)<=actor.range))throw new Error('ABILITY_NOT_READY');
  const ack={seq:command.seq,for_step:command.for_step,status:'accepted'};
  this.#pending.set(actor.id,command.seq);this.#lastSeq=command.seq;this.#acks.set(command.seq,{fingerprint,ack});
  return {...ack,replayed:false};
 }
 advance(){
  if(this.#state.result!==null)throw new Error('BATTLE_FINISHED');
  const result=stepAutoBattle(this.#state,{autoAttacker:this.#auto,manualActorIds:[...this.#pending.keys()]});
  this.#pending.clear();this.#state=result.state;
  return {battle_id:this.#battleId,content_version:this.#contentVersion,at_ms:result.at_ms,events:result.events,state:structuredClone(result.state)};
 }
}
