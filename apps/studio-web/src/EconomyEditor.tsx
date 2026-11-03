import React,{useState} from 'react';
import {listEntities,upsertEntity,deleteEntity,suggestId,defaultVip,defaultAfk,oddsPreview,type EditableEntity} from './entities.mjs';

/**
 * S25/S27/S29: VIP table (+ tutorial and free daily points), summon pools with
 * visible odds and a guarantee, AFK income. Lists and numbers only; numbers are
 * proposals and stay editable. The server computes levels, odds and income.
 */
type Row={hero_id:string;weight:string;shards:string};
const money:Record<string,string>={gold:'золото',gems:'самоцветы',hero_exp:'опыт героев',rank_material:'материалы ранга'};
const n=(v:string)=>Number(v.trim()===''?NaN:v);

export function EconomyEditor({text,onChange,onPendingChange}:{text:string;onChange:(t:string)=>void;onPendingChange:(dirty:boolean)=>void}){
 let entities:EditableEntity[]=[];try{entities=listEntities(text);}catch{/* shown elsewhere */}
 const vip=entities.find(e=>e.kind==='vip'),afk=entities.find(e=>e.kind==='afk'),pools=entities.filter(e=>e.kind==='summon_pool');
 const heroes=entities.filter(e=>e.kind==='hero'&&e.data.combat),heroName=(id:string)=>heroes.find(h=>h.id===id)?.name??id;
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 const run=(fn:()=>void,done='Готово. Изменения сохранятся автоматически.')=>{try{fn();setError('');setMessage(done);onPendingChange(false);}catch(e){setError((e as Error).message);setMessage('');}};
 const dirty=()=>onPendingChange(true);

 // VIP form
 const [vipOpen,setVipOpen]=useState(false),[levels,setLevels]=useState<{points:string;text:string;afk:string}[]>([]),[v,setV]=useState<Record<string,string>>({});
 function openVip(d:any){setLevels(d.levels.map((l:any)=>({points:String(l.points),text:l.perks_text??'',afk:String(l.afk_hours??0)})));setV({tutorial:String(d.tutorial_points),daily:String(d.daily_points),win:String(d.win_points??0),cap:String(d.win_points_daily_cap??0),x2:d.speed_x2_stages===undefined?'':String(d.speed_x2_stages),x4:d.speed_x4_level===undefined?'':String(d.speed_x4_level),inst:d.instant_level===undefined?'':String(d.instant_level)});setVipOpen(true);}
 function saveVip(){run(()=>{const data={levels:levels.map(l=>({points:n(l.points),...(l.text.trim()?{perks_text:l.text.trim()}:{}),...(n(l.afk)>0?{afk_hours:n(l.afk)}:{})})),tutorial_points:n(v.tutorial),daily_points:n(v.daily),win_points:n(v.win),win_points_daily_cap:n(v.cap),...((v.x2??'').trim()?{speed_x2_stages:n(v.x2)}:{}),...((v.x4??'').trim()?{speed_x4_level:n(v.x4)}:{}),...((v.inst??'').trim()?{instant_level:n(v.inst)}:{}),proposed:true};
  onChange(upsertEntity(text,{id:vip!.id,kind:'vip',name:vip!.name,data},vip!.id));setVipOpen(false);});}
 const perDay=vip?vip.data.daily_points+(vip.data.win_points?vip.data.win_points_daily_cap??0:0):0;
 const days=(points:number)=>perDay?Math.max(0,Math.ceil((points-(vip?.data.tutorial_points??0))/perDay)):null;

 // AFK form
 const [afkOpen,setAfkOpen]=useState(false),[a,setA]=useState<Record<string,string>>({});
 function openAfk(d:any){const by=(c:string)=>String(d.per_hour.find((x:any)=>x.currency===c)?.amount??'');setA({gold:by('gold'),hero_exp:by('hero_exp'),rank_material:by('rank_material'),bonus:String((d.stage_bonus_bp??0)/100)});setAfkOpen(true);}
 function saveAfk(){run(()=>{const per_hour=['gold','hero_exp','rank_material'].filter(c=>n(a[c]??'')>0).map(c=>({currency:c,amount:n(a[c])}));
  onChange(upsertEntity(text,{id:afk!.id,kind:'afk',name:afk!.name,data:{per_hour,stage_bonus_bp:Math.round(n(a.bonus||'0')*100),proposed:true}},afk!.id));setAfkOpen(false);});}

 // Summon pool form
 const [poolOpen,setPoolOpen]=useState(false),[poolId,setPoolId]=useState<string|null>(null),[poolName,setPoolName]=useState(''),[desc,setDesc]=useState('');
 const [cost,setCost]=useState({currency:'gems',amount:'100'}),[rows,setRows]=useState<Row[]>([]),[every,setEvery]=useState(''),[gHeroes,setGHeroes]=useState<string[]>([]),[perHero,setPerHero]=useState('');
 function newPool(){setPoolId(null);setPoolName('Призыв героев');setDesc('');setCost({currency:'gems',amount:'100'});setRows(heroes.map(h=>({hero_id:h.id,weight:'10',shards:''})));setEvery('10');setGHeroes(heroes.slice(0,1).map(h=>h.id));setPerHero('');setPoolOpen(true);}
 function editPool(p:EditableEntity){setPoolId(p.id);setPoolName(p.name);setDesc(p.data.description??'');setCost({currency:p.data.cost.currency,amount:String(p.data.cost.amount)});
  setRows(p.data.entries.map((x:any)=>({hero_id:x.hero_id,weight:String(x.weight),shards:x.shards?String(x.shards):''})));setEvery(p.data.guarantee?String(p.data.guarantee.every):'');setGHeroes(p.data.guarantee?.hero_ids??[]);setPerHero(p.data.shards_per_hero?String(p.data.shards_per_hero):'');setPoolOpen(true);}
 function savePool(){run(()=>{if(!poolName.trim())throw new Error('Введи название призыва.');
  const entries=rows.filter(r=>n(r.weight)>0).map(r=>({hero_id:r.hero_id,weight:n(r.weight),...(n(r.shards||'0')>0?{shards:n(r.shards)}:{})}));
  const data={cost:{currency:cost.currency,amount:n(cost.amount)},entries,...(every.trim()&&gHeroes.length?{guarantee:{every:n(every),hero_ids:gHeroes}}:{}),...(perHero.trim()?{shards_per_hero:n(perHero)}:{}),...(desc.trim()?{description:desc.trim()}:{}),proposed:true};
  const id=poolId??suggestId(poolName,'pool',entities.map(e=>e.id));onChange(upsertEntity(text,{id,kind:'summon_pool',name:poolName.trim(),data},poolId));setPoolOpen(false);});}
 const odds=oddsPreview(rows.map(r=>({weight:n(r.weight)>0?r.weight:'0'})));

 return <section aria-label="Экономика"><h2>VIP, призыв и AFK-награды</h2>
  <ol className="steps"><li>Создай таблицу VIP и AFK кнопками — значения предлагаемые, их можно менять.</li><li>Добавь призыв: отметь героев, задай шансы и гарантию.</li><li>Сохрани черновик и опубликуй.</li></ol>
  {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert">{error}</p>}

  <h3>VIP и обучение</h3>
  {!vip?<button type="button" onClick={()=>run(()=>onChange(upsertEntity(text,{id:'vip_main',kind:'vip',name:'VIP',data:defaultVip()})),'Таблица VIP создана с предлагаемыми значениями.')}>Создать таблицу VIP</button>:<div className="growth-summary">
   <p>За обучение: {vip.data.tutorial_points} очков (хватает на VIP 1). Бесплатно в день: {vip.data.daily_points} очков + до {vip.data.win_points_daily_cap??0} за победы ({vip.data.win_points??0} за бой).</p>
   <p>Скорость боя: ×1 сразу{vip.data.speed_x2_stages!==undefined?`, ×2 после ${vip.data.speed_x2_stages} этапов`:''}{vip.data.speed_x4_level!==undefined?`, ×4 с VIP ${vip.data.speed_x4_level}`:''}{vip.data.instant_level!==undefined?`, быстрый расчёт повторов с VIP ${vip.data.instant_level}`:''}.</p>
   <p>Уровни: {vip.data.levels.map((l:any,i:number)=>`VIP ${i+1} — ${l.points} оч. (~${days(l.points)} дн. бесплатно)`).join('; ')}.</p>
   {!vipOpen&&<button type="button" onClick={()=>openVip(vip.data)}>Изменить VIP</button>}</div>}
  {vip&&vipOpen&&<div className="growth-form" onChange={dirty}>
   {levels.map((l,i)=><div key={i} className="rank-row"><strong>VIP {i+1}</strong>
    <label>Порог очков<input type="number" min="1" aria-label={`Порог очков VIP ${i+1}`} value={l.points} onChange={e=>setLevels(x=>x.map((y,j)=>j===i?{...y,points:e.target.value}:y))}/></label>
    <label>Доп. часы AFK<input type="number" min="0" max="12" aria-label={`Доп. часы AFK VIP ${i+1}`} value={l.afk} onChange={e=>setLevels(x=>x.map((y,j)=>j===i?{...y,afk:e.target.value}:y))}/></label>
    <label style={{gridColumn:'1/-1'}}>Привилегии (текст для игрока)<input maxLength={200} aria-label={`Привилегии VIP ${i+1}`} value={l.text} onChange={e=>setLevels(x=>x.map((y,j)=>j===i?{...y,text:e.target.value}:y))}/></label>
    {i>0&&<button type="button" className="secondary" onClick={()=>setLevels(x=>x.filter((_,j)=>j!==i))}>Убрать VIP {i+1}</button>}</div>)}
   {levels.length<20&&<button type="button" className="secondary" onClick={()=>setLevels(x=>[...x,{points:String(n(x[x.length-1]?.points??'0')*2||100),text:'',afk:'0'}])}>Добавить уровень VIP</button>}
   {[['tutorial','Очков за обучение (один раз)'],['daily','Бесплатных очков в день'],['win','Очков за победу в бою'],['cap','Предел очков за победы в день'],['x2','Скорость боя ×2 после стольких пройденных этапов (пусто = только ×1)'],['x4','Скорость ×4 с уровня VIP'],['inst','Быстрый расчёт повторов с уровня VIP']].map(([k,label])=><label key={k}>{label}<input type="number" min="0" value={v[k]??''} onChange={e=>setV(x=>({...x,[k]:e.target.value}))}/></label>)}
   <p className="hint">Обучение: первая победа в кампании, повышение уровня героя, предмет на герое. Уровень VIP считает сервер по сумме очков; игра не может назначить VIP сама.</p>
   <button type="button" onClick={saveVip}>Применить VIP</button><button type="button" className="secondary" onClick={()=>setVipOpen(false)}>Отмена</button></div>}

  <h3>Призыв героев</h3>
  {heroes.length===0&&<p className="hint">Нужны герои с боевыми параметрами.</p>}
  <ul className="entity-list">{pools.map(p=><li key={p.id}><span><strong>{p.name}</strong> · {p.data.cost.amount} {money[p.data.cost.currency]}{p.data.guarantee?` · гарантия раз в ${p.data.guarantee.every}`:''}</span><button type="button" className="link" aria-label={`Изменить ${p.id}`} onClick={()=>editPool(p)}>Изменить</button><button type="button" className="link" aria-label={`Удалить ${p.id}`} onClick={()=>{if(window.confirm(`Удалить «${p.name}»?`))run(()=>onChange(deleteEntity(text,p.id)));}}>Удалить</button></li>)}</ul>
  {!poolOpen?heroes.length>0&&<button type="button" onClick={newPool}>Добавить призыв</button>:<div className="growth-form" onChange={dirty}>
   <label>Название призыва<input value={poolName} maxLength={100} onChange={e=>setPoolName(e.target.value)}/></label>
   <label>Описание для игрока<input value={desc} maxLength={300} onChange={e=>setDesc(e.target.value)}/></label>
   <label>Валюта цены<select value={cost.currency} onChange={e=>setCost(c=>({...c,currency:e.target.value}))}><option value="gems">Самоцветы</option><option value="gold">Золото</option></select></label>
   <label>Цена одной попытки<input type="number" min="1" value={cost.amount} onChange={e=>setCost(c=>({...c,amount:e.target.value}))}/></label>
   <fieldset className="pick"><legend>Варианты и шансы (вес 0 = не участвует)</legend>
    {rows.map((r,i)=><div key={i} className="extra-row"><span>{heroName(r.hero_id)}{r.shards?' (осколки)':''}</span>
     <input type="number" min="0" aria-label={`Вес ${heroName(r.hero_id)}${r.shards?' осколки':''}`} value={r.weight} onChange={e=>setRows(x=>x.map((y,j)=>j===i?{...y,weight:e.target.value}:y))}/>
     <span>шанс {odds[i]}%</span>
     <input type="number" min="0" aria-label={`Осколков ${heroName(r.hero_id)}`} placeholder="осколки" value={r.shards} onChange={e=>setRows(x=>x.map((y,j)=>j===i?{...y,shards:e.target.value}:y))}/></div>)}
    <label>Добавить вариант<select value="" onChange={e=>{const id=e.target.value;if(id)setRows(x=>[...x,{hero_id:id,weight:'10',shards:'5'}]);}}><option value="">— выбери героя (осколки) —</option>{heroes.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    <p className="hint">Шанс = вес ÷ сумма весов; игрок видит эти проценты. Если указаны осколки, вместо героя выпадают осколки.</p></fieldset>
   <fieldset className="pick"><legend>Гарантия</legend><label>Раз в сколько попыток (пусто = без гарантии)<input type="number" min="2" max="1000" value={every} onChange={e=>setEvery(e.target.value)}/></label>
    {rows.filter(r=>!r.shards).map(r=><label key={r.hero_id} className="check"><input type="checkbox" checked={gHeroes.includes(r.hero_id)} onChange={e=>setGHeroes(x=>e.target.checked?[...x,r.hero_id]:x.filter(y=>y!==r.hero_id))}/>Гарантированный: {heroName(r.hero_id)}</label>)}
    <p className="hint">Если столько попыток подряд не дали отмеченного героя, следующая даст его. Счётчик игрока не сбрасывается при обновлении мира.</p></fieldset>
   <label>Осколков, чтобы собрать героя<input type="number" min="1" max="1000" value={perHero} onChange={e=>setPerHero(e.target.value)} placeholder="например 50"/></label>
   <button type="button" onClick={savePool}>{poolId?'Применить призыв':'Добавить этот призыв'}</button><button type="button" className="secondary" onClick={()=>setPoolOpen(false)}>Отмена</button></div>}

  <h3>AFK-награды</h3>
  {!afk?<button type="button" onClick={()=>run(()=>onChange(upsertEntity(text,{id:'afk_main',kind:'afk',name:'AFK-награды',data:defaultAfk()})),'Таблица AFK создана с предлагаемыми значениями.')}>Создать AFK-награды</button>:<div className="growth-summary">
   <p>В час: {afk.data.per_hour.map((x:any)=>`${x.amount} ${money[x.currency]}`).join(', ')}; +{(afk.data.stage_bonus_bp??0)/100}% за каждый пройденный этап. Копится до 12 часов (VIP добавляет часы).</p>
   {!afkOpen&&<button type="button" onClick={()=>openAfk(afk.data)}>Изменить AFK</button>}</div>}
  {afk&&afkOpen&&<div className="growth-form" onChange={dirty}>
   {[['gold','Золото в час'],['hero_exp','Опыт героев в час'],['rank_material','Материалы ранга в час'],['bonus','Прибавка за пройденный этап, %']].map(([k,label])=><label key={k}>{label}<input type="number" min="0" value={a[k]??''} onChange={e=>setA(x=>({...x,[k]:e.target.value}))}/></label>)}
   <button type="button" onClick={saveAfk}>Применить AFK</button><button type="button" className="secondary" onClick={()=>setAfkOpen(false)}>Отмена</button></div>}
 </section>;
}
