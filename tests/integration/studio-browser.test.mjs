import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import {crc32,deflateSync} from 'node:zlib';
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
  const pngChunk=(name,data)=>{const tag=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);};
  const pngHeader=Buffer.alloc(13);pngHeader.writeUInt32BE(1);pngHeader.writeUInt32BE(1,4);pngHeader[8]=8;pngHeader[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',pngHeader),pngChunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255]))),pngChunk('IEND',Buffer.alloc(0))]);
  await page.getByLabel('ID ресурса').fill('icon_one');await page.getByLabel('Лицензия').fill('Собственная работа');
  await page.getByLabel('PNG файл').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:'Добавить изображение'}).click();await page.getByRole('status').filter({hasText:'Ресурс добавлен'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('img[alt="Ресурс icon_one"]')?.naturalWidth===1);
  await page.getByRole('button',{name:'Настроить кадры'}).click();await page.getByLabel('Длительность кадра, мс').fill('250');await page.getByLabel('Зациклить').check();
  await page.getByRole('button',{name:'Сохранить кадры'}).click();await page.getByRole('button',{name:'Настроить кадры'}).waitFor();
  const storedResource=(await pool.query('SELECT descriptor,revision FROM owner_resources WHERE id=$1',['icon_one'])).rows[0];assert.equal(storedResource.revision,1);assert.equal(storedResource.descriptor.frames[0].duration_ms,250);assert.equal(storedResource.descriptor.loop,true);
  await page.getByRole('button',{name:'Создать',exact:true}).click();await page.getByLabel('Название',{exact:true}).fill('Мобильный черновик');
  await page.getByLabel('ID объекта').fill('ability_one');await page.getByLabel('Название объекта').fill('Удар');await page.getByRole('button',{name:'Добавить в черновик'}).click();
  await page.getByLabel('Тип объекта').selectOption('faction');await page.getByLabel('ID объекта').fill('faction_one');await page.getByLabel('Название объекта').fill('Фракция');await page.getByRole('button',{name:'Добавить в черновик'}).click();
  await page.getByLabel('Тип объекта').selectOption('hero');await page.getByLabel('ID объекта').fill('hero_one');await page.getByLabel('Название объекта').fill('Герой');await page.getByLabel('ID фракции').fill('faction_one');await page.getByLabel('ID способностей через запятую').fill('ability_one');await page.getByRole('button',{name:'Добавить в черновик'}).click();
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
  await page.reload();await page.getByRole('button',{name:/Мобильный черновик · версия/}).click();assert.equal(await page.getByLabel('Название',{exact:true}).inputValue(),'Мобильный черновик');
  await page.getByText('Герой / враг: Герой (hero_one)',{exact:false}).waitFor();
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
