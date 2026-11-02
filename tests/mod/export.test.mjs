import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectArchive} from '../../packages/content-validator/archive.mjs';
import {exportContent} from '../../packages/content-validator/export.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/content.json',import.meta.url)));
test('JSON content export and safe inspection preserve every definition',async()=>{
 const content=fixture(),before=structuredClone(content),output=await exportContent(content);
 const inspected=await inspectArchive(output);
 assert.deepEqual(inspected.entities,content.entities);assert.deepEqual(content,before);
 assert.equal(inspected.manifest.base_content_version,content.content_version);
 assert.deepEqual(inspected.manifest.required_capabilities,content.required_capabilities);
 assert.deepEqual(await exportContent(content),output);
});
test('invalid content and unsupported capabilities cannot be exported',async()=>{
 const bad=fixture();bad.entities.push(bad.entities[0]);await assert.rejects(exportContent(bad));
 const unknown=fixture();unknown.required_capabilities.push('unknown.effect.v1');await assert.rejects(exportContent(unknown));
});
