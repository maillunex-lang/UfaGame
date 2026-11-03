const idPattern=/^[a-z][a-z0-9_]{2,79}$/;
const supported=new Set(['hero','ability','faction','stage','location','chapter','item','progression','vip','summon_pool','afk','quest']);
const listed=new Set(['hero','ability','faction','stage','chapter','item','progression','vip','summon_pool','afk','quest']);
const fail=message=>{throw new Error(message);};
const PROGRESSION_CAPABILITY='heroes.progression.v1',CAMPAIGN_CAPABILITY='campaign.chapters.v1',TRIGGERS_CAPABILITY='battle.triggers.v1',WORLD_CAPABILITY='world.locations.v1',COMBAT_CAPABILITY='battle.combat.v1',RESOURCE_CAPABILITY='content.resources.v1',ABILITIES_CAPABILITY='battle.abilities.v2';
export const itemSlots=['weapon','armor','helmet','boots','jewelry','artifact'],itemRarities=['common','rare','epic','legendary'],rewardCurrencies=['gold','gems','hero_exp','rank_material'];
export const abilityEffects=['damage','heal','stun','knockback'],abilityTargets=['enemy','weakest_enemy','all_enemies','ally_lowest','self'];
/** Field, min, max, step (multipleOf) for hero combat stats; mirrors content.schema.json. */
export const combatFields=[['hp',1,1000000,1],['attack',0,1000000,1],['defense',0,1000000,1],['speed',0,5000,1],['range',0,20000,1],['attack_interval_ms',100,90000,100],['energy_start',0,1000,1],['energy_per_second',0,10000,10],['energy_per_attack',0,1000,1]];
const inRange=(value,min,max,step=1)=>Number.isSafeInteger(value)&&value>=min&&value<=max&&value%step===0;
function toggle(content,capability,needed){
 const caps=Array.isArray(content.required_capabilities)?content.required_capabilities:(content.required_capabilities=[]);
 if(needed&&!caps.includes(capability))caps.push(capability);
 if(!needed&&caps.includes(capability))content.required_capabilities=caps.filter(c=>c!==capability);
}
function syncCapability(content){
 toggle(content,COMBAT_CAPABILITY,content.entities.some(e=>(e?.kind==='hero'&&e.data?.combat)||(e?.kind==='ability'&&e.data?.energy_cost!==undefined)));
 toggle(content,CAMPAIGN_CAPABILITY,content.entities.some(e=>e?.kind==='chapter'||(e?.kind==='stage'&&(e.data?.boss!==undefined||e.data?.rewards_first!==undefined))));
 toggle(content,'vip.v1',content.entities.some(e=>e?.kind==='vip'));
 toggle(content,'summon.v1',content.entities.some(e=>e?.kind==='summon_pool'));
 toggle(content,'afk.v1',content.entities.some(e=>e?.kind==='afk'));
 toggle(content,'quests.v1',content.entities.some(e=>e?.kind==='quest'));
 toggle(content,'battle.speed.v1',content.entities.some(e=>e?.kind==='vip'&&(e.data?.speed_x2_stages!==undefined||e.data?.speed_x4_level!==undefined||e.data?.instant_level!==undefined)));
 toggle(content,PROGRESSION_CAPABILITY,content.entities.some(e=>e?.kind==='progression'||(e?.kind==='item'&&(e.data?.stats!==undefined||e.data?.upgrade_max!==undefined||e.data?.faction_ids!==undefined))||(e?.kind==='stage'&&(e.data?.enemy_level!==undefined||e.data?.rewards_first_heroes!==undefined||e.data?.rewards_first_items!==undefined||(e.data?.rewards_first??[]).some(x=>x.currency==='hero_exp'||x.currency==='rank_material')))));
 toggle(content,TRIGGERS_CAPABILITY,content.entities.some(e=>e?.kind==='ability'&&(e.data?.trigger!==undefined||e.data?.extra_effects!==undefined)));
 toggle(content,WORLD_CAPABILITY,content.entities.some(e=>e?.kind==='location'||(e?.kind==='stage'&&e.data?.location_id!==undefined)));
 toggle(content,ABILITIES_CAPABILITY,content.entities.some(e=>(e?.kind==='ability'&&(['stun','knockback'].includes(e.data?.effect)||e.data?.target!==undefined||(e.data?.extra_effects??[]).some(x=>['stun','knockback'].includes(x.effect)||x.target!==undefined)))||(e?.kind==='faction'&&e.data?.advantage_bp!==undefined)));
 toggle(content,RESOURCE_CAPABILITY,content.entities.some(e=>(e?.kind==='hero'&&e.data?.sprite_resource_id!==undefined)||(e?.kind==='ability'&&e.data?.sound_resource_id!==undefined)||(e?.kind==='location'&&e.data?.art!==undefined)));
}
function documentFrom(text){
 let content;try{content=JSON.parse(text);}catch{fail('Исправь JSON черновика перед редактированием.');}
 if(!content||typeof content!=='object'||Array.isArray(content)||!Array.isArray(content.entities))fail('В черновике нет списка объектов.');
 if(content.entities.some(e=>!e||typeof e!=='object'||Array.isArray(e)||typeof e.id!=='string')||new Set(content.entities.map(e=>e.id)).size!==content.entities.length)fail('Исправь некорректные или повторяющиеся объекты в JSON.');
 return content;
}
function checkEntity(entity,all,originalId){
 if(!entity||!supported.has(entity.kind)||!idPattern.test(entity.id)||typeof entity.name!=='string'||!entity.name.trim()||entity.name.length>100)fail('Проверь ID и название. ID: маленькая латинская буква в начале, дальше латиница, цифры или _, 3–80 символов (например hero_batyr).');
 if(originalId&&entity.id!==originalId)fail('ID существующего объекта менять нельзя.');
 if(all.some(e=>e.id===entity.id&&e.id!==originalId))fail('Этот ID уже используется.');
 const refs=(ids,kind,max,min=0)=>{
  if(!Array.isArray(ids)||ids.length<min||ids.length>max||new Set(ids).size!==ids.length||ids.some(id=>!all.some(e=>e.id===id&&e.kind===kind)))fail('Проверь ссылки на существующие объекты.');
 };
 if(entity.kind==='ability'){
  if(entity.data.target!==undefined&&!abilityTargets.includes(entity.data.target))fail('Неизвестная цель способности.');
  if(!abilityEffects.includes(entity.data.effect)||!Number.isSafeInteger(entity.data.power)||entity.data.power<0||entity.data.power>2147483647||!Number.isSafeInteger(entity.data.cooldown_ms)||entity.data.cooldown_ms<0||entity.data.cooldown_ms>2147483647)fail('Проверь эффект, силу и время способности.');
  if(entity.data.energy_cost!==undefined&&!inRange(entity.data.energy_cost,1,1000))fail('Стоимость энергии — целое число от 1 до 1000.');
  const trigger=entity.data.trigger;
  if(trigger!==undefined){
   if(!['interval','self_hp_below','ally_hp_below','battle_start'].includes(trigger?.kind))fail('Неизвестное условие срабатывания.');
   const needs=trigger.kind==='self_hp_below'||trigger.kind==='ally_hp_below';
   if(needs&&!inRange(trigger.percent,1,99))fail('Порог здоровья — от 1 до 99%.');
   if(!needs&&trigger.percent!==undefined)fail('Для этого условия порог не нужен.');
  }
  const extra=entity.data.extra_effects;
  if(extra!==undefined){
   if(!Array.isArray(extra)||extra.length>2)fail('Не больше двух дополнительных действий.');
   for(const x of extra)if(!abilityEffects.includes(x?.effect)||!inRange(x.power,0,2147483647)||(x.target!==undefined&&!abilityTargets.includes(x.target)))fail('Проверь дополнительные действия.');
  }
  if(entity.data.sound_resource_id!==undefined&&!idPattern.test(entity.data.sound_resource_id))fail('Проверь ID звука.');
 }else if(entity.kind==='chapter'){
  checkChapter(entity,all,originalId);
 }else if(entity.kind==='location'){
  checkLocation(entity,all);
 }else if(entity.kind==='stage'){
  if(!Array.isArray(entity.data.enemy_hero_ids)||entity.data.enemy_hero_ids.length<1||entity.data.enemy_hero_ids.length>5||entity.data.enemy_hero_ids.some(id=>!all.some(e=>e.id===id&&e.kind==='hero')))fail('Выбери от 1 до 5 противников.');
  if(entity.data.time_limit_ms!==90000)fail('Длительность этапа — 90 секунд.');
  if(entity.data.location_id!==undefined&&!all.some(e=>e.id===entity.data.location_id&&e.kind==='location'&&e.data.level==='point'))fail('Этап можно привязать только к существующей точке на карте.');
  const rewards=entity.data.rewards_first;
  if(rewards!==undefined&&(!Array.isArray(rewards)||rewards.length>4||rewards.some(r=>!rewardCurrencies.includes(r?.currency)||!inRange(r.amount,1,1000000))||new Set(rewards.map(r=>r.currency)).size!==rewards.length))fail('Награда: золото, самоцветы, опыт героев, материалы ранга — от 1 до 1 000 000, каждая один раз.');
  if(entity.data.enemy_level!==undefined&&!inRange(entity.data.enemy_level,1,500))fail('Уровень врагов — от 1 до 500.');
  const combatHero=id=>all.some(e=>e.id===id&&e.kind==='hero'&&e.data.combat);
  const gear=id=>all.some(e=>e.id===id&&e.kind==='item'&&e.data.slot!=='none'&&e.data.stats);
  if(entity.data.rewards_first_heroes!==undefined&&(!Array.isArray(entity.data.rewards_first_heroes)||entity.data.rewards_first_heroes.length<1||entity.data.rewards_first_heroes.length>3||!entity.data.rewards_first_heroes.every(combatHero)))fail('Герои в награду: 1–3 героя с боевыми параметрами.');
  if(entity.data.rewards_first_items!==undefined&&(!Array.isArray(entity.data.rewards_first_items)||entity.data.rewards_first_items.length<1||entity.data.rewards_first_items.length>3||!entity.data.rewards_first_items.every(gear)))fail('Предметы в награду: 1–3 предмета экипировки.');
 }else if(entity.kind==='quest'){
  checkQuest(entity,all,originalId);
 }else if(entity.kind==='vip'||entity.kind==='summon_pool'||entity.kind==='afk'){
  checkEconomy(entity,all,originalId);
 }else if(entity.kind==='item'){
  checkItem(entity,all);
 }else if(entity.kind==='progression'){
  checkProgression(entity,all,originalId);
 }else if(entity.kind==='faction'){
  refs(entity.data.advantage_ids,'faction',6);
  if(entity.data.advantage_ids.includes(entity.id))fail('Фракция не может иметь преимущество перед собой.');
  if(entity.data.advantage_bp!==undefined&&!inRange(entity.data.advantage_bp,10000,20000))fail('Сила преимущества — от 100% до 200%.');
 }else{
  if(!all.some(e=>e.id===entity.data.faction_id&&e.kind==='faction'))fail('Выбери существующую фракцию.');
  refs(entity.data.ability_ids,'ability',8,1);
  if(entity.data.sprite_resource_id!==undefined&&!idPattern.test(entity.data.sprite_resource_id))fail('Проверь ID изображения героя.');
  const combat=entity.data.combat;
  if(combat!==undefined){
   if(!combat||typeof combat!=='object'||Object.keys(combat).some(k=>!combatFields.some(([name])=>name===k)))fail('Проверь боевые параметры героя.');
   for(const [name,min,max,step] of combatFields)if(!inRange(combat[name],min,max,step))fail(`Боевой параметр ${name}: целое от ${min} до ${max}${step>1?`, кратное ${step}`:''}.`);
  }
 }
}
export function listEntities(text){return documentFrom(text).entities.filter(e=>e&&listed.has(e.kind)).map(e=>structuredClone(e));}
export function upsertEntity(text,entity,originalId=null){
 const content=documentFrom(text),all=content.entities;
 if(originalId&&!all.some(e=>e.id===originalId&&e.kind===entity.kind))fail('Объект уже изменён или удалён.');
 checkEntity(entity,all,originalId);
 const position=originalId?all.findIndex(e=>e.id===originalId):-1;
 if(position<0)all.push(structuredClone(entity));else all[position]=structuredClone(entity);
 syncCapability(content);return JSON.stringify(content,null,2);
}
export function deleteEntity(text,id){
 const content=documentFrom(text),entity=content.entities.find(e=>e.id===id);
 if(!entity||!supported.has(entity.kind))fail('Объект не найден.');
 for(const other of content.entities){
  if(other.id===id)continue;
  const data=other.data??{};
  const lists=[[data.stage_id,data.requires_quest_id],data.reward_heroes,(data.entries??[]).map(x=>x.hero_id),data.guarantee?.hero_ids,data.stage_ids,data.starter_hero_ids,data.starter_item_ids,data.rewards_first_heroes,data.rewards_first_items,data.faction_ids];
  if(lists.some(l=>Array.isArray(l)&&l.includes(id))||data.parent_id===id||data.location_id===id||data.faction_id===id||(Array.isArray(data.ability_ids)&&data.ability_ids.includes(id))||(Array.isArray(data.advantage_ids)&&data.advantage_ids.includes(id))||(Array.isArray(data.enemy_hero_ids)&&data.enemy_hero_ids.includes(id)))fail(`Сначала убери ссылку из «${other.name}».`);
 }
 content.entities=content.entities.filter(e=>e.id!==id);syncCapability(content);return JSON.stringify(content,null,2);
}
const translit={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',ә:'a',ө:'o',ү:'u',ҡ:'k',ғ:'g',ҙ:'z',ҫ:'s',һ:'h',ң:'n'};
/** Readable stable ID from a (Russian/Bashkir) name: prefix_translit, unique among taken ids. */
export function suggestId(name,prefix,taken=[]){
 const base=[...String(name).toLowerCase()].map(c=>translit[c]??c).join('').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'new';
 const used=new Set(taken);let id=`${prefix}_${base}`,n=2;
 while(used.has(id))id=`${prefix}_${base}_${n++}`;
 return id;
}
export const defaultCombat=()=>Object.fromEntries(combatFields.map(([name])=>[name,{hp:300,attack:30,defense:5,speed:800,range:1500,attack_interval_ms:500,energy_start:0,energy_per_second:100,energy_per_attack:100}[name]]));
/** One step: ensures a faction and a basic strike exist, then adds a battle-ready hero. */
export function quickStartHero(text,{name,spriteId=null}){
 const content=documentFrom(text),ids=content.entities.map(e=>e.id);
 let factionId=content.entities.find(e=>e.kind==='faction')?.id;
 if(!factionId){factionId=suggestId('Нейтральные','faction',ids);text=upsertEntity(text,{id:factionId,kind:'faction',name:'Нейтральные',data:{advantage_ids:[]}});ids.push(factionId);}
 let abilityId=content.entities.find(e=>e.kind==='ability')?.id;
 if(!abilityId){abilityId=suggestId('Удар','ability',ids);text=upsertEntity(text,{id:abilityId,kind:'ability',name:'Удар',data:{effect:'damage',power:60,cooldown_ms:1000}});ids.push(abilityId);}
 const heroName=String(name??'').trim()||'Новый герой';
 return upsertEntity(text,{id:suggestId(heroName,'hero',ids),kind:'hero',name:heroName,data:{faction_id:factionId,ability_ids:[abilityId],...(spriteId?{sprite_resource_id:spriteId}:{}),combat:defaultCombat()}});
}
/** References to resources that do not exist (or have the wrong type): they block saving. */
export function missingResourceRefs(text,resources){
 let content;try{content=documentFrom(text);}catch{return [];}
 const types=new Map((resources??[]).map(r=>[r.id,r.media_type]));
 return content.entities.flatMap(e=>e?.kind==='hero'&&e.data?.sprite_resource_id!==undefined&&types.get(e.data.sprite_resource_id)!=='image/png'?[{entity_id:e.id,entity_name:e.name,resource_id:e.data.sprite_resource_id,what:'картинка'}]
  :e?.kind==='ability'&&e.data?.sound_resource_id!==undefined&&types.get(e.data.sound_resource_id)!=='audio/wav'?[{entity_id:e.id,entity_name:e.name,resource_id:e.data.sound_resource_id,what:'звук'}]:[]);
}
/** Removes the picture/sound link of one object (keeps everything else). */
export function dropResourceRef(text,entityId){
 const content=documentFrom(text),e=content.entities.find(x=>x.id===entityId);
 if(!e)fail('Объект не найден.');
 if(e.data)delete e.data.sprite_resource_id;if(e.data)delete e.data.sound_resource_id;
 syncCapability(content);return JSON.stringify(content,null,2);
}

/** Republic extents (same as the contract): not a border polygon. */
export const BOUNDS={min_lat_e6:51500000,max_lat_e6:56600000,min_lon_e6:53100000,max_lon_e6:60050000};
const PARENT_LEVELS={republic:[],district:['republic'],city:['republic'],point:['district','city']};
export function distanceKm(a,b){const r=d=>d*Math.PI/1.8e8,dLat=r(b.lat_e6-a.lat_e6),dLon=r(b.lon_e6-a.lon_e6);const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat_e6))*Math.cos(r(b.lat_e6))*Math.sin(dLon/2)**2;return 2*6371*Math.asin(Math.sqrt(h));}
function checkLocation(entity,all){
 const d=entity.data??{};
 if(!['republic','district','city','point'].includes(d.level))fail('Неизвестный уровень места.');
 if(!Number.isSafeInteger(d.lat_e6)||!Number.isSafeInteger(d.lon_e6))fail('Укажи координаты места.');
 if(d.level==='republic'){if(d.parent_id!==undefined)fail('У республики нет родителя.');return;}
 const parent=all.find(e=>e.id===d.parent_id&&e.kind==='location');
 if(!parent||!PARENT_LEVELS[d.level].includes(parent.data.level))fail(d.level==='point'?'Точку нужно поставить внутри района или города.':'Район и город должны входить в республику.');
 if(d.lat_e6<BOUNDS.min_lat_e6||d.lat_e6>BOUNDS.max_lat_e6||d.lon_e6<BOUNDS.min_lon_e6||d.lon_e6>BOUNDS.max_lon_e6)fail('Место вне Башкортостана.');
 if(d.level==='point'&&distanceKm(d,parent.data)>150)fail('Точка дальше 150 км от центра своего района — проверь район или координаты.');
 if(!d.source||!['wikidata','manual'].includes(d.source.kind))fail('Укажи источник места.');
}
export function listLocations(text){return documentFrom(text).entities.filter(e=>e?.kind==='location').map(e=>structuredClone(e));}
/** Adds the republic/districts/cities that are missing in the draft (existing ids are kept as they are). */
export function importGeography(text,dataset){
 const content=documentFrom(text),have=new Set(content.entities.map(e=>e.id));
 let added=0;
 for(const e of dataset.entities){if(have.has(e.id))continue;content.entities.push(structuredClone(e));added++;}
 syncCapability(content);
 return {text:JSON.stringify(content,null,2),added};
}

function checkChapter(entity,all,originalId){
 const d=entity.data??{};
 if(!inRange(d.order,1,999))fail('Номер главы — от 1 до 999.');
 if(all.some(e=>e.kind==='chapter'&&e.id!==originalId&&e.data.order===d.order))fail('Глава с таким номером уже есть.');
 if(!Array.isArray(d.stage_ids)||d.stage_ids.length<1||d.stage_ids.length>50||new Set(d.stage_ids).size!==d.stage_ids.length)fail('В главе от 1 до 50 разных этапов.');
 for(const id of d.stage_ids){
  if(!all.some(e=>e.id===id&&e.kind==='stage'))fail('Проверь этапы главы.');
  const other=all.find(e=>e.kind==='chapter'&&e.id!==originalId&&e.data.stage_ids.includes(id));
  if(other)fail(`Этап уже стоит в главе «${other.name}».`);
 }
 if(d.location_id!==undefined&&!all.some(e=>e.id===d.location_id&&e.kind==='location'&&['district','city'].includes(e.data.level)))fail('Карта главы — район или город.');
}

function checkItem(entity,all){
 const d=entity.data??{};
 if(!['none',...itemSlots].includes(d.slot)||!inRange(d.stack_limit,1,2147483647))fail('Выбери слот предмета.');
 if(d.stats!==undefined){
  if(d.slot==='none')fail('Предмету с бонусами нужен слот экипировки.');
  const keys=Object.keys(d.stats??{});
  if(!keys.length||keys.some(k=>!['hp','attack','defense','speed'].includes(k)||!inRange(d.stats[k],0,k==='speed'?1000:1000000)))fail('Бонусы предмета: хотя бы один, целые числа (скорость до 1000).');
 }
 if(d.rarity!==undefined&&!itemRarities.includes(d.rarity))fail('Неизвестная редкость.');
 if(d.upgrade_max!==undefined&&!inRange(d.upgrade_max,0,50))fail('Улучшений — от 0 до 50.');
 if(d.upgrade_bp!==undefined&&!inRange(d.upgrade_bp,0,10000))fail('Рост за улучшение — от 0 до 100%.');
 if(d.upgrade_gold!==undefined&&!inRange(d.upgrade_gold,0,1000000))fail('Цена улучшения — от 0 до 1 000 000.');
 if(d.faction_ids!==undefined&&(!Array.isArray(d.faction_ids)||d.faction_ids.length<1||d.faction_ids.length>6||new Set(d.faction_ids).size!==d.faction_ids.length||d.faction_ids.some(id=>!all.some(e=>e.id===id&&e.kind==='faction'))))fail('Проверь фракции, которым подходит предмет.');
}
function checkProgression(entity,all,originalId){
 const d=entity.data??{};
 if(all.some(e=>e.kind==='progression'&&e.id!==originalId))fail('Таблица развития уже есть — измени её.');
 for(const k of ['level_gold_base','level_gold_step','level_exp_base','level_exp_step'])if(!inRange(d[k],0,1000000))fail('Цены уровня — целые от 0 до 1 000 000.');
 if(!inRange(d.growth_bp,0,10000))fail('Рост за уровень — от 0 до 100%.');
 if(!inRange(d.material_per_copy,1,1000000))fail('Материалов за копию — от 1 до 1 000 000.');
 if(!inRange(d.sync_slots,0,20))fail('Ячеек синхронизации — от 0 до 20.');
 const r=d.ranks;
 if(!Array.isArray(r)||r.length<1||r.length>20)fail('Рангов — от 1 до 20.');
 r.forEach((x,i)=>{if(typeof x?.name!=='string'||!x.name.trim()||x.name.length>40||!inRange(x.max_level,1,500)||!inRange(x.copies,0,20)||!inRange(x.stat_bp,0,100000))fail(`Проверь ранг ${i+1}: название, предел уровня 1–500, копии 0–20, бонус 0–1000%.`);if(i>0&&x.max_level<r[i-1].max_level)fail(`Предел уровня ранга ${i+1} не может быть меньше предыдущего.`);});
 if(r[0].copies!==0)fail('Первый (стартовый) ранг не требует копий.');
 const heroes=d.starter_hero_ids??[],items=d.starter_item_ids??[];
 if(heroes.length>10||heroes.some(id=>!all.some(e=>e.id===id&&e.kind==='hero'&&e.data.combat)))fail('Стартовые герои: до 10, с боевыми параметрами.');
 if(items.length>10||items.some(id=>!all.some(e=>e.id===id&&e.kind==='item'&&e.data.slot!=='none'&&e.data.stats)))fail('Стартовые предметы: до 10, только экипировка с бонусами.');
}
/** Proposed starting table (owner may change every number). */
export function defaultProgression(){return {level_gold_base:100,level_gold_step:50,level_exp_base:100,level_exp_step:60,growth_bp:800,
 ranks:[{name:'Новичок',max_level:20,copies:0,stat_bp:0},{name:'Воин',max_level:40,copies:1,stat_bp:1500},{name:'Батыр',max_level:60,copies:2,stat_bp:3500},{name:'Легенда',max_level:100,copies:3,stat_bp:6000}],
 material_per_copy:100,sync_slots:5,proposed:true};}

function checkEconomy(entity,all,originalId){
 const d=entity.data??{};
 if(entity.kind!=='summon_pool'&&all.some(e=>e.kind===entity.kind&&e.id!==originalId))fail('Такая таблица уже есть — измени её.');
 if(entity.kind==='vip'){
  const l=d.levels;
  if(!Array.isArray(l)||l.length<1||l.length>20)fail('Уровней VIP — от 1 до 20.');
  l.forEach((x,i)=>{if(!inRange(x?.points,1,1000000000))fail(`Порог VIP ${i+1}: от 1 до 1 000 000 000 очков.`);if(i&&x.points<=l[i-1].points)fail(`Порог VIP ${i+1} должен быть больше, чем у VIP ${i}.`);if(x.afk_hours!==undefined&&!inRange(x.afk_hours,0,12))fail('Доп. часы AFK — от 0 до 12.');if(x.perks_text!==undefined&&(typeof x.perks_text!=='string'||x.perks_text.length>200))fail('Описание привилегий — до 200 символов.');});
  if(!inRange(d.tutorial_points,0,1000000000)||!inRange(d.daily_points,0,1000000))fail('Проверь очки за обучение и ежедневные очки.');
  if(d.tutorial_points>0&&d.tutorial_points<l[0].points)fail('Очков за обучение должно хватать на VIP 1.');
  if(d.win_points!==undefined&&!inRange(d.win_points,0,100000))fail('Очки за победу — от 0 до 100 000.');
  if(d.win_points_daily_cap!==undefined&&!inRange(d.win_points_daily_cap,0,1000000))fail('Предел очков за победы в день — до 1 000 000.');
  if(!d.daily_points&&!(d.win_points>0&&d.win_points_daily_cap>0))fail('Нужен бесплатный источник очков: ежедневные очки или очки за победы.');
  if(d.speed_x2_stages!==undefined&&!inRange(d.speed_x2_stages,0,1000))fail('Скорость ×2 — после 0…1000 пройденных этапов.');
  for(const k of ['speed_x4_level','instant_level'])if(d[k]!==undefined&&!inRange(d[k],1,20))fail('Уровень VIP для ×4 и быстрого расчёта — от 1 до 20.');
 }else if(entity.kind==='afk'){
  const r=d.per_hour;
  if(!Array.isArray(r)||r.length<1||r.length>3||new Set(r.map(x=>x.currency)).size!==r.length||r.some(x=>!['gold','hero_exp','rank_material'].includes(x?.currency)||!inRange(x.amount,1,1000000)))fail('Доход в час: золото, опыт, материалы — от 1 до 1 000 000, хотя бы одно.');
  if(d.stage_bonus_bp!==undefined&&!inRange(d.stage_bonus_bp,0,10000))fail('Прибавка за этап — от 0 до 100%.');
 }else{
  const e=d.entries,hero=id=>all.some(x=>x.id===id&&x.kind==='hero'&&x.data.combat);
  if(!['gold','gems'].includes(d.cost?.currency)||!inRange(d.cost?.amount,1,1000000))fail('Цена призыва — золото или самоцветы, от 1 до 1 000 000.');
  if(!Array.isArray(e)||e.length<1||e.length>50)fail('В призыве от 1 до 50 вариантов.');
  for(const x of e){if(!hero(x?.hero_id))fail('В призыве только герои с боевыми параметрами.');if(!inRange(x.weight,1,1000000))fail('Вес шанса — целое от 1 до 1 000 000.');if(x.shards!==undefined&&!inRange(x.shards,1,1000))fail('Осколков за выпадение — от 1 до 1000.');}
  if(new Set(e.map(x=>x.hero_id+':'+(x.shards??0))).size!==e.length)fail('Один и тот же вариант добавлен дважды.');
  if(e.some(x=>x.shards!==undefined)&&!inRange(d.shards_per_hero,1,1000))fail('Укажи, сколько осколков собирают героя.');
  if(d.guarantee){if(!inRange(d.guarantee.every,2,1000))fail('Гарантия — раз в 2…1000 попыток.');if(!d.guarantee.hero_ids?.length||d.guarantee.hero_ids.some(id=>!e.some(x=>x.hero_id===id&&x.shards===undefined)))fail('Гарантированные герои должны быть в призыве (не осколками).');}
 }
}
/** Proposed starting tables (owner may change every number). */
export const questEvents={battle_win:'Победы в боях',campaign_clear:'Прохождение этапа кампании',hero_level_up:'Повышение уровня героя',hero_rank_up:'Повышение ранга героя',summon_pull:'Попытки призыва',afk_claim:'Получение AFK-наград',item_upgrade:'Улучшение предметов'};
export function defaultVip(){return {levels:[[100,'Значок VIP',0],[300,'+1 ч AFK',1],[700,'+1 ч AFK',1],[1500,'+2 ч AFK',2],[3000,'+2 ч AFK',2],[6000,'+3 ч AFK',3],[10000,'+3 ч AFK, быстрый расчёт (S26)',3],[16000,'+4 ч AFK',4],[25000,'+4 ч AFK',4],[40000,'+5 ч AFK',5]].map(([points,perks_text,afk_hours])=>({points,perks_text,afk_hours})),tutorial_points:100,daily_points:20,win_points:2,win_points_daily_cap:20,speed_x2_stages:3,speed_x4_level:4,instant_level:7,proposed:true};}
export function defaultAfk(){return {per_hour:[{currency:'gold',amount:600},{currency:'hero_exp',amount:300},{currency:'rank_material',amount:5}],stage_bonus_bp:500,proposed:true};}
export function oddsPreview(entries){const t=entries.reduce((s,x)=>s+(Number(x.weight)>0?Number(x.weight):0),0);return entries.map(x=>t?((Number(x.weight)*10000/t)/100).toFixed(2):'0.00');}

function checkQuest(entity,all,originalId){
 const d=entity.data??{};
 if(!['daily','once'].includes(d.period))fail('Выбери: ежедневное задание или достижение.');
 if(!Object.keys(questEvents).includes(d.event))fail('Выбери событие задания.');
 if(!inRange(d.target,1,10000))fail('Цель — от 1 до 10 000 раз.');
 if(d.stage_id!==undefined){
  if(!['battle_win','campaign_clear'].includes(d.event))fail('Этап можно указать только для побед и прохождений.');
  const st=all.find(e=>e.id===d.stage_id&&e.kind==='stage');if(!st)fail('Этап задания не найден.');
  if(d.event==='campaign_clear'&&!all.some(e=>e.kind==='chapter'&&e.data.stage_ids.includes(d.stage_id)))fail('Для прохождения выбери этап из главы кампании.');
 }
 if(d.event==='campaign_clear'){const stagesInChapters=new Set(all.filter(e=>e.kind==='chapter').flatMap(e=>e.data.stage_ids)).size;if(d.target>(d.stage_id!==undefined?1:stagesInChapters))fail(d.stage_id!==undefined?'Этап проходится впервые один раз — цель должна быть 1.':`В кампании только ${stagesInChapters} этапов — цель не больше.`);}
 const rw=d.rewards??[];
 if(!Array.isArray(rw)||rw.length>4||rw.some(x=>!['gold','gems','hero_exp','rank_material','vip_points'].includes(x?.currency)||!inRange(x.amount,1,1000000))||new Set(rw.map(x=>x.currency)).size!==rw.length)fail('Награды: каждая валюта один раз, от 1 до 1 000 000.');
 const heroes=d.reward_heroes;
 if(heroes!==undefined&&(!Array.isArray(heroes)||heroes.length<1||heroes.length>3||heroes.some(id=>!all.some(e=>e.id===id&&e.kind==='hero'&&e.data.combat))))fail('Герои в награду: 1–3 героя с боевыми параметрами.');
 if(!rw.length&&!heroes?.length)fail('Добавь награду.');
 if(d.requires_quest_id!==undefined){
  if(d.requires_quest_id===entity.id||!all.some(e=>e.id===d.requires_quest_id&&e.kind==='quest'))fail('Предыдущее задание серии не найдено.');
  const seen=new Set([entity.id]);let cur=all.find(e=>e.id===d.requires_quest_id);
  while(cur?.kind==='quest'){if(seen.has(cur.id))fail('Серия заданий замкнулась в круг.');seen.add(cur.id);cur=all.find(e=>e.id===cur.data.requires_quest_id&&e.kind==='quest');}
 }
}
