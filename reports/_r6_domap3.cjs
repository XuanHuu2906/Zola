const fs=require('fs');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s=fs.readFileSync(ROOT+'/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js','utf8');
const rows=JSON.parse(fs.readFileSync(__dirname+'/_r6_cmdtable.json','utf8'));
const base=17326729; // pUq9 module
const modEnd=s.indexOf(':function(',base+200000);
// widen: search entire file for  const L=<x>.a.<GROUP>
const GROUPS=['ALIAS','CHAT','CONVERSATION','FILE','PHOTO','PHOTO_ORIGINAL','FRIEND','FRIEND_BOARD','GROUP','GROUP_BOARD','GROUP_POLL','LABEL','MEDIA_STORE','MEDIA_STORE_SEND2ME','OTHER_CONTACT','PROFILE','SP_CONTACT','STICKER','VOICE_CALL','FRIEND_LAN','ZALO_DEV','ZALO_DEV_V2','ZALO_DEV_V3','BOARD','REACTION','AUTO_REPLY','QUICK_MESSAGE','RECENT_SEARCH','CATALOG','GROUP_CLOUD','CHAT_E2EE','CHAT_E2EE_GROUP','QR_CODE','SYNC_ACTION','PUSH_ACTION','CLOUD_API','CLOUD_FAMILY_API','FALLBACK_LP','ZINSTANT_MSG','CONSENT','AEXTRA','MAINTENANCE','BACKUP_PC_MOBILE','EMOJI_STATUS','AI_FEATURES','BANNER'];
// only consider assignments inside the 675T module region
const t675=s.indexOf('"675T":function(');
const region=s.slice(t675,t675+120000);
const re=/([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.a\.([A-Z][A-Z0-9_]+)/g;
const map={};let m;
while((m=re.exec(region))){
  const local=m[1], g=m[3];
  if(GROUPS.includes(g) && !(local in map)) map[local]=g;
}
const out=[];const log=(...a)=>out.push(a.join(' '));
log('LOCAL -> GROUP: '+JSON.stringify(map));
log('');
const stat={};
for(const r of rows){ r.domainName = map[r.domain] || ('UNRESOLVED:'+r.domain); stat[r.domainName]=(stat[r.domainName]||0)+1; }
log('=== DOMAIN -> COUNT ===');
for(const [k,v] of Object.entries(stat).sort((a,b)=>b[1]-a[1])) log(`  ${k.padEnd(20)} ${v}`);
log('');
const order=Object.keys(stat).sort((a,b)=>stat[b]-stat[a]);
for(const d of order){
  log('');
  log('## '+d);
  for(const r of rows.filter(x=>x.domainName===d)) log(`   ${String(r.cmd).padEnd(8)} ${r.path}`);
}
fs.writeFileSync(__dirname+'/_r6_cmdtable.json',JSON.stringify(rows,null,1));
fs.writeFileSync(__dirname+'/_r6_cmdtable_domains.txt',out.join('\n')+'\n');
console.log(out.join('\n').slice(0,3000));
