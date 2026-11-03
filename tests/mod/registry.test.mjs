import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateSync} from 'node:zlib';
import {ResourceRegistry} from '../../packages/content-validator/resource-registry.mjs';
function chunk(name,data){const label=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([len,label,data,sum]);}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);}
const input=()=>({id:'hero_icon',bytes:png(),license:{name:'author-owned',attribution:'artist'},scale_bp:10000,anchor:{x:0,y:0},frames:[{x:0,y:0,width:1,height:1,duration_ms:100}],loop:true});
test('registers PNG and animation metadata without exposing mutable storage',async()=>{
 const r=new ResourceRegistry(),source=input(),saved=await r.addPng(source);assert.equal(saved.width,1);assert.equal(saved.frames[0].duration_ms,100);
 source.bytes.fill(0);saved.frames[0].width=999;const result=r.get('hero_icon');assert.equal(result.descriptor.frames[0].width,1);assert.equal(result.bytes[0],137);
 result.bytes.fill(0);assert.equal(r.get('hero_icon').bytes[0],137);assert.equal(r.list().length,1);
});
test('rejects corrupt images, missing frames, frame overflow and duplicate ids atomically',async()=>{
 const r=new ResourceRegistry();for(const mutate of [i=>i.bytes=Buffer.from('bad'),i=>i.frames=[],i=>i.frames[0].width=2,i=>i.license.name='']){const entry=input();mutate(entry);await assert.rejects(r.addPng(entry));assert.equal(r.list().length,0);}
 await r.addPng(input());await assert.rejects(r.addPng(input()),/DUPLICATE_RESOURCE/);assert.equal(r.list().length,1);
});
test('default frame covers the verified image when omitted',async()=>{
 const r=new ResourceRegistry(),item=input();delete item.frames;delete item.anchor;
 const result=await r.addPng(item);assert.deepEqual(result.anchor,{x:0,y:0});assert.deepEqual(result.frames,[{x:0,y:0,width:1,height:1,duration_ms:100}]);
});
