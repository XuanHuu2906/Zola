const fs=require('fs');
const base='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js=fs.readFileSync(base+'compact-app-pc.f32c58b63b6f4273a8a4.js','latin1');
const win=js.slice(12305492,12400000);
const re=/[^{,;}\s]?\s*"?([A-Za-z0-9_$+\/]{1,30})"?\s*:\s*function\s*\(([^)]*)\)/g;
let m,c=0;
while((m=re.exec(win))){ c++; if(c<=12) console.log('  @'+(12305492+m.index), '|', m[1], '|', m[2]); }
console.log('total name:function( in 12.305M..12.400M =', c);
console.log('\nwebpack runtime markers:');
for (const n of ['webpackJsonp','__webpack_require__','window.webpackJsonp','n.m=function','JSONP']) {
  const i=js.indexOf(n); console.log('  ', n, '@', i);
}
