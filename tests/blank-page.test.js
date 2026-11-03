'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../blank-page.js');
const I18n = require('../i18n.js');

test('paper sizes turn into pixels at the chosen DPI', () => {
  assert.deepEqual(B.sizeFor('A4', 96), { width: 794, height: 1123 });
  assert.deepEqual(B.sizeFor('A4', 300), { width: 2480, height: 3508 });
  assert.deepEqual(B.sizeFor('Letter', 72), { width: 612, height: 792 });
});

test('pixel presets ignore the DPI', () => {
  assert.deepEqual(B.sizeFor('fhd', 72), { width: 1920, height: 1080 });
  assert.deepEqual(B.sizeFor('fhd', 300), { width: 1920, height: 1080 });
});

test('orientation puts the long side across or down', () => {
  assert.deepEqual(B.sizeFor('A4', 96, true), { width: 1123, height: 794 });
  assert.deepEqual(B.sizeFor('A4', 96, false), { width: 794, height: 1123 });
  assert.deepEqual(B.sizeFor('fhd', 96, false), { width: 1080, height: 1920 });
  assert.deepEqual(B.sizeFor('square', 96, true), { width: 1080, height: 1080 });
});

test('unknown presets give null', () => {
  assert.equal(B.sizeFor('nope', 96), null);
  assert.equal(B.getPreset('nope'), null);
});

test('clampSide keeps sizes whole and within limits', () => {
  assert.equal(B.clampSide(800.6), 801);
  assert.equal(B.clampSide(0), B.MIN_SIDE);
  assert.equal(B.clampSide(99999), B.MAX_SIDE);
  assert.equal(B.clampSide('abc', 500), 500);
});

test('matchPreset finds a preset in either orientation', () => {
  assert.equal(B.matchPreset(794, 1123, 96), 'A4');
  assert.equal(B.matchPreset(1123, 794, 96), 'A4');
  assert.equal(B.matchPreset(1920, 1080, 150), 'fhd');
  assert.equal(B.matchPreset(800, 600, 96), null);
});

test('defaults point at a real preset and DPI', () => {
  assert.ok(B.getPreset(B.DEFAULTS.preset));
  assert.ok(B.DPIS.includes(B.DEFAULTS.dpi));
});

test('every preset is in a known group and every label is translated', () => {
  for (const p of B.PRESETS) {
    assert.ok(B.GROUPS.includes(p.group), p.id);
    if (p.label) assert.ok(p.label in I18n.MESSAGES[I18n.DEFAULT_LOCALE], `${p.label} is missing`);
  }
});
