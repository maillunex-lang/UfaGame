import {createPool,migrate} from './db.ts';
const pool=createPool();try{await migrate(pool);console.log('Migrations applied');}finally{await pool.end();}
