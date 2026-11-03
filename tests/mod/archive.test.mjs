import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectArchive,LIMITS} from '../../packages/content-validator/archive.mjs';
const json=value=>Buffer.from(JSON.stringify(value));
const digest=b=>createHash('sha256').update(b).digest('hex');
function goodEntries(){
 const entity=json({id:'ability_one',kind:'ability',name:'One',data:{effect:'damage',power:1,cooldown_ms:0}});
 const operations=json([{op:'create',entity_type:'ability',id:'ability_one',source:'entities/ability_one.json'}]);
 const data=[['operations.json',operations],['entities/ability_one.json',entity]];
 const manifest=json({format:'ug-content/1',package_id:'test_pack',package_version:'1.0.0',game_id:'ufagame',base_content_version:'draft_001',required_capabilities:['content.core.v1'],dependencies:[],files:data.map(([path,b])=>({path,size:b.length,sha256:digest(b)}))});
 return [['manifest.json',manifest],...data];
}
function archive(entries,options={}){
 const script=`import sys,json,zipfile,io,base64\nx=json.load(sys.stdin); out=io.BytesIO()\nwith zipfile.ZipFile(out,'w') as z:\n for e in x['entries']:\n  i=zipfile.ZipInfo(e['name']);i.compress_type=zipfile.ZIP_DEFLATED if e.get('deflate') else zipfile.ZIP_STORED\n  if e.get('symlink'): i.create_system=3;i.external_attr=(0o120777 << 16)\n  z.writestr(i,base64.b64decode(e['data']))\nsys.stdout.buffer.write(out.getvalue())`;
 const items=entries.map(([name,bytes,meta={}])=>({name,data:bytes.toString('base64'),...meta}));
 const proc=spawnSync('python3',['-c',script],{input:JSON.stringify({entries:items}),maxBuffer:40*1024*1024});
 if(proc.status!==0)throw Error(proc.stderr.toString());return proc.stdout;
}
test('valid archive is inspected without mutating content or writing files',async()=>{
 const result=await inspectArchive(archive(goodEntries()));
 assert.equal(result.manifest.package_id,'test_pack');assert.equal(result.operations[0].id,'ability_one');
});
test('rejects path traversal, absolute paths and collisions',async()=>{
 for(const name of ['../escape','/absolute','entities/../outside','entities\\evil','CON.txt'])
  await assert.rejects(inspectArchive(archive([...goodEntries(),[name,Buffer.from('x')]])),undefined,name);
 await assert.rejects(inspectArchive(archive([...goodEntries(),['OPERATIONS.JSON',Buffer.from('x')]])));
 await assert.rejects(inspectArchive(archive([...goodEntries(),['operations.json',Buffer.from('x')]])));
});
test('rejects symlinks, extreme compression and archive size',async()=>{
 await assert.rejects(inspectArchive(archive([...goodEntries(),['assets/link.png',Buffer.from('/etc/passwd'),{symlink:true}]])));
 await assert.rejects(inspectArchive(archive([...goodEntries(),['entities/bomb.json',Buffer.alloc(200000),{deflate:true}]])));
 await assert.rejects(inspectArchive(Buffer.alloc(LIMITS.archive+1)));
});
test('rejects tampering, unlisted files and unknown capabilities',async()=>{
 const entries=goodEntries();entries[2][1]=Buffer.from('{}');await assert.rejects(inspectArchive(archive(entries)));
 await assert.rejects(inspectArchive(archive([...goodEntries(),['extra.json',Buffer.from('{}')]])));
 const unknown=goodEntries(),manifest=JSON.parse(unknown[0][1]);manifest.required_capabilities=['unknown.effect.v1'];unknown[0][1]=json(manifest);
 await assert.rejects(inspectArchive(archive(unknown)),/UNSUPPORTED_CAPABILITY: manifest.json \(unknown.effect.v1\)/);
 const bad=goodEntries();bad[2][1]=Buffer.from('{}');await assert.rejects(inspectArchive(archive(bad)),/(SIZE|HASH)_MISMATCH: entities\/ability_one.json/);
 await assert.rejects(inspectArchive(archive([...goodEntries(),['entities/extra.json',Buffer.from('{}')]])),/UNLISTED_FILE: entities\/extra.json/);
});
test('rejects unsupported operations, wrong source identity and resource files',async()=>{
 const rewrite=(fn)=>{const e=goodEntries(),m=JSON.parse(e[0][1]);fn(e,m);for(const item of m.files){const found=e.find(([n])=>n===item.path);if(found){item.size=found[1].length;item.sha256=digest(found[1]);}}e[0][1]=json(m);return e;};
 await assert.rejects(inspectArchive(archive(rewrite(e=>{e[1][1]=json([{op:'execute',entity_type:'ability',id:'ability_one',source:'entities/ability_one.json'}]);}))));
 await assert.rejects(inspectArchive(archive(rewrite(e=>{e[2][1]=json({id:'wrong_id',kind:'ability'});}))),/IDENTITY_MISMATCH: entities\/ability_one.json \(id\)/);
 // A listed asset that no resource uses is hidden data and is rejected.
 await assert.rejects(inspectArchive(archive(rewrite((e,m)=>{const b=Buffer.from('not a png');e.push(['assets/a.png',b]);m.files.push({path:'assets/a.png',size:b.length,sha256:digest(b)});}))),/UNUSED_FILE: assets\/a.png/);
 // Code-like and unsupported asset types cannot even be listed.
 for(const path of ['assets/a.js','assets/a.gd','assets/a.tscn','assets/a.ogg','resources/a.png','entities/a.zip'])
  await assert.rejects(inspectArchive(archive(rewrite((e,m)=>{const b=Buffer.from('x');e.push([path,b]);m.files.push({path,size:1,sha256:digest(b)});}))),/SCHEMA_INVALID: manifest.json/,path);
 await assert.rejects(inspectArchive(archive(rewrite(e=>{e[1][1]=json([{op:'create',entity_type:'ability',id:'ability_one',source:'entities/ability_one.json'},{op:'create',entity_type:'ability',id:'ability_one',source:'entities/ability_one.json'}]);}))),/DUPLICATE_OPERATION/);
 await assert.rejects(inspectArchive(archive(rewrite(e=>{e[2][1]=Buffer.from('{"id": "ability_one",');}))),/JSON_INVALID: entities\/ability_one.json/);
});
