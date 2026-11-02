import {crc32,inflateSync} from 'node:zlib';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const fail=()=>{throw new Error('Invalid or unsupported PNG');};
/** Bounded PNG validation for an intentionally narrow non-interlaced 8-bit subset.
 * Not connected to uploads: production decoding must run isolated. */
export function inspectPng(bytes) {
 if(!Buffer.isBuffer(bytes)||bytes.length<45||bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(signature))fail();
 let pos=8,width=0,height=0,channels=0,seenHeader=false,seenData=false,seenEnd=false,endedData=false;
 const parts=[];
 while(pos<bytes.length){
  if(bytes.length-pos<12)fail();const length=bytes.readUInt32BE(pos);
  if(length>bytes.length-pos-12)fail();
  const type=bytes.toString('ascii',pos+4,pos+8),data=bytes.subarray(pos+8,pos+8+length),expected=bytes.readUInt32BE(pos+8+length);
  if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(pos+4,pos+8+length))!==expected)fail();
  if(!seenHeader&&type!=='IHDR')fail();
  if(type==='IHDR'){
   if(seenHeader||length!==13)fail();seenHeader=true;width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   const colors={0:1,2:3,4:2,6:4};channels=colors[data[9]]??0;
   if(!width||!height||width>4096||height>4096||width*height>4000000||data[8]!==8||!channels||data[10]!==0||data[11]!==0||data[12]!==0)fail();
  }else if(type==='IDAT'){
   if(endedData||seenEnd)fail();seenData=true;parts.push(data);
  }else if(type==='IEND'){
   if(!seenData||seenEnd||length!==0)fail();seenEnd=true;
  }else{
   if(seenData)endedData=true;
   if(type[0]===type[0].toUpperCase())fail();
  }
  pos+=length+12;if(seenEnd&&pos!==bytes.length)fail();
 }
 if(!seenEnd)fail();
 const row=width*channels+1,expectedSize=row*height;
 let raw;try{raw=inflateSync(Buffer.concat(parts),{maxOutputLength:expectedSize});}catch{fail();}
 if(raw.length!==expectedSize)fail();
 for(let y=0;y<height;y++)if(raw[y*row]>4)fail();
 return {media_type:'image/png',width,height};
}
