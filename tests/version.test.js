'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../version.js');
const I18n = require('../i18n.js');
const pkg = require('../package.json');

test('VERSION is the newest changelog entry', () => {
  assert.equal(V.VERSION, V.CHANGELOG[0].version);
});

test('current version matches package.json', () => {
  assert.equal(V.VERSION, '0.6.1');
  assert.equal(pkg.version, V.VERSION);
});

test('every release has a semver version, a date and at least one change per locale', () => {
  for (const r of V.CHANGELOG) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const { code } of I18n.LOCALES) {
      assert.ok(Array.isArray(r.changes[code]) && r.changes[code].length > 0, `${r.version} has no ${code} changes`);
    }
  }
});

test('formatVersion hides a zero patch', () => {
  assert.equal(V.formatVersion('0.5.0'), 'v0.5');
  assert.equal(V.formatVersion('0.5.2'), 'v0.5.2');
});

test('changelog is frozen', () => {
  assert.throws(() => V.CHANGELOG.push({}), TypeError);
});
