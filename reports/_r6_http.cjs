const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F=ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s=fs.readFileSync(F,'utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));

function ctx(needle,n=1,before=420,after=420){
  log('##### '+needle);
  let i=-1,c=0;
  while((i=s.indexOf(needle,i+1))>0 && c<n){
    log('@'+i);
    log(s.slice(Math.max(0,i-before),i+after).replace(/\s+/g,' '));
    log('');
    c++;
  }
  if(c===0) log('(none)');
}
ctx('/api/message/sms',1);
ctx('getCurrentApiDomain',2);
ctx('credentials:"include"',2);
ctx('withCredentials',2);
ctx('x-za-',3);
fs.writeFileSync(__dirname+'/_r6_http.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,9000));
