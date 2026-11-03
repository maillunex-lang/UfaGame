const idPattern=/^[a-z][a-z0-9_]{2,79}$/;
const supported=new Set(['hero','ability','faction','stage','location']);
const listed=new Set(['hero','ability','faction','stage']);
const fail=message=>{throw new Error(message);};
const WORLD_CAPABILITY='world.locations.v1',COMBAT_CAPABILITY='battle.combat.v1',RESOURCE_CAPABILITY='content.resources.v1',ABILITIES_CAPABILITY='battle.abilities.v2';
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
 toggle(content,WORLD_CAPABILITY,content.entities.some(e=>e?.kind==='location'||(e?.kind==='stage'&&e.data?.location_id!==undefined)));
 toggle(content,ABILITIES_CAPABILITY,content.entities.some(e=>(e?.kind==='ability'&&(['stun','knockback'].includes(e.data?.effect)||e.data?.target!==undefined))||(e?.kind==='faction'&&e.data?.advantage_bp!==undefined)));
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
  if(entity.data.sound_resource_id!==undefined&&!idPattern.test(entity.data.sound_resource_id))fail('Проверь ID звука.');
 }else if(entity.kind==='location'){
  checkLocation(entity,all);
 }else if(entity.kind==='stage'){
  if(!Array.isArray(entity.data.enemy_hero_ids)||entity.data.enemy_hero_ids.length<1||entity.data.enemy_hero_ids.length>5||entity.data.enemy_hero_ids.some(id=>!all.some(e=>e.id===id&&e.kind==='hero')))fail('Выбери от 1 до 5 противников.');
  if(entity.data.time_limit_ms!==90000)fail('Длительность этапа — 90 секунд.');
  if(entity.data.location_id!==undefined&&!all.some(e=>e.id===entity.data.location_id&&e.kind==='location'&&e.data.level==='point'))fail('Этап можно привязать только к существующей точке на карте.');
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
  if(data.parent_id===id||data.location_id===id||data.faction_id===id||(Array.isArray(data.ability_ids)&&data.ability_ids.includes(id))||(Array.isArray(data.advantage_ids)&&data.advantage_ids.includes(id))||(Array.isArray(data.enemy_hero_ids)&&data.enemy_hero_ids.includes(id)))fail(`Сначала убери ссылку из «${other.name}».`);
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
