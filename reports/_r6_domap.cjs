const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const rows=JSON.parse(fs.readFileSync(__dirname+'/_r6_cmdtable.json','utf8'));
const out=[];const log=(...a)=>out.push(a.join(' '));
const base=s.indexOf('"675T":function(');
const chunk=s.slice(base, base+60000);
const re=/const ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.a\.([A-Z_]+),([A-Za-z_$][\w$]*)=\{/g;
const groups=[];let m;
while((m=re.exec(chunk))) groups.push({local:m[1],group:m[3],table:m[4],at:m.index});
const byLocal=new Map(groups.map(g=>[g.local,g]));
// map each table var -> domain (tables start with "X={" after local decl)
const dom={};
for(const g of groups){dom[g.local]=g.group;}
log('MAPPED DOMAINS: '+groups.map(g=>g.local+'='+g.group).join(' '));
log('');
const stat={};
for(const r of rows){const g=dom[r.domain]||('UNKNOWN_'+r.domain);r.domainName=g;stat[g]=(stat[g]||0)+1;}
log('=== DOMAIN -> COMMAND COUNT ===');
for(const [k,v] of Object.entries(stat).sort((a,b)=>b[1]-a[1])) log(`  ${k.padEnd(18)} ${v}`);
log('');
for(const d of Object.keys(stat)){}
const order=['CHAT','FILE','CONVERSATION','FRIEND','PROFILE','ALIAS','EMOJI_STATUS'];
const unk=Object.keys(stat).filter(k=>!order.includes(k));
log('unmapped letters: '+(unk.length?unk.join(','):'none'));
fs.writeFileSync(__dirname+'/_r6_cmdtable.json',JSON.stringify(rows,null,1));
fs.writeFileSync(__dirname+'/_r6_domap.txt',out.join('\n')+'\n');
console.log(out.join('\n'));
