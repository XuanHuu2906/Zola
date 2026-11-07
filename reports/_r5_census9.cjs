const fs=require('fs'),path=require('path');
const ROOT='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out=[];const log=(...a)=>out.push(a.join(' '));
const main=fs.readFileSync(path.join(ROOT,'main-dist/main.js'),'utf8');
const findAll=(s,n,max=30)=>{const h=[];let i=0;while((i=s.indexOf(n,i))!==-1){h.push(i);i+=n.length;if(h.length>=max)break;}return h;};

log('=== loadFile("...html") sites (main.js) ===');
for(const off of findAll(main,'.html"',40)){
  const snip=main.slice(Math.max(0,off-180),off+80);
  if(/loadFile|getHtml|loadURL/.test(snip)) log('  @'+off+' :: '+JSON.stringify(snip));
}
log('');

log('=== login.html references ===');
for(const off of findAll(main,'login.html',10)) log('  @'+off+' :: '+JSON.stringify(main.slice(Math.max(0,off-400),off+260)));
log('');

log('=== pc-dist/login.html head (first 1400 chars) ===');
log(fs.readFileSync(path.join(ROOT,'pc-dist/login.html'),'utf8').slice(0,1400));
log('');

log('=== Is login a separate BrowserWindow? search "login" near BrowserWindow opts ===');
for(const off of findAll(main,'"login"',20)) log('  @'+off+' :: '+JSON.stringify(main.slice(Math.max(0,off-260),off+260)));
log('');

log('=== webContents.send channels sample (unique-ish, 30) ===');
const re=/webContents\.send\("([^"]+)"/g;const ch=new Set();let m;
while((m=re.exec(main))) ch.add(m[1]);
log('  unique send channels: '+ch.size);
log('  '+[...ch].sort().join(' '));
log('');

log('=== any channel name containing style/css/theme ===');
log('  '+[...ch].filter(c=>/style|css|theme|glass|appearance/i.test(c)).join(' ') || '  (none)');
log('');

fs.writeFileSync(path.join(__dirname,'_r5_census9.txt'),out.join('\n')+'\n');
console.log(out.join('\n'));
