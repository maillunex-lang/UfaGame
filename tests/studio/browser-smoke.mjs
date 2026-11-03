import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {crc32,deflateSync} from 'node:zlib';
import {chromium} from 'playwright';
import {compileContentBattle,runAutoBattle,BattleCompileError} from '../../packages/battle-core/compile.mjs';
let draft=null,logged=false,resources=[],pngBytes=null,previews=0;
const chunk=(name,data)=>{const tag=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);};
const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255,4,5,6,255]))),chunk('IEND',Buffer.alloc(0))]);
const browser=await chromium.launch({executablePath:process.env.UFA_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('https://studio.test/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path.startsWith('/game/server/')){
   const method=req.method();let body={},status=200;
   if(path.endsWith('/session')){status=401;body={};}
   else if(path.endsWith('/sessions')&&method==='POST'){logged=true;body={owner:{display_name:'owner'},csrf_token:'fake'};}
   else if(path.endsWith('/resources')&&method==='GET'){body={resources};}
   else if(path.endsWith('/resources')&&method==='POST'){const v=req.postDataJSON();pngBytes=Buffer.from(v.data_base64,'base64');assert.deepEqual(pngBytes,png);body={id:v.id,media_type:'image/png',width:2,height:1,sha256:'fake',license:v.license,revision:0,scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:2,height:1,duration_ms:100}],loop:false};resources.push(body);}
   else if(path.endsWith('/resources/icon_one/data')&&method==='GET')return route.fulfill({status:200,contentType:'image/png',body:pngBytes});
   else if(path.endsWith('/resources/icon_one')&&method==='PATCH'){const v=req.postDataJSON();if(v.expected_revision!==resources[0].revision){status=409;body={error:{code:'CONFLICT'}};}else{resources[0]={...resources[0],...v,revision:resources[0].revision+1};body=resources[0];}}
   else if(path.endsWith('/drafts')&&method==='GET'){body={drafts:draft?[{id:draft.id,name:draft.name,revision:draft.revision}]:[]};}
   else if(path.endsWith('/drafts')&&method==='POST'){const v=req.postDataJSON();draft={id:v.id,name:v.name,content:v.content,revision:0};body=draft;}
   else if(path.endsWith('/battle-preview')&&method==='POST'){const v=req.postDataJSON();previews++;
    if(v.expected_revision!==draft.revision){status=409;body={error:{code:'CONFLICT',message:'CONFLICT'}};}
    else try{const c=compileContentBattle(draft.content,v);body={api_version:1,preview:true,draft_id:draft.id,draft_revision:draft.revision,...runAutoBattle(c.setup,{heroes:c.heroes})};}
    catch(e){if(!(e instanceof BattleCompileError))throw e;status=422;body={error:{code:'INVALID_REQUEST',message:e.entity_id?`${e.code}:${e.entity_id}`:e.code}};}}
   else if(path.includes('/drafts/')&&method==='GET'){body=draft;}
   else if(path.includes('/drafts/')&&method==='PUT'){const v=req.postDataJSON();draft={...draft,name:v.name,content:v.content,revision:draft.revision+1};body=draft;}
   else{status=404;body={};}
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  }
  const relative=path.slice('/game/studio/'.length)||'index.html';
  const file=resolve('apps/studio-web/dist',relative);
  try{return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)],body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();await page.goto('https://studio.test/game/studio/');
 await page.getByLabel('Логин',{exact:true}).fill('owner');await page.getByLabel('Пароль',{exact:true}).fill('demo-password');await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.getByLabel('ID ресурса').fill('icon_one');await page.getByLabel('Лицензия').fill('Собственная работа');
 await page.getByLabel('PNG файл').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Добавить изображение'}).click();
 await page.getByRole('status').filter({hasText:'Ресурс добавлен'}).waitFor();await page.waitForFunction(()=>document.querySelector('img[alt="Ресурс icon_one"]')?.naturalWidth===2);
 await page.getByRole('button',{name:'Настроить кадры'}).click();await page.getByLabel('Столбцы').fill('2');await page.getByLabel('Длительность кадра, мс').fill('250');await page.getByLabel('Зациклить').check();
 await page.getByRole('button',{name:'Сохранить кадры'}).click();await page.getByRole('button',{name:'Настроить кадры'}).waitFor();assert.equal(resources[0].frames.length,2);assert.equal(resources[0].frames[0].duration_ms,250);assert.equal(resources[0].loop,true);
 await page.waitForFunction(()=>document.querySelector('img[alt="Ресурс icon_one"]')?.style.left==='-6px');
 await page.getByRole('button',{name:'Настроить кадры'}).click();await page.getByLabel('Длительность кадра, мс').fill('300');resources[0].revision++;
 await page.getByRole('button',{name:'Сохранить кадры'}).click();await page.getByRole('alert').filter({hasText:'Ресурс изменился'}).waitFor();assert.equal(await page.getByLabel('Длительность кадра, мс').inputValue(),'300');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Обновить список ресурсов'}).click();
 await page.getByRole('status').filter({hasText:'Список ресурсов обновлён'}).waitFor();
 await page.getByRole('button',{name:'Создать',exact:true}).click();
 await page.getByLabel('ID объекта').fill('ability_one');await page.getByLabel('Название объекта').fill('Удар');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByLabel('Тип объекта').selectOption('faction');await page.getByLabel('ID объекта').fill('faction_one');await page.getByLabel('Название объекта').fill('Фракция');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByLabel('Тип объекта').selectOption('hero');await page.getByLabel('ID объекта').fill('hero_one');await page.getByLabel('Название объекта').fill('Герой');await page.getByLabel('ID фракции').fill('faction_one');await page.getByLabel('ID способностей через запятую').fill('ability_one');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
 assert.equal(logged,true);assert.equal(draft.content.entities.length,3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByLabel('ID объекта').fill('unfinished');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Сначала примени или очисти'}).waitFor();assert.equal(draft.revision,1);
 await page.getByRole('button',{name:'Очистить форму'}).click();
 page.once('dialog',dialog=>dialog.accept());await page.locator('li').filter({hasText:'ability_one'}).getByRole('button',{name:'Удалить'}).click();
 await page.getByRole('alert').filter({hasText:'Сначала убери ссылку'}).waitFor();assert.equal(draft.content.entities.length,3);
 await page.locator('li').filter({hasText:'hero_one'}).getByRole('button',{name:'Изменить'}).click();
 await page.getByLabel('Боевые параметры (нужны для проверки боя)').check();await page.getByLabel('Здоровье').fill('400');await page.getByRole('button',{name:'Применить изменения'}).click();
 await page.getByLabel('Тип объекта').selectOption('hero');await page.getByLabel('ID объекта').fill('enemy_wolf');await page.getByLabel('Название объекта').fill('Волк');await page.getByLabel('ID фракции').fill('faction_one');await page.getByLabel('ID способностей через запятую').fill('ability_one');
 await page.getByLabel('Боевые параметры (нужны для проверки боя)').check();await page.getByLabel('Интервал атаки, мс').fill('150');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByRole('alert').filter({hasText:'кратное 100'}).waitFor();await page.getByLabel('Интервал атаки, мс').fill('700');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByPlaceholder('hero_batyr, hero_healer').fill('hero_one');await page.getByPlaceholder('enemy_wolf').fill('enemy_wolf');
 await page.getByRole('button',{name:'Проверить бой'}).click();await page.getByRole('alert').filter({hasText:'Сначала сохрани черновик'}).waitFor();assert.equal(previews,0,'unsaved draft is not sent');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
 assert.ok(draft.content.required_capabilities.includes('battle.combat.v1'));assert.equal(draft.content.entities.find(e=>e.id==='hero_one').data.combat.hp,400);
 await page.getByPlaceholder('hero_batyr, hero_healer').fill('ability_one');await page.getByRole('button',{name:'Проверить бой'}).click();
 await page.getByRole('alert').filter({hasText:'герой не найден (ability_one)'}).waitFor();
 await page.getByPlaceholder('hero_batyr, hero_healer').fill('hero_one');await page.getByRole('button',{name:'Проверить бой'}).click();
 await page.getByRole('status').filter({hasText:'атакующих'}).waitFor();assert.equal(previews,2);
 await page.locator('svg.battle-field circle').first().waitFor();assert.equal(await page.locator('svg.battle-field circle').count(),2);
 const slider=page.getByLabel('Время');const last=await slider.getAttribute('max');await slider.fill(last);
 await page.getByRole('button',{name:'Воспроизвести'}).click();await page.waitForFunction(()=>document.querySelector('input[type=range]')?.value!==document.querySelector('input[type=range]')?.max);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'battle preview has no horizontal overflow');
 await page.screenshot({path:process.env.UFA_SCREENSHOT||'/tmp/studio-battle-preview.png',fullPage:false});
 console.log('Chromium mobile: create ability/faction/hero, save, reject referenced deletion, no overflow — passed (mock API)');
 console.log('Chromium mobile: hero combat form, unsaved/invalid preview rejected, server-core preview replay — passed (mock API with real battle-core)');
}finally{await browser.close();}
