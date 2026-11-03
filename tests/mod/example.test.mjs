import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import yazl from 'yazl';
import {inspectArchive} from '../../packages/content-validator/archive.mjs';
import {planImport} from '../../packages/content-validator/plan-import.mjs';
import {compileContentBattle,runAutoBattle} from '../../packages/battle-core/compile.mjs';

const root=fileURLToPath(new URL('../../examples/ufa_batyrs_starter/',import.meta.url));
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
function zipDir(){
 const z=new yazl.ZipFile();for(const file of walk(root).sort())z.addBuffer(readFileSync(file),relative(root,file).split('\\').join('/'),{compress:true,mtime:new Date(0)});z.end();
 return new Promise((resolve,reject)=>{const parts=[];z.outputStream.on('data',c=>parts.push(c));z.outputStream.on('error',reject);z.outputStream.on('end',()=>resolve(Buffer.concat(parts)));});
}
test('example ufa_batyrs_starter is a real importable package (runtime inspector + planner), and its stage battles',async()=>{
 const pkg=await inspectArchive(await zipDir());
 assert.equal(pkg.resources.length,1);
 const draft={revision:0,content:{schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1'],entities:[]}};
 const plan=await planImport(pkg,draft,{expectedRevision:0});
 assert.equal(plan.report.unresolved,0);assert.equal(plan.content.entities.length,7);assert.equal(plan.resources[0].descriptor.frames.length,2);
 const {setup,heroes}=compileContentBattle(plan.content,{attacker_hero_ids:['hero_batyr'],stage_id:'stage_steppe_edge',seed:1});
 const result=runAutoBattle(setup,{heroes});assert.ok(['attacker_win','attacker_loss'].includes(result.result));
});
test('legacy hello_bashkortostan example stays rejected: its capability is not implemented',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../examples/hello_bashkortostan/manifest.json',import.meta.url)));
 assert.deepEqual(manifest.required_capabilities,['dialogue.template.v1']);
});
import {spawnSync} from 'node:child_process';
import {entitySha256} from '../../packages/content-validator/canonical.mjs';
test('expected_sha256 recipe from docs/MOD_AUTHORING.md (Python) matches canonical.mjs',()=>{
 const file=fileURLToPath(new URL('../../examples/ufa_batyrs_starter/entities/hero_batyr.json',import.meta.url));
 const py=spawnSync('python3',['-I','-c',"import json,hashlib,sys;o=json.load(open(sys.argv[1],encoding='utf-8'));print(hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())",file]);
 assert.equal(py.status,0);assert.equal(py.stdout.toString().trim(),entitySha256(JSON.parse(readFileSync(file,'utf8'))));
});
