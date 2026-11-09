'use strict';

// Speech to text settings: which library, model and files are used and how a recording is turned
// into text. Pure (no DOM) so it loads in the browser (global `SttConfig`) and in Node unit tests
// (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SttConfig = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const LIBRARY = Object.freeze({ name: 'Transformers.js', version: '4.3.2' });
  const RUNTIME = Object.freeze({ name: 'ONNX Runtime Web', version: '1.31.0-dev.20260914' });
  /** OpenAI Whisper small (multilingual, 8-bit), pinned to one commit of the ONNX export. */
  const MODEL = Object.freeze({
    name: 'Whisper small',
    id: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    dtype: 'q8',
  });

  /**
   * Library + engine ship with the app (folder stt/). The model (~240 MB, stt/models/) ships only
   * with the desktop app; the web dialog asks for a folder with the files, which the user gets from
   * Hugging Face themselves (the site does not serve the model).
   */
  const DIR = 'stt';
  const MODELS_DIR = `${DIR}/models`;
  const FILES = Object.freeze({
    worker: 'stt-worker.js',
    library: 'transformers.min.js',
    runtime: 'ort-wasm-simd-threaded.mjs', // CPU WebAssembly build (14 MB; the WebGPU one is over 25 MB)
    wasm: 'ort-wasm-simd-threaded.wasm',
  });

  /** Model files, relative to the model folder; the download script and the folder check use this list. */
  const MODEL_FILES = Object.freeze([
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ]);

  /**
   * Spoken language choices. There is no "detect": Transformers.js then assumes English and
   * translates Thai speech. With Thai picked, English words in the speech are still written out.
   */
  const LANGUAGES = Object.freeze([
    Object.freeze({ code: 'th', whisper: 'thai' }),
    Object.freeze({ code: 'en', whisper: 'english' }),
  ]);

  /** Whisper hears 16 kHz mono in 30 s windows; longer recordings are cut with a small overlap. */
  const SAMPLE_RATE = 16000;
  const CHUNK_SECONDS = 30;
  const STRIDE_SECONDS = 5;
  const MAX_SECONDS = 30 * 60;
  /** WebAssembly threads used when the page may share memory with workers. */
  const MAX_THREADS = 4;

  const whisperLanguage = (code) => (LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]).whisper;

  /** Options passed to the speech-recognition pipeline for one recording. */
  function transcribeOptions(code, seconds) {
    const options = { task: 'transcribe', language: whisperLanguage(code) };
    if (seconds > CHUNK_SECONDS) {
      options.chunk_length_s = CHUNK_SECONDS;
      options.stride_length_s = STRIDE_SECONDS;
    }
    return options;
  }

  /** "onnx/encoder_model_quantized.onnx" -> "encoder_model_quantized.onnx" */
  const baseName = (p) => String(p).split(/[\\/]/).pop();

  /**
   * Picked folder -> model files. `paths` are the files' paths inside the picked folder; a file
   * counts by its name alone (the names are unique), so the files may sit side by side or in
   * subfolders, as they come when downloaded one by one.
   * @returns {{found: Map<string, number>, missing: string[]}} found: model file -> index in `paths`
   */
  function matchModelFiles(paths) {
    const found = new Map();
    const names = paths.map(baseName);
    for (const name of MODEL_FILES) {
      const index = names.indexOf(baseName(name));
      if (index >= 0) found.set(name, index);
    }
    return { found, missing: MODEL_FILES.filter((name) => !found.has(name)) };
  }

  /** Loudest sample below this = nothing was said (Whisper would make up a word like "you"). */
  const SILENCE_PEAK = 0.015;

  /** @param {Float32Array} samples */
  function isSilent(samples) {
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) >= SILENCE_PEAK) return false;
    }
    return true;
  }

  /** Tidies Whisper's output: drops the captions it makes up on silence ("[Music]", "(upbeat music)", "♪"). */
  function cleanText(text) {
    return String(text || '')
      .replace(/\[[^\]]*\]|\([^)]*\bmusic\b[^)]*\)|[♪♫]+/gi, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /** Adds a new recording's text on a new line below what is already in the box. */
  const appendText = (current, text) => {
    if (!text) return current;
    const kept = current.replace(/\s+$/, '');
    return kept ? `${kept}\n${text}` : text;
  };

  /** 83 -> "1:23" */
  const formatDuration = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return {
    LIBRARY,
    RUNTIME,
    MODEL,
    DIR,
    MODELS_DIR,
    FILES,
    MODEL_FILES,
    LANGUAGES,
    SAMPLE_RATE,
    CHUNK_SECONDS,
    STRIDE_SECONDS,
    MAX_SECONDS,
    MAX_THREADS,
    whisperLanguage,
    transcribeOptions,
    baseName,
    matchModelFiles,
    SILENCE_PEAK,
    isSilent,
    cleanText,
    appendText,
    formatDuration,
  };
});
