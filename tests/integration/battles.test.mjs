import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {validate} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const combat=(o={})=>({hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100,...o});
const content=(wolfHp=200)=>({schema_version:1,content_version:'x',required_capabilities:['content.core.v1','battle.combat.v1','battle.abilities.v2'],entities:[
 {id:'faction_ural',kind:'faction',name:'Урал',data:{advantage_ids:['faction_steppe'],advantage_bp:13000}},{id:'faction_steppe',kind:'faction',name:'Степь',data:{advantage_ids:[]}},
 {id:'ability_roar',kind:'ability',name:'Рёв',data:{effect:'stun',power:1000,cooldown_ms:3000,target:'all_enemies'}},
 {id:'ability_bite',kind:'ability',name:'Укус',data:{effect:'damage',power:40,cooldown_ms:1000}},
 {id:'hero_bear',kind:'hero',name:'Медведь',data:{faction_id:'faction_ural',ability_ids:['ability_roar','ability_bite'],combat:combat({energy_start:1000})}},
 {id:'hero_plain',kind:'hero',name:'Без статов',data:{faction_id:'faction_ural',ability_ids:['ability_bite']}},
 {id:'enemy_wolf',kind:'hero',name:'Волк',data:{faction_id:'faction_steppe',ability_ids:['ability_bite'],combat:combat({hp:wolfHp})}},
 {id:'stage_edge',kind:'stage',name:'Край степи',data:{enemy_hero_ids:['enemy_wolf','enemy_wolf'],time_limit_ms:90000}}]});
/** Test fixture: publish an immutable version and move the pointer (as the owner publish does). */
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
test('player battles: server seed, pinned version, no client result, idempotent, replay-verified, no rewards',{timeout:60000},async()=>{
 const api=await buildApp(pool);try{
  const guest=async()=>(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:randomBytes(32).toString('base64url')}})).json();
  const me=await guest(),other=await guest(),auth=t=>({authorization:`Bearer ${t.access_token}`});
  const start=(payload,t=me)=>api.inject({method:'POST',url:'/v1/battles',payload,headers:auth(t)});
  const body={request_id:randomUUID(),stage_id:'stage_edge',hero_ids:['hero_bear','hero_bear']};
  assert.equal((await api.inject({method:'POST',url:'/v1/battles',payload:body})).statusCode,401);
  const v1=await publish(content());
  assert.equal((await start({...body,result:'attacker_win'})).statusCode,400,'client cannot submit a result');
  assert.equal((await start({...body,seed:1})).statusCode,400,'client cannot choose the seed');
  assert.equal((await start({...body,hero_ids:Array(6).fill('hero_bear')})).statusCode,400);
  const unknownStage=await start({...body,request_id:randomUUID(),stage_id:'stage_none'});assert.equal(unknownStage.statusCode,422);assert.equal(unknownStage.json().error.message,'UNKNOWN_STAGE:stage_none');
  const plain=await start({...body,request_id:randomUUID(),hero_ids:['hero_plain']});assert.equal(plain.statusCode,422);assert.equal(plain.json().error.message,'HERO_COMBAT_MISSING:hero_plain');
  const ghost=await start({...body,request_id:randomUUID(),hero_ids:['enemy_ghost']});assert.equal(ghost.statusCode,422);
  const first=await start(body);assert.equal(first.statusCode,200);const b1=first.json();
  assert.equal(validate('battle_record',b1).ok,true);assert.equal(b1.content_version,v1);assert.deepEqual(b1.rewards,[]);
  assert.ok(b1.events.some(e=>e.kind==='stun'),'v2 abilities are used by the server');
  const again=(await start(body)).json();assert.equal(again.battle_id,b1.battle_id);assert.equal(again.event_log_sha256,b1.event_log_sha256);
  assert.equal((await start({...body,hero_ids:['hero_bear']})).statusCode,409,'same request_id, different payload');
  const raceBody={...body,request_id:randomUUID()};const race=await Promise.all([start(raceBody),start(raceBody)]);
  assert.deepEqual(race.map(r=>r.statusCode),[200,200]);assert.equal(race[0].json().battle_id,race[1].json().battle_id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM battles WHERE player_id=$1',[me.player_id])).rows[0].n,2);
  const get=url=>api.inject({url,headers:auth(me)});
  assert.equal((await api.inject({url:'/v1/battles/'+b1.battle_id,headers:auth(other)})).statusCode,404,'other players cannot read');
  // A newer version does not change a finished battle: it stays pinned and replays identically.
  await publish(content(5000));
  const pinned=(await get('/v1/battles/'+b1.battle_id)).json();assert.equal(pinned.content_version,v1);assert.equal(pinned.event_log_sha256,b1.event_log_sha256);assert.deepEqual(pinned.actors,b1.actors);
  const newer=(await start({...body,request_id:randomUUID()})).json();assert.notEqual(newer.content_version,v1);
  await pool.query("UPDATE battles SET event_log_sha256=repeat('0',64) WHERE id=$1",[b1.battle_id]);
  const tampered=await get('/v1/battles/'+b1.battle_id);assert.equal(tampered.statusCode,500);assert.equal(tampered.json().error.message,'REPLAY_MISMATCH');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger WHERE player_id=$1',[me.player_id])).rows[0].n,0,'no rewards');
 }finally{await api.close();}
});
