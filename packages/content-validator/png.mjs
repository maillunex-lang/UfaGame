import {crc32,inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
/** Error codes are stable and safe to show (no file content): PNG_CORRUPT, PNG_DIMENSIONS, PNG_BIT_DEPTH, PNG_COLOR_TYPE, PNG_INTERLACED. */
const fail=(code='PNG_CORRUPT')=>{const e=new Error('Invalid or unsupported PNG');e.code=code;throw e;};
/** Bounded PNG validation for an intentionally narrow non-interlaced 8-bit subset.
 * Not connected to uploads: production decoding must run isolated. */
export function inspectPng(bytes) {
 if(!Buffer.isBuffer(bytes)||bytes.length<45||bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(signature))fail();
 let pos=8,width=0,height=0,channels=0,colorType=-1,paletteSize=0,seenHeader=false,seenData=false,seenEnd=false,endedData=false;
 const parts=[];
 while(pos<bytes.length){
  if(bytes.length-pos<12)fail();const length=bytes.readUInt32BE(pos);
  if(length>bytes.length-pos-12)fail();
  const type=bytes.toString('ascii',pos+4,pos+8),data=bytes.subarray(pos+8,pos+8+length),expected=bytes.readUInt32BE(pos+8+length);
  if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(pos+4,pos+8+length))!==expected)fail();
  if(!seenHeader&&type!=='IHDR')fail();
  if(type==='IHDR'){
   if(seenHeader||length!==13)fail();seenHeader=true;width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   const colors={0:1,2:3,3:1,4:2,6:4};colorType=data[9];channels=colors[colorType]??0;
   if(!width||!height)fail();
   if(width>4096||height>4096||width*height>4000000)fail('PNG_DIMENSIONS');
   if(!channels)fail('PNG_COLOR_TYPE');
   if(data[8]!==8)fail('PNG_BIT_DEPTH');
   if(data[10]!==0||data[11]!==0)fail();
   if(data[12]!==0)fail('PNG_INTERLACED');
  }else if(type==='PLTE'){
   if(seenData||paletteSize||length%3!==0||length<3||length>768||colorType===0||colorType===4)fail();paletteSize=length/3;
  }else if(type==='IDAT'){
   if(colorType===3&&!paletteSize)fail();
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
 const row=width*channels+1,expectedSize=row*height,compressed=Buffer.concat(parts);
 let raw;try{const result=inflateSync(compressed,{maxOutputLength:expectedSize,info:true});if(result.engine.bytesWritten!==compressed.length)fail();raw=result.buffer;}catch{fail();}
 if(raw.length!==expectedSize)fail();
 const stride=width*channels,decoded=Buffer.alloc(stride*height);
 for(let y=0;y<height;y++){
  const filter=raw[y*row];if(filter>4)fail();
  // Palette indices must exist in PLTE; checked after unfiltering below.
  for(let x=0;x<stride;x++){
   const i=y*stride+x,left=x>=channels?decoded[i-channels]:0,up=y>0?decoded[i-stride]:0,upLeft=y>0&&x>=channels?decoded[i-stride-channels]:0;
   let predictor=0;
   if(filter===1)predictor=left;
   else if(filter===2)predictor=up;
   else if(filter===3)predictor=Math.floor((left+up)/2);
   else if(filter===4){const p=left+up-upLeft,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-upLeft);predictor=pa<=pb&&pa<=pc?left:pb<=pc?up:upLeft;}
   decoded[i]=(raw[y*row+1+x]+predictor)&255;
  }
 }
 if(colorType===3)for(const index of decoded)if(index>=paletteSize)fail();
 return {media_type:'image/png',width,height,pixel_sha256:createHash('sha256').update(decoded).digest('hex')};
}
