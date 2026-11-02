'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebmDuration = require('../webm-duration.js');

const { encodeSize } = WebmDuration;

function element(idBytes, payload, { unknownSize = false } = {}) {
  const size = unknownSize ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [...encodeSize(payload.length)];
  return Uint8Array.from([...idBytes, ...size, ...payload]);
}

const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

/** The layout Chrome's MediaRecorder writes: EBML header, then an unknown-size Segment. */
function recorderLikeWebm({ scale = null, info = null } = {}) {
  const ebml = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], [...Buffer.from('webm')]));
  const infoChildren = info || concat(
    scale ? element([0x2a, 0xd7, 0xb1], [(scale >> 16) & 0xff, (scale >> 8) & 0xff, scale & 0xff]) : [],
    element([0x4d, 0x80], [...Buffer.from('Chrome')]),
  );
  const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], [0x01, 0x02, 0x03]));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], [0xe7, 0x81, 0x00, 0xa3, 0x82, 0x01, 0x02]);
  const segment = element(
    [0x18, 0x53, 0x80, 0x67],
    concat(element([0x15, 0x49, 0xa9, 0x66], infoChildren), tracks, cluster),
    { unknownSize: true },
  );
  return concat(ebml, segment);
}

test('adds a Duration to a recorder-style file and keeps the media bytes', () => {
  const input = recorderLikeWebm();
  assert.equal(WebmDuration.readDuration(input), null);
  const output = WebmDuration.withDuration(input, 12345.5);
  assert.equal(output.length, input.length + 11);
  assert.equal(WebmDuration.readDuration(output), 12345.5);
  const media = 22; // Tracks + Cluster, which follow Info
  assert.deepEqual([...output.subarray(output.length - media)], [...input.subarray(input.length - media)]);
});

test('respects a custom TimecodeScale', () => {
  const output = WebmDuration.withDuration(recorderLikeWebm({ scale: 100000 }), 2000);
  assert.equal(WebmDuration.readDuration(output), 2000);
  const at = output.findIndex((b, i) => b === 0x44 && output[i + 1] === 0x89);
  assert.equal(new DataView(output.buffer).getFloat64(at + 3), 20000); // 20000 units of 0.1 ms
});

test('grows the Info size field when it no longer fits in one byte', () => {
  const info = element([0x4d, 0x80], new Array(120).fill(0x41)); // 122 bytes; +11 passes the 1-byte limit
  const output = WebmDuration.withDuration(recorderLikeWebm({ info }), 1500);
  assert.equal(WebmDuration.readDuration(output), 1500);
});

test('leaves files that already have a Duration, or that it cannot parse, unchanged', () => {
  const once = WebmDuration.withDuration(recorderLikeWebm(), 1000);
  assert.equal(WebmDuration.withDuration(once, 5000), once);
  const junk = Uint8Array.from([0, 1, 2, 3]);
  assert.equal(WebmDuration.withDuration(junk, 1000), junk);
  assert.equal(WebmDuration.withDuration(new Uint8Array(0), 1000).length, 0);
  const input = recorderLikeWebm();
  assert.equal(WebmDuration.withDuration(input, 0), input);
  assert.equal(WebmDuration.withDuration(input.subarray(0, 30), 1000).length, 30);
});

test('encodeSize uses the shortest form and avoids the reserved all-ones value', () => {
  assert.deepEqual([...encodeSize(5)], [0x85]);
  assert.deepEqual([...encodeSize(126)], [0xfe]);
  assert.deepEqual([...encodeSize(127)], [0x40, 0x7f]);
  assert.deepEqual([...encodeSize(300)], [0x41, 0x2c]);
});
