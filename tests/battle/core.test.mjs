import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,stepBattle,MAX_STEPS,STEP_MS} from '../../packages/battle-core/index.mjs';
const setup=()=>({simulation_version:1,seed:42,actors:[{id:'hero_a',team:'attacker',slot:0,hp:10},{id:'enemy_a',team:'defender',slot:0,hp:10}]});
test('same snapshot and inputs are deterministic and do not mutate input',()=>{
 const initial=createBattle(setup());const copy=structuredClone(initial);
 const run=()=>stepBattle(initial,[{kind:'damage',target_id:'enemy_a',amount:3}]);
 assert.deepEqual(run(),run());assert.deepEqual(initial,copy);assert.equal(run().actors[1].hp,7);
});
test('simultaneous defeat and victory follow attacker rules independent of order',()=>{
 const start=createBattle(setup());const a={kind:'damage',target_id:'hero_a',amount:10},b={kind:'damage',target_id:'enemy_a',amount:10};
 assert.deepEqual(stepBattle(start,[a,b]),stepBattle(start,[b,a]));
 assert.equal(stepBattle(start,[a,b]).result,'attacker_loss');assert.equal(stepBattle(start,[b]).result,'attacker_win');
});
test('90 seconds is a hard timeout and finished battles cannot advance',()=>{
 let state=createBattle(setup());for(let i=0;i<MAX_STEPS-1;i++)state=stepBattle(state);
 assert.equal(state.result,null);state=stepBattle(state);assert.equal(state.step*STEP_MS,90000);assert.equal(state.result,'attacker_loss');assert.throws(()=>stepBattle(state));
});
test('reject unknown or excessive effects, duplicate actors and malformed setup',()=>{
 const state=createBattle(setup());
 for(const effects of [[{kind:'execute',target_id:'enemy_a',amount:1}],Array(11).fill({kind:'damage',target_id:'enemy_a',amount:1}),[{kind:'damage',target_id:'missing',amount:1}],[{kind:'damage',target_id:'enemy_a',amount:-1}]])assert.throws(()=>stepBattle(state,effects));
 const bad=setup();bad.actors[1].id=bad.actors[0].id;assert.throws(()=>createBattle(bad));
});
