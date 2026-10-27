'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I18n = require('../i18n.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const sources = [...scripts, 'main.js', 'history-service.js'].map((file) => read(file));
const dataKeys = (markup) => [...markup.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)].map((m) => m[1]);

const codes = I18n.LOCALES.map((l) => l.code);
const keysOf = (code) => Object.keys(I18n.MESSAGES[code]).sort();

test('every locale has exactly the same keys as the default locale', () => {
  const expected = keysOf(I18n.DEFAULT_LOCALE);
  for (const code of codes) assert.deepEqual(keysOf(code), expected, `${code} keys differ`);
});

test('no message is empty', () => {
  for (const code of codes) {
    for (const [key, value] of Object.entries(I18n.MESSAGES[code])) {
      assert.ok(typeof value === 'string' && value.trim() !== '', `${code}:${key} is empty`);
    }
  }
});

test('placeholders match across locales', () => {
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of keysOf(I18n.DEFAULT_LOCALE)) {
    const expected = placeholders(I18n.MESSAGES[I18n.DEFAULT_LOCALE][key]);
    for (const code of codes) assert.deepEqual(placeholders(I18n.MESSAGES[code][key]), expected, `${code}:${key}`);
  }
});

test('resolveLocale picks the first supported language, ignoring the region', () => {
  assert.equal(I18n.resolveLocale(['th-TH']), 'th');
  assert.equal(I18n.resolveLocale(['fr-FR', 'en-US', 'th']), 'en');
  assert.equal(I18n.resolveLocale(['TH']), 'th');
  assert.equal(I18n.resolveLocale(['fr']), I18n.DEFAULT_LOCALE);
  assert.equal(I18n.resolveLocale([]), I18n.DEFAULT_LOCALE);
  assert.equal(I18n.resolveLocale(undefined), I18n.DEFAULT_LOCALE);
});

test('translate interpolates params and falls back to the default locale, then to the key', () => {
  assert.equal(I18n.translate('en', 'toast.added', { count: 3 }), 'Added 3 image(s)');
  assert.equal(I18n.translate('th', 'toast.added', { count: 3 }), 'เพิ่ม 3 รูป');
  assert.equal(I18n.translate('xx', 'toast.noImages'), I18n.MESSAGES[I18n.DEFAULT_LOCALE]['toast.noImages']);
  assert.equal(I18n.translate('en', 'no.such.key'), 'no.such.key');
});

test('setLocale ignores unsupported codes and notifies subscribers on change only', () => {
  const seen = [];
  const unsubscribe = I18n.subscribe((code) => seen.push(code));
  assert.equal(I18n.setLocale('th'), true);
  assert.equal(I18n.getLocale(), 'th');
  assert.equal(I18n.setLocale('th'), true);
  assert.equal(I18n.setLocale('xx'), false);
  assert.equal(I18n.getLocale(), 'th');
  assert.equal(I18n.t('toast.noImages'), I18n.MESSAGES.th['toast.noImages']);
  I18n.setLocale('en');
  unsubscribe();
  I18n.setLocale('th');
  assert.deepEqual(seen, ['th', 'en']);
  I18n.setLocale(I18n.DEFAULT_LOCALE);
});

test('messages and locale list are frozen', () => {
  assert.throws(() => { I18n.MESSAGES.en['x.y'] = 'z'; }, TypeError);
  assert.throws(() => I18n.LOCALES.push({}), TypeError);
});

test('every data-i18n* key in index.html exists', () => {
  const used = dataKeys(html);
  assert.ok(used.length > 0);
  for (const key of used) assert.ok(key in I18n.MESSAGES[I18n.DEFAULT_LOCALE], `unknown key ${key} in index.html`);
});

test('every translation key referenced from the scripts exists, and none is unused', () => {
  const namespaces = new Set(keysOf(I18n.DEFAULT_LOCALE).map((k) => k.split('.')[0]));
  const referenced = new Set(dataKeys(html));
  for (const source of sources) {
    for (const m of source.matchAll(/'([a-z]+)\.([A-Za-z0-9]+)'/g)) {
      if (['html', 'css', 'js'].includes(m[2])) continue; // a file name such as 'history.html', not a key
      if (namespaces.has(m[1])) referenced.add(`${m[1]}.${m[2]}`);
    }
  }
  const known = new Set(keysOf(I18n.DEFAULT_LOCALE));
  for (const key of referenced) assert.ok(known.has(key), `unknown key ${key}`);
  for (const key of known) assert.ok(referenced.has(key), `unused key ${key}`);
});

test('no hard-coded Thai text is left in the page or the scripts', () => {
  const thai = /[฀-๿]/;
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(!thai.test(markup), 'index.html still has Thai text');
  for (const file of scripts.filter((f) => !['i18n.js', 'version.js'].includes(f))) {
    assert.ok(!thai.test(read(file)), `${file} still has Thai text`);
  }
  for (const file of ['main.js', 'history-service.js']) {
    assert.ok(!thai.test(read(file)), `${file} still has Thai text`);
  }
});

test('every button is labelled (title/aria-label come from the dictionary)', () => {
  const tags = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length > 0);
  for (const tag of tags) assert.match(tag, /data-i18n(-title|-aria)?=/, `unlabelled button: ${tag}`);
});
