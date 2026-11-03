import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutoBattle,stepAutoBattle} from '../../packages/battle-core/auto.mjs';
import {compileContentBattle,runAutoBattle} from '../../packages/battle-core/compile.mjs';
import {validate} from '@ufagame/contracts';
const actor=(id,team,slot,o={})=>({id,team,slot,hp:100,attack:0,defense:0,speed:0,range:20000,interval_steps:1,energy:0,energy_per_step:0,energy_per_attack:0,faction_id:'one',ability:{effect:'damage',power:1,cost:1000},...o});
const setup=actors=>({simulation_version:2,seed:3,advantage_bp:12000,factions:[{id:'one',advantage_ids:[]}],actors});
const run=(s,n)=>{const ev=[];for(let i=0;i<n&&s.result===null;i++){const r=stepAutoBattle(s);ev.push({step:i,events:r.events});s=r.state;}return {state:s,ev};};

test('self_hp_below heal fires only under the threshold and respects its cooldown',()=>{
 const hero=actor('hero','attacker',0,{auto_abilities:[{id:'auto_patch',effect:'heal',power:5,interval_steps:5,target:'self',trigger:{kind:'self_hp_below',percent:50}}]});
 const foe=actor('foe','defender',0,{attack:10,hp:100000});
 const {ev}=run(createAutoBattle(setup([hero,foe])),20);
 const heals=ev.filter(s=>s.events.some(e=>e.ability_id==='auto_patch')).map(s=>s.step);
 assert.ok(heals.length>0&&heals.every((s,i)=>i===0||s-heals[i-1]>=5),'cooldown between heals: '+heals);
 const first=heals[0];assert.ok(first>=5,'no heal while above 50% HP (first at step '+first+')');
});
test('ally_hp_below helps a wounded ally; battle_start fires once; extra effects chain',()=>{
 const medic=actor('medic','attacker',0,{auto_abilities:[{id:'auto_aid',effect:'heal',power:20,interval_steps:1,trigger:{kind:'ally_hp_below',percent:30}}]});
 const tank=actor('tank','attacker',1,{hp:100});const foe=actor('foe','defender',0,{hp:100000});
 const s=createAutoBattle(setup([medic,tank,foe]));s.actors.find(a=>a.id==='tank').hp=20;
 const r=stepAutoBattle(s);const aid=r.events.find(e=>e.ability_id==='auto_aid');assert.equal(aid.target_id,'tank');
 const opener=actor('hero','attacker',0,{auto_abilities:[{id:'auto_roar',effect:'damage',power:10,interval_steps:1,trigger:{kind:'battle_start'},extra_effects:[{effect:'stun',power:3,target:'enemy'}]}]});
 const {ev}=run(createAutoBattle(setup([opener,actor('foe','defender',0,{hp:100000})])),15);
 const roars=ev.flatMap(s=>s.events.filter(e=>e.ability_id==='auto_roar'));
 assert.deepEqual(roars.map(e=>e.kind),['damage','stun'],'fires once with its extra stun');
});
test('content: triggers/extra effects need battle.triggers.v1, unsupported blocks are rejected, compiler keeps them',()=>{
 const combat={hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100};
 const content={schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1','battle.combat.v1','battle.triggers.v1','battle.abilities.v2'],entities:[
  {id:'faction_one',kind:'faction',name:'Ф',data:{advantage_ids:[]}},
  {id:'ability_strike',kind:'ability',name:'Удар',data:{effect:'damage',power:50,cooldown_ms:1000,extra_effects:[{effect:'stun',power:500}]}},
  {id:'ability_second_wind',kind:'ability',name:'Второе дыхание',data:{effect:'heal',power:40,cooldown_ms:5000,target:'self',trigger:{kind:'self_hp_below',percent:40}}},
  {id:'hero_one',kind:'hero',name:'Батыр',data:{faction_id:'faction_one',ability_ids:['ability_strike','ability_second_wind'],combat}},
  {id:'enemy_one',kind:'hero',name:'Волк',data:{faction_id:'faction_one',ability_ids:['ability_strike'],combat}}]};
 assert.equal(validate('content',content).ok,true);
 const noCap={...content,required_capabilities:['content.core.v1','battle.combat.v1','battle.abilities.v2']};assert.equal(validate('content',noCap).ok,false);
 const mutate=fn=>{const c=structuredClone(content);fn(c.entities.find(e=>e.id==='ability_second_wind').data);return validate('content',c).ok;};
 assert.equal(mutate(d=>{d.trigger={kind:'on_crit'};}),false,'unknown trigger block');
 assert.equal(mutate(d=>{d.trigger={kind:'self_hp_below'};}),false,'percent required');
 assert.equal(mutate(d=>{d.trigger={kind:'battle_start',percent:10};}),false,'percent not allowed');
 assert.equal(mutate(d=>{d.extra_effects=[{effect:'damage',power:1},{effect:'damage',power:1},{effect:'damage',power:1}];}),false,'max 2 extra actions');
 assert.equal(mutate(d=>{d.extra_effects=[{effect:'teleport',power:1}];}),false,'unknown action block');
 const {setup:compiled,heroes}=compileContentBattle(content,{attacker_hero_ids:['hero_one'],defender_hero_ids:['enemy_one'],seed:9});
 const hero=compiled.actors.find(a=>a.id==='atk_0');
 assert.deepEqual(hero.ability.extra_effects,[{effect:'stun',power:5}]);
 assert.deepEqual(hero.auto_abilities[0].trigger,{kind:'self_hp_below',percent:40});
 const a=runAutoBattle(compiled,{heroes}),b=runAutoBattle(structuredClone(compiled),{heroes});assert.deepEqual(a,b,'deterministic');
});
