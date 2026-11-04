'use strict';

// Text recognition (OCR) settings: which library and files are used and the values passed to it.
// Fixed for now; the settings dialog lists them read-only. Pure (no DOM) so it loads in the browser
// (global `OcrConfig`) and in Node unit tests (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OcrConfig = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const LIBRARY = Object.freeze({ name: 'Tesseract.js', version: '7.0.0' });
  const CORE = Object.freeze({ name: 'tesseract.js-core', version: '6.1.2', engine: 'Tesseract OCR 5' });
  const MODEL = Object.freeze({ name: 'tessdata_best_int', version: '4.0.0' });

  /** Everything ships with the app (folder ocr/); nothing is downloaded from elsewhere. */
  const DIR = 'ocr';
  const FILES = Object.freeze({
    library: 'tesseract.min.js',
    worker: 'worker.min.js',
    core: 'tesseract-core-simd-lstm.wasm.js', // WebAssembly SIMD build without the legacy engine
  });

  const LANGUAGES = Object.freeze(['eng', 'tha']);
  const OEM = 1; // LSTM only (the neural-network engine; the legacy one is not shipped)
  const PSM = 3; // fully automatic page segmentation, no orientation / script detection

  /** Tesseract parameters set before recognising. */
  const PARAMETERS = Object.freeze({
    tessedit_pageseg_mode: String(PSM),
    preserve_interword_spaces: '1', // keep the spacing as in the image (Thai has no spaces between words)
  });

  /**
   * Screenshots are ~96-144 dpi, while Tesseract is tuned for ~300 dpi text: enlarging the image
   * fixes most misread small UI text. Very large images are left as they are to bound time and memory.
   */
  const UPSCALE = 2;
  const MAX_PIXELS = 24_000_000;

  /** How much to enlarge a `width` x `height` image before recognising it. */
  function scaleFor(width, height) {
    if (!(width > 0 && height > 0)) return 1;
    return width * height * UPSCALE * UPSCALE <= MAX_PIXELS ? UPSCALE : 1;
  }

  /**
   * Tidies Tesseract's output: the Thai model writes SARA AM as NIKHAHIT + SARA AA (it looks the same
   * but searching / pasting the text fails), with a tone mark sometimes in between (U+0E49).
   */
  function cleanText(text) {
    return String(text || '')
      .replace(/\u0E4D([\u0E48-\u0E4B]?)\u0E32/g, '$1\u0E33')
      .trim();
  }

  /** Language files: `${DIR}/${lang}.traineddata.gz`. */
  const languageFiles = () => LANGUAGES.map((lang) => `${DIR}/${lang}.traineddata.gz`);

  return {
    LIBRARY,
    CORE,
    MODEL,
    DIR,
    FILES,
    LANGUAGES,
    OEM,
    PSM,
    PARAMETERS,
    UPSCALE,
    MAX_PIXELS,
    scaleFor,
    cleanText,
    languageFiles,
  };
});
