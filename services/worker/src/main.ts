import {createPool} from '../../api/src/db.ts';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {runOnce} from './jobs.ts';
const pool=createPool(),worker=randomUUID();let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
try{while(!stopping){if(!await runOnce(pool,worker))await setTimeout(1000);}}finally{await pool.end();}
