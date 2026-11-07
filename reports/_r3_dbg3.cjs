const fs=require('fs');
const base='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js=fs.readFileSync(base+'compact-app-pc.f32c58b63b6f4273a8a4.js','latin1');
// dump raw text around 12,393,315 to see the enclosing construct
const t=12393315;
console.log('--- 12.30M..12.40M module-ish markers ---');
const win=js.slice(12250000,12400000);
const re=/([A-Za-z0-9_$+\/\.]{1,30}):function\(/g; let m, c=0;
while((m=re.exec(win))) c++;
console.log('name:function( in window =', c);
// print 4000 chars ending at the target
console.log('\n--- ctx before target ---\n'+js.slice(t-3000,t+200));
