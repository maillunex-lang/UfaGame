import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import {registerOwner} from './owner.ts';
import type {OwnerOptions} from './owner.ts';
import type {Pool} from 'pg';
import {registry} from '@ufagame/contracts';
import {DomainError} from './errors.ts';
import {registerAuth} from './auth.ts';
import {registerAccounts} from './accounts.ts';
export async function buildApp(pool:Pool,ownerOptions:OwnerOptions={origin:process.env.ADMIN_ORIGIN,cookiePath:process.env.ADMIN_COOKIE_PATH}) {
 const app=Fastify({logger:false,bodyLimit:16384,trustProxy:false,requestTimeout:10000});
 await app.register(cookie);
 await app.register(rateLimit,{max:120,timeWindow:60000,errorResponseBuilder:()=>({statusCode:429,code:'RATE_LIMITED',message:'RATE_LIMITED'})});
 app.setErrorHandler((error,request,reply)=>{
  const e=error as any;const status=e instanceof DomainError?e.status:(Number.isInteger(e.statusCode)&&e.statusCode>=400&&e.statusCode<500?e.statusCode:500);
  const code=e instanceof DomainError?e.code:(status===429?'RATE_LIMITED':status<500?'INVALID_REQUEST':'INTERNAL_ERROR');
  return reply.code(status).send({error:{code,message:code,request_id:request.id}});
 });
 app.get('/health/live',async()=>({status:'ok'}));
 app.get('/health/ready',async(_request,reply)=>{
  try{const ready=await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',['005-owner-audit.sql']);if(!ready.rowCount)throw new Error('Schema not ready');return {status:'ok'};}catch{return reply.code(503).send({error:{code:'SERVICE_UNAVAILABLE',message:'SERVICE_UNAVAILABLE',request_id:_request.id}});}
 });
 app.get('/v1/capabilities',async()=>registry);
 app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'NOT_FOUND',request_id:request.id}}));
 await registerAuth(app,pool);
 await registerAccounts(app,pool);
 await registerOwner(app,pool,ownerOptions);
 return app;
}
