import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {createOwner,OWNER_COOKIE} from '../../services/api/src/owner.ts';
import {validate} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const secret=()=>randomBytes(32).toString('base64url');
let password=secret();let ownerLogin;
const origin='https://studio.example.test';
const app=()=>buildApp(pool,{origin});
async function login(api){
 const response=await api.inject({method:'POST',url:'/admin/v1/sessions',headers:{origin},payload:{login:ownerLogin,password}});
 assert.equal(response.statusCode,200);assert.equal(validate('owner_session',response.json()).ok,true);return {cookie:response.headers['set-cookie'].split(';')[0],csrf:response.json().csrf_token,profile:response.json().owner,header:response.headers['set-cookie']};
}
const meta=()=>({reason:'integration test',request_id:randomUUID()});
const mutate=(api,url,payload,session,headers={})=>api.inject({method:url.endsWith('/profile')?'PATCH':'POST',url,payload,headers:{origin,cookie:session.cookie,'x-ufa-csrf':session.csrf,...headers}});

test('owner provision is singleton and audited; no default/public signup',async()=>{
 const names=['owner_a_'+randomUUID().slice(0,8),'owner_b_'+randomUUID().slice(0,8)];
 const results=await Promise.allSettled(names.map(name=>createOwner(pool,name,password)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONFLICT');
 ownerLogin=results.find(r=>r.status==='fulfilled').value.login;
 assert.equal((await pool.query('SELECT * FROM owner_accounts')).rowCount,1);
 const rows=(await pool.query("SELECT * FROM owner_audit WHERE action='owner.provision'")).rows;assert.equal(rows.length,1);assert.equal(rows[0].owner_id,1);assert.equal(rows[0].before_state,null);assert.ok(rows[0].after_state.login);
 const api=await app();try{assert.equal((await api.inject({method:'POST',url:'/admin/v1/signup',headers:{origin},payload:{login:'owner',password:secret()}})).statusCode,404);}finally{await api.close();}
 const disabled=await buildApp(pool,{});try{assert.equal((await disabled.inject('/admin/v1/owner')).statusCode,503);}finally{await disabled.close();}
});

test('player bearer/forged cookie rejected, owner secure scoped cookie, expiry and cross-origin login',async()=>{
 const api=await app();try{
  const guest=(await api.inject({method:'POST',url:'/v1/guests',payload:{installation_secret:secret()}})).json();
  const player=await api.inject({url:'/admin/v1/owner',headers:{authorization:`Bearer ${guest.access_token}`}});assert.equal(player.statusCode,401);assert.equal(player.headers['cache-control'],'no-store');
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:`${OWNER_COOKIE}=${guest.access_token}`}})).statusCode,401);
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/sessions',payload:{login:ownerLogin,password}})).statusCode,403);
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/sessions',headers:{origin:'https://evil.example'},payload:{login:ownerLogin,password}})).statusCode,403);
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/sessions',headers:{origin},payload:{login:ownerLogin,password:secret()}})).statusCode,401);
  const session=await login(api);for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/game/server/admin/v1'])assert.ok(session.header.includes(flag));assert.ok(!session.header.includes('Domain='));
  const restored=await api.inject({url:'/admin/v1/session',headers:{cookie:session.cookie}});assert.equal(restored.statusCode,200);assert.equal(restored.json().csrf_token,session.csrf);
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:session.cookie+'; '+session.cookie}})).statusCode,401);
  await pool.query("UPDATE owner_sessions SET expires_at=now()-interval '1 second' WHERE id=(SELECT id FROM owner_sessions ORDER BY created_at DESC LIMIT 1)");
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:session.cookie}})).statusCode,401);
 }finally{await api.close();}
});

test('CSRF/origin/extra fields rejected; profile optimistic race and retry write only one audit',async()=>{
 const api=await app();try{
  const session=await login(api),body={display_name:'Владелец',expected_revision:session.profile.revision,...meta()};
  assert.equal((await mutate(api,'/admin/v1/owner/profile',body,session,{'x-ufa-csrf':''})).statusCode,403);
  assert.equal((await mutate(api,'/admin/v1/owner/profile',body,session,{'x-ufa-csrf':secret()})).statusCode,403);
  assert.equal((await mutate(api,'/admin/v1/owner/profile',body,session,{origin:'https://other.example'})).statusCode,403);
  assert.equal((await mutate(api,'/admin/v1/owner/profile',{...body,owner_id:1},session)).statusCode,400);
  const competing={...body,display_name:'Другой',request_id:randomUUID()};
  const writes=await Promise.all([mutate(api,'/admin/v1/owner/profile',body,session),mutate(api,'/admin/v1/owner/profile',competing,session)]);
  assert.deepEqual(writes.map(r=>r.statusCode).sort(),[200,409]);const winner=writes.find(r=>r.statusCode===200).json();
  // Repeat whichever request won, using the original UUID/payload.
  const original=writes[0].statusCode===200?body:competing;
  assert.deepEqual((await mutate(api,'/admin/v1/owner/profile',original,session)).json(),winner);assert.equal((await mutate(api,'/admin/v1/owner/profile',{...original,display_name:'Replay changed'},session)).statusCode,409);
  const changed=(await pool.query("SELECT * FROM owner_audit WHERE action='owner.profile'")).rows;assert.equal(changed.length,1);assert.equal(changed[0].before_state.revision,body.expected_revision);assert.equal(changed[0].after_state.revision,body.expected_revision+1);assert.ok(changed[0].reason);assert.ok(changed[0].request_id);
  const audit=await api.inject({url:'/admin/v1/audit?after=0&limit=100',headers:{cookie:session.cookie}});assert.equal(audit.statusCode,200);assert.ok(audit.json().events.length>=3);assert.equal(validate('owner_audit_page',audit.json()).ok,true);
  assert.equal((await api.inject({url:'/admin/v1/audit?after=9999999999999999999',headers:{cookie:session.cookie}})).statusCode,400);
  const serialized=JSON.stringify(audit.json());for(const field of ['password_hash','token_hash','csrf_token'])assert.ok(!serialized.includes('"'+field+'"'));assert.ok(!serialized.includes(password));assert.ok(!serialized.includes(session.csrf));
  await assert.rejects(pool.query("UPDATE owner_audit SET reason='overwrite'"),e=>e.code==='42501');
  await assert.rejects(pool.query('DELETE FROM owner_audit'),e=>e.code==='42501');
  await assert.rejects(pool.query('TRUNCATE owner_audit'),e=>e.code==='42501');
 }finally{await api.close();}
});

test('logout rejects CSRF, ends only current session; revoke-all ends all sessions',async()=>{
 const api=await app();try{
  const first=await login(api),second=await login(api);
  assert.equal((await mutate(api,'/admin/v1/sessions/logout',meta(),first,{'x-ufa-csrf':second.csrf})).statusCode,403);
  const ended=await mutate(api,'/admin/v1/sessions/logout',meta(),first);assert.equal(ended.statusCode,200);assert.ok(ended.headers['set-cookie'].includes('Max-Age=0'));
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:first.cookie}})).statusCode,401);
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:second.cookie}})).statusCode,200);
  assert.equal((await mutate(api,'/admin/v1/sessions/revoke-all',meta(),second)).statusCode,200);
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:second.cookie}})).statusCode,401);
 }finally{await api.close();}
});

test('password rotation revokes sessions, forbids old password and never audits password hashes',async()=>{
 const api=await app();try{
  const session=await login(api),next=secret();
  assert.equal((await mutate(api,'/admin/v1/owner/password',{current_password:secret(),new_password:next,...meta()},session)).statusCode,401);
  assert.equal((await mutate(api,'/admin/v1/owner/password',{current_password:password,new_password:next,...meta()},session)).statusCode,200);
  assert.equal((await api.inject({url:'/admin/v1/owner',headers:{cookie:session.cookie}})).statusCode,401);
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/sessions',headers:{origin},payload:{login:ownerLogin,password}})).statusCode,401);
  password=next;assert.ok((await login(api)).csrf);
  const event=(await pool.query("SELECT * FROM owner_audit WHERE action='owner.password'")).rows[0];assert.deepEqual(event.before_state,{credential_version:1});assert.deepEqual(event.after_state,{credential_version:2});assert.ok(!JSON.stringify(event).includes(next));
 }finally{await api.close();}
});

test('admin login rate limit returns shared error envelope',async()=>{
 const api=await app();try{let response;for(let i=0;i<7;i++)response=await api.inject({method:'POST',url:'/admin/v1/sessions',headers:{origin,'x-forwarded-for':`198.51.100.${i}`},payload:{}});assert.equal(response.statusCode,429);assert.equal(validate('error',response.json()).ok,true);}finally{await api.close();}
});

test('audit insert failure rolls back profile mutation atomically',async()=>{
 const api=await app();const requestId=randomUUID();
 try{
  const session=await login(api);const before=(await pool.query('SELECT display_name,revision FROM owner_accounts WHERE id=1')).rows[0];
  await pool.query(`CREATE FUNCTION owner_audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${requestId}'::uuid THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER owner_audit_test_fail BEFORE INSERT ON owner_audit FOR EACH ROW EXECUTE FUNCTION owner_audit_test_fail()');
  const response=await mutate(api,'/admin/v1/owner/profile',{display_name:'Must rollback',expected_revision:before.revision,reason:'atomic audit test',request_id:requestId},session);
  assert.equal(response.statusCode,500);assert.equal(response.json().error.code,'INTERNAL_ERROR');assert.ok(!response.body.includes('test audit failure'));
  assert.deepEqual((await pool.query('SELECT display_name,revision FROM owner_accounts WHERE id=1')).rows[0],before);
  assert.equal((await pool.query('SELECT * FROM owner_audit WHERE request_id=$1',[requestId])).rowCount,0);
 }finally{
  await pool.query('DROP TRIGGER IF EXISTS owner_audit_test_fail ON owner_audit');await pool.query('DROP FUNCTION IF EXISTS owner_audit_test_fail()');await api.close();
 }
});

test('draft create/save: owner authorization, CSRF, retries, conflicts, audit and persistence',async()=>{
 const api=await app();try{
  const session=await login(api),id=randomUUID();
  const content={schema_version:1,content_version:'draft_test',required_capabilities:['content.core.v1'],entities:[]};
  const body={id,name:'Черновик',content,...meta()};
  const post=(payload,headers={})=>api.inject({method:'POST',url:'/admin/v1/drafts',payload,headers:{origin,cookie:session.cookie,'x-ufa-csrf':session.csrf,...headers}});
  assert.equal((await api.inject({url:'/admin/v1/drafts'})).statusCode,401);
  assert.equal((await post(body,{'x-ufa-csrf':''})).statusCode,403);
  const created=await post(body);assert.equal(created.statusCode,200);assert.equal(created.json().revision,0);
  assert.deepEqual((await post(body)).json(),created.json());
  assert.equal((await post({...body,name:'Другое'})).statusCode,409);
  const put=(payload)=>api.inject({method:'PUT',url:'/admin/v1/drafts/'+id,payload,headers:{origin,cookie:session.cookie,'x-ufa-csrf':session.csrf}});
  const a={name:'Первый',content,expected_revision:0,...meta()},b={...a,name:'Второй',request_id:randomUUID()};
  const responses=await Promise.all([put(a),put(b)]);assert.deepEqual(responses.map(x=>x.statusCode).sort(),[200,409]);
  const winner=responses[0].statusCode===200?a:b;
  assert.deepEqual((await put(winner)).json(),responses.find(x=>x.statusCode===200).json());
  assert.equal((await put({...winner,name:'Изменённый повтор'})).statusCode,409);
  const restored=await api.inject({url:'/admin/v1/drafts/'+id,headers:{cookie:session.cookie}});assert.equal(restored.json().revision,1);assert.equal(restored.json().name,winner.name);
  const audit=(await pool.query("SELECT * FROM owner_audit WHERE action IN ('draft.create','draft.save') AND resource_id=$1 ORDER BY sequence",['draft:'+id])).rows;
  assert.equal(audit.length,2);assert.equal(audit[0].before_state,null);assert.equal(audit[1].before_state.revision,0);assert.equal(audit[1].after_state.revision,1);
  assert.equal(validate('owner_audit_page',(await api.inject({url:'/admin/v1/audit?after=0&limit=100',headers:{cookie:session.cookie}})).json()).ok,true);
 }finally{await api.close();}
});

test('private PNG resources: authorization, validation, idempotency and atomic audit',async()=>{
 const {crc32,deflateSync}=await import('node:zlib');
 const chunk=(name,data)=>{const tag=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);};
 const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);
 const api=await app();try{
  const session=await login(api),id='asset_'+randomUUID().replaceAll('-','').slice(0,16);
  const body={id,data_base64:image.toString('base64'),license:{name:'author-owned',attribution:'artist'},scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:1,height:1,duration_ms:100}],loop:true,...meta()};
  const post=(payload,headers={})=>api.inject({method:'POST',url:'/admin/v1/resources',payload,headers:{origin,cookie:session.cookie,'x-ufa-csrf':session.csrf,...headers}});
  assert.equal((await api.inject({method:'GET',url:'/admin/v1/resources'})).statusCode,401);
  assert.equal((await post(body,{'x-ufa-csrf':''})).statusCode,403);
  assert.equal((await post({...body,id:id+'_bad',data_base64:Buffer.from('not an image').toString('base64'),request_id:randomUUID()})).statusCode,400);
  const created=await post(body);assert.equal(created.statusCode,200);assert.equal(created.json().id,id);assert.equal(created.json().width,1);
  assert.deepEqual((await post(body)).json(),created.json());
  assert.equal((await post({...body,license:{...body.license,attribution:'changed'}})).statusCode,409);
  const response=await api.inject({url:'/admin/v1/resources/'+id+'/data',headers:{cookie:session.cookie}});
  assert.equal(response.statusCode,200);assert.match(response.headers['content-type'],/^image\/png/);assert.deepEqual(response.rawPayload,image);
  assert.equal((await api.inject({url:'/admin/v1/resources/'+id+'/data'})).statusCode,401);
  const audit=(await pool.query("SELECT before_state,after_state FROM owner_audit WHERE action='resource.create' AND resource_id=$1",['resource:'+id])).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].before_state,null);assert.equal(audit[0].after_state.id,id);assert.ok(!JSON.stringify(audit).includes(body.data_base64));
  const update={license:body.license,scale_bp:10000,anchor:{x:0,y:0},frames:body.frames,loop:true,expected_revision:0,...meta()};
  const patch=(payload)=>api.inject({method:'PATCH',url:'/admin/v1/resources/'+id,payload,headers:{origin,cookie:session.cookie,'x-ufa-csrf':session.csrf}});
  assert.equal((await patch({...update,frames:[{x:0,y:0,width:2,height:1,duration_ms:100}]})).statusCode,400);
  const saved=await patch(update);assert.equal(saved.statusCode,200);assert.equal(saved.json().revision,1);
  assert.deepEqual((await patch(update)).json(),saved.json());
  assert.equal((await patch({...update,request_id:randomUUID()})).statusCode,409);
  const updateAudit=(await pool.query("SELECT before_state,after_state FROM owner_audit WHERE action='resource.update' AND resource_id=$1",['resource:'+id])).rows;
  assert.equal(updateAudit.length,1);assert.equal(updateAudit[0].before_state.revision,0);assert.equal(updateAudit[0].after_state.revision,1);
  const raceUpdate={...update,expected_revision:1};
  const competing=await Promise.all([patch({...raceUpdate,scale_bp:11000,request_id:randomUUID()}),patch({...raceUpdate,scale_bp:12000,request_id:randomUUID()})]);
  assert.deepEqual(competing.map(x=>x.statusCode).sort(),[200,409]);
  const conflict=await Promise.all([post({...body,id:id+'_race',request_id:randomUUID()}),post({...body,id:id+'_race',request_id:randomUUID()})]);
  assert.deepEqual(conflict.map(x=>x.statusCode).sort(),[200,409]);
 }finally{await api.close();}
});

test('battle preview: owner-only, CSRF, stale revision, content errors, deterministic and read-only',async()=>{
 const api=await app();try{
  const session=await login(api),id=randomUUID();
  const combat={hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100};
  const content={schema_version:1,content_version:'draft_battle',required_capabilities:['content.core.v1','battle.combat.v1'],entities:[
   {id:'faction_sun',kind:'faction',name:'Солнце',data:{advantage_ids:['faction_moon']}},
   {id:'faction_moon',kind:'faction',name:'Луна',data:{advantage_ids:[]}},
   {id:'ability_strike',kind:'ability',name:'Удар',data:{effect:'damage',power:60,cooldown_ms:1000,energy_cost:500}},
   {id:'hero_batyr',kind:'hero',name:'Батыр',data:{faction_id:'faction_sun',ability_ids:['ability_strike'],combat}},
   {id:'hero_plain',kind:'hero',name:'Без статов',data:{faction_id:'faction_sun',ability_ids:['ability_strike']}},
   {id:'enemy_wolf',kind:'hero',name:'Волк',data:{faction_id:'faction_moon',ability_ids:['ability_strike'],combat:{...combat,hp:200}}},
   {id:'stage_forest',kind:'stage',name:'Лес',data:{enemy_hero_ids:['enemy_wolf','enemy_wolf'],time_limit_ms:90000}}]};
  const headers={origin,cookie:session.cookie,'x-ufa-csrf':session.csrf};
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/drafts',payload:{id,name:'Бой',content:{...content,required_capabilities:['content.core.v1']},...meta()},headers})).statusCode,400,'combat requires capability');
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/drafts',payload:{id,name:'Бой',content,...meta()},headers})).statusCode,200);
  const url='/admin/v1/drafts/'+id+'/battle-preview',body={expected_revision:0,attacker_hero_ids:['hero_batyr','hero_batyr'],stage_id:'stage_forest',seed:42};
  const preview=(payload,h=headers)=>api.inject({method:'POST',url,payload,headers:h});
  assert.equal((await preview(body,{origin})).statusCode,401);
  assert.equal((await preview(body,{...headers,'x-ufa-csrf':''})).statusCode,403);
  assert.equal((await preview(body,{...headers,origin:'https://evil.example'})).statusCode,403);
  assert.equal((await api.inject({method:'POST',url:'/admin/v1/drafts/'+randomUUID()+'/battle-preview',payload:body,headers})).statusCode,404);
  assert.equal((await preview({...body,expected_revision:1})).statusCode,409);
  assert.equal((await preview({...body,result:'attacker_win'})).statusCode,400,'client cannot submit a result');
  assert.equal((await preview({...body,attacker_hero_ids:Array(6).fill('hero_batyr')})).statusCode,400);
  const missing=await preview({...body,attacker_hero_ids:['hero_plain']});assert.equal(missing.statusCode,422);assert.equal(missing.json().error.message,'HERO_COMBAT_MISSING:hero_plain');assert.equal(validate('error',missing.json()).ok,true);
  const unknown=await preview({...body,stage_id:'stage_none'});assert.equal(unknown.statusCode,422);assert.equal(unknown.json().error.message,'UNKNOWN_STAGE:stage_none');
  const auditBefore=(await pool.query('SELECT count(*)::int AS n FROM owner_audit')).rows[0].n;
  const first=await preview(body),second=await preview(body);
  assert.equal(first.statusCode,200);assert.equal(first.headers['cache-control'],'no-store');
  assert.equal(validate('battle_preview',first.json()).ok,true);assert.deepEqual(first.json(),second.json());
  assert.equal(first.json().draft_revision,0);assert.equal(first.json().actors.length,4);assert.equal(first.json().actors[2].hero_id,'enemy_wolf');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_audit')).rows[0].n,auditBefore,'preview writes nothing');
  const other=await preview({...body,defender_hero_ids:['enemy_wolf'],stage_id:undefined,seed:43});assert.equal(other.statusCode,200);
 }finally{await api.close();}
});

test('WAV resources and content resource references: type by bytes, audio metadata, draft link checks',async()=>{
 const {crc32,deflateSync}=await import('node:zlib');
 const chunk=(name,data)=>{const tag=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);};
 const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);
 const wav=(()=>{const data=Buffer.alloc(1600),fmt=Buffer.alloc(16);fmt.writeUInt16LE(1,0);fmt.writeUInt16LE(1,2);fmt.writeUInt32LE(8000,4);fmt.writeUInt32LE(16000,8);fmt.writeUInt16LE(2,12);fmt.writeUInt16LE(16,14);
  const c=(id,b)=>{const x=Buffer.alloc(8);x.write(id,0,'ascii');x.writeUInt32LE(b.length,4);return Buffer.concat([x,b]);};const body=Buffer.concat([Buffer.from('WAVE'),c('fmt ',fmt),c('data',data)]);const head=Buffer.alloc(8);head.write('RIFF',0,'ascii');head.writeUInt32LE(body.length,4);return Buffer.concat([head,body]);})();
 const api=await app();try{
  const session=await login(api),headers={origin,cookie:session.cookie,'x-ufa-csrf':session.csrf},suffix=randomUUID().replaceAll('-','').slice(0,12);
  const post=(payload)=>api.inject({method:'POST',url:'/admin/v1/resources',payload,headers});
  const base={license:{name:'own',attribution:''},scale_bp:10000,loop:false};
  const sound='sound_'+suffix,sprite='sprite_'+suffix;
  assert.equal((await post({...base,id:sound,data_base64:wav.toString('base64'),frames:[{x:0,y:0,width:1,height:1,duration_ms:100}],...meta()})).statusCode,422);
  const created=await post({...base,id:sound,data_base64:wav.toString('base64'),...meta()});assert.equal(created.statusCode,200);
  assert.equal(created.json().media_type,'audio/wav');assert.equal(created.json().duration_ms,100);assert.equal(validate('resource_descriptor',{...created.json(),revision:undefined}).ok,false,'revision is an API addition');
  assert.equal((await post({...base,id:sprite,data_base64:image.toString('base64'),...meta()})).statusCode,200);
  const data=await api.inject({url:`/admin/v1/resources/${sound}/data`,headers:{cookie:session.cookie}});
  assert.match(data.headers['content-type'],/^audio\/wav/);assert.equal(data.headers['x-content-type-options'],'nosniff');assert.deepEqual(data.rawPayload,wav);
  const patch=await api.inject({method:'PATCH',url:'/admin/v1/resources/'+sound,payload:{license:base.license,scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:1,height:1,duration_ms:100}],loop:true,expected_revision:0,...meta()},headers});
  assert.equal(patch.statusCode,422);assert.equal(patch.json().error.message,'AUDIO_FRAMES_UNSUPPORTED');
  const content=(sp,so,caps=['content.core.v1','content.resources.v1'])=>({schema_version:1,content_version:'draft_res',required_capabilities:caps,entities:[
   {id:'faction_one',kind:'faction',name:'Ф',data:{advantage_ids:[]}},
   {id:'ability_one',kind:'ability',name:'У',data:{effect:'damage',power:1,cooldown_ms:0,...(so?{sound_resource_id:so}:{})}},
   {id:'hero_one',kind:'hero',name:'Г',data:{faction_id:'faction_one',ability_ids:['ability_one'],...(sp?{sprite_resource_id:sp}:{})}}]});
  const draft=(c)=>api.inject({method:'POST',url:'/admin/v1/drafts',payload:{id:randomUUID(),name:'Ресурсы',content:c,...meta()},headers});
  assert.equal((await draft(content(sprite,sound,['content.core.v1']))).statusCode,400,'capability required');
  const missing=await draft(content('sprite_none_'+suffix,sound));assert.equal(missing.statusCode,422);assert.equal(missing.json().error.message,`RESOURCE_REF_INVALID:sprite_none_${suffix}`);
  const wrongType=await draft(content(sound,sound));assert.equal(wrongType.statusCode,422,'sprite must be an image');
  const swapped=await draft(content(sprite,sprite));assert.equal(swapped.statusCode,422,'sound must be audio');
  const before=(await pool.query('SELECT count(*)::int AS n FROM studio_drafts')).rows[0].n;
  assert.equal((await draft(content(sprite,sound))).statusCode,200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM studio_drafts')).rows[0].n,before+1);
 }finally{await api.close();}
});
