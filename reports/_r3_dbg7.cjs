const fs=require('fs');
const base='C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js=fs.readFileSync(base+'compact-app-pc.f32c58b63b6f4273a8a4.js','latin1');
console.log('=== after Zb+t end (12305492) next 1500 chars ===');
console.log(JSON.stringify(js.slice(12305492, 12307000)));
