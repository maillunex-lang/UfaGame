import React,{useState} from 'react';
import {listEntities,upsertEntity,deleteEntity,suggestId,questEvents,type EditableEntity} from './entities.mjs';

/**
 * S30: quests and achievements. The owner picks a server event from the list, an
 * optional stage, the target count, rewards and an optional previous quest (series).
 * The server counts events and decides when a reward can be taken.
 */
const money:[string,string][]=[['gold','Золото'],['gems','Самоцветы'],['hero_exp','Опыт героев'],['rank_material','Материалы ранга'],['vip_points','Очки VIP']];
const n=(v:string)=>Number(v.trim()===''?NaN:v);

export function QuestEditor({text,onChange,onPendingChange}:{text:string;onChange:(t:string)=>void;onPendingChange:(dirty:boolean)=>void}){
 let entities:EditableEntity[]=[];try{entities=listEntities(text);}catch{/* shown elsewhere */}
 const quests=entities.filter(e=>e.kind==='quest').sort((a,b)=>(a.data.order??0)-(b.data.order??0)),stages=entities.filter(e=>e.kind==='stage'),heroes=entities.filter(e=>e.kind==='hero'&&e.data.combat);
 const chapterStages=new Set(entities.filter(e=>e.kind==='chapter').flatMap(c=>c.data.stage_ids));
 const [open,setOpen]=useState(false),[orig,setOrig]=useState<string|null>(null),[name,setName]=useState(''),[desc,setDesc]=useState('');
 const [period,setPeriod]=useState('daily'),[event,setEvent]=useState('battle_win'),[stage,setStage]=useState(''),[target,setTarget]=useState('3');
 const [rewards,setRewards]=useState<Record<string,string>>({}),[rHeroes,setRHeroes]=useState<string[]>([]),[requires,setRequires]=useState('');
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 function start(q?:EditableEntity){
  setOrig(q?.id??null);setName(q?.name??'');setDesc(q?.data.description??'');setPeriod(q?.data.period??'daily');setEvent(q?.data.event??'battle_win');setStage(q?.data.stage_id??'');setTarget(String(q?.data.target??3));
  setRewards(Object.fromEntries((q?.data.rewards??[{currency:'gold',amount:200}]).map((r:any)=>[r.currency,String(r.amount)])));setRHeroes(q?.data.reward_heroes??[]);setRequires(q?.data.requires_quest_id??'');setOpen(true);setError('');setMessage('');
 }
 function save(){try{
  if(!name.trim())throw new Error('Введи название задания.');
  const rw=money.filter(([c])=>n(rewards[c]??'')>0).map(([c])=>({currency:c,amount:n(rewards[c])}));
  const id=orig??suggestId(name,'quest',entities.map(e=>e.id));
  const data={period,event,target:event==='campaign_clear'&&stage?1:n(target),rewards:rw,...(stage&&['battle_win','campaign_clear'].includes(event)?{stage_id:stage}:{}),...(rHeroes.length?{reward_heroes:rHeroes}:{}),...(requires?{requires_quest_id:requires}:{}),...(desc.trim()?{description:desc.trim()}:{}),order:orig?entities.find(e=>e.id===orig)?.data.order??quests.length:quests.length,proposed:true};
  onChange(upsertEntity(text,{id,kind:'quest',name:name.trim(),data},orig));setOpen(false);onPendingChange(false);setError('');setMessage('Готово. Изменения сохранятся автоматически.');
 }catch(e){setError((e as Error).message);}}
 const stageChoices=stages.filter(s=>event!=='campaign_clear'||chapterStages.has(s.id));
 const describe=(q:EditableEntity)=>`${q.data.period==='daily'?'ежедневное':'достижение'} · ${questEvents[q.data.event]} ×${q.data.target}${q.data.requires_quest_id?' · после «'+(quests.find(x=>x.id===q.data.requires_quest_id)?.name??'')+'»':''}`;
 return <section aria-label="Задания"><h2>Задания и достижения</h2>
  <p className="hint">Сервер сам считает события (победы, прохождения, призыв…) и даёт награду, когда цель выполнена. Ежедневные задания обнуляются в полночь по Уфе.</p>
  {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert">{error}</p>}
  <ul className="entity-list">{quests.map(q=><li key={q.id}><span><strong>{q.name}</strong> · {describe(q)}</span><button type="button" className="link" aria-label={`Изменить ${q.id}`} onClick={()=>start(q)}>Изменить</button><button type="button" className="link" aria-label={`Удалить ${q.id}`} onClick={()=>{if(window.confirm(`Удалить «${q.name}»?`))try{onChange(deleteEntity(text,q.id));setError('');}catch(e){setError((e as Error).message);}}}>Удалить</button></li>)}</ul>
  {!open?<button type="button" onClick={()=>start()}>Добавить задание</button>:<div className="growth-form" onChange={()=>onPendingChange(true)}>
   <label>Название задания<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="Например: Три победы за день"/></label>
   <label>Описание для игрока<input value={desc} maxLength={300} onChange={e=>setDesc(e.target.value)}/></label>
   <label>Вид<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="daily">Ежедневное (обнуляется каждый день)</option><option value="once">Достижение (один раз)</option></select></label>
   <label>Что нужно сделать<select value={event} onChange={e=>{setEvent(e.target.value);setStage('');}}>{Object.entries(questEvents).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   {['battle_win','campaign_clear'].includes(event)&&<label>Этап (пусто = любой)<select value={stage} onChange={e=>setStage(e.target.value)}><option value="">— любой —</option>{stageChoices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
   <label>Сколько раз<input type="number" min="1" max="10000" value={event==='campaign_clear'&&stage?'1':target} disabled={event==='campaign_clear'&&!!stage} onChange={e=>setTarget(e.target.value)}/></label>{event==='campaign_clear'&&<p className="hint">Этап кампании проходится впервые один раз; без выбранного этапа считается число разных пройденных этапов.</p>}
   <fieldset className="pick"><legend>Награда</legend>{money.map(([c,label])=><label key={c}>{label}<input type="number" min="0" value={rewards[c]??''} onChange={e=>setRewards(x=>({...x,[c]:e.target.value}))}/></label>)}
    {heroes.map(h=><label key={h.id} className="check"><input type="checkbox" checked={rHeroes.includes(h.id)} disabled={!rHeroes.includes(h.id)&&rHeroes.length>=3} onChange={e=>setRHeroes(x=>e.target.checked?[...x,h.id]:x.filter(y=>y!==h.id))}/>Герой в награду: {h.name}</label>)}</fieldset>
   <label>Открывается после задания (серия)<select value={requires} onChange={e=>setRequires(e.target.value)}><option value="">— сразу доступно —</option>{quests.filter(q=>q.id!==orig).map(q=><option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
   <button type="button" onClick={save}>{orig?'Применить задание':'Добавить это задание'}</button><button type="button" className="secondary" onClick={()=>{setOpen(false);onPendingChange(false);}}>Отмена</button></div>}
 </section>;
}
