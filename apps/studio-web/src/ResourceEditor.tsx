import React,{useEffect,useRef,useState} from 'react';
import {FramePreview} from './FramePreview';
import {ResourceFrames,type Resource} from './ResourceFrames';
type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
const fileBase64=(file:File)=>new Promise<string>((resolve,reject)=>{
 const reader=new FileReader();reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));
 reader.onload=()=>{if(typeof reader.result!=='string'||!reader.result.includes(','))reject(new Error('Не удалось прочитать файл.'));else resolve(reader.result.slice(reader.result.indexOf(',')+1));};
 reader.readAsDataURL(file);
});
export function ResourceEditor({api,csrf,onPendingChange}:{api:Api;csrf:string;onPendingChange:(dirty:boolean)=>void}){
 const [resources,setResources]=useState<Resource[]>([]),[id,setId]=useState(''),[license,setLicense]=useState(''),[attribution,setAttribution]=useState(''),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState<string|null>(null),[editDirty,setEditDirty]=useState(false);
 const input=useRef<HTMLInputElement>(null),pending=useRef<{fingerprint:string;request_id:string}|null>(null);
 async function load(){try{setResources((await api('/resources')).resources);return true;}catch{setMessage('Не удалось загрузить список ресурсов.');return false;}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{onPendingChange(Boolean(id||license||attribution||file||editDirty));},[id,license,attribution,file,editDirty,onPendingChange]);
 function openEditor(next:string|null){if(editDirty&&!window.confirm('В настройке кадров есть несохранённые изменения. Продолжить?'))return;setEditDirty(false);setEditing(next);}
 async function refresh(){if(editDirty&&!window.confirm('В настройке кадров есть несохранённые изменения. Обновить список?'))return;if(await load()){setEditDirty(false);setEditing(null);setMessage('Список ресурсов обновлён.');}}
 async function upload(){
  if(!file||!id.trim()||!license.trim()){setMessage('Укажи ID, лицензию и выбери PNG или WAV.');return;}
  if(file.size===0||file.size>8*1024*1024){setMessage('Размер файла должен быть не больше 8 МиБ.');return;}
  setBusy(true);try{
   const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
   const fingerprint=JSON.stringify([id.trim(),license.trim(),attribution.trim(),Array.from(new Uint8Array(digest))]);
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,request_id:crypto.randomUUID()};
   await api('/resources','POST',{id:id.trim(),license:{name:license.trim(),attribution:attribution.trim()},scale_bp:10000,loop:false,data_base64:await fileBase64(file),reason:'Добавление ресурса',request_id:pending.current.request_id},csrf);
   pending.current=null;setFile(null);if(input.current)input.current.value='';setId('');setLicense('');setAttribution('');const refreshed=await load();setMessage(refreshed?'Ресурс добавлен.':'Ресурс добавлен, но список не обновился.');
  }catch{setMessage('Не удалось добавить ресурс. Нужен PNG или PCM WAV (до 2 минут); проверь ID и подключение.');}finally{setBusy(false);}
 }
 return <section aria-label="Ресурсы"><h2>Изображения и звуки</h2><button type="button" className="secondary" onClick={refresh}>Обновить список ресурсов</button><p>PNG или WAV (PCM, до 2 минут), до 8 МиБ. Тип определяет сервер по содержимому файла. Лицензия и авторство сохраняются вместе с ресурсом.</p>
  <label>ID ресурса<input value={id} onChange={e=>setId(e.target.value)} placeholder="hero_image" /></label>
  <label>Лицензия<input value={license} maxLength={120} onChange={e=>setLicense(e.target.value)} placeholder="Например: собственная работа" /></label>
  <label>Авторство<input value={attribution} maxLength={500} onChange={e=>setAttribution(e.target.value)} /></label>
  <label>Файл PNG или WAV<input ref={input} type="file" accept="image/png,.png,audio/wav,audio/x-wav,.wav" onChange={e=>setFile(e.target.files?.[0]??null)} /></label>
  <button type="button" disabled={busy} onClick={upload}>Добавить ресурс</button>{message&&<p role="status">{message}</p>}
  {resources.length===0?<p>Ресурсов пока нет.</p>:<ul>{resources.map(resource=><li key={resource.id}>{resource.media_type==='audio/wav'?<><strong>{resource.id}</strong> · звук {((resource.duration_ms??0)/1000).toFixed(1)} с · {resource.sample_rate} Гц · {resource.license.name}<br/><audio controls preload="none" aria-label={'Звук '+resource.id} src={'/game/server/admin/v1/resources/'+encodeURIComponent(resource.id)+'/data'}/></>:<><strong>{resource.id}</strong> · {resource.width}×{resource.height} · {resource.license.name}<br/>
   <FramePreview url={'/game/server/admin/v1/resources/'+encodeURIComponent(resource.id)+'/data'} id={resource.id} width={resource.width} height={resource.height} frames={resource.frames} loop={resource.loop}/>
   {editing===resource.id?<ResourceFrames resource={resource} api={api} csrf={csrf} onCancel={()=>openEditor(null)} onFinished={()=>{setEditDirty(false);setEditing(null);}} onDirtyChange={setEditDirty} onSaved={async()=>{if(!await load())throw new Error('Сохранено, но список не обновился.');}}/>:<button type="button" className="secondary" onClick={()=>openEditor(resource.id)}>Настроить кадры</button>}</>}
  </li>)}</ul>}
 </section>;
}
