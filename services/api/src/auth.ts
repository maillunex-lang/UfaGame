import {createHash,randomUUID,randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {validate} from '@ufagame/contracts';
import {transaction} from './db.ts';
import {DomainError} from './errors.ts';
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const derive=(domain:string,value:string)=>createHash('sha256').update(`ufagame/${domain}/v1:${value}`).digest('base64url');
export const randomToken=()=>randomBytes(32).toString('base64url');
export function requireBody(name:string,body:any){if(!validate(name,body).ok)throw new DomainError('INVALID_REQUEST');}
export function bearer(request:FastifyRequest){
 const value=request.headers.authorization??'';const match=/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(value);
 if(!match)throw new DomainError('UNAUTHORIZED',401);return match[1];
}
export function sessionResponse(row:any,pair:{access:string;refresh:string}) {
 return {api_version:1,player_id:row.player_id,access_token:pair.access,refresh_token:pair.refresh,access_expires_at:row.access_expires_at.toISOString(),refresh_expires_at:row.refresh_expires_at.toISOString()};
}
export async function newSession(client:PoolClient,playerId:string,pair={access:randomToken(),refresh:randomToken()}){
 const row=(await client.query("INSERT INTO sessions(id,player_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days') RETURNING *",[randomUUID(),playerId,digest(pair.access),digest(pair.refresh)])).rows[0];
 return {row,response:sessionResponse(row,pair)};
}
export async function authorize(pool:Pool,token:string){
 const row=(await pool.query('SELECT s.id,s.player_id,p.account_type FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>now() AND s.refresh_expires_at>now()',[digest(token)])).rows[0];
 if(!row)throw new DomainError('UNAUTHORIZED',401);return row;
}
export async function lockAuthorized(client:PoolClient,token:string){
 const found=(await client.query('SELECT player_id FROM sessions WHERE access_hash=$1',[digest(token)])).rows[0];
 if(!found)throw new DomainError('UNAUTHORIZED',401);
 await client.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[found.player_id]);
 const row=(await client.query('SELECT * FROM sessions WHERE access_hash=$1 AND revoked_at IS NULL AND access_expires_at>now() AND refresh_expires_at>now() FOR UPDATE',[digest(token)])).rows[0];
 if(!row)throw new DomainError('UNAUTHORIZED',401);return row;
}
export async function guest(pool:Pool,secret:string){
 const hash=digest(secret),pair={access:derive('initial-access',secret),refresh:derive('initial-refresh',secret)};
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[hash]);
  const old=(await c.query('SELECT * FROM players WHERE bootstrap_hash=$1 FOR UPDATE',[hash])).rows[0];
  if(old){
   const session=(await c.query('SELECT * FROM sessions WHERE id=$1 AND revoked_at IS NULL AND refresh_expires_at>now() AND access_hash=$2 AND refresh_hash=$3',[old.initial_session_id,digest(pair.access),digest(pair.refresh)])).rows[0];
   if(old.bootstrap_disabled||!session)throw new DomainError('UNAUTHORIZED',401);
   return sessionResponse(session,pair);
  }
  const id=randomUUID();await c.query('INSERT INTO players(id,bootstrap_hash) VALUES($1,$2)',[id,hash]);
  const created=await newSession(c,id,pair);await c.query('UPDATE players SET initial_session_id=$2 WHERE id=$1',[id,created.row.id]);return created.response;
 });
}
export async function refresh(pool:Pool,token:string,requestId:string){
 const hash=digest(token),pair={access:derive('refresh-access',token+':'+requestId),refresh:derive('refresh-token',token+':'+requestId)};
 return transaction(pool,async c=>{
  const found=(await c.query('SELECT player_id FROM sessions WHERE refresh_hash=$1 OR(previous_refresh_hash=$1 AND previous_request_id=$2)',[hash,requestId])).rows[0];
  if(!found)throw new DomainError('UNAUTHORIZED',401);
  await c.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[found.player_id]);
  const row=(await c.query('SELECT * FROM sessions WHERE player_id=$3 AND (refresh_hash=$1 OR(previous_refresh_hash=$1 AND previous_request_id=$2)) AND revoked_at IS NULL AND refresh_expires_at>now() FOR UPDATE',[hash,requestId,found.player_id])).rows[0];
  if(!row)throw new DomainError('UNAUTHORIZED',401);
  if(row.refresh_hash!==hash){
   const valid=(await c.query('SELECT 1 FROM sessions WHERE id=$1 AND retry_until>now()',[row.id])).rowCount;
   if(!valid||row.access_hash!==digest(pair.access)||row.refresh_hash!==digest(pair.refresh))throw new DomainError('UNAUTHORIZED',401);
   return sessionResponse(row,pair);
  }
  const changed=(await c.query("UPDATE sessions SET previous_refresh_hash=refresh_hash,previous_request_id=$4,retry_until=now()+interval '30 seconds',access_hash=$2,refresh_hash=$3,access_expires_at=LEAST(now()+interval '15 minutes',refresh_expires_at) WHERE id=$1 RETURNING *",[row.id,digest(pair.access),digest(pair.refresh),requestId])).rows[0];
  return sessionResponse(changed,pair);
 });
}
export async function registerAuth(app:FastifyInstance,pool:Pool){
 const limited={config:{rateLimit:{max:10,timeWindow:60000}}};
 app.post('/v1/guests',limited,async request=>{requireBody('guest_request',request.body);return guest(pool,(request.body as any).installation_secret);});
 app.post('/v1/sessions/refresh',limited,async request=>{requireBody('refresh_request',request.body);const b=request.body as any;return refresh(pool,b.refresh_token,b.request_id);});
 app.post('/v1/sessions/revoke',limited,async request=>{
  requireBody('revoke_request',request.body);const token=bearer(request);
  await transaction(pool,async c=>{const s=await lockAuthorized(c,token);
   if((request.body as any).all_sessions){await c.query('UPDATE sessions SET revoked_at=now() WHERE player_id=$1',[s.player_id]);await c.query('UPDATE players SET bootstrap_disabled=true WHERE id=$1',[s.player_id]);}
   else await c.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[s.id]);
  });return {ok:true};
 });
 app.get('/v1/progress',async request=>{
  if(Object.keys(request.query as object).length)throw new DomainError('INVALID_REQUEST');
  const s=await authorize(pool,bearer(request));const rows=(await pool.query('SELECT currency,amount FROM balances WHERE player_id=$1 ORDER BY currency',[s.player_id])).rows;
  return {api_version:1,player_id:s.player_id,account_type:s.account_type,balances:rows.map(row=>({currency:row.currency,amount:Number(row.amount)}))};
 });
}
