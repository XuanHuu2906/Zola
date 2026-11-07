const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
for(const pat of ['pUq9:function','"pUq9":function','pUq9:','"pUq9"']){
  const i=s.indexOf(pat);
  log(pat+' -> '+i);
}
const i=s.indexOf('pUq9:function');
if(i>0){ log(''); log(s.slice(i,i+2500).replace(/\s+/g,' ')); }
fs.writeFileSync(__dirname+'/_r6_puq9.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,6000));
