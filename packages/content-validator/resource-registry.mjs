import {createHash} from 'node:crypto';
import {validate} from '@ufagame/contracts';
import {inspectPngIsolated} from './isolated-png.mjs';
const MAX_ITEMS=128,MAX_TOTAL=32*1024*1024;
/** In-memory test registry. Not durable and not available through an API. */
export class ResourceRegistry {
 #resources=new Map();#total=0;
 async addPng({id,bytes,license,scale_bp,anchor,frames,loop}) {
  if(typeof id!=='string'||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw new Error('INVALID_RESOURCE');
  if(this.#resources.has(id))throw new Error('DUPLICATE_RESOURCE');
  const copy=Buffer.from(bytes),info=await inspectPngIsolated(copy);
  const descriptor={id,media_type:info.media_type,sha256:createHash('sha256').update(copy).digest('hex'),size:copy.length,width:info.width,height:info.height,license:structuredClone(license),scale_bp,anchor:structuredClone(anchor),frames:structuredClone(frames),loop};
  if(!validate('resource_descriptor',descriptor).ok)throw new Error('INVALID_METADATA');
  if(anchor.x>=info.width||anchor.y>=info.height||frames.some(f=>f.x+f.width>info.width||f.y+f.height>info.height))throw new Error('FRAME_OUT_OF_BOUNDS');
  if(this.#resources.has(id))throw new Error('DUPLICATE_RESOURCE');
  if(this.#resources.size>=MAX_ITEMS||this.#total+copy.length>MAX_TOTAL)throw new Error('RESOURCE_QUOTA');
  this.#resources.set(id,{descriptor,bytes:copy});this.#total+=copy.length;
  return structuredClone(descriptor);
 }
 get(id) {const item=this.#resources.get(id);return item?{descriptor:structuredClone(item.descriptor),bytes:Buffer.from(item.bytes)}:null;}
 list(){return [...this.#resources.values()].map(item=>structuredClone(item.descriptor)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
}
