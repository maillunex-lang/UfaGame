import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createPool,transaction} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {recordWin} from '../../services/api/src/campaign.ts';
import {validate} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const combat=o=>({hp:1000,attack:1000,defense:0,speed:0,range:20000,attack_interval_ms:100,energy_start:0,energy_per_second:0,energy_per_attack:0,...o});
const content=()=>({schema_version:1,content_version:'c',required_capabilities:['content.core.v1','battle.combat.v1','campaign.chapters.v1'],entities:[
 {id:'faction_one',kind:'faction',name:'Ф',data:{advantage_ids:[]}},
 {id:'ability_one',kind:'ability',name:'У',data:{effect:'damage',power:1,cooldown_ms:1000}},
 {id:'hero_strong',kind:'hero',name:'Батыр',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat:combat()}},
 {id:'hero_weak',kind:'hero',name:'Новичок',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat:combat({hp:1,attack:0})}},
 {id:'enemy_one',kind:'hero',name:'Волк',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat:combat({hp:500,attack:5})}},
 {id:'stage_one',kind:'stage',name:'Опушка',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000,rewards_first:[{currency:'gold',amount:100}]}},
 {id:'stage_boss',kind:'stage',name:'Логово',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000,boss:true,rewards_first:[{currency:'gold',amount:300},{currency:'gems',amount:5}]}},
 {id:'stage_training',kind:'stage',name:'Тренировка',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000,rewards_first:[{currency:'gold',amount:999}]}},
 {id:'chapter_one',kind:'chapter',name:'Глава 1',data:{order:1,stage_ids:['stage_one','stage_boss'],proposed:true}}]});
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
test('campaign: locked stage, free losses, first-clear reward once, next stage opens, training gives nothing, race-safe',{timeout:90000},async()=>{
 const api=await buildApp(pool);await api.ready();try{
  await publish(content());
  const g=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
  const headers={authorization:`Bearer ${g.access_token}`};
  const campaign=async()=>{const body=(await api.inject({url:'/v1/campaign',headers})).json();assert.equal(validate('campaign',body).ok,true,JSON.stringify(validate('campaign',body)));return body;};
  const gold=async()=>{const r=(await pool.query("SELECT currency,amount FROM balances WHERE player_id=$1",[g.player_id])).rows;return Object.fromEntries(r.map(x=>[x.currency,Number(x.amount)]));};
  const fight=async(stage,hero)=>{
   const r=await api.inject({method:'POST',url:'/v1/live-battles',headers,payload:{request_id:randomUUID(),stage_id:stage,hero_ids:[hero]}});
   if(r.statusCode!==200)return r;
   const id=r.json().battle_id;for(let i=0;i<100;i++){const s=(await api.inject({url:'/v1/live-battles/'+id,headers})).json();if(s.result)return {result:s.result,id};await new Promise(res=>setTimeout(res,100));}
   throw new Error('battle did not finish');
  };
  assert.equal((await api.inject({url:'/v1/campaign'})).statusCode,401);
  let c=await campaign();assert.deepEqual(c.chapters[0].stages.map(s=>[s.id,s.status,s.boss]),[['stage_one','open',false],['stage_boss','locked',true]]);
  assert.equal(c.chapters[0].proposed,true,'starting route is marked as a proposal');
  const locked=await fight('stage_boss','hero_strong');assert.equal(locked.statusCode,409);assert.equal(locked.json().error.message,'STAGE_LOCKED');
  // A loss costs nothing and changes nothing; the next attempt is free.
  assert.equal((await fight('stage_one','hero_weak')).result,'attacker_loss');
  assert.deepEqual(await gold(),{});assert.equal((await campaign()).chapters[0].stages[1].status,'locked');
  const win=await fight('stage_one','hero_strong');assert.equal(win.result,'attacker_win');
  assert.deepEqual(await gold(),{gold:100});c=await campaign();
  assert.deepEqual(c.chapters[0].stages.map(s=>s.status),['cleared','open']);assert.equal(c.chapters[0].stages[0].cleared_battle_id,win.id);
  assert.equal((await fight('stage_one','hero_strong')).result,'attacker_win');assert.deepEqual(await gold(),{gold:100},'repeat win pays nothing');
  // Training stage outside chapters: free play, no progress or reward.
  assert.equal((await fight('stage_training','hero_strong')).result,'attacker_win');assert.deepEqual(await gold(),{gold:100});
  // Race: the same winning battle recorded twice concurrently pays once.
  const boss=await fight('stage_boss','hero_strong');assert.equal(boss.result,'attacker_win');
  const row=(await pool.query('SELECT id,player_id,stage_id,content_version FROM live_battles WHERE id=$1',[boss.id])).rows[0];
  await Promise.all([transaction(pool,c2=>recordWin(c2,row)),transaction(pool,c2=>recordWin(c2,row))]);
  assert.deepEqual(await gold(),{gold:400,gems:5});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ledger WHERE player_id=$1 AND reason='campaign_first_clear'",[g.player_id])).rows[0].n,3);
 }finally{await api.close();}
});
