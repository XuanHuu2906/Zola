const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function ctx(label,needle,n=1,b=500,a=900){
  log('##### '+label);
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0&&c<n){log('@'+i+': '+s.slice(Math.max(0,i-b),i+a).replace(/\s+/g,' '));log('');c++;}
  if(!c)log('(none)');
}
ctx('authDomain config block','authDomain:',2,600,1200);
ctx('apiVersion/apiType','apiVersion:',1,600,900);
ctx('se = { common params','_constructUrlParams',1,300,700);
fs.writeFileSync(__dirname+'/_r6_authdomain.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,10000));
