// Speech-to-text worker (a module worker started by stt.js): runs Whisper with Transformers.js on
// this device. The model comes from one of three places, all on this device or this app's own site:
//   desktop:  stt/models/ next to this file (whole files);
//   web:      stt/models/ on the site, cut into parts (scripts/build-web.js), downloaded once when
//             the user says so and kept in Cache Storage (SttConfig.cacheName());
//   fallback: a folder the user picked (files passed in by stt.js).
// Remote models and the library's own browser / WebAssembly caches are off.
//   in:  {type:'load', files?, download?}  -> 'progress'*, then 'ready' | 'download' {bytes} | 'missing' | 'error'
//        {type:'transcribe', audio: Float32Array, language, seconds} -> 'result' {text} | 'error'
import '../stt-config.js';
import { env, pipeline } from './transformers.min.js';

const Cfg = self.SttConfig;
const here = (name) => new URL(name, import.meta.url).href;
const modelPath = (name) => `models/${Cfg.MODEL.id}/${name}`;

env.allowRemoteModels = false;
env.allowLocalModels = true;
// relative to this worker (stt/models/): with a full http URL the library skips its check of which
// local files exist and leaves out the audio processor
env.localModelPath = 'models/';
env.useBrowserCache = false;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = { mjs: here(Cfg.FILES.runtime), wasm: here(Cfg.FILES.wasm) };
// threads need SharedArrayBuffer (the desktop app turns it on; a plain web page has it only when cross-origin isolated)
env.backends.onnx.wasm.numThreads = typeof SharedArrayBuffer === 'function'
  ? Math.min(Cfg.MAX_THREADS, navigator.hardwareConcurrency || 1) : 1;

let asr = null;

/** Every model request goes to the app itself (this folder), never anywhere else. */
const get = (path) => fetch(here(path));
const nameOf = (url) => decodeURIComponent(String(url).split('?')[0]).replace(`${env.localModelPath}${Cfg.MODEL.id}/`, '');
const fileResponse = (blob) => new Response(blob, { headers: { 'content-length': String(blob.size) } });
const notFound = () => new Response(null, { status: 404, statusText: 'Not Found' });

/** Serves the model files from the picked folder. */
function useFiles(files) {
  env.fetch = async (url) => {
    const file = files[nameOf(url)];
    return file ? fileResponse(file) : notFound();
  };
}

// ---------- web: the model in parts, kept in Cache Storage ----------
/** Cache Storage when the page has it (secure contexts), else memory until the worker ends. */
async function openCache() {
  if (self.caches) {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(Cfg.CACHE_PREFIX) && n !== Cfg.cacheName()).map((n) => caches.delete(n)));
    return caches.open(Cfg.cacheName());
  }
  const memory = new Map();
  return {
    match: async (key) => (memory.has(key) ? new Response(memory.get(key)) : undefined),
    put: async (key, response) => { memory.set(key, await response.blob()); },
  };
}

const allParts = (parts) => Object.entries(parts).flatMap(([name, entry]) => Cfg.partsOf(name, entry).map((p) => ({ ...p, name })));

/** Downloads the parts not in the cache yet, reporting progress per model file. */
async function downloadParts(parts, cache) {
  const done = new Map(); // model file -> bytes so far
  const add = (name, bytes) => done.set(name, (done.get(name) || 0) + bytes);
  for (const part of allParts(parts)) {
    const key = here(modelPath(part.path));
    if (await cache.match(key)) {
      add(part.name, part.size);
      continue;
    }
    const response = await get(modelPath(part.path));
    if (!response.ok) throw new Error(`${part.path}: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks = [];
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      add(part.name, value.length);
      self.postMessage({ type: 'progress', phase: 'download', file: part.name, loaded: done.get(part.name), total: parts[part.name].size });
    }
    await cache.put(key, new Response(new Blob(chunks)));
  }
}

/** Bytes still to download (0 = everything is in the cache). */
async function missingBytes(parts, cache) {
  let bytes = 0;
  for (const part of allParts(parts)) {
    if (!(await cache.match(here(modelPath(part.path))))) bytes += part.size;
  }
  return bytes;
}

/** Serves each model file from the cache, its parts joined back together. */
function useCache(parts, cache) {
  env.fetch = async (url) => {
    const name = nameOf(url);
    if (!parts[name]) return notFound();
    const blobs = await Promise.all(Cfg.partsOf(name, parts[name]).map(async (p) => (await cache.match(here(modelPath(p.path)))).blob()));
    return fileResponse(new Blob(blobs));
  };
}

/** @returns {Promise<boolean>} false: the user has not agreed to the download yet */
async function useWebModel(parts, download) {
  const cache = await openCache();
  const bytes = await missingBytes(parts, cache);
  if (bytes > 0 && !download) {
    self.postMessage({ type: 'download', bytes });
    return false;
  }
  if (bytes > 0) await downloadParts(parts, cache);
  useCache(parts, cache);
  return true;
}

async function readParts() {
  const response = await get(modelPath(Cfg.PARTS_FILE)).catch(() => null);
  return response && response.ok ? response.json() : null;
}

// ---------- load / transcribe ----------
async function load({ files, download }) {
  if (files) {
    useFiles(files);
  } else {
    const parts = await readParts();
    if (parts && !(await useWebModel(parts, download))) return;
  }
  // the model may be nowhere (a web build without it): say so before the library reports a vague error
  const probe = await env.fetch(`${env.localModelPath}${Cfg.MODEL.id}/${Cfg.MODEL_FILES[0]}`).catch(() => null);
  if (!probe || !probe.ok) {
    self.postMessage({ type: 'missing' });
    return;
  }
  asr = await pipeline('automatic-speech-recognition', Cfg.MODEL.id, {
    dtype: Cfg.MODEL.dtype,
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress') self.postMessage({ type: 'progress', phase: 'load', file: p.file, loaded: p.loaded, total: p.total });
    },
  });
  self.postMessage({ type: 'ready' });
}

async function transcribe({ audio, language, seconds }) {
  const out = await asr(audio, Cfg.transcribeOptions(language, seconds));
  self.postMessage({ type: 'result', text: Cfg.cleanText(out.text) });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data);
    else if (data.type === 'transcribe') await transcribe(data);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
