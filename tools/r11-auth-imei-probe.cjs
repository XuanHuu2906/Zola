// R11 — classify the login device identifier (imei) without printing secret values.
const fs = require('fs');

const file = process.argv[2];
const needle = process.argv[3] || 'getZaloClientID';
const src = fs.readFileSync(file, 'utf8');

let index = -1;
let shown = 0;
while ((index = src.indexOf(needle, index + 1)) !== -1 && shown < 40) {
  const window = src.slice(Math.max(0, index - 80), index + 200).replace(/\s+/g, ' ');
  // Only report definition-shaped occurrences, not call sites.
  if (/getZaloClientID\s*\(\s*\)\s*\{/.test(src.slice(index, index + 40))) {
    console.log('DEF @' + index);
    console.log(window);
    console.log('');
    shown++;
  }
}

// How is the stored identifier produced? Look for uuid generators near the IMEI key.
for (const k of ['z_uuid', 'uuidv4', 'randomUUID', 'generateUUID', 'getDeviceId']) {
  let i = -1;
  let c = 0;
  while ((i = src.indexOf(k, i + 1)) !== -1 && c < 4) {
    console.log('[' + k + '] @' + i + ' :: ' +
      src.slice(Math.max(0, i - 100), i + 160).replace(/\s+/g, ' '));
    c++;
  }
}
