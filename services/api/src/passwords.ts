import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';
import {DomainError} from './errors.ts';
let active=0;const waiting:Array<()=>void>=[];
async function acquire(){if(active<2){active++;return;}if(waiting.length>=16)throw new DomainError('RATE_LIMITED',429);await new Promise<void>(resolve=>waiting.push(resolve));}
function release(){const next=waiting.shift();if(next)next();else active--;}
async function calculate(password:string,salt:Buffer){
 await acquire();try{return await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,key)=>error?reject(error):resolve(key)));}finally{release();}
}
export async function hashPassword(password:string){
 const salt=randomBytes(16);const key=await calculate(password,salt);
 return `scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password:string,encoded:string|null){
 if(!encoded){await hashPassword(password);return false;}
 const parts=encoded.split('$');if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='131072'||parts[2]!=='8'||parts[3]!=='1')return false;
 const salt=Buffer.from(parts[4],'base64url'),expected=Buffer.from(parts[5],'base64url');if(salt.length!==16||expected.length!==64)return false;
 return timingSafeEqual(await calculate(password,salt),expected);
}
