const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F=ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s=fs.readFileSync(F,'utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
log('file bytes: '+s.length);

// 1. all wss:// and /api/ literals
const wss=new Set(), api=new Set();
for(const m of s.matchAll(/["'`](wss:\/\/[^"'`\s]{0,120})["'`]/g))wss.add(m[1]);
for(const m of s.matchAll(/["'`](\/[a-z0-9_\-\/]{3,80})["'`]/gi))api.add(m[1]);
log('=== wss literals ('+wss.size+') ===');for(const x of [...wss].sort())log('  '+x);
log('=== /api-ish literals ('+api.size+') ===');
for(const x of [...api].sort())log('  '+x);

// 2. socket config call sites: search for "pingInterval" etc
log('');log('=== pingInterval/qosCmd contexts ===');
let i=0;while((i=s.indexOf('pingInterval',i+1))>0){log('@'+i+': '+JSON.stringify(s.slice(Math.max(0,i-260),i+260)));if(i>0&&out.length>80)break;}

fs.writeFileSync(__dirname+'/_r6_transport.txt',out.join('\n')+'\n');
console.log(out.join('\n'));
