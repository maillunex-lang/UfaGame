import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BattleSession} from '../../services/prototype/battle/session.mjs';
const battleId='11111111-1111-4111-8111-111111111111';
const actor=(id,team)=>({id,team,slot:0,hp:100,attack:10,defense:0,speed:0,range:20000,interval_steps:1,energy:1000,energy_per_step:0,energy_per_attack:0,faction_id:'neutral',ability:{effect:'damage',power:40,cost:1000}});
const setup=()=>({simulation_version:2,seed:1,advantage_bp:10000,factions:[{id:'neutral',advantage_ids:[]}],actors:[actor('hero_one','attacker'),actor('enemy_one','defender')]});
const command=(seq=1,for_step=1)=>({battle_id:battleId,seq,for_step,actor_id:'hero_one'});
const session=()=>new BattleSession({battleId,contentVersion:'version_001',setup:setup()});
test('manual ability changes future state, duplicate acknowledged without a second action',()=>{
 const s=session(),c=command();assert.equal(s.submit(c).replayed,false);assert.equal(s.submit(c).replayed,true);
 const out=s.advance();assert.equal(out.state.actors.find(a=>a.id==='enemy_one').hp,60);assert.equal(out.events.filter(e=>e.source_id==='hero_one').length,1);
 assert.equal(s.submit(c).replayed,true);assert.throws(()=>s.submit({...c,actor_id:'enemy_one'}),/SEQUENCE_CONFLICT/);
});
test('manual mode does not use ability without command, auto does',()=>{
 const manual=session().advance();assert.equal(manual.state.actors.find(a=>a.id==='enemy_one').hp,90);
 const s=session();s.setAuto(true);const automatic=s.advance();assert.equal(automatic.state.actors.find(a=>a.id==='enemy_one').hp,60);
});
test('out of order, stale and unauthorized actor commands cannot affect snapshot',()=>{
 const s=session(),before=s.snapshot();assert.throws(()=>s.submit(command(2)),/OUT_OF_ORDER/);
 assert.throws(()=>s.submit(command(1,2)),/STALE_COMMAND/);assert.throws(()=>s.submit({...command(),actor_id:'enemy_one'}),/INVALID_ACTOR/);
 assert.deepEqual(s.snapshot(),before);
});
test('snapshot is isolated, content version remains pinned and lagged command rejected',()=>{
 const s=session(),copy=s.snapshot();copy.state.actors[0].hp=0;s.advance();
 assert.equal(s.snapshot().content_version,'version_001');assert.ok(s.snapshot().state.actors.some(a=>a.hp>0));
 assert.throws(()=>s.submit(command(1,1)),/STALE_COMMAND/);
});
test('energy and range gate commands',()=>{
 const inputs=setup();inputs.actors[0].energy=0;const s=new BattleSession({battleId,contentVersion:'version_001',setup:inputs});
 assert.throws(()=>s.submit(command()),/ABILITY_NOT_READY/);assert.equal(s.snapshot().last_seq,0);
});
