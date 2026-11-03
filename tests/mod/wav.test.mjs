import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectWav} from '../../packages/content-validator/wav.mjs';
import {inspectResourceIsolated,inspectPngIsolated} from '../../packages/content-validator/isolated-png.mjs';
function wav({channels=1,rate=8000,bits=16,samples=800,format=1,extra=null}={}){
 const align=channels*bits/8,data=Buffer.alloc(samples*align),fmt=Buffer.alloc(16);
 fmt.writeUInt16LE(format,0);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(rate,4);fmt.writeUInt32LE(rate*align,8);fmt.writeUInt16LE(align,12);fmt.writeUInt16LE(bits,14);
 const chunk=(id,b)=>{const h=Buffer.alloc(8);h.write(id,0,'ascii');h.writeUInt32LE(b.length,4);return Buffer.concat([h,b,b.length%2?Buffer.alloc(1):Buffer.alloc(0)]);};
 const body=Buffer.concat([Buffer.from('WAVE'),chunk('fmt ',fmt),...(extra?[chunk(extra[0],extra[1])]:[]),chunk('data',data)]);
 const head=Buffer.alloc(8);head.write('RIFF',0,'ascii');head.writeUInt32LE(body.length,4);return Buffer.concat([head,body]);
}
test('valid PCM WAV is described by content, with unknown metadata chunks skipped',()=>{
 assert.deepEqual(inspectWav(wav()),{media_type:'audio/wav',duration_ms:100,sample_rate:8000,channels:1,bits_per_sample:16});
 assert.equal(inspectWav(wav({extra:['LIST',Buffer.from('abc')]})).duration_ms,100);
});
test('rejects corrupt, truncated, non-PCM, oversized and too long WAV',()=>{
 const bad=[Buffer.from('not a wav at all, definitely not a wave file....'),wav().subarray(0,60),wav({format:3}),wav({channels:3}),wav({rate:96000}),wav({bits:24}),wav({samples:8000*121})];
 const sizeLie=wav();sizeLie.writeUInt32LE(9,4);bad.push(sizeLie);
 const badId=wav({extra:['\u0000\u0001ab',Buffer.alloc(2)]});bad.push(badId);
 for(const b of bad)assert.throws(()=>inspectWav(b));
 assert.throws(()=>inspectWav(Buffer.alloc(8*1024*1024+1)),/WAV_SIZE/);
});
test('isolated worker detects type by magic bytes, not extension; PNG wrapper refuses WAV',async()=>{
 assert.equal((await inspectResourceIsolated(wav())).media_type,'audio/wav');
 await assert.rejects(inspectPngIsolated(wav()),/RESOURCE_INVALID/);
 await assert.rejects(inspectResourceIsolated(Buffer.from('#!/bin/sh\necho hi\n')),/RESOURCE_INVALID/);
});
