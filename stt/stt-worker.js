// Speech-to-text worker (a module worker started by stt.js): runs Whisper with Transformers.js on
// this device. The model comes from one of two places, both on this device:
//   desktop:  stt/models/ next to this file;
//   web:      a folder the user picked (files passed in by stt.js). The web build has no model, so
//             the site never serves the ~240 MB of it.
// Remote models and the library's own browser / WebAssembly caches are off.
//   in:  {type:'load', files?}  -> 'progress'*, then 'ready' | 'missing' | 'error'
//        {type:'transcribe', audio: Float32Array, language, seconds} -> 'result' {text} | 'error'
import '../stt-config.js';
import { env, pipeline } from './transformers.min.js';

const Cfg = self.SttConfig;
const here = (name) => new URL(name, import.meta.url).href;

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

// ---------- load / transcribe ----------
async function load({ files }) {
  if (files) useFiles(files);
  // the model may be nowhere (the web build has none): say so before the library reports a vague error
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
