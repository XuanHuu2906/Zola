const fs=require('fs'),path=require('path');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const pcd=path.join(ROOT,'pc-dist');
const out=[];const log=(...a)=>out.push(a.join(' '));
const files=[];(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())walk(p);else if(e.name.endsWith('.css'))files.push(p);}})(pcd);
const props=new Set();
for(const f of files){const c=fs.readFileSync(f,'utf8');
 for(const m of c.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g))props.add(m[1]);}
const strictRaw=[...props].filter(p=>/^--[A-Z][A-Za-z]{0,3}\d{1,3}$/.test(p));
log('total = '+props.size);
log('strict raw palette (--UPPER##) = '+strictRaw.length);
log('   samples: '+JSON.stringify(strictRaw.slice(0,20)));
log('non-raw = '+(props.size-strictRaw.length));
fs.writeFileSync('D:/Zalo/reports/_r5_census29.txt',out.join('\n')+'\n');
console.log(out.join('\n'));
