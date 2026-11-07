const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F=ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s=fs.readFileSync(F,'utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));

// entries like  {domainType:X,commandId:N,path:"/api/..."}
const re = /\{domainType:([A-Za-z_$][\w$]*),commandId:([A-Za-z_$][\w$]*|\d+),path:("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$.]*)\}/g;
const rows=[];
let m;
while((m=re.exec(s))){rows.push({off:m.index,domain:m[1],cmd:m[2],path:m[3]});}
log('entries: '+rows.length);
// group by contiguous region
const byPath=new Map();
for(const r of rows) if(!byPath.has(r.path)) byPath.set(r.path,r);
log('unique paths: '+byPath.size);
// domain types
const doms={};for(const r of rows)doms[r.domain]=(doms[r.domain]||0)+1;
log('domainType histogram: '+JSON.stringify(doms));
log('');
for(const r of rows) log(`${String(r.cmd).padEnd(12)} ${r.domain.padEnd(8)} ${r.path}`);
fs.writeFileSync(__dirname+'/_r6_cmdtable.txt',out.join('\n')+'\n');
fs.writeFileSync(__dirname+'/_r6_cmdtable.json',JSON.stringify(rows,null,1));
console.log(out.slice(0,12).join('\n'));
