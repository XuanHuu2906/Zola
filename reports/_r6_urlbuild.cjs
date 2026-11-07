const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function ctx(label,needle,n=1,b=300,a=500){
  log('##### '+label+'  ['+needle+']');
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0&&c<n){log('@'+i+': '+s.slice(Math.max(0,i-b),i+a).replace(/\s+/g,' '));log('');c++;}
  if(!c)log('(none)');
}
ctx('_getCommonParams','_getCommonParams',2);
ctx('zalo.me base','https://zalo.me',2,200,300);
ctx('getCurrentApiDomain in renderer','getCurrentApiDomain',3,250,350);
ctx('zpw header','zpw_',2,200,300);
ctx('cookie','document.cookie',2,150,250);
fs.writeFileSync(__dirname+'/_r6_urlbuild.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,11000));
