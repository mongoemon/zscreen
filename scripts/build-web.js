// Copies the browser/PWA files into ./web so the folder can be hosted as-is on any static server.
const fs = require('fs');
const path = require('path');

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
console.log(`web build ready: ${outDir} (${FILES.length} files)`);
