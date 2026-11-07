const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
function mod(id,n=2600){
  const i=s.indexOf('"'+id+'":function(');
  if(i<0){log('## '+id+' NOT FOUND');return;}
  log('## '+id+' @'+i);
  log(s.slice(i,i+n).replace(/\s+/g,' '));
  log('');
}
mod('pUq9',3000);
// also find the registration helper ending "(t,n,a)})"
const j=s.indexOf('{domainType:e,commandId:t,path:n}');
log('helper @'+j);
log(s.slice(Math.max(0,j-900),j+200).replace(/\s+/g,' '));
fs.writeFileSync(__dirname+'/_r6_enums2.txt',out.join('\n')+'\n');
console.log(out.join('\n'));
