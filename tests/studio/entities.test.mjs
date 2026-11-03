import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '@ufagame/contracts';
import {listEntities,upsertEntity,deleteEntity} from '../../apps/studio-web/src/entities.mjs';
const blank=()=>JSON.stringify({schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1'],entities:[]});
const ability={id:'ability_one',name:'Удар',kind:'ability',data:{effect:'damage',power:10,cooldown_ms:1000}};
const faction={id:'faction_one',name:'Первая',kind:'faction',data:{advantage_ids:[]}};
const hero={id:'hero_one',name:'Герой',kind:'hero',data:{faction_id:'faction_one',ability_ids:['ability_one']}};
test('create, edit and delete supported entities while preserving a valid draft',()=>{
 let text=blank();for(const entity of [ability,faction,hero])text=upsertEntity(text,entity);
 assert.equal(validate('content',JSON.parse(text)).ok,true);assert.equal(listEntities(text).length,3);
 text=upsertEntity(text,{...ability,name:'Новый удар'},ability.id);assert.equal(listEntities(text)[0].name,'Новый удар');
 text=deleteEntity(text,hero.id);text=deleteEntity(text,ability.id);assert.equal(validate('content',JSON.parse(text)).ok,true);
});
test('rejects broken links, duplicate ids, invalid values and referenced deletion',()=>{
 let text=upsertEntity(blank(),ability);text=upsertEntity(text,faction);text=upsertEntity(text,hero);
 assert.throws(()=>upsertEntity(text,ability),/ID уже используется/);
 assert.throws(()=>upsertEntity(text,{...hero,id:'hero_two',data:{...hero.data,faction_id:'missing_faction'}}),/фракцию/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,power:-1}}),/силу/);
 assert.throws(()=>deleteEntity(text,'ability_one'),/ссылку/);assert.throws(()=>deleteEntity(text,'faction_one'),/ссылку/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'renamed'},'ability_one'),/ID существующего/);
});
test('invalid JSON and conflicting IDs are rejected without modifying the input',()=>{
 assert.throws(()=>upsertEntity('{',ability),/JSON/);
 const broken=JSON.stringify({entities:[ability,ability]});assert.throws(()=>listEntities(broken),/повторяющиеся/);
 const src=blank();assert.throws(()=>upsertEntity(src,hero),/фракцию/);assert.equal(JSON.parse(src).entities.length,0);
});
test('hero combat stats and ability energy cost keep battle.combat.v1 capability in sync',()=>{
 const combat={hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100};
 let text=upsertEntity(blank(),ability);text=upsertEntity(text,faction);text=upsertEntity(text,{...hero,data:{...hero.data,combat}});
 assert.ok(JSON.parse(text).required_capabilities.includes('battle.combat.v1'));assert.equal(validate('content',JSON.parse(text)).ok,true);
 assert.throws(()=>upsertEntity(text,{...hero,id:'hero_two',data:{...hero.data,combat:{...combat,attack_interval_ms:150}}}),/attack_interval_ms.*кратное 100/);
 assert.throws(()=>upsertEntity(text,{...hero,id:'hero_two',data:{...hero.data,combat:{...combat,hp:0}}}),/hp/);
 assert.throws(()=>upsertEntity(text,{...hero,id:'hero_two',data:{...hero.data,combat:{...combat,crit:1}}}),/боевые параметры/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,energy_cost:0}}),/энергии/);
 text=upsertEntity(text,{...hero,data:{...hero.data}},hero.id);
 assert.ok(!JSON.parse(text).required_capabilities.includes('battle.combat.v1'),'capability removed when no combat data left');
 text=upsertEntity(text,{...ability,data:{...ability.data,energy_cost:400}},ability.id);
 assert.ok(JSON.parse(text).required_capabilities.includes('battle.combat.v1'));assert.equal(validate('content',JSON.parse(text)).ok,true);
});
test('sprite and sound references toggle content.resources.v1 and reject malformed ids',()=>{
 let text=upsertEntity(blank(),{...ability,data:{...ability.data,sound_resource_id:'sound_hit'}});text=upsertEntity(text,faction);
 text=upsertEntity(text,{...hero,data:{...hero.data,sprite_resource_id:'hero_sprite'}});
 assert.ok(JSON.parse(text).required_capabilities.includes('content.resources.v1'));assert.equal(validate('content',JSON.parse(text)).ok,true);
 assert.throws(()=>upsertEntity(text,{...hero,id:'hero_two',data:{...hero.data,sprite_resource_id:'Bad Id'}}),/изображения/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,sound_resource_id:'../x'}}),/звука/);
 text=upsertEntity(text,{...hero},hero.id);text=upsertEntity(text,{...ability},ability.id);
 assert.ok(!JSON.parse(text).required_capabilities.includes('content.resources.v1'));
});
import {suggestId,quickStartHero} from '../../apps/studio-web/src/entities.mjs';
test('IDs are generated from Russian/Bashkir names and stay unique',()=>{
 assert.equal(suggestId('Батыр','hero'),'hero_batyr');assert.equal(suggestId('Салауат Юлаев','hero'),'hero_salauat_yulaev');
 assert.equal(suggestId('Ҡыҙ','hero'),'hero_kyz');assert.equal(suggestId('!!!','ability'),'ability_new');
 assert.equal(suggestId('Батыр','hero',['hero_batyr','hero_batyr_2']),'hero_batyr_3');assert.equal(suggestId('5555','sprite'),'sprite_5555');
});
test('quick start creates faction, strike and a battle-ready hero in one valid step',()=>{
 let text=quickStartHero(blank(),{name:'Батыр',spriteId:'hero_sprite'});const c=JSON.parse(text);
 assert.deepEqual(c.entities.map(e=>e.id),['faction_neytralnye','ability_udar','hero_batyr']);
 assert.equal(c.entities[2].data.sprite_resource_id,'hero_sprite');assert.ok(c.entities[2].data.combat);
 assert.ok(c.required_capabilities.includes('battle.combat.v1')&&c.required_capabilities.includes('content.resources.v1'));assert.equal(validate('content',c).ok,true);
 text=quickStartHero(text,{name:'Батыр'});assert.equal(JSON.parse(text).entities.length,4,'reuses faction and ability, new unique hero id');
 assert.equal(JSON.parse(text).entities[3].id,'hero_batyr_2');
});
import {missingResourceRefs,dropResourceRef} from '../../apps/studio-web/src/entities.mjs';
test('missing picture/sound links are found and can be removed without touching the rest',()=>{
 let text=upsertEntity(blank(),{...ability,data:{...ability.data,sound_resource_id:'sound_hit'}});text=upsertEntity(text,faction);
 text=upsertEntity(text,{...hero,name:'Heroes',data:{...hero.data,sprite_resource_id:'hero_sprite'}});
 const res=[{id:'sound_hit',media_type:'audio/wav'}];
 assert.deepEqual(missingResourceRefs(text,res),[{entity_id:'hero_one',entity_name:'Heroes',resource_id:'hero_sprite',what:'картинка'}]);
 assert.equal(missingResourceRefs(text,[{id:'hero_sprite',media_type:'audio/wav'},...res]).length,1,'wrong type is also missing');
 text=dropResourceRef(text,'hero_one');assert.deepEqual(missingResourceRefs(text,res),[]);
 const c=JSON.parse(text);assert.equal(c.entities.find(e=>e.id==='hero_one').data.faction_id,'faction_one');assert.equal(validate('content',c).ok,true);
 assert.ok(c.required_capabilities.includes('content.resources.v1'),'sound link remains');
});
test('stun/knockback, ability targets and faction strength toggle battle.abilities.v2',()=>{
 let text=upsertEntity(blank(),{...ability,data:{...ability.data,effect:'stun',power:1500,target:'all_enemies'}});
 assert.ok(JSON.parse(text).required_capabilities.includes('battle.abilities.v2'));assert.equal(validate('content',JSON.parse(text)).ok,true);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,target:'everyone'}}),/цель/);
 assert.throws(()=>upsertEntity(text,{...faction,data:{advantage_ids:[],advantage_bp:25000}}),/преимущества/);
 text=upsertEntity(text,{...ability},ability.id);assert.ok(!JSON.parse(text).required_capabilities.includes('battle.abilities.v2'));
 text=upsertEntity(text,{...faction,data:{advantage_ids:[],advantage_bp:15000}});assert.ok(JSON.parse(text).required_capabilities.includes('battle.abilities.v2'));assert.equal(validate('content',JSON.parse(text)).ok,true);
});
test('stages: 1–5 existing heroes, fixed 90 s, protected from deleting their enemies',()=>{
 let text=upsertEntity(blank(),ability);text=upsertEntity(text,faction);text=upsertEntity(text,hero);
 const stage={id:'stage_edge',kind:'stage',name:'Край степи',data:{enemy_hero_ids:['hero_one','hero_one'],time_limit_ms:90000}};
 text=upsertEntity(text,stage);assert.equal(validate('content',JSON.parse(text)).ok,true);
 assert.throws(()=>upsertEntity(text,{...stage,id:'stage_two',data:{enemy_hero_ids:[],time_limit_ms:90000}}),/противников/);
 assert.throws(()=>upsertEntity(text,{...stage,id:'stage_two',data:{enemy_hero_ids:['ability_one'],time_limit_ms:90000}}),/противников/);
 assert.throws(()=>upsertEntity(text,{...stage,id:'stage_two',data:{enemy_hero_ids:['hero_one'],time_limit_ms:30000}}),/90 секунд/);
 assert.throws(()=>deleteEntity(text,'hero_one'),/ссылку/);
 assert.equal(listEntities(text).some(e=>e.kind==='stage'),true);
});
import {importGeography,listLocations} from '../../apps/studio-web/src/entities.mjs';
import {readFileSync} from 'node:fs';
const geo=JSON.parse(readFileSync(new URL('../../content/geo/bashkortostan.locations.json',import.meta.url)));
test('geography: import once, add a point, protect linked places, stage needs a point',()=>{
 let {text,added}=importGeography(blank(),geo);assert.equal(added,64);assert.ok(JSON.parse(text).required_capabilities.includes('world.locations.v1'));
 assert.equal(importGeography(text,geo).added,0,'repeat import adds nothing');assert.equal(validate('content',JSON.parse(text)).ok,true);
 const pt={id:'point_shulgan_tash',kind:'location',name:'Шульган-Таш',data:{level:'point',parent_id:'district_burzyanskiy',lat_e6:53045000,lon_e6:57052000,source:{kind:'manual'}}};
 text=upsertEntity(text,pt);assert.equal(listLocations(text).length,65);assert.equal(listEntities(text).length,0,'locations stay out of the object list');
 assert.throws(()=>upsertEntity(text,{...pt,id:'point_far',data:{...pt.data,parent_id:'city_neftekamsk'}}),/150 км/);
 assert.throws(()=>upsertEntity(text,{...pt,id:'point_lost',data:{...pt.data,parent_id:'district_nowhere'}}),/внутри района/);
 assert.throws(()=>upsertEntity(text,{...pt,id:'point_out',data:{...pt.data,lat_e6:58000000}}),/вне Башкортостана/);
 text=upsertEntity(text,ability);text=upsertEntity(text,faction);text=upsertEntity(text,hero);
 assert.throws(()=>upsertEntity(text,{id:'stage_x',kind:'stage',name:'X',data:{enemy_hero_ids:['hero_one'],time_limit_ms:90000,location_id:'district_burzyanskiy'}}),/точке/);
 text=upsertEntity(text,{id:'stage_cave',kind:'stage',name:'Пещера',data:{enemy_hero_ids:['hero_one'],time_limit_ms:90000,location_id:'point_shulgan_tash'}});
 assert.equal(validate('content',JSON.parse(text)).ok,true);
 assert.throws(()=>deleteEntity(text,'point_shulgan_tash'),/ссылку/,'linked point cannot vanish');
 assert.throws(()=>deleteEntity(text,'district_burzyanskiy'),/ссылку/,'district with points cannot vanish');
});
test('trigger and extra actions: capability, limits and unknown blocks',()=>{
 let text=upsertEntity(blank(),{...ability,data:{...ability.data,trigger:{kind:'self_hp_below',percent:40},extra_effects:[{effect:'stun',power:500}]}});
 const c=JSON.parse(text);assert.ok(c.required_capabilities.includes('battle.triggers.v1')&&c.required_capabilities.includes('battle.abilities.v2'));assert.equal(validate('content',c).ok,true);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,trigger:{kind:'on_crit'}}}),/Неизвестное условие/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,trigger:{kind:'self_hp_below'}}}),/Порог/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,extra_effects:[1,2,3].map(()=>({effect:'damage',power:1}))}}),/двух/);
 assert.throws(()=>upsertEntity(text,{...ability,id:'ability_two',data:{...ability.data,extra_effects:[{effect:'teleport',power:1}]}}),/дополнительные/);
 text=upsertEntity(text,{...ability},ability.id);assert.ok(!JSON.parse(text).required_capabilities.includes('battle.triggers.v1'));
});
test('chapters: ordered stages, one chapter per stage, unique order, area, rewards; capability; protected stages',()=>{
 let text=upsertEntity(blank(),ability);text=upsertEntity(text,faction);text=upsertEntity(text,hero);
 const stage=(id,extra={})=>({id,kind:'stage',name:id,data:{enemy_hero_ids:['hero_one'],time_limit_ms:90000,...extra}});
 text=upsertEntity(text,stage('stage_a',{rewards_first:[{currency:'gold',amount:100}]}));text=upsertEntity(text,stage('stage_b',{boss:true}));
 assert.throws(()=>upsertEntity(text,stage('stage_c',{rewards_first:[{currency:'gold',amount:1},{currency:'gold',amount:2}]})),/Награда/);
 const chapter={id:'chapter_one',kind:'chapter',name:'Глава 1',data:{order:1,stage_ids:['stage_a','stage_b']}};
 text=upsertEntity(text,chapter);const c=JSON.parse(text);assert.ok(c.required_capabilities.includes('campaign.chapters.v1'));assert.equal(validate('content',c).ok,true);
 assert.throws(()=>upsertEntity(text,{...chapter,id:'chapter_two',data:{order:2,stage_ids:['stage_b']}}),/уже стоит/);
 assert.throws(()=>upsertEntity(text,{...chapter,id:'chapter_two',data:{order:1,stage_ids:['stage_a']}}),/номером/);
 assert.throws(()=>upsertEntity(text,{...chapter,id:'chapter_two',data:{order:2,stage_ids:['stage_gone']}}),/этапы/);
 assert.throws(()=>deleteEntity(text,'stage_b'),/ссылку/,'a stage in a chapter cannot vanish');
 assert.equal(listEntities(text).some(e=>e.kind==='chapter'),true);
});
