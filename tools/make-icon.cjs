const { PNG } = require('pngjs');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

// Deterministic icon generator: a rounded glass tile with a speech bubble, drawn
// with 4x supersampling and box-filtered down. Keeping it in the repo means the
// .ico can be regenerated instead of being an opaque binary blob.
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const SS = 4;

function roundedRectDistance(x, y, w, h, r) {
  const cx = Math.abs(x - w / 2) - (w / 2 - r);
  const cy = Math.abs(y - h / 2) - (h / 2 - r);
  const ox = Math.max(cx, 0), oy = Math.max(cy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(cx, cy), 0) - r;
}

function render(size) {
  const n = size * SS;
  const px = new Float64Array(n * n * 4);
  const radius = n * 0.225;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const d = roundedRectDistance(x + 0.5, y + 0.5, n, n, radius);
      const coverage = Math.min(1, Math.max(0, 0.5 - d));
      if (coverage <= 0) continue;
      // Diagonal gradient plus a soft top-left sheen.
      const t = Math.min(1, Math.max(0, (x / n) * 0.35 + (y / n) * 0.65));
      const sheen = Math.max(0, 1 - Math.hypot(x / n - 0.24, y / n - 0.2) / 0.72) * 0.34;
      const top = [0x4e, 0x9b, 0xff], bottom = [0x0e, 0x33, 0x84];
      const r = top[0] + (bottom[0] - top[0]) * t, g = top[1] + (bottom[1] - top[1]) * t, b = top[2] + (bottom[2] - top[2]) * t;
      px[i] = (r + (255 - r) * sheen) * coverage;
      px[i + 1] = (g + (255 - g) * sheen) * coverage;
      px[i + 2] = (b + (255 - b) * sheen) * coverage;
      px[i + 3] = 255 * coverage;
    }
  }
  // Speech bubble: rounded body plus a tail, both white.
  const bw = n * 0.46, bh = n * 0.34, br = n * 0.13;
  const bx = (n - bw) / 2, by = n * 0.30;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const inBody = roundedRectDistance(x - bx, y - by, bw, bh, br) <= 0;
      // Triangular tail below the body.
      const tx = x / n, ty = y / n;
      const inTail = ty >= 0.60 && ty <= 0.745 && Math.abs(tx - 0.40) <= (0.745 - ty) * 1.05;
      if (!(inBody || inTail)) continue;
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
    }
  }
  // Three dots punched back to the accent blue.
  const dotR = n * 0.030, dotY = by + bh / 2, gap = n * 0.108;
  for (const dx of [-gap, 0, gap]) {
    const cx = n / 2 + dx;
    for (let y = Math.floor(dotY - dotR - 2); y <= dotY + dotR + 2; y++) {
      for (let x = Math.floor(cx - dotR - 2); x <= cx + dotR + 2; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = (y * n + x) * 4;
        const cov = Math.min(1, Math.max(0, 0.5 - (Math.hypot(x + 0.5 - cx, y + 0.5 - dotY) - dotR)));
        if (cov <= 0) continue;
        px[i] = px[i] * (1 - cov) + 0x12 * cov;
        px[i + 1] = px[i + 1] * (1 - cov) + 0x3f * cov;
        px[i + 2] = px[i + 2] * (1 - cov) + 0x92 * cov;
      }
    }
  }
  // Box-filter down to the requested size (premultiplied averaging).
  const out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const i = (((y * SS + sy) * n) + (x * SS + sx)) * 4;
        const alpha = px[i + 3] / 255;
        r += px[i] * alpha; g += px[i + 1] * alpha; b += px[i + 2] * alpha; a += px[i + 3];
      }
      const count = SS * SS, alphaOut = a / count;
      const o = (y * size + x) * 4;
      out.data[o] = alphaOut > 0 ? Math.round(r / count / (alphaOut / 255)) : 0;
      out.data[o + 1] = alphaOut > 0 ? Math.round(g / count / (alphaOut / 255)) : 0;
      out.data[o + 2] = alphaOut > 0 ? Math.round(b / count / (alphaOut / 255)) : 0;
      out.data[o + 3] = Math.round(alphaOut);
    }
  }
  return PNG.sync.write(out, { colorType: 6 });
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // 0 encodes 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.data)]);
}

(async () => {
  await mkdir(path.join('build'), { recursive: true });
  await mkdir(path.join('build', 'icons'), { recursive: true });
  const rendered = SIZES.map(size => ({ size, data: render(size) }));
  await writeFile(path.join('build', 'icon.ico'), buildIco(rendered));
  for (const { size, data } of rendered) await writeFile(path.join('build', 'icons', `${size}x${size}.png`), data);
  console.log(`Wrote build/icon.ico with ${SIZES.join(', ')} (${buildIco(rendered).length} bytes)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
