import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutoBattle,stepAutoBattle} from '../../packages/battle-core/auto.mjs';
const actor=(id,team,slot,overrides={})=>({id,team,slot,hp:100,attack:10,defense:2,speed:1000,range:1000,interval_steps:1,energy:0,energy_per_step:0,energy_per_attack:0,faction_id:team==='attacker'?'sun':'moon',ability:{effect:'damage',power:25,cost:1000},...overrides});
const setup=(actors)=>({simulation_version:2,seed:42,advantage_bp:12500,factions:[{id:'sun',advantage_ids:['moon']},{id:'moon',advantage_ids:[]}],actors});
function run(start,steps=900){let state=start,events=[];for(let i=0;i<steps&&state.result===null;i++){const r=stepAutoBattle(state);state=r.state;events.push(...r.events);}return {state,events};}
test('same seed and snapshot produce the same bounded result without changing input',()=>{
 const input=setup([actor('hero_one','attacker',0),actor('foe_one','defender',0),actor('foe_two','defender',1)]),copy=structuredClone(input);
 const start=createAutoBattle(input),original=structuredClone(start);
 assert.deepEqual(run(start),run(createAutoBattle(input)));assert.deepEqual(input,copy);assert.deepEqual(start,original);
 assert.ok(run(start).state.step<=900);
});
test('formation, movement, energy, ability and faction damage use fixed integer rules',()=>{
 const input=setup([actor('hero_one','attacker',0,{range:20000,energy:900,energy_per_step:100,ability:{effect:'damage',power:20,cost:1000}}),actor('foe_one','defender',3,{range:0,speed:500})]);
 const start=createAutoBattle(input);assert.equal(start.actors.find(a=>a.id==='hero_one').x,1500);assert.equal(start.actors.find(a=>a.id==='foe_one').x,9500);
 const r=stepAutoBattle(start);assert.equal(r.state.actors.find(a=>a.id==='foe_one').hp,75);assert.equal(r.state.actors.find(a=>a.id==='hero_one').energy,0);
 assert.ok(r.events.some(e=>e.kind==='move'&&e.actor_id==='foe_one'));assert.equal(r.at_ms,100);
});
test('heals and damage resolve simultaneously, mutual death loses for attacker',()=>{
 const r=stepAutoBattle(createAutoBattle(setup([actor('hero_one','attacker',0,{hp:5,attack:100,range:20000}),actor('foe_one','defender',0,{hp:5,attack:100,range:20000})])));
 assert.equal(r.state.result,'attacker_loss');assert.ok(r.state.actors.every(a=>a.hp===0));
 const healed=stepAutoBattle(createAutoBattle(setup([actor('hero_one','attacker',0,{hp:100,range:20000,energy:1000,ability:{effect:'heal',power:10,cost:1000}}),actor('foe_one','defender',0,{attack:20,range:20000})])));
 assert.equal(healed.state.actors.find(a=>a.id==='hero_one').hp,92);
});
test('idle battle stops at exactly 90 seconds and cannot continue',()=>{
 const start=createAutoBattle(setup([actor('hero_one','attacker',0,{speed:0,range:0}),actor('foe_one','defender',0,{speed:0,range:0})]));
 const out=run(start);assert.equal(out.state.step,900);assert.equal(out.state.result,'attacker_loss');assert.throws(()=>stepAutoBattle(out.state),/BATTLE_FINISHED/);
});
test('rejects unknown effects, duplicate positions, faction links and unbounded values',()=>{
 const base=setup([actor('hero_one','attacker',0),actor('foe_one','defender',0)]);
 for(const mutate of [s=>s.actors[0].ability.effect='execute',s=>s.actors.push(actor('hero_two','attacker',0)),s=>s.factions[0].advantage_ids=['missing'],s=>s.actors[0].speed=Infinity]){
  const copy=structuredClone(base);mutate(copy);assert.throws(()=>createAutoBattle(copy));
 }
});
test('five actors per side occupy distinct 2+3 slots and replay ignores input ordering',()=>{
 const actors=[];for(let slot=0;slot<5;slot++){actors.push(actor(`hero_${slot}`,'attacker',slot,{range:20000}));actors.push(actor(`foe_${slot}`,'defender',slot,{range:20000}));}
 const forward=createAutoBattle(setup(actors)),reverse=createAutoBattle(setup([...actors].reverse()));
 assert.equal(forward.actors.filter(a=>a.team==='attacker'&&a.x===1500).length,2);
 assert.equal(forward.actors.filter(a=>a.team==='attacker'&&a.x===500).length,3);
 assert.deepEqual(run(forward,10),run(reverse,10));
});
test('ready targets are reproducible and use the seed for equal distance choices',()=>{
 const actors=[actor('hero_one','attacker',4,{range:20000}),actor('foe_one','defender',0,{range:0,speed:0}),actor('foe_two','defender',1,{range:0,speed:0})];
 const make=seed=>{const s=setup(actors);s.seed=seed;return stepAutoBattle(createAutoBattle(s));};
 const a=make(1),b=make(2);assert.notEqual(a.state.rng_state,b.state.rng_state);
 assert.deepEqual(a,make(1));assert.equal(a.events.filter(e=>e.source_id==='hero_one').length,1);
});
