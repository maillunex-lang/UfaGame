import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const worker=fileURLToPath(new URL('./png-worker.mjs',import.meta.url));
const parser=fileURLToPath(new URL('./png.mjs',import.meta.url));
const wav=fileURLToPath(new URL('./wav.mjs',import.meta.url));
let active=0;
/** Bounded child process; not a complete OS sandbox and not exposed to API. */
export async function inspectResourceIsolated(bytes) {
 if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024)throw new Error('RESOURCE_LIMIT');
 if(active>=2)throw new Error('RESOURCE_BUSY');
 active++;
 try {return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--permission',`--allow-fs-read=${worker}`,`--allow-fs-read=${parser}`,`--allow-fs-read=${wav}`,'--max-old-space-size=64',worker],{stdio:['pipe','pipe','pipe'],env:{}});
  let output='',errors='',settled=false;
  child.stderr.on('data',chunk=>{if(errors.length<64)errors+=chunk.toString('utf8');});
  const timeout=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('RESOURCE_TIMEOUT'));},5000);
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve(value);};
  child.on('error',()=>finish(new Error('RESOURCE_WORKER_FAILED')));
  child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>1024){child.kill('SIGKILL');finish(new Error('RESOURCE_WORKER_FAILED'));}});
  child.on('close',code=>{if(code!==0){const reason=errors.trim();const e=new Error('RESOURCE_INVALID');e.reason=/^(PNG|WAV)_[A-Z_]{3,30}$/.test(reason)?reason:'RESOURCE_INVALID';return finish(e);}try{const parsed=JSON.parse(output);if(!(parsed.media_type==='image/png'&&Number.isSafeInteger(parsed.width)&&Number.isSafeInteger(parsed.height))&&!(parsed.media_type==='audio/wav'&&Number.isSafeInteger(parsed.duration_ms)))throw new Error();finish(null,parsed);}catch{finish(new Error('RESOURCE_WORKER_FAILED'));}});
  child.stdin.on('error',()=>{});child.stdin.end(bytes);
 });} finally {active--;}
}
/** PNG-only wrapper kept for existing callers. */
export async function inspectPngIsolated(bytes){const info=await inspectResourceIsolated(bytes);if(info.media_type!=='image/png')throw new Error('RESOURCE_INVALID');return info;}
