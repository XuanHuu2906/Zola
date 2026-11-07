const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
// every "<local> = <x>.a.<GROUP>" pattern where GROUP is UPPER_SNAKE
const re=/([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.a\.([A-Z][A-Z0-9_]{2,})/g;
const hits=[];let m;
while((m=re.exec(s))) hits.push({at:m.index,local:m[1],src:m[2],group:m[3]});
log('hits: '+hits.length);
const byGroup={};
for(const h of hits){ (byGroup[h.group]=byGroup[h.group]||new Set()).add(h.local); }
log('=== GROUP -> locals ===');
for(const [g,v] of Object.entries(byGroup).sort()) log(`  ${g.padEnd(22)} ${[...v].join(',')}`);
// find enum module: search for '<GROUP>:"ALIAS"' style definitions
log('');
log('=== enum definition sites ===');
for(const g of ['ALIAS','CHAT','CONVERSATION','FILE','FRIEND','PROFILE','EMOJI_STATUS']){
  const i=s.indexOf('e.'+g+'="');
  log(`  ${g}: @${i}`);
}
fs.writeFileSync(__dirname+'/_r6_domap2.txt',out.join('\n')+'\n');
console.log(out.join('\n'));
