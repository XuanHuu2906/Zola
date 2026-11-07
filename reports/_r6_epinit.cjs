const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function all(needle,limit=4,b=300,a=700){
  log('##### '+needle);
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0&&c<limit){log('@'+i+': '+s.slice(Math.max(0,i-b),i+a).replace(/\s+/g,' '));log('');c++;}
  if(!c)log('(none)');
}
all('Q=Y=q=',2,600,400);
all('chat_socket',4,250,450);
all('socket_endpoint',3,200,500);
all('getServerInfo(){',2,200,900);
fs.writeFileSync(__dirname+'/_r6_epinit.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,10000));
