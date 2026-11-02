'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ScrollStitch = require('../scroll-stitch.js');

// Deterministic pseudo-random numbers, so the synthetic page is the same on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A tall "document": lines of dark "words" on white, with a blank gap now and then. */
function makePage(width, height, seed = 1) {
  const rand = rng(seed);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 14) {
    if (rand() < 0.15) continue; // empty line
    let x = 4;
    while (x < width - 20) {
      const w = 6 + Math.floor(rand() * 40);
      const shade = Math.floor(rand() * 120);
      for (let yy = y + 3; yy < Math.min(height, y + 11); yy++) {
        for (let xx = x; xx < Math.min(width, x + w); xx++) {
          const i = (yy * width + xx) * 4;
          data[i] = shade;
          data[i + 1] = shade;
          data[i + 2] = shade;
        }
      }
      x += w + 4 + Math.floor(rand() * 10);
    }
  }
  return { width, height, data };
}

/** A solid band (a sticky header / footer) of `h` rows with a stripe so it is not blank. */
function makeBand(width, h, value) {
  const data = new Uint8ClampedArray(width * h * 4).fill(value);
  for (let x = 0; x < width / 3; x++) {
    const i = (Math.floor(h / 2) * width + x) * 4;
    data[i] = 255 - value;
  }
  return { width, height: h, data };
}

/** The viewport while the page is scrolled down by `offset` rows (header + page slice + footer). */
function viewport(page, offset, viewH, header, footer) {
  const { width } = page;
  const data = new Uint8ClampedArray(width * viewH * 4);
  const contentH = viewH - (header ? header.height : 0) - (footer ? footer.height : 0);
  let y = 0;
  if (header) {
    data.set(header.data, 0);
    y += header.height;
  }
  data.set(page.data.subarray(offset * width * 4, (offset + contentH) * width * 4), y * width * 4);
  y += contentH;
  if (footer) data.set(footer.data, y * width * 4);
  return { width, height: viewH, data };
}

/** Draws the stitcher's pieces into one frame. */
function compose(result) {
  const data = new Uint8ClampedArray(result.width * result.height * 4);
  for (const { y, frame } of result.pieces) data.set(frame.data, y * result.width * 4);
  return { width: result.width, height: result.height, data };
}

function expectedImage(page, lastOffset, viewH, header, footer) {
  const contentH = viewH - (header ? header.height : 0) - (footer ? footer.height : 0);
  const pageRows = lastOffset + contentH;
  const tall = { width: page.width, height: pageRows, data: page.data.slice(0, pageRows * page.width * 4) };
  return viewport(tall, 0, pageRows + (header ? header.height : 0) + (footer ? footer.height : 0), header, footer);
}

function stitch(frames) {
  const stitcher = ScrollStitch.createStitcher();
  const statuses = frames.map((f) => stitcher.push(f).status);
  return { stitcher, statuses, image: compose(stitcher.result()) };
}

function assertSameImage(actual, expected) {
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  assert.ok(Buffer.from(actual.data).equals(Buffer.from(expected.data)), 'pixels differ');
}

test('joins a plain page scrolled in steady steps', () => {
  const page = makePage(320, 2000);
  const offsets = [0, 60, 120, 180, 240, 300, 360, 420];
  const { image, statuses } = stitch(offsets.map((o) => viewport(page, o, 400)));
  assert.deepEqual(statuses, ['first', ...Array(offsets.length - 1).fill('added')]);
  assertSameImage(image, expectedImage(page, 420, 400));
});

test('keeps a sticky header and footer once, at the top and bottom', () => {
  const page = makePage(320, 2000, 7);
  const header = makeBand(320, 40, 40);
  const footer = makeBand(320, 30, 200);
  const offsets = [0, 25, 90, 150, 151, 260, 300];
  const { image } = stitch(offsets.map((o) => viewport(page, o, 420, header, footer)));
  assertSameImage(image, expectedImage(page, 300, 420, header, footer));
});

test('ignores frames where nothing moved, and frames scrolled back up', () => {
  const page = makePage(320, 2000, 3);
  const offsets = [0, 0, 80, 80, 40, 80, 160];
  const { image, statuses } = stitch(offsets.map((o) => viewport(page, o, 400)));
  assert.deepEqual(statuses, ['first', 'same', 'added', 'same', 'lost', 'same', 'added']);
  assertSameImage(image, expectedImage(page, 160, 400));
});

test('reports "lost" when the page jumps further than one screen, then picks up again', () => {
  const page = makePage(320, 3000, 5);
  const frames = [0, 100, 900, 200].map((o) => viewport(page, o, 400));
  const { image, statuses } = stitch(frames);
  assert.deepEqual(statuses, ['first', 'added', 'lost', 'added']);
  assertSameImage(image, expectedImage(page, 200, 400));
});

test('the title bar changing when the window is clicked does not throw the page off', () => {
  const page = makePage(320, 2000, 11);
  const inactive = makeBand(320, 36, 110);
  const active = makeBand(320, 36, 60);
  const offsets = [0, 30, 75, 120, 200, 260];
  // clicked and scrolled at once: the title bar changes on the same frame the page first moves
  const frames = offsets.map((o, i) => viewport(page, o, 400, i === 0 ? inactive : active));
  const { image, statuses } = stitch(frames);
  assert.deepEqual(statuses, ['first', ...Array(offsets.length - 1).fill('added')]);
  assertSameImage(image, expectedImage(page, 260, 400, inactive));

  // clicked first, scrolled after: the image shows the active title bar
  const later = [viewport(page, 0, 400, inactive), viewport(page, 0, 400, active), ...offsets.slice(1).map((o) => viewport(page, o, 400, active))];
  const second = stitch(later);
  assert.equal(second.statuses[1], 'same');
  assertSameImage(second.image, expectedImage(page, 260, 400, active));
});

test('a scaled capture (shift not a whole number of pixels) still lines up within a pixel or two', () => {
  const page = makePage(400, 2400, 13);
  const scale = 0.75;
  const shrink = (frame) => { // nearest-neighbour + vertical blend, like a resized capture
    const w = Math.round(frame.width * scale);
    const h = Math.round(frame.height * scale);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = y / scale;
      const y0 = Math.floor(sy);
      const y1 = Math.min(frame.height - 1, y0 + 1);
      const f = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = Math.floor(x / scale);
        for (let c = 0; c < 4; c++) {
          data[(y * w + x) * 4 + c] = frame.data[(y0 * frame.width + sx) * 4 + c] * (1 - f) + frame.data[(y1 * frame.width + sx) * 4 + c] * f;
        }
      }
    }
    return { width: w, height: h, data };
  };
  const offsets = Array.from({ length: 12 }, (_, i) => i * 37);
  const { statuses, stitcher } = stitch(offsets.map((o) => shrink(viewport(page, o, 600))));
  assert.deepEqual(statuses, ['first', ...Array(offsets.length - 1).fill('added')]);
  const expected = (600 + 11 * 37) * scale;
  assert.ok(Math.abs(stitcher.height() - expected) <= 6, `height ${stitcher.height()}, expected about ${expected}`);
});

test('a single frame (never scrolled) comes back as it is', () => {
  const page = makePage(200, 600);
  const frame = viewport(page, 0, 300);
  const { image } = stitch([frame, frame]);
  assertSameImage(image, frame);
});

test('frames of another size are skipped', () => {
  const page = makePage(320, 1000);
  const stitcher = ScrollStitch.createStitcher();
  stitcher.push(viewport(page, 0, 400));
  assert.equal(stitcher.push(viewport(page, 50, 380)).status, 'resized');
  assert.equal(stitcher.height(), 400);
});

test('stops growing at maxHeight (a frame that would pass it is not used)', () => {
  const page = makePage(320, 2000, 9);
  const stitcher = ScrollStitch.createStitcher({ maxHeight: 500 });
  const statuses = [0, 60, 120, 180].map((o) => stitcher.push(viewport(page, o, 400)).status);
  assert.deepEqual(statuses, ['first', 'added', 'full', 'full']);
  assert.equal(stitcher.height(), 460);
  assertSameImage(compose(stitcher.result()), expectedImage(page, 60, 400));
});

test('maxHeightFor keeps the canvas inside browser limits', () => {
  assert.equal(ScrollStitch.maxHeightFor(1000), 32000);
  assert.ok(ScrollStitch.maxHeightFor(10000) * 10000 <= 250e6);
});
