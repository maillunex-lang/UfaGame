import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '@ufagame/contracts';
import {createLiveBattle,queueLiveCommand,advanceLiveBattle,disconnectLiveBattle} from '../../packages/battle-core/live.mjs';
const id='11111111-1111-4111-8111-111111111111';
const actor=(id,team)=>({id,team,slot:0,hp:100,attack:10,defense:0,speed:0,range:20000,interval_steps:1,energy:1000,energy_per_step:0,energy_per_attack:0,faction_id:'neutral',ability:{effect:'damage',power:40,cost:1000}});
const make=()=>createLiveBattle({battleId:id,contentVersion:'version_001',heroes:{atk_0:'hero_one',def_0:'enemy_one'},setup:{simulation_version:2,seed:1,advantage_bp:10000,factions:[{id:'neutral',advantage_ids:[]}],actors:[actor('atk_0','attacker'),actor('def_0','defender')]}});
const command=(seq=1,step=1)=>({type:'ability',seq,for_step:step,actor_id:'atk_0'});
test('manual command changes only its future step and retries are idempotent',()=>{
 let s=make(),before=structuredClone(s);const q=queueLiveCommand(s,command());s=q.session;assert.deepEqual(before.state,s.state);assert.equal(q.ack.status,'queued');
 const retry=queueLiveCommand(s,command());assert.equal(retry.ack.replayed,true);assert.equal(retry.session.pending.length,1);
 const out=advanceLiveBattle(s);assert.equal(validate('live_battle_frame',out.frame).ok,true);assert.equal(out.session.state.actors.find(a=>a.id==='def_0').hp,60);assert.deepEqual(out.frame.command_results,[{seq:1,status:'applied'}]);
 assert.throws(()=>queueLiveCommand(out.session,{...command(),actor_id:'def_0'}),/SEQUENCE_CONFLICT/);
});
test('rejects stale, out-of-order, wrong-side, duplicate and excessive future commands',()=>{
 let s=make();assert.throws(()=>queueLiveCommand(s,command(2)),/OUT_OF_ORDER/);assert.throws(()=>queueLiveCommand(s,command(1,6)),/STALE_COMMAND/);
 assert.throws(()=>queueLiveCommand(s,{...command(),actor_id:'def_0'}),/INVALID_ACTOR/);s=queueLiveCommand(s,command()).session;
 assert.throws(()=>queueLiveCommand(s,command(2)),/DUPLICATE_ACTOR_COMMAND/);s=advanceLiveBattle(s).session;
 assert.throws(()=>queueLiveCommand(s,command(2,1)),/STALE_COMMAND/);
});
test('future command reports unready without applying twice; reconnect checkpoint and auto survive cloning',()=>{
 let s=make();s=queueLiveCommand(s,command(1,2)).session;s=advanceLiveBattle(s).session;
 const checkpoint=JSON.parse(JSON.stringify(s));assert.equal(checkpoint.content_version,'version_001');const later=advanceLiveBattle(checkpoint);
 assert.deepEqual(later.frame.command_results,[{seq:1,status:'applied'}]);assert.equal(later.frame.seq,2);
 const offline=disconnectLiveBattle(make());assert.equal(offline.auto,true);assert.equal(advanceLiveBattle(offline).session.state.actors.find(a=>a.id==='def_0').hp,60);
});
test('auto mode changes on the requested server step; invalid commands cannot mutate state',()=>{
 let s=make(),before=structuredClone(s);assert.throws(()=>queueLiveCommand(s,{type:'reward',seq:1,for_step:1}),/INVALID_COMMAND/);assert.deepEqual(s,before);
 s=queueLiveCommand(s,{type:'auto',seq:1,for_step:1,enabled:true}).session;const result=advanceLiveBattle(s);assert.equal(result.session.auto,true);assert.equal(result.session.state.actors.find(a=>a.id==='def_0').hp,60);
});
test('disconnected play forces auto even if an earlier queued command disables it',()=>{
 let s=make();s=queueLiveCommand(s,{type:'auto',seq:1,for_step:1,enabled:false}).session;
 const out=advanceLiveBattle(disconnectLiveBattle(s),{forceAuto:true});
 assert.equal(out.session.auto,true);assert.deepEqual(out.frame.command_results,[{seq:1,status:'rejected',reason:'OFFLINE_AUTO'}]);
 assert.equal(out.session.state.actors.find(a=>a.id==='def_0').hp,60);
});
test('queued command is rejected at execution if the actor cannot act',()=>{
 let s=make();s=queueLiveCommand(s,command()).session;s.state.actors.find(a=>a.id==='atk_0').stunned_until_step=3;
 const out=advanceLiveBattle(s);assert.deepEqual(out.frame.command_results,[{seq:1,status:'rejected',reason:'ABILITY_NOT_READY'}]);
 assert.equal(out.session.state.actors.find(a=>a.id==='def_0').hp,100);
});
