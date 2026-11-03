import {inspectPng} from './png.mjs';
import {inspectWav} from './wav.mjs';
const max=8*1024*1024,parts=[];let size=0;
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
try {
 for await(const chunk of process.stdin){size+=chunk.length;if(size>max)throw new Error('INPUT_LIMIT');parts.push(chunk);}
 const bytes=Buffer.concat(parts,size);
 // Dispatch by magic bytes only; extensions and client MIME types are ignored.
 const info=bytes.subarray(0,8).equals(PNG)?inspectPng(bytes):bytes.toString('ascii',0,4)==='RIFF'?inspectWav(bytes):(()=>{throw new Error('UNKNOWN_TYPE');})();
 process.stdout.write(JSON.stringify(info));
} catch(error) {
 // Only a fixed code leaves the worker (never file data).
 const code=/^(PNG|WAV)_[A-Z_]{3,30}$/.test(error?.code??error?.message??'')?(error.code??error.message):'RESOURCE_INVALID';
 process.stderr.write(code);process.exitCode=1;
}
