const fs=require('fs');
const base='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js=fs.readFileSync(base+'compact-app-pc.f32c58b63b6f4273a8a4.js','latin1');
const win=js.slice(12270000,12400000);
// every `}:function(` or `,xxx:function(` marker
const re=/[},\{]([A-Za-z0-9_$+\/]{1,30}):function\(([^)]{0,40})\)/g; let m; const arr=[];
while((m=re.exec(win))) arr.push([12270000+m.index, m[1], m[2]]);
console.log('markers in 12.27M..12.40M:', arr.length);
for (const a of arr) console.log('  @'+a[0], a[1], '|', a[2]);
