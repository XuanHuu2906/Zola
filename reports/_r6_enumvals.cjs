const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
log('pUq9 occurrences:');
let i=-1,c=0;while((i=s.indexOf('pUq9',i+1))>0&&c<8){log('  @'+i+': '+s.slice(Math.max(0,i-60),i+80).replace(/\s+/g,' '));c++;}
log('');
// find the ALIAS/CHAT enum literal block
for(const g of ['ALIAS','CHAT','CONVERSATION','FILE','FRIEND','PROFILE','GROUP','GROUP_BOARD','GROUP_POLL']){
  const pats=['e.'+g+'="','.'+g+'="'];
  let found=-1;
  for(const p of pats){const j=s.indexOf(p);if(j>0){found=j;break;}}
  log(g+' -> '+(found>0?s.slice(Math.max(0,found-120),found+60).replace(/\s+/g,' '):'NOT FOUND'));
  log('');
}
// e domain single entry
const rows=JSON.parse(fs.readFileSync(__dirname+'/_r6_cmdtable.json','utf8'));
log('domain e entry: '+JSON.stringify(rows.filter(r=>r.domain==='e')));
fs.writeFileSync(__dirname+'/_r6_enumvals.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,6000));
