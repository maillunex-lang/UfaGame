/**
 * Builds the starter world pack for Studio import:
 *   node tools/content/build-starter.mjs           → content/starter/{starter-world.json, ufagame-starter.zip, balance.json}
 *   node tools/content/build-starter.mjs --check   → fails if the committed files differ
 * Validates the content, inspects the ZIP like the importer, plans an import into
 * a fresh draft and simulates every stage with the starter five (balance table).
 */
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validate,progressionProblems,campaignProblems,locationProblems} from '@ufagame/contracts';
import {exportContent} from '../../packages/content-validator/export.mjs';
import {inspectArchive} from '../../packages/content-validator/archive.mjs';
import {planImport} from '../../packages/content-validator/plan-import.mjs';
import {compileContentBattle,runAutoBattle} from '../../packages/battle-core/compile.mjs';
import {starterWorld} from './starter-world.mjs';

const dir=new URL('../../content/starter/',import.meta.url);
const content=starterWorld();
const problems=[...progressionProblems(content),...campaignProblems(content),...locationProblems(content)];
if(!validate('content',content).ok||problems.length)throw new Error('Starter world is invalid: '+JSON.stringify(problems));

const zip=await exportContent(content,{packageId:'ufagame_starter_world'});
const inspection=await inspectArchive(zip);
const fresh={revision:0,content:{schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1'],entities:[]}};
const plan=await planImport(inspection,fresh,{expectedRevision:0});
if(!plan.content||plan.report.unresolved)throw new Error('Import into a fresh draft has conflicts');

// Balance: lowest level of the starter five (rank by level) that wins 2 of 3 seeds.
const team=['hero_azamat','hero_aigul','hero_karagai','hero_zulfia','hero_timer'];
const wins=(stage,level)=>{let w=0;for(let seed=1;seed<=3;seed++){const {setup,heroes}=compileContentBattle(content,{attacker_hero_ids:team,attacker_mods:team.map(()=>({level,rank:level>20?1:0,items:[]})),stage_id:stage,seed});if(runAutoBattle(setup,{heroes}).result==='attacker_win')w++;}return w>=2;};
const balance=content.entities.filter(e=>e.kind==='stage').map(st=>{let level=1;while(level<=40&&!wins(st.id,level))level++;return {stage_id:st.id,name:st.name,boss:!!st.data.boss,enemy_level:st.data.enemy_level??1,needs_team_level:level>40?null:level};});

const files={'starter-world.json':Buffer.from(JSON.stringify(content,null,2)+'\n'),'ufagame-starter.zip':zip,'balance.json':Buffer.from(JSON.stringify(balance,null,2)+'\n')};
const counts=Object.fromEntries(['faction','ability','hero','item','location','stage','chapter','progression'].map(k=>[k,content.entities.filter(e=>e.kind===k).length]));
if(process.argv.includes('--check')){
 for(const [name,bytes] of Object.entries(files)){const path=new URL(name,dir);if(!existsSync(path)||!readFileSync(path).equals(bytes))throw new Error(`${name} is out of date: run node tools/content/build-starter.mjs`);}
 console.log('Starter world files are up to date');
}else for(const [name,bytes] of Object.entries(files))writeFileSync(new URL(name,dir),bytes);
console.log(JSON.stringify({counts,zip_bytes:zip.length,zip_sha256:createHash('sha256').update(zip).digest('hex'),import_created:plan.report.items.filter(i=>i.status==='create').length}));
for(const b of balance)console.log(`${b.stage_id.padEnd(16)} ${b.boss?'босс ':'     '}врагам ${String(b.enemy_level).padStart(2)} ур. → пятёрке нужно ${b.needs_team_level??'>40'} ур.`);
