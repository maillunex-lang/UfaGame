import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateSync} from 'node:zlib';
import {inspectPng} from '../../packages/content-validator/png.mjs';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(name,data){const label=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([len,label,data,sum]);}
function png(width=1,height=1,pixels=Buffer.from([0,1,2,3,255])){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([signature,chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
test('valid PNG yields its decoded dimensions',()=>assert.deepEqual(inspectPng(png()),{media_type:'image/png',width:1,height:1}));
test('rejects malformed, corrupt, oversized, and incomplete PNG',()=>{
 const valid=png(),corrupt=Buffer.from(valid);corrupt[30]^=1;
 for(const bytes of [Buffer.from('not png'),corrupt,valid.subarray(0,-1),png(5000,1),png(1,1,Buffer.from([5,1,2,3,255])),png(1,1,Buffer.alloc(1000))])assert.throws(()=>inspectPng(bytes));
});
