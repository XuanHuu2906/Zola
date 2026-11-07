const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
// find definition: _getCommonParams(){ ... } in a class/static
const re=/_getCommonParams\s*\(/g;let m;
while((m=re.exec(s))){
  const i=m.index;
  const pre=s.slice(Math.max(0,i-160),i);
  if(/static|_getCommonParams\(\)\{|function/.test(pre)||true){
    log('--- @'+i+' ---');
    log(s.slice(i-400,i+900).replace(/\s+/g,' '));
    log('');
  }
}
fs.writeFileSync(__dirname+'/_r6_commonparams.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,9000));
