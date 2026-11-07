const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
const i=s.indexOf('A={AUTHEN:1,PING:2,PING_ACTIVE:4,');
const seg=s.slice(i,i+3000);
log('=== WS CMD ENUM ===');
log(seg.replace(/\s+/g,' ').slice(0,2600));
const j=s.indexOf('subCmd',i);
log('');
// find the subcommand enum M next to it
const m=seg.match(/\}\s*,\s*([A-Za-z_$][\w$]*)=\{([A-Z_0-9]+:\d+,?){3,}/);
log('subenum: '+JSON.stringify(m&&m[0].slice(0,1200)));
fs.writeFileSync(__dirname+'/_r6_cmdenum.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,9000));
