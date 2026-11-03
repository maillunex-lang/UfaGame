import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crc32,deflateSync} from 'node:zlib';
import {inspectArchive} from '../../packages/content-validator/archive.mjs';
import {exportContent,dependencyClosure} from '../../packages/content-validator/export.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/content.json',import.meta.url)));
const chunk=(n,d)=>{const t=Buffer.from(n),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(d.length);c.writeUInt32BE(crc32(Buffer.concat([t,d])));return Buffer.concat([l,t,d,c]);};
export const png=()=>{const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);};
test('JSON content export and safe inspection preserve every definition',async()=>{
 const content=fixture(),before=structuredClone(content),output=await exportContent(content);
 const inspected=await inspectArchive(output);
 assert.deepEqual(inspected.entities,content.entities);assert.deepEqual(content,before);
 assert.equal(inspected.manifest.base_content_version,content.content_version);
 assert.deepEqual(inspected.manifest.required_capabilities,content.required_capabilities);
 assert.deepEqual(await exportContent(content),output,'deterministic bytes');
});
test('selected export includes transitive dependencies and referenced resources',async()=>{
 const c=fixture();c.required_capabilities.push('content.resources.v1');
 c.entities.push({id:'faction_two',kind:'faction',name:'Вторая',data:{advantage_ids:['faction_neutral']}});
 c.entities.find(e=>e.id==='hero_probe').data.sprite_resource_id='sprite_probe';
 c.entities.push({id:'ability_unused',kind:'ability',name:'Лишняя',data:{effect:'heal',power:1,cooldown_ms:0}});
 const descriptor={id:'sprite_probe',media_type:'image/png',sha256:'0'.repeat(64),size:png().length,width:1,height:1,license:{name:'own',attribution:''},scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:1,height:1,duration_ms:100}],loop:false};
 assert.deepEqual(dependencyClosure(c,['hero_probe']).map(e=>e.id),['faction_neutral','ability_hit','hero_probe']);
 const zip=await exportContent(c,{ids:['hero_probe'],resources:new Map([['sprite_probe',{descriptor,bytes:png()}]])});
 const i=await inspectArchive(zip);
 assert.deepEqual(i.entities.filter(Boolean).map(e=>e.id),['faction_neutral','ability_hit','hero_probe']);
 assert.equal(i.resources.length,1);assert.equal(i.resources[0].meta.file,'assets/sprite_probe.png');assert.deepEqual(i.resources[0].bytes,png());
 assert.equal(i.operations[0].entity_type,'resource','resources are created before entities that use them');
 await assert.rejects(exportContent(c,{ids:['hero_probe']}),/RESOURCE_REF_INVALID: entity:hero_probe \(sprite_probe\)/);
 await assert.rejects(exportContent(c,{ids:['hero_missing']}),/UNKNOWN_ENTITY/);
});
test('invalid content and unsupported capabilities cannot be exported',async()=>{
 const bad=fixture();bad.entities.push(bad.entities[0]);await assert.rejects(exportContent(bad));
 const unknown=fixture();unknown.required_capabilities.push('unknown.effect.v1');await assert.rejects(exportContent(unknown));
});
