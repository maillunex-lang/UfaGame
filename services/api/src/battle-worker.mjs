// Runs one battle off the API event loop (S17). Input/output are plain data.
import {parentPort,workerData} from 'node:worker_threads';
import {compileContentBattle,runAutoBattle,BattleCompileError} from '../../../packages/battle-core/compile.mjs';
try{
 const compiled=compileContentBattle(workerData.content,workerData.request);
 parentPort.postMessage({ok:true,result:runAutoBattle(compiled.setup,{heroes:compiled.heroes})});
}catch(error){
 parentPort.postMessage(error instanceof BattleCompileError?{ok:false,code:error.code,entity_id:error.entity_id}:{ok:false,code:'BATTLE_FAILED'});
}
