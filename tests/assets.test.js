'use strict';

// Guards the "forgot to wire a new file in" class of bugs: the app is plain <script> tags, a service
// worker precache list and an electron-builder file list, none of which fail loudly when out of sync.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('index.html loads at least one script', () => assert.ok(scripts.length > 0));

test('every script tag points to an existing file', () => {
  for (const file of scripts) assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
});

test('the service worker precaches the page, styles and every script', () => {
  const shell = [...read('sw.js').matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  for (const file of ['index.html', 'style.css', 'manifest.webmanifest', ...scripts]) {
    assert.ok(shell.includes(file), `sw.js SHELL is missing ${file}`);
  }
});

test('the electron build ships every script', () => {
  const files = JSON.parse(read('package.json')).build.files;
  for (const file of ['index.html', 'style.css', 'main.js', 'preload.js', ...scripts]) {
    const covered = files.includes(file) || (file.endsWith('.js') && files.includes('*.js'));
    assert.ok(covered, `package.json build.files does not include ${file}`);
  }
});

test('the clipboard-history panel is wired up and shipped', () => {
  assert.ok(scripts.includes('history-panel.js'), 'index.html does not load history-panel.js');
  const files = JSON.parse(read('package.json')).build.files;
  assert.ok(files.includes('*.js'), 'main-process modules need the *.js glob');
  for (const file of ['history-service.js', 'clipboard-history.js']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  }
  assert.match(read('main.js'), /const \{ createHistoryService \} = require\('\.\/history-service\.js'\)/);
  const panelIds = [...read('history-panel.js').matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(panelIds.length > 0);
  for (const id of panelIds) assert.ok(html.includes(`id="${id}"`), `history-panel.js needs #${id} in index.html`);
});

test('screen recording is wired up and shipped', () => {
  for (const file of ['video-options.js', 'gif-encoder.js', 'webm-duration.js', 'mediabunny.min.js', 'video-editor.js', 'recorder.js']) {
    assert.ok(scripts.includes(file), `index.html does not load ${file}`);
  }
  assert.ok(fs.existsSync(path.join(root, 'capture-service.js')), 'capture-service.js is missing');
  assert.match(read('main.js'), /const \{ createCaptureService \} = require\('\.\/capture-service\.js'\)/);
  // recorded / previewed videos are blob: URLs, which the CSP must allow as media
  assert.match(html, /media-src 'self' blob:/);
  // Mediabunny (fast video conversion) starts its helper workers from blob: URLs
  assert.match(html, /worker-src 'self' blob:/);
  for (const file of ['recorder.js', 'video-editor.js']) {
    const ids = [...read(file).matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${file} needs #${id} in index.html`);
  }
});

test('shortcut settings are wired up and shipped', () => {
  for (const file of ['shortcuts.js', 'shortcut-settings.js']) assert.ok(scripts.includes(file), `index.html does not load ${file}`);
  assert.ok(fs.existsSync(path.join(root, 'global-shortcuts.js')), 'global-shortcuts.js is missing');
  assert.match(read('main.js'), /const \{ createGlobalShortcuts \} = require\('\.\/global-shortcuts\.js'\)/);
  const ids = [...read('shortcut-settings.js').matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `shortcut-settings.js needs #${id} in index.html`);
  // every data-shortcut names a real action
  const Shortcuts = require('../shortcuts.js');
  const named = [...html.matchAll(/data-shortcut="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(named.length > 0);
  for (const id of named) assert.ok(Shortcuts.getAction(id), `data-shortcut="${id}" is not an action`);
});

test('every icon <use> points to a symbol defined in the sprite', () => {
  const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const id of used) assert.ok(symbols.has(id), `icon #${id} has no <symbol>`);
  for (const id of symbols) assert.ok(used.includes(id), `symbol #${id} is never used`);
});

test('scripts load after the globals they use', () => {
  const providers = {
    App: 'app.js', Scene: 'scene.js', Draw: 'draw.js', Version: 'version.js', I18n: 'i18n.js', Keys: 'keys.js',
    ClipboardHistory: 'clipboard-history.js',
    VideoOptions: 'video-options.js', GifEncoder: 'gif-encoder.js', WebmDuration: 'webm-duration.js',
    Mediabunny: 'mediabunny.min.js', Shortcuts: 'shortcuts.js',
  };
  for (const script of scripts) {
    const source = read(script);
    for (const [global, provider] of Object.entries(providers)) {
      if (script === provider || !new RegExp(`\\b${global}\\.`).test(source)) continue;
      assert.ok(scripts.includes(provider), `${script} uses ${global} but ${provider} is not loaded`);
      assert.ok(
        scripts.indexOf(provider) < scripts.indexOf(script),
        `${provider} must be loaded before ${script}`,
      );
    }
  }
});
