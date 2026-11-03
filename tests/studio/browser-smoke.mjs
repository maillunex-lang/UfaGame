import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {crc32,deflateSync} from 'node:zlib';
import {chromium} from 'playwright';
import {compileContentBattle,runAutoBattle,BattleCompileError} from '../../packages/battle-core/compile.mjs';
import {createHash} from 'node:crypto';
import {inspectArchive,PackageError} from '../../packages/content-validator/archive.mjs';
import {planImport} from '../../packages/content-validator/plan-import.mjs';
import {exportContent} from '../../packages/content-validator/export.mjs';
/** Saves now unless autosave already did; waits for the saved status. */
const saveNow=async p=>{const b=p.getByRole('button',{name:'Сохранить черновик'});if(await b.isEnabled())await b.click().catch(()=>{});await p.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();};
const openId=async p=>{await p.locator('details:has(> summary:has-text("Дополнительно: ID"))').evaluate(d=>{d.open=true;});};
const addEntity=async(p,{kind,id,name,faction,abilities=[]})=>{
 await p.getByLabel('Тип объекта').selectOption(kind);await p.getByLabel('Название объекта').fill(name);await openId(p);await p.getByLabel('ID объекта').fill(id);
 if(kind==='hero'){await p.getByRole('combobox',{name:/^Фракция/}).selectOption(faction);for(const a of abilities)await p.getByRole('group',{name:/Способности/}).getByLabel(a).check();}
 await p.getByRole('button',{name:'Добавить в черновик'}).click();
};

let published=[],exported=null,imports=0,draft=null,logged=false,resources=[],pngBytes=null,previews=0,wavBytes=null;
const wavFile=(()=>{const data=Buffer.alloc(1600),fmt=Buffer.alloc(16);fmt.writeUInt16LE(1,0);fmt.writeUInt16LE(1,2);fmt.writeUInt32LE(8000,4);fmt.writeUInt32LE(16000,8);fmt.writeUInt16LE(2,12);fmt.writeUInt16LE(16,14);const c=(id,b)=>{const x=Buffer.alloc(8);x.write(id,0,'ascii');x.writeUInt32LE(b.length,4);return Buffer.concat([x,b]);};const body=Buffer.concat([Buffer.from('WAVE'),c('fmt ',fmt),c('data',data)]);const head=Buffer.alloc(8);head.write('RIFF',0,'ascii');head.writeUInt32LE(body.length,4);return Buffer.concat([head,body]);})();
const chunk=(name,data)=>{const tag=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);};
const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255,4,5,6,255]))),chunk('IEND',Buffer.alloc(0))]);
const browser=await chromium.launch({executablePath:process.env.UFA_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 await context.route('https://studio.test/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path.startsWith('/game/server/')){
   const method=req.method();let body={},status=200;
   if(path.endsWith('/session')){status=401;body={};}
   else if(path.endsWith('/sessions')&&method==='POST'){logged=true;body={owner:{display_name:'owner'},csrf_token:'fake'};}
   else if(path.endsWith('/resources')&&method==='GET'){body={resources};}
   else if(path.endsWith('/resources')&&method==='POST'&&Buffer.from(req.postDataJSON().data_base64,'base64').toString('ascii',0,4)==='RIFF'){const v=req.postDataJSON();wavBytes=Buffer.from(v.data_base64,'base64');body={id:v.id,media_type:'audio/wav',sha256:'fake',size:wavBytes.length,duration_ms:100,sample_rate:8000,channels:1,bits_per_sample:16,license:v.license,loop:false,revision:0};resources.push(body);}
   else if(path.endsWith('/resources/sound_one/data')&&method==='GET')return route.fulfill({status:200,contentType:'audio/wav',body:wavBytes});
   else if(path.endsWith('/resources')&&method==='POST'){const v=req.postDataJSON();pngBytes=Buffer.from(v.data_base64,'base64');assert.deepEqual(pngBytes,png);body={id:v.id,media_type:'image/png',width:2,height:1,sha256:'fake',license:v.license,revision:0,scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:2,height:1,duration_ms:100}],loop:false};resources.push(body);}
   else if(path.endsWith('/resources/icon_one/data')&&method==='GET')return route.fulfill({status:200,contentType:'image/png',body:pngBytes});
   else if(path.endsWith('/resources/icon_one')&&method==='PATCH'){const v=req.postDataJSON();if(v.expected_revision!==resources[0].revision){status=409;body={error:{code:'CONFLICT'}};}else{resources[0]={...resources[0],...v,revision:resources[0].revision+1};body=resources[0];}}
   else if(path.endsWith('/drafts')&&method==='GET'){body={drafts:draft?[{id:draft.id,name:draft.name,revision:draft.revision}]:[]};}
   else if(path.endsWith('/drafts')&&method==='POST'){const v=req.postDataJSON();draft={id:v.id,name:v.name,content:v.content,revision:0};body=draft;}
   else if(path.endsWith('/export')&&method==='GET'){
    const ids=url.searchParams.get('ids');const bytes={icon_one:pngBytes,sound_one:wavBytes};
    const map=new Map(resources.map(r=>[r.id,{descriptor:{...r,sha256:createHash('sha256').update(bytes[r.id]).digest('hex')},bytes:bytes[r.id]}]));
    let zip;try{zip=await exportContent(draft.content,{ids:ids?ids.split(','):null,resources:map});}catch(e){console.error('export mock failed',e);throw e;}exported=zip;
    return route.fulfill({status:200,contentType:'application/zip',headers:{'Content-Disposition':'attachment; filename="ufagame-draft.zip"'},body:zip});}
   else if(path.endsWith('/import/preflight')||path.endsWith('/import/apply')){
    const v=req.postDataJSON(),bytes={icon_one:pngBytes,sound_one:wavBytes};
    const existing=new Map(resources.map(r=>[r.id,{sha256:createHash('sha256').update(bytes[r.id]).digest('hex'),media_type:r.media_type}]));
    if(v.expected_revision!==draft.revision){status=409;body={error:{code:'CONFLICT',message:'CONFLICT'}};}
    else try{const plan=await planImport(await inspectArchive(Buffer.from(v.zip_base64,'base64')),draft,{expectedRevision:v.expected_revision,existingResources:existing,resolutions:v.resolutions??{}});
     if(path.endsWith('/preflight'))body={draft_id:draft.id,draft_revision:draft.revision,package_sha256:'x',ready:plan.content!==null,report:plan.report};
     else if(!plan.content){status=409;body={error:{code:'CONFLICT',message:'IMPORT_CONFLICTS_UNRESOLVED'}};}
     else{imports++;draft={...draft,content:plan.content,revision:draft.revision+1};body={draft,package_sha256:'x',report:plan.report,created_resources:[]};}}
    catch(e){if(!(e instanceof PackageError))throw e;status=422;body={error:{code:'INVALID_REQUEST',message:[e.code,e.file,e.field].filter(Boolean).join(':')}};}}
   else if(path.endsWith('/content/releases')&&method==='GET'){body={pointer:published.length?{content_version:published.at(-1).content_version,pointer_revision:published.length}:null,versions:[...published].reverse(),releases:[]};}
   else if(path.endsWith('/publish/preflight')){const v=req.postDataJSON();const cur=published.at(-1);const same=cur&&JSON.stringify(cur.content.entities)===JSON.stringify(draft.content.entities);
    body={ready:!same,unchanged:!!same,problems:[],warnings:draft.content.entities.filter(e=>e.kind==='hero'&&!e.data.combat).map(e=>'HERO_WITHOUT_COMBAT:'+e.id),diff:{added:draft.content.entities.filter(e=>!cur?.content.entities.some(x=>x.id===e.id)).map(e=>e.id),changed:[],removed:[]},pointer_revision:published.length,resource_count:0,current:null};if(v.expected_revision!==draft.revision){status=409;body={error:{code:'CONFLICT',message:'CONFLICT'}};}}
   else if(path.endsWith('/publish')&&method==='POST'){const v=req.postDataJSON();if(v.expected_pointer_revision!==published.length){status=409;body={error:{code:'CONFLICT',message:'POINTER_CHANGED'}};}else{const label='pub_'+String(published.length+1).padStart(6,'0');published.push({content_version:label,sha256:'x',created_at:new Date().toISOString(),source_draft_revision:draft.revision,entity_count:draft.content.entities.length,content:structuredClone(draft.content)});body={content_version:label,pointer_revision:published.length};}}
   else if(path.endsWith('/battle-preview')&&method==='POST'){const v=req.postDataJSON();previews++;
    if(v.expected_revision!==draft.revision){status=409;body={error:{code:'CONFLICT',message:'CONFLICT'}};}
    else try{const c=compileContentBattle(draft.content,v);body={api_version:1,preview:true,draft_id:draft.id,draft_revision:draft.revision,...runAutoBattle(c.setup,{heroes:c.heroes})};}
    catch(e){if(!(e instanceof BattleCompileError))throw e;status=422;body={error:{code:'INVALID_REQUEST',message:e.entity_id?`${e.code}:${e.entity_id}`:e.code}};}}
   else if(path.includes('/drafts/')&&method==='GET'){body=draft;}
   else if(path.includes('/drafts/')&&method==='PUT'&&req.postDataJSON().content.entities.some(e=>e.data?.sprite_resource_id&&!resources.some(r=>r.id===e.data.sprite_resource_id))){status=422;body={error:{code:'INVALID_REQUEST',message:'RESOURCE_REF_INVALID:'+req.postDataJSON().content.entities.find(e=>e.data?.sprite_resource_id&&!resources.some(r=>r.id===e.data.sprite_resource_id)).data.sprite_resource_id}};}
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
 await page.getByLabel('ID ресурса').fill('5555');await page.getByLabel('Лицензия').fill('Я');await page.getByLabel('Файл PNG или WAV').setInputFiles({name:'1000153986.png',mimeType:'image/png',buffer:png});
 await page.getByRole('button',{name:'Добавить ресурс'}).click();await page.getByRole('status').filter({hasText:'Неверный ID ресурса'}).waitFor();assert.equal(resources.length,0,'invalid id is not sent');
 await page.getByLabel('ID ресурса').fill('icon_one');await page.getByLabel('Лицензия').fill('Собственная работа');
 await page.getByLabel('Файл PNG или WAV').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Добавить ресурс'}).click();
 await page.getByRole('status').filter({hasText:'Ресурс добавлен'}).waitFor();await page.waitForFunction(()=>document.querySelector('img[alt="Ресурс icon_one"]')?.naturalWidth===2);
 await page.getByRole('button',{name:'Настроить кадры'}).click();await page.getByLabel('Столбцы').fill('2');await page.getByLabel('Длительность кадра, мс').fill('250');await page.getByLabel('Зациклить').check();
 await page.getByRole('button',{name:'Сохранить кадры'}).click();await page.getByRole('button',{name:'Настроить кадры'}).waitFor();assert.equal(resources[0].frames.length,2);assert.equal(resources[0].frames[0].duration_ms,250);assert.equal(resources[0].loop,true);
 await page.waitForFunction(()=>document.querySelector('img[alt="Ресурс icon_one"]')?.style.left==='-6px');
 await page.getByRole('button',{name:'Настроить кадры'}).click();await page.getByLabel('Длительность кадра, мс').fill('300');resources[0].revision++;
 await page.getByRole('button',{name:'Сохранить кадры'}).click();await page.getByRole('alert').filter({hasText:'Ресурс изменился'}).waitFor();assert.equal(await page.getByLabel('Длительность кадра, мс').inputValue(),'300');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Обновить список ресурсов'}).click();
 await page.getByRole('status').filter({hasText:'Список ресурсов обновлён'}).waitFor();
 await page.getByLabel('ID ресурса').fill('sound_one');await page.getByLabel('Лицензия').fill('Собственная работа');
 await page.getByLabel('Файл PNG или WAV').setInputFiles({name:'hit.wav',mimeType:'audio/wav',buffer:wavFile});await page.getByRole('button',{name:'Добавить ресурс'}).click();
 await page.getByRole('status').filter({hasText:'Ресурс добавлен'}).waitFor();await page.getByLabel('Звук sound_one').waitFor();assert.deepEqual(wavBytes,wavFile);
 await page.getByRole('button',{name:'Создать',exact:true}).click();
 await page.getByRole('heading',{name:'Быстрый старт'}).waitFor();await page.getByLabel('Картинка героя').first().locator('option',{hasText:'icon_one'}).waitFor({state:'attached'});
 await addEntity(page,{kind:'ability',id:'ability_one',name:'Удар'});
 await addEntity(page,{kind:'faction',id:'faction_one',name:'Фракция'});
 await addEntity(page,{kind:'hero',id:'hero_one',name:'Герой',faction:'faction_one',abilities:['Удар']});
 await saveNow(page);
 assert.equal(logged,true);assert.equal(draft.content.entities.length,3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByLabel('Название объекта').fill('unfinished');
 await page.locator('.save-bar').filter({hasText:'Сначала нажми «Добавить в черновик»'}).waitFor();assert.equal(await page.getByRole('button',{name:'Сохранить черновик'}).isDisabled(),true);assert.equal(draft.revision,1);
 await page.getByRole('button',{name:'Очистить форму'}).click();
 page.once('dialog',dialog=>dialog.accept());await page.locator('li').filter({hasText:'ability_one'}).getByRole('button',{name:'Удалить'}).click();
 await page.getByRole('alert').filter({hasText:'Сначала убери ссылку'}).waitFor();assert.equal(draft.content.entities.length,3);
 await page.locator('li').filter({hasText:'hero_one'}).getByRole('button',{name:'Изменить'}).click();
 await page.getByLabel('Картинка героя').selectOption('icon_one');await page.locator('span.thumb img').first().waitFor();await page.getByLabel('Боевые параметры (нужны для проверки боя)').check();await page.getByLabel('Здоровье').fill('400');await page.getByRole('button',{name:'Применить изменения'}).click();
 await page.getByLabel('Тип объекта').selectOption('hero');await page.getByLabel('Название объекта').fill('Волк');await openId(page);await page.getByLabel('ID объекта').fill('enemy_wolf');await page.getByRole('combobox',{name:/^Фракция/}).selectOption('faction_one');await page.getByRole('group',{name:/Способности/}).getByLabel('Удар').check();
 await page.getByLabel('Боевые параметры (нужны для проверки боя)').check();await page.getByLabel('Интервал атаки, мс').fill('150');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByRole('alert').filter({hasText:'кратное 100'}).waitFor();await page.getByLabel('Интервал атаки, мс').fill('700');await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByLabel('Тип объекта').selectOption('stage');await page.getByLabel('Название объекта').fill('Опушка');
 await page.getByRole('group',{name:/Противники \(до 5/}).getByLabel('Волк').check();await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.getByRole('heading',{name:'Этапы (бои для игры)'}).waitFor();
 await page.getByRole('button',{name:'Проверить бой'}).click();await page.getByRole('alert').filter({hasText:'Сначала сохрани черновик'}).waitFor();assert.equal(previews,0,'unsaved draft is not sent');
 // Autosave: no button press needed.
 await page.locator('.save-bar').filter({hasText:'Все изменения сохранены'}).waitFor({timeout:10000});await page.getByRole('status').filter({hasText:'сохранён автоматически'}).waitFor();
 assert.deepEqual(draft.content.entities.find(e=>e.kind==='stage').data,{enemy_hero_ids:['enemy_wolf'],time_limit_ms:90000});
 assert.ok(draft.content.required_capabilities.includes('battle.combat.v1'));assert.ok(draft.content.required_capabilities.includes('content.resources.v1'));assert.equal(draft.content.entities.find(e=>e.id==='hero_one').data.sprite_resource_id,'icon_one');assert.equal(draft.content.entities.find(e=>e.id==='hero_one').data.combat.hp,400);
 await page.getByRole('button',{name:'Проверить бой'}).click();await page.getByRole('alert').filter({hasText:'Отметь героев'}).waitFor();assert.equal(previews,0);
 await page.getByRole('group',{name:/Твоя команда/}).getByLabel('Герой',{exact:true}).check();await page.getByRole('group',{name:'Противники',exact:true}).getByLabel('Волк',{exact:true}).check();
 await page.getByRole('button',{name:'Проверить бой'}).click();
 await page.getByRole('status').filter({hasText:'атакующих'}).waitFor();assert.equal(previews,1);
 await page.locator('svg.battle-field circle').first().waitFor();await page.locator('svg[aria-label="Спрайт hero_one"] image').waitFor();assert.equal(await page.locator('svg[aria-label="Спрайт enemy_wolf"]').count(),0,'hero without sprite stays a circle');
 const slider=page.getByLabel('Время');const last=await slider.getAttribute('max');await slider.fill(last);
 await page.getByRole('button',{name:'Воспроизвести'}).click();await page.waitForFunction(()=>document.querySelector('input[type=range]')?.value!==document.querySelector('input[type=range]')?.max);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'battle preview has no horizontal overflow');
 await page.screenshot({path:process.env.UFA_SCREENSHOT||'/tmp/studio-battle-preview.png',fullPage:false});
 // Export the hero with dependencies, then change the draft and import the package back.
 await page.getByRole('region',{name:'Импорт и экспорт'}).getByLabel('Герой (hero_one)').check();
 assert.match(await page.getByRole('link',{name:'Скачать выбранное (1)'}).getAttribute('href'),/\/export\?ids=hero_one$/);
 // Download handling of route-fulfilled responses is unreliable in headless Chromium; fetch the link target from the page instead.
 const href=await page.getByRole('link',{name:'Скачать выбранное (1)'}).getAttribute('href');
 const zip=Buffer.from(await page.evaluate(async h=>{const r=await fetch(h,{credentials:'same-origin'});if(r.headers.get('content-type')!=='application/zip')throw new Error('type');return Array.from(new Uint8Array(await r.arrayBuffer()));},href));assert.deepEqual(zip,exported);const pkg=await inspectArchive(zip);
 assert.deepEqual(pkg.entities.filter(Boolean).map(e=>e.id),['ability_one','faction_one','hero_one']);assert.equal(pkg.resources[0].meta.id,'icon_one');
 await page.getByRole('region',{name:'Импорт и экспорт'}).getByLabel('ZIP-пакет').setInputFiles({name:'bad.zip',mimeType:'application/zip',buffer:Buffer.from('not a zip')});
 await page.getByRole('button',{name:'Проверить пакет'}).click();await page.getByRole('status').filter({hasText:'не является корректным ZIP'}).waitFor();
 await page.getByRole('button',{name:'Отменить'}).click();await page.getByRole('status').filter({hasText:'Импорт отменён'}).waitFor();
 const before=draft.revision;
 await page.locator('li').filter({hasText:'ability_one'}).getByRole('button',{name:'Изменить'}).click();await page.getByLabel('Сила').fill('42');await page.getByRole('button',{name:'Применить изменения'}).click();
 await saveNow(page);
 await page.getByRole('region',{name:'Импорт и экспорт'}).getByLabel('ZIP-пакет').setInputFiles({name:'hero.zip',mimeType:'application/zip',buffer:zip});
 await page.getByRole('button',{name:'Проверить пакет'}).click();await page.getByRole('status').filter({hasText:'Есть конфликты'}).waitFor();
 await page.getByText('data.power').waitFor({state:'attached'});
 assert.equal(await page.getByRole('button',{name:'Применить импорт'}).isDisabled(),true,'apply blocked until conflicts resolved');
 await page.getByRole('group',{name:'Решение для ability_one'}).getByLabel('Оставить моё').check();
 await page.getByRole('button',{name:'Применить импорт'}).click();await page.getByRole('status').filter({hasText:'Импорт применён'}).waitFor();
 assert.equal(imports,1);assert.equal(draft.revision,before+2);assert.equal(draft.content.entities.find(e=>e.id==='ability_one').data.power,42,'manual choice kept owner value');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'import UI has no horizontal overflow');
 page.on('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Проверить перед публикацией'}).click();await page.getByRole('status').filter({hasText:'Проверка пройдена'}).waitFor();
 await page.getByText(/Добавится: .*hero_one/).waitFor();
 await page.getByRole('button',{name:'Опубликовать'}).click();await page.getByRole('status').filter({hasText:'Опубликована версия pub_000001'}).waitFor();
 assert.equal(published.length,1);await page.getByText('Сейчас в игре: pub_000001').waitFor();
 await page.getByRole('button',{name:'Проверить перед публикацией'}).click();await page.getByRole('status').filter({hasText:'уже опубликована'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Опубликовать'}).count(),0,'nothing to publish');
 // Owner case: a hero links a picture that was never uploaded -> explain, fix, save.
 const json=JSON.parse(await page.getByLabel('Содержимое JSON').inputValue({timeout:1000}).catch(async()=>{await page.locator('details.advanced').evaluate(d=>{d.open=true;});return page.getByLabel('Содержимое JSON').inputValue();}));
 json.entities.push({id:'hero_ghost',kind:'hero',name:'Heroes',data:{faction_id:'faction_one',ability_ids:['ability_one'],sprite_resource_id:'hero_sprite'}});
 await page.locator('details.advanced').evaluate(d=>{d.open=true;});await page.getByLabel('Содержимое JSON').fill(JSON.stringify(json,null,2));
 await page.getByRole('alert').filter({hasText:'Черновик не сохранится, пока не исправишь'}).waitFor();
 const revBefore=draft.revision;await page.getByRole('button',{name:'Сохранить черновик'}).click();
 await page.getByRole('status').filter({hasText:'ссылка на файл «hero_sprite»'}).waitFor();assert.equal(draft.revision,revBefore,'rejected save changes nothing');
 await page.getByRole('button',{name:'Исправить: убрать ссылку'}).click();await page.getByRole('status').filter({hasText:'Ссылка убрана'}).waitFor();
 await saveNow(page);
 assert.equal(draft.revision,revBefore+1);assert.equal(draft.content.entities.find(e=>e.id==='hero_ghost').data.sprite_resource_id,undefined);
 console.log('Chromium mobile: missing picture link explained, fixed in one tap, saved — passed (mock API)');
 // Map of Bashkortostan: import, open a district, add a point by tap, link a stage, art layer.
 const map=page.getByRole('region',{name:'Карта'});
 await map.getByRole('button',{name:'Добавить районы и города'}).click();await map.getByRole('status').filter({hasText:'Добавлено мест: 64'}).waitFor();
 await map.getByRole('button',{name:'Бурзянский район'}).click();await map.getByRole('img',{name:'Район: Бурзянский район'}).waitFor();
 const box=await map.locator('svg.geo-map').boundingBox();await page.mouse.click(box.x+box.width*0.55,box.y+box.height*0.6);
 await map.getByRole('status').filter({hasText:'Новая точка'}).waitFor();
 await map.getByLabel('Название точки').fill('Пещера Шульган-Таш');await map.getByRole('button',{name:'Добавить точку'}).click();
 await map.getByRole('status').filter({hasText:'Точка добавлена'}).waitFor();await map.locator('.entity-list li').filter({hasText:'Пещера Шульган-Таш'}).waitFor();
 if(process.env.UFA_SCREENSHOT_DIR)await map.screenshot({path:process.env.UFA_SCREENSHOT_DIR+'/map-district.png'});
 await page.getByLabel('Тип объекта').selectOption('stage');await page.getByLabel('Название объекта').fill('Пещера');
 await page.getByRole('group',{name:/Противники \(до 5/}).getByLabel('Волк').check();await page.getByLabel('Место на карте').selectOption({label:'Пещера Шульган-Таш (Бурзянский район)'});
 await page.getByRole('button',{name:'Добавить в черновик'}).click();
 await page.locator('.save-bar').filter({hasText:'Все изменения сохранены'}).waitFor({timeout:10000});
 const saved=draft.content.entities;const cave=saved.find(e=>e.kind==='location'&&e.name==='Пещера Шульган-Таш');
 assert.ok(cave&&cave.data.parent_id==='district_burzyanskiy'&&cave.data.source.kind==='manual');
 assert.equal(saved.find(e=>e.kind==='stage'&&e.name==='Пещера').data.location_id,cave.id);
 assert.ok(draft.content.required_capabilities.includes('world.locations.v1'));assert.equal(saved.filter(e=>e.kind==='location').length,65);
 await map.getByRole('button',{name:'Республика'}).click();await map.getByRole('img',{name:'Республика Башкортостан'}).waitFor();
 if(process.env.UFA_SCREENSHOT_DIR)await map.screenshot({path:process.env.UFA_SCREENSHOT_DIR+'/map-republic.png'});
 await map.getByLabel('Художественная карта').check();await map.getByLabel('Картинка художественной карты').selectOption('icon_one');
 await map.getByRole('status').filter({hasText:'Художественная карта выбрана'}).waitFor();
 await map.getByLabel('Схема по координатам').check();await map.getByLabel('Или выбери район/город из списка').selectOption({label:'г. Уфа'});await map.getByLabel('Художественная карта').check();
 await map.locator('.art-map').click({position:{x:5,y:5}});await map.getByRole('status').filter({hasText:'«г. Уфа» поставлено'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'map has no horizontal overflow');
 console.log('Chromium mobile: map import, district navigation, point by tap, stage linked to point, art layer — passed (mock API)');
 console.log('Chromium mobile: publish preflight, publish with confirm, unchanged version — passed (mock API)');
 console.log('Chromium mobile: export with dependencies, invalid ZIP, cancel, conflict diff and manual resolution, apply — passed (mock API with real importer)');
 console.log('Chromium mobile: create ability/faction/hero, save, reject referenced deletion, no overflow — passed (mock API)');
 console.log('Chromium mobile: WAV upload+player, hero sprite ref, combat form, unsaved/invalid preview rejected, sprite replay — passed (mock API with real battle-core)');
}finally{await browser.close();}
