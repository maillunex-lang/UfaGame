import React,{useEffect,useState} from 'react';
import {combatFields,deleteEntity,listEntities,upsertEntity,suggestId,quickStartHero,missingResourceRefs,dropResourceRef,type EditableEntity} from './entities.mjs';

type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
type Res={id:string;media_type:string;width?:number;height?:number;frames?:{x:number;y:number;width:number;height:number}[]};
const combatLabels:Record<string,string>={hp:'Здоровье',attack:'Атака',defense:'Защита',speed:'Скорость, ед./шаг',range:'Дальность',attack_interval_ms:'Интервал атаки, мс',energy_start:'Энергия на старте',energy_per_second:'Энергия в секунду',energy_per_attack:'Энергия за атаку'};
const combatDefaults:Record<string,string>={hp:'300',attack:'30',defense:'5',speed:'800',range:'1500',attack_interval_ms:'500',energy_start:'0',energy_per_second:'100',energy_per_attack:'100'};
const labels={hero:'Герой / враг',ability:'Способность',faction:'Фракция'};
const prefixes={hero:'hero',ability:'ability',faction:'faction'};
type Kind=keyof typeof labels;
const dataUrl=(id:string)=>'/game/server/admin/v1/resources/'+encodeURIComponent(id)+'/data';

/** First frame of a PNG resource as a small square thumbnail. */
export function Thumb({res,size=40}:{res?:Res;size?:number}){
 if(!res||res.media_type!=='image/png'||!res.width||!res.height)return <span className="thumb empty" style={{width:size,height:size}}/>;
 const f=res.frames?.[0]??{x:0,y:0,width:res.width,height:res.height},k=Math.min(size/f.width,size/f.height);
 return <span className="thumb" style={{width:size,height:size}}><img src={dataUrl(res.id)} alt="" style={{width:res.width*k,height:res.height*k,left:-f.x*k+(size-f.width*k)/2,top:-f.y*k+(size-f.height*k)/2}}/></span>;
}

export function EntityEditor({text,onChange,onPendingChange,api,resourcesVersion=0}:{text:string;onChange:(text:string)=>void;onPendingChange:(dirty:boolean)=>void;api?:Api;resourcesVersion?:number}) {
 const [kind,setKind]=useState<Kind>('hero'),[original,setOriginal]=useState<string|null>(null);
 const [id,setId]=useState(''),[idTouched,setIdTouched]=useState(false),[name,setName]=useState(''),[effect,setEffect]=useState('damage');
 const [formDirty,setFormDirty]=useState(false),[notice,setNotice]=useState('');
 const [power,setPower]=useState('60'),[cooldown,setCooldown]=useState('1000'),[faction,setFaction]=useState(''),[refs,setRefs]=useState<string[]>([]),[error,setError]=useState('');
 const [energyCost,setEnergyCost]=useState(''),[resourceRef,setResourceRef]=useState(''),[hasCombat,setHasCombat]=useState(true),[combat,setCombat]=useState<Record<string,string>>(combatDefaults);
 const [resources,setResources]=useState<Res[]|null>(null),[quickName,setQuickName]=useState(''),[quickSprite,setQuickSprite]=useState('');
 useEffect(()=>{if(api)api('/resources').then(r=>setResources(r.resources)).catch(()=>{});},[api,resourcesVersion]);
 const list=resources??[];
 const missing=resources?missingResourceRefs(text,resources):[];
 let entities:EditableEntity[]=[];try{entities=listEntities(text);}catch{/* Existing text error is reported on action. */}
 const of=(k:Kind)=>entities.filter(e=>e.kind===k);
 const images=list.filter(r=>r.media_type==='image/png'),sounds=list.filter(r=>r.media_type==='audio/wav');
 const autoId=original?id:idTouched?id:suggestId(name||labels[kind],prefixes[kind],entities.map(e=>e.id));
 const touch=()=>{setFormDirty(true);onPendingChange(true);};
 function reset(nextKind:Kind=kind){setOriginal(null);setId('');setIdTouched(false);setName('');setEffect('damage');setPower('60');setCooldown('1000');setFaction('');setRefs([]);setError('');setEnergyCost('');setResourceRef('');setHasCombat(nextKind==='hero');setCombat(combatDefaults);setFormDirty(false);onPendingChange(false);}
 function edit(item:EditableEntity){if(formDirty&&!window.confirm('В форме есть неприменённые изменения. Продолжить?'))return;reset(item.kind);setOriginal(item.id);setKind(item.kind);setId(item.id);setName(item.name);setNotice('');
  if(item.kind==='ability'){setEffect(item.data.effect);setPower(String(item.data.power));setCooldown(String(item.data.cooldown_ms));setEnergyCost(item.data.energy_cost===undefined?'':String(item.data.energy_cost));setResourceRef(item.data.sound_resource_id??'');}
  if(item.kind==='faction')setRefs(item.data.advantage_ids);
  if(item.kind==='hero'){setFaction(item.data.faction_id);setRefs(item.data.ability_ids);setResourceRef(item.data.sprite_resource_id??'');setHasCombat(!!item.data.combat);if(item.data.combat)setCombat(Object.fromEntries(Object.entries(item.data.combat).map(([k,v])=>[k,String(v)])));}
 }
 const saved='Готово. Чтобы изменения попали на сервер, нажми «Сохранить черновик» внизу экрана.';
 function apply(){try{
  if(!name.trim())throw new Error('Введи название.');
  if(kind==='hero'&&!faction)throw new Error('Выбери фракцию героя (или создай её кнопкой выше).');
  if(kind==='hero'&&refs.length===0)throw new Error('Отметь хотя бы одну способность.');
  if(kind==='ability'&&(!power.trim()||!cooldown.trim()))throw new Error('Укажи силу и перезарядку.');
  if(kind==='hero'&&hasCombat&&combatFields.some(([n])=>!(combat[n]??'').trim()))throw new Error('Заполни все боевые параметры.');
  const data=kind==='ability'?{effect,power:Number(power),cooldown_ms:Number(cooldown),...(energyCost.trim()?{energy_cost:Number(energyCost)}:{}),...(resourceRef?{sound_resource_id:resourceRef}:{})}:kind==='faction'?{advantage_ids:refs}:{faction_id:faction,ability_ids:refs,...(resourceRef?{sprite_resource_id:resourceRef}:{}),...(hasCombat?{combat:Object.fromEntries(combatFields.map(([n])=>[n,Number(combat[n])]))}:{})};
  onChange(upsertEntity(text,{id:autoId.trim(),name:name.trim(),kind,data},original));reset();setNotice(saved);
 }catch(e){setError((e as Error).message);}}
 function remove(item:EditableEntity){if(!window.confirm(`Удалить «${item.name}» из черновика?`))return;try{onChange(deleteEntity(text,item.id));if(original===item.id)reset();setError('');setNotice(saved);}catch(e){setError((e as Error).message);}}
 function quick(){try{onChange(quickStartHero(text,{name:quickName,spriteId:quickSprite||null}));setQuickName('');setQuickSprite('');setError('');setNotice('Герой создан вместе с фракцией и ударом. '+saved);}catch(e){setError((e as Error).message);}}
 function createFaction(){try{const fid=suggestId('Нейтральные','faction',entities.map(e=>e.id));onChange(upsertEntity(text,{id:fid,kind:'faction',name:'Нейтральные',data:{advantage_ids:[]}}));setFaction(fid);touch();}catch(e){setError((e as Error).message);}}
 function createAbility(){try{const aid=suggestId('Удар','ability',entities.map(e=>e.id));onChange(upsertEntity(text,{id:aid,kind:'ability',name:'Удар',data:{effect:'damage',power:60,cooldown_ms:1000}}));setRefs(r=>[...r,aid]);touch();}catch(e){setError((e as Error).message);}}
 const toggle=(value:string,on:boolean)=>setRefs(r=>on?[...r.filter(x=>x!==value),value]:r.filter(x=>x!==value));
 const resById=(rid?:string)=>list.find(r=>r.id===rid);
 function fix(entityId:string){try{onChange(dropResourceRef(text,entityId));setNotice('Ссылка убрана. Теперь нажми «Сохранить черновик» внизу.');}catch(e){setError((e as Error).message);}}
 return <section aria-label="Редактор объектов"><h2>Герои, способности, фракции</h2>
  <ol className="steps"><li>Загрузи картинку героя выше, в «Изображения и звуки».</li><li>Создай героя здесь: «Быстрый старт» или форма ниже.</li><li>Нажми «Сохранить черновик» внизу экрана.</li><li>В «Публикация контента» нажми «Проверить», затем «Опубликовать» — герой появится в игре.</li></ol>
  {missing.length>0&&<div className="problems" role="alert"><strong>Черновик не сохранится, пока не исправишь:</strong><ul>{missing.map(m=><li key={m.entity_id}>«{m.entity_name}»: {m.what} «{m.resource_id}» не загружена. <button type="button" className="secondary" onClick={()=>fix(m.entity_id)}>Исправить: убрать ссылку</button></li>)}</ul><p className="hint">Или загрузи файл с этим ID в «Изображения и звуки».</p></div>}
  {of('hero').length===0&&<div className="quickstart"><h3>Быстрый старт</h3><p>Создадим готового к бою героя: если нужно, сразу добавим фракцию «Нейтральные» и способность «Удар».</p>
   <label>Имя героя<input value={quickName} maxLength={100} onChange={e=>setQuickName(e.target.value)} placeholder="Например: Батыр"/></label>
   <label>Картинка героя<select value={quickSprite} onChange={e=>setQuickSprite(e.target.value)}><option value="">Без картинки</option>{images.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}</select></label>
   {images.length===0&&<p className="hint">Картинок пока нет — загрузи PNG выше в разделе «Изображения и звуки», он появится в этом списке.</p>}
   <button type="button" onClick={quick}>Создать героя</button></div>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  {(['hero','ability','faction'] as Kind[]).map(k=>of(k).length>0&&<div key={k}><h3>{{hero:'Герои',ability:'Способности',faction:'Фракции'}[k]}</h3><ul className="entity-list">{of(k).map(e=><li key={e.id}>{k==='hero'&&<Thumb res={resById(e.data.sprite_resource_id)}/>}<span><strong>{e.name}</strong> <small>{e.id}</small></span><button type="button" className="link" aria-label={`Изменить ${e.id}`} onClick={()=>edit(e)}>Изменить</button><button type="button" className="link" aria-label={`Удалить ${e.id}`} onClick={()=>remove(e)}>Удалить</button></li>)}</ul></div>)}
  <h3>{original?`Изменить: ${name||original}`:'Добавить вручную'}</h3>
  <div onChange={touch}>
  <label>Тип объекта<select value={kind} disabled={!!original} onChange={e=>{const k=e.target.value as Kind;reset(k);setKind(k);}}><option value="hero">Герой / враг</option><option value="ability">Способность</option><option value="faction">Фракция</option></select></label>
  <label>Название объекта<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder={kind==='hero'?'Например: Степной волк':kind==='ability'?'Например: Удар сабли':'Например: Урал'}/></label>
  {kind==='hero'&&<>
   <label>Фракция<select value={faction} onChange={e=>setFaction(e.target.value)}><option value="">— выбери —</option>{of('faction').map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
   {of('faction').length===0&&<button type="button" className="secondary" onClick={createFaction}>Создать фракцию «Нейтральные»</button>}
   <fieldset className="pick"><legend>Способности (первая отмеченная — основная)</legend>
    {of('ability').map(a=><label key={a.id} className="check"><input type="checkbox" checked={refs.includes(a.id)} onChange={e=>toggle(a.id,e.target.checked)}/>{a.name}{refs[0]===a.id?' — основная':''}</label>)}
    {of('ability').length===0&&<button type="button" className="secondary" onClick={createAbility}>Создать способность «Удар»</button>}
   </fieldset>
   <label>Картинка героя<select value={resourceRef} onChange={e=>setResourceRef(e.target.value)}><option value="">Без картинки</option>{images.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}{resourceRef&&!resById(resourceRef)&&<option value={resourceRef}>{resourceRef} (не найдена)</option>}</select></label>
   {resourceRef&&<Thumb res={resById(resourceRef)} size={64}/>}
   <fieldset className="combat"><label className="check"><input type="checkbox" checked={hasCombat} onChange={e=>setHasCombat(e.target.checked)} />Боевые параметры (нужны для проверки боя)</label>{hasCombat&&<div className="combat-grid">{combatFields.map(([n,min,max,step])=><label key={n}>{combatLabels[n]}<input type="number" min={min} max={max} step={step} value={combat[n]??''} onChange={e=>setCombat(c=>({...c,[n]:e.target.value}))} /></label>)}</div>}</fieldset>
  </>}
  {kind==='ability'&&<><label>Эффект<select value={effect} onChange={e=>setEffect(e.target.value)}><option value="damage">Урон</option><option value="heal">Лечение</option></select></label><label>Сила<input type="number" min="0" value={power} onChange={e=>setPower(e.target.value)} /></label><label>Перезарядка, мс<input type="number" min="0" value={cooldown} onChange={e=>setCooldown(e.target.value)} /></label><label>Стоимость энергии (основная способность, пусто = 1000)<input type="number" min="1" max="1000" value={energyCost} onChange={e=>setEnergyCost(e.target.value)} /></label>
   <label>Звук<select value={resourceRef} onChange={e=>setResourceRef(e.target.value)}><option value="">Без звука</option>{sounds.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}</select></label></>}
  {kind==='faction'&&<fieldset className="pick"><legend>Сильнее против фракций</legend>{of('faction').filter(f=>f.id!==original).map(f=><label key={f.id} className="check"><input type="checkbox" checked={refs.includes(f.id)} onChange={e=>toggle(f.id,e.target.checked)}/>{f.name}</label>)}{of('faction').filter(f=>f.id!==original).length===0&&<p className="hint">Других фракций пока нет.</p>}</fieldset>}
  <details><summary>Дополнительно: ID {autoId}</summary><label>ID объекта<input value={autoId} disabled={!!original} onChange={e=>{setIdTouched(true);setId(e.target.value);}} autoCapitalize="none" autoCorrect="off" spellCheck={false}/></label><p className="hint">ID создаётся из названия автоматически. Менять его нужно редко.</p></details>
  {error&&<p role="alert">{error}</p>}<button type="button" onClick={apply}>{original?'Применить изменения':'Добавить в черновик'}</button>{(original||formDirty)&&<button type="button" className="secondary" onClick={()=>reset()}>Очистить форму</button>}</div>
 </section>;
}
