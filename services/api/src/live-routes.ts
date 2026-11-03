import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {bearer} from './auth.ts';
import {DomainError} from './errors.ts';
import {advanceDue,attachLive,detachLive,liveSnapshot,readFrames,renewLive,startLiveBattle,submitLive} from './live-battles.ts';

export async function registerLiveRoutes(app:FastifyInstance,pool:Pool){
 app.post('/v1/live-battles',{config:{rateLimit:{max:30,timeWindow:60000}}},async request=>startLiveBattle(pool,bearer(request),request.body));
 app.get('/v1/live-battles/:id',async request=>liveSnapshot(pool,bearer(request),(request.params as any).id));
 const preValidation=async(request:FastifyRequest)=>{
  const query=request.query as Record<string,unknown>;
  if(Object.keys(query).some(key=>key!=='after')||(query.after!==undefined&&(typeof query.after!=='string'||!/^(0|[1-9][0-9]{0,2})$/.test(query.after)||Number(query.after)>900)))throw new DomainError('INVALID_REQUEST');
  await liveSnapshot(pool,bearer(request),(request.params as any).id);
 };
 app.get('/v1/live-battles/:id/stream',{websocket:true,preValidation},(socket,request)=>{
  const token=bearer(request),id=(request.params as any).id,connectionId=randomUUID();
  const after=(request.query as any).after;let cursor=0,snapshotSeq=0,closed=false,polling=false,windowAt=Date.now(),windowCount=0,inflight=0;
  let chain=Promise.resolve();
  const send=(value:any)=>{if(socket.readyState!==1)return;if(socket.bufferedAmount>1024*1024){socket.close(1013,'BACKPRESSURE');return;}socket.send(JSON.stringify(value));};
  const ready=attachLive(pool,token,id,connectionId).then(snapshot=>{
   if(closed){void detachLive(pool,id,connectionId).catch(()=>{});throw new Error('SOCKET_CLOSED');}
   snapshotSeq=snapshot.event_seq;cursor=after===undefined?snapshotSeq:Number(after);
   if(cursor>snapshotSeq){socket.close(1008,'INVALID_CURSOR');throw new Error('INVALID_CURSOR');}
   send({type:'snapshot',snapshot});return snapshot;
  });
  void ready.catch(()=>{if(socket.readyState===1)socket.close(1011,'SESSION_FAILED');});
  socket.on('message',(data:Buffer,isBinary:boolean)=>{
   if(isBinary){socket.close(1003,'TEXT_ONLY');return;}
   const now=Date.now();if(now-windowAt>=1000){windowAt=now;windowCount=0;}if(++windowCount>20||++inflight>8){socket.close(1008,'RATE_LIMIT');return;}
   chain=chain.then(async()=>{
    await ready;let command:any;
    try{command=JSON.parse(data.toString());}catch{send({type:'error',code:'INVALID_REQUEST'});return;}
    try{const ack=await submitLive(pool,token,id,connectionId,command);send({type:'ack',ack});}
    catch(error){const e=error as any;send({type:'error',seq:Number.isSafeInteger(command?.seq)?command.seq:undefined,code:error instanceof DomainError?(e.detail??e.code):'INTERNAL_ERROR'});}
   }).catch(()=>{if(socket.readyState===1)socket.close(1011,'SESSION_FAILED');}).finally(()=>{inflight--;});
  });
  const poll=async()=>{
   if(closed||polling||socket.readyState!==1)return;polling=true;
   try{
    await ready;const snapshot=await renewLive(pool,token,id,connectionId),frames=await readFrames(pool,token,id,cursor);
    for(const frame of frames){if(frame.seq!==cursor+1)throw new Error('FRAME_GAP');send({type:'frame',frame,replayed:frame.seq<=snapshotSeq});cursor=frame.seq;}
    if(snapshot.result!==null&&cursor>=snapshot.event_seq)socket.close(1000,'BATTLE_FINISHED');
   }catch(error){if(socket.readyState===1)socket.close(error instanceof DomainError&&error.code==='UNAUTHORIZED'?1008:1011,'SESSION_CLOSED');}
   finally{polling=false;}
  };
  const timer=setInterval(()=>{void poll();},250);timer.unref();void ready.then(()=>poll()).catch(()=>{});
  socket.on('close',()=>{closed=true;clearInterval(timer);void ready.then(()=>detachLive(pool,id,connectionId)).catch(()=>{});});
  socket.on('error',()=>{if(socket.readyState===1)socket.close(1011,'SOCKET_ERROR');});
 });
 let stopped=false,running=false,timer:NodeJS.Timeout|undefined;
 const schedule=(delay:number)=>{if(stopped)return;timer=setTimeout(()=>{void tick();},delay);timer.unref();};
 const tick=async()=>{if(stopped||running)return;running=true;let processed=0;try{for(;processed<16;processed++)if(!await advanceDue(pool))break;}catch{/* The next bounded poll retries; no credentials are logged. */}finally{running=false;schedule(processed?50:500);}};
 app.addHook('onReady',async()=>{schedule(100);});
 app.addHook('onClose',async()=>{stopped=true;if(timer)clearTimeout(timer);});
}
