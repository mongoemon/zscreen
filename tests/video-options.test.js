'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../video-options.js');

test('fitSize scales the short side down, keeps the aspect ratio and returns even sizes', () => {
  assert.deepEqual(V.fitSize(1920, 1080, 720), { width: 1280, height: 720 });
  assert.deepEqual(V.fitSize(1080, 1920, 720), { width: 720, height: 1280 }); // portrait
  assert.deepEqual(V.fitSize(1280, 720, 1080), { width: 1280, height: 720 }); // never upscales
  assert.deepEqual(V.fitSize(1001, 601, 0), { width: 1002, height: 602 }); // original, made even
  assert.deepEqual(V.fitSize(3024, 1964, 480), { width: 740, height: 480 });
});

test('sizesFor offers the original plus only presets smaller than the source', () => {
  assert.deepEqual(V.sizesFor(1280, 720), [0, 480, 360, 240]);
  assert.deepEqual(V.sizesFor(200, 100), [0]);
});

test('bitrateFor scales with pixels and fps, within limits', () => {
  assert.equal(V.bitrateFor(1280, 720, 30, 'low'), Math.round(1280 * 720 * 30 * V.QUALITY.low));
  assert.ok(V.bitrateFor(1280, 720, 30, 'low') < V.bitrateFor(1280, 720, 30, 'high'));
  assert.equal(V.bitrateFor(10, 10, 5, 'low'), 150000);
  assert.equal(V.bitrateFor(7680, 4320, 60, 'high'), 25000000);
  assert.equal(V.bitrateFor(100, 100, 10, 'nope'), V.bitrateFor(100, 100, 10, 'medium'));
  assert.equal(V.estimateBytes(800000, 10), 1000000);
});

test('MIME selection prefers the best supported candidate', () => {
  const only = (...ok) => (m) => ok.includes(m);
  assert.equal(V.pickMimeType(only('video/webm;codecs=vp8', 'video/webm'), 'webm'), 'video/webm;codecs=vp8');
  assert.equal(V.pickMimeType(only(), 'mp4'), null);
  assert.deepEqual(V.supportedContainers(only('video/webm')), ['webm']);
  assert.deepEqual(V.supportedContainers(only('video/mp4', 'video/webm;codecs=vp9')), ['mp4', 'webm']);
  assert.equal(V.recordingMimeType(only('video/mp4', 'video/webm;codecs=vp9')), 'video/webm;codecs=vp9');
  assert.equal(V.recordingMimeType(only('video/mp4')), 'video/mp4');
  assert.equal(V.extensionFor('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(V.extensionFor('video/webm;codecs=vp9'), 'webm');
});

test('clampTrim keeps a valid, non-empty range', () => {
  assert.deepEqual(V.clampTrim(2, 5, 10), { start: 2, end: 5 });
  assert.deepEqual(V.clampTrim(-1, 20, 10), { start: 0, end: 10 });
  const tight = V.clampTrim(5, 5, 10);
  assert.ok(tight.end > tight.start);
  const atEnd = V.clampTrim(10, 10, 10);
  assert.ok(atEnd.end <= 10 && atEnd.start < atEnd.end);
});

test('frameTimes samples the range at the frame rate', () => {
  assert.deepEqual(V.frameTimes(1, 2, 4), [1, 1.25, 1.5, 1.75]);
  assert.deepEqual(V.frameTimes(0, 0.01, 10), [0]);
  assert.equal(V.frameTimes(0, 3, 10).length, 30);
});

test('formatTime and formatBytes', () => {
  assert.equal(V.formatTime(0), '0:00.0');
  assert.equal(V.formatTime(75.25), '1:15.2');
  assert.equal(V.formatTime(0.3), '0:00.3');
  assert.equal(V.formatBytes(512), '512 B');
  assert.equal(V.formatBytes(1536), '1.5 KB');
  assert.equal(V.formatBytes(5 * 1024 * 1024), '5.0 MB');
});
