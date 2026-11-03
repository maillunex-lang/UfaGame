import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import yazl from 'yazl';
import {inspectArchive} from '../../packages/content-validator/archive.mjs';
import {exportContent} from '../../packages/content-validator/export.mjs';
import {planImport,planCreateImport,fieldDiff} from '../../packages/content-validator/plan-import.mjs';
import {entitySha256} from '../../packages/content-validator/canonical.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const enc=v=>Buffer.from(JSON.stringify(v));
const chunk=(n,d)=>{const t=Buffer.from(n),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(d.length);c.writeUInt32BE(crc32(Buffer.concat([t,d])));return Buffer.concat([l,t,d,c]);};
const png=(px=255)=>{const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,px]))),chunk('IEND',Buffer.alloc(0))]);};
const faction={id:'faction_one',kind:'faction',name:'Ф',data:{advantage_ids:[]}};
const ability={id:'ability_one',kind:'ability',name:'One',data:{effect:'damage',power:1,cooldown_ms:0}};
const hero={id:'hero_one',kind:'hero',name:'Герой',data:{faction_id:'faction_one',ability_ids:['ability_one']}};
const content=(entities=[faction,ability,hero],caps=['content.core.v1'])=>({schema_version:1,content_version:'draft_001',required_capabilities:caps,entities:structuredClone(entities)});
const draftOf=(c,revision=0)=>({revision,content:c});

/** Builds a ug-content/1 ZIP from explicit operations and files. */
function pack(operations,files,{base='draft_001',caps=['content.core.v1']}={}){
 const entries=[['operations.json',enc(operations)],...Object.entries(files).map(([p,v])=>[p,Buffer.isBuffer(v)?v:enc(v)])];
 const manifest={format:'ug-content/1',package_id:'test_pack',package_version:'1.0.0',game_id:'ufagame',base_content_version:base,required_capabilities:caps,dependencies:[],files:entries.map(([path,b])=>({path,size:b.length,sha256:sha(b)}))};
 const zip=new yazl.ZipFile();zip.addBuffer(enc(manifest),'manifest.json',{compress:false});for(const [p,b] of entries)zip.addBuffer(b,p,{compress:false});zip.end();
 return new Promise((resolve,reject)=>{const parts=[];zip.outputStream.on('data',c=>parts.push(c));zip.outputStream.on('error',reject);zip.outputStream.on('end',()=>resolve(Buffer.concat(parts)));});
}
const inspect=async(ops,files,opts)=>inspectArchive(await pack(ops,files,opts));

test('export -> import roundtrip into an empty draft; repeat import changes nothing',async()=>{
 const pkg=await inspectArchive(await exportContent(content()));
 const empty=draftOf(content([])),before=structuredClone(empty);
 const plan=await planImport(pkg,empty,{expectedRevision:0});
 assert.deepEqual(plan.content.entities,content().entities);assert.deepEqual(empty,before,'input draft is not mutated');
 assert.deepEqual(plan.report.items.map(i=>i.status),['create','create','create']);
 const again=await planImport(pkg,draftOf(plan.content,1),{expectedRevision:1});
 assert.deepEqual(again.report.items.map(i=>i.status),['unchanged','unchanged','unchanged']);
 assert.deepEqual(again.content,plan.content,'repeat import does not duplicate');
});
test('stale draft revision and base mismatch need explicit handling',async()=>{
 const pkg=await inspectArchive(await exportContent(content()));
 await assert.rejects(planImport(pkg,draftOf(content([])),{expectedRevision:1}),/STALE_DRAFT/);
 const other=content([]);other.content_version='draft_002';
 const pending=await planImport(pkg,draftOf(other),{expectedRevision:0});
 assert.equal(pending.content,null);assert.equal(pending.report.unresolved,1);assert.equal(pending.report.items[0].conflict,'BASE_MISMATCH');
 await assert.rejects(planImport(pkg,draftOf(other),{expectedRevision:0,resolutions:{base:'draft'}}),/IMPORT_CANCELLED_BASE/);
 const accepted=await planImport(pkg,draftOf(other),{expectedRevision:0,resolutions:{base:'package'}});
 assert.equal(accepted.content.entities.length,3);assert.equal(accepted.content.content_version,'draft_002');
});
test('create on a changed entity is a conflict with field diff; manual choice decides',async()=>{
 const pkg=await inspectArchive(await exportContent(content()));
 const mine=content();mine.entities[1].data.power=50;mine.entities[1].name='Моя';
 const pending=await planImport(pkg,draftOf(mine),{expectedRevision:0});
 const item=pending.report.items.find(i=>i.id==='ability_one');
 assert.equal(item.conflict,'ENTITY_EXISTS');assert.deepEqual(item.diff,[{path:'data.power',before:50,after:1},{path:'name',before:'Моя',after:'One'}]);
 assert.equal(pending.content,null);
 const keep=await planImport(pkg,draftOf(mine),{expectedRevision:0,resolutions:{'entity:ability_one':'draft'}});
 assert.equal(keep.content.entities[1].data.power,50);
 const take=await planImport(pkg,draftOf(mine),{expectedRevision:0,resolutions:{'entity:ability_one':'package'}});
 assert.equal(take.content.entities[1].data.power,1);
 await assert.rejects(planImport(pkg,draftOf(mine),{expectedRevision:0,resolutions:{'entity:ability_one':'merge'}}),/RESOLUTION_INVALID/);
});
test('replace and delete are guarded by expected_sha256; references stay valid',async()=>{
 const base=content(),newer={...ability,data:{...ability.data,power:7}};
 const replace=await inspect([{op:'replace',entity_type:'ability',id:'ability_one',source:'entities/a.json',expected_sha256:entitySha256(ability)}],{'entities/a.json':newer});
 const ok=await planImport(replace,draftOf(base),{expectedRevision:0});
 assert.equal(ok.report.items[0].status,'replace');assert.deepEqual(ok.report.items[0].diff,[{path:'data.power',before:1,after:7}]);assert.equal(ok.content.entities[1].data.power,7);
 const edited=content();edited.entities[1].data.power=3;
 const stale=await planImport(replace,draftOf(edited),{expectedRevision:0});
 assert.equal(stale.report.items[0].conflict,'ENTITY_STALE');assert.equal(stale.content,null);
 const del=await inspect([{op:'delete',entity_type:'hero',id:'hero_one',expected_sha256:entitySha256(hero)}],{});
 const removed=await planImport(del,draftOf(base),{expectedRevision:0});assert.equal(removed.content.entities.length,2);
 const delUsed=await inspect([{op:'delete',entity_type:'ability',id:'ability_one',expected_sha256:entitySha256(ability)}],{});
 await assert.rejects(planImport(delUsed,draftOf(base),{expectedRevision:0}),/REFERENCE_MISSING: entity:hero_one \(ability_one\)/);
 const missing=await inspect([{op:'replace',entity_type:'ability',id:'ability_two',source:'entities/a.json',expected_sha256:'0'.repeat(64)}],{'entities/a.json':{...newer,id:'ability_two'}});
 assert.equal((await planImport(missing,draftOf(base),{expectedRevision:0})).report.items[0].conflict,'ENTITY_MISSING');
 const wrongKind=await inspect([{op:'create',entity_type:'faction',id:'ability_one',source:'entities/a.json'}],{'entities/a.json':{...faction,id:'ability_one'}});
 await assert.rejects(planImport(wrongKind,draftOf(base),{expectedRevision:0}),/KIND_CONFLICT/);
});
test('resources: decoded in isolation, deduplicated by hash, immutable on conflict',async()=>{
 const meta={id:'sprite_one',file:'assets/sprite_one.png',license:{name:'own',attribution:''},loop:false};
 const withSprite={...hero,data:{...hero.data,sprite_resource_id:'sprite_one'}};
 const caps=['content.core.v1','content.resources.v1'];
 const ops=[{op:'create',entity_type:'resource',id:'sprite_one',source:'resources/sprite_one.json'},{op:'replace',entity_type:'hero',id:'hero_one',source:'entities/h.json',expected_sha256:entitySha256(hero)}];
 const pkg=await inspect(ops,{'resources/sprite_one.json':meta,'assets/sprite_one.png':png(),'entities/h.json':withSprite},{caps});
 const plan=await planImport(pkg,draftOf(content()),{expectedRevision:0});
 assert.equal(plan.resources.length,1);assert.equal(plan.resources[0].descriptor.media_type,'image/png');assert.equal(plan.resources[0].descriptor.sha256,sha(png()));
 assert.ok(plan.content.required_capabilities.includes('content.resources.v1'));
 const same=await planImport(pkg,draftOf(content()),{expectedRevision:0,existingResources:new Map([['sprite_one',{sha256:sha(png()),media_type:'image/png'}]])});
 assert.equal(same.resources.length,0);assert.equal(same.report.items[0].status,'unchanged');
 const different=new Map([['sprite_one',{sha256:sha(png(1)),media_type:'image/png'}]]);
 assert.equal((await planImport(pkg,draftOf(content()),{expectedRevision:0,existingResources:different})).report.items[0].conflict,'RESOURCE_EXISTS');
 await assert.rejects(planImport(pkg,draftOf(content()),{expectedRevision:0,existingResources:different,resolutions:{'resource:sprite_one':'package'}}),/RESOURCE_IMMUTABLE/);
 const keep=await planImport(pkg,draftOf(content()),{expectedRevision:0,existingResources:different,resolutions:{'resource:sprite_one':'draft'}});
 assert.equal(keep.resources.length,0);assert.ok(keep.content);
 const corrupt=await inspect(ops,{'resources/sprite_one.json':meta,'assets/sprite_one.png':Buffer.from('#!/bin/sh\nrm -rf /\n'),'entities/h.json':withSprite},{caps});
 await assert.rejects(planImport(corrupt,draftOf(content()),{expectedRevision:0}),/RESOURCE_INVALID: assets\/sprite_one.png/);
 const audioAsSprite=await inspect([ops[1]],{'entities/h.json':withSprite},{caps});
 await assert.rejects(planImport(audioAsSprite,draftOf(content()),{expectedRevision:0,existingResources:new Map([['sprite_one',{sha256:'0'.repeat(64),media_type:'audio/wav'}]])}),/RESOURCE_REF_INVALID: entity:hero_one \(sprite_one\)/);
});
test('create-only helper: creates new, rejects replace and changed duplicates',async()=>{
 const pkg=await inspectArchive(await exportContent(content()));
 const plan=await planCreateImport(pkg,draftOf(content([])),0);assert.deepEqual(plan.created_ids,['faction_one','ability_one','hero_one']);
 const mine=content();mine.entities[1].data.power=9;
 await assert.rejects(planCreateImport(pkg,draftOf(mine),0),/ENTITY_EXISTS/);
 const replace=structuredClone(pkg);replace.operations[0]={op:'replace',entity_type:'faction',id:'faction_one',source:'entities/faction_one.json',expected_sha256:'0'.repeat(64)};
 await assert.rejects(planCreateImport(replace,draftOf(content([])),0),/UNSUPPORTED_OPERATION/);
});
test('field diff reports leaf paths and is bounded',()=>{
 assert.deepEqual(fieldDiff({a:1,b:{c:2}},{a:1,b:{c:3},d:4}),[{path:'b.c',before:2,after:3},{path:'d',before:null,after:4}]);
 const big=Object.fromEntries(Array.from({length:80},(_,i)=>[`k${i}`,i]));assert.equal(fieldDiff({},big).length,50);
});
