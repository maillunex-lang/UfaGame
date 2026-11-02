import yauzl from 'yauzl';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {validate,negotiate} from '@ufagame/contracts';

// Conservative test profile for a small VPS. This does not write or extract files.
export const LIMITS=Object.freeze({archive:8*1024*1024,total:32*1024*1024,file:8*1024*1024,entries:1000,ratio:100});
const decoder=new TextDecoder('utf-8',{fatal:true});
const fail=message=>{throw new Error(message);};
function pathCheck(name) {
 if(typeof name!=='string'||name.length>240||!name||name.includes('\\')||!/^[-A-Za-z0-9_./]+$/.test(name)||name.startsWith('/'))fail('Invalid archive path');
 const parts=name.replace(/\/$/,'').split('/');
 if(parts.some(p=>!p||p.startsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)||p.endsWith('.')))fail('Invalid archive path');
}
function parseJson(bytes,name) {
 try{return JSON.parse(decoder.decode(bytes));}catch{fail(`Invalid JSON: ${name}`);}
}
function streamEntry(zip,entry) {
 return new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>{
  if(error)return reject(error);
  const parts=[];let size=0;
  stream.on('data',chunk=>{size+=chunk.length;if(size>LIMITS.file||size>entry.uncompressedSize){stream.destroy(new Error('Entry exceeds size limit'));return;}parts.push(chunk);});
  stream.on('error',reject);
  stream.on('end',()=>size===entry.uncompressedSize?resolve(Buffer.concat(parts,size)):reject(new Error('Entry size mismatch')));
 }));
}
async function readArchive(buffer) {
 if(!Buffer.isBuffer(buffer)||buffer.length>LIMITS.archive)fail('Archive size limit');
 const zip=await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,value)=>error?reject(error):resolve(value)));
 return new Promise((resolve,reject)=>{
  const files=new Map(),names=new Set();let count=0,total=0,finished=false;
  const bad=error=>{if(finished)return;finished=true;zip.close();reject(error);};
  zip.on('error',bad);
  zip.on('end',()=>{if(!finished){finished=true;resolve(files);}});
  zip.on('entry',entry=>{
   (async()=>{
    if(++count>LIMITS.entries)fail('Too many entries');
    pathCheck(entry.fileName);
    const key=entry.fileName.replace(/\/$/,'').normalize('NFC').toLowerCase();
    if(names.has(key))fail('Duplicate or colliding paths');names.add(key);
    const unix=(entry.versionMadeBy>>8)===3,mode=(entry.externalFileAttributes>>>16)&0xffff,type=mode&0o170000;
    if(unix&&type!==0&&type!==0o100000&&type!==0o040000)fail('Unsupported file type');
    if((entry.generalPurposeBitFlag&1)!==0)fail('Encrypted entry');
    if(entry.compressionMethod!==0&&entry.compressionMethod!==8)fail('Unsupported compression');
    const isDir=entry.fileName.endsWith('/');
    if(unix&&((isDir&&type===0o100000)||(!isDir&&type===0o040000)))fail('Invalid entry type');
    if(isDir){if(entry.uncompressedSize!==0)fail('Invalid directory');zip.readEntry();return;}
    if(entry.uncompressedSize>LIMITS.file||(total+=entry.uncompressedSize)>LIMITS.total)fail('Uncompressed size limit');
    if(entry.uncompressedSize>0&&(entry.compressedSize===0||entry.uncompressedSize>entry.compressedSize*LIMITS.ratio))fail('Compression ratio limit');
    files.set(entry.fileName,await streamEntry(zip,entry));zip.readEntry();
   })().catch(bad);
  });
  zip.readEntry();
 });
}
/** Inspect in memory only. Not an importer or approval to execute/archive contents. */
export async function inspectArchive(buffer) {
 const files=await readArchive(buffer);
 if(!files.has('manifest.json')||!files.has('operations.json'))fail('Missing manifest or operations');
 const manifest=parseJson(files.get('manifest.json'),'manifest.json');
 if(!validate('mod_manifest',manifest).ok)fail('Invalid manifest');
 if(!negotiate(manifest.required_capabilities))fail('Unsupported capability');
 if(manifest.dependencies.length!==0)fail('Package dependencies are not supported yet');
 const listed=new Set();
 for(const item of manifest.files){
  const key=item.path.toLowerCase();if(listed.has(key))fail('Duplicate manifest file');listed.add(key);
  if(item.path.startsWith('assets/'))fail('Assets are not supported until resource validation is ready');
  const bytes=files.get(item.path);if(!bytes||bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)fail('File missing or hash mismatch');
 }
 if(!listed.has('operations.json')||files.size!==manifest.files.length+1)fail('Unlisted file or missing operations');
 const operations=parseJson(files.get('operations.json'),'operations.json');
 if(!validate('mod_operations',operations).ok)fail('Invalid operations');
 for(const op of operations){
  if(op.source){
   const bytes=files.get(op.source);if(!bytes||!listed.has(op.source.toLowerCase()))fail('Missing operation source');
   const entity=parseJson(bytes,op.source);if(!entity||typeof entity!=='object'||Array.isArray(entity)||entity.id!==op.id||entity.kind!==op.entity_type)fail('Entity identity mismatch');
  }
 }
 return {manifest,operations};
}
