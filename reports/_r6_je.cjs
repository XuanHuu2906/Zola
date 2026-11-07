const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const out=[];const log=(...a)=>out.push(a.join(' '));
const i=s.indexOf('apiChatDomain:`https://chat-wpa.${Je}`');
const seg=s.slice(Math.max(0,i-3500),i);
log('=== BEFORE domain table (2500) ===');
log(seg.slice(-2500).replace(/\s+/g,' '));
log('');
// find se definition near _constructUrlParams
const j=s.indexOf('_constructUrlParams');
log('=== _constructUrlParams @'+j+' ===');
log(s.slice(j-2400,j+1200).replace(/\s+/g,' '));
fs.writeFileSync(__dirname+'/_r6_je.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,8000));
