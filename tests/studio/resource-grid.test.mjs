import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridFrames} from '../../apps/studio-web/src/resource-grid.mjs';
test('frame grid covers atlas in row-major order',()=>{
 const frames=gridFrames(6,4,3,2,150);assert.equal(frames.length,6);assert.deepEqual(frames[0],{x:0,y:0,width:2,height:2,duration_ms:150});assert.deepEqual(frames[5],{x:4,y:2,width:2,height:2,duration_ms:150});
});
test('rejects missing frames, non-divisible sizes, excess count and invalid duration',()=>{
 for(const args of [[6,4,0,1,100],[6,4,4,1,100],[121,1,121,1,100],[6,4,3,2,19],[6,4,3,2,NaN]])assert.throws(()=>gridFrames(...args));
});
