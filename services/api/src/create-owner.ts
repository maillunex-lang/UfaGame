import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createPool} from './db.ts';
import {createOwner} from './owner.ts';
const login=process.env.UFAGAME_OWNER_LOGIN,path=process.env.UFAGAME_OWNER_PASSWORD_FILE;
if(!login||!path)throw new Error('Set UFAGAME_OWNER_LOGIN and private UFAGAME_OWNER_PASSWORD_FILE');
const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let password:string;
try{const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>1024)throw new Error('Password file must be a regular private0600 file');password=(await file.readFile('utf8')).replace(/\r?\n$/,'');}finally{await file.close();}
const pool=createPool();try{await createOwner(pool,login,password);console.log('Owner id1 provisioned; no public signup or default password');}finally{await pool.end();}
