import React,{useState} from 'react';
import {listEntities,upsertEntity,deleteEntity,suggestId,defaultProgression,itemSlots,type EditableEntity} from './entities.mjs';

/**
 * S23/S24/S28: hero growth table (levels, ranks, copies/materials, sync slots,
 * starter heroes/items) and equipment items. Everything is picked from lists; no
 * IDs or JSON. Numbers are proposals the owner may change at any time.
 */
const slotNames:Record<string,string>={weapon:'Оружие',armor:'Броня',helmet:'Шлем',boots:'Обувь',jewelry:'Украшение',artifact:'Артефакт'};
const rarityNames:Record<string,string>={common:'Обычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'};
const statNames:Record<string,string>={hp:'Здоровье',attack:'Атака',defense:'Защита',speed:'Скорость'};
type Rank={name:string;max_level:string;copies:string;stat:string};
const num=(v:string)=>Number(v.trim()===''?NaN:v);

export function GrowthEditor({text,onChange,onPendingChange}:{text:string;onChange:(t:string)=>void;onPendingChange:(dirty:boolean)=>void}){
 let entities:EditableEntity[]=[];try{entities=listEntities(text);}catch{/* JSON errors are shown elsewhere */}
 const table=entities.find(e=>e.kind==='progression'),items=entities.filter(e=>e.kind==='item');
 const heroes=entities.filter(e=>e.kind==='hero'&&e.data.combat),factions=entities.filter(e=>e.kind==='faction');
 const gear=items.filter(i=>i.data.slot!=='none'&&i.data.stats);
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 const saved='Готово. Изменения сохранятся автоматически (или нажми «Сохранить черновик» внизу).';
 const run=(fn:()=>void,done=saved)=>{try{fn();setError('');setMessage(done);}catch(e){setError((e as Error).message);setMessage('');}};

 // Growth table form (loaded from the table when "Изменить" is pressed).
 const [open,setOpen]=useState(false),[f,setF]=useState<Record<string,string>>({}),[ranks,setRanks]=useState<Rank[]>([]);
 const [starters,setStarters]=useState<Record<string,number>>({}),[starterItems,setStarterItems]=useState<string[]>([]),[proposed,setProposed]=useState(true);
 const dirty=(v:boolean)=>onPendingChange(v);
 function load(d:any){
  setF({gb:String(d.level_gold_base),gs:String(d.level_gold_step),eb:String(d.level_exp_base),es:String(d.level_exp_step),growth:String(d.growth_bp/100),mat:String(d.material_per_copy),sync:String(d.sync_slots)});
  setRanks(d.ranks.map((r:any)=>({name:r.name,max_level:String(r.max_level),copies:String(r.copies),stat:String(r.stat_bp/100)})));
  const count:Record<string,number>={};for(const id of d.starter_hero_ids??[])count[id]=(count[id]??0)+1;setStarters(count);
  setStarterItems(d.starter_item_ids??[]);setProposed(!!d.proposed);setOpen(true);
 }
 function create(){run(()=>{onChange(upsertEntity(text,{id:'progression_main',kind:'progression',name:'Развитие героев',data:defaultProgression()}));},'Таблица создана с предлагаемыми значениями. Нажми «Изменить таблицу», чтобы поменять числа.');}
 function applyTable(){run(()=>{
  if(!table)throw new Error('Таблицы нет.');
  const data={level_gold_base:num(f.gb),level_gold_step:num(f.gs),level_exp_base:num(f.eb),level_exp_step:num(f.es),growth_bp:Math.round(num(f.growth)*100),
   ranks:ranks.map(r=>({name:r.name.trim(),max_level:num(r.max_level),copies:num(r.copies),stat_bp:Math.round(num(r.stat)*100)})),material_per_copy:num(f.mat),sync_slots:num(f.sync),
   ...(Object.keys(starters).length?{starter_hero_ids:Object.entries(starters).flatMap(([id,n])=>Array(n).fill(id))}:{}),...(starterItems.length?{starter_item_ids:starterItems}:{}),...(proposed?{proposed:true}:{})};
  onChange(upsertEntity(text,{id:table.id,kind:'progression',name:table.name,data},table.id));setOpen(false);dirty(false);
 });}
 const field=(key:string,label:string,hint?:string)=><label key={key}>{label}<input type="number" min="0" value={f[key]??''} onChange={e=>{setF(x=>({...x,[key]:e.target.value}));dirty(true);}}/>{hint&&<small>{hint}</small>}</label>;
 const starterTotal=Object.values(starters).reduce((a,b)=>a+b,0);

 // Item form.
 const [itemOriginal,setItemOriginal]=useState<string|null>(null),[itemOpen,setItemOpen]=useState(false);
 const [itemName,setItemName]=useState(''),[slot,setSlot]=useState('weapon'),[rarity,setRarity]=useState('common'),[stats,setStats]=useState<Record<string,string>>({attack:'50'});
 const [upMax,setUpMax]=useState('5'),[upPct,setUpPct]=useState('20'),[upGold,setUpGold]=useState('100'),[itemFactions,setItemFactions]=useState<string[]>([]);
 function newItem(){setItemOriginal(null);setItemName('');setSlot('weapon');setRarity('common');setStats({attack:'50'});setUpMax('5');setUpPct('20');setUpGold('100');setItemFactions([]);setItemOpen(true);}
 function editItem(i:EditableEntity){setItemOriginal(i.id);setItemName(i.name);setSlot(i.data.slot==='none'?'weapon':i.data.slot);setRarity(i.data.rarity??'common');
  setStats(Object.fromEntries(Object.entries(i.data.stats??{}).map(([k,v])=>[k,String(v)])));setUpMax(String(i.data.upgrade_max??0));setUpPct(String((i.data.upgrade_bp??0)/100));setUpGold(String(i.data.upgrade_gold??0));setItemFactions(i.data.faction_ids??[]);setItemOpen(true);}
 function applyItem(){run(()=>{
  if(!itemName.trim())throw new Error('Введи название предмета.');
  const st=Object.fromEntries(Object.entries(stats).filter(([,v])=>v.trim()!==''&&Number(v)>0).map(([k,v])=>[k,Number(v)]));
  if(!Object.keys(st).length)throw new Error('Укажи хотя бы один бонус больше нуля.');
  const id=itemOriginal??suggestId(itemName,'item',entities.map(e=>e.id));
  const prev=itemOriginal?items.find(i=>i.id===itemOriginal)?.data:undefined;
  const data={stack_limit:prev?.stack_limit??1,slot,rarity,stats:st,upgrade_max:num(upMax),upgrade_bp:Math.round(num(upPct)*100),upgrade_gold:num(upGold),...(itemFactions.length?{faction_ids:itemFactions}:{})};
  onChange(upsertEntity(text,{id,kind:'item',name:itemName.trim(),data},itemOriginal));setItemOpen(false);dirty(false);
 });}
 const removeItem=(i:EditableEntity)=>{if(window.confirm(`Удалить «${i.name}»?`))run(()=>onChange(deleteEntity(text,i.id)));};

 const p:any=table?.data;
 const costAt=(lv:number)=>p?`${p.level_gold_base+p.level_gold_step*(lv-1)} золота и ${p.level_exp_base+p.level_exp_step*(lv-1)} опыта`:'';
 return <section aria-label="Развитие героев"><h2>Развитие героев и предметы</h2>
  <ol className="steps"><li>Создай таблицу развития: уровни, ранги, синхронизация, стартовые герои.</li><li>Добавь предметы экипировки (6 слотов).</li><li>В этапах можно выдавать опыт, материалы, героев и предметы за первую победу.</li><li>Сохрани черновик и опубликуй.</li></ol>
  {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert">{error}</p>}
  <h3>Таблица развития</h3>
  {!table?<><p className="hint">Пока таблицы нет — в игре герои не прокачиваются, а бой идёт героями из Studio. Создай таблицу с предлагаемыми значениями и поменяй их под себя.</p><button type="button" onClick={create}>Создать таблицу развития</button></>:
  <div className="growth-summary">
   <p>Уровень 1→2: {costAt(1)}; уровень 10→11: {costAt(10)}. Рост характеристик: +{p.growth_bp/100}% за уровень.</p>
   <p>Ранги: {p.ranks.map((r:any,i:number)=>`${r.name} (до ${r.max_level} ур.${i?`, ${r.copies} коп.`:''})`).join(' → ')}. Одну копию заменяют {p.material_per_copy} материалов ранга.</p>
   <p>Ячеек синхронизации: {p.sync_slots}. Стартовых героев: {(p.starter_hero_ids??[]).length}, предметов: {(p.starter_item_ids??[]).length}.{p.proposed?' Значения предварительные.':''}</p>
   {!open&&<button type="button" onClick={()=>load(p)}>Изменить таблицу</button>}
  </div>}
  {table&&open&&<div className="growth-form" onChange={()=>dirty(true)}>
   <fieldset className="pick"><legend>Цена уровня</legend>{field('gb','Золото за уровень 1→2')}{field('gs','Прибавка золота за каждый следующий уровень')}{field('eb','Опыт героев за уровень 1→2')}{field('es','Прибавка опыта за каждый следующий уровень')}{field('growth','Рост характеристик за уровень, %','Здоровье, атака и защита растут от базовых значений героя.')}</fieldset>
   <fieldset className="pick"><legend>Ранги (по порядку)</legend>
    {ranks.map((r,i)=><div key={i} className="rank-row"><strong>Ранг {i+1}{i===0?' (стартовый)':''}</strong>
     <label>Название<input aria-label={`Название ранга ${i+1}`} value={r.name} maxLength={40} onChange={e=>setRanks(x=>x.map((y,j)=>j===i?{...y,name:e.target.value}:y))}/></label>
     <label>Предел уровня<input aria-label={`Предел уровня ${i+1}`} type="number" min="1" max="500" value={r.max_level} onChange={e=>setRanks(x=>x.map((y,j)=>j===i?{...y,max_level:e.target.value}:y))}/></label>
     {i>0&&<label>Копий героя<input aria-label={`Копий героя для ранга ${i+1}`} type="number" min="0" max="20" value={r.copies} onChange={e=>setRanks(x=>x.map((y,j)=>j===i?{...y,copies:e.target.value}:y))}/></label>}
     <label>Бонус, %<input aria-label={`Бонус характеристик ранга ${i+1}, %`} type="number" min="0" max="1000" value={r.stat} onChange={e=>setRanks(x=>x.map((y,j)=>j===i?{...y,stat:e.target.value}:y))}/></label>
     {i>0&&<button type="button" className="secondary" onClick={()=>{setRanks(x=>x.filter((_,j)=>j!==i));dirty(true);}}>Убрать ранг {i+1}</button>}</div>)}
    {ranks.length<20&&<button type="button" className="secondary" onClick={()=>{const last=ranks[ranks.length-1];setRanks(x=>[...x,{name:'Новый ранг',max_level:String(Number(last?.max_level??1)+10),copies:'1',stat:'0'}]);dirty(true);}}>Добавить ранг</button>}
    <p className="hint">Первый ранг — стартовый, копий не требует. Недостающие копии игрок заменяет материалами ранга.</p>
    {field('mat','Материалов ранга вместо одной копии')}</fieldset>
   <fieldset className="pick"><legend>Пятёрка и синхронизация</legend>{field('sync','Ячеек синхронизации (0–20)')}<p className="hint">Уровни растут только у 5 основных героев. Когда все 5 мест заняты, герои в ячейках получают уровень самого слабого из пятёрки (но не выше предела своего ранга). Пока основных меньше 5, синхронизация выключена.</p></fieldset>
   <fieldset className="pick"><legend>Стартовые герои ({starterTotal} из 10)</legend>{heroes.length===0&&<p className="hint">Нужны герои с боевыми параметрами.</p>}
    {heroes.map(h=><label key={h.id} className="check">{h.name}: <select aria-label={`Копий на старте: ${h.name}`} value={starters[h.id]??0} onChange={e=>{const n=Number(e.target.value);setStarters(x=>{const y={...x};if(n)y[h.id]=n;else delete y[h.id];return y;});dirty(true);}}>{[0,1,2,3].map(n=><option key={n} value={n} disabled={n>(starters[h.id]??0)&&starterTotal-(starters[h.id]??0)+n>10}>{n===0?'нет':`${n} шт.`}</option>)}</select></label>)}
    <p className="hint">Первые пять стартовых героев сразу встают в основную пятёрку. Лишние копии нужны для повышения ранга.</p></fieldset>
   <fieldset className="pick"><legend>Стартовые предметы</legend>{gear.length===0&&<p className="hint">Сначала добавь предметы ниже.</p>}
    {gear.map(i=><label key={i.id} className="check"><input type="checkbox" checked={starterItems.includes(i.id)} disabled={!starterItems.includes(i.id)&&starterItems.length>=10} onChange={e=>{setStarterItems(x=>e.target.checked?[...x,i.id]:x.filter(y=>y!==i.id));dirty(true);}}/>{i.name}</label>)}</fieldset>
   <label className="check"><input type="checkbox" checked={proposed} onChange={e=>setProposed(e.target.checked)}/>Значения предварительные (ещё не утверждены)</label>
   <button type="button" onClick={applyTable}>Применить таблицу</button><button type="button" className="secondary" onClick={()=>{setOpen(false);dirty(false);}}>Отмена</button>
  </div>}

  <h3>Предметы экипировки</h3>
  {items.length===0&&<p className="hint">Предметов пока нет.</p>}
  <ul className="entity-list">{items.map(i=><li key={i.id}><span><strong>{i.name}</strong> {slotNames[i.data.slot]??'без слота'}{i.data.stats?' · '+Object.entries(i.data.stats).map(([k,v])=>`${statNames[k]} +${v}`).join(', '):''}</span><button type="button" className="link" aria-label={`Изменить ${i.id}`} onClick={()=>editItem(i)}>Изменить</button><button type="button" className="link" aria-label={`Удалить ${i.id}`} onClick={()=>removeItem(i)}>Удалить</button></li>)}</ul>
  {!itemOpen?<button type="button" onClick={newItem}>Добавить предмет</button>:<div className="growth-form" onChange={()=>dirty(true)}>
   <h3>{itemOriginal?`Изменить: ${itemName}`:'Новый предмет'}</h3>
   <label>Название предмета<input value={itemName} maxLength={100} onChange={e=>setItemName(e.target.value)} placeholder="Например: Сабля батыра"/></label>
   <label>Слот<select value={slot} onChange={e=>setSlot(e.target.value)}>{itemSlots.map(s=><option key={s} value={s}>{slotNames[s]}</option>)}</select></label>
   <label>Редкость<select value={rarity} onChange={e=>setRarity(e.target.value)}>{Object.entries(rarityNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <fieldset className="pick"><legend>Бонусы (пусто = нет)</legend>{Object.entries(statNames).map(([k,v])=><label key={k}>{v} +<input type="number" min="0" max={k==='speed'?1000:1000000} value={stats[k]??''} onChange={e=>setStats(x=>({...x,[k]:e.target.value}))}/></label>)}</fieldset>
   <fieldset className="pick"><legend>Улучшение</legend><label>Сколько раз можно улучшить (0–50)<input type="number" min="0" max="50" value={upMax} onChange={e=>setUpMax(e.target.value)}/></label><label>Рост бонусов за улучшение, %<input type="number" min="0" max="100" value={upPct} onChange={e=>setUpPct(e.target.value)}/></label><label>Золото за улучшение (растёт с каждым разом)<input type="number" min="0" value={upGold} onChange={e=>setUpGold(e.target.value)}/></label></fieldset>
   <fieldset className="pick"><legend>Кому подходит (ничего не отмечено = всем)</legend>{factions.map(fa=><label key={fa.id} className="check"><input type="checkbox" checked={itemFactions.includes(fa.id)} onChange={e=>setItemFactions(x=>e.target.checked?[...x,fa.id]:x.filter(y=>y!==fa.id))}/>{fa.name}</label>)}</fieldset>
   <button type="button" onClick={applyItem}>{itemOriginal?'Применить изменения':'Добавить предмет'}</button><button type="button" className="secondary" onClick={()=>{setItemOpen(false);dirty(false);}}>Отмена</button>
  </div>}
 </section>;
}
