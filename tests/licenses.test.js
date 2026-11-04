'use strict';

// Every bundled third-party file must be covered by THIRD_PARTY_LICENSES.txt (with the full
// license texts), and that file must ship with the desktop app and the web build. LAME's LGPL asks
// for this; if a test fails after updating or adding a library, update the notices file too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const NOTICES = 'THIRD_PARTY_LICENSES.txt';
const notices = read(NOTICES);
const readme = read('README.md');

const VENDORED = Object.freeze({
  'mediabunny.min.js': 'Mediabunny',
  'mediabunny-mp3-encoder.min.js': '@mediabunny/mp3-encoder',
  'ocr/tesseract.min.js': 'Tesseract.js',
  'ocr/worker.min.js': 'Tesseract.js',
  'ocr/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core',
  'ocr/eng.traineddata.gz': 'tessdata_best_int',
  'ocr/tha.traineddata.gz': 'tessdata_best_int',
});

test('each bundled library is listed with the version the README names', () => {
  for (const [file, name] of Object.entries(VENDORED)) {
    assert.match(notices, new RegExp(`^(File|Files): +.*${file.replace(/\./g, '\\.')}`, 'm'), `${file} is not in ${NOTICES}`);
    const version = new RegExp(`\`${file.replace(/\./g, '\\.')}\` \\| \\[[^\\]]+\\]\\([^)]+\\) ([\\d.]+)`).exec(readme);
    assert.ok(version, `README has no row for ${file}`);
    assert.ok(notices.includes(`${name} ${version[1]}`), `${NOTICES} should name ${name} ${version[1]}`);
  }
});

test('the full license texts are included, not just links', () => {
  assert.match(notices, /Mozilla Public License Version 2\.0\n=+/);
  assert.match(notices, /Exhibit B - "Incompatible With Secondary Licenses" Notice/);
  assert.match(notices, /GNU LIBRARY GENERAL PUBLIC LICENSE\s+Version 2, June 1991/);
  assert.match(notices, /END OF TERMS AND CONDITIONS/);
  assert.match(notices, /Apache License\s+Version 2\.0, January 2004/);
  for (const lib of ['Leptonica', 'libpng', 'libjpeg', 'libtiff', 'libwebp', 'giflib', 'zlib', 'OpenLibm']) {
    assert.match(notices, new RegExp(`^--- D\\.\\d+ ${lib}`, 'm'), `license text of ${lib}`);
  }
  assert.match(notices, /based in part on the work of the Independent\s+JPEG\s+Group/, 'the IJG acknowledgement'); 
  assert.match(notices, /https:\/\/sourceforge\.net\/projects\/lame\/files\/lame\/3\.100\//, 'where to get the LAME source');
});

test('the notices ship with the desktop app, the web build and the offline cache', () => {
  const build = JSON.parse(read('package.json')).build;
  assert.ok(build.files.includes(NOTICES), 'desktop app files');
  assert.ok(build.extraFiles.includes(NOTICES), 'a visible copy next to the desktop app');
  assert.ok(read('scripts/build-web.js').includes(`'${NOTICES}'`), 'web build');
  assert.ok(read('sw.js').includes(`'./${NOTICES}'`), 'service worker cache');
});

test('the app shows the notice and opens the licenses', () => {
  assert.match(read('index.html'), /id="licenses-frame"/);
  assert.ok(read('version-badge.js').includes(`'${NOTICES}'`));
});
