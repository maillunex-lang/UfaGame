import React,{useState} from 'react';
import {combatFields,deleteEntity,listEntities,upsertEntity,type EditableEntity} from './entities.mjs';
const combatLabels:Record<string,string>={hp:'Здоровье',attack:'Атака',defense:'Защита',speed:'Скорость, ед./шаг',range:'Дальность',attack_interval_ms:'Интервал атаки, мс',energy_start:'Энергия на старте',energy_per_second:'Энергия в секунду',energy_per_attack:'Энергия за атаку'};
const combatDefaults:Record<string,string>={hp:'300',attack:'30',defense:'5',speed:'800',range:'1500',attack_interval_ms:'500',energy_start:'0',energy_per_second:'100',energy_per_attack:'100'};
const labels={hero:'Герой / враг',ability:'Способность',faction:'Фракция'};
type Kind=keyof typeof labels;
const csv=(value:string)=>value.split(',').map(x=>x.trim()).filter(Boolean);
export function EntityEditor({text,onChange,onPendingChange}:{text:string;onChange:(text:string)=>void;onPendingChange:(dirty:boolean)=>void}) {
 const [kind,setKind]=useState<Kind>('ability'),[original,setOriginal]=useState<string|null>(null);
 const [id,setId]=useState(''),[name,setName]=useState(''),[effect,setEffect]=useState('damage');
 const [formDirty,setFormDirty]=useState(false);
 const [power,setPower]=useState('0'),[cooldown,setCooldown]=useState('1000'),[faction,setFaction]=useState(''),[refs,setRefs]=useState(''),[error,setError]=useState('');
 const [energyCost,setEnergyCost]=useState(''),[hasCombat,setHasCombat]=useState(false),[combat,setCombat]=useState<Record<string,string>>(combatDefaults);
 let entities:EditableEntity[]=[];try{entities=listEntities(text);}catch{/* Existing text error is reported on action. */}
 function reset(){setOriginal(null);setId('');setName('');setEffect('damage');setPower('0');setCooldown('1000');setFaction('');setRefs('');setError('');setEnergyCost('');setHasCombat(false);setCombat(combatDefaults);setFormDirty(false);onPendingChange(false);}
 function edit(item:EditableEntity){if(formDirty&&!window.confirm('В форме есть неприменённые изменения. Продолжить?'))return;reset();setOriginal(item.id);setKind(item.kind);setId(item.id);setName(item.name);
  if(item.kind==='ability'){setEffect(item.data.effect);setPower(String(item.data.power));setCooldown(String(item.data.cooldown_ms));setEnergyCost(item.data.energy_cost===undefined?'':String(item.data.energy_cost));}
  if(item.kind==='faction')setRefs(item.data.advantage_ids.join(', '));
  if(item.kind==='hero'){setFaction(item.data.faction_id);setRefs(item.data.ability_ids.join(', '));if(item.data.combat){setHasCombat(true);setCombat(Object.fromEntries(Object.entries(item.data.combat).map(([k,v])=>[k,String(v)])));}}
 }
 function apply(){try{
  if(kind==='ability'&&(!power.trim()||!cooldown.trim()))throw new Error('Укажи силу и перезарядку.');
  if(kind==='hero'&&hasCombat&&combatFields.some(([name])=>!(combat[name]??'').trim()))throw new Error('Заполни все боевые параметры.');
  const data=kind==='ability'?{effect,power:Number(power),cooldown_ms:Number(cooldown),...(energyCost.trim()?{energy_cost:Number(energyCost)}:{})}:kind==='faction'?{advantage_ids:csv(refs)}:{faction_id:faction.trim(),ability_ids:csv(refs),...(hasCombat?{combat:Object.fromEntries(combatFields.map(([name])=>[name,Number(combat[name])]))}:{})};
  onChange(upsertEntity(text,{id:id.trim(),name:name.trim(),kind,data},original));reset();
 }catch(e){setError((e as Error).message);}}
 function remove(item:EditableEntity){if(!window.confirm(`Удалить «${item.name}» из черновика?`))return;try{onChange(deleteEntity(text,item.id));if(original===item.id)reset();setError('');}catch(e){setError((e as Error).message);}}
 return <section aria-label="Редактор объектов"><h2>Герои и способности</h2><p>Изменения сначала применяются к черновику. Затем нажми «Сохранить».</p>
  {entities.length>0&&<ul>{entities.map(e=><li key={e.id}>{labels[e.kind]}: {e.name} ({e.id}) <button type="button" className="link" onClick={()=>edit(e)}>Изменить</button><button type="button" className="link" onClick={()=>remove(e)}>Удалить</button></li>)}</ul>}
  <div onChange={()=>{setFormDirty(true);onPendingChange(true);}}><label>Тип объекта<select value={kind} disabled={!!original} onChange={e=>{reset();setKind(e.target.value as Kind);}}><option value="ability">Способность</option><option value="faction">Фракция</option><option value="hero">Герой / враг</option></select></label>
  <label>ID объекта<input value={id} disabled={!!original} onChange={e=>setId(e.target.value)} placeholder="hero_name" /></label>
  <label>Название объекта<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} /></label>
  {kind==='ability'&&<><label>Эффект<select value={effect} onChange={e=>setEffect(e.target.value)}><option value="damage">Урон</option><option value="heal">Лечение</option></select></label><label>Сила<input type="number" min="0" value={power} onChange={e=>setPower(e.target.value)} /></label><label>Перезарядка, мс<input type="number" min="0" value={cooldown} onChange={e=>setCooldown(e.target.value)} /></label><label>Стоимость энергии (основная способность, пусто = 1000)<input type="number" min="1" max="1000" value={energyCost} onChange={e=>setEnergyCost(e.target.value)} /></label></>}
  {kind==='hero'&&<label>ID фракции<input value={faction} onChange={e=>setFaction(e.target.value)} /></label>}
  {kind!=='ability'&&<label>{kind==='hero'?'ID способностей через запятую':'ID фракций с преимуществом через запятую'}<input value={refs} onChange={e=>setRefs(e.target.value)} /></label>}
  {kind==='hero'&&<fieldset className="combat"><label><input type="checkbox" checked={hasCombat} onChange={e=>setHasCombat(e.target.checked)} />Боевые параметры (нужны для проверки боя)</label>{hasCombat&&<div className="combat-grid">{combatFields.map(([name,min,max,step])=><label key={name}>{combatLabels[name]}<input type="number" min={min} max={max} step={step} value={combat[name]??''} onChange={e=>setCombat(c=>({...c,[name]:e.target.value}))} /></label>)}</div>}<p>Первая способность героя — основная (тратит энергию), остальные срабатывают автоматически по перезарядке.</p></fieldset>}
  {error&&<p role="alert">{error}</p>}<button type="button" onClick={apply}>{original?'Применить изменения':'Добавить в черновик'}</button>{(original||formDirty)&&<button type="button" className="secondary" onClick={reset}>Очистить форму</button>}</div>
 </section>;
}
