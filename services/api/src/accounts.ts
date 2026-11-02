import type {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import {timingSafeEqual} from 'node:crypto';
import {transaction} from './db.ts';
import {DomainError} from './errors.ts';
import {authorize,bearer,digest,lockAuthorized,newSession,randomToken,requireBody} from './auth.ts';
import {hashPassword,verifyPassword} from './passwords.ts';
const unauthorized=()=>new DomainError('UNAUTHORIZED',401);
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function registerAccounts(app:FastifyInstance,pool:Pool){
 const limited={config:{rateLimit:{max:10,timeWindow:60000}}};
 app.post('/v1/account/bind',limited,async request=>{
  requireBody('bind_request',request.body);const b=request.body as any,token=bearer(request);await authorize(pool,token);
  const password=await hashPassword(b.password),recovery=randomToken();
  try{return await transaction(pool,async c=>{
   const session=await lockAuthorized(c,token);const account=(await c.query('SELECT * FROM players WHERE id=$1',[session.player_id])).rows[0];
   if(account.account_type!=='guest')throw new DomainError('CONFLICT',409);
   await c.query("UPDATE players SET account_type='registered',login=$2,password_hash=$3,recovery_hash=$4,bootstrap_disabled=true WHERE id=$1",[session.player_id,b.login.toLowerCase(),password,digest(recovery)]);
   await c.query('UPDATE sessions SET revoked_at=now() WHERE player_id=$1',[session.player_id]);
   return {session:(await newSession(c,session.player_id)).response,recovery_code:recovery};
  });}catch(error){if((error as any).code==='23505')throw new DomainError('CONFLICT',409);throw error;}
 });
 app.post('/v1/sessions/login',limited,async request=>{
  requireBody('login_request',request.body);const b=request.body as any;
  const account=(await pool.query('SELECT * FROM players WHERE login=$1',[b.login.toLowerCase()])).rows[0];
  if(!await verifyPassword(b.password,account?.password_hash??null))throw unauthorized();
  return transaction(pool,async c=>{
   const current=(await c.query('SELECT * FROM players WHERE id=$1 FOR UPDATE',[account.id])).rows[0];
   if(current.password_hash!==account.password_hash)throw unauthorized();return (await newSession(c,account.id)).response;
  });
 });
 app.post('/v1/account/recover',limited,async request=>{
  requireBody('recover_request',request.body);const b=request.body as any;
  const account=(await pool.query('SELECT * FROM players WHERE login=$1',[b.login.toLowerCase()])).rows[0];
  if(!account||!same(account.recovery_hash,digest(b.recovery_code)))throw unauthorized();
  const password=await hashPassword(b.new_password),recovery=randomToken();
  return transaction(pool,async c=>{
   const current=(await c.query('SELECT * FROM players WHERE id=$1 FOR UPDATE',[account.id])).rows[0];
   if(!same(current.recovery_hash,digest(b.recovery_code)))throw unauthorized();
   await c.query('UPDATE players SET password_hash=$2,recovery_hash=$3,bootstrap_disabled=true WHERE id=$1',[account.id,password,digest(recovery)]);
   await c.query('UPDATE sessions SET revoked_at=now() WHERE player_id=$1',[account.id]);
   return {session:(await newSession(c,account.id)).response,recovery_code:recovery};
  });
 });
 app.post('/v1/account/recovery/rotate',limited,async request=>{
  requireBody('rotate_recovery_request',request.body);const token=bearer(request),b=request.body as any;
  const session=await authorize(pool,token),account=(await pool.query('SELECT * FROM players WHERE id=$1',[session.player_id])).rows[0];
  if(!await verifyPassword(b.password,account.password_hash))throw unauthorized();
  const recovery=randomToken();
  await transaction(pool,async c=>{
   const locked=await lockAuthorized(c,token),current=(await c.query('SELECT password_hash FROM players WHERE id=$1',[locked.player_id])).rows[0];
   if(current.password_hash!==account.password_hash)throw unauthorized();
   await c.query('UPDATE players SET recovery_hash=$2 WHERE id=$1',[locked.player_id,digest(recovery)]);
  });return {recovery_code:recovery};
 });
}
