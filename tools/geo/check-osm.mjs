#!/usr/bin/env node
// S21: cross-checks every district/city of the Wikidata set against OpenStreetMap
// Nominatim (ODbL). Results are kept only as a verification report with attribution;
// no OSM data goes into game content. Respects the 1 request/second policy.
// Usage: node tools/geo/check-osm.mjs > docs/reports/S21-geo-check.json
import {readFileSync} from 'node:fs';
const set=JSON.parse(readFileSync(new URL('../../content/geo/bashkortostan.locations.json',import.meta.url)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const km=(a,b)=>{const R=6371,toRad=d=>d*Math.PI/180,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
const results=[];
for(const e of set.entities){
 if(e.data.level==='republic')continue;
 const city=e.data.level==='city',query=city?`${e.name.replace(/^г\. /,'')}, Башкортостан`:`${e.name}, Башкортостан`;
 const url='https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q:query,format:'json',limit:'5','accept-language':'ru'});
 let hits=[];
 for(let attempt=0;attempt<3;attempt++){
  try{const r=await fetch(url,{headers:{'User-Agent':'UfaGameStudio/0.1 (game content verification)'}});if(r.ok){hits=await r.json();break;}}catch{/* retry */}
  await sleep(2000);
 }
 await sleep(1100);
 const expected=city?e.name.replace(/^г\. /,''):e.name;
 if(!hits.some(h=>h.name===expected||h.name==='ЗАТО '+expected)){
  // Some names only resolve without the region suffix; retry with the bare name.
  try{const r=await fetch('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q:expected,format:'json',limit:'5','accept-language':'ru',countrycodes:'ru'}),{headers:{'User-Agent':'UfaGameStudio/0.1 (game content verification)'}});if(r.ok)hits=[...await r.json(),...hits];}catch{/* keep first answer */}
  await sleep(1100);
 }
 const hit=hits.find(h=>h.name===expected||h.name==='ЗАТО '+expected)??hits.find(h=>city?['city','town','administrative'].includes(h.type)||h.addresstype==='city'||h.addresstype==='town':h.type==='administrative')??hits[0];
 const ours={lat:e.data.lat_e6/1e6,lon:e.data.lon_e6/1e6};
 if(!hit){results.push({id:e.id,name:e.name,status:'not_found'});continue;}
 const [s,n,w,east]=hit.boundingbox.map(Number),osm={lat:Number(hit.lat),lon:Number(hit.lon)};
 const inside=ours.lat>=s&&ours.lat<=n&&ours.lon>=w&&ours.lon<=east;
 const distance=Math.round(km(ours,osm)*10)/10;
 const nameOk=hit.name===expected||hit.name==='ЗАТО '+expected;
 results.push({id:e.id,name:e.name,osm_name:hit.name,osm:`${hit.osm_type}/${hit.osm_id}`,inside_osm_bbox:inside,distance_km:distance,name_match:!!nameOk,status:inside&&nameOk?'ok':'review'});
 process.stderr.write(`${e.id}: ${results.at(-1).status} ${distance} km\n`);
}
console.log(JSON.stringify({checked_at:new Date().toISOString(),attribution:'Сверка: © участники OpenStreetMap, ODbL 1.0, https://osm.org/copyright (Nominatim). В игровые данные не переносится.',summary:{total:results.length,ok:results.filter(r=>r.status==='ok').length,review:results.filter(r=>r.status!=='ok').map(r=>r.id)},results},null,1));
