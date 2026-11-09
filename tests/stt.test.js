'use strict';

// Speech to text: the fixed settings, the folder check of the web version, and that the library +
// engine ship with the app while the model ships only with the desktop app. That nothing is
// downloaded or cached is in privacy.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SttConfig = require('../stt-config.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Thai and English are the choices, with no auto-detect (it translates Thai into English)', () => {
  assert.deepEqual(SttConfig.LANGUAGES.map((l) => l.code), ['th', 'en']);
  assert.equal(SttConfig.whisperLanguage('th'), 'thai');
  assert.equal(SttConfig.whisperLanguage('en'), 'english');
  assert.equal(SttConfig.whisperLanguage('xx'), 'thai', 'unknown codes fall back to the first choice');
  assert.ok(Object.isFrozen(SttConfig.LANGUAGES) && Object.isFrozen(SttConfig.MODEL_FILES));
});

test('transcribeOptions always transcribes (never translates) and chunks only long recordings', () => {
  assert.deepEqual(SttConfig.transcribeOptions('th', 12), { task: 'transcribe', language: 'thai' });
  assert.deepEqual(SttConfig.transcribeOptions('en', 30), { task: 'transcribe', language: 'english' });
  assert.deepEqual(SttConfig.transcribeOptions('th', 95), {
    task: 'transcribe', language: 'thai', chunk_length_s: 30, stride_length_s: 5,
  });
});

test('matchModelFiles finds the files by name, side by side or in subfolders, on any OS', () => {
  const asOnHub = SttConfig.MODEL_FILES.map((f) => `whisper-small/${f}`);
  const { found, missing } = SttConfig.matchModelFiles(['whisper-small/README.md', ...asOnHub]);
  assert.deepEqual(missing, []);
  assert.equal(found.get('config.json'), 1);
  assert.equal(found.get('onnx/encoder_model_quantized.onnx'), 1 + SttConfig.MODEL_FILES.indexOf('onnx/encoder_model_quantized.onnx'));

  const flat = SttConfig.MODEL_FILES.map((f) => `model/${SttConfig.baseName(f)}`);
  assert.deepEqual(SttConfig.matchModelFiles(flat).missing, [], 'downloaded one by one into one folder');
  const windows = SttConfig.MODEL_FILES.map((f) => `Downloads\\whisper\\${f.replace('/', '\\')}`);
  assert.deepEqual(SttConfig.matchModelFiles(windows).missing, []);
});

test('matchModelFiles reports what is missing and does not match partial names', () => {
  const { missing } = SttConfig.matchModelFiles(['m/config.json', 'm/my_tokenizer.json', 'm/encoder_model_quantized.onnx']);
  assert.ok(!missing.includes('config.json'));
  assert.ok(missing.includes('tokenizer.json'), 'my_tokenizer.json is not tokenizer.json');
  assert.ok(!missing.includes('onnx/encoder_model_quantized.onnx'), 'found without its onnx/ folder');
  assert.ok(missing.includes('onnx/decoder_model_merged_quantized.onnx'));
  assert.deepEqual(SttConfig.matchModelFiles([]).missing, [...SttConfig.MODEL_FILES]);
});

test('isSilent spots a recording with no speech in it', () => {
  assert.equal(SttConfig.isSilent(new Float32Array(16000)), true);
  const hum = new Float32Array(16000).map((_, i) => Math.sin(i / 10) * 0.005);
  assert.equal(SttConfig.isSilent(hum), true, 'background hum');
  const speech = new Float32Array(16000);
  speech[8000] = -0.2;
  assert.equal(SttConfig.isSilent(speech), false);
});

test('cleanText drops the captions Whisper makes up on silence and tidies spaces', () => {
  assert.equal(SttConfig.cleanText(' สวัสดีครับ  วันนี้ '), 'สวัสดีครับ วันนี้');
  assert.equal(SttConfig.cleanText('[Music]'), '');
  assert.equal(SttConfig.cleanText('(upbeat music) Hello ♪'), 'Hello');
  assert.equal(SttConfig.cleanText('meet at 3 (or 4)'), 'meet at 3 (or 4)');
  assert.equal(SttConfig.cleanText(undefined), '');
});

test('appendText puts each recording on its own line', () => {
  assert.equal(SttConfig.appendText('', 'one'), 'one');
  assert.equal(SttConfig.appendText('one\n\n', 'two'), 'one\ntwo');
  assert.equal(SttConfig.appendText('  ', 'two'), 'two');
  assert.equal(SttConfig.appendText('one', ''), 'one');
});

test('formatDuration shows minutes:seconds', () => {
  assert.equal(SttConfig.formatDuration(0), '0:00');
  assert.equal(SttConfig.formatDuration(83.9), '1:23');
  assert.equal(SttConfig.formatDuration(600), '10:00');
  assert.equal(SttConfig.formatDuration(-1), '0:00');
});

test('the library and engine are in stt/, and the versions match the license notices', () => {
  for (const file of Object.values(SttConfig.FILES)) {
    assert.ok(fs.existsSync(path.join(root, SttConfig.DIR, file)), `${SttConfig.DIR}/${file} is missing`);
  }
  const wasm = fs.statSync(path.join(root, SttConfig.DIR, SttConfig.FILES.wasm)).size;
  assert.ok(wasm < 25 * 1024 * 1024, 'Cloudflare Pages serves files up to 25 MiB');
  assert.ok(read(`stt/${SttConfig.FILES.library}`).includes(`"${SttConfig.LIBRARY.version}"`));
  const notices = read('THIRD_PARTY_LICENSES.txt');
  for (const { name, version } of [SttConfig.LIBRARY, SttConfig.RUNTIME]) {
    assert.ok(notices.includes(`${name} ${version}`), `THIRD_PARTY_LICENSES.txt should name ${name} ${version}`);
  }
  assert.ok(notices.includes(`${SttConfig.MODEL.id}@${SttConfig.MODEL.revision}`), 'the notices name the pinned model');
});

test('the web build and its deploy leave the model out (the site never serves it)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!pkg.scripts['build:web'].includes('fetch-stt-model'));
  assert.ok(!read('.github/workflows/deploy.yml').includes('fetch-stt-model'));
  const html = read('index.html');
  assert.ok(!html.includes('stt-get'), 'no download button');
  assert.ok(html.includes('id="stt-connect"'), 'the folder setup is still there');
});

test('the desktop app ships stt/ with the whole model files', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('stt/**'), 'package.json build.files');
  for (const target of ['dist:win', 'dist:mac']) {
    assert.match(pkg.scripts[target], /^node scripts\/fetch-stt-model\.js && electron-builder/, `${target} fetches the model first`);
  }
  assert.ok(read('.gitignore').split('\n').includes('stt/models/'), 'the model is not committed');
  const build = read('scripts/build-web.js');
  assert.ok(build.includes("fs.cpSync(path.join(root, 'stt'), path.join(outDir, 'stt')"), 'web build copies stt/');
  assert.ok(build.includes(".startsWith('models')"), 'stt/models/ is not copied whole');
  assert.match(read('main.js'), /appendSwitch\('enable-features', 'SharedArrayBuffer'\)/, 'threads in the desktop app');
});

test('the speech-to-text button, dialog and shortcut are wired up', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('stt-config.js') >= 0 && scripts.indexOf('stt-config.js') < scripts.indexOf('stt.js'), 'stt-config.js loads before stt.js');
  assert.ok(!scripts.some((s) => s.startsWith('stt/')), 'the library is loaded in the worker, not on start-up');
  const ids = [...read('stt.js').matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `stt.js needs #${id} in index.html`);
  assert.ok(read('input.js').includes('speechToText: () => App.openSpeechToText()'));
  assert.ok(read('stt.js').includes('new Worker(`${Cfg.DIR}/${Cfg.FILES.worker}`, { type: \'module\' })'));
});

test('a recording may last up to 30 minutes', () => {
  assert.equal(SttConfig.MAX_SECONDS, 30 * 60);
});
