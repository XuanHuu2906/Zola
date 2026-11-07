const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
const i=s.indexOf('"675T":function(');
log('module 675T @'+i);
const chunk=s.slice(i, i+26000);
// find the group declarations: const LETTER = i.a.NAME, s = { ... }
const re=/const ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.a\.([A-Z_]+),([A-Za-z_$][\w$]*)=\{/g;
let m;
log('=== DOMAIN GROUPS ===');
while((m=re.exec(chunk))){
  log(`  local=${m[1]}  src=${m[2]}.a.${m[3]}  table=${m[4]}  @module+${m.index}`);
}
log('');
log('=== FULL MODULE PREFIX (first 2200) ===');
log(chunk.slice(0,2200).replace(/\s+/g,' '));
fs.writeFileSync(__dirname+'/_r6_mod675T.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,7000));
