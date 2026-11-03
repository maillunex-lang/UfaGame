import {validate} from '@ufagame/contracts';
import {createAutoBattle,stepAutoBattle} from './auto.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
/** Internal state only. A transport must authenticate, lock and persist it atomically. */
export function createLiveBattle({battleId,contentVersion,setup,heroes,auto=false}) {
 if(typeof battleId!=='string'||!uuid.test(battleId)||typeof contentVersion!=='string'||!/^[-a-z0-9_]{3,80}$/.test(contentVersion)||typeof auto!=='boolean'||!heroes||typeof heroes!=='object'||Array.isArray(heroes))throw new Error('INVALID_SESSION');
 const state=createAutoBattle(setup);
 if(Object.keys(heroes).length!==state.actors.length||state.actors.some(actor=>typeof heroes[actor.id]!=='string'))throw new Error('INVALID_HERO_MAP');
 return {version:1,battle_id:battleId,content_version:contentVersion,heroes:structuredClone(heroes),auto,state,last_command_seq:0,event_seq:0,pending:[],acks:[]};
}
/** Queues at most five steps ahead. Accepted means queued, not already applied. */
export function queueLiveCommand(session,command,{earliestStep=0}={}) {
 if(!validate('live_battle_command',command).ok)throw new Error('INVALID_COMMAND');
 const fingerprint=JSON.stringify(command.type==='ability'?[command.type,command.seq,command.for_step,command.actor_id]:[command.type,command.seq,command.for_step,command.enabled]);
 const old=session.acks.find(entry=>entry.seq===command.seq);
 if(old){if(old.fingerprint!==fingerprint)throw new Error('SEQUENCE_CONFLICT');return {session:structuredClone(session),ack:{...old.ack,replayed:true}};}
 if(command.seq!==session.last_command_seq+1)throw new Error('OUT_OF_ORDER');
 if(session.state.result!==null)throw new Error('BATTLE_FINISHED');
 if(session.acks.length>=2048)throw new Error('COMMAND_LIMIT');
 // Mobile lag: the client sees frames up to ~0.3 s late. A command for a step that
 // has just passed (at most LATE_STEPS ago) moves to the next step; older ones are stale.
 if(command.for_step>Math.min(900,session.state.step+5)||command.for_step<=session.state.step-LATE_STEPS)throw new Error('STALE_COMMAND');
 const forStep=Math.max(command.for_step,session.state.step+1,earliestStep);
 if(forStep>900)throw new Error('STALE_COMMAND');
 if(session.pending.length>=32)throw new Error('QUEUE_FULL');
 if(command.type==='auto'&&session.pending.some(c=>c.type==='auto'&&c.for_step===forStep))throw new Error('DUPLICATE_MODE_COMMAND');
 if(command.type==='ability'){
  const actor=session.state.actors.find(a=>a.id===command.actor_id&&a.team==='attacker'&&a.hp>0);
  if(!actor)throw new Error('INVALID_ACTOR');
  if(session.pending.some(c=>c.type==='ability'&&c.for_step===forStep&&c.actor_id===command.actor_id))throw new Error('DUPLICATE_ACTOR_COMMAND');
 }
 const next=structuredClone(session),ack={seq:command.seq,for_step:forStep,status:'queued'};
 next.last_command_seq=command.seq;next.pending.push({...structuredClone(command),for_step:forStep});next.acks.push({seq:command.seq,fingerprint,ack});
 return {session:next,ack:{...ack,replayed:false}};
}
/** A charged ability tap waits at most this many steps (1 s) for the hero to be able to strike. */
export const WAIT_STEPS=10;
/** How many steps late a command may arrive and still be applied on the next step. */
export const LATE_STEPS=10;
/** Advance exactly one step using only previously accepted commands. */
export function advanceLiveBattle(session,{forceAuto=false}={}) {
 if(session.state.result!==null)throw new Error('BATTLE_FINISHED');
 if(typeof forceAuto!=='boolean')throw new Error('INVALID_MODE');
 const step=session.state.step+1,due=session.pending.filter(c=>c.for_step===step).sort((a,b)=>a.seq-b.seq);
 let auto=forceAuto||session.auto;const manual=[],results=[],carried=[];
 for(const command of due)if(command.type==='auto'){
  if(forceAuto&&!command.enabled)results.push({seq:command.seq,status:'rejected',reason:'OFFLINE_AUTO'});
  else{auto=command.enabled;results.push({seq:command.seq,status:'applied'});}
 }
 for(const command of due){
  if(command.type!=='ability')continue;
  const actor=session.state.actors.find(a=>a.id===command.actor_id&&a.team==='attacker'&&a.hp>0);
  const enemies=actor?session.state.actors.filter(a=>a.team!==actor.team&&a.hp>0):[];
  const charged=actor&&Math.min(1000,actor.energy+actor.energy_per_step)>=actor.ability.cost;
  const ready=charged&&session.state.step>=actor.next_attack_step&&session.state.step>=(actor.next_ability_step??0)&&session.state.step>=(actor.stunned_until_step??0)&&enemies.some(enemy=>distance(actor,enemy)<=actor.range);
  if(ready){manual.push(actor.id);results.push({seq:command.seq,status:'applied'});}
  // Charged but the hero is between attacks, stunned or still walking: keep the tap
  // for up to WAIT_STEPS so a portrait tap feels immediate instead of being lost.
  else if(charged&&step<(command.wait_until??command.for_step+WAIT_STEPS)&&step<900)carried.push({...command,for_step:step+1,wait_until:command.wait_until??command.for_step+WAIT_STEPS});
  else results.push({seq:command.seq,status:'rejected',reason:'ABILITY_NOT_READY'});
 }
 const advanced=stepAutoBattle(session.state,{autoAttacker:auto,manualActorIds:manual});
 const next=structuredClone(session);next.auto=auto;next.state=advanced.state;next.pending=[...next.pending.filter(c=>c.for_step>step),...carried];next.event_seq++;
 results.sort((a,b)=>a.seq-b.seq);
 return {session:next,frame:{seq:next.event_seq,at_ms:advanced.at_ms,auto,events:advanced.events,command_results:results,actors:advanced.state.actors.map(a=>({id:a.id,hp:a.hp,x:a.x,y:a.y,energy:a.energy})),result:advanced.state.result}};
}
/** Owner offline or worker restart: future steps continue in automatic mode. */
export function disconnectLiveBattle(session){const next=structuredClone(session);next.auto=true;return next;}
