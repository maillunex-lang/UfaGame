import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
import {validate} from '@ufagame/contracts';
// Battles left running here would keep ticking inside later test files: finish them.
const pool=createPool();after(async()=>{await pool.query('UPDATE live_battles SET completed_at=clock_timestamp() WHERE completed_at IS NULL');await pool.end();});
import {progressionContent} from '../fixtures/progression.mjs';
async function publish(c){
 const db=await pool.connect();try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(783120)');
  const id=Number((await db.query("SELECT nextval(pg_get_serial_sequence('content_versions','id')) AS id")).rows[0].id),label='pub_'+String(id).padStart(6,'0');
  await db.query('INSERT INTO content_versions(id,content_version,sha256,content,resources,required_capabilities,source_draft_id,source_draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[id,label,createHash('sha256').update(label+randomUUID()).digest('hex'),{...c,content_version:label},'[]',c.required_capabilities,randomUUID()]);
  const cur=(await db.query("SELECT revision FROM content_pointer WHERE channel='test' FOR UPDATE")).rows[0];
  await db.query("INSERT INTO content_pointer(channel,version_id,revision) VALUES('test',$1,$2) ON CONFLICT (channel) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision",[id,(cur?.revision??0)+1]);
  await db.query('COMMIT');return label;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
test('heroes: levels, double tap, shortage, rank copies/materials, protected/equipped/foreign copies, sync, equipment, battle snapshot, rewards',{timeout:120000},async()=>{
 assert.equal(validate('content',progressionContent()).ok,true,'fixture is valid content');
 const api=await buildApp(pool);await api.ready();try{
  await publish(progressionContent());
  const guest=async()=>{const g=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();return {g,headers:{authorization:`Bearer ${g.access_token}`}};};
  const {g,headers}=await guest();
  const get=async()=>{const r=await api.inject({url:'/v1/heroes',headers});assert.equal(r.statusCode,200,r.body);const v=validate('heroes',r.json());assert.equal(v.ok,true,JSON.stringify(v));return r.json();};
  const post=(url,payload,h=headers)=>api.inject({method:'POST',url,headers:h,payload});
  const give=(currency,delta)=>applyDelta(pool,{playerId:g.player_id,currency,delta,reason:'test_grant',sourceId:'test',key:'test-grant-'+randomUUID()});
  const bal=async()=>Object.fromEntries((await pool.query('SELECT currency,amount FROM balances WHERE player_id=$1',[g.player_id])).rows.map(r=>[r.currency,Number(r.amount)]));

  // Starters granted once; the first five fill the main team; repeat GET grants nothing.
  let s=await get();assert.equal(s.heroes.length,8);assert.equal(s.main.length,5);assert.equal(s.items.length,2);
  s=await get();assert.equal(s.heroes.length,8,'starters are granted once');
  const [a1,b1,c1,d1,e1,a2,a3,b2]=s.heroes.map(h=>h.id);
  assert.deepEqual(s.main,[a1,b1,c1,d1,e1]);
  const h=id=>s.heroes.find(x=>x.id===id);
  assert.deepEqual(h(a1).next_level,{gold:10,hero_exp:20});assert.equal(h(a2).next_level,null,'only main heroes level up');
  assert.deepEqual(h(a1).rank_up.candidates.sort(),[a2,a3].sort(),'rank plan lists free copies');

  // Shortage: nothing changes.
  let r=await post('/v1/heroes/level',{instance_id:a1,from_level:1});assert.equal(r.statusCode,409);assert.equal(r.json().error.code,'INSUFFICIENT_BALANCE');
  await give('gold',1000);await give('hero_exp',1000);
  // Double tap (same expected state twice, and two in parallel): one level, paid once.
  const [p1,p2]=await Promise.all([post('/v1/heroes/level',{instance_id:a1,from_level:1}),post('/v1/heroes/level',{instance_id:a1,from_level:1})]);
  assert.deepEqual([p1.statusCode,p2.statusCode].sort(),[200,409]);
  r=await post('/v1/heroes/level',{instance_id:a1,from_level:1});assert.equal(r.statusCode,409);assert.equal(r.json().error.message,'STALE_STATE');
  assert.deepEqual(await bal(),{gold:990,hero_exp:980});
  r=await post('/v1/heroes/level',{instance_id:a2,from_level:1});assert.equal(r.json().error.message,'NOT_MAIN_HERO');
  r=await post('/v1/heroes/level',{instance_id:a1,from_level:2});assert.equal(r.statusCode,200);
  r=await post('/v1/heroes/level',{instance_id:a1,from_level:3});assert.equal(r.json().error.message,'LEVEL_CAP','rank 0 caps level 3');

  // Rank: foreign, main, protected and equipped copies are refused; nothing is spent.
  const other=await guest();await api.inject({url:'/v1/heroes',headers:other.headers});
  const foreign=(await api.inject({url:'/v1/heroes',headers:other.headers})).json().heroes.find(x=>x.hero_id==='hero_a'&&!x.role).id;
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[foreign]});assert.equal(r.json().error.message,'HERO_NOT_OWNED');
  r=await post('/v1/heroes/rank',{instance_id:a2,from_rank:0,copy_instance_ids:[a1]});assert.equal(r.json().error.message,'COPY_NOT_ALLOWED','main hero is not a copy');
  await post('/v1/heroes/protect',{instance_id:a3,protected:true});
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[a3]});assert.equal(r.json().error.message,'COPY_NOT_ALLOWED','protected');
  await post('/v1/heroes/protect',{instance_id:a3,protected:false});
  const sword=s.items.find(i=>i.item_id==='item_sword').id,armor=s.items.find(i=>i.item_id==='item_elf_armor').id;
  await post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:a3});
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[a3]});assert.equal(r.json().error.message,'COPY_NOT_ALLOWED','equipped');
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[b2]});assert.equal(r.json().error.message,'COPY_NOT_ALLOWED','other hero');
  // One copy + 50 material for the missing one: no material → refused, copy stays.
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[a2]});assert.equal(r.json().error.code,'INSUFFICIENT_BALANCE');
  assert.ok((await get()).heroes.some(x=>x.id===a2),'copy not consumed on failure');
  await give('rank_material',50);
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[a2]});assert.equal(r.statusCode,200,r.body);
  s=r.json();assert.equal(h(a1).rank,1);assert.equal(h(a1).max_level,5);assert.ok(!s.heroes.some(x=>x.id===a2),'copy spent');
  assert.equal((await bal()).rank_material,0);
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:0,copy_instance_ids:[]});assert.equal(r.json().error.message,'STALE_STATE','repeat rank tap');
  r=await post('/v1/heroes/rank',{instance_id:a1,from_rank:1,copy_instance_ids:[]});assert.equal(r.json().error.message,'RANK_MAX','boundary rank');

  // Sync: a 6th hero in sync gets the weakest main level only with five mains.
  r=await post('/v1/heroes/team',{main:[a1,b1,c1,d1,e1],sync:[b2]});s=r.json();
  assert.equal(s.sync_level,1);assert.equal(h(b2).effective_level,1);
  for(const id of [b1,c1,d1,e1])for(const lv of [1,2])assert.equal((await post('/v1/heroes/level',{instance_id:id,from_level:lv})).statusCode,200);
  s=await get();assert.equal(s.sync_level,3);assert.equal(h(b2).effective_level,3);assert.equal(h(b2).level,1,'sync does not copy experience');
  r=await post('/v1/heroes/team',{main:[a1,b1,c1,d1,e1],sync:[b2,a3,foreign]});assert.equal(r.json().error.message,'SYNC_SLOTS_EXCEEDED');
  r=await post('/v1/heroes/team',{main:[a1,b1],sync:[a1]});assert.equal(r.json().error.message,'HERO_IN_TWO_PLACES');
  r=await post('/v1/heroes/team',{main:[a1,b1,c1,d1],sync:[b2]});s=r.json();
  assert.equal(s.sync_level,null,'fewer than five mains: sync off');assert.equal(h(b2).effective_level,1);
  // Swap a main hero for the sync one: it uses its own level; the removed one keeps its level.
  r=await post('/v1/heroes/team',{main:[a1,b1,c1,d1,b2],sync:[e1]});s=r.json();
  assert.equal(h(e1).level,3);assert.equal(h(b2).effective_level,1);assert.equal(s.sync_level,1);assert.equal(h(e1).effective_level,1,'sync to weakest');
  await post('/v1/heroes/team',{main:[a1,b1,c1,d1,e1],sync:[]});

  // Equipment: move between heroes, parallel equips leave one owner, incompatible slot/faction.
  r=await post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:a1});s=r.json();
  assert.equal(s.items.find(i=>i.id===sword).equipped_on,a1);assert.deepEqual(h(a3).equipped,[]);
  const before=h(a1).stats.attack;
  await Promise.all([post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:b1}),post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:c1})]);
  s=await get();assert.equal(s.heroes.filter(x=>x.equipped.includes(sword)).length,1,'one item on one hero');
  await post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:a1});s=await get();assert.equal(h(a1).stats.attack,before);
  r=await post('/v1/items/equip',{item_instance_id:armor,hero_instance_id:a1});assert.equal(r.json().error.message,'ITEM_INCOMPATIBLE');
  await post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:null});s=await get();assert.equal(h(a1).stats.attack,before-100,'bonus removed exactly');
  await post('/v1/items/equip',{item_instance_id:sword,hero_instance_id:a1});
  // Upgrade: 30 gold, stale/double tap refused, max 2.
  const g0=(await bal()).gold;
  const [u1,u2]=await Promise.all([post('/v1/items/upgrade',{item_instance_id:sword,from_upgrade:0}),post('/v1/items/upgrade',{item_instance_id:sword,from_upgrade:0})]);
  assert.deepEqual([u1.statusCode,u2.statusCode].sort(),[200,409]);assert.equal((await bal()).gold,g0-30);
  assert.equal((await post('/v1/items/upgrade',{item_instance_id:sword,from_upgrade:1})).statusCode,200);
  r=await post('/v1/items/upgrade',{item_instance_id:sword,from_upgrade:2});assert.equal(r.json().error.message,'UPGRADE_MAX');
  s=await get();assert.equal(s.items.find(i=>i.id===sword).stats.attack,200,'+50% per upgrade x2');

  // Battle: owned instances only; the server snapshot carries level, rank and items.
  r=await post('/v1/live-battles',{request_id:randomUUID(),stage_id:'stage_one',hero_ids:['hero_a']});assert.equal(r.json().error.message,'ROSTER_REQUIRED');
  r=await post('/v1/live-battles',{request_id:randomUUID(),stage_id:'stage_one',instance_ids:[foreign]});assert.equal(r.json().error.message,'HERO_NOT_OWNED');
  r=await post('/v1/live-battles',{request_id:randomUUID(),stage_id:'stage_one',instance_ids:[a1]});assert.equal(r.statusCode,200,r.body);
  const battle=r.json();
  const row=(await pool.query('SELECT session_state,attacker_mods,instance_ids FROM live_battles WHERE id=$1',[battle.battle_id])).rows[0];
  const atk=row.session_state.setup?.actors?.find(x=>x.id==='atk_0')??row.session_state.state.actors.find(x=>x.id==='atk_0');
  // level 3, rank 1: 100*(1+0.2+0.2)=140 + sword 200 = 340 attack; hp 1000*1.4=1400.
  assert.equal(atk.attack,340);assert.equal(atk.max_hp,1400);assert.deepEqual(row.instance_ids,[a1]);
  assert.deepEqual(row.attacker_mods,[{level:3,rank:1,items:[{item_id:'item_sword',upgrade:2}]}]);
  let done;for(let i=0;i<150&&!done;i++){const x=(await api.inject({url:'/v1/live-battles/'+battle.battle_id,headers})).json();if(x.result)done=x.result;else await new Promise(res=>setTimeout(res,100));}
  assert.equal(done,'attacker_win');
  // First-clear rewards: hero, item, hero_exp; once.
  s=await get();assert.equal(s.heroes.filter(x=>x.hero_id==='hero_f').length,1);assert.equal(s.items.filter(i=>i.item_id==='item_bow').length,1);
  assert.equal((await bal()).hero_exp,980-30-20*4-30*4+500);
  // Enemy level from the stage: level 5 → hp 50*1.4=70.
  r=await post('/v1/live-battles',{request_id:randomUUID(),stage_id:'stage_two',instance_ids:[a1]});
  const row2=(await pool.query('SELECT session_state FROM live_battles WHERE id=$1',[r.json().battle_id])).rows[0];
  assert.equal(row2.session_state.state.actors.find(x=>x.id==='def_0').max_hp,70);
 }finally{await api.close();}
});
