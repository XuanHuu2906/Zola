const fs=require('fs'),path=require('path');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out=[];const log=(...a)=>out.push(a.join(' '));
const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory()){if(e.name==='node_modules')continue;walk(p);}else if(e.name.endsWith('.js'))files.push(p);}})(ROOT);
log('js files scanned = '+files.length);
const re=/(readFileSync|readFile|createReadStream)\s*\(\s*([^,)]{0,120})/g;
const cssHits=[];
for(const f of files){const s=fs.readFileSync(f,'utf8');let m;
 while((m=re.exec(s))!==null){const arg=m[2];
  if(/\.css/.test(arg)||/css/i.test(arg)){cssHits.push({f:path.relative(ROOT,f),arg:arg.slice(0,100),ctx:s.slice(Math.max(0,m.index-150),m.index+150)});}}}
log('readFile* with css-ish arg = '+cssHits.length);
for(const h of cssHits.slice(0,15)){log('  ['+h.f+'] arg='+JSON.stringify(h.arg));log('    '+JSON.stringify(h.ctx));}
log('');
// any string literal ending .css that is passed to something write-y
const lit=[];
for(const f of files){const s=fs.readFileSync(f,'utf8');
 for(const m of s.matchAll(/"([^"]{1,120}\.css)"/g)){lit.push({f:path.relative(ROOT,f),v:m[1],ctx:s.slice(Math.max(0,m.index-120),m.index+120)});}}
log('".css" string literals = '+lit.length);
for(const h of lit.slice(0,20)){log('  ['+h.f+'] '+JSON.stringify(h.v));log('    '+JSON.stringify(h.ctx));}
fs.writeFileSync('D:/Zalo/reports/_r5_census28.txt',out.join('\n')+'\n');
console.log(out.join('\n'));
