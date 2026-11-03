import React,{useEffect,useState} from 'react';

type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
type Actor={actor_id:string;hero_id:string;team:'attacker'|'defender';slot:number;faction_id:string;max_hp:number;hp:number;damage_dealt:number;healing_done:number;damage_taken:number};
type Preview={draft_revision:number;seed:number;result:'attacker_win'|'attacker_loss';steps:number;duration_ms:number;event_count:number;event_log_sha256:string;actors:Actor[];frames:{at_ms:number;actors:number[][]}[];events:{at_ms:number;kind:string;source_id:string;target_id:string;amount:number;ability_id?:string}[];events_truncated:boolean};
const csv=(value:string)=>value.split(',').map(x=>x.trim()).filter(Boolean);
const reasons:Record<string,string>={HERO_COMBAT_MISSING:'у героя нет боевых параметров',UNKNOWN_HERO:'герой не найден',UNKNOWN_STAGE:'этап не найден',UNKNOWN_ABILITY:'способность не найдена',UNKNOWN_FACTION:'фракция не найдена',ABILITY_COOLDOWN_TOO_LONG:'перезарядка больше 90 секунд',TOO_MANY_FACTIONS:'больше 6 фракций в одном бою',INVALID_TEAM_SIZE:'в каждой команде должно быть от 1 до 5 героев',DRAFT_CONTENT_INVALID:'черновик не проходит проверку'};
export function explainPreviewError(message:string){const [code,id]=message.split(':');const text=reasons[code];return text?`Бой не собран: ${text}${id?` (${id})`:''}.`:'Сервер отклонил запрос проверки боя.';}

export function BattlePreview({api,csrf,draftId,revision,dirty}:{api:Api;csrf:string;draftId:string;revision:number;dirty:boolean}){
 const [attackers,setAttackers]=useState(''),[mode,setMode]=useState<'heroes'|'stage'>('heroes'),[defenders,setDefenders]=useState(''),[stage,setStage]=useState(''),[seed,setSeed]=useState('1');
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false);
 useEffect(()=>{if(!playing||!preview)return;const timer=window.setInterval(()=>setFrame(f=>{if(f+1>=preview.frames.length){setPlaying(false);return f;}return f+1;}),120);return()=>window.clearInterval(timer);},[playing,preview]);
 useEffect(()=>{setPreview(null);setPlaying(false);},[draftId,revision]);
 async function run(){
  setError('');if(dirty){setError('Сначала сохрани черновик: бой проверяется на сервере по сохранённой версии.');return;}
  const seedValue=Number(seed);if(!Number.isSafeInteger(seedValue)||seedValue<0||seedValue>4294967295){setError('Seed — целое число от 0 до 4294967295.');return;}
  const body={expected_revision:revision,attacker_hero_ids:csv(attackers),seed:seedValue,...(mode==='stage'?{stage_id:stage.trim()}:{defender_hero_ids:csv(defenders)})};
  setBusy(true);setPlaying(false);
  try{const result=await api(`/drafts/${draftId}/battle-preview`,'POST',body,csrf);setPreview(result);setFrame(0);}
  catch(e){const err=e as {status?:number;detail?:string;message:string};setPreview(null);setError(err.status===409?'Черновик изменён на сервере. Открой его заново.':err.status===422?explainPreviewError(err.detail??''):err.status===400?'Проверь ID героев (1–5 на команду) и seed.':'Не удалось выполнить проверку боя.');}
  finally{setBusy(false);}
 }
 const current=preview?.frames[Math.min(frame,preview.frames.length-1)];
 return <section aria-label="Проверка боя"><h2>Проверка боя на сервере</h2>
  <p>Сервер собирает бой из сохранённого черновика и считает его тем же ядром, что и для игры. Это preview: награды и прогресс не выдаются.</p>
  <label>Атакующие: ID героев через запятую (слоты 1–2 впереди, 3–5 сзади)<input value={attackers} onChange={e=>setAttackers(e.target.value)} placeholder="hero_batyr, hero_healer" /></label>
  <label>Противник<select value={mode} onChange={e=>setMode(e.target.value as 'heroes'|'stage')}><option value="heroes">Герои/враги списком</option><option value="stage">Этап (stage) из черновика</option></select></label>
  {mode==='heroes'?<label>Защитники: ID через запятую<input value={defenders} onChange={e=>setDefenders(e.target.value)} placeholder="enemy_wolf" /></label>:<label>ID этапа<input value={stage} onChange={e=>setStage(e.target.value)} placeholder="stage_forest" /></label>}
  <label>Seed (одинаковый seed — одинаковый бой)<input type="number" min="0" value={seed} onChange={e=>setSeed(e.target.value)} /></label>
  {error&&<p role="alert">{error}</p>}
  <button type="button" onClick={run} disabled={busy}>{busy?'Считаем…':'Проверить бой'}</button>
  {preview&&current&&<div className="battle-result">
   <p role="status"><strong>{preview.result==='attacker_win'?'Победа атакующих':'Поражение атакующих'}</strong> · {(preview.duration_ms/1000).toFixed(1)} с · {preview.steps} шагов · событий {preview.event_count} · версия черновика {preview.draft_revision}</p>
   <svg className="battle-field" viewBox="0 0 10000 10000" role="img" aria-label={`Поле боя, ${(current.at_ms/1000).toFixed(1)} с`}>
    <rect x="0" y="0" width="10000" height="10000" fill="#eef1ed"/>
    {preview.actors.map((actor,i)=>{const [hp,x,y]=current.actors[i];const alive=hp>0;const color=actor.team==='attacker'?'#205d4a':'#9c3b2e';return <g key={actor.actor_id} opacity={alive?1:.3}>
     <circle cx={x} cy={y} r="330" fill={color}/>
     <rect x={x-450} y={y-640} width="900" height="110" fill="#d5ded8"/><rect x={x-450} y={y-640} width={900*hp/actor.max_hp} height="110" fill={alive?'#3a9a5b':'#888'}/>
     <text x={x} y={y+680} fontSize="300" textAnchor="middle" fill="#1d282a">{actor.actor_id}</text></g>;})}
   </svg>
   <div className="row"><button type="button" className="secondary" onClick={()=>{if(frame>=preview.frames.length-1)setFrame(0);setPlaying(p=>!p);}}>{playing?'Пауза':'Воспроизвести'}</button><span>{(current.at_ms/1000).toFixed(1)} с</span></div>
   <label>Время<input type="range" min="0" max={preview.frames.length-1} value={frame} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}} /></label>
   <table><thead><tr><th>Слот</th><th>Герой</th><th>HP</th><th>Урон</th><th>Лечение</th><th>Получено</th></tr></thead><tbody>{preview.actors.map((a,i)=><tr key={a.actor_id}><td>{a.actor_id}</td><td>{a.hero_id}</td><td>{current.actors[i][0]}/{a.max_hp}</td><td>{a.damage_dealt}</td><td>{a.healing_done}</td><td>{a.damage_taken}</td></tr>)}</tbody></table>
   <details><summary>Журнал событий{preview.events_truncated?' (первые 500)':''}</summary><ol className="battle-log">{preview.events.map((e,i)=><li key={i}>{(e.at_ms/1000).toFixed(1)} с: {e.source_id} → {e.target_id}, {e.kind==='heal'?'лечение':'урон'} {e.amount}{e.ability_id?` (${e.ability_id})`:''}</li>)}</ol></details>
   <p className="hash">Хеш журнала: <code>{preview.event_log_sha256}</code></p>
  </div>}
 </section>;
}
