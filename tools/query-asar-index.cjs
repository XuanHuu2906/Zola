// Query the file index of an ASAR archive without reading any payload.
// Only the JSON header is parsed; entry names and sizes come from that index.
const fs = require('node:fs');

function readHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4); // includes 4-byte payload-size prefix
    const jsonLength = head.readUInt32LE(12);
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) throw new Error(`Implausible header length ${jsonLength}`);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    // File entry offsets are relative to the data section, which starts right
    // after the 8-byte size pickle and the header pickle (4-byte aligned).
    return { json: JSON.parse(json.toString('utf8')), base: 8 + headerPickleSize };
  } finally {
    fs.closeSync(fd);
  }
}

// Read one file payload by index path. Only for small text metadata such as
// package.json; refuses anything over the cap so chat/media assets are unreachable.
function readFilePayload(asarPath, base, entry, capBytes) {
  if (entry.unpacked) throw new Error(`${entry.path} is unpacked (stored outside the archive)`);
  if (entry.size > capBytes) throw new Error(`Refusing ${entry.size} B > cap ${capBytes} B`);
  const size = Number(entry.size);
  const buf = Buffer.alloc(size);
  const fd = fs.openSync(asarPath, 'r');
  try {
    fs.readSync(fd, buf, 0, size, base + Number(entry.offset));
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files || {})) {
    if (child.files) walk(child, `${prefix}${name}/`, out);
    else out.push({ path: `${prefix}${name}`, size: child.size, offset: child.offset, unpacked: !!child.unpacked });
  }
  return out;
}

const [, , asarPath, mode, pattern] = process.argv;
if (!asarPath) throw new Error('Usage: node tools/query-asar-index.cjs <path-to-asar> <list|grep|top|cat> [regex|exact-path]');
const { json: root, base } = readHeader(asarPath);
const files = walk(root, '', []);

if (mode === 'cat') {
  const entry = files.find(f => f.path === pattern);
  if (!entry) throw new Error(`No such entry: ${pattern}`);
  const cap = Number(process.env.ASAR_CAT_CAP_BYTES || 65536);
  process.stdout.write(readFilePayload(asarPath, base, entry, cap).toString('utf8'));
} else if (mode === 'find') {
  // find <regex> <exact-path>: literal/regex hits with offsets inside one file.
  const entry = files.find(f => f.path === process.argv[5]);
  if (!entry) throw new Error(`No such entry: ${process.argv[5]}`);
  const cap = Number(process.env.ASAR_FIND_CAP_BYTES || 64 * 1024 * 1024);
  const text = readFilePayload(asarPath, base, entry, cap).toString('utf8');
  const re = new RegExp(pattern, 'gi');
  const max = Number(process.env.ASAR_FIND_MAX || 40);
  const ctx = Number(process.env.ASAR_FIND_CONTEXT || 160);
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (n++ >= max) { console.log(`... more than ${max} hits`); break; }
    const start = Math.max(0, m.index - ctx), end = Math.min(text.length, m.index + m[0].length + ctx);
    console.log(`--- offset ${m.index} ---`);
    console.log(text.slice(start, end).replace(/\s+/g, ' ').trim());
  }
  console.log(`total hits: ${n}`);
} else if (mode === 'top') {
  for (const [name, child] of Object.entries(root.files)) {
    const n = child.files ? Object.keys(child.files).length : 0;
    console.log(`${child.files ? 'dir ' : 'file'} ${name}${child.files ? ` (${n} entries)` : ` ${child.size} B`}`);
  }
} else if (mode === 'grep') {
  const re = new RegExp(pattern, 'i');
  const hits = files.filter(f => re.test(f.path));
  console.log(`matches: ${hits.length}`);
  for (const h of hits.slice(0, 200)) console.log(`${String(h.size).padStart(9)}  ${h.path}${h.unpacked ? '  [unpacked]' : ''}`);
  if (hits.length > 200) console.log(`... ${hits.length - 200} more`);
} else {
  for (const f of files) console.log(`${String(f.size).padStart(9)}  ${f.path}`);
}
