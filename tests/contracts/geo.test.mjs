import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate,locationProblems,BASHKORTOSTAN_BOUNDS} from '@ufagame/contracts';
const dataset=JSON.parse(readFileSync(new URL('../../content/geo/bashkortostan.locations.json',import.meta.url)));
const content=(entities)=>({schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1','world.locations.v1'],entities:structuredClone(entities)});
const point=(o={})=>({id:'point_shulgan_tash',kind:'location',name:'Шульган-Таш',data:{level:'point',parent_id:'district_burzyanskiy',lat_e6:53045000,lon_e6:57052000,source:{kind:'manual',note:'Пещера Шульган-Таш (Капова), проверить по источнику'},...o}});

test('Wikidata set: 1 republic, 54 districts, 9 cities, unique ids, sources, inside the republic',()=>{
 const levels=dataset.entities.reduce((m,e)=>({...m,[e.data.level]:(m[e.data.level]??0)+1}),{});
 assert.deepEqual(levels,{republic:1,district:54,city:9});
 assert.equal(new Set(dataset.entities.map(e=>e.id)).size,64);
 assert.ok(dataset.entities.every(e=>e.data.source.kind==='wikidata'&&/^Q\d+$/.test(e.data.source.id)&&e.data.name_ba));
 assert.equal(dataset.license,'CC0-1.0 (Wikidata)');
 assert.equal(validate('content',content(dataset.entities)).ok,true);assert.deepEqual(locationProblems(content(dataset.entities)),[]);
 const ufa=dataset.entities.find(e=>e.id==='city_ufa');assert.ok(Math.abs(ufa.data.lat_e6-54726111)<50000&&Math.abs(ufa.data.lon_e6-55947500)<50000,'Ufa near 54.73N 55.95E');
 const fed=dataset.entities.find(e=>e.id==='district_fedorovskiy');assert.ok(fed.data.source.corrected,'known Wikidata error is corrected and marked');
});
test('OSM cross-check report: every district/city name matches and lies inside its OSM boundary box',()=>{
 const report=JSON.parse(readFileSync(new URL('../../docs/reports/S21-geo-check.json',import.meta.url)));
 assert.equal(report.summary.total,63);assert.equal(report.summary.ok,63);assert.match(report.attribution,/OpenStreetMap/);
});
test('hierarchy, missing parent, coordinates, distance and stage link are enforced',()=>{
 const base=dataset.entities;
 assert.equal(validate('content',content([...base,point()])).ok,true);
 const code=(entities)=>locationProblems(content(entities)).map(p=>p.code);
 assert.deepEqual(code([...base,point({parent_id:'district_missing'})]),['LOCATION_PARENT_INVALID'],'missing parent (lost point)');
 assert.deepEqual(code([...base,point({parent_id:'republic_bashkortostan'})]),['LOCATION_PARENT_INVALID'],'point must be under a district or city');
 assert.deepEqual(code([...base,point({lat_e6:59000000})]),['LOCATION_OUTSIDE_REPUBLIC']);
 assert.deepEqual(code([...base,point({parent_id:'city_neftekamsk'})]),['LOCATION_TOO_FAR'],'Burzyan cave is not in Neftekamsk');
 assert.deepEqual(code([...base,{...base[0],id:'republic_two'}]),['LOCATION_REPUBLIC_DUPLICATE']);
 const stage=loc=>({id:'stage_cave',kind:'stage',name:'Пещера',data:{enemy_hero_ids:['hero_one'],time_limit_ms:90000,location_id:loc}});
 assert.deepEqual(code([...base,point(),stage('point_shulgan_tash')]),[]);
 assert.deepEqual(code([...base,stage('district_burzyanskiy')]),['STAGE_LOCATION_INVALID'],'stage needs a point');
 assert.deepEqual(code([...base,stage('point_gone')]),['STAGE_LOCATION_INVALID'],'stage on a removed point');
 const noCap=content([...base,point()]);noCap.required_capabilities=['content.core.v1'];assert.equal(validate('content',noCap).ok,false);
 assert.ok(BASHKORTOSTAN_BOUNDS.min_lat_e6<51863611&&BASHKORTOSTAN_BOUNDS.max_lon_e6>59383300);
});
test('campaign dependencies: missing stage, stage in two chapters, duplicate order, wrong area, duplicate reward currency',async()=>{
 const {campaignProblems}=await import('@ufagame/contracts');
 const base=()=>({schema_version:1,content_version:'draft_d',required_capabilities:['content.core.v1','campaign.chapters.v1','world.locations.v1'],entities:[...structuredClone(dataset.entities),
  {id:'hero_one',kind:'hero',name:'H',data:{faction_id:'faction_one',ability_ids:['ability_one']}},{id:'faction_one',kind:'faction',name:'F',data:{advantage_ids:[]}},{id:'ability_one',kind:'ability',name:'A',data:{effect:'damage',power:1,cooldown_ms:0}},
  {id:'stage_a',kind:'stage',name:'A',data:{enemy_hero_ids:['hero_one'],time_limit_ms:90000,rewards_first:[{currency:'gold',amount:10}]}},
  {id:'stage_b',kind:'stage',name:'B',data:{enemy_hero_ids:['hero_one'],time_limit_ms:90000,boss:true}},
  {id:'chapter_one',kind:'chapter',name:'Глава 1',data:{order:1,stage_ids:['stage_a','stage_b'],location_id:'district_burzyanskiy'}}]});
 assert.equal(validate('content',base()).ok,true);
 const code=fn=>{const c=base();fn(c.entities);return campaignProblems(c).map(p=>p.code);};
 assert.deepEqual(code(e=>e.find(x=>x.id==='chapter_one').data.stage_ids.push('stage_gone')),['CHAPTER_STAGE_INVALID']);
 assert.deepEqual(code(e=>e.push({id:'chapter_two',kind:'chapter',name:'2',data:{order:2,stage_ids:['stage_b']}})),['STAGE_IN_TWO_CHAPTERS']);
 assert.deepEqual(code(e=>e.push({id:'chapter_two',kind:'chapter',name:'2',data:{order:1,stage_ids:[]}})).slice(0,1),['CHAPTER_ORDER_DUPLICATE']);
 assert.deepEqual(code(e=>{e.find(x=>x.id==='chapter_one').data.location_id='republic_bashkortostan';}),['CHAPTER_LOCATION_INVALID']);
 assert.deepEqual(code(e=>{e.find(x=>x.id==='stage_a').data.rewards_first.push({currency:'gold',amount:1});}),['REWARD_DUPLICATE_CURRENCY']);
 const noCap=base();noCap.required_capabilities=['content.core.v1','world.locations.v1'];assert.equal(validate('content',noCap).ok,false);
});
