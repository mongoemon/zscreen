// Downloads the speech-to-text model (Whisper small, ~250 MB) into stt/models/ so the desktop
// installer ships with it (`npm run dist:*` runs this first; files already there are kept).
// The model is not in git (too large); the app itself never downloads it.
const fs = require('fs');
const path = require('path');
const Cfg = require('../stt-config.js');

const root = path.join(__dirname, '..');
const modelDir = path.join(root, Cfg.MODELS_DIR, Cfg.MODEL.id);
const base = `https://huggingface.co/${Cfg.MODEL.id}/resolve/${Cfg.MODEL.revision}`;

async function download(name) {
  const to = path.join(modelDir, name);
  if (fs.existsSync(to) && fs.statSync(to).size > 0) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  process.stdout.write(`${name} … `);
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const part = `${to}.part`;
  fs.writeFileSync(part, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(part, to);
  console.log(`${(fs.statSync(to).size / 1e6).toFixed(1)} MB`);
}

async function main() {
  for (const name of Cfg.MODEL_FILES) await download(name);
  console.log(`model ready: ${modelDir}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
