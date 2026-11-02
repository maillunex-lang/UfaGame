import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {inspectPng} from '../../packages/content-validator/png.mjs';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(name,data){const label=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([len,label,data,sum]);}
function png(width=1,height=1,pixels=Buffer.from([0,1,2,3,255])){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([signature,chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
const expected={media_type:'image/png',width:1,height:1,pixel_sha256:createHash('sha256').update(Buffer.from([1,2,3,255])).digest('hex')};
test('valid PNG yields its decoded dimensions and pixel hash',()=>assert.deepEqual(inspectPng(png()),expected));
test('rejects malformed, corrupt, oversized, and incomplete PNG',()=>{
 const valid=png(),corrupt=Buffer.from(valid);corrupt[30]^=1;
 for(const bytes of [Buffer.from('not png'),corrupt,valid.subarray(0,-1),png(5000,1),png(1,1,Buffer.from([5,1,2,3,255])),png(1,1,Buffer.alloc(1000))])assert.throws(()=>inspectPng(bytes));
});
test('isolated worker validates a PNG and rejects corrupt input',async()=>{
 const {inspectPngIsolated}=await import('../../packages/content-validator/isolated-png.mjs');
 assert.deepEqual(await inspectPngIsolated(png()),expected);
 await assert.rejects(inspectPngIsolated(Buffer.from('broken')),/RESOURCE_INVALID/);
 await assert.rejects(inspectPngIsolated(Buffer.alloc(8*1024*1024+1)),/RESOURCE_LIMIT/);
});
test('equivalent filtered pixels have the expected reconstructed hash',()=>{
 const rows=Buffer.from([1,10,20,30,255,0,0,0,0,2,0,0,0,0,0,0,0,0]);
 const repeated=Buffer.from([10,20,30,255,10,20,30,255,10,20,30,255,10,20,30,255]);
 assert.equal(inspectPng(png(2,2,rows)).pixel_sha256,createHash('sha256').update(repeated).digest('hex'));
});
test('compressed payload with appended bytes is rejected even with a valid CRC',()=>{
 const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 const data=Buffer.concat([deflateSync(Buffer.from([0,1,2,3,255])),Buffer.from('junk')]);
 assert.throws(()=>inspectPng(Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',data),chunk('IEND',Buffer.alloc(0))])));
});
