import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate,economyProblems} from '@ufagame/contracts';
import {economyContent} from '../fixtures/progression.mjs';
import {vipLevel,summonOdds,pull,accrue,payable,afkRate} from '../../packages/battle-core/economy.mjs';
const codes=c=>economyProblems(c).map(p=>p.code);
const edit=fn=>{const c=economyContent();fn(id=>c.entities.find(e=>e.id===id),c);return c;};
test('economy contract: valid fixture; wrong odds, guarantee, shards, VIP thresholds and missing free source refused',()=>{
 assert.equal(validate('content',economyContent()).ok,true);
 assert.equal(validate('content',edit(e=>{e('pool_main').data.entries[0].weight=0;})).ok,false,'zero weight');
 assert.equal(validate('content',edit(e=>{e('pool_main').data.entries[0].weight=1.5;})).ok,false,'fractional weight');
 assert.deepEqual(codes(edit(e=>{e('pool_main').data.entries.push({hero_id:'hero_missing',weight:1});})),['SUMMON_HERO_INVALID']);
 assert.deepEqual(codes(edit(e=>{e('pool_main').data.guarantee.hero_ids=['hero_c'];})),['SUMMON_GUARANTEE_NOT_IN_POOL'],'guarantee of a shard-only entry');
 assert.deepEqual(codes(edit(e=>{delete e('pool_main').data.shards_per_hero;})),['SUMMON_SHARDS_RECIPE_MISSING']);
 assert.deepEqual(codes(edit(e=>{e('pool_main').data.entries.push({hero_id:'hero_a',weight:3});})),['SUMMON_ENTRY_DUPLICATE']);
 assert.deepEqual(codes(edit(e=>{e('vip_main').data.levels[1].points=100;})),['VIP_POINTS_NOT_INCREASING']);
 assert.deepEqual(codes(edit(e=>{e('vip_main').data.tutorial_points=10;})),['VIP_TUTORIAL_BELOW_LEVEL_1']);
 assert.deepEqual(codes(edit(e=>{e('vip_main').data.daily_points=0;e('vip_main').data.win_points=0;})),['VIP_NO_FREE_SOURCE'],'VIP must be reachable without paying');
 assert.deepEqual(codes(edit((e,c)=>{c.entities.push({...e('afk_main'),id:'afk_two'});})),['AFK_DUPLICATE']);
 assert.equal(validate('content',edit(e=>{e('afk_main').data.per_hour=[{currency:'gems',amount:1}];})).ok,false,'AFK cannot pay gems');
 assert.equal(validate('content',edit((e,c)=>{c.required_capabilities=c.required_capabilities.filter(x=>x!=='summon.v1');})).ok,false,'capability');
});
test('economy formulas: VIP by points, odds, guarantee, AFK units and cap',()=>{
 const c=economyContent(),vip=c.entities.find(e=>e.kind==='vip').data,pool=c.entities.find(e=>e.kind==='summon_pool').data;
 assert.deepEqual([vipLevel(vip,99).level,vipLevel(vip,100).level,vipLevel(vip,999999999).level,vipLevel(vip,1000000000).level],[0,1,2,3]);
 assert.equal(summonOdds({entries:[{hero_id:'a',weight:1},{hero_id:'b',weight:2}]}).map(o=>o.chance_pct).join(),'33.33,66.67');
 // Always rolling hero_a (not in the guarantee) never resets the counter; every 3rd pull is forced.
 let since=0;const rolls=[];for(let i=0;i<6;i++){const r=pull(pool,since,()=>0);since=r.since;rolls.push(r.guaranteed);}
 assert.deepEqual(rolls,[false,false,true,false,false,true]);
 const s0={segment_at:0,accrued_ms:0,units:{},rate:afkRate({per_hour:[{currency:'gold',amount:100}],stage_bonus_bp:1000},2)};
 assert.deepEqual(s0.rate,{gold:120});
 const s1=accrue(s0,30*3600000,12*3600000);assert.equal(s1.accrued_ms,12*3600000);assert.deepEqual(payable(s1.units),{gold:1440});
 const s2=accrue({...s0,segment_at:0},1000,12*3600000);assert.deepEqual(payable(s2.units),{gold:0},'remainder kept as units');assert.equal(s2.units.gold,120000);
});
