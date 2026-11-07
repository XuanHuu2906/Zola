const fs=require('fs'),path=require('path');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const dir=path.join(ROOT,'main-dist');
const names=fs.readdirSync(dir).filter(f=>f.endsWith('.js'));
const keys=['insertCSS','executeJavaScript','addStyleSheet','adoptedStyleSheets','setBackgroundMaterial','vibrancy','Vibrancy','backgroundMaterial','nativeTheme','themeSource','titleBarOverlay','visualEffectState','transparent:!0','webContents.send','loadExtension','will-attach-webview','BrowserView','WebContentsView','--inspect','remote-debugging'];
const rows=[];
for(const f of names){
  const s=fs.readFileSync(path.join(dir,f),'utf8');
  const r={file:f,bytes:s.length};
  for(const k of keys){let c=0,i=0;while((i=s.indexOf(k,i))!==-1){c++;i+=k.length;}r[k]=c;}
  rows.push(r);
}
const out=[];
out.push('file\tbytes\t'+keys.join('\t'));
for(const r of rows) out.push(r.file+'\t'+r.bytes+'\t'+keys.map(k=>r[k]).join('\t'));
// also pc-dist html files
const pcd=path.join(ROOT,'pc-dist');
if(fs.existsSync(pcd)){
  out.push('');
  out.push('=== pc-dist html ===');
  for(const f of fs.readdirSync(pcd).filter(f=>f.endsWith('.html'))){
    const s=fs.readFileSync(path.join(pcd,f),'utf8');
    out.push(f+' bytes='+s.length+' cspMeta='+ /http-equiv=["']Content-Security-Policy/i.test(s)+' styleTags='+(s.match(/<style/gi)||[]).length+' scriptTags='+(s.match(/<script/gi)||[]).length);
  }
}
// native dir binaries
const nat=path.join(ROOT,'native');
const bins=[];
const walk=(d,depth)=>{ if(depth>4) return; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p,depth+1); else if(/\.(node|dll|exe)$/i.test(e.name)) bins.push([path.relative(ROOT,p), fs.statSync(p).size]); } };
if(fs.existsSync(nat)) walk(nat,0);
out.push('');
out.push('=== native binaries (.node/.dll/.exe) ===');
for(const [p,s] of bins.sort()) out.push('  '+p+' '+s);
const txt=out.join('\n');
fs.writeFileSync(path.join(__dirname,'_r5_census8.txt'),txt+'\n');
console.log(txt);
