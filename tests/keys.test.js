'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Keys = require('../keys.js');

test('Latin keys pass through, lowercased', () => {
  assert.equal(Keys.shortcutKey({ key: 'z', code: 'KeyZ' }), 'z');
  assert.equal(Keys.shortcutKey({ key: 'Z', code: 'KeyZ' }), 'z');
  assert.equal(Keys.shortcutKey({ key: '0', code: 'Digit0' }), '0');
});

test('a Thai layout still resolves to the physical Latin key (Ctrl+Z, V, S, C ...)', () => {
  assert.equal(Keys.shortcutKey({ key: 'ผ', code: 'KeyZ' }), 'z');
  assert.equal(Keys.shortcutKey({ key: 'ห', code: 'KeyS' }), 's');
  assert.equal(Keys.shortcutKey({ key: 'แ', code: 'KeyC' }), 'c');
  assert.equal(Keys.shortcutKey({ key: 'ะ', code: 'KeyV' }), 'v');
});

test('Thai digits and the zoom keys map to their physical keys', () => {
  assert.equal(Keys.shortcutKey({ key: '๐', code: 'Digit0' }), '0');
  assert.equal(Keys.shortcutKey({ key: 'ช', code: 'Equal' }), '=');
  assert.equal(Keys.shortcutKey({ key: 'ข', code: 'Minus' }), '-');
});

test('layouts that already produce Latin letters keep their logical meaning (AZERTY / Dvorak)', () => {
  assert.equal(Keys.shortcutKey({ key: 'z', code: 'KeyW' }), 'z');
  assert.equal(Keys.shortcutKey({ key: 'a', code: 'KeyQ' }), 'a');
});

test('named keys are lowercased and unknown events do not throw', () => {
  assert.equal(Keys.shortcutKey({ key: 'Escape', code: 'Escape' }), 'escape');
  assert.equal(Keys.shortcutKey({ key: 'ก', code: 'Quote' }), 'ก'); // no Latin equivalent: left as is
  assert.equal(Keys.shortcutKey({}), '');
});
