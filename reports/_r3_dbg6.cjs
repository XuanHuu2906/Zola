const fs=require('fs');
const ivs=JSON.parse(fs.readFileSync('D:/Zalo/reports/_r3_modules6_intervals.json','utf8'));
const off=12393315;
const hits=ivs.filter(v=>v[1]<off && v[2]>off);
console.log('intervals containing', off, '=', hits.length);
for (const h of hits.slice(0,6)) console.log('  ', h[0], '@'+h[1], 'end='+h[2], 'len='+(h[2]-h[1]));
console.log('\nnearest starts before off (last 6):');
const before=ivs.filter(v=>v[1]<=off).slice(-6);
for (const b of before) console.log('  ', b[0], '@'+b[1], 'end='+b[2]);
