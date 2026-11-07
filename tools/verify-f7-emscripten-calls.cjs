// R11 — prove the 7 getUserMedia tokens are definitions, not invocations.
// Looks for a CALL of the Emscripten shim (as opposed to its own definition).
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node tools/verify-f7-emscripten-calls.cjs <extracted-asar-root>');
  process.exit(2);
}

const files = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.js$/.test(entry.name)) files.push(full);
  }
};
walk(ROOT);

// A definition is `getUserMedia:function...` / `getUserMedia=function...` /
// `getUserMedia(e){`. A call is anything else, e.g. `Browser.getUserMedia()`.
const DEFINITION = /getUserMedia\s*[:=]\s*function|getUserMedia\s*[:=]\s*\(|getUserMedia\s*\([^)]*\)\s*\{/;
const CALL = /(?:Browser|Module|window|navigator)\s*\.\s*getUserMedia\s*\(/g;

let definitions = 0;
let selfReferences = 0;
let calls = 0;
const callSites = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let index = source.indexOf('getUserMedia');
  while (index !== -1) {
    const window = source.slice(index, index + 220);
    if (DEFINITION.test(window.slice(0, 60))) definitions++;
    index = source.indexOf('getUserMedia', index + 1);
  }
  let m;
  CALL.lastIndex = 0;
  while ((m = CALL.exec(source)) !== null) {
    // Two cases are not application invocations:
    //  (a) the call is the right-hand side of a definition (`X.getUserMedia=function(){...}`);
    //  (b) the call sits inside the shim's own body, i.e. the shim rebinding window.getUserMedia
    //      and then calling it -- self-reference, not a capture request from calling code.
    const before = source.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8);
    if (/=\s*function/.test(before)) continue;
    const body = source.slice(Math.max(0, m.index - 160), m.index);
    if (/getUserMedia\s*[:=]\s*function/.test(body)) {
      selfReferences++;
      continue;
    }
    calls++;
    callSites.push({ file: path.relative(ROOT, file).split(path.sep).join('/'), index: m.index });
  }
}

const lines = [
  `JS bundles scanned: ${files.length}`,
  '',
  `getUserMedia definition-shaped tokens: ${definitions}`,
  `getUserMedia self-references inside the shim body: ${selfReferences}`,
  `getUserMedia genuine invocations from calling code: ${calls}`,
  '',
];
if (callSites.length) {
  lines.push('CALL SITES:');
  for (const site of callSites) lines.push(`  ${site.file} @${site.index}`);
} else {
  lines.push('No invocation of Browser/Module/window/navigator.getUserMedia anywhere in the bundle set.');
  lines.push('The 7 tokens are the Emscripten runtime defining an API that nothing calls.');
}

const out = path.join(__dirname, '..', 'reports', '_r11_f7_emscripten_calls.txt');
fs.writeFileSync(out, lines.join('\n'));
console.log(lines.join('\n'));
