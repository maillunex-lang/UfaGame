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
