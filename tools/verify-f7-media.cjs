// R11 — sweep every extracted Zalo JS bundle for media-capture APIs.
// F7's architectural claim must not rest on one file being scanned.
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node tools/verify-f7-media.cjs <extracted-asar-root>');
  process.exit(2);
}

const NAMES = [
  'getUserMedia', 'getDisplayMedia', 'mediaDevices',
  'RTCPeerConnection', 'RTCRtpSender', 'MediaStream',
];

const files = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.js$/.test(entry.name)) files.push(full);
  }
};
walk(ROOT);

const totals = Object.fromEntries(NAMES.map(name => [name, 0]));
const lines = [`JS bundles scanned: ${files.length}`, ''];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const hits = NAMES
    .map(name => [name, (source.match(new RegExp(name, 'g')) || []).length])
    .filter(([, count]) => count > 0);
  if (hits.length === 0) continue;
  lines.push(`${path.relative(ROOT, file).split(path.sep).join('/')}  ${JSON.stringify(Object.fromEntries(hits))}`);
  for (const [name, count] of hits) totals[name] += count;
}

lines.push('', '--- TOTALS ACROSS ALL BUNDLES ---', JSON.stringify(totals, null, 1), '');
lines.push('capture tokens found: ' + (totals.getUserMedia + totals.getDisplayMedia + totals.mediaDevices));
lines.push('RTCPeerConnection tokens: ' + totals.RTCPeerConnection);
lines.push('');
lines.push('Token counts alone are NOT a call-site count: a library may define an API it never calls.');
lines.push('Run tools/verify-f7-rtc-context.cjs for the resolved verdict (definition vs call site).');

const out = path.join(__dirname, '..', 'reports', '_r11_f7_media_sweep.txt');
fs.writeFileSync(out, lines.join('\n'));
console.log(lines.join('\n'));
