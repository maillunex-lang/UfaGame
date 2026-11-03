import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '@ufagame/contracts';
import {compileContentBattle,runAutoBattle,BattleCompileError,ADVANTAGE_BP} from '../../packages/battle-core/compile.mjs';

const combat=(overrides={})=>({hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100,...overrides});
const hero=(id,faction,abilities,c=combat())=>({id,kind:'hero',name:id,data:{faction_id:faction,ability_ids:abilities,...(c?{combat:c}:{})}});
const ability=(id,effect,power,cooldown_ms,extra={})=>({id,kind:'ability',name:id,data:{effect,power,cooldown_ms,...extra}});
function content(){return {schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1','battle.combat.v1'],entities:[
 {id:'faction_sun',kind:'faction',name:'Солнце',data:{advantage_ids:['faction_moon']}},
 {id:'faction_moon',kind:'faction',name:'Луна',data:{advantage_ids:[]}},
 ability('ability_strike','damage',80,1000,{energy_cost:500}),
 ability('ability_mend','heal',40,2000),
 ability('ability_spark','damage',15,700),
 hero('hero_batyr','faction_sun',['ability_strike','ability_spark']),
 hero('hero_healer','faction_sun',['ability_mend'],combat({hp:200,attack:10,range:6000})),
 hero('enemy_wolf','faction_moon',['ability_strike'],combat({hp:250,speed:1200})),
 {id:'stage_forest',kind:'stage',name:'Лес',data:{enemy_hero_ids:['enemy_wolf','enemy_wolf','enemy_wolf'],time_limit_ms:90000}},
]};}
const code=(fn)=>{try{fn();}catch(e){assert.ok(e instanceof BattleCompileError,String(e));return [e.code,e.entity_id];}assert.fail('expected BattleCompileError');};

test('content with combat stats passes the contract only with battle.combat.v1',()=>{
 const c=content();assert.equal(validate('content',c).ok,true);
 c.required_capabilities=['content.core.v1'];assert.equal(validate('content',c).ok,false);
 const bad=content();bad.entities.find(e=>e.id==='hero_batyr').data.combat.attack_interval_ms=150;assert.equal(validate('content',bad).ok,false);
 const extra=content();extra.entities.find(e=>e.id==='hero_batyr').data.combat.crit=5;assert.equal(validate('content',extra).ok,false);
});
test('compiler maps heroes, abilities, factions and stage to the v2 setup',()=>{
 const {setup,heroes}=compileContentBattle(content(),{attacker_hero_ids:['hero_batyr','hero_healer'],stage_id:'stage_forest',seed:7});
 assert.equal(setup.advantage_bp,ADVANTAGE_BP);assert.equal(setup.actors.length,5);
 const atk=setup.actors.find(a=>a.id==='atk_0');
 assert.deepEqual(atk.ability,{id:'ability_strike',effect:'damage',power:80,cost:500,cooldown_steps:10});
 assert.deepEqual(atk.auto_abilities,[{id:'ability_spark',effect:'damage',power:15,interval_steps:7}]);
 assert.equal(atk.interval_steps,5);assert.equal(atk.energy_per_step,10);
 assert.equal(setup.actors.find(a=>a.id==='atk_1').ability.cost,1000,'default cost is full energy');
 assert.deepEqual(setup.factions,[{id:'faction_moon',advantage_ids:[]},{id:'faction_sun',advantage_ids:['faction_moon']}]);
 assert.equal(heroes.def_2,'enemy_wolf');
});
test('same content+seed replays to identical log hash; different seed is still bounded',()=>{
 const request={attacker_hero_ids:['hero_batyr','hero_healer'],stage_id:'stage_forest',seed:99};
 const {setup,heroes}=compileContentBattle(content(),request);
 const first=runAutoBattle(setup,{heroes}),second=runAutoBattle(structuredClone(setup),{heroes});
 assert.deepEqual(first,second);assert.match(first.event_log_sha256,/^[0-9a-f]{64}$/);
 assert.ok(['attacker_win','attacker_loss'].includes(first.result));assert.ok(first.steps<=900);
 assert.equal(first.frames[0].at_ms,0);assert.equal(first.frames.at(-1).at_ms,first.duration_ms);
 assert.ok(first.frames.length<=182);assert.ok(first.events.length<=500);
 const dealt=first.actors.reduce((s,a)=>s+a.damage_dealt,0),taken=first.actors.reduce((s,a)=>s+a.damage_taken,0);assert.equal(dealt,taken);
 assert.ok(first.events.some(e=>e.ability_id==='ability_spark'));
 const preview={api_version:1,preview:true,draft_id:'00000000-0000-4000-8000-000000000001',draft_revision:0,...first};
 assert.equal(validate('battle_preview',preview).ok,true);
});
test('timeout of a passive battle is an attacker loss at 90 seconds',()=>{
 const c=content();for(const e of c.entities)if(e.kind==='hero')e.data.combat={...e.data.combat,attack:0,speed:0,range:0};
 for(const e of c.entities)if(e.kind==='ability')e.data.power=0;
 const {setup}=compileContentBattle(c,{attacker_hero_ids:['hero_batyr'],defender_hero_ids:['enemy_wolf'],seed:1});
 const r=runAutoBattle(setup);assert.equal(r.result,'attacker_loss');assert.equal(r.steps,900);assert.equal(r.duration_ms,90000);assert.equal(r.frames.length,181);
});
test('event list is truncated but hash and totals cover the whole log',()=>{
 const {setup}=compileContentBattle(content(),{attacker_hero_ids:['hero_batyr'],defender_hero_ids:['enemy_wolf'],seed:3});
 const full=runAutoBattle(setup),cut=runAutoBattle(setup,{maxEvents:2});
 assert.equal(cut.events.length,2);assert.equal(cut.events_truncated,true);assert.equal(cut.event_log_sha256,full.event_log_sha256);assert.deepEqual(cut.actors,full.actors);
});
test('negative: missing stats, unknown/wrong-kind references, team size, cooldown, factions, seed',()=>{
 const noStats=content();noStats.entities.push(hero('hero_plain','faction_sun',['ability_strike'],null));
 assert.deepEqual(code(()=>compileContentBattle(noStats,{attacker_hero_ids:['hero_plain'],defender_hero_ids:['enemy_wolf'],seed:1})),['HERO_COMBAT_MISSING','hero_plain']);
 assert.deepEqual(code(()=>compileContentBattle(content(),{attacker_hero_ids:['ability_strike'],defender_hero_ids:['enemy_wolf'],seed:1})),['UNKNOWN_HERO','ability_strike']);
 assert.deepEqual(code(()=>compileContentBattle(content(),{attacker_hero_ids:['hero_batyr'],stage_id:'hero_batyr',seed:1})),['UNKNOWN_STAGE','hero_batyr']);
 assert.deepEqual(code(()=>compileContentBattle(content(),{attacker_hero_ids:Array(6).fill('hero_batyr'),defender_hero_ids:['enemy_wolf'],seed:1})),['INVALID_TEAM_SIZE',null]);
 assert.deepEqual(code(()=>compileContentBattle(content(),{attacker_hero_ids:['hero_batyr'],defender_hero_ids:[],seed:1})),['INVALID_TEAM_SIZE',null]);
 assert.deepEqual(code(()=>compileContentBattle(content(),{attacker_hero_ids:['hero_batyr'],defender_hero_ids:['enemy_wolf'],stage_id:'stage_forest',seed:1})),['INVALID_REQUEST',null]);
 assert.deepEqual(code(()=>compileContentBattle(content(),{attacker_hero_ids:['hero_batyr'],defender_hero_ids:['enemy_wolf'],seed:-1})),['INVALID_REQUEST',null]);
 const slow=content();slow.entities.find(e=>e.id==='ability_spark').data.cooldown_ms=90001;
 assert.deepEqual(code(()=>compileContentBattle(slow,{attacker_hero_ids:['hero_batyr'],defender_hero_ids:['enemy_wolf'],seed:1})),['ABILITY_COOLDOWN_TOO_LONG','ability_spark']);
 const many=content();const ids=[];for(let i=0;i<7;i++){many.entities.push({id:`faction_x${i}`,kind:'faction',name:'x',data:{advantage_ids:[]}});many.entities.push(hero(`hero_x${i}`,`faction_x${i}`,['ability_strike']));ids.push(`hero_x${i}`);}
 assert.deepEqual(code(()=>compileContentBattle(many,{attacker_hero_ids:ids.slice(0,5),defender_hero_ids:ids.slice(5),seed:1})),['TOO_MANY_FACTIONS',null]);
 const dangling=content();dangling.entities.find(e=>e.id==='hero_batyr').data.ability_ids=['ability_gone'];
 assert.deepEqual(code(()=>compileContentBattle(dangling,{attacker_hero_ids:['hero_batyr'],defender_hero_ids:['enemy_wolf'],seed:1})),['UNKNOWN_ABILITY','ability_gone']);
});
test('budget: 5v5 worst-case battle stays under the 900-step structural limit',()=>{
 const c=content();for(const e of c.entities)if(e.kind==='hero')e.data.combat={...e.data.combat,hp:1000000,defense:1000000,range:20000,attack_interval_ms:100};
 const {setup}=compileContentBattle(c,{attacker_hero_ids:Array(5).fill('hero_batyr'),defender_hero_ids:Array(5).fill('enemy_wolf'),seed:5});
 const started=performance.now(),r=runAutoBattle(setup);const elapsed=performance.now()-started;
 assert.equal(r.steps,900);assert.ok(r.event_count>0);
 console.log(`budget probe: 10 actors, ${r.steps} steps, ${r.event_count} events, ${elapsed.toFixed(1)} ms (local, not a VPS measurement)`);
});
