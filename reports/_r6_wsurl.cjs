const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function ctx(label,needle,n=2,b=450,a=750){
  log('##### '+label);
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0&&c<n){log('@'+i+': '+s.slice(Math.max(0,i-b),i+a).replace(/\s+/g,' '));log('');c++;}
  if(!c)log('(none)');
}
ctx('wss://zalo.me','wss://zalo.me',1,500,700);
ctx('_configure call','_configure({',2,400,600);
ctx('socket-url builder','socketUrl',2,300,400);
ctx('zalo_chat ws endpoint','/ws?',2,350,450);
ctx('cmd enum P.k','PING:',1,300,600);
fs.writeFileSync(__dirname+'/_r6_wsurl.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,9000));
