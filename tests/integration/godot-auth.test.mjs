import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {applyDelta} from '../../services/api/src/economy.ts';
const pool=createPool();after(()=>pool.end());
test('real Godot auth client: trusted HTTPS/path, restart/refresh/bind/login/recover', {timeout:90000},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ufagame-godot-tls-'));
 let app,front;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'server.key'),'-out',join(temp,'server.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  app=await buildApp(pool);await app.listen({host:'127.0.0.1',port:0});const upstream=app.server.address().port;
  let seeded=false,expired=false;
  front=https.createServer({key:await readFile(join(temp,'server.key')),cert:await readFile(join(temp,'server.crt'))},(request,response)=>{
   if(!request.url.startsWith('/game/server/')){response.writeHead(404).end();return;}
   const path=request.url.slice('/game/server'.length);
   const forward=http.request({host:'127.0.0.1',port:upstream,path,method:request.method,headers:request.headers},async result=>{
    const chunks=[];for await(const chunk of result)chunks.push(chunk);const bytes=Buffer.concat(chunks);
    try{
     // Trusted test fixture; no public grant endpoint is added.
     if(path==='/v1/guests'&&result.statusCode===200&&!seeded){seeded=true;const id=JSON.parse(bytes).player_id;await applyDelta(pool,{playerId:id,currency:'gold',delta:13,reason:'test_reward',sourceId:'tlsfixture',key:randomUUID()});}
     if(path==='/v1/progress'&&result.statusCode===200&&!expired){expired=true;const id=JSON.parse(bytes).player_id;await pool.query("UPDATE sessions SET access_expires_at=now()-interval '1 second' WHERE player_id=$1",[id]);}
     response.writeHead(result.statusCode,result.headers);response.end(bytes);
    }catch{response.writeHead(500).end();}
   });forward.on('error',()=>response.writeHead(502).end());request.pipe(forward);
  });
  await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const port=front.address().port;
  const result=await new Promise((resolvePromise,reject)=>{
   const child=spawn('godot',['--headless','--path','apps/game','--script',resolve('tests/integration/godot-auth-driver.gd')],{env:{...process.env,UFA_AUTH_TEST_CA:join(temp,'server.crt'),UFA_AUTH_TEST_URL:`https://127.0.0.1:${port}/game/server`,UFA_AUTH_TEST_LOGIN:'u'+randomUUID().replaceAll('-','').slice(0,25)}});
   let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Godot auth smoke timeout'));},75000);
   child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);resolvePromise({code,output});});
  });
  assert.equal(result.code,0,result.output);assert.match(result.output,/GODOT_AUTH_TLS_OK failures=0/);
 }finally{
  if(front){front.closeAllConnections();await new Promise(r=>front.close(r));}if(app)await app.close();await rm(temp,{recursive:true,force:true});
 }
});
