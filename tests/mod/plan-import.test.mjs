import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectArchive} from '../../packages/content-validator/archive.mjs';
import {exportContent} from '../../packages/content-validator/export.mjs';
import {planCreateImport} from '../../packages/content-validator/plan-import.mjs';
const content=()=>({schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1'],entities:[{id:'ability_one',kind:'ability',name:'One',data:{effect:'damage',power:1,cooldown_ms:0}}]});
const empty=()=>({revision:0,content:{...content(),entities:[]}});
test('exported create operations prepare a validated draft without mutation',async()=>{
 const archive=await inspectArchive(await exportContent(content()));const draft=empty(),before=structuredClone(draft);
 const plan=planCreateImport(archive,draft,0);
 assert.deepEqual(plan.content,content());assert.deepEqual(draft,before);assert.deepEqual(plan.created_ids,['ability_one']);
});
test('stale base, stale revision, repeated import and unsupported replace fail without mutation',async()=>{
 const archive=await inspectArchive(await exportContent(content())),draft=empty(),before=structuredClone(draft);
 assert.throws(()=>planCreateImport(archive,draft,1),/STALE_DRAFT/);
 const stale=structuredClone(archive);stale.manifest.base_content_version='another_base';assert.throws(()=>planCreateImport(stale,draft,0),/STALE_BASE/);
 assert.throws(()=>planCreateImport(archive,{revision:1,content:content()},1),/ENTITY_CONFLICT/);
 const replace=structuredClone(archive);replace.operations[0].op='replace';replace.operations[0].expected_revision=1;assert.throws(()=>planCreateImport(replace,draft,0),/UNSUPPORTED_OPERATION/);
 assert.deepEqual(draft,before);
});
test('broken cross references do not produce a changed draft',()=>{
 const manifest={format:'ug-content/1',package_id:'test_pack',package_version:'1.0.0',game_id:'ufagame',base_content_version:'draft_001',required_capabilities:['content.core.v1'],dependencies:[],files:[{path:'operations.json',size:0,sha256:'0'.repeat(64)}]};
 const entity={id:'hero_one',kind:'hero',name:'Hero',data:{faction_id:'missing_faction',ability_ids:['missing_ability']}};
 const inspection={manifest,operations:[{op:'create',entity_type:'hero',id:'hero_one',source:'entities/hero_one.json'}],entities:[entity]};
 const draft=empty(),before=structuredClone(draft);assert.throws(()=>planCreateImport(inspection,draft,0),/INVALID_RESULT/);assert.deepEqual(draft,before);
});
