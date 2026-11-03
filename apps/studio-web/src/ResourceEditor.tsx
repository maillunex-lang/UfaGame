import React,{useEffect,useRef,useState} from 'react';
type Resource={id:string;media_type:string;width:number;height:number;sha256:string;license:{name:string;attribution:string}};
type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
const fileBase64=(file:File)=>new Promise<string>((resolve,reject)=>{
 const reader=new FileReader();reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));
 reader.onload=()=>{if(typeof reader.result!=='string'||!reader.result.includes(','))reject(new Error('Не удалось прочитать файл.'));else resolve(reader.result.slice(reader.result.indexOf(',')+1));};
 reader.readAsDataURL(file);
});
export function ResourceEditor({api,csrf}:{api:Api;csrf:string}){
 const [resources,setResources]=useState<Resource[]>([]),[id,setId]=useState(''),[license,setLicense]=useState(''),[attribution,setAttribution]=useState(''),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const input=useRef<HTMLInputElement>(null),pending=useRef<{fingerprint:string;request_id:string}|null>(null);
 async function load(){try{setResources((await api('/resources')).resources);}catch{setMessage('Не удалось загрузить список ресурсов.');}}
 useEffect(()=>{void load();},[]);
 async function upload(){
  if(!file||!id.trim()||!license.trim()){setMessage('Укажи ID, лицензию и выбери PNG.');return;}
  if(file.size===0||file.size>8*1024*1024){setMessage('Размер PNG должен быть не больше 8 МиБ.');return;}
  setBusy(true);try{
   const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
   const fingerprint=JSON.stringify([id.trim(),license.trim(),attribution.trim(),Array.from(new Uint8Array(digest))]);
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,request_id:crypto.randomUUID()};
   await api('/resources','POST',{id:id.trim(),license:{name:license.trim(),attribution:attribution.trim()},scale_bp:10000,loop:false,data_base64:await fileBase64(file),reason:'Добавление PNG ресурса',request_id:pending.current.request_id},csrf);
   pending.current=null;setFile(null);if(input.current)input.current.value='';setId('');setLicense('');setAttribution('');await load();setMessage('Ресурс добавлен.');
  }catch{setMessage('Не удалось добавить PNG. Проверь файл, ID и подключение.');}finally{setBusy(false);}
 }
 return <section aria-label="Ресурсы"><h2>Изображения</h2><p>PNG до 8 МиБ. Лицензия и авторство сохраняются вместе с ресурсом.</p>
  <label>ID ресурса<input value={id} onChange={e=>setId(e.target.value)} placeholder="hero_image" /></label>
  <label>Лицензия<input value={license} maxLength={120} onChange={e=>setLicense(e.target.value)} placeholder="Например: собственная работа" /></label>
  <label>Авторство<input value={attribution} maxLength={500} onChange={e=>setAttribution(e.target.value)} /></label>
  <label>PNG файл<input ref={input} type="file" accept="image/png,.png" onChange={e=>setFile(e.target.files?.[0]??null)} /></label>
  <button type="button" disabled={busy} onClick={upload}>Добавить изображение</button>{message&&<p role="status">{message}</p>}
  {resources.length===0?<p>Изображений пока нет.</p>:<ul>{resources.map(resource=><li key={resource.id}><strong>{resource.id}</strong> · {resource.width}×{resource.height} · {resource.license.name}<br/><img className="resource-preview" src={'/game/server/admin/v1/resources/'+encodeURIComponent(resource.id)+'/data'} alt={'Ресурс '+resource.id}/></li>)}</ul>}
 </section>;
}
