const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function findAll(needle,limit=3,b=400,a=800){
  log('##### '+needle);
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0&&c<limit){log('@'+i+': '+s.slice(Math.max(0,i-b),i+a).replace(/\s+/g,' '));log('');c++;}
  if(!c)log('(none)');
}
findAll('getSocketUrl',4,500,900);
fs.writeFileSync(__dirname+'/_r6_sockurl.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,9000));
