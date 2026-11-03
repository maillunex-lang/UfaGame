import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {registry} from '@ufagame/contracts';
const pool=createPool();after(()=>pool.end());
const sha=b=>createHash('sha256').update(b).digest('hex');
const chunk=(n,d)=>{const t=Buffer.from(n),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(d.length);c.writeUInt32BE(crc32(Buffer.concat([t,d])));return Buffer.concat([l,t,d,c]);};
/** 64x64 RGBA PNG with random pixels (~16 KiB, several 4 KiB download chunks). */
function png(){const w=64,h=64,head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;const rows=[];for(let y=0;y<h;y++)rows.push(Buffer.from([0]),randomBytes(w*4));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);}
function wav(){const data=randomBytes(3200),fmt=Buffer.alloc(16);fmt.writeUInt16LE(1,0);fmt.writeUInt16LE(1,2);fmt.writeUInt32LE(8000,4);fmt.writeUInt32LE(16000,8);fmt.writeUInt16LE(2,12);fmt.writeUInt16LE(16,14);const c=(id,b)=>{const x=Buffer.alloc(8);x.write(id,0,'ascii');x.writeUInt32LE(b.length,4);return Buffer.concat([x,b]);};const body=Buffer.concat([Buffer.from('WAVE'),c('fmt ',fmt),c('data',data)]);const hd=Buffer.alloc(8);hd.write('RIFF',0,'ascii');hd.writeUInt32LE(body.length,4);return Buffer.concat([hd,body]);}
const descriptor=(id,bytes,media)=>media==='image/png'?{id,media_type:media,sha256:sha(bytes),size:bytes.length,width:64,height:64,license:{name:'test',attribution:''},scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:64,height:64,duration_ms:100}],loop:false}:{id,media_type:media,sha256:sha(bytes),size:bytes.length,duration_ms:200,sample_rate:8000,channels:1,bits_per_sample:16,license:{name:'test',attribution:''},loop:false};

/** Test fixture: publish a version directly (immutable rows + pointer), like the owner publish transaction. */
async function publish(resources,caps=['content.core.v1','content.resources.v1']){
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(783120)');
  for(const r of resources)await c.query('INSERT INTO resource_blobs(sha256,media_type,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[r.d.sha256,r.d.media_type,r.bytes]);
  const id=Number((await c.query("SELECT nextval(pg_get_serial_sequence('content_versions','id')) AS id")).rows[0].id),label='pub_'+String(id).padStart(6,'0');
  const content={schema_version:1,content_version:label,required_capabilities:caps,entities:[{id:'faction_one',kind:'faction',name:'Ф',data:{advantage_ids:[]}},{id:'ability_one',kind:'ability',name:'У',data:{effect:'damage',power:1,cooldown_ms:0,sound_resource_id:'sound_hit'}},{id:'hero_one',kind:'hero',name:'Г',data:{faction_id:'faction_one',ability_ids:['ability_one'],sprite_resource_id:'sprite_hero'}}]};
  await c.query('INSERT INTO content_versions(id,content_version,sha256,content,resources,required_capabilities,source_draft_id,source_draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[id,label,sha(label+randomUUID()),content,JSON.stringify(resources.map(r=>r.d)),caps,randomUUID()]);
  const cur=(await c.query("SELECT revision FROM content_pointer WHERE channel='test' FOR UPDATE")).rows[0];
  await c.query("INSERT INTO content_pointer(channel,version_id,revision) VALUES('test',$1,$2) ON CONFLICT (channel) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision",[id,(cur?.revision??0)+1]);
  await c.query('COMMIT');return label;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

test('real Godot content loader: restart reuse, resume, corruption, wrong hash, storage, compatibility',{timeout:120000},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ufagame-godot-content-'));let app,front;
 const faults={interrupt:new Set(),tamper:new Set()},ranges=new Map();
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'k'),'-out',join(temp,'c'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  app=await buildApp(pool);await app.listen({host:'127.0.0.1',port:0});const upstream=app.server.address().port;
  const sound=wav(),soundD=descriptor('sound_hit',sound,'audio/wav');
  const version=async()=>{const bytes=png(),d=descriptor('sprite_hero',bytes,'image/png');return {version:await publish([{d,bytes},{d:soundD,bytes:sound}]),sprite:d.sha256,sound:soundD.sha256};};
  front=https.createServer({key:await readFile(join(temp,'k')),cert:await readFile(join(temp,'c'))},async(request,response)=>{
   const json=v=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(v));};
   if(request.url.startsWith('/__test/')){
    const [cmd,arg]=request.url.slice(8).split('/');
    if(cmd==='publish')return json(arg==='incompatible'?{version:await publish([],['content.core.v1','future.feature.v9'])}:await version());
    if(cmd==='interrupt'){faults.interrupt.add(arg);return json({});}
    if(cmd==='tamper'){faults.tamper.add(arg);return json({});}
    if(cmd==='ranges')return json({starts:ranges.get(arg)??[]});
    response.writeHead(404).end();return;
   }
   if(!request.url.startsWith('/game/server/')){response.writeHead(404).end();return;}
   const path=request.url.slice('/game/server'.length),blob=/^\/v1\/content\/blobs\/([a-f0-9]{64})$/.exec(path)?.[1];
   if(blob){const start=Number(/bytes=(\d+)-/.exec(request.headers.range??'')?.[1]??-1);ranges.set(blob,[...(ranges.get(blob)??[]),start]);
    // Fault: deliver the first chunk, then cut the connection on the next one.
    if(faults.interrupt.has(blob)&&start>0){faults.interrupt.delete(blob);request.socket.destroy();return;}}
   const forward=http.request({host:'127.0.0.1',port:upstream,path,method:request.method,headers:request.headers},async result=>{
    const parts=[];for await(const c of result)parts.push(c);let bytes=Buffer.concat(parts);
    // Fault: corrupt one byte of a single chunk; the final SHA-256 check must catch it.
    if(blob&&faults.tamper.has(blob)&&result.statusCode===206){bytes=Buffer.from(bytes);bytes[0]^=0xff;faults.tamper.delete(blob);}
    response.writeHead(result.statusCode,result.headers);response.end(bytes);
   });forward.on('error',()=>response.writeHead(502).end());request.pipe(forward);
  });
  await new Promise(r=>front.listen(0,'127.0.0.1',r));const port=front.address().port;
  const result=await new Promise((resolvePromise,reject)=>{
   const child=spawn('godot',['--headless','--path','apps/game','--script',resolve('tests/integration/godot-content-driver.gd')],{env:{...process.env,UFA_AUTH_TEST_CA:join(temp,'c'),UFA_AUTH_TEST_URL:`https://127.0.0.1:${port}/game/server`,UFA_AUTH_TEST_ORIGIN:`https://127.0.0.1:${port}`}});
   let output='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Godot content timeout\n'+output));},110000);
   child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);resolvePromise({code,output});});
  });
  assert.equal(result.code,0,result.output);assert.match(result.output,/GODOT_CONTENT_OK failures=0/);if(process.env.UFA_VERBOSE)console.log(result.output.split("\n").filter(l=>l.includes("GODOT_CONTENT")).join("\n"));
  assert.ok(registry.capabilities.includes('content.resources.v1'));
 }finally{
  if(front){front.closeAllConnections();await new Promise(r=>front.close(r));}if(app)await app.close();await rm(temp,{recursive:true,force:true});
 }
});
