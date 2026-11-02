'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const GifEncoder = require('../gif-encoder.js');

// ---------- a small, independent GIF decoder used to check the encoder's output ----------
function lzwDecode(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let table = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push(null, null);
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let bitPos = 0;
  let prev = null;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bitPos++) {
      if ((data[bitPos >> 3] >> (bitPos & 7)) & 1) code |= 1 << i;
    }
    return code;
  };
  for (;;) {
    if (bitPos + codeSize > data.length * 8) throw new Error('ran out of data before the end code');
    const code = read();
    if (code === clear) { reset(); prev = null; continue; }
    if (code === end) break;
    let entry;
    if (code < table.length && table[code]) entry = table[code];
    else if (code === table.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`bad code ${code}`);
    out.push(...entry);
    if (prev && table.length < 4096) table.push([...prev, entry[0]]);
    if (table.length === (1 << codeSize) && codeSize < 12) codeSize++;
    prev = entry;
  }
  assert.equal(out.length, pixelCount, 'decoded pixel count');
  return out;
}

function readSubBlocks(bytes, pos) {
  const chunks = [];
  while (bytes[pos] !== 0) {
    chunks.push(...bytes.subarray(pos + 1, pos + 1 + bytes[pos]));
    pos += bytes[pos] + 1;
  }
  return { data: Uint8Array.from(chunks), next: pos + 1 };
}

/** Decodes a GIF into its composited frames (RGB per pixel as 0xRRGGBB) and their delays. */
function decodeGif(bytes) {
  const u16 = (p) => bytes[p] | (bytes[p + 1] << 8);
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString('latin1'), 'GIF89a');
  const width = u16(6);
  const height = u16(8);
  assert.equal(bytes[10] & 0x80, 0, 'no global colour table expected');
  let pos = 13;
  const canvas = new Array(width * height).fill(0);
  const frames = [];
  let gce = null;
  let loop = null;
  for (;;) {
    const b = bytes[pos];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[pos + 1];
      if (label === 0xf9) {
        gce = { transparent: bytes[pos + 3] & 1 ? bytes[pos + 6] : -1, delay: u16(pos + 4) };
        pos += 8;
      } else if (label === 0xff) {
        const app = Buffer.from(bytes.subarray(pos + 3, pos + 14)).toString('latin1');
        if (app === 'NETSCAPE2.0') loop = u16(pos + 16);
        pos = readSubBlocks(bytes, pos + 14).next;
      } else {
        throw new Error(`unexpected extension ${label}`);
      }
      continue;
    }
    assert.equal(b, 0x2c, 'image descriptor');
    const rect = { x: u16(pos + 1), y: u16(pos + 3), w: u16(pos + 5), h: u16(pos + 7) };
    const packed = bytes[pos + 9];
    assert.ok(packed & 0x80, 'local colour table');
    const size = 1 << ((packed & 7) + 1);
    pos += 10;
    const palette = [];
    for (let i = 0; i < size; i++, pos += 3) palette.push((bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2]);
    const minCodeSize = bytes[pos];
    const { data, next } = readSubBlocks(bytes, pos + 1);
    pos = next;
    const indices = lzwDecode(data, minCodeSize, rect.w * rect.h);
    indices.forEach((index, i) => {
      if (gce && index === gce.transparent) return;
      canvas[(rect.y + Math.floor(i / rect.w)) * width + rect.x + (i % rect.w)] = palette[index];
    });
    frames.push({ rect, delay: gce ? gce.delay : 0, pixels: [...canvas] });
    gce = null;
  }
  return { width, height, loop, frames };
}

// ---------- helpers ----------
function solid(width, height, rgb) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = (rgb >> 16) & 0xff;
    px[i * 4 + 1] = (rgb >> 8) & 0xff;
    px[i * 4 + 2] = rgb & 0xff;
    px[i * 4 + 3] = 255;
  }
  return px;
}

function setPixel(px, width, x, y, rgb) {
  const o = (y * width + x) * 4;
  px[o] = (rgb >> 16) & 0xff;
  px[o + 1] = (rgb >> 8) & 0xff;
  px[o + 2] = rgb & 0xff;
}

// ---------- tests ----------
test('lzwEncode round-trips through a standard decoder, including dictionary resets', () => {
  // long pseudo-random input forces the 4096-entry table to fill and reset
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (const [minCodeSize, length] of [[2, 10], [2, 5000], [8, 20000], [4, 1]]) {
    const max = 1 << minCodeSize;
    const indices = Uint8Array.from({ length }, () => random() % max);
    const encoded = GifEncoder.lzwEncode(indices, minCodeSize);
    const { data, next } = readSubBlocks(encoded, 0);
    assert.equal(next, encoded.length, 'block terminator is the last byte');
    assert.deepEqual(lzwDecode(data, minCodeSize, length), [...indices]);
  }
});

test('a single frame decodes to exactly the input colours', () => {
  const px = solid(4, 3, 0x112233);
  setPixel(px, 4, 1, 1, 0xff0000);
  setPixel(px, 4, 3, 2, 0x00ff00);
  const gif = GifEncoder.create(4, 3);
  gif.addFrame(px, 100);
  const decoded = decodeGif(gif.finish());
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 3);
  assert.equal(decoded.loop, 0);
  assert.equal(decoded.frames.length, 1);
  assert.equal(decoded.frames[0].delay, 10);
  assert.equal(decoded.frames[0].pixels[1 * 4 + 1], 0xff0000);
  assert.equal(decoded.frames[0].pixels[2 * 4 + 3], 0x00ff00);
  assert.equal(decoded.frames[0].pixels[0], 0x112233);
});

test('unchanged frames extend the previous frame instead of adding one', () => {
  const gif = GifEncoder.create(8, 8);
  const px = solid(8, 8, 0x000000);
  gif.addFrame(px, 100);
  gif.addFrame(px, 100);
  gif.addFrame(solid(8, 8, 0x050505), 100); // below the noise threshold
  const { frames } = decodeGif(gif.finish());
  assert.equal(frames.length, 1);
  assert.equal(frames[0].delay, 30);
});

test('later frames only cover the changed rectangle and keep the rest', () => {
  const gif = GifEncoder.create(10, 10);
  gif.addFrame(solid(10, 10, 0x202020), 50);
  const b = solid(10, 10, 0x202020);
  setPixel(b, 10, 2, 3, 0xffffff);
  setPixel(b, 10, 5, 6, 0xff00ff);
  gif.addFrame(b, 50);
  const { frames } = decodeGif(gif.finish());
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1].rect, { x: 2, y: 3, w: 4, h: 4 });
  assert.equal(frames[1].pixels[3 * 10 + 2], 0xffffff);
  assert.equal(frames[1].pixels[6 * 10 + 5], 0xff00ff);
  assert.equal(frames[1].pixels[4 * 10 + 3], 0x202020, 'unchanged pixel inside the rect shows through');
  assert.equal(frames[1].pixels[0], 0x202020);
  assert.deepEqual(frames.map((f) => f.delay), [5, 5]);
});

test('delays follow the timeline without accumulating rounding drift', () => {
  const gif = GifEncoder.create(2, 2);
  for (let i = 0; i < 30; i++) gif.addFrame(solid(2, 2, i % 2 ? 0xffffff : 0x000000), 1000 / 15);
  const { frames } = decodeGif(gif.finish());
  assert.equal(frames.length, 30);
  assert.equal(frames.reduce((n, f) => n + f.delay, 0), 200); // 30 frames at 15 fps = 2 s
});

test('frames with more than 256 colours get a reduced palette that stays close', () => {
  const w = 64;
  const h = 64;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(px, w, x, y, ((x * 4) << 16) | ((y * 4) << 8) | ((x + y) * 2));
  }
  const gif = GifEncoder.create(w, h);
  gif.addFrame(px, 100);
  const { frames } = decodeGif(gif.finish());
  let worst = 0;
  for (let i = 0; i < w * h; i++) {
    const got = frames[0].pixels[i];
    for (const [shift, channel] of [[16, 0], [8, 1], [0, 2]]) {
      worst = Math.max(worst, Math.abs(((got >> shift) & 0xff) - px[i * 4 + channel]));
    }
  }
  assert.ok(worst <= 24, `largest channel error ${worst}`);
});

test('create rejects bad sizes and finish needs a frame', () => {
  assert.throws(() => GifEncoder.create(0, 10), RangeError);
  assert.throws(() => GifEncoder.create(10, 70000), RangeError);
  assert.throws(() => GifEncoder.create(2, 2).finish(), /at least one frame/);
  assert.throws(() => GifEncoder.create(2, 2).addFrame(new Uint8ClampedArray(4), 10), RangeError);
});
