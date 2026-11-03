import React,{useEffect,useRef,useState} from 'react';
import geo from '../../../content/geo/bashkortostan.locations.json';
import {BOUNDS,deleteEntity,distanceKm,importGeography,listLocations,suggestId,upsertEntity,type Location} from './entities.mjs';

type Api=(path:string,method?:string,body?:unknown,csrf?:string)=>Promise<any>;
type Res={id:string;media_type:string;width?:number;height?:number};
const LAT0=54.0,K=Math.cos(LAT0*Math.PI/180);
/** Equirectangular projection scaled by cos(54°): fine for a 5°×7° region; a schematic view, not a survey map. */
const project=(l:{lat_e6:number;lon_e6:number})=>({x:(l.lon_e6/1e6-53)*K*100,y:(56.7-l.lat_e6/1e6)*100});
const unproject=(x:number,y:number)=>({lat_e6:Math.round((56.7-y/100)*1e6),lon_e6:Math.round((x/(K*100)+53)*1e6)});
const deg=(v:number)=>(v/1e6).toFixed(5);

export function MapEditor({text,onChange,api}:{text:string;onChange:(t:string)=>void;api?:Api}){
 const [selected,setSelected]=useState<string|null>(null),[draftPoint,setDraftPoint]=useState<{lat_e6:number;lon_e6:number}|null>(null);
 const [pointName,setPointName]=useState(''),[pointNote,setPointNote]=useState(''),[editing,setEditing]=useState<string|null>(null);
 const [message,setMessage]=useState(''),[mode,setMode]=useState<'scheme'|'art'>('scheme'),[resources,setResources]=useState<Res[]>([]);
 const svg=useRef<SVGSVGElement>(null);
 useEffect(()=>{if(api)api('/resources').then(r=>setResources(r.resources)).catch(()=>{});},[api]);
 let locations:Location[]=[];try{locations=listLocations(text);}catch{/* JSON error is shown elsewhere */}
 const republic=locations.find(l=>l.data.level==='republic');
 const area=locations.find(l=>l.id===selected&&(l.data.level==='district'||l.data.level==='city'));
 const children=(id:string)=>locations.filter(l=>l.data.parent_id===id);
 const images=resources.filter(r=>r.media_type==='image/png');
 const art=republic?.data.art,artImage=art?images.find(r=>r.id===art.resource_id):undefined;
 function apply(next:string,note:string){onChange(next);setMessage(note);}
 function importAll(){try{const r=importGeography(text,geo);apply(r.text,r.added?`Добавлено мест: ${r.added}. Источник — Wikidata (CC0).`:'Все районы и города уже есть.');}catch(e){setMessage((e as Error).message);}}
 // View box: whole republic, or ~±0.9° around the selected district/city.
 const box=(()=>{
  if(!area){const a=project({lat_e6:BOUNDS.max_lat_e6,lon_e6:BOUNDS.min_lon_e6}),b=project({lat_e6:BOUNDS.min_lat_e6,lon_e6:BOUNDS.max_lon_e6});return {x:a.x-10,y:a.y-10,w:b.x-a.x+20,h:b.y-a.y+20};}
  const c=project(area.data);return {x:c.x-75,y:c.y-90,w:150,h:180};
 })();
 function tap(ev:React.MouseEvent<SVGSVGElement>){
  if(!area||mode!=='scheme'||!svg.current)return;
  const p=svg.current.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const m=svg.current.getScreenCTM();if(!m)return;
  const q=p.matrixTransform(m.inverse());const point=unproject(q.x,q.y);
  setDraftPoint(point);setEditing(null);setPointName('');setPointNote('');
  setMessage(`Новая точка: ${deg(point.lat_e6)}° с. ш., ${deg(point.lon_e6)}° в. д. (${distanceKm(point,area.data).toFixed(0)} км от центра). Введи название.`);
 }
 function savePoint(){try{
  if(!area||!draftPoint)throw new Error('Нажми на карту внутри района, чтобы выбрать место.');
  if(!pointName.trim())throw new Error('Введи название точки.');
  const id=editing??suggestId(pointName,'point',locations.map(l=>l.id));
  const old=locations.find(l=>l.id===editing);
  const entity={id,kind:'location' as const,name:pointName.trim(),data:{...(old?.data??{}),level:'point' as const,parent_id:area.id,lat_e6:draftPoint.lat_e6,lon_e6:draftPoint.lon_e6,...(pointNote.trim()?{description:pointNote.trim()}:{}),source:old?.data.source??{kind:'manual',note:'Поставлено владельцем в Studio'}}};
  if(!pointNote.trim())delete (entity.data as {description?:string}).description;
  apply(upsertEntity(text,entity,editing),editing?'Точка изменена.':'Точка добавлена. Её можно выбрать у этапа в поле «Место на карте».');
  setDraftPoint(null);setEditing(null);setPointName('');setPointNote('');
 }catch(e){setMessage((e as Error).message);}}
 function editPoint(p:Location){setEditing(p.id);setDraftPoint({lat_e6:p.data.lat_e6,lon_e6:p.data.lon_e6});setPointName(p.name);setPointNote(p.data.description??'');setMessage('Можно нажать на карту, чтобы перенести точку.');}
 function removePoint(p:Location){if(!window.confirm(`Удалить точку «${p.name}»?`))return;try{apply(deleteEntity(text,p.id),'Точка удалена.');}catch(e){setMessage((e as Error).message);}}
 function setBackground(id:string){if(!republic)return;try{const data={...republic.data};if(id)data.art={resource_id:id,x:0,y:0};else delete data.art;apply(upsertEntity(text,{...republic,data},republic.id),id?'Художественная карта выбрана.':'Художественная карта убрана.');}catch(e){setMessage((e as Error).message);}}
 function placeOnArt(ev:React.MouseEvent<HTMLDivElement>){
  if(!artImage||!selected)return;const target=locations.find(l=>l.id===selected);if(!target||target.data.level==='republic')return;
  const r=ev.currentTarget.getBoundingClientRect(),x=Math.round((ev.clientX-r.left)/r.width*(artImage.width??1)),y=Math.round((ev.clientY-r.top)/r.height*(artImage.height??1));
  try{apply(upsertEntity(text,{...target,data:{...target.data,art:{resource_id:artImage.id,x,y}}},target.id),`«${target.name}» поставлено на художественную карту.`);}catch(e){setMessage((e as Error).message);}
 }
 const marker=(l:Location)=>{const p=project(l.data),r=area?3:2.2,active=l.id===selected;
  const shape=l.data.level==='city'?<rect x={p.x-r} y={p.y-r} width={r*2} height={r*2} fill={active?'#e3a72f':'#9c3b2e'}/>:l.data.level==='point'?<polygon points={`${p.x},${p.y-r*1.4} ${p.x+r},${p.y+r} ${p.x-r},${p.y+r}`} fill={active?'#e3a72f':'#3a5ccc'}/>:<circle cx={p.x} cy={p.y} r={r} fill={active?'#e3a72f':'#205d4a'}/>;
  return <g key={l.id} role="button" aria-label={l.name} onClick={ev=>{ev.stopPropagation();if(l.data.level==='point'){setSelected(l.id);editPoint(l);}else{setSelected(l.id);setDraftPoint(null);setEditing(null);setMessage('');}}} style={{cursor:'pointer'}}><circle cx={p.x} cy={p.y} r={area?7:5} fill="transparent"/>{shape}{(area||l.data.level==='city')&&<text x={p.x+r+1} y={p.y+1} fontSize={area?5:2.6} fill="#1d282a">{l.name}</text>}</g>;};
 return <section aria-label="Карта"><h2>Карта Башкортостана</h2>
  {!republic?<><p>Добавь республику, 54 района и 9 городских округов. Названия (русские и башкирские) и координаты — из Wikidata (CC0), сверены с OpenStreetMap.</p><button type="button" onClick={importAll}>Добавить районы и города</button></>:<>
   <p className="crumbs"><button type="button" className="link" onClick={()=>{setSelected(null);setDraftPoint(null);setEditing(null);setMessage('');}}>Республика</button>{area&&<> › <strong>{area.name}</strong>{area.data.name_ba?` (${area.data.name_ba})`:''}</>}</p>
   <div className="row"><label className="check"><input type="radio" checked={mode==='scheme'} onChange={()=>setMode('scheme')}/>Схема по координатам</label><label className="check"><input type="radio" checked={mode==='art'} onChange={()=>setMode('art')}/>Художественная карта</label></div>
   {mode==='scheme'?<>
    <svg ref={svg} className="geo-map" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img" aria-label={area?`Район: ${area.name}`:'Республика Башкортостан'} onClick={tap}>
     <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#eef3ec"/>
     {(area?[area,...children(area.id)]:locations.filter(l=>l.data.level!=='republic'&&l.data.level!=='point')).map(marker)}
     {draftPoint&&area&&(()=>{const p=project(draftPoint);return <circle cx={p.x} cy={p.y} r={2.4} fill="none" stroke="#e3a72f" strokeWidth={1}/>;})()}
    </svg>
    {!area&&<label>Или выбери район/город из списка<select value="" onChange={e=>{if(e.target.value){setSelected(e.target.value);setDraftPoint(null);setEditing(null);setMessage('');}}}><option value="">— район или город —</option>{locations.filter(l=>l.data.level==='district'||l.data.level==='city').sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
    <p className="hint">{area?'Нажми на карту внутри района, чтобы поставить точку (место сюжета или этапа).':'Нажми на район или город, чтобы открыть его. Кружки — районы, квадраты — города.'} Это схема по координатам центров, а не точная карта границ.</p>
   </>:<>
    <label>Картинка художественной карты<select value={art?.resource_id??''} onChange={e=>setBackground(e.target.value)}><option value="">— не выбрана —</option>{images.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}</select></label>
    {artImage?<div className="art-map" onClick={placeOnArt} style={{aspectRatio:`${artImage.width}/${artImage.height}`}}><img src={'/game/server/admin/v1/resources/'+encodeURIComponent(artImage.id)+'/data'} alt="Художественная карта"/>
     {locations.filter(l=>l.data.art?.resource_id===artImage.id&&l.data.level!=='republic').map(l=><span key={l.id} className={'art-pin'+(l.id===selected?' active':'')} style={{left:`${(l.data.art!.x/(artImage.width??1))*100}%`,top:`${(l.data.art!.y/(artImage.height??1))*100}%`}} title={l.name}>{l.name}</span>)}</div>:<p className="hint">Загрузи PNG в «Изображения и звуки» и выбери его здесь.</p>}
    <p className="hint">Выбери место в схеме или списке, затем нажми на картинку — так оно встанет на художественной карте. Художественная карта — рисунок, она не заменяет настоящие координаты.</p>
   </>}
   {area&&<>
    <h3>Точки в «{area.name}»</h3>
    {children(area.id).length===0?<p className="hint">Точек пока нет.</p>:<ul className="entity-list">{children(area.id).map(p=><li key={p.id}><span><strong>{p.name}</strong> <small>{deg(p.data.lat_e6)}, {deg(p.data.lon_e6)}</small></span><button type="button" className="link" aria-label={`Изменить ${p.id}`} onClick={()=>{setSelected(p.id);editPoint(p);}}>Изменить</button><button type="button" className="link" aria-label={`Удалить ${p.id}`} onClick={()=>removePoint(p)}>Удалить</button></li>)}</ul>}
    {draftPoint&&<div className="point-form"><label>Название точки<input value={pointName} maxLength={100} onChange={e=>setPointName(e.target.value)} placeholder="Например: Пещера Шульган-Таш"/></label><label>Описание (необязательно)<input value={pointNote} maxLength={500} onChange={e=>setPointNote(e.target.value)}/></label><button type="button" onClick={savePoint}>{editing?'Сохранить точку':'Добавить точку'}</button><button type="button" className="secondary" onClick={()=>{setDraftPoint(null);setEditing(null);setMessage('');}}>Отмена</button></div>}
   </>}
  </>}
  {message&&<p role="status">{message}</p>}
  <p className="hint">Данные районов и городов: Wikidata (CC0), {geo.retrieved}. Проверено по OpenStreetMap (© участники OpenStreetMap, ODbL). Точки, поставленные вручную, помечаются как «вручную».</p>
 </section>;
}
