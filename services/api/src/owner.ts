import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {transaction} from './db.ts';
import {DomainError} from './errors.ts';
import {requireBody,randomToken} from './auth.ts';
import {validate,resourceRefs} from '@ufagame/contracts';
import {hashPassword,verifyPassword} from './passwords.ts';
import {ResourceRegistry} from '../../../packages/content-validator/resource-registry.mjs';
import {compileContentBattle,runAutoBattle,BattleCompileError} from '../../../packages/battle-core/compile.mjs';
import {inspectArchive,PackageError} from '../../../packages/content-validator/archive.mjs';
import {planImport} from '../../../packages/content-validator/plan-import.mjs';
import {exportContent} from '../../../packages/content-validator/export.mjs';

export const OWNER_COOKIE='__Secure-ufagame-owner';
export interface OwnerOptions {origin?:string;cookiePath?:string}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const sessionHash=(token:string)=>hash('ufagame/owner-session/v1:'+token);
const csrfFor=(token:string)=>createHash('sha256').update('ufagame/owner-csrf/v1:'+token).digest('base64url');
const profile=(row:any)=>({id:row.id,login:row.login,display_name:row.display_name,revision:row.revision});
const unauthorized=()=>new DomainError('UNAUTHORIZED',401);
const forbidden=()=>new DomainError('FORBIDDEN',403);
const fingerprint=(action:string,reason:string,payload:any)=>hash(JSON.stringify([action,reason,payload]));
function safeSnapshot(value:any):void {
 if(value===null||typeof value!=='object')return;
 for(const [key,child] of Object.entries(value)){
  if(/^(password|password_hash|token|token_hash|access_token|refresh_token|recovery_code|cookie|csrf_token)$/i.test(key))throw new Error('Secret field in audit snapshot');
  safeSnapshot(child);
 }
}
async function audit(c:PoolClient,action:string,reason:string,requestId:string,before:any,after:any,fp:string,resourceId="owner:1"){
 safeSnapshot(before);safeSnapshot(after);
 try{await c.query('INSERT INTO owner_audit(id,owner_id,action,resource_id,reason,request_id,fingerprint,before_state,after_state) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),action,resourceId,reason,requestId,fp,before,after]);}
 catch(error){if((error as any).code==='23505')throw new DomainError('CONFLICT',409);throw error;}
}
export async function createOwner(pool:Pool,login:string,password:string){
 requireBody('owner_login_request',{login,password});const encoded=await hashPassword(password);
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(783108)');
  if((await c.query('SELECT id FROM owner_accounts')).rowCount)throw new DomainError('CONFLICT',409);
  const owner=(await c.query('INSERT INTO owner_accounts(id,login,display_name,password_hash) VALUES(1,$1,$1,$2) RETURNING *',[login.toLowerCase(),encoded])).rows[0];
  await audit(c,'owner.provision','initial_owner_provision',randomUUID(),null,profile(owner),fingerprint('owner.provision','initial_owner_provision',profile(owner)));
  return profile(owner);
 });
}
function cookieToken(request:FastifyRequest){
 const duplicates=(request.headers.cookie??'').split(';').filter(part=>part.trim().split('=')[0]===OWNER_COOKIE).length;
 const token=request.cookies[OWNER_COOKIE];
 if(duplicates!==1||!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw unauthorized();return token;
}
async function activeOwner(pool:Pool,token:string){
 const row=(await pool.query('SELECT o.*,s.id AS session_id,s.expires_at FROM owner_sessions s JOIN owner_accounts o ON o.id=s.owner_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()',[sessionHash(token)])).rows[0];
 if(!row)throw unauthorized();return row;
}
async function lockOwner(c:PoolClient,token:string){
 await c.query('SELECT id FROM owner_accounts WHERE id=1 FOR UPDATE');
 const row=(await c.query('SELECT o.*,s.id AS session_id,s.expires_at FROM owner_sessions s JOIN owner_accounts o ON o.id=s.owner_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() FOR UPDATE OF s',[sessionHash(token)])).rows[0];
 if(!row)throw unauthorized();return row;
}
function verifyCsrf(request:FastifyRequest,token:string){
 const supplied=request.headers['x-ufa-csrf'];
 if(typeof supplied!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(csrfFor(token))))throw forbidden();
}
export async function registerOwner(app:FastifyInstance,pool:Pool,options:OwnerOptions={}){
 let origin:string|undefined;
 if(options.origin){const parsed=new URL(options.origin);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('Invalid ADMIN_ORIGIN');origin=parsed.origin;}
 const path=options.cookiePath??'/game/server/admin/v1';
 if(!/^\/[A-Za-z0-9/_-]+$/.test(path)||!path.endsWith('/admin/v1'))throw new Error('Invalid ADMIN_COOKIE_PATH');
 const cookieOptions={path,secure:true,httpOnly:true,sameSite:'strict' as const};
 await app.register(async admin=>{
  admin.addHook('onRequest',async request=>{
   if(!origin)throw new DomainError('SERVICE_UNAVAILABLE',503);
   const supplied=request.headers.origin;
   if(supplied&&supplied!==origin)throw forbidden();
   if(!['GET','HEAD','OPTIONS'].includes(request.method)&&supplied!==origin)throw forbidden();
  });
  admin.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store');return payload;});
  admin.post('/sessions',{config:{rateLimit:{max:5,timeWindow:60000}}},async(request,reply)=>{
   requireBody('owner_login_request',request.body);const body=request.body as any;
   const old=(await pool.query('SELECT * FROM owner_accounts WHERE id=1 AND login=$1',[body.login.toLowerCase()])).rows[0];
   if(!await verifyPassword(body.password,old?.password_hash??null))throw unauthorized();
   const token=randomToken();
   const session=await transaction(pool,async c=>{
    const owner=(await c.query('SELECT * FROM owner_accounts WHERE id=1 FOR UPDATE')).rows[0];
    if(owner.password_hash!==old.password_hash)throw unauthorized();
    const row=(await c.query("INSERT INTO owner_sessions(id,owner_id,token_hash,expires_at) VALUES($1,1,$2,now()+interval '30 minutes') RETURNING *",[randomUUID(),sessionHash(token)])).rows[0];
    await audit(c,'session.login','owner_login',randomUUID(),null,{session_id:row.id,active:true},fingerprint('session.login','owner_login',row.id));return {owner,row};
   });
   reply.setCookie(OWNER_COOKIE,token,{...cookieOptions,maxAge:1800});
   return {api_version:1,owner:profile(session.owner),csrf_token:csrfFor(token),expires_at:session.row.expires_at.toISOString()};
  });
  admin.get('/session',async request=>{const token=cookieToken(request),owner=await activeOwner(pool,token);return {api_version:1,owner:profile(owner),csrf_token:csrfFor(token),expires_at:owner.expires_at.toISOString()};});
  admin.get('/owner',async request=>profile(await activeOwner(pool,cookieToken(request))));
  admin.patch('/owner/profile',async request=>{
   const token=cookieToken(request);verifyCsrf(request,token);requireBody('owner_profile_request',request.body);const b=request.body as any;
   const fp=fingerprint('owner.profile',b.reason,[b.display_name,b.expected_revision]);
   return transaction(pool,async c=>{
    const owner=await lockOwner(c,token);
    const old=(await c.query('SELECT * FROM owner_audit WHERE owner_id=1 AND request_id=$1',[b.request_id])).rows[0];
    if(old){if(old.fingerprint!==fp||old.action!=='owner.profile')throw new DomainError('CONFLICT',409);return old.after_state;}
    if(owner.revision!==b.expected_revision)throw new DomainError('CONFLICT',409);
    const changed=(await c.query('UPDATE owner_accounts SET display_name=$1,revision=revision+1 WHERE id=1 RETURNING *',[b.display_name])).rows[0];
    await audit(c,'owner.profile',b.reason,b.request_id,profile(owner),profile(changed),fp);return profile(changed);
   });
  });
  for(const [route,all] of [['/sessions/logout',false],['/sessions/revoke-all',true]] as const){
   admin.post(route,async(request,reply)=>{
    const token=cookieToken(request);verifyCsrf(request,token);requireBody('owner_logout_request',request.body);const b=request.body as any;
    await transaction(pool,async c=>{
     const owner=await lockOwner(c,token);
     const before=Number((await c.query('SELECT count(*) AS count FROM owner_sessions WHERE owner_id=1 AND revoked_at IS NULL AND expires_at>now()')).rows[0].count);
     if(all)await c.query('UPDATE owner_sessions SET revoked_at=now() WHERE owner_id=1 AND revoked_at IS NULL');
     else await c.query('UPDATE owner_sessions SET revoked_at=now() WHERE id=$1',[owner.session_id]);
     await audit(c,all?'session.revoke_all':'session.logout',b.reason,b.request_id,{active_sessions:before},{active_sessions:all?0:before-1},fingerprint(route,b.reason,owner.session_id));
    });reply.clearCookie(OWNER_COOKIE,cookieOptions);return {ok:true};
   });
  }
  admin.post('/owner/password',async(request,reply)=>{
   const token=cookieToken(request);verifyCsrf(request,token);requireBody('owner_password_request',request.body);const b=request.body as any;
   const old=await activeOwner(pool,token);if(!await verifyPassword(b.current_password,old.password_hash))throw unauthorized();const encoded=await hashPassword(b.new_password);
   await transaction(pool,async c=>{
    const owner=await lockOwner(c,token);if(owner.password_hash!==old.password_hash)throw unauthorized();
    await c.query('UPDATE owner_accounts SET password_hash=$1,credential_version=credential_version+1 WHERE id=1',[encoded]);
    await c.query('UPDATE owner_sessions SET revoked_at=now() WHERE owner_id=1 AND revoked_at IS NULL');
    await audit(c,'owner.password',b.reason,b.request_id,{credential_version:owner.credential_version},{credential_version:owner.credential_version+1},fingerprint('owner.password',b.reason,owner.credential_version));
   });reply.clearCookie(OWNER_COOKIE,cookieOptions);return {ok:true,relogin:true};
  });
  admin.get('/drafts',async request=>{
   await activeOwner(pool,cookieToken(request));
   if(Object.keys(request.query as object).length)throw new DomainError('INVALID_REQUEST');
   return {drafts:(await pool.query('SELECT id,name,revision FROM studio_drafts ORDER BY updated_at DESC,id LIMIT 100')).rows};
  });
  admin.get('/drafts/:id',async request=>{
   await activeOwner(pool,cookieToken(request));const id=(request.params as any).id;
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new DomainError('INVALID_REQUEST');
   const row=(await pool.query('SELECT id,revision,name,content FROM studio_drafts WHERE id=$1',[id])).rows[0];
   if(!row)throw new DomainError('NOT_FOUND',404);return row;
  });
  async function writeDraft(request:FastifyRequest,create:boolean){
   const token=cookieToken(request);verifyCsrf(request,token);
   const b=request.body as any;requireBody(create?'draft_create_request':'draft_save_request',b);
   if(!validate('content',b.content).ok)throw new DomainError('INVALID_REQUEST');
   const id=create?b.id:(request.params as any).id;
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new DomainError('INVALID_REQUEST');
   const action=create?'draft.create':'draft.save',fp=fingerprint(action,b.reason,[id,b.name,b.content,create?null:b.expected_revision]);
   return transaction(pool,async c=>{
    await lockOwner(c,token);
    const old=(await c.query('SELECT * FROM owner_audit WHERE owner_id=1 AND request_id=$1',[b.request_id])).rows[0];
    if(old){if(old.fingerprint!==fp||old.action!==action)throw new DomainError('CONFLICT',409);return old.after_state;}
    const before=(await c.query('SELECT id,revision,name,content FROM studio_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0]??null;
    if(create&&before)throw new DomainError('CONFLICT',409);
    if(!create&&!before)throw new DomainError('NOT_FOUND',404);
    if(!create&&before.revision!==b.expected_revision)throw new DomainError('CONFLICT',409);
    const refs=resourceRefs(b.content);
    if(refs.length){
     const found=new Map((await c.query("SELECT id,descriptor->>'media_type' AS media_type FROM owner_resources WHERE id = ANY($1::text[]) FOR SHARE",[refs.map(r=>r.resource_id)])).rows.map(r=>[r.id,r.media_type]));
     const bad=refs.find(r=>found.get(r.resource_id)!==r.media_type);
     if(bad)throw new DomainError('INVALID_REQUEST',422,`RESOURCE_REF_INVALID:${bad.resource_id}`);
    }
    const changed=create?(await c.query('INSERT INTO studio_drafts(id,name,content) VALUES($1,$2,$3) RETURNING id,revision,name,content',[id,b.name,b.content])).rows[0]:(await c.query('UPDATE studio_drafts SET name=$2,content=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,revision,name,content',[id,b.name,b.content])).rows[0];
    await audit(c,action,b.reason,b.request_id,before,changed,fp,'draft:'+id);return changed;
   });
  }
  admin.post('/drafts',async request=>writeDraft(request,true));
  admin.put('/drafts/:id',async request=>writeDraft(request,false));
  admin.post('/drafts/:id/battle-preview',{config:{rateLimit:{max:20,timeWindow:60000}}},async request=>{
   const token=cookieToken(request);verifyCsrf(request,token);await activeOwner(pool,token);
   const id=(request.params as any).id,b=request.body as any;
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new DomainError('INVALID_REQUEST');
   requireBody('battle_preview_request',b);
   const row=(await pool.query('SELECT id,revision,content FROM studio_drafts WHERE id=$1',[id])).rows[0];
   if(!row)throw new DomainError('NOT_FOUND',404);
   if(row.revision!==b.expected_revision)throw new DomainError('CONFLICT',409);
   if(!validate('content',row.content).ok)throw new DomainError('INVALID_REQUEST',422,'DRAFT_CONTENT_INVALID');
   let compiled;
   try{compiled=compileContentBattle(row.content,b);}
   catch(error){if(error instanceof BattleCompileError)throw new DomainError('INVALID_REQUEST',422,error.entity_id?`${error.code}:${error.entity_id}`:error.code);throw error;}
   return {api_version:1,preview:true,draft_id:row.id,draft_revision:row.revision,...runAutoBattle(compiled.setup,{heroes:compiled.heroes})};
  });
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const packageError=(error:unknown):never=>{
   if(error instanceof PackageError)throw new DomainError('INVALID_REQUEST',422,[error.code,error.file,error.field].filter(Boolean).join(':').slice(0,160));
   if((error as Error).message==='RESOURCE_BUSY')throw new DomainError('SERVICE_UNAVAILABLE',503);
   throw error;
  };
  async function existingResources(){
   return new Map((await pool.query("SELECT id,descriptor->>'sha256' AS sha256,descriptor->>'media_type' AS media_type FROM owner_resources")).rows.map(r=>[r.id,{sha256:r.sha256,media_type:r.media_type}]));
  }
  async function preparePlan(id:string,b:any,draft:{revision:number;content:any}){
   const bytes=Buffer.from(b.zip_base64,'base64');
   if(!bytes.length||bytes.toString('base64')!==b.zip_base64)throw new DomainError('INVALID_REQUEST');
   try{
    const inspection=await inspectArchive(bytes);
    const plan=await planImport(inspection,draft,{expectedRevision:b.expected_revision,existingResources:await existingResources(),resolutions:b.resolutions??{}});
    return {plan,package_sha256:createHash('sha256').update(bytes).digest('hex')};
   }catch(error){
    if(error instanceof PackageError&&error.code==='STALE_DRAFT')throw new DomainError('CONFLICT',409);
    return packageError(error);
   }
  }
  const importLimits={bodyLimit:12*1024*1024,config:{rateLimit:{max:20,timeWindow:60000}}};
  admin.post('/drafts/:id/import/preflight',importLimits,async request=>{
   const token=cookieToken(request);verifyCsrf(request,token);await activeOwner(pool,token);
   const id=(request.params as any).id,b=request.body as any;
   if(!uuid.test(id))throw new DomainError('INVALID_REQUEST');requireBody('import_preflight_request',b);
   const draft=(await pool.query('SELECT id,revision,content FROM studio_drafts WHERE id=$1',[id])).rows[0];
   if(!draft)throw new DomainError('NOT_FOUND',404);
   const {plan,package_sha256}=await preparePlan(id,b,draft);
   return {draft_id:id,draft_revision:draft.revision,package_sha256,ready:plan.content!==null,report:plan.report};
  });
  admin.post('/drafts/:id/import/apply',importLimits,async request=>{
   const token=cookieToken(request);verifyCsrf(request,token);
   const id=(request.params as any).id,b=request.body as any;
   if(!uuid.test(id))throw new DomainError('INVALID_REQUEST');requireBody('import_apply_request',b);
   const action='draft.import',packageSha=createHash('sha256').update(b.zip_base64).digest('hex');
   const fp=fingerprint(action,b.reason,[id,b.expected_revision,packageSha,b.resolutions]);
   return transaction(pool,async c=>{
    await lockOwner(c,token);
    const old=(await c.query('SELECT * FROM owner_audit WHERE owner_id=1 AND request_id=$1',[b.request_id])).rows[0];
    if(old){if(old.fingerprint!==fp||old.action!==action)throw new DomainError('CONFLICT',409);return old.after_state;}
    const before=(await c.query('SELECT id,revision,name,content FROM studio_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!before)throw new DomainError('NOT_FOUND',404);
    if(before.revision!==b.expected_revision||before.revision>=2147483646)throw new DomainError('CONFLICT',409);
    await c.query('SELECT pg_advisory_xact_lock(783110)');
    const {plan,package_sha256}=await preparePlan(id,b,before);
    if(!plan.content)throw new DomainError('CONFLICT',409,'IMPORT_CONFLICTS_UNRESOLVED');
    const usage=(await c.query('SELECT count(*)::integer AS n, COALESCE(sum(octet_length(payload)),0)::bigint AS bytes FROM owner_resources')).rows[0];
    const added=plan.resources.reduce((sum:number,r:any)=>sum+r.bytes.length,0);
    if(usage.n+plan.resources.length>128||Number(usage.bytes)+added>32*1024*1024)throw new DomainError('CONFLICT',409,'RESOURCE_QUOTA');
    for(const r of plan.resources){
     try{await c.query('INSERT INTO owner_resources(id,descriptor,payload) VALUES($1,$2,$3)',[r.descriptor.id,r.descriptor,r.bytes]);}
     catch(error){if((error as any).code==='23505')throw new DomainError('CONFLICT',409,'RESOURCE_EXISTS:'+r.descriptor.id);throw error;}
    }
    const changed=(await c.query('UPDATE studio_drafts SET content=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,revision,name,content',[id,plan.content])).rows[0];
    const result={draft:changed,package_sha256,report:plan.report,created_resources:plan.resources.map((r:any)=>r.descriptor.id)};
    await audit(c,action,b.reason,b.request_id,{id:before.id,revision:before.revision,name:before.name,content:before.content},result,fp,'draft:'+id);
    return result;
   });
  });
  admin.get('/drafts/:id/export',{config:{rateLimit:{max:20,timeWindow:60000}}},async(request,reply)=>{
   await activeOwner(pool,cookieToken(request));const id=(request.params as any).id,q=request.query as any;
   if(!uuid.test(id)||Object.keys(q).some(k=>k!=='ids')||(q.ids!==undefined&&(typeof q.ids!=='string'||!/^[a-z][a-z0-9_]{2,79}(,[a-z][a-z0-9_]{2,79}){0,999}$/.test(q.ids))))throw new DomainError('INVALID_REQUEST');
   const draft=(await pool.query('SELECT id,revision,content FROM studio_drafts WHERE id=$1',[id])).rows[0];
   if(!draft)throw new DomainError('NOT_FOUND',404);
   const refs=resourceRefs(draft.content).map(r=>r.resource_id);
   const resources=new Map((await pool.query('SELECT id,descriptor,payload FROM owner_resources WHERE id = ANY($1::text[])',[refs])).rows.map(r=>[r.id,{descriptor:r.descriptor,bytes:r.payload}]));
   let zip:Buffer;
   try{zip=await exportContent(draft.content,{ids:q.ids?q.ids.split(','):null,resources});}catch(error){return packageError(error);}
   return reply.header('X-Content-Type-Options','nosniff').header('Content-Disposition',`attachment; filename="ufagame-draft-r${draft.revision}.zip"`).type('application/zip').send(zip);
  });
  admin.get('/resources',async request=>{
   await activeOwner(pool,cookieToken(request));
   if(Object.keys(request.query as object).length)throw new DomainError('INVALID_REQUEST');
   return {resources:(await pool.query('SELECT descriptor,revision FROM owner_resources ORDER BY id LIMIT 128')).rows.map(row=>({...row.descriptor,revision:row.revision}))};
  });
  admin.get('/resources/:id/data',async(request,reply)=>{
   await activeOwner(pool,cookieToken(request));const id=(request.params as any).id;
   if(typeof id!=='string'||!/^[a-z][a-z0-9_]{2,79}$/.test(id))throw new DomainError('INVALID_REQUEST');
   const row=(await pool.query("SELECT payload,descriptor->>'media_type' AS media_type FROM owner_resources WHERE id=$1",[id])).rows[0];
   if(!row)throw new DomainError('NOT_FOUND',404);
   if(row.media_type!=='image/png'&&row.media_type!=='audio/wav')throw new DomainError('INTERNAL_ERROR',500);
   return reply.header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").type(row.media_type).send(row.payload);
  });
  admin.post('/resources',{
   bodyLimit:12*1024*1024,
   config:{rateLimit:{max:10,timeWindow:60000}},
   onRequest:async request=>{const token=cookieToken(request);verifyCsrf(request,token);await activeOwner(pool,token);}
  },async request=>{
   const token=cookieToken(request),b=request.body as any;requireBody('resource_upload_request',b);
   const bytes=Buffer.from(b.data_base64,'base64');
   if(!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64')!==b.data_base64)throw new DomainError('INVALID_REQUEST');
   const registry=new ResourceRegistry();let descriptor:any;
   try {descriptor=await registry.addResource({id:b.id,bytes,license:b.license,scale_bp:b.scale_bp,anchor:b.anchor,frames:b.frames,loop:b.loop});}
   catch(error){const m=(error as Error).message;if(m==='RESOURCE_BUSY')throw new DomainError('SERVICE_UNAVAILABLE',503);if(m==='AUDIO_FRAMES_UNSUPPORTED')throw new DomainError('INVALID_REQUEST',422,m);throw new DomainError('INVALID_REQUEST');}
   const action='resource.create',fp=fingerprint(action,b.reason,[descriptor]);
   return transaction(pool,async c=>{
    await lockOwner(c,token);
    const old=(await c.query('SELECT * FROM owner_audit WHERE owner_id=1 AND request_id=$1',[b.request_id])).rows[0];
    if(old){if(old.fingerprint!==fp||old.action!==action)throw new DomainError('CONFLICT',409);return old.after_state;}
    await c.query('SELECT pg_advisory_xact_lock(783110)');
    const usage=(await c.query('SELECT count(*)::integer AS n, COALESCE(sum(octet_length(payload)),0)::bigint AS bytes FROM owner_resources')).rows[0];
    if(usage.n>=128||Number(usage.bytes)+bytes.length>32*1024*1024)throw new DomainError('CONFLICT',409);
    try {await c.query('INSERT INTO owner_resources(id,descriptor,payload) VALUES($1,$2,$3)',[descriptor.id,descriptor,bytes]);}
    catch(error){if((error as any).code==='23505')throw new DomainError('CONFLICT',409);throw error;}
    const result={...descriptor,revision:0};
    await audit(c,action,b.reason,b.request_id,null,result,fp,'resource:'+descriptor.id);
    return result;
   });
  });
  admin.patch('/resources/:id',async request=>{
   const token=cookieToken(request);verifyCsrf(request,token);const b=request.body as any;requireBody('resource_update_request',b);
   const id=(request.params as any).id;if(typeof id!=='string'||!/^[a-z][a-z0-9_]{2,79}$/.test(id))throw new DomainError('INVALID_REQUEST');
   const action='resource.update',fp=fingerprint(action,b.reason,[id,b.expected_revision,b.license,b.scale_bp,b.anchor,b.frames,b.loop]);
   return transaction(pool,async c=>{
    await lockOwner(c,token);
    const old=(await c.query('SELECT * FROM owner_audit WHERE owner_id=1 AND request_id=$1',[b.request_id])).rows[0];
    if(old){if(old.fingerprint!==fp||old.action!==action)throw new DomainError('CONFLICT',409);return old.after_state;}
    const before=(await c.query('SELECT descriptor,revision FROM owner_resources WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!before)throw new DomainError('NOT_FOUND',404);if(before.descriptor.media_type!=='image/png')throw new DomainError('INVALID_REQUEST',422,'AUDIO_FRAMES_UNSUPPORTED');if(before.revision!==b.expected_revision||before.revision===2147483647)throw new DomainError('CONFLICT',409);
    const descriptor={...before.descriptor,license:b.license,scale_bp:b.scale_bp,anchor:b.anchor,frames:b.frames,loop:b.loop};
    if(!validate('resource_descriptor',descriptor).ok||descriptor.anchor.x>=descriptor.width||descriptor.anchor.y>=descriptor.height||descriptor.frames.some((f:any)=>f.x+f.width>descriptor.width||f.y+f.height>descriptor.height))throw new DomainError('INVALID_REQUEST');
    const next={...descriptor,revision:before.revision+1};
    await c.query('UPDATE owner_resources SET descriptor=$2,revision=revision+1 WHERE id=$1',[id,descriptor]);
    await audit(c,action,b.reason,b.request_id,{...before.descriptor,revision:before.revision},next,fp,'resource:'+id);return next;
   });
  });
  admin.get('/audit',async request=>{
   await activeOwner(pool,cookieToken(request));requireBody('owner_audit_query',request.query);const query=request.query as any;
   const after=query.after??'0';if(BigInt(after)>9223372036854775807n)throw new DomainError('INVALID_REQUEST');const limit=Number(query.limit??50);
   const events=(await pool.query('SELECT sequence,id,owner_id,action,resource_id,reason,request_id,before_state,after_state,created_at FROM owner_audit WHERE sequence>$1 ORDER BY sequence LIMIT $2',[after,limit])).rows;
   return {events:events.map(row=>({...row,sequence:String(row.sequence),created_at:row.created_at.toISOString()})),next_cursor:events.length?String(events.at(-1).sequence):after};
  });
 },{prefix:'/admin/v1'});
}
