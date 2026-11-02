import type {Pool,PoolClient} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {transaction} from './db.ts';
import {DomainError} from './errors.ts';
export interface Delta {playerId:string;currency:string;delta:number;reason:string;sourceId:string;key:string}
export async function applyDeltaTx(client:PoolClient,args:Delta) {
 const {playerId,currency,delta,reason,sourceId,key}=args;
 if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>2147483647||!/^[a-z][a-z0-9_]{2,79}$/.test(currency)||!/^[a-z][a-z0-9_]{2,79}$/.test(reason)||key.length<16||key.length>128||!sourceId||sourceId.length>128)throw new DomainError('INVALID_REQUEST');
 if(!(await client.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[playerId])).rowCount)throw new DomainError('NOT_FOUND',404);
 const fingerprint=createHash('sha256').update(JSON.stringify([currency,delta,reason,sourceId])).digest('hex');
 const old=await client.query('SELECT * FROM ledger WHERE player_id=$1 AND idempotency_key=$2',[playerId,key]);
 if(old.rowCount){if(old.rows[0].fingerprint!==fingerprint)throw new DomainError('CONFLICT',409);return map(old.rows[0]);}
 await client.query('INSERT INTO balances(player_id,currency) VALUES($1,$2) ON CONFLICT DO NOTHING',[playerId,currency]);
 const balance=Number((await client.query('SELECT amount FROM balances WHERE player_id=$1 AND currency=$2 FOR UPDATE',[playerId,currency])).rows[0].amount)+delta;
 if(balance<0)throw new DomainError('INSUFFICIENT_BALANCE',409);
 if(balance>2147483647)throw new DomainError('INVALID_REQUEST');
 await client.query('UPDATE balances SET amount=$3 WHERE player_id=$1 AND currency=$2',[playerId,currency,balance]);
 const row=(await client.query('INSERT INTO ledger(id,player_id,currency,delta,balance,reason,source_id,idempotency_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),playerId,currency,delta,balance,reason,sourceId,key,fingerprint])).rows[0];return map(row);
}
function map(row:any){return {id:row.id,player_id:row.player_id,currency:row.currency,delta:Number(row.delta),balance:Number(row.balance),reason:row.reason,source_id:row.source_id,idempotency_key:row.idempotency_key};}
export const applyDelta=(pool:Pool,args:Delta)=>transaction(pool,c=>applyDeltaTx(c,args));
