import React,{useEffect,useState} from 'react';
import type {Frame} from './resource-grid.mjs';
export function FramePreview({url,id,width,height,frames,loop}:{url:string;id:string;width:number;height:number;frames:Frame[];loop:boolean}){
 const [index,setIndex]=useState(0);
 useEffect(()=>{setIndex(0);},[frames]);
 useEffect(()=>{
  if(frames.length<2||(!loop&&index>=frames.length-1))return;
  const timer=window.setTimeout(()=>setIndex(i=>(i+1)%frames.length),frames[index].duration_ms);
  return()=>window.clearTimeout(timer);
 },[frames,index,loop]);
 const frame=frames[Math.min(index,frames.length-1)];if(!frame)return null;
 const factor=Math.min(180/frame.width,180/frame.height,6);
 return <div className="frame-preview" style={{width:frame.width*factor,height:frame.height*factor}}>
  <img src={url} alt={'Ресурс '+id} style={{width:width*factor,height:height*factor,left:-frame.x*factor,top:-frame.y*factor}}/>
 </div>;
}
