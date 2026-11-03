import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '@ufagame/contracts';
test('live commands accept only explicit ordered commands',()=>{
 for(const message of [{type:'ability',seq:1,for_step:1,actor_id:'atk_0'},{type:'auto',seq:2,for_step:4,enabled:true}])assert.equal(validate('live_battle_command',message).ok,true);
 for(const message of [{type:'ability',seq:0,for_step:1,actor_id:'atk_0'},{type:'ability',seq:1,for_step:901,actor_id:'atk_0'},{type:'ability',seq:1,for_step:1,actor_id:'atk_0',damage:100},{type:'auto',seq:1,for_step:1,enabled:'true'},{type:'reward',seq:1,for_step:1},{type:'ability',seq:1,for_step:1,actor_id:'../x'}])assert.equal(validate('live_battle_command',message).ok,false);
});
