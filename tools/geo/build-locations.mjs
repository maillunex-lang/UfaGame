#!/usr/bin/env node
// S21: builds content/geo/bashkortostan.locations.json from the saved Wikidata answer
// (CC0). Deterministic: the same raw file always gives the same output.
// Usage: node tools/geo/build-locations.mjs
import {readFileSync,writeFileSync} from 'node:fs';
const dir=new URL('../../content/geo/',import.meta.url);
const raw=JSON.parse(readFileSync(new URL('wikidata-raw.json',dir)));
const retrieved=readFileSync(new URL('retrieved-at.txt',dir),'utf8').trim().slice(0,10);
const translit={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const slug=s=>[...s.toLowerCase()].map(c=>translit[c]??c).join('').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const point=wkt=>{const m=/^Point\(([-0-9.]+) ([-0-9.]+)\)$/.exec(wkt);return m?{lon:Number(m[1]),lat:Number(m[2])}:null;};
const e6=v=>Math.round(v*1e6);
const km=(a,b)=>{const R=6371,r=d=>d*Math.PI/180,dLat=r(b.lat-a.lat),dLon=r(b.lon-a.lon);const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
const qid=uri=>uri.split('/').pop();
const byItem=new Map();
for(const b of raw.results.bindings){
 const id=qid(b.item.value);
 const rec=byItem.get(id)??{qid:id,ru:b.ru.value,ba:b.ba?.value,type:qid(b.type.value),coords:new Set(),centre:b.centreRu?.value,centreCoords:new Set()};
 if(b.coord)rec.coords.add(b.coord.value);if(b.centreCoord)rec.centreCoords.add(b.centreCoord.value);
 byItem.set(id,rec);
}
/** Several coordinates in Wikidata: take the most precise one (most decimals), then the smallest string. */
const pick=set=>[...set].sort((a,b)=>b.length-a.length||(a<b?-1:1))[0];
const entities=[],taken=new Set();
const republic={id:'republic_bashkortostan',kind:'location',name:'Республика Башкортостан',data:{level:'republic',name_ba:'Башҡортостан Республикаһы',lat_e6:e6(54.466666666),lon_e6:e6(56.266666666),source:{kind:'wikidata',id:'Q5710',retrieved}}};
entities.push(republic);
for(const rec of [...byItem.values()].sort((a,b)=>a.ru.localeCompare(b.ru,'ru'))){
 const city=rec.type==='Q13626398';
 // Urban okrug: the city itself; district: the district's own coordinate.
 const wkt=city?pick(rec.centreCoords.size?rec.centreCoords:rec.coords):pick(rec.coords.size?rec.coords:rec.centreCoords);
 let p=wkt&&point(wkt);if(!p)throw new Error('No coordinate: '+rec.qid+' '+rec.ru);
 // Consistency: a district point far (>80 km) from its own administrative centre is a
 // Wikidata error (seen for Фёдоровский район); then the centre's coordinate is used.
 let corrected;
 const centre=rec.centreCoords.size?point(pick(rec.centreCoords)):null;
 if(!city&&centre&&km(p,centre)>80){corrected={from_lat_e6:e6(p.lat),from_lon_e6:e6(p.lon),reason:'district point > 80 km from its centre; centre coordinate used'};p=centre;}
 const short=city?rec.ru.replace(/^городской округ (город |закрытое административно-территориальное образование )?/i,'').replace(/^ЗАТО /,'').replace(/^город /,''):rec.ru;
 let id=(city?'city_':'district_')+slug(city?short:rec.ru.replace(/ район$/,''));
 for(let n=2;taken.has(id);n++)id=id.replace(/_\d+$/,'')+'_'+n;taken.add(id);
 entities.push({id,kind:'location',name:city?`г. ${short}`:rec.ru,data:{level:city?'city':'district',parent_id:republic.id,...(rec.ba?{name_ba:city?rec.ba.replace(/ ҡалаһы.*$/,''):rec.ba}:{}),lat_e6:e6(p.lat),lon_e6:e6(p.lon),...(rec.centre?{centre_name:rec.centre}:{}),source:{kind:'wikidata',id:rec.qid,retrieved,candidates:rec.coords.size+rec.centreCoords.size,...(corrected?{corrected}:{})}}});
}
const out={format:'ufagame-geo/1',license:'CC0-1.0 (Wikidata)',attribution:'Данные: Wikidata (CC0). Проверка: © участники OpenStreetMap, ODbL (только отчет docs/reports/S21-geo-check.json).',retrieved,query:'content/geo/wikidata-query.sparql',entities};
writeFileSync(new URL('bashkortostan.locations.json',dir),JSON.stringify(out,null,1)+'\n');
console.log(`locations: ${entities.length} (republic 1, districts ${entities.filter(e=>e.data.level==='district').length}, cities ${entities.filter(e=>e.data.level==='city').length})`);
