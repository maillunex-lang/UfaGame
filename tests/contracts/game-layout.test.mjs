import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../../packages/contracts/index.mjs';
const layout=()=>({version:1,nodes:[{id:'root',parent:null,type:'column'},{id:'title',parent:'root',type:'label',text:'Башкортостан'},{id:'play',parent:'root',type:'button',text:'Карта',action:'open_campaign'}]});
test('game layout accepts a bounded declarative screen',()=>assert.equal(validate('game_layout',layout()).ok,true));
test('rejects unsupported executable actions and bindings',()=>{
  for(const change of [{type:'button',text:'go',action:'execute'},{type:'binding',binding:'session.access_token'},{type:'script',text:'evil'}]){
    const v=layout();v.nodes[1]={id:'title',parent:'root',...change};assert.equal(validate('game_layout',v).ok,false);
  }
});
test('rejects orphan, cycle, duplicate and non-container parent',()=>{
  for(const nodes of [
    [{id:'aaa',parent:'missing',type:'column'}],
    [{id:'aaa',parent:'bbb',type:'column'},{id:'bbb',parent:'aaa',type:'row'}],
    [{id:'title',parent:'root',type:'label',text:'duplicate'}],
    [{id:'aaa',parent:'title',type:'label',text:'child'}]
  ]) { const v=layout();v.nodes.push(...nodes);assert.equal(validate('game_layout',v).ok,false); }
});
test('rejects excessive depth and multiple roots',()=>{
  const v=layout();let parent='root';for(let i=0;i<8;i++){const id=`node_${i}`;v.nodes.push({id,parent,type:'column'});parent=id;}
  assert.equal(validate('game_layout',v).ok,false);
  const other=layout();other.nodes.push({id:'other',parent:null,type:'column'});assert.equal(validate('game_layout',other).ok,false);
});
