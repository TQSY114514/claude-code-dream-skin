import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const size = 16;
const rgba = [];

for (let y = 0; y < size; y++) {
  rgba.push(0);
  for (let x = 0; x < size; x++) {
    const cx = x - 8, cy = y - 8;
    const dist = Math.sqrt(cx * cx + cy * cy);
    if (dist < 7) {
      const t = dist / 7;
      rgba.push(
        Math.floor(0x7e * (1 - t) + 0xb3 * t),
        Math.floor(0xc8 * (1 - t) + 0x88 * t),
        Math.floor(0xe3 * (1 - t) + 0xff * t),
        255
      );
    } else {
      rgba.push(0, 0, 0, 0);
    }
  }
}

// PNG encoder
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = crc32.table;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
crc32.table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function chunk(type, data) {
  const raw = Buffer.concat([Buffer.from(type), data]);
  const crcVal = crc32(raw);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, raw, crcBuf]);
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

const ihdr = Buffer.concat([
  u32be(size),   // width
  u32be(size),   // height
  Buffer.from([8, 6, 0, 0, 0])  // bit_depth=8, color=RGBA, rest=0
]);

const rawScanlines = Buffer.from(rgba);
const idat = zlib.deflateSync(rawScanlines);
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(process.cwd(), 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'claude-dream-skin.png'), png);
console.log('Icon generated: assets/claude-dream-skin.png (' + png.length + ' bytes)');
