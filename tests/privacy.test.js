'use strict';

// Backs the README's privacy section ("ความเป็นส่วนตัว"): the app sends nothing anywhere and only
// stores the few settings listed there. If one of these tests fails, either undo the change or
// update the README section and this file together.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const readme = read('README.md');
const VENDORED = new Set(['mediabunny.min.js', 'mediabunny-mp3-encoder.min.js']);
const appFiles = fs.readdirSync(root).filter((f) => f.endsWith('.js') && !VENDORED.has(f));
const privacySection = readme.slice(readme.indexOf('## ความเป็นส่วนตัว'));

test('the README has a privacy section', () => {
  assert.ok(readme.includes('## ความเป็นส่วนตัว'));
});

test('the Content-Security-Policy only allows the app itself (no other server can be reached)', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name, v]));
  assert.deepEqual(directives['default-src'], ["'self'"], 'default-src must stay self only');
  // connect-src (fetch / XHR / WebSocket / sendBeacon) falls back to default-src, so it must not be loosened
  assert.ok(!('connect-src' in directives), 'connect-src must not be added');
  const allowed = new Set(["'self'", 'blob:', 'data:', "'none'"]);
  for (const [name, sources] of Object.entries(directives)) {
    for (const source of sources) {
      // compiling WebAssembly (the MP3 encoder) is the one extra: it runs code shipped with the app, it reaches nothing
      if (name === 'script-src' && source === "'wasm-unsafe-eval'") continue;
      assert.ok(allowed.has(source), `${name} allows ${source}`);
    }
  }
  assert.ok(!directives['script-src'].includes("'unsafe-eval'"), 'script-src must not allow eval()');
});

test('app code makes no network requests; only the service worker fetches (the app files)', () => {
  const network = /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection/;
  for (const file of appFiles) {
    const lines = read(file).split('\n').filter((line) => network.test(line));
    if (file === 'sw.js') {
      assert.equal(lines.length, 1, 'sw.js should have exactly one fetch (the app-shell cache)');
      continue;
    }
    assert.deepEqual(lines, [], `${file} makes a network request`);
  }
  assert.match(read('sw.js'), /if \(event\.request\.method !== 'GET'\) return;/, 'the service worker only handles GET');
});

test('the desktop app loads no networking modules and turns off spell-check downloads', () => {
  for (const file of appFiles) {
    const source = read(file);
    assert.ok(!/require\('(node:)?(https?|http2|net|dgram|tls|child_process)'\)/.test(source), `${file} loads a networking module`);
    assert.ok(!/\{[^}]*\bnet\b[^}]*\}\s*=\s*require\('electron'\)/.test(source), `${file} uses electron.net`);
  }
  const main = read('main.js');
  assert.match(main, /spellcheck: false/, 'spell check would download dictionaries from Google');
  assert.ok(!/webSecurity:\s*false/.test(main));
});

test('the video library only reads local files (no URL / stream sources)', () => {
  const editor = read('video-editor.js');
  assert.match(editor, /new MB\.BlobSource\(/);
  assert.ok(!/UrlSource|StreamSource|HlsInput/.test(editor));
});

test('the MP3 encoder carries its WebAssembly inside the file and runs it in a blob worker', () => {
  const mp3 = read('mediabunny-mp3-encoder.min.js');
  // its loader can fetch a .wasm by URL, but only when no embedded binary is given; this build embeds one
  assert.match(mp3, /return \w+\("AGFzbQ/, 'the WASM module ("\\0asm" in base64) is embedded');
  assert.match(mp3, /new Blob\(\[\w+\],\{type:"text\/javascript"\}\)/, 'the worker comes from a blob URL');
  assert.deepEqual(mp3.match(/https?:\/\/[^\s'"`)]+/g), ['https://mozilla.org/MPL/2.0/.'], 'only the license link (in its header comment)');
});

test('no app file contains a web address; the page only has the GitHub and donate links in the toolbar', () => {
  for (const file of appFiles) assert.deepEqual(read(file).match(/https?:\/\/[^\s'"`)]+/g) || [], [], `${file} has a URL`);
  const urls = html.match(/https?:\/\/[^\s'"`)]+/g) || [];
  assert.deepEqual(urls, ['https://github.com/mongoemon/zscreen', 'https://ko-fi.com/mongoemon'], 'only the GitHub and donate links (open on click only)');
});

test('everything the app saves is listed in the README privacy section', () => {
  const stored = new Set();
  for (const file of appFiles) {
    const source = read(file);
    for (const m of source.matchAll(/(?:STORAGE_KEY|VISIBLE_KEY|WIDTH_KEY|SETTINGS_FILE)\s*=\s*'([^']+)'/g)) stored.add(m[1]);
    // storage calls must go through one of the named constants above, so they all show up here
    for (const m of source.matchAll(/localStorage\.setItem\(([^,]+),/g)) {
      assert.match(m[1].trim(), /^(STORAGE_KEY|VISIBLE_KEY|WIDTH_KEY)$/, `${file} stores under an unlisted key`);
    }
    for (const m of source.matchAll(/writeFileSync\(([^,]+),/g)) {
      assert.equal(m[1].trim(), 'settingsPath()', `${file} writes an unlisted file`);
    }
    assert.ok(!/indexedDB|sessionStorage|document\.cookie/.test(source), `${file} uses other browser storage`);
  }
  assert.deepEqual([...stored].sort(), [
    'history-panel.json', 'shortcuts.json', 'zcreenshot-history-visible', 'zcreenshot-width', 'zcreenshot.blankPage', 'zcreenshot.locale', 'zcreenshot.shortcuts',
  ]);
  for (const name of stored) assert.ok(privacySection.includes(name), `README privacy section does not mention ${name}`);
});
