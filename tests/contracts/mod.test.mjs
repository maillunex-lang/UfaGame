import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate,negotiate} from '@ufagame/contracts';
const example=name=>JSON.parse(readFileSync(new URL(`../../examples/hello_bashkortostan/${name}.json`,import.meta.url)));
test('example manifest and operations satisfy structural schemas, capability remains unavailable',()=>{
 const manifest=example('manifest'),operations=example('operations');
 assert.equal(validate('mod_manifest',manifest).ok,true);
 assert.equal(validate('mod_operations',operations).ok,true);
 assert.equal(negotiate(manifest.required_capabilities),false);
});
test('manifest rejects unsafe paths, unsupported files and malformed checksums',()=>{
 for(const path of ['../escape.json','/etc/passwd','entities/../data.json','assets/icon.png/../../x','assets/code.js','entities\\evil.json','manifest.json','assets/.hidden.png']){
  const manifest=example('manifest');manifest.files[0].path=path;
  assert.equal(validate('mod_manifest',manifest).ok,false,path);
 }
 const manifest=example('manifest');manifest.files[0].sha256='not-hash';assert.equal(validate('mod_manifest',manifest).ok,false);
});
test('operations reject unknown commands, extra fields and missing revisions',()=>{
 const base=example('operations')[0];
 for(const operation of [{...base,op:'execute'},{...base,extra:true},{...base,op:'replace'},{...base,op:'delete'},{...base,entity_type:'script'},{...base,source:'entities/../data.json'}])
  assert.equal(validate('mod_operations',[operation]).ok,false,JSON.stringify(operation));
 assert.equal(validate('mod_operations',[{op:'replace',entity_type:'hero',id:'hero_one',source:'entities/hero.json',expected_revision:2}]).ok,true);
 assert.equal(validate('mod_operations',[{op:'delete',entity_type:'hero',id:'hero_one',expected_revision:2}]).ok,true);
});
