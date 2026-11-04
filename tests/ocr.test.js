'use strict';

// Export text (OCR): the fixed settings, that every file Tesseract.js needs ships with the app (it
// would otherwise fall back to a CDN). That it downloads / caches nothing is in privacy.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const OcrConfig = require('../ocr-config.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ocrFiles = [...Object.values(OcrConfig.FILES).map((f) => `${OcrConfig.DIR}/${f}`), ...OcrConfig.languageFiles()];

test('scaleFor doubles screenshots and leaves very large or empty images alone', () => {
  assert.equal(OcrConfig.scaleFor(1920, 1080), 2);
  assert.equal(OcrConfig.scaleFor(10, 10), 2);
  assert.equal(OcrConfig.scaleFor(3000, 2000), 2); // exactly 24 MP after x2
  assert.equal(OcrConfig.scaleFor(3000, 2001), 1);
  assert.equal(OcrConfig.scaleFor(800, 40000), 1); // a long scrolling screenshot
  assert.equal(OcrConfig.scaleFor(0, 100), 1);
  assert.equal(OcrConfig.scaleFor(NaN, 100), 1);
});

test('cleanText joins the split Thai SARA AM and trims', () => {
  assert.equal(OcrConfig.cleanText('  ยอดชําระ\n'), 'ยอดชำระ');
  assert.equal(OcrConfig.cleanText('นํ้า'), 'น้ำ'); // tone mark in between
  assert.equal(OcrConfig.cleanText('น้ำ ok'), 'น้ำ ok');
  assert.equal(OcrConfig.cleanText(undefined), '');
});

test('reads English and Thai with the LSTM engine and automatic page segmentation', () => {
  assert.deepEqual([...OcrConfig.LANGUAGES], ['eng', 'tha']);
  assert.equal(OcrConfig.OEM, 1);
  assert.equal(OcrConfig.PARAMETERS.tessedit_pageseg_mode, String(OcrConfig.PSM));
  assert.ok(Object.isFrozen(OcrConfig.PARAMETERS) && Object.isFrozen(OcrConfig.LANGUAGES));
});

test('every OCR file is in ocr/ and the language files are valid gzip', () => {
  for (const file of ocrFiles) assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  for (const file of OcrConfig.languageFiles()) {
    const data = zlib.gunzipSync(fs.readFileSync(path.join(root, file)));
    assert.ok(data.length > 100000, `${file} looks truncated`);
  }
});

test('the versions shown in settings match the bundled file and the license notices', () => {
  assert.ok(read('ocr/tesseract.min.js').includes(`"${OcrConfig.LIBRARY.version}"`));
  // the core file carries no version string: THIRD_PARTY_LICENSES.txt (checked against the README) names it
  const notices = read('THIRD_PARTY_LICENSES.txt');
  for (const { name, version } of [OcrConfig.LIBRARY, OcrConfig.CORE, OcrConfig.MODEL]) {
    assert.ok(notices.includes(`${name} ${version}`), `THIRD_PARTY_LICENSES.txt should name ${name} ${version}`);
  }
});

test('the OCR files ship with the desktop app and the web build', () => {
  assert.ok(JSON.parse(read('package.json')).build.files.includes('ocr/**'), 'package.json build.files');
  assert.ok(read('scripts/build-web.js').includes("fs.cpSync(path.join(root, 'ocr'), path.join(outDir, 'ocr')"), 'web build');
});

test('the export-text button, dialog and settings list are wired up', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.includes('ocr.js') && scripts.indexOf('ocr-config.js') < scripts.indexOf('ocr.js'), 'ocr-config.js loads before ocr.js');
  assert.ok(!scripts.some((s) => s.startsWith('ocr/')), 'the library is loaded on demand, not on start-up');
  const ids = [...read('ocr.js').matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `ocr.js needs #${id} in index.html`);
  assert.ok(read('input.js').includes('exportText: () => App.exportText()'));
});
