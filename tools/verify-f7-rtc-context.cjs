// R11 — resolve the F7 media question beyond bare token counts.
// Token counts alone cannot distinguish an Emscripten shim definition from a
// real capture call, so this settles: (a) whether any direct media primitive is
// invoked, (b) where each RTCPeerConnection site lives.
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node tools/verify-f7-rtc-context.cjs <extracted-asar-root>');
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

const PRIMITIVES = [
  'navigator.mediaDevices', 'mediaDevices.getUserMedia', 'enumerateDevices',
  'srcObject', 'RTCRtpSender', 'createDataChannel', 'getLocalIP',
];
const counts = Object.fromEntries(PRIMITIVES.map(p => [p, 0]));
const rtcSites = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const p of PRIMITIVES) {
    counts[p] += source.split(p).length - 1;
  }
  let index = source.indexOf('RTCPeerConnection');
  while (index !== -1) {
    rtcSites.push({ file: path.relative(ROOT, file).split(path.sep).join('/'), index });
    index = source.indexOf('RTCPeerConnection', index + 1);
  }
}

const lines = [`JS bundles scanned: ${files.length}`, '', '--- DIRECT MEDIA PRIMITIVES ---',
  JSON.stringify(counts, null, 1), '', '--- RTCPeerConnection SITES ---'];

const byFile = {};
for (const site of rtcSites) (byFile[site.file] ||= []).push(site.index);
for (const [file, offsets] of Object.entries(byFile)) {
  lines.push(`${file}  offsets ${JSON.stringify(offsets)}`);
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const offset of offsets) {
    const window = source.slice(Math.max(0, offset - 120), offset + 200).replace(/\s+/g, ' ');
    lines.push(`  @${offset}: ${window}`);
  }
}

lines.push('', '--- VERDICT ---');
lines.push('real capture call sites (getUserMedia/getDisplayMedia/mediaDevices invoked): ' +
  (counts['navigator.mediaDevices'] + counts['mediaDevices.getUserMedia']));
lines.push('RTCPeerConnection sites: ' + rtcSites.length);
lines.push('RTCRtpSender sites: ' + counts.RTCRtpSender);

const out = path.join(__dirname, '..', 'reports', '_r11_f7_media_context.txt');
fs.writeFileSync(out, lines.join('\n'));
console.log(lines.join('\n'));
