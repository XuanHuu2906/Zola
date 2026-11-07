const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
let i=-1,c=0;
log('##### setEndpoints call sites');
while((i=s.indexOf('setEndpoints(',i+1))>0&&c<8){log('@'+i+': '+s.slice(Math.max(0,i-700),i+700).replace(/\s+/g,' '));log('');c++;}
log('');
log('##### zones/socket endpoint keys');
for(const k of ['zws','zsocket','chat_ws','ws_endpoint','socket_endpoint','strSocket','endpoints']){
  const j=s.indexOf('.'+k);
  log(k+' -> '+j+(j>0?'  ..'+s.slice(Math.max(0,j-160),j+220).replace(/\s+/g,' '):''));
}
fs.writeFileSync(__dirname+'/_r6_setep.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,10000));
