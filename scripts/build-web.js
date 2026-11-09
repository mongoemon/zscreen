// Copies the browser/PWA files into ./web so the folder can be hosted as-is on any static server.
const fs = require('fs');
const path = require('path');
const Stt = require('../stt-config.js');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'web');
// the script list comes from index.html so new modules cannot be forgotten here
const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)]
  .map((m) => m[1]);
const FILES = [
  'index.html',
  'style.css',
  ...scripts,
  'sw.js',
  'manifest.webmanifest',
  'THIRD_PARTY_LICENSES.txt',
  'build/icon-192.png',
  'build/icon-512.png',
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) {
    console.error(`missing ${file} - run "npm run icon" first`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(outDir, path.basename(file)));
}
// the OCR library + language files are loaded on demand from ocr/ (kept as a folder)
fs.cpSync(path.join(root, 'ocr'), path.join(outDir, 'ocr'), { recursive: true });
// speech to text: library + engine from stt/; the model (stt/models/, ~240 MB) separately below
fs.cpSync(path.join(root, 'stt'), path.join(outDir, 'stt'), {
  recursive: true,
  filter: (from) => !path.relative(path.join(root, 'stt'), from).startsWith('models'),
});
// The model, with files over Stt.PART_BYTES cut into parts (Cloudflare Pages serves files up to
// 25 MiB) and listed in parts.json; the page downloads it once on the user's go-ahead (stt-worker.js).
const modelFrom = path.join(root, Stt.MODELS_DIR, Stt.MODEL.id);
const modelTo = path.join(outDir, Stt.MODELS_DIR, Stt.MODEL.id);
if (Stt.MODEL_FILES.every((name) => fs.existsSync(path.join(modelFrom, name)))) {
  const parts = {};
  for (const name of Stt.MODEL_FILES) {
    const data = fs.readFileSync(path.join(modelFrom, name));
    const entry = { size: data.length, parts: Stt.partCount(data.length) };
    fs.mkdirSync(path.dirname(path.join(modelTo, name)), { recursive: true });
    for (const [i, part] of Stt.partsOf(name, entry).entries()) {
      fs.writeFileSync(path.join(modelTo, part.path), data.subarray(i * Stt.PART_BYTES, i * Stt.PART_BYTES + part.size));
    }
    parts[name] = entry;
  }
  fs.writeFileSync(path.join(modelTo, Stt.PARTS_FILE), JSON.stringify(parts, null, 2));
} else {
  console.warn('no speech-to-text model in stt/models (npm run stt:model): the web version will ask users for a model folder');
}
// Cloudflare Pages headers: cross-origin isolation gives the page SharedArrayBuffer, so Whisper can
// use several threads. Everything is loaded from this site, which is all that isolation allows.
fs.writeFileSync(path.join(outDir, '_headers'), [
  '/*',
  '  Cross-Origin-Opener-Policy: same-origin',
  '  Cross-Origin-Embedder-Policy: require-corp',
  '',
].join('\n'));
console.log(`web build ready: ${outDir} (${FILES.length} files)`);
