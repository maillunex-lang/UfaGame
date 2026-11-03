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
 try{return JSON.parse(decoder.decode(bytes));}catch{throw new PackageError('JSON_INVALID',name);}
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
export class PackageError extends Error {
 constructor(code,file=null,field=null){super(file?`${code}: ${file}${field?` (${field})`:''}`:code);this.code=code;this.file=file;this.field=field;}
}
const reject=(code,file,field)=>{throw new PackageError(code,file,field);};
/**
 * Inspect in memory only (quarantine): nothing is written to disk and nothing is
 * applied. Returns parsed manifest/operations, entity sources and resource
 * metadata with their asset bytes. Asset bytes are decoded later in the
 * isolated resource worker by the importer.
 */
export async function inspectArchive(buffer) {
 let files;
 try{files=await readArchive(buffer);}catch(error){if(error instanceof PackageError)throw error;reject('ARCHIVE_INVALID',null,error.message);}
 if(!files.has('manifest.json'))reject('MISSING_FILE','manifest.json');
 if(!files.has('operations.json'))reject('MISSING_FILE','operations.json');
 const manifest=parseJson(files.get('manifest.json'),'manifest.json');
 if(!validate('mod_manifest',manifest).ok)reject('SCHEMA_INVALID','manifest.json');
 const unknown=manifest.required_capabilities.filter(c=>!negotiate([c]));
 if(unknown.length)reject('UNSUPPORTED_CAPABILITY','manifest.json',unknown.join(','));
 if(manifest.dependencies.length!==0)reject('DEPENDENCIES_UNSUPPORTED','manifest.json','dependencies');
 const listed=new Map();
 for(const item of manifest.files){
  const key=item.path.normalize('NFC').toLowerCase();if(listed.has(key))reject('DUPLICATE_FILE','manifest.json',item.path);listed.set(key,item.path);
  const bytes=files.get(item.path);
  if(!bytes)reject('MISSING_FILE',item.path);
  if(bytes.length!==item.size)reject('SIZE_MISMATCH',item.path,'size');
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)reject('HASH_MISMATCH',item.path,'sha256');
 }
 if(!listed.has('operations.json'))reject('MISSING_FILE','manifest.json','files[operations.json]');
 for(const name of files.keys())if(name!=='manifest.json'&&!listed.has(name.normalize('NFC').toLowerCase()))reject('UNLISTED_FILE',name);
 const operations=parseJson(files.get('operations.json'),'operations.json');
 if(!validate('mod_operations',operations).ok)reject('SCHEMA_INVALID','operations.json');
 const seen=new Set(),entities=[],resources=[],usedSources=new Set(),usedAssets=new Set();
 operations.forEach((op,index)=>{
  const where=`operations.json`,field=`[${index}]`;
  const key=`${op.entity_type==='resource'?'resource':'entity'}:${op.id}`;if(seen.has(key))reject('DUPLICATE_OPERATION',where,field);seen.add(key);
  if(!op.source){entities.push(null);return;}
  if(usedSources.has(op.source))reject('SOURCE_REUSED',op.source);usedSources.add(op.source);
  const value=parseJson(files.get(op.source)??reject('MISSING_FILE',op.source),op.source);
  if(op.entity_type==='resource'){
   if(!validate('mod_resource',value).ok)reject('SCHEMA_INVALID',op.source);
   if(value.id!==op.id)reject('IDENTITY_MISMATCH',op.source,'id');
   if(usedAssets.has(value.file))reject('ASSET_REUSED',value.file);usedAssets.add(value.file);
   const bytes=files.get(value.file);if(!bytes||!listed.has(value.file.toLowerCase()))reject('MISSING_FILE',value.file);
   resources.push({meta:value,bytes});entities.push(null);return;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))reject('SCHEMA_INVALID',op.source);
  if(value.id!==op.id)reject('IDENTITY_MISMATCH',op.source,'id');
  if(value.kind!==op.entity_type)reject('IDENTITY_MISMATCH',op.source,'kind');
  entities.push(value);
 });
 for(const name of files.keys()){
  if(name.startsWith('entities/')||name.startsWith('resources/')){if(!usedSources.has(name))reject('UNUSED_FILE',name);}
  if(name.startsWith('assets/')&&!usedAssets.has(name))reject('UNUSED_FILE',name);
 }
 return {manifest,operations,entities,resources};
}
