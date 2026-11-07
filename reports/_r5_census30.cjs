const fs=require('fs'),path=require('path');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const pcd=path.join(ROOT,'pc-dist');const out=[];const log=(...a)=>out.push(a.join(' '));
// 1. emittable set from census23 logic
const s=fs.readFileSync(path.join(pcd,'lazy','default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js'),'utf8');
const idx=s.indexOf('TmDO:function');
const m=/,([A-Za-z0-9_+$\/.-]{2,24}):function\([a-z],[a-z],[a-z]\)\{/.exec(s.slice(idx,idx+400000));
const body=s.slice(idx,m?idx+m.index:idx+400000);
const lightAt=body.indexOf('f={light:['),darkAt=body.indexOf('],dark:[',lightAt);
const lightSeg=body.slice(lightAt,darkAt);
const mm=/\bI=\[((?:"[^"]+"\s*,?\s*)+)\]/.exec(body);
const aliases=mm?[...mm[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]):[];
const lightFull=[...lightSeg.matchAll(/\{token_name:"([^"]+)",alias:"([^"]+)",step:"?(\d+)"?,color:/g)].map(x=>({token:x[1],alias:x[2]}));
const emittable=lightFull.filter(r=>aliases.includes(r.alias)&&!['input-field-bg','border','divider'].some(c=>r.token.includes(c)));
log('aliases = '+JSON.stringify(aliases));
log('emittable records = '+emittable.length+' ; unique = '+new Set(emittable.map(r=>r.token)).size);
// 2. shipped props
const files=[];(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())walk(p);else if(e.name.endsWith('.css'))files.push(p);}})(pcd);
const props=new Set();
for(const f of files){const c=fs.readFileSync(f,'utf8');for(const x of c.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g))props.add(x[1]);}
const uniq=[...new Set(emittable.map(r=>r.token))];
const present=uniq.filter(t=>props.has(t));const missing=uniq.filter(t=>!props.has(t));
log('emittable unique='+uniq.length+' present-in-css='+present.length+' missing='+missing.length);
log('missing list = '+JSON.stringify(missing));
// 3. do .custom rules consume custom props?
let customs=0,varUse=0;
for(const f of files){const c=fs.readFileSync(f,'utf8');
 for(const r of c.matchAll(/\.custom[^{,]*\{([^}]*)\}/g)){customs++;for(const v of r[1].matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)){varUse++;}}}
log('.custom rules='+customs+' ; var() references inside='+varUse);
fs.writeFileSync('D:/Zalo/reports/_r5_census30.txt',out.join('\n')+'\n');console.log(out.join('\n'));
