import {readdirSync, mkdirSync, copyFileSync} from 'node:fs';
const source=new URL('../packages/contracts/',import.meta.url);
for (const target of ['../apps/game/contracts/','../apps/studio-android/assets/contracts/']) {
 const destination=new URL(target,import.meta.url);mkdirSync(destination,{recursive:true});
 for(const name of readdirSync(source).filter(n=>n.endsWith('.schema.json')||n==='capabilities.json')) copyFileSync(new URL(name,source),new URL(name,destination));
}
