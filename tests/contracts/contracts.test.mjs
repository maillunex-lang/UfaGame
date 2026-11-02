import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate,negotiate} from '@ufagame/contracts';
const fixture=n=>JSON.parse(readFileSync(new URL(`../../packages/contracts/fixtures/${n}.json`,import.meta.url)));
for (const name of ['content','battle_snapshot','battle_event','ledger_entry']) test(`${name}: roundtrip and unknown fields`,()=>{
 const good=fixture(name); assert.equal(validate(name,JSON.parse(JSON.stringify(good))).ok,true);
 assert.equal(validate(name,{...good,unknown:true}).ok,false);
});
test('content: unknown capability/type, duplicates, dangling links',()=>{
 for(const mutate of [c=>c.required_capabilities.push('arbitrary.code.v1'),c=>c.entities[0].kind='execute',c=>c.entities.push(c.entities[0]),c=>c.entities[2].data.faction_id='missing_id']) {
  const c=fixture('content');mutate(c);assert.equal(validate('content',c).ok,false);
 }
 assert.equal(negotiate(['battle.hp.v1'],[]),false);assert.equal(negotiate([],undefined,2),false);
});
test('event rejects fractional seq, negative hp, unsupported kind; secrets reject device ID',()=>{
 for(const patch of [{seq:1.5},{hp:-1},{kind:'reward'}])assert.equal(validate('battle_event',{...fixture('battle_event'),...patch}).ok,false);
 assert.equal(validate('guest_request',{installation_secret:'device-123'}).ok,false);
});
