import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutoBattle,stepAutoBattle} from '../../packages/battle-core/auto.mjs';
import {compileContentBattle,runAutoBattle} from '../../packages/battle-core/compile.mjs';
import {validate} from '@ufagame/contracts';
const actor=(id,team,slot,o={})=>({id,team,slot,hp:100,attack:10,defense:0,speed:0,range:20000,interval_steps:1,energy:1000,energy_per_step:0,energy_per_attack:0,faction_id:team==='attacker'?'sun':'moon',ability:{effect:'damage',power:25,cost:1000},...o});
const setup=(actors,factions=[{id:'sun',advantage_ids:['moon']},{id:'moon',advantage_ids:[]}])=>({simulation_version:2,seed:7,advantage_bp:12000,factions,actors});
const step=(s,o)=>stepAutoBattle(createAutoBattle(s),o);

test('target rules: all enemies in range, weakest enemy, self heal',()=>{
 const foes=[actor('foe_a','defender',0,{hp:100}),actor('foe_b','defender',1,{hp:40}),actor('foe_c','defender',2,{hp:100,})];
 const aoe=step(setup([actor('hero','attacker',0,{ability:{effect:'damage',power:20,cost:1000,target:'all_enemies'}}),...foes.map(f=>({...f,energy:0,attack:0}))]));
 assert.deepEqual(aoe.state.actors.filter(a=>a.team==='defender').map(a=>a.hp),[76,16,76],'every enemy in range hit, advantage x1.2');
 const weakest=step(setup([actor('hero','attacker',0,{ability:{effect:'damage',power:20,cost:1000,target:'weakest_enemy'}}),...foes.map(f=>({...f,energy:0,attack:0}))]));
 assert.equal(weakest.events.find(e=>e.source_id==='hero').target_id,'foe_b');
 const self=step(setup([actor('hero','attacker',0,{hp:100,ability:{effect:'heal',power:30,cost:1000,target:'self'}}),actor('foe','defender',0,{attack:50,energy:0})]));
 assert.equal(self.state.actors.find(a=>a.id==='hero').hp,80,'healed self in the same tick as taking 50');
});
test('stun blocks moving and acting for its duration; dead targets are not stunned',()=>{
 let s=createAutoBattle(setup([actor('hero','attacker',0,{attack:1,ability:{effect:'stun',power:3,cost:1000}}),actor('foe','defender',0,{attack:5,energy:0,hp:1000})]));
 let r=stepAutoBattle(s);assert.ok(r.events.some(e=>e.kind==='stun'&&e.amount===3));s=r.state;
 assert.equal(s.actors.find(a=>a.id==='foe').stunned_until_step,4);
 const quiet=[];for(let i=0;i<3;i++){r=stepAutoBattle(s);quiet.push(...r.events.filter(e=>e.source_id==='foe'));s=r.state;}
 assert.equal(quiet.length,0,'stunned foe does nothing for 3 steps');
 r=stepAutoBattle(s);assert.ok(r.events.some(e=>e.source_id==='foe'),'acts again after stun');
 const kill=step(setup([actor('hero','attacker',0,{ability:{effect:'stun',power:3,cost:1000},attack:500}),actor('foe','defender',0,{hp:1,energy:0}),actor('ally','attacker',1,{attack:500,energy:0})]));
 assert.equal(kill.state.result,'attacker_win');
});
test('knockback moves the target away from the source and stays on the field; main ability cooldown',()=>{
 const r=step(setup([actor('hero','attacker',0,{ability:{effect:'knockback',power:1000,cost:1000}}),actor('foe','defender',0,{energy:0,attack:0})]));
 assert.equal(r.state.actors.find(a=>a.id==='foe').x,9500);
 const edge=step(setup([actor('hero','attacker',0,{ability:{effect:'knockback',power:5000,cost:1000}}),actor('foe','defender',3,{energy:0,attack:0})]));
 assert.equal(edge.state.actors.find(a=>a.id==='foe').x,10000,'clamped to the field');
 let s=createAutoBattle(setup([actor('hero','attacker',0,{energy_per_step:1000,ability:{effect:'damage',power:1,cost:1000,cooldown_steps:3}}),actor('foe','defender',0,{hp:1000,energy:0,attack:0})]));
 const casts=[];for(let i=0;i<7;i++){const out=stepAutoBattle(s);casts.push(out.events.some(e=>e.amount===1&&e.source_id==='hero')?1:0);s=out.state;}
 assert.deepEqual(casts,[1,0,0,1,0,0,1],'full energy but cooldown 3 steps');
});
test('per-faction advantage strength overrides the global default',()=>{
 const r=step(setup([actor('hero','attacker',0,{ability:{effect:'damage',power:100,cost:1000}}),actor('foe','defender',0,{hp:1000,energy:0,attack:0})],[{id:'sun',advantage_ids:['moon'],advantage_bp:15000},{id:'moon',advantage_ids:[]}]));
 assert.equal(r.state.actors.find(a=>a.id==='foe').hp,850);
});
test('content: new effects need battle.abilities.v2; compiler maps stun ms to steps and faction strength',()=>{
 const combat={hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100};
 const content={schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1','battle.combat.v1'],entities:[
  {id:'faction_ural',kind:'faction',name:'Урал',data:{advantage_ids:['faction_steppe'],advantage_bp:13000}},{id:'faction_steppe',kind:'faction',name:'Степь',data:{advantage_ids:[]}},
  {id:'ability_roar',kind:'ability',name:'Рёв',data:{effect:'stun',power:1500,cooldown_ms:3000,target:'all_enemies'}},
  {id:'ability_bite',kind:'ability',name:'Укус',data:{effect:'damage',power:20,cooldown_ms:0}},
  {id:'hero_bear',kind:'hero',name:'Медведь',data:{faction_id:'faction_ural',ability_ids:['ability_roar','ability_bite'],combat}},
  {id:'enemy_wolf',kind:'hero',name:'Волк',data:{faction_id:'faction_steppe',ability_ids:['ability_bite'],combat}}]};
 assert.equal(validate('content',content).ok,false,'capability required');
 content.required_capabilities.push('battle.abilities.v2');assert.equal(validate('content',content).ok,true);
 const bad=structuredClone(content);bad.entities[2].data.effect='teleport';assert.equal(validate('content',bad).ok,false,'unknown effect rejected');
 const {setup:compiled,heroes}=compileContentBattle(content,{attacker_hero_ids:['hero_bear'],defender_hero_ids:['enemy_wolf','enemy_wolf'],seed:3});
 const bear=compiled.actors.find(a=>a.id==='atk_0');
 assert.deepEqual(bear.ability,{id:'ability_roar',effect:'stun',power:15,cost:1000,cooldown_steps:30,target:'all_enemies'});
 assert.equal(compiled.factions.find(f=>f.id==='faction_ural').advantage_bp,13000);
 const a=runAutoBattle(compiled,{heroes}),b=runAutoBattle(structuredClone(compiled),{heroes});
 assert.deepEqual(a,b);assert.equal(validate('battle_preview',{api_version:1,preview:true,draft_id:'00000000-0000-4000-8000-000000000001',draft_revision:0,...a}).ok,true);
});
test('budget: 5v5 with area stun and knockback every step stays bounded',()=>{
 const actors=[];for(let i=0;i<5;i++){actors.push(actor(`hero_${i}`,'attacker',i,{hp:1000000,energy_per_step:1000,ability:{effect:i%2?'knockback':'stun',power:i%2?300:2,cost:1000,target:'all_enemies'},auto_abilities:[{id:'auto_hit',effect:'damage',power:1,interval_steps:1,target:'all_enemies'}]}));actors.push(actor(`foe_${i}`,'defender',i,{hp:1000000,energy_per_step:1000,speed:500,ability:{effect:'damage',power:1,cost:1000,target:'all_enemies'}}));}
 let s=createAutoBattle(setup(actors)),events=0;const t=performance.now();
 while(s.result===null){const r=stepAutoBattle(s);events+=r.events.length;s=r.state;}
 const ms=performance.now()-t;assert.equal(s.step,900);console.log(`budget probe: 10 actors, AoE stun/knockback, ${events} events, ${ms.toFixed(1)} ms (local)`);
});
