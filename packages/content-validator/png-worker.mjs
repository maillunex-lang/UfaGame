import {inspectPng} from './png.mjs';
const max=8*1024*1024,parts=[];let size=0;
try {
 for await(const chunk of process.stdin){size+=chunk.length;if(size>max)throw new Error('INPUT_LIMIT');parts.push(chunk);}
 process.stdout.write(JSON.stringify(inspectPng(Buffer.concat(parts,size))));
} catch {process.stderr.write('RESOURCE_INVALID');process.exitCode=1;}
