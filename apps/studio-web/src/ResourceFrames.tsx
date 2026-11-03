import React,{useRef,useState} from 'react';
import {gridFrames,type Frame} from './resource-grid.mjs';
export type Resource={id:string;media_type:string;duration_ms?:number;sample_rate?:number;channels?:number;width:number;height:number;sha256:string;revision:number;scale_bp:number;anchor:{x:number;y:number};frames:Frame[];loop:boolean;license:{name:string;attribution:string}};
type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
export function ResourceFrames({resource,api,csrf,onSaved,onCancel,onFinished,onDirtyChange}:{resource:Resource;api:Api;csrf:string;onSaved:()=>Promise<void>;onCancel:()=>void;onFinished:()=>void;onDirtyChange:(dirty:boolean)=>void}){
 const [baseResource]=useState(()=>structuredClone(resource));
 const [columns,setColumns]=useState('1'),[rows,setRows]=useState('1'),[duration,setDuration]=useState(String(resource.frames[0]?.duration_ms??100)),[scale,setScale]=useState(String(resource.scale_bp/100));
 const [anchorX,setAnchorX]=useState(String(resource.anchor.x)),[anchorY,setAnchorY]=useState(String(resource.anchor.y)),[loop,setLoop]=useState(resource.loop),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<{fingerprint:string;request_id:string}|null>(null);
 async function save(){
  try{
   if(!columns.trim()||!rows.trim()||!duration.trim()||!scale.trim()||!anchorX.trim()||!anchorY.trim())throw new Error('Заполни все числовые поля.');
   const frames=gridFrames(baseResource.width,baseResource.height,Number(columns),Number(rows),Number(duration));
   const scaleBp=Number(scale)*100,x=Number(anchorX),y=Number(anchorY);
   if(!Number.isSafeInteger(scaleBp)||scaleBp<100||scaleBp>100000||!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<0||y<0||x>=baseResource.width||y>=baseResource.height)throw new Error('Проверь масштаб и точку привязки.');
   const payload={license:baseResource.license,scale_bp:scaleBp,anchor:{x,y},frames,loop,expected_revision:baseResource.revision};
   const fingerprint=JSON.stringify(payload);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,request_id:crypto.randomUUID()};
   setBusy(true);await api('/resources/'+encodeURIComponent(resource.id),'PATCH',{...payload,reason:'Настройка кадров ресурса',request_id:pending.current.request_id},csrf);
   pending.current=null;await onSaved();onFinished();
  }catch(error){const status=(error as {status?:number}).status;setMessage(status===409?'Ресурс изменился. Обнови список перед повторной настройкой.':status?'Не удалось сохранить настройки. Проверь данные и подключение.':(error as Error).message||'Не удалось сохранить настройки.');}
  finally{setBusy(false);}
 }
 return <div className="frame-editor" onChange={()=>onDirtyChange(true)}><h3>Сетка кадров: {resource.id}</h3><p>Сетка заменит текущие кадры. Размер изображения должен делиться на число строк и столбцов.</p>
  <label>Столбцы<input type="number" min="1" value={columns} onChange={e=>setColumns(e.target.value)}/></label>
  <label>Строки<input type="number" min="1" value={rows} onChange={e=>setRows(e.target.value)}/></label>
  <label>Длительность кадра, мс<input type="number" min="20" max="60000" value={duration} onChange={e=>setDuration(e.target.value)}/></label>
  <label>Масштаб, %<input type="number" min="1" max="1000" value={scale} onChange={e=>setScale(e.target.value)}/></label>
  <label>Точка X<input type="number" min="0" value={anchorX} onChange={e=>setAnchorX(e.target.value)}/></label>
  <label>Точка Y<input type="number" min="0" value={anchorY} onChange={e=>setAnchorY(e.target.value)}/></label>
  <label><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/> Зациклить</label>
  {message&&<p role="alert">{message}</p>}<button type="button" disabled={busy} onClick={save}>Сохранить кадры</button><button type="button" className="secondary" onClick={onCancel}>Отмена</button>
 </div>;
}
