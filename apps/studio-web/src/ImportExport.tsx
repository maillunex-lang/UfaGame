import React,{useRef,useState} from 'react';

type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
type Diff={path:string;before:unknown;after:unknown};
type Item={key:string;op:string;entity_type?:string;id?:string;status:string;conflict?:string;resolution?:string|null;diff?:Diff[];base_content_version?:string;draft_content_version?:string;media_type?:string};
type Report={package_id:string;package_version:string;base_content_version:string;draft_content_version:string;items:Item[];unresolved:number};
type Draft={id:string;revision:number;name:string;content:unknown};
const statusText:Record<string,string>={create:'будет создан',replace:'будет заменён',delete:'будет удалён',unchanged:'без изменений',conflict:'конфликт'};
const conflictText:Record<string,string>={BASE_MISMATCH:'пакет сделан для другой версии черновика',ENTITY_EXISTS:'объект уже есть и отличается',ENTITY_STALE:'объект изменён после создания пакета',ENTITY_MISSING:'заменяемого объекта нет',RESOURCE_EXISTS:'ресурс с таким ID уже есть и отличается'};
const errorText:Record<string,string>={ARCHIVE_INVALID:'файл не является корректным ZIP',MISSING_FILE:'в пакете нет файла',HASH_MISMATCH:'файл повреждён (хеш не совпал)',SIZE_MISMATCH:'размер файла не совпал с manifest',UNLISTED_FILE:'в пакете есть неописанный файл',UNUSED_FILE:'в пакете есть неиспользуемый файл',SCHEMA_INVALID:'файл не соответствует схеме',JSON_INVALID:'ошибка JSON',UNSUPPORTED_CAPABILITY:'пакету нужна неподдерживаемая возможность (нужна разработка)',IDENTITY_MISMATCH:'ID или тип в файле не совпадает с операцией',DUPLICATE_OPERATION:'повторная операция для одного объекта',RESOURCE_INVALID:'ресурс не прошёл проверку',REFERENCE_MISSING:'после импорта останется ссылка на отсутствующий объект',RESOURCE_REF_INVALID:'ссылка на отсутствующий ресурс или ресурс другого типа',KIND_CONFLICT:'ID занят объектом другого типа',RESOURCE_IMMUTABLE:'ресурс нельзя заменить — дай новому ресурсу другой ID',IMPORT_CANCELLED_BASE:'импорт отменён из-за другой базовой версии',DEPENDENCIES_UNSUPPORTED:'зависимости пакетов пока не поддерживаются',RESULT_INVALID:'итоговый черновик не проходит проверку',IMPORT_CONFLICTS_UNRESOLVED:'остались нерешённые конфликты',RESOURCE_QUOTA:'превышен лимит ресурсов'};
export function explainImportError(detail?:string){if(!detail)return 'Сервер отклонил пакет.';const [code,...rest]=detail.split(':');return `Пакет отклонён: ${errorText[code]??code}${rest.length?` (${rest.join(':')})`:''}.`;}
const fileBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('read'));r.onload=()=>{const v=String(r.result);resolve(v.slice(v.indexOf(',')+1));};r.readAsDataURL(file);});
const show=(v:unknown)=>v===null||v===undefined?'—':typeof v==='string'?v:JSON.stringify(v);

export function ImportExport({api,csrf,draftId,revision,dirty,entities,onApplied}:{api:Api;csrf:string;draftId:string;revision:number;dirty:boolean;entities:{id:string;kind:string;name:string}[];onApplied:(draft:Draft)=>void}){
 const [selected,setSelected]=useState<string[]>([]),[zip,setZip]=useState<string|null>(null),[fileName,setFileName]=useState('');
 const [report,setReport]=useState<Report|null>(null),[resolutions,setResolutions]=useState<Record<string,'package'|'draft'>>({});
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const input=useRef<HTMLInputElement>(null),pending=useRef<{fingerprint:string;request_id:string}|null>(null);
 const exportUrl=`/game/server/admin/v1/drafts/${draftId}/export${selected.length?`?ids=${selected.join(',')}`:''}`;
 function cancel(){setZip(null);setFileName('');setReport(null);setResolutions({});pending.current=null;if(input.current)input.current.value='';setMessage('Импорт отменён, черновик не изменён.');}
 async function choose(file:File|undefined){
  setReport(null);setResolutions({});setMessage('');pending.current=null;
  if(!file){setZip(null);return;}
  if(file.size===0||file.size>8*1024*1024){setZip(null);setMessage('ZIP должен быть не больше 8 МиБ.');return;}
  try{setZip(await fileBase64(file));setFileName(file.name);}catch{setMessage('Не удалось прочитать файл.');}
 }
 async function preflight(){
  if(dirty){setMessage('Сначала сохрани черновик: импорт проверяется по сохранённой версии.');return;}
  if(!zip){setMessage('Выбери ZIP-пакет.');return;}
  setBusy(true);setMessage('');
  try{const r=await api(`/drafts/${draftId}/import/preflight`,'POST',{expected_revision:revision,zip_base64:zip,resolutions},csrf);setReport(r.report);setMessage(r.ready?'Пакет проверен. Посмотри изменения и примени.':'Есть конфликты: выбери решение для каждого.');}
  catch(e){const err=e as {status?:number;detail?:string};setReport(null);setMessage(err.status===409?'Черновик изменился на сервере. Открой его заново.':err.status===422?explainImportError(err.detail):'Не удалось проверить пакет.');}
  finally{setBusy(false);}
 }
 async function apply(){
  if(!zip||!report)return;
  const missing=report.items.filter(i=>i.status==='conflict'&&!resolutions[i.key as keyof typeof resolutions]);
  if(missing.length){setMessage('Выбери решение для всех конфликтов.');return;}
  setBusy(true);
  try{
   const fingerprint=JSON.stringify([draftId,revision,zip.length,zip.slice(0,64),resolutions]);
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,request_id:crypto.randomUUID()};
   const r=await api(`/drafts/${draftId}/import/apply`,'POST',{expected_revision:revision,zip_base64:zip,resolutions,reason:`Импорт пакета ${report.package_id} ${report.package_version}`,request_id:pending.current.request_id},csrf);
   pending.current=null;setZip(null);setFileName('');setReport(null);setResolutions({});if(input.current)input.current.value='';
   onApplied(r.draft);setMessage(`Импорт применён: версия черновика ${r.draft.revision}. Новых ресурсов: ${r.created_resources.length}. Публикации не было.`);
  }catch(e){const err=e as {status?:number;detail?:string};setMessage(err.status===409?(err.detail==='IMPORT_CONFLICTS_UNRESOLVED'?'Появились новые конфликты — проверь пакет ещё раз.':'Черновик изменился на сервере: проверь пакет заново.'):err.status===422?explainImportError(err.detail):'Импорт не применён. Черновик не изменён.');}
  finally{setBusy(false);}
 }
 const conflicts=report?.items.filter(i=>i.status==='conflict')??[];
 return <section aria-label="Импорт и экспорт"><h2>Импорт и экспорт ZIP</h2>
  <h3>Экспорт</h3><p>Без выбора выгружается весь черновик. При выборе объектов в пакет попадут и все их зависимости (фракции, способности, ресурсы).</p>
  {entities.length>0&&<div className="pick-list">{entities.map(e=><label key={e.id} className="check"><input type="checkbox" checked={selected.includes(e.id)} onChange={ev=>setSelected(s=>ev.target.checked?[...s,e.id]:s.filter(x=>x!==e.id))}/>{e.name} <small>({e.id})</small></label>)}</div>}
  {dirty?<p>Сохрани черновик перед экспортом: выгружается сохранённая версия.</p>:<a className="button" href={exportUrl} download>{selected.length?`Скачать выбранное (${selected.length})`:'Скачать весь черновик'}</a>}
  <h3>Импорт</h3><p>Пакет проверяется сервером в карантине: ничего не меняется, пока ты не нажмёшь «Применить». Импорт не публикует контент.</p>
  <label>ZIP-пакет<input ref={input} type="file" accept="application/zip,.zip" onChange={e=>void choose(e.target.files?.[0])}/></label>
  <div className="row"><button type="button" onClick={preflight} disabled={busy||!zip}>Проверить пакет</button>{(zip||report)&&<button type="button" className="secondary" onClick={cancel} disabled={busy}>Отменить</button>}</div>
  {message&&<p role="status">{message}</p>}
  {report&&<div className="import-report">
   <p>Пакет <strong>{report.package_id}</strong> {report.package_version} из «{fileName}», база {report.base_content_version}, черновик {report.draft_content_version}.</p>
   <ul>{report.items.map(item=><li key={item.key} className={item.status==='conflict'?'conflict':''}>
    <strong>{item.key==='base'?'Версия черновика':`${item.entity_type} ${item.id}`}</strong> — {item.op!=='base'&&`${item.op}, `}{statusText[item.status]??item.status}{item.conflict&&`: ${conflictText[item.conflict]??item.conflict}`}
    {item.diff&&item.diff.length>0&&<details><summary>Изменения полей ({item.diff.length})</summary><table><thead><tr><th>Поле</th><th>Сейчас</th><th>В пакете</th></tr></thead><tbody>{item.diff.map(d=><tr key={d.path}><td>{d.path}</td><td>{show(d.before)}</td><td>{show(d.after)}</td></tr>)}</tbody></table></details>}
    {item.status==='conflict'&&<fieldset className="resolution"><legend>Решение для {item.key==='base'?'базовой версии':item.id}</legend>
     <label className="check"><input type="radio" name={item.key} checked={resolutions[item.key]==='draft'} onChange={()=>setResolutions(r=>({...r,[item.key]:'draft'}))}/>{item.key==='base'?'Отменить импорт':'Оставить моё'}</label>
     <label className="check"><input type="radio" name={item.key} checked={resolutions[item.key]==='package'} onChange={()=>setResolutions(r=>({...r,[item.key]:'package'}))}/>{item.key==='base'?'Импортировать в текущую версию':item.op==='delete'?'Удалить':'Взять из пакета'}</label>
    </fieldset>}
   </li>)}</ul>
   <button type="button" onClick={apply} disabled={busy||conflicts.some(i=>!resolutions[i.key as keyof typeof resolutions])}>Применить импорт</button>
  </div>}
 </section>;
}
