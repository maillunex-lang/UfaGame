import yazl from 'yazl';
import {createHash} from 'node:crypto';
import {validate,negotiate,resourceRefs} from '@ufagame/contracts';
import {LIMITS,PackageError} from './archive.mjs';
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Ids the given entity depends on (other entities only). */
function entityDeps(e){
 const d=e.data??{};
 return [d.faction_id,...(d.ability_ids??[]),...(d.advantage_ids??[]),...(d.enemy_hero_ids??[])].filter(x=>typeof x==='string');
}
/** Selected ids plus every entity they (transitively) reference, in content order. */
export function dependencyClosure(content,ids){
 const byId=new Map(content.entities.map(e=>[e.id,e]));
 const keep=new Set(),stack=[...ids];
 while(stack.length){const id=stack.pop();if(keep.has(id))continue;const e=byId.get(id);if(!e)throw new PackageError('UNKNOWN_ENTITY',null,id);keep.add(id);stack.push(...entityDeps(e));}
 return content.entities.filter(e=>keep.has(e.id));
}

/**
 * Export validated content (all of it, or `ids` with dependencies) as a
 * ug-content/1 ZIP with create operations. Referenced resources are included
 * from `resources` (Map id -> {descriptor, bytes}).
 */
export async function exportContent(content,{ids=null,resources=new Map(),packageId='studio_export'}={}){
 if(!validate('content',content).ok||!negotiate(content.required_capabilities))throw new PackageError('CONTENT_INVALID');
 const chosen=ids?dependencyClosure(content,ids):content.entities;
 const subset={...content,entities:chosen};
 const operations=[],entries=[];
 for(const ref of resourceRefs(subset)){
  if(entries.some(e=>e.resourceId===ref.resource_id))continue;
  const item=resources.get(ref.resource_id);
  if(!item||item.descriptor.media_type!==ref.media_type)throw new PackageError('RESOURCE_REF_INVALID',`entity:${ref.entity_id}`,ref.resource_id);
  const d=item.descriptor,ext=d.media_type==='audio/wav'?'wav':'png',file=`assets/${d.id}.${ext}`;
  const meta={id:d.id,file,license:d.license,loop:d.loop,...(d.media_type==='image/png'?{scale_bp:d.scale_bp,anchor:d.anchor,frames:d.frames}:{})};
  const path=`resources/${d.id}.json`;
  entries.push({path,bytes:encode(meta),resourceId:d.id},{path:file,bytes:Buffer.from(item.bytes)});
  operations.push({op:'create',entity_type:'resource',id:d.id,source:path});
 }
 for(const entity of chosen){
  const path=`entities/${entity.id}.json`,bytes=encode(entity);
  entries.push({path,bytes});operations.push({op:'create',entity_type:entity.kind,id:entity.id,source:path});
 }
 if(entries.length+2>LIMITS.entries)throw new PackageError('EXPORT_LIMIT',null,'entries');
 entries.unshift({path:'operations.json',bytes:encode(operations)});
 const files=entries.map(({path,bytes})=>({path,size:bytes.length,sha256:hash(bytes)}));
 const manifest={format:'ug-content/1',package_id:packageId,package_version:'1.0.0',game_id:'ufagame',base_content_version:content.content_version,required_capabilities:content.required_capabilities,dependencies:[],files};
 if(!validate('mod_manifest',manifest).ok||!validate('mod_operations',operations).ok)throw new PackageError('EXPORT_LIMIT',null,'schema');
 const manifestBytes=encode(manifest);let total=manifestBytes.length;
 for(const entry of entries){total+=entry.bytes.length;if(entry.bytes.length>LIMITS.file)throw new PackageError('EXPORT_LIMIT',entry.path,'size');}
 if(total>LIMITS.total||manifestBytes.length>LIMITS.file)throw new PackageError('EXPORT_LIMIT',null,'total');
 const zip=new yazl.ZipFile();
 const output=new Promise((resolve,reject)=>{
  const parts=[];let size=0;
  zip.outputStream.on('data',chunk=>{size+=chunk.length;if(size>LIMITS.archive){zip.outputStream.destroy(new PackageError('EXPORT_LIMIT',null,'archive'));return;}parts.push(chunk);});
  zip.outputStream.on('error',reject);
  zip.outputStream.on('end',()=>resolve(Buffer.concat(parts,size)));
 });
 const options={compress:false,mtime:new Date('2000-01-01T00:00:00.000Z'),mode:0o100644};
 zip.addBuffer(manifestBytes,'manifest.json',options);
 for(const {path,bytes} of entries)zip.addBuffer(bytes,path,options);
 zip.end();return output;
}
