import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import pg from 'pg';
import {chromium} from 'playwright';
import {migrate} from '../../services/api/src/db.ts';
import {buildApp} from '../../services/api/src/app.ts';
import {createOwner} from '../../services/api/src/owner.ts';

test('mobile Studio browser uses real HTTPS API: save, reload, concurrent conflict and diff', {timeout:90000},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ufa-studio-browser-'));
 const schema='studio_'+randomUUID().replaceAll('-','');
 const control=new pg.Pool();let pool,api,front,browser;
 try{
  await control.query(`CREATE SCHEMA ${schema}`);pool=new pg.Pool({options:`-c search_path=${schema}`});await migrate(pool);
  const password=randomBytes(32).toString('base64url');await createOwner(pool,'studio_test',password);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key'),'-out',join(temp,'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  let upstream;
  front=https.createServer({key:await readFile(join(temp,'key')),cert:await readFile(join(temp,'cert'))},async(req,res)=>{
   if(req.url.startsWith('/game/server/')){
    const f=http.request({host:'127.0.0.1',port:upstream,path:req.url.slice('/game/server'.length),method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});f.on('error',()=>res.writeHead(502).end());req.pipe(f);return;
   }
   const relative=req.url.split('?')[0].slice('/game/studio/'.length)||'index.html';
   if(!req.url.startsWith('/game/studio/')||relative.includes('..')){res.writeHead(404).end();return;}
   try{const data=await readFile(resolve('apps/studio-web/dist',relative));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(relative)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>front.listen(0,'127.0.0.1',r));const origin=`https://127.0.0.1:${front.address().port}`;
  api=await buildApp(pool,{origin});await api.listen({host:'127.0.0.1',port:0});upstream=api.server.address().port;
  browser=await chromium.launch({executablePath:process.env.UFA_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
  // Only this isolated test certificate is self-signed; production code is unchanged.
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();await page.goto(origin+'/game/studio/');
  await page.getByLabel('Логин',{exact:true}).fill('studio_test');await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByRole('button',{name:'Создать',exact:true}).click();await page.getByLabel('Название',{exact:true}).fill('Мобильный черновик');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
  await page.reload();await page.getByRole('button',{name:/Мобильный черновик · версия/}).click();assert.equal(await page.getByLabel('Название',{exact:true}).inputValue(),'Мобильный черновик');
  const other=await context.newPage();await other.goto(origin+'/game/studio/');await other.getByRole('button',{name:/Мобильный черновик · версия/}).click();
  await page.getByLabel('Название',{exact:true}).fill('Версия первого редактора');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
  await other.getByLabel('Название',{exact:true}).fill('Локальная версия второго');await other.getByRole('button',{name:'Сохранить',exact:true}).click();await other.getByRole('heading',{name:'Конфликт версий',exact:true}).waitFor();
  await other.locator('.conflict').getByText('Версия первого редактора',{exact:true}).waitFor();
  assert.equal(await other.getByLabel('Название',{exact:true}).inputValue(),'Локальная версия второго');assert.equal(await other.getByRole('button',{name:'Сохранить',exact:true}).isDisabled(),true);
  assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await other.getByText('Сравнить с открытой версией',{exact:true}).click();await other.getByRole('heading',{name:'Было',exact:true}).waitFor();
 }finally{
  if(browser)await browser.close();if(front){front.closeAllConnections();await new Promise(r=>front.close(r));}if(api)await api.close();if(pool)await pool.end();await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await control.end();await rm(temp,{recursive:true,force:true});
 }
});
