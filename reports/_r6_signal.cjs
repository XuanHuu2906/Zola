const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
let i=-1,c=0;
log('##### getDomainByType');
while((i=s.indexOf('getDomainByType',i+1))>0&&c<3){log('@'+i+': '+s.slice(Math.max(0,i-500),i+900).replace(/\s+/g,' '));log('');c++;}
log('##### SignalCommands enum');
i=s.indexOf('SignalCommands=');
log('@'+i);
if(i>0)log(s.slice(i,i+2600).replace(/\s+/g,' '));
log('');
log('##### cmd enum (P.k) e.g. AUTHEN=');
for(const k of ['AUTHEN:','PING:','KEEP_CONNECTION']){
  const j=s.indexOf(k);
  log(k+' -> '+j+(j>0?'  @'+s.slice(Math.max(0,j-500),j+300).replace(/\s+/g,' '):''));
  log('');
}
fs.writeFileSync(__dirname+'/_r6_signal.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,12000));
