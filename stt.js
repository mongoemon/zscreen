'use strict';

// Speech to text: records the microphone and turns Thai or English speech into text in a dialog,
// to edit, copy or save as .txt. Whisper runs in a worker on this device (stt/stt-worker.js, see
// stt-config.js); the sound never leaves it. The desktop app has the model in stt/models/; the web
// version has none and asks for a folder with the model files, which the user gets themselves.
(() => {
  const { $, toast } = App;
  const Cfg = SttConfig;
  const capture = window.zcreenshot && window.zcreenshot.capture;
  const button = $('btn-stt');
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && window.Worker)) {
    button.hidden = true;
    App.openSpeechToText = () => {};
    return;
  }

  const TICK_MS = 100;
  const LANGUAGE_LABELS = Object.freeze({ th: 'stt.langTh', en: 'stt.langEn' });

  const dialog = $('stt-dialog');
  const setup = $('stt-setup');
  const setupError = $('stt-setup-error');
  const folderInput = $('stt-folder');
  const langSelect = $('stt-lang');
  const recordButton = $('stt-record');
  const timeEl = $('stt-time');
  const levelEl = $('stt-level');
  const progressRow = $('stt-progress-row');
  const progressBar = $('stt-progress');
  const statusLabel = $('stt-status');
  const textBox = $('stt-text');
  const info = $('stt-info');

  // ---------- model (worker) ----------
  /** @type {{worker: Worker, ready: boolean, busy: boolean, loaded: Map<string, number[]>} | null} */
  let engine = null;
  /** Model files picked in the web version: {[modelFile]: File}, reused while the page stays open. */
  let pickedFiles = null;

  function setStatus(key, params, progress = null) {
    progressRow.hidden = !key;
    if (!key) return;
    statusLabel.textContent = I18n.t(key, params);
    if (progress === null) progressBar.removeAttribute('value'); // indeterminate
    else progressBar.value = progress;
  }

  /** Overall progress from the per-file reports (sizes are unknown when the desktop app reads its files). */
  function loadProgress(loaded) {
    let done = 0;
    let total = 0;
    for (const [d, t] of loaded.values()) {
      done += d;
      total += t;
    }
    return total > 0 ? done / total : null;
  }

  function stopEngine() {
    if (engine) engine.worker.terminate();
    engine = null;
  }

  /** Starts the worker and loads the model (bundled, else the picked folder). */
  function startEngine() {
    stopEngine();
    const current = {
      worker: new Worker(`${Cfg.DIR}/${Cfg.FILES.worker}`, { type: 'module' }),
      ready: false,
      busy: false,
      loaded: new Map(),
    };
    engine = current;
    current.worker.onmessage = ({ data }) => { if (engine === current) onWorkerMessage(current, data); };
    current.worker.onerror = (e) => {
      if (engine !== current) return;
      console.error('speech-to-text worker failed', e.message);
      stopEngine();
      setStatus(null);
      info.textContent = I18n.t('stt.loadFailed');
      updateControls();
    };
    setStatus('stt.statusLoading');
    current.worker.postMessage({ type: 'load', files: pickedFiles });
    updateControls();
  }

  function onWorkerMessage(current, data) {
    if (data.type === 'progress' && current.ready) return; // a late report must not hide what is going on now
    if (data.type === 'progress') {
      if (data.total) current.loaded.set(data.file, [data.loaded, data.total]);
      const progress = loadProgress(current.loaded);
      if (progress === null) setStatus('stt.statusLoading');
      else setStatus('stt.statusLoadingPercent', { percent: Math.round(progress * 100) }, progress);
    } else if (data.type === 'ready') {
      current.ready = true;
      setup.hidden = true;
      setStatus(null);
      info.textContent = I18n.t('stt.ready');
    } else if (data.type === 'missing') {
      stopEngine();
      setStatus(null);
      setup.hidden = false;
      info.textContent = '';
    } else if (data.type === 'result') {
      current.busy = false;
      setStatus(null);
      showResult(data.text);
    } else if (data.type === 'error') {
      console.error('speech to text failed:', data.message);
      setStatus(null);
      info.textContent = I18n.t(current.ready ? 'stt.failed' : 'stt.loadFailed');
      if (current.ready) current.busy = false;
      else stopEngine();
    }
    updateControls();
  }

  // ---------- web: connect the model folder the user put together ----------
  $('stt-files').replaceChildren(...Cfg.MODEL_FILES.map((name) => {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = name;
    li.append(code);
    return li;
  }));

  function connectFolder() {
    const files = [...folderInput.files];
    folderInput.value = '';
    if (files.length === 0) return;
    const { found, missing } = Cfg.matchModelFiles(files.map((f) => f.webkitRelativePath || f.name));
    if (missing.length > 0) {
      setupError.textContent = I18n.t('stt.missingFiles', { files: missing.join(', ') });
      setupError.hidden = false;
      return;
    }
    setupError.hidden = true;
    pickedFiles = Object.fromEntries([...found].map(([name, index]) => [name, files[index]]));
    startEngine();
  }

  // ---------- recording ----------
  /** @type {{stream: MediaStream, recorder: MediaRecorder, chunks: Blob[], startedAt: number,
   *   timer: number, audio: AudioContext, keep: boolean} | null} */
  let session = null;

  async function openMicrophone() {
    try {
      if (capture && !(await capture.askMicrophone())) throw new Error('microphone access denied');
      return await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      console.warn('could not open the microphone', err);
      toast('toast.audioFailed');
      return null;
    }
  }

  /** Microphone level 0..1 for the meter (peak of the latest samples). */
  function level(analyser, samples) {
    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    return Math.min(1, peak * 1.5);
  }

  async function startRecording() {
    if (session || !engine || !engine.ready || engine.busy) return;
    const stream = await openMicrophone();
    if (!stream) return;
    if (session || !isOpen()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const current = {
      stream, recorder: new MediaRecorder(stream), chunks: [], startedAt: performance.now(), timer: 0, audio, keep: true,
    };
    session = current;
    current.recorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) current.chunks.push(e.data); });
    current.recorder.addEventListener('stop', () => finishRecording(current));
    current.recorder.start(1000);
    current.timer = setInterval(() => {
      const seconds = (performance.now() - current.startedAt) / 1000;
      timeEl.textContent = Cfg.formatDuration(seconds);
      levelEl.value = level(analyser, samples);
      if (seconds >= Cfg.MAX_SECONDS) stopRecording();
    }, TICK_MS);
    stream.getAudioTracks()[0].addEventListener('ended', () => stopRecording()); // microphone unplugged
    timeEl.textContent = Cfg.formatDuration(0);
    setStatus('stt.statusListening');
    info.textContent = I18n.t('stt.maxNote', { minutes: Cfg.MAX_SECONDS / 60 });
    updateControls();
  }

  /** @param {boolean} keep false drops the recording (the dialog was closed) */
  function stopRecording(keep = true) {
    if (!session) return;
    session.keep = keep;
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  }

  async function finishRecording(current) {
    clearInterval(current.timer);
    current.stream.getTracks().forEach((t) => t.stop());
    current.audio.close().catch(() => {});
    session = null;
    levelEl.value = 0;
    updateControls();
    if (!current.keep || !engine || !engine.ready) {
      setStatus(null);
      return;
    }
    try {
      const samples = await decode(new Blob(current.chunks, { type: current.recorder.mimeType }));
      if (Cfg.isSilent(samples)) {
        setStatus(null);
        info.textContent = I18n.t('stt.empty');
      } else {
        transcribe(samples);
      }
    } catch (err) {
      console.error(err);
      setStatus(null);
      info.textContent = I18n.t('stt.failed');
    }
  }

  /** Recording -> 16 kHz mono samples, as Whisper hears them (the browser resamples while decoding). */
  async function decode(blob) {
    const context = new AudioContext({ sampleRate: Cfg.SAMPLE_RATE });
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      return new Float32Array(buffer.getChannelData(0)); // a copy, so its memory can move to the worker
    } finally {
      context.close().catch(() => {});
    }
  }

  let started = 0;
  let duration = 0;

  function transcribe(samples) {
    duration = samples.length / Cfg.SAMPLE_RATE;
    started = performance.now();
    engine.busy = true;
    setStatus('stt.statusConverting');
    info.textContent = '';
    updateControls();
    engine.worker.postMessage({ type: 'transcribe', audio: samples, language: langSelect.value, seconds: duration }, [samples.buffer]);
  }

  function showResult(text) {
    if (!text) {
      info.textContent = I18n.t('stt.empty');
      return;
    }
    textBox.value = Cfg.appendText(textBox.value, text);
    textBox.scrollTop = textBox.scrollHeight;
    info.textContent = I18n.t('stt.result', {
      duration: Cfg.formatDuration(duration),
      seconds: ((performance.now() - started) / 1000).toFixed(1),
    });
    if (!isOpen()) stopEngine(); // converted after the dialog was closed
  }

  // ---------- dialog ----------
  const isOpen = () => !dialog.hidden;

  function updateControls() {
    const recording = !!session;
    const canRecord = !!(engine && engine.ready && !engine.busy);
    recordButton.disabled = !recording && !canRecord;
    recordButton.classList.toggle('recording', recording);
    recordButton.querySelector('use').setAttribute('href', recording ? '#i-stop' : '#i-mic');
    recordButton.querySelector('span').textContent = I18n.t(recording ? 'stt.stop' : 'stt.record');
    langSelect.disabled = recording;
    timeEl.hidden = !recording;
    levelEl.hidden = !recording;
    const hasText = textBox.value.trim() !== '';
    $('stt-copy').disabled = !hasText;
    $('stt-save').disabled = !hasText;
    $('stt-keep').disabled = !hasText;
    $('stt-clear').disabled = !hasText;
  }

  /** The spoken language follows the app's language until one is picked here. */
  let languagePicked = false;

  function renderLanguages() {
    const value = languagePicked ? langSelect.value : (I18n.getLocale() === 'th' ? 'th' : 'en');
    langSelect.replaceChildren(...Cfg.LANGUAGES.map(({ code }) => new Option(I18n.t(LANGUAGE_LABELS[code]), code)));
    langSelect.value = value;
  }

  function openSpeechToText() {
    if (isOpen()) return;
    App.commitText();
    dialog.hidden = false;
    info.textContent = '';
    if (!engine) startEngine();
    else if (engine.ready && !engine.busy) info.textContent = I18n.t('stt.ready');
    else if (engine.busy) setStatus('stt.statusConverting');
    updateControls();
    (recordButton.disabled ? $('stt-close') : recordButton).focus();
  }

  function closeDialog() {
    stopRecording(false);
    // the model takes a few hundred MB: free it unless a recording is still being converted
    if (engine && !engine.busy) stopEngine();
    setStatus(null);
    dialog.hidden = true;
    button.focus();
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
    App.downloadBlob(blob, `${App.documentFileName() || 'zcreenshot'}-speech-${App.fileStamp()}.txt`);
  }

  function clearText() {
    textBox.value = '';
    info.textContent = '';
    updateControls();
    textBox.focus();
  }

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDialog();
  });
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeDialog(); });
  $('stt-close').addEventListener('click', closeDialog);
  button.addEventListener('click', openSpeechToText);
  recordButton.addEventListener('click', () => (session ? stopRecording() : startRecording()));
  $('stt-connect').addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', connectFolder);
  langSelect.addEventListener('change', () => { languagePicked = true; });
  textBox.addEventListener('input', updateControls);
  $('stt-copy').addEventListener('click', copyText);
  $('stt-save').addEventListener('click', saveText);
  $('stt-keep').addEventListener('click', () => App.keepSnippet(textBox.value));
  $('stt-clear').addEventListener('click', clearText);

  renderLanguages();
  I18n.subscribe(() => {
    renderLanguages();
    updateControls();
  });

  Object.assign(App, { openSpeechToText });
})();
