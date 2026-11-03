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
test('operations reject unknown commands, extra fields and missing expected hashes',()=>{
 const base=example('operations')[0],h='a'.repeat(64);
 for(const operation of [{...base,op:'execute'},{...base,extra:true},{...base,op:'replace'},{...base,op:'delete'},{...base,entity_type:'script'},{...base,source:'entities/../data.json'},
  {op:'replace',entity_type:'hero',id:'hero_one',source:'entities/hero.json',expected_revision:2},{op:'delete',entity_type:'hero',id:'hero_one',expected_sha256:'xyz'},
  {op:'replace',entity_type:'resource',id:'sprite_one',source:'resources/s.json',expected_sha256:h},{op:'create',entity_type:'resource',id:'sprite_one',source:'entities/s.json'},
  {op:'create',entity_type:'hero',id:'hero_one',source:'resources/h.json'}])
  assert.equal(validate('mod_operations',[operation]).ok,false,JSON.stringify(operation));
 assert.equal(validate('mod_operations',[{op:'replace',entity_type:'hero',id:'hero_one',source:'entities/hero.json',expected_sha256:h}]).ok,true);
 assert.equal(validate('mod_operations',[{op:'delete',entity_type:'hero',id:'hero_one',expected_sha256:h}]).ok,true);
 assert.equal(validate('mod_operations',[{op:'create',entity_type:'resource',id:'sprite_one',source:'resources/sprite_one.json'}]).ok,true);
});
test('resource metadata: only PNG/WAV files under assets/, no unknown fields',()=>{
 const meta={id:'sprite_one',file:'assets/sprite_one.png',license:{name:'own',attribution:''},loop:false};
 assert.equal(validate('mod_resource',meta).ok,true);
 for(const bad of [{...meta,file:'assets/x.ogg'},{...meta,file:'../x.png'},{...meta,file:'entities/x.png'},{...meta,url:'https://x'},{...meta,license:{name:''}}])
  assert.equal(validate('mod_resource',bad).ok,false,JSON.stringify(bad));
});
