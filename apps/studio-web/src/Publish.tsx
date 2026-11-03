import React,{useEffect,useRef,useState} from 'react';

type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
type Version={content_version:string;sha256:string;created_at:string;source_draft_revision:number;entity_count:number};
type Release={action:'publish'|'rollback';pointer_revision:number;reason:string;created_at:string;from_version:string|null;to_version:string};
type Journal={pointer:{content_version:string;pointer_revision:number}|null;versions:Version[];releases:Release[]};
type Preflight={ready:boolean;unchanged:boolean;problems:string[];warnings:string[];diff:{added:string[];removed:string[];changed:string[]}|null;pointer_revision:number;resource_count:number;current:Version|null};
const problemNames:Record<string,string>={CONTENT_INVALID:'черновик не проходит проверку схемы',CAPABILITY_UNSUPPORTED:'нужна возможность, которой нет в игре (нужна разработка)',RESOURCE_REF_INVALID:'ссылка на отсутствующий ресурс',RESOURCE_HASH_MISMATCH:'байты ресурса повреждены',HERO_WITHOUT_COMBAT:'герой без боевых параметров'};
const problemText=(p:string)=>{const [code,id]=p.split(':');return (problemNames[code]??code)+(id?` (${id})`:'');};
const ids=(list:string[])=>list.length?list.join(', '):'—';

export function Publish({api,csrf,draftId,revision,dirty}:{api:Api;csrf:string;draftId:string;revision:number;dirty:boolean}){
 const [journal,setJournal]=useState<Journal|null>(null),[check,setCheck]=useState<Preflight|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<{key:string;request_id:string}|null>(null);
 async function load(){try{setJournal(await api('/content/releases'));}catch{setMessage('Не удалось загрузить журнал публикаций.');}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{setCheck(null);},[draftId,revision]);
 async function preflight(){
  if(dirty){setMessage('Сначала сохрани черновик: публикуется сохранённая версия.');return;}
  setBusy(true);setMessage('');
  try{const r=await api(`/drafts/${draftId}/publish/preflight`,'POST',{expected_revision:revision},csrf);setCheck(r);setMessage(r.unchanged?'Эта версия уже опубликована.':r.ready?'Проверка пройдена. Посмотри изменения и опубликуй.':'Публикация невозможна: исправь проблемы.');}
  catch(e){setMessage((e as {status?:number}).status===409?'Черновик изменился на сервере. Открой его заново.':'Не удалось проверить черновик.');}
  finally{setBusy(false);}
 }
 async function run(path:string,body:object,key:string,confirmText:string,done:(r:any)=>string){
  if(!window.confirm(confirmText))return;
  setBusy(true);
  try{
   if(pending.current?.key!==key)pending.current={key,request_id:crypto.randomUUID()};
   const r=await api(path,'POST',{...body,request_id:pending.current.request_id},csrf);pending.current=null;setCheck(null);setMessage(done(r));await load();
  }catch(e){const err=e as {status?:number;detail?:string};pending.current=null;setMessage(err.detail==='POINTER_CHANGED'?'Опубликованная версия изменилась (другая публикация). Обнови журнал и проверь заново.':err.detail==='NO_CHANGES'?'Изменений для публикации нет.':err.status===409?'Черновик или версия изменились. Проверь заново.':'Операция не выполнена; активная версия не изменилась.');await load();}
  finally{setBusy(false);}
 }
 const publish=()=>check&&run(`/drafts/${draftId}/publish`,{expected_revision:revision,expected_pointer_revision:check.pointer_revision,reason:'Публикация из Studio'},`publish:${draftId}:${revision}:${check.pointer_revision}`,'Опубликовать черновик для игры (тестовый канал)?',r=>`Опубликована версия ${r.content_version}.`);
 const rollback=(v:string)=>journal?.pointer&&run('/content/pointer',{content_version:v,expected_pointer_revision:journal.pointer.pointer_revision,reason:'Возврат версии из Studio'},`pointer:${v}:${journal.pointer.pointer_revision}`,`Сделать активной версию ${v}? Игроки получат её при следующей загрузке.`,r=>`Активна версия ${r.content_version}.`);
 return <section aria-label="Публикация"><h2>Публикация контента</h2>
  <p>Публикация создаёт неизменяемую версию и переключает на неё игру (тестовый канал) одной операцией. Сбой не оставляет частичной версии.</p>
  <p>Сейчас в игре: <strong>{journal?.pointer?.content_version??'ничего не опубликовано'}</strong></p>
  <button type="button" onClick={preflight} disabled={busy}>Проверить перед публикацией</button>
  {message&&<p role="status">{message}</p>}
  {check&&<div className="publish-check">
   {check.problems.length>0&&<ul className="problems">{check.problems.map(p=><li key={p}>{problemText(p)}</li>)}</ul>}
   {check.diff&&<p>Добавится: {ids(check.diff.added)}<br/>Изменится: {ids(check.diff.changed)}<br/>Удалится: {ids(check.diff.removed)}<br/>Ресурсов в версии: {check.resource_count}</p>}
   {check.warnings.length>0&&<details><summary>Предупреждения ({check.warnings.length})</summary><ul>{check.warnings.map(w=><li key={w}>{problemText(w)}</li>)}</ul></details>}
   {check.ready&&<button type="button" onClick={publish} disabled={busy}>Опубликовать</button>}
  </div>}
  {journal&&journal.versions.length>0&&<details><summary>Версии и журнал ({journal.versions.length})</summary>
   <ul>{journal.versions.map(v=><li key={v.content_version}><strong>{v.content_version}</strong> · {new Date(v.created_at).toLocaleString('ru-RU')} · объектов {v.entity_count}{v.content_version===journal.pointer?.content_version?' · активна':<> <button type="button" className="link" disabled={busy} onClick={()=>void rollback(v.content_version)}>Сделать активной</button></>}</li>)}</ul>
   <h3>Журнал</h3><ol className="battle-log">{journal.releases.map(r=><li key={r.pointer_revision}>{new Date(r.created_at).toLocaleString('ru-RU')}: {r.action==='publish'?'публикация':'возврат'} {r.from_version??'—'} → {r.to_version} ({r.reason})</li>)}</ol>
  </details>}
 </section>;
}
