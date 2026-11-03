import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance} from 'fastify';
import {createHash} from 'node:crypto';
import {validate,negotiate,resourceRefs,registry} from '@ufagame/contracts';
import {DomainError} from './errors.ts';
import {authorize,bearer} from './auth.ts';
import {canonicalJson,entitySha256} from '../../../packages/content-validator/canonical.mjs';

type Querier=Pool|PoolClient;
export type Snapshot={content:any;resources:any[];blobs:{sha256:string;media_type:string;payload:Buffer}[];sha256:string;required_capabilities:string[]};

/** Builds the immutable snapshot of a saved draft: content + referenced resource descriptors and bytes. */
export async function buildSnapshot(db:Querier,content:any):Promise<{snapshot:Snapshot|null;problems:string[]}>{
 const problems:string[]=[];
 const checked=validate('content',content);
 if(!checked.ok)problems.push(checked.code==='INCOMPATIBLE_CLIENT'?'CAPABILITY_UNSUPPORTED':'CONTENT_INVALID');
 if(!negotiate(content?.required_capabilities??[]))problems.push('CAPABILITY_UNSUPPORTED');
 if(problems.length)return {snapshot:null,problems:[...new Set(problems)]};
 const refs=resourceRefs(content),ids=[...new Set(refs.map(r=>r.resource_id))];
 const rows=new Map((await db.query('SELECT id,descriptor,payload FROM owner_resources WHERE id = ANY($1::text[])',[ids])).rows.map(r=>[r.id,r]));
 for(const ref of refs){const row=rows.get(ref.resource_id);if(!row||row.descriptor.media_type!==ref.media_type)problems.push(`RESOURCE_REF_INVALID:${ref.resource_id}`);}
 if(problems.length)return {snapshot:null,problems:[...new Set(problems)]};
 const resources=ids.sort().map(id=>rows.get(id).descriptor);
 const blobs=ids.map(id=>{const r=rows.get(id);return {sha256:r.descriptor.sha256,media_type:r.descriptor.media_type,payload:r.payload};});
 for(const b of blobs)if(createHash('sha256').update(b.payload).digest('hex')!==b.sha256)problems.push('RESOURCE_HASH_MISMATCH');
 if(problems.length)return {snapshot:null,problems};
 const sha256=createHash('sha256').update(canonicalJson({content:{...content,content_version:null},resources})).digest('hex');
 return {snapshot:{content,resources,blobs,sha256,required_capabilities:[...content.required_capabilities].sort()},problems};
}

/** Entity-level difference between the published content and a candidate. */
export function contentDiff(before:any,after:any){
 const index=(c:any)=>new Map<string,any>((c?.entities??[]).map((e:any)=>[e.id,e]));
 const a=index(before),b=index(after);
 return {
  added:[...b.keys()].filter(id=>!a.has(id)).sort(),
  removed:[...a.keys()].filter(id=>!b.has(id)).sort(),
  changed:[...b.keys()].filter(id=>a.has(id)&&entitySha256(a.get(id))!==entitySha256(b.get(id))).sort(),
 };
}

export async function currentPointer(db:Querier,lock=false){
 return (await db.query(`SELECT p.revision AS pointer_revision,v.* FROM content_pointer p JOIN content_versions v ON v.id=p.version_id WHERE p.channel='test'${lock?' FOR UPDATE OF p':''}`)).rows[0]??null;
}

/** Player-facing content delivery: a whole compatible bundle, never a partial version. */
export async function registerContent(app:FastifyInstance,pool:Pool){
 app.get('/v1/content/current',async(request,reply)=>{
  await authorize(pool,bearer(request));
  const header=request.headers['x-ufa-capabilities'];
  if(typeof header!=='string'||header.length>2000||!/^[a-z][a-z0-9_.]{2,99}(,[a-z][a-z0-9_.]{2,99}){0,99}$/.test(header))throw new DomainError('INVALID_REQUEST');
  const supported=header.split(',');
  const row=await currentPointer(pool);
  if(!row)throw new DomainError('NOT_FOUND',404);
  const missing=row.required_capabilities.filter((c:string)=>!supported.includes(c));
  if(missing.length)throw new DomainError('INCOMPATIBLE_CLIENT',409,`INCOMPATIBLE_CLIENT:${missing.join(',')}`.slice(0,160));
  const etag=`"${row.sha256}"`;
  reply.header('ETag',etag).header('Cache-Control','private, no-cache');
  if(request.headers['if-none-match']===etag)return reply.code(304).send();
  return {api_version:1,content_version:row.content_version,sha256:row.sha256,pointer_revision:row.pointer_revision,content:row.content,resources:row.resources};
 });
 app.get('/v1/content/blobs/:sha256',async(request,reply)=>{
  await authorize(pool,bearer(request));
  const sha=(request.params as any).sha256;
  if(typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha))throw new DomainError('INVALID_REQUEST');
  const row=(await pool.query('SELECT media_type,payload FROM resource_blobs WHERE sha256=$1',[sha])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);
  return reply.header('Cache-Control','private, max-age=31536000, immutable').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").type(row.media_type).send(row.payload);
 });
}
export {registry};
