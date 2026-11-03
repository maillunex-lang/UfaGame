import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {createPool} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
// Battles left running would tick inside later test files: finish them.
const pool=createPool();after(async()=>{await pool.query('UPDATE live_battles SET completed_at=clock_timestamp() WHERE completed_at IS NULL');await pool.end();});
const combat=(o={})=>({hp:400,attack:40,defense:0,speed:1000,range:1500,attack_interval_ms:500,energy_start:1000,energy_per_second:100,energy_per_attack:100,...o});
const content=()=>({schema_version:1,content_version:'live_fixture',required_capabilities:['content.core.v1','battle.combat.v1'],entities:[
 {id:'faction_one',kind:'faction',name:'Ф',data:{advantage_ids:[]}},
 {id:'ability_one',kind:'ability',name:'Удар',data:{effect:'damage',power:60,cooldown_ms:1000,energy_cost:500}},
 {id:'hero_one',kind:'hero',name:'Батыр',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat:combat({hp:5000})}},
 {id:'enemy_one',kind:'hero',name:'Волк',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat:combat({hp:2500,attack:15})}},
 {id:'stage_one',kind:'stage',name:'Опушка',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000}}]});
async function publish(){
 const c=content(),db=await pool.connect();try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(783120)');
  const id=Number((await db.query("SELECT nextval(pg_get_serial_sequence('content_versions','id')) AS id")).rows[0].id),label='pub_'+String(id).padStart(6,'0');
  await db.query('INSERT INTO content_versions(id,content_version,sha256,content,resources,required_capabilities,source_draft_id,source_draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[id,label,createHash('sha256').update(label+randomUUID()).digest('hex'),{...c,content_version:label},'[]',c.required_capabilities,randomUUID()]);
  const cur=(await db.query("SELECT revision FROM content_pointer WHERE channel='test' FOR UPDATE")).rows[0];
  await db.query("INSERT INTO content_pointer(channel,version_id,revision) VALUES('test',$1,$2) ON CONFLICT (channel) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision",[id,(cur?.revision??0)+1]);
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
test('real Godot live battle: stream, manual ability, auto, drop/reconnect, restart/resume, verified result',{timeout:150000},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ufagame-godot-live-'));let app,front;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'k'),'-out',join(temp,'c'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  await publish();
  app=await buildApp(pool);await app.listen({host:'127.0.0.1',port:0});const upstream=app.server.address().port;
  front=https.createServer({key:await readFile(join(temp,'k')),cert:await readFile(join(temp,'c'))},(request,response)=>{
   if(!request.url.startsWith('/game/server/')){response.writeHead(404).end();return;}
   const forward=http.request({host:'127.0.0.1',port:upstream,path:request.url.slice('/game/server'.length),method:request.method,headers:request.headers},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response);});
   forward.on('error',()=>response.writeHead(502).end());request.pipe(forward);
  });
  // WebSocket upgrade passthrough, like nginx with Upgrade/Connection headers.
  front.on('upgrade',(request,socket,head)=>{
   if(!request.url.startsWith('/game/server/')){socket.destroy();return;}
   const up=net.connect(upstream,'127.0.0.1',()=>{
    const lines=[`${request.method} ${request.url.slice('/game/server'.length)} HTTP/1.1`];
    for(let i=0;i<request.rawHeaders.length;i+=2)lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i+1]}`);
    up.write(lines.join('\r\n')+'\r\n\r\n');if(head?.length)up.write(head);socket.pipe(up).pipe(socket);
   });
   up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());
  });
  await new Promise(r=>front.listen(0,'127.0.0.1',r));const port=front.address().port;
  const result=await new Promise((resolvePromise,reject)=>{
   const child=spawn('godot',['--headless','--path','apps/game','--script',resolve('tests/integration/godot-live-driver.gd')],{env:{...process.env,UFA_AUTH_TEST_CA:join(temp,'c'),UFA_AUTH_TEST_URL:`https://127.0.0.1:${port}/game/server`,UFA_LIVE_DEBUG:process.env.UFA_LIVE_DEBUG??''}});
   let output='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Godot live timeout\n'+output));},140000);
   child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);resolvePromise({code,output});});
  });
  assert.equal(result.code,0,result.output);assert.match(result.output,/GODOT_LIVE_OK failures=0/);
  if(process.env.UFA_VERBOSE)console.log(result.output.split('\n').filter(l=>/GODOT_LIVE|FAIL/.test(l)).join('\n'));
 }finally{
  if(front){front.closeAllConnections();await new Promise(r=>front.close(r));}if(app)await app.close();await rm(temp,{recursive:true,force:true});
 }
});
