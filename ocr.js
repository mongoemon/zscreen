'use strict';

// Export text (OCR): reads the text in the picked region, the selected image or the whole canvas
// and shows it in a dialog to copy or save as .txt. Tesseract.js (folder ocr/, see ocr-config.js) is
// loaded on first use and runs in a worker on this device; its files come from the app itself and
// nothing is cached in browser storage. Also fills the read-only OCR section of the settings dialog.
(() => {
  const { $, state: S, toast } = App;
  const Cfg = OcrConfig;

  const dialog = $('ocr-dialog');
  const textBox = $('ocr-text');
  const progressRow = $('ocr-progress-row');
  const progressBar = $('ocr-progress');
  const statusLabel = $('ocr-status');
  const info = $('ocr-info');
  const copyButton = $('ocr-copy');
  const saveButton = $('ocr-save');
  const keepButton = $('ocr-keep');

  /** Tesseract.js logger status -> message shown under the progress bar. */
  const STATUS = Object.freeze({
    'loading tesseract core': 'ocr.statusLoading',
    'loading language traineddata': 'ocr.statusLoading',
    'initializing api': 'ocr.statusLoading',
    'recognizing text': 'ocr.statusReading',
  });

  const fileUrl = (name) => new URL(`${Cfg.DIR}/${name}`, location.href).href;

  // ---------- library ----------
  let libraryPromise = null;

  /** Adds ocr/tesseract.min.js to the page once (about 60 KB; the engine itself loads in the worker). */
  function loadLibrary() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${Cfg.DIR}/${Cfg.FILES.library}`;
        script.onload = () => resolve(window.Tesseract);
        script.onerror = () => {
          libraryPromise = null;
          script.remove();
          reject(new Error('could not load the OCR library'));
        };
        document.head.appendChild(script);
      });
    }
    return libraryPromise;
  }

  // ---------- source image ----------
  /** The picked region, else the selected image, else everything; annotations included (a censor box hides its text). */
  function sourceCanvas() {
    if (S.region) return App.regionCanvas();
    const { list, anns } = App.selectionTarget();
    return App.composeCanvas(list, anns);
  }

  /** Enlarged copy on white (transparent areas would read as black). */
  function prepare(source) {
    const k = Cfg.scaleFor(source.width, source.height);
    const out = document.createElement('canvas');
    out.width = source.width * k;
    out.height = source.height * k;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
  }

  // ---------- recognition ----------
  let run = null; // {worker} of the recognition in progress; replaced / cleared to cancel it

  function showProgress(statusKey, progress) {
    statusLabel.textContent = I18n.t(statusKey, { percent: Math.round(progress * 100) });
    progressBar.value = progress;
  }

  function stopRun() {
    if (run && run.worker) run.worker.terminate().catch(() => {});
    run = null;
  }

  async function recognize(blob, current) {
    const Tesseract = await loadLibrary();
    if (run !== current) return null;
    current.worker = await Tesseract.createWorker([...Cfg.LANGUAGES], Cfg.OEM, {
      workerPath: fileUrl(Cfg.FILES.worker),
      corePath: fileUrl(Cfg.FILES.core),
      langPath: fileUrl('').replace(/\/$/, ''),
      cacheMethod: 'none', // no IndexedDB copy of the language files
      workerBlobURL: false,
      logger: (m) => {
        if (run === current && STATUS[m.status]) showProgress(STATUS[m.status], m.progress || 0);
      },
    });
    if (run !== current) {
      current.worker.terminate().catch(() => {});
      return null;
    }
    await current.worker.setParameters(Cfg.PARAMETERS);
    const { data } = await current.worker.recognize(blob);
    return data;
  }

  function setBusy(busy) {
    progressRow.hidden = !busy;
    textBox.hidden = busy;
    copyButton.disabled = busy;
    saveButton.disabled = busy;
    keepButton.disabled = busy;
  }

  async function exportText() {
    App.commitText();
    if (S.items.length === 0) {
      toast('toast.noImages');
      return;
    }
    stopRun();
    const current = {};
    run = current;
    textBox.value = '';
    info.textContent = '';
    setBusy(true);
    showProgress('ocr.statusLoading', 0);
    openDialog();
    const started = performance.now();
    try {
      const blob = await App.toPngBlob(prepare(sourceCanvas()));
      const data = await recognize(blob, current);
      if (run !== current || !data) return;
      const text = Cfg.cleanText(data.text);
      textBox.value = text;
      info.textContent = text
        ? I18n.t('ocr.result', {
          confidence: Math.round(data.confidence || 0),
          seconds: ((performance.now() - started) / 1000).toFixed(1),
        })
        : I18n.t('ocr.empty');
      setBusy(false);
      textBox.focus();
      textBox.setSelectionRange(0, 0);
      textBox.scrollTop = 0;
    } catch (err) {
      if (run !== current) return;
      console.error(err);
      info.textContent = I18n.t('ocr.failed');
      setBusy(false);
    } finally {
      if (run === current) stopRun();
    }
  }

  // ---------- dialog ----------
  const isOcrOpen = () => !dialog.hidden;

  function openDialog() {
    dialog.hidden = false;
    $('ocr-close').focus();
  }

  function closeDialog() {
    stopRun();
    dialog.hidden = true;
    $('btn-ocr').focus();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(textBox.value);
      toast('toast.textCopied');
    } catch (err) {
      console.error(err);
      toast('toast.copyFailed');
    }
  }

  function saveText() {
    const blob = new Blob([textBox.value], { type: 'text/plain;charset=utf-8' });
    App.downloadBlob(blob, `${App.documentFileName() || 'zcreenshot'}-${App.fileStamp()}.txt`);
  }

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDialog();
  });
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeDialog(); });
  $('ocr-close').addEventListener('click', closeDialog);
  $('btn-ocr').addEventListener('click', exportText);
  copyButton.addEventListener('click', copyText);
  saveButton.addEventListener('click', saveText);
  keepButton.addEventListener('click', () => App.keepSnippet(textBox.value));

  // ---------- settings: what is used, read-only ----------
  function renderSettings() {
    const rows = [
      ['ocr.setLibrary', `${Cfg.LIBRARY.name} ${Cfg.LIBRARY.version}`],
      ['ocr.setEngine', `${Cfg.CORE.engine} (${Cfg.CORE.name} ${Cfg.CORE.version}, WebAssembly SIMD)`],
      ['ocr.setLanguages', Cfg.LANGUAGES.join(' + ')],
      ['ocr.setModel', `${Cfg.MODEL.name} ${Cfg.MODEL.version}`],
      ['ocr.setOem', `${Cfg.OEM} · ${I18n.t('ocr.oemValue')}`],
      ['ocr.setPsm', `${Cfg.PSM} · ${I18n.t('ocr.psmValue')}`],
      ['ocr.setParams', Object.entries(Cfg.PARAMETERS).map(([k, v]) => `${k} = ${v}`).join('\n')],
      ['ocr.setUpscale', I18n.t('ocr.upscaleValue', { scale: Cfg.UPSCALE, megapixels: Cfg.MAX_PIXELS / 1e6 })],
      ['ocr.setWhere', I18n.t('ocr.whereValue')],
    ];
    $('ocr-settings').replaceChildren(...rows.flatMap(([labelKey, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = I18n.t(labelKey);
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }));
  }

  renderSettings();
  I18n.subscribe(renderSettings);

  Object.assign(App, { exportText, isOcrOpen });
})();
