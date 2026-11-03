const idPattern=/^[a-z][a-z0-9_]{2,79}$/;
const supported=new Set(['hero','ability','faction']);
const fail=message=>{throw new Error(message);};
const COMBAT_CAPABILITY='battle.combat.v1',RESOURCE_CAPABILITY='content.resources.v1';
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
 toggle(content,RESOURCE_CAPABILITY,content.entities.some(e=>(e?.kind==='hero'&&e.data?.sprite_resource_id!==undefined)||(e?.kind==='ability'&&e.data?.sound_resource_id!==undefined)));
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
  if(!['damage','heal'].includes(entity.data.effect)||!Number.isSafeInteger(entity.data.power)||entity.data.power<0||entity.data.power>2147483647||!Number.isSafeInteger(entity.data.cooldown_ms)||entity.data.cooldown_ms<0||entity.data.cooldown_ms>2147483647)fail('Проверь эффект, силу и время способности.');
  if(entity.data.energy_cost!==undefined&&!inRange(entity.data.energy_cost,1,1000))fail('Стоимость энергии — целое число от 1 до 1000.');
  if(entity.data.sound_resource_id!==undefined&&!idPattern.test(entity.data.sound_resource_id))fail('Проверь ID звука.');
 }else if(entity.kind==='faction'){
  refs(entity.data.advantage_ids,'faction',6);
  if(entity.data.advantage_ids.includes(entity.id))fail('Фракция не может иметь преимущество перед собой.');
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
export function listEntities(text){return documentFrom(text).entities.filter(e=>e&&supported.has(e.kind)).map(e=>structuredClone(e));}
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
  if(data.faction_id===id||(Array.isArray(data.ability_ids)&&data.ability_ids.includes(id))||(Array.isArray(data.advantage_ids)&&data.advantage_ids.includes(id))||(Array.isArray(data.enemy_hero_ids)&&data.enemy_hero_ids.includes(id)))fail(`Сначала убери ссылку из «${other.name}».`);
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
