const fs=require('fs');
const base='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js=fs.readFileSync(base+'compact-app-pc.f32c58b63b6f4273a8a4.js','latin1');
const targets=[12393315, 16713628, 5553773, 19646838];
for (const t of targets){
  // find nearest preceding `},Key:function(` or `Key:function(`
  const win = js.slice(Math.max(0,t-60000), t);
  const re = /[,{]([A-Za-z0-9_$+\/]{2,24}):function\(([^)]{0,80})\)\{/g;
  let m, last=null, all=[];
  while((m=re.exec(win))) all.push({key:m[1], params:m[2], at:Math.max(0,t-60000)+m.index});
  console.log(`\n=== target @${t} : ${all.length} candidate starts in 60k window ===`);
  for (const a of all.slice(-4)) console.log('   ', a.key, '| params:', a.params, '| @', a.at);
}
