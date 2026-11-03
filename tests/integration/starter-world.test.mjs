import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrate} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {createOwner} from '../../services/api/src/owner.ts';
import {validate} from '@ufagame/contracts';
import {progressionContent} from '../fixtures/progression.mjs';

const origin='https://studio.example.test';
const meta=()=>({reason:'starter world test',request_id:randomUUID()});

test('starter world ZIP: import into a fresh draft, publish, player gets heroes, campaign and wins stage 1',{timeout:120000},async()=>{
 const schema='starter_'+randomUUID().replaceAll('-','');
 const control=new pg.Pool();let pool,api;
 try{
  await control.query(`CREATE SCHEMA ${schema}`);pool=new pg.Pool({options:`-c search_path=${schema}`});await migrate(pool);
  const password=randomBytes(32).toString('base64url');await createOwner(pool,'starter_owner',password);
  api=await buildApp(pool,{origin});await api.ready();
  const s=await api.inject({method:'POST',url:'/admin/v1/sessions',headers:{origin},payload:{login:'starter_owner',password}});
  const headers={origin,cookie:s.headers['set-cookie'].split(';')[0],'x-ufa-csrf':s.json().csrf_token};
  const post=(url,payload)=>api.inject({method:'POST',url,payload,headers});
  // An earlier world with its own heroes: a player already has a five there.
  const oldDraft=randomUUID();
  assert.equal((await post('/admin/v1/drafts',{id:oldDraft,name:'Старый мир',content:progressionContent(),...meta()})).statusCode,200);
  assert.equal((await post(`/admin/v1/drafts/${oldDraft}/publish`,{expected_revision:0,expected_pointer_revision:0,...meta()})).statusCode,200);
  const g=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
  const auth={authorization:`Bearer ${g.access_token}`};
  assert.equal((await api.inject({url:'/v1/heroes',headers:auth})).json().heroes.length,8,'old world starters');
  // A new draft exactly as Studio creates it.
  const draftId=randomUUID();
  assert.equal((await post('/admin/v1/drafts',{id:draftId,name:'Стартовый мир',content:{schema_version:1,content_version:'draft_001',required_capabilities:['content.core.v1'],entities:[]},...meta()})).statusCode,200);
  const zip=(await readFile(new URL('../../content/starter/ufagame-starter.zip',import.meta.url))).toString('base64');
  const pre=await post(`/admin/v1/drafts/${draftId}/import/preflight`,{expected_revision:0,zip_base64:zip});
  assert.equal(pre.statusCode,200,pre.body);assert.equal(pre.json().ready,true,'no conflicts in a fresh draft');
  const applied=await post(`/admin/v1/drafts/${draftId}/import/apply`,{expected_revision:0,zip_base64:zip,resolutions:{},...meta()});
  assert.equal(applied.statusCode,200,applied.body);assert.equal(applied.json().draft.content.entities.length,93);
  const pointer=(await api.inject({url:'/admin/v1/content/releases',headers:{cookie:headers.cookie}})).json().pointer;
  const pub=await post(`/admin/v1/drafts/${draftId}/publish`,{expected_revision:1,expected_pointer_revision:pointer?.pointer_revision??0,...meta()});
  assert.equal(pub.statusCode,200,pub.body);

  // Player side.
  const heroes=(await api.inject({url:'/v1/heroes',headers:auth})).json();
  assert.equal(validate('heroes',heroes).ok,true);
  // Old heroes stay (unavailable); the five is refilled with the new world's starters.
  assert.equal(heroes.heroes.length,15);assert.equal(heroes.heroes.filter(h=>!h.available).length,8);
  assert.ok(heroes.main.every(id=>heroes.heroes.find(h=>h.id===id).available),'five refilled with usable heroes');assert.equal(heroes.main.length,5);assert.ok(heroes.items.some(i=>i.item_id==='item_steppe_saber'));
  assert.equal(heroes.heroes.find(h=>h.hero_id==='hero_azamat'&&h.role===null).hero_id,'hero_azamat','spare copy for the first rank up');
  const campaign=(await api.inject({url:'/v1/campaign',headers:auth})).json();
  assert.equal(validate('campaign',campaign).ok,true);
  assert.deepEqual(campaign.chapters.map(c=>[c.name,c.stages.length,c.stages.filter(x=>x.boss).length]),[['Пробуждение Уфы',4,1],['Тайна Шульган-Таша',4,1],['Вершины Урала',4,1]]);
  assert.equal(campaign.chapters[0].stages[0].status,'open');assert.equal(campaign.chapters[0].stages[1].status,'locked');
  const start=await api.inject({method:'POST',url:'/v1/live-battles',headers:auth,payload:{request_id:randomUUID(),stage_id:'stage_c1_1',instance_ids:heroes.main}});
  assert.equal(start.statusCode,200,start.body);
  // Poll twice a second (the API limits a client to 120 requests a minute).
  let result;for(let i=0;i<190&&!result;i++){const x=(await api.inject({url:'/v1/live-battles/'+start.json().battle_id,headers:auth})).json();if(x.result)result=x.result;else await new Promise(r=>setTimeout(r,500));}
  assert.equal(result,'attacker_win','starter five wins the first stage');
  const after=(await api.inject({url:'/v1/heroes',headers:auth})).json();
  assert.equal(after.balances.gold,500);assert.equal(after.balances.hero_exp,1000);assert.equal(after.balances.gems,500,'enough gems for ten pulls');
  const sm=(await api.inject({url:'/v1/summon',headers:auth})).json();assert.equal(validate('summon',sm).ok,true);assert.equal(sm.pools[0].guarantee.pulls_left,10);
  assert.equal((await api.inject({method:'POST',url:'/v1/summon',headers:auth,payload:{request_id:randomUUID(),pool_id:'pool_heroes',count:10}})).statusCode,200);
  const vip=(await api.inject({url:'/v1/vip',headers:auth})).json();assert.equal(validate('vip',vip).ok,true);assert.equal(vip.tutorial.steps[0].done,true);
  const qs=(await api.inject({url:'/v1/quests',headers:auth})).json();assert.equal(validate('quests',qs).ok,true);
  assert.equal(qs.quests.find(q=>q.id==='quest_daily_wins').progress,1,'the first win counts for the daily quest');
  assert.equal(qs.quests.find(q=>q.id==='quest_daily_summon').status,'ready','ten pulls complete the summon quest');
  assert.equal(validate('afk',(await api.inject({url:'/v1/afk',headers:auth})).json()).ok,true);
  assert.equal((await api.inject({url:'/v1/campaign',headers:auth})).json().chapters[0].stages[1].status,'open');
 }finally{
  if(api)await api.close();if(pool)await pool.end();
  await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await control.end();
 }
});
