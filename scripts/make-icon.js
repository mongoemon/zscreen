// Generates build/icon.png (256), icon-192.png and icon-512.png with no dependencies:
// orange rounded tile + two stacked "screenshots". Shapes are drawn in a 256 design space and scaled.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DESIGN = 256;
const ORANGE = [255, 122, 69];
const DARK = [27, 28, 32];
const WHITE = [255, 255, 255];
const OUTPUTS = [
  ['icon.png', 256],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || y < ry || x >= rx + rw || y >= ry + rh) return false;
  const cx = x < rx + r ? rx + r : x >= rx + rw - r ? rx + rw - r - 1 : x;
  const cy = y < ry + r ? ry + r : y >= ry + rh - r ? ry + rh - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// x, y are in design-space coordinates
function pixel(x, y) {
  if (!inRoundedRect(x, y, 0, 0, DESIGN, DESIGN, 52)) return [0, 0, 0, 0];
  if (inRoundedRect(x, y, 48, 50, 144, 84, 10)) {
    const border = !inRoundedRect(x, y, 54, 56, 132, 72, 6);
    return [...(border ? DARK : WHITE), 255]; // upper shot with dark outline
  }
  if (inRoundedRect(x, y, 64, 118, 144, 84, 10)) return [...WHITE, 255]; // lower shot, offset
  return [...ORANGE, 255];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function renderPng(size) {
  const k = DESIGN / size;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw.set(pixel(Math.floor(x * k), Math.floor(y * k)), rowStart + 1 + x * 4);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, size] of OUTPUTS) {
  const png = renderPng(size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`wrote ${name} (${size}px, ${png.length} bytes)`);
}
