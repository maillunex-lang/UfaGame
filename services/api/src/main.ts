import {createPool} from './db.ts';
import {buildApp} from './app.ts';
const pool=createPool();const app=await buildApp(pool);
const host=process.env.API_HOST??'127.0.0.1';const port=Number(process.env.API_PORT??0);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid API_PORT');
const address=await app.listen({host,port});console.log(`API listening: ${address}`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void app.close().then(()=>pool.end());});
