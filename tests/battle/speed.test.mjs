import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLiveBattle,queueLiveCommand,advanceLiveBattle} from '../../packages/battle-core/live.mjs';
import {compileContentBattle,runAutoBattle} from '../../packages/battle-core/compile.mjs';
import {economyContent} from '../fixtures/progression.mjs';
const id='5d1c2b9a-0000-4000-8000-000000000001';
const setupFor=seed=>compileContentBattle(economyContent(),{attacker_hero_ids:['hero_a','hero_b'],defender_hero_ids:['hero_c','hero_d','hero_e'],seed});
function liveAuto(seed,commands=[]){
 const {setup,heroes}=setupFor(seed);let s=createLiveBattle({battleId:id,contentVersion:'pub_000001',setup,heroes,auto:true});
 for(const c of commands)s=queueLiveCommand(s,c).session;
 const speeds=[];while(s.state.result===null){const r=advanceLiveBattle(s);s=r.session;speeds.push(r.frame.speed);}
 return {s,speeds};
}
test('S26: live battle in auto equals the instant calculation with the same seed; speed never changes the simulation',()=>{
 for(const seed of [1,77,4294967295]){
  const {setup,heroes}=setupFor(seed),instant=runAutoBattle(setup,{heroes});
  const plain=liveAuto(seed).s,fast=liveAuto(seed,[{type:'speed',seq:1,for_step:1,value:4},{type:'speed',seq:2,for_step:5,value:2}]);
  assert.equal(plain.state.result,instant.result);assert.equal(plain.state.step,instant.steps);
  assert.deepEqual(plain.state.actors.map(a=>a.hp),instant.actors.map(a=>a.hp),'same final HP as the instant calculation');
  assert.deepEqual(fast.s.state,plain.state,'×2/×4 give the same battle');
  assert.ok(plain.state.step<=900,'never more than 90 game seconds');
 }
 const {speeds}=liveAuto(5,[{type:'speed',seq:1,for_step:1,value:4},{type:'speed',seq:2,for_step:5,value:2}]);
 assert.deepEqual(speeds.slice(0,6),[4,4,4,4,2,2],'speed applies from the requested step');
 const {setup,heroes}=setupFor(1);const s=createLiveBattle({battleId:id,contentVersion:'pub_000001',setup,heroes});
 assert.throws(()=>queueLiveCommand(s,{type:'speed',seq:1,for_step:1,value:3}),/INVALID_COMMAND/);
});
