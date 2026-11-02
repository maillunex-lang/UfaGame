import yazl from 'yazl';
import {createHash} from 'node:crypto';
import {validate,negotiate} from '@ufagame/contracts';
import {LIMITS} from './archive.mjs';
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Export a complete, validated JSON-only content snapshot; no assets are supported. */
export async function exportContent(content) {
 if(!validate('content',content).ok||!negotiate(content.required_capabilities))throw new Error('Invalid or incompatible content');
 if(content.entities.length+2>LIMITS.entries)throw new Error('Too many entities');
 const operations=[],entries=[];
 for(const entity of content.entities){
  const path=`entities/${entity.id}.json`,bytes=encode(entity);
  if(bytes.length>LIMITS.file)throw new Error('Entity too large');
  entries.push({path,bytes});operations.push({op:'create',entity_type:entity.kind,id:entity.id,source:path});
 }
 entries.unshift({path:'operations.json',bytes:encode(operations)});
 const files=entries.map(({path,bytes})=>({path,size:bytes.length,sha256:hash(bytes)}));
 const manifest={format:'ug-content/1',package_id:'studio_export',package_version:'1.0.0',game_id:'ufagame',base_content_version:content.content_version,required_capabilities:content.required_capabilities,dependencies:[],files};
 if(!validate('mod_manifest',manifest).ok||!validate('mod_operations',operations).ok)throw new Error('Export exceeds contract limits');
 const manifestBytes=encode(manifest);let total=manifestBytes.length;
 for(const entry of entries)total+=entry.bytes.length;
 if(total>LIMITS.total||manifestBytes.length>LIMITS.file||entries[0].bytes.length>LIMITS.file)throw new Error('Export exceeds content limits');
 const zip=new yazl.ZipFile();
 const output=new Promise((resolve,reject)=>{
  const parts=[];let size=0;
  zip.outputStream.on('data',chunk=>{size+=chunk.length;if(size>LIMITS.archive){zip.outputStream.destroy(new Error('Export exceeds archive limit'));return;}parts.push(chunk);});
  zip.outputStream.on('error',reject);
  zip.outputStream.on('end',()=>resolve(Buffer.concat(parts,size)));
 });
 const options={compress:false,mtime:new Date('2000-01-01T00:00:00.000Z'),mode:0o100644};
 zip.addBuffer(manifestBytes,'manifest.json',options);
 for(const {path,bytes} of entries)zip.addBuffer(bytes,path,options);
 zip.end();return output;
}
