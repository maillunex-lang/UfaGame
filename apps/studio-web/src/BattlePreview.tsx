import React,{useEffect,useState} from 'react';

type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
type Actor={actor_id:string;hero_id:string;team:'attacker'|'defender';slot:number;faction_id:string;max_hp:number;hp:number;damage_dealt:number;healing_done:number;damage_taken:number};
type Preview={draft_revision:number;seed:number;result:'attacker_win'|'attacker_loss';steps:number;duration_ms:number;event_count:number;event_log_sha256:string;actors:Actor[];frames:{at_ms:number;actors:number[][]}[];events:{at_ms:number;kind:string;source_id:string;target_id:string;amount:number;ability_id?:string}[];events_truncated:boolean};
type Sprite={id:string;width:number;height:number;frames:{x:number;y:number;width:number;height:number;duration_ms:number}[];loop:boolean};
/** Frame of a sprite animation at a moment of the replay (loops or stops on the last frame). */
export function spriteFrame(sprite:Sprite,atMs:number){const total=sprite.frames.reduce((s,f)=>s+f.duration_ms,0);let t=sprite.loop?atMs%total:Math.min(atMs,total-1);for(const f of sprite.frames){if(t<f.duration_ms)return f;t-=f.duration_ms;}return sprite.frames[sprite.frames.length-1];}
const reasons:Record<string,string>={HERO_COMBAT_MISSING:'у героя нет боевых параметров',UNKNOWN_HERO:'герой не найден',UNKNOWN_STAGE:'этап не найден',UNKNOWN_ABILITY:'способность не найдена',UNKNOWN_FACTION:'фракция не найдена',ABILITY_COOLDOWN_TOO_LONG:'перезарядка больше 90 секунд',TOO_MANY_FACTIONS:'больше 6 фракций в одном бою',INVALID_TEAM_SIZE:'в каждой команде должно быть от 1 до 5 героев',DRAFT_CONTENT_INVALID:'черновик не проходит проверку'};
export function explainPreviewError(message:string){const [code,id]=message.split(':');const text=reasons[code];return text?`Бой не собран: ${text}${id?` (${id})`:''}.`:'Сервер отклонил запрос проверки боя.';}

export function BattlePreview({api,csrf,draftId,revision,dirty,content}:{api:Api;csrf:string;draftId:string;revision:number;dirty:boolean;content:unknown}){
 const [attackers,setAttackers]=useState<string[]>([]),[mode,setMode]=useState<'heroes'|'stage'>('heroes'),[defenders,setDefenders]=useState<string[]>([]),[stage,setStage]=useState(''),[seed,setSeed]=useState('1');
 const all=((content as {entities?:{id:string;kind:string;name:string;data?:{combat?:unknown}}[]})?.entities??[]);
 const heroes=all.filter(e=>e.kind==='hero'),stages=all.filter(e=>e.kind==='stage');
 const pick=(list:string[],set:(v:string[])=>void,id:string,on:boolean)=>set(on?(list.length<5?[...list,id]:list):list.filter(x=>x!==id));
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[sprites,setSprites]=useState<Record<string,Sprite>>({});
 useEffect(()=>{if(!playing||!preview)return;const timer=window.setInterval(()=>setFrame(f=>{if(f+1>=preview.frames.length){setPlaying(false);return f;}return f+1;}),120);return()=>window.clearInterval(timer);},[playing,preview]);
 useEffect(()=>{setPreview(null);setPlaying(false);},[draftId,revision]);
 async function run(){
  setError('');if(dirty){setError('Сначала сохрани черновик: бой проверяется на сервере по сохранённой версии.');return;}
  const seedValue=Number(seed);if(!Number.isSafeInteger(seedValue)||seedValue<0||seedValue>4294967295){setError('Seed — целое число от 0 до 4294967295.');return;}
  if(!attackers.length||(mode==='heroes'?!defenders.length:!stage)){setError('Отметь героев с обеих сторон (до 5 на сторону).');return;}
  const body={expected_revision:revision,attacker_hero_ids:attackers,seed:seedValue,...(mode==='stage'?{stage_id:stage}:{defender_hero_ids:defenders})};
  setBusy(true);setPlaying(false);
  try{const result=await api(`/drafts/${draftId}/battle-preview`,'POST',body,csrf);
   const heroes=new Map(((content as {entities?:any[]})?.entities??[]).filter(e=>e?.kind==='hero'&&typeof e.data?.sprite_resource_id==='string').map(e=>[e.id,e.data.sprite_resource_id]));
   let found:Record<string,Sprite>={};if(heroes.size){try{const list:(Sprite&{media_type:string})[]=(await api('/resources')).resources;found=Object.fromEntries([...heroes].flatMap(([hero,res])=>{const r=list.find(x=>x.id===res&&x.media_type==='image/png');return r?[[hero,r]]:[];}));}catch{/* Sprites are optional: show circles. */}}
   setSprites(found);setPreview(result);setFrame(0);}
  catch(e){const err=e as {status?:number;detail?:string;message:string};setPreview(null);setError(err.status===409?'Черновик изменён на сервере. Открой его заново.':err.status===422?explainPreviewError(err.detail??''):err.status===400?'Проверь ID героев (1–5 на команду) и seed.':'Не удалось выполнить проверку боя.');}
  finally{setBusy(false);}
 }
 const current=preview?.frames[Math.min(frame,preview.frames.length-1)];
 return <section aria-label="Проверка боя"><h2>Проверка боя на сервере</h2>
  <p>Сервер собирает бой из сохранённого черновика и считает его тем же ядром, что и для игры. Это preview: награды и прогресс не выдаются.</p>
  {heroes.length===0&&<p className="hint">В сохранённом черновике нет героев. Создай героя и подожди автосохранения.</p>}
  <fieldset className="pick"><legend>Твоя команда (первые два — впереди, остальные — сзади)</legend>{heroes.map(h=><label key={h.id} className="check"><input type="checkbox" checked={attackers.includes(h.id)} onChange={e=>pick(attackers,setAttackers,h.id,e.target.checked)}/>{h.name}{h.data?.combat?'':' (нет боевых параметров)'}</label>)}</fieldset>
  <label>Против кого<select value={mode} onChange={e=>setMode(e.target.value as 'heroes'|'stage')}><option value="heroes">Герои/враги списком</option><option value="stage">Этап (stage) из черновика</option></select></label>
  {mode==='heroes'?<fieldset className="pick"><legend>Противники</legend>{heroes.map(h=><label key={h.id} className="check"><input type="checkbox" checked={defenders.includes(h.id)} onChange={e=>pick(defenders,setDefenders,h.id,e.target.checked)}/>{h.name}</label>)}</fieldset>:<label>Этап<select value={stage} onChange={e=>setStage(e.target.value)}><option value="">— выбери —</option>{stages.map(st=><option key={st.id} value={st.id}>{st.name}</option>)}</select></label>}
  <label>Seed (одинаковый seed — одинаковый бой)<input type="number" min="0" value={seed} onChange={e=>setSeed(e.target.value)} /></label>
  {error&&<p role="alert">{error}</p>}
  <button type="button" onClick={run} disabled={busy}>{busy?'Считаем…':'Проверить бой'}</button>
  {preview&&current&&<div className="battle-result">
   <p role="status"><strong>{preview.result==='attacker_win'?'Победа атакующих':'Поражение атакующих'}</strong> · {(preview.duration_ms/1000).toFixed(1)} с · {preview.steps} шагов · событий {preview.event_count} · версия черновика {preview.draft_revision}</p>
   <svg className="battle-field" viewBox="0 0 10000 10000" role="img" aria-label={`Поле боя, ${(current.at_ms/1000).toFixed(1)} с`}>
    <rect x="0" y="0" width="10000" height="10000" fill="#eef1ed"/>
    {preview.actors.map((actor,i)=>{const [hp,x,y]=current.actors[i];const alive=hp>0;const color=actor.team==='attacker'?'#205d4a':'#9c3b2e';return <g key={actor.actor_id} opacity={alive?1:.3}>
     {sprites[actor.hero_id]?(()=>{const s=sprites[actor.hero_id],f=spriteFrame(s,current.at_ms);return <><circle cx={x} cy={y} r="430" fill="none" stroke={color} strokeWidth="60"/><svg x={x-400} y={y-400} width="800" height="800" viewBox={`${f.x} ${f.y} ${f.width} ${f.height}`} preserveAspectRatio="xMidYMid meet" aria-label={'Спрайт '+actor.hero_id}><image href={'/game/server/admin/v1/resources/'+encodeURIComponent(s.id)+'/data'} width={s.width} height={s.height} style={{imageRendering:'pixelated'}} transform={actor.team==='defender'?`translate(${2*f.x+f.width} 0) scale(-1 1)`:undefined}/></svg></>;})():<circle cx={x} cy={y} r="330" fill={color}/>}
     <rect x={x-450} y={y-640} width="900" height="110" fill="#d5ded8"/><rect x={x-450} y={y-640} width={900*hp/actor.max_hp} height="110" fill={alive?'#3a9a5b':'#888'}/>
     <text x={x} y={y+680} fontSize="300" textAnchor="middle" fill="#1d282a">{actor.actor_id}</text></g>;})}
   </svg>
   <div className="row"><button type="button" className="secondary" onClick={()=>{if(frame>=preview.frames.length-1)setFrame(0);setPlaying(p=>!p);}}>{playing?'Пауза':'Воспроизвести'}</button><span>{(current.at_ms/1000).toFixed(1)} с</span></div>
   <label>Время<input type="range" min="0" max={preview.frames.length-1} value={frame} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}} /></label>
   <table><thead><tr><th>Слот</th><th>Герой</th><th>HP</th><th>Урон</th><th>Лечение</th><th>Получено</th></tr></thead><tbody>{preview.actors.map((a,i)=><tr key={a.actor_id}><td>{a.actor_id}</td><td>{a.hero_id}</td><td>{current.actors[i][0]}/{a.max_hp}</td><td>{a.damage_dealt}</td><td>{a.healing_done}</td><td>{a.damage_taken}</td></tr>)}</tbody></table>
   <details><summary>Журнал событий{preview.events_truncated?' (первые 500)':''}</summary><ol className="battle-log">{preview.events.map((e,i)=><li key={i}>{(e.at_ms/1000).toFixed(1)} с: {e.source_id} → {e.target_id}, {e.kind==='heal'?`лечение ${e.amount}`:e.kind==='stun'?`оглушение на ${(e.amount/10).toFixed(1)} с`:e.kind==='knockback'?`отбрасывание на ${e.amount}`:`урон ${e.amount}`}{e.ability_id?` (${e.ability_id})`:''}</li>)}</ol></details>
   <p className="hash">Хеш журнала: <code>{preview.event_log_sha256}</code></p>
  </div>}
 </section>;
}
