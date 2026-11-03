import {parentPort,workerData} from 'node:worker_threads';
import {compileContentBattle,BattleCompileError} from '../../../packages/battle-core/compile.mjs';
try {parentPort.postMessage({ok:true,compiled:compileContentBattle(workerData.content,workerData.request)});}
catch(error){parentPort.postMessage(error instanceof BattleCompileError?{ok:false,code:error.code,entity_id:error.entity_id}:{ok:false,code:'BATTLE_FAILED'});}
