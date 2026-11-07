const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function all(needle,limit=3,b=350,a=650){
  log('##### '+needle);
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0&&c<limit){log('@'+i+': '+s.slice(Math.max(0,i-b),i+a).replace(/\s+/g,' '));log('');c++;}
  if(!c)log('(none)');
}
all('loginByPasswv2',2);
all('setDecryptKey',2);
all('decryptKey',2);
all('setUIN',2);
all('zpw_enk',3);
fs.writeFileSync(__dirname+'/_r6_login.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,11000));
