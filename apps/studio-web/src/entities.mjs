const idPattern=/^[a-z][a-z0-9_]{2,79}$/;
const supported=new Set(['hero','ability','faction']);
const fail=message=>{throw new Error(message);};
const COMBAT_CAPABILITY='battle.combat.v1';
/** Field, min, max, step (multipleOf) for hero combat stats; mirrors content.schema.json. */
export const combatFields=[['hp',1,1000000,1],['attack',0,1000000,1],['defense',0,1000000,1],['speed',0,5000,1],['range',0,20000,1],['attack_interval_ms',100,90000,100],['energy_start',0,1000,1],['energy_per_second',0,10000,10],['energy_per_attack',0,1000,1]];
const inRange=(value,min,max,step=1)=>Number.isSafeInteger(value)&&value>=min&&value<=max&&value%step===0;
function syncCapability(content){
 const needed=content.entities.some(e=>(e?.kind==='hero'&&e.data?.combat)||(e?.kind==='ability'&&e.data?.energy_cost!==undefined));
 const caps=Array.isArray(content.required_capabilities)?content.required_capabilities:(content.required_capabilities=[]);
 if(needed&&!caps.includes(COMBAT_CAPABILITY))caps.push(COMBAT_CAPABILITY);
 if(!needed&&caps.includes(COMBAT_CAPABILITY))content.required_capabilities=caps.filter(c=>c!==COMBAT_CAPABILITY);
}
function documentFrom(text){
 let content;try{content=JSON.parse(text);}catch{fail('Исправь JSON черновика перед редактированием.');}
 if(!content||typeof content!=='object'||Array.isArray(content)||!Array.isArray(content.entities))fail('В черновике нет списка объектов.');
 if(content.entities.some(e=>!e||typeof e!=='object'||Array.isArray(e)||typeof e.id!=='string')||new Set(content.entities.map(e=>e.id)).size!==content.entities.length)fail('Исправь некорректные или повторяющиеся объекты в JSON.');
 return content;
}
function checkEntity(entity,all,originalId){
 if(!entity||!supported.has(entity.kind)||!idPattern.test(entity.id)||typeof entity.name!=='string'||!entity.name.trim()||entity.name.length>100)fail('Проверь ID и название объекта.');
 if(originalId&&entity.id!==originalId)fail('ID существующего объекта менять нельзя.');
 if(all.some(e=>e.id===entity.id&&e.id!==originalId))fail('Этот ID уже используется.');
 const refs=(ids,kind,max,min=0)=>{
  if(!Array.isArray(ids)||ids.length<min||ids.length>max||new Set(ids).size!==ids.length||ids.some(id=>!all.some(e=>e.id===id&&e.kind===kind)))fail('Проверь ссылки на существующие объекты.');
 };
 if(entity.kind==='ability'){
  if(!['damage','heal'].includes(entity.data.effect)||!Number.isSafeInteger(entity.data.power)||entity.data.power<0||entity.data.power>2147483647||!Number.isSafeInteger(entity.data.cooldown_ms)||entity.data.cooldown_ms<0||entity.data.cooldown_ms>2147483647)fail('Проверь эффект, силу и время способности.');
  if(entity.data.energy_cost!==undefined&&!inRange(entity.data.energy_cost,1,1000))fail('Стоимость энергии — целое число от 1 до 1000.');
 }else if(entity.kind==='faction'){
  refs(entity.data.advantage_ids,'faction',6);
  if(entity.data.advantage_ids.includes(entity.id))fail('Фракция не может иметь преимущество перед собой.');
 }else{
  if(!all.some(e=>e.id===entity.data.faction_id&&e.kind==='faction'))fail('Выбери существующую фракцию.');
  refs(entity.data.ability_ids,'ability',8,1);
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
