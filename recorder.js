'use strict';

// Screen recording: the record dialog (video size, frame rate, and on the desktop which screen or
// window), the recording bar, and the MediaRecorder itself. A finished recording opens in the video
// editor (video-editor.js).
//
// Desktop: the main process lists sources (capture-service.js); the chosen one is granted to the
// next getDisplayMedia() call. Browser: getDisplayMedia() shows the browser's own picker.
(() => {
  const { $, toast } = App;
  const capture = window.zcreenshot && window.zcreenshot.capture;
  const recordButton = $('btn-record');
  const scrollButton = $('btn-scroll');
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
  if (!canRecord) {
    recordButton.parentElement.hidden = true; // the whole capture group
    App.toggleRecording = () => {};
    App.toggleScrollCapture = () => {};
    return;
  }

  const TICK_MS = 100;

  const dialog = $('record-dialog');
  const sizeSelect = $('record-size');
  const fpsSelect = $('record-fps');
  const hideCheckbox = $('record-hide');
  const systemAudioCheckbox = $('record-system-audio');
  const micCheckbox = $('record-mic');
  const audioNote = $('record-audio-note');
  // the browser's picker offers "Share audio"; the desktop app can only add it on Windows
  const canSystemAudio = !capture || capture.systemAudio;
  const sourcesEl = $('record-sources');
  const permissionNote = $('record-permission');
  const startButton = $('record-start');
  const bar = $('rec-bar');
  const timeEl = $('rec-time');
  const stopButton = $('rec-stop');

  // what changes between the two modes: texts, the shortcut shown, and which fields are visible
  const MODES = Object.freeze({
    video: Object.freeze({
      title: 'record.title',
      start: 'record.start',
      label: 'rec.label',
      stopTitle: 'rec.stopTitle',
      shortcut: 'record',
      hint: Object.freeze({ web: 'record.stopHintWeb', desktop: 'record.stopHintDesktop', desktopNoKey: 'record.stopHintDesktopNoKey' }),
    }),
    scroll: Object.freeze({
      title: 'scroll.title',
      start: 'scroll.start',
      label: 'scroll.label',
      stopTitle: 'scroll.stopTitle',
      shortcut: 'scrollCapture',
      hint: Object.freeze({ web: 'scroll.stopHintWeb', desktop: 'scroll.stopHintDesktop', desktopNoKey: 'scroll.stopHintDesktopNoKey' }),
    }),
  });
  const LOST_HINT_MS = 1500; // how long "scroll slower" stays up after the page was lost

  let sources = [];
  let chosenId = null;
  let mode = 'video';
  // while capturing: video {kind, stream, recorder, chunks, startedAt, timer, release};
  // scroll {kind, stream, capture, lostAt, height, stopping}
  let session = null;

  /** Points an element at another message key (kept on locale changes by i18n-dom.js). */
  function setText(el, key) {
    el.dataset.i18n = key;
    el.textContent = I18n.t(key);
  }

  function setTitle(el, key, shortcut) {
    el.dataset.i18nTitle = key;
    el.dataset.shortcut = shortcut;
    const text = App.shortcutTitle(key, shortcut);
    el.title = text;
    el.setAttribute('aria-label', text);
  }

  function setMode(next) {
    mode = next;
    const m = MODES[mode];
    setText($('record-title'), m.title);
    setText(startButton, m.start);
    setText($('rec-label'), m.label);
    setTitle(stopButton, m.stopTitle, m.shortcut);
    $('record-size-row').hidden = mode === 'scroll';
    $('record-fps-row').hidden = mode === 'scroll';
    $('record-system-audio-row').hidden = mode === 'scroll' || !canSystemAudio;
    $('record-mic-row').hidden = mode === 'scroll';
    audioNote.hidden = mode === 'scroll' || !!(capture && canSystemAudio);
    $('record-scroll-note').hidden = mode !== 'scroll';
    fillOptions();
  }

  // ---------- dialog ----------
  const sizeLabel = (size) => (size === 0 ? I18n.t('size.original') : `${size}p`);

  function fillSelect(select, values, label) {
    const keep = select.value;
    select.replaceChildren(...values.map((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = label(value);
      return option;
    }));
    if (keep !== '') select.value = keep;
  }

  function fillOptions() {
    fillSelect(sizeSelect, VideoOptions.SIZES, sizeLabel);
    fillSelect(fpsSelect, VideoOptions.RECORD_FPS, (fps) => I18n.t('unit.fps', { fps }));
    const { hint } = MODES[mode];
    const shortcut = App.shortcutHint(MODES[mode].shortcut);
    let stopHint = I18n.t(hint.web);
    if (capture) stopHint = shortcut ? I18n.t(hint.desktop, { shortcut }) : I18n.t(hint.desktopNoKey);
    $('record-stop-note').textContent = stopHint;
    renderSources();
  }

  function sourceCard(source) {
    const card = document.createElement('button');
    card.className = 'source-card';
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', String(source.id === chosenId));
    card.title = source.name;
    const thumb = document.createElement('div');
    thumb.className = 'source-thumb';
    if (source.thumb) {
      const img = document.createElement('img');
      img.src = source.thumb;
      img.alt = '';
      img.draggable = false;
      thumb.append(img);
    }
    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = source.name;
    card.append(thumb, name);
    card.addEventListener('click', () => {
      chosenId = source.id;
      renderSources();
    });
    card.addEventListener('dblclick', () => {
      chosenId = source.id;
      startRecording();
    });
    return card;
  }

  function renderSources() {
    if (!capture) return;
    if (sources.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = I18n.t('record.noSources');
      sourcesEl.replaceChildren(empty);
      return;
    }
    const group = (kind, titleKey) => {
      const list = sources.filter((s) => s.kind === kind);
      if (list.length === 0) return [];
      const title = document.createElement('h4');
      title.className = 'source-group';
      title.textContent = I18n.t(titleKey);
      return [title, ...list.map(sourceCard)];
    };
    sourcesEl.replaceChildren(...group('screen', 'record.screens'), ...group('window', 'record.windows'));
  }

  async function loadSources() {
    const loading = document.createElement('p');
    loading.className = 'note';
    loading.textContent = I18n.t('record.loading');
    sourcesEl.replaceChildren(loading);
    try {
      const result = await capture.getSources();
      sources = (result && result.sources) || [];
      permissionNote.hidden = !result || !['denied', 'restricted'].includes(result.permission);
    } catch (err) {
      console.error('could not list screens / windows', err);
      sources = [];
    }
    if (!sources.some((s) => s.id === chosenId)) {
      const firstScreen = sources.find((s) => s.kind === 'screen') || sources[0];
      chosenId = firstScreen ? firstScreen.id : null;
    }
    renderSources();
  }

  const isRecordDialogOpen = () => !dialog.hidden;

  /** @param {'video'|'scroll'} [nextMode] an open dialog just switches mode */
  function openRecordDialog(nextMode = 'video') {
    if (session || App.isVideoEditorOpen()) return;
    setMode(nextMode);
    if (!dialog.hidden) return;
    dialog.hidden = false;
    startButton.focus();
    if (capture) loadSources();
  }

  function closeRecordDialog() {
    dialog.hidden = true;
    (mode === 'scroll' ? scrollButton : recordButton).focus();
  }

  /**
   * The chosen source as a stream (null when cancelled or failed; a failure shows `failKey`).
   * @param {boolean} [audio] also ask for the system sound
   */
  async function openStream(video, failKey, audio = false) {
    if (capture) {
      const source = sources.find((s) => s.id === chosenId);
      if (!source) {
        toast('toast.pickSource');
        return null;
      }
      await capture.select({ id: source.id, name: source.name, audio });
    }
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video, audio });
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') { // not just "cancelled in the picker"
        console.error('getDisplayMedia failed', err);
        toast(failKey);
      }
      return null;
    }
  }

  function showBar() {
    closeRecordDialog();
    bar.hidden = false;
    recordButton.disabled = true;
    scrollButton.disabled = true;
    if (capture) capture.setRecording(true, { hideWindow: hideCheckbox.checked });
  }

  function hideBar() {
    bar.hidden = true;
    recordButton.disabled = false;
    scrollButton.disabled = false;
    timeEl.classList.remove('warn');
    if (capture) capture.setRecording(false);
  }

  // ---------- scrolling screenshot ----------
  function showScrollProgress(current) {
    const lost = performance.now() - current.lostAt < LOST_HINT_MS;
    timeEl.textContent = lost ? I18n.t('scroll.slower') : I18n.t('scroll.height', { px: current.height });
    timeEl.classList.toggle('warn', lost);
  }

  async function startScrollCapture() {
    const stream = await openStream({ frameRate: { ideal: 30 }, cursor: 'never' }, 'toast.scrollFailed');
    if (!stream) return;
    const current = {
      kind: 'scroll', stream, capture: null, lostAt: -Infinity, height: 0, stopping: false, timer: null,
    };
    session = current;
    current.capture = App.startScrollCapture(stream, {
      onProgress: ({ status, height }) => {
        current.height = height;
        if (status === 'lost') current.lostAt = performance.now();
        if (status === 'full') {
          toast('toast.scrollFull');
          stopRecording();
        }
      },
    });
    stream.getVideoTracks()[0].addEventListener('ended', stopRecording); // "Stop sharing" / window closed
    showScrollProgress(current);
    current.timer = setInterval(() => showScrollProgress(current), 200);
    showBar();
  }

  async function finishScrollCapture(current) {
    current.stopping = true;
    clearInterval(current.timer);
    let blob = null;
    try {
      blob = await current.capture.stop();
    } catch (err) {
      console.error('scroll capture failed', err);
    }
    session = null;
    hideBar();
    if (blob) await App.addBlobs([blob]);
    else toast('toast.scrollFailed');
  }

  // ---------- recording ----------
  /** The microphone as a stream, or null (a refusal or failure shows a toast; recording goes on). */
  async function openMicrophone() {
    try {
      if (capture && !(await capture.askMicrophone())) throw new Error('microphone access denied');
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('could not open the microphone', err);
      toast('toast.micFailed');
      return null;
    }
  }

  /**
   * One audio track for the recorder: MediaRecorder only records the first audio track of a
   * stream, so system sound and microphone are mixed together when both are there.
   * @returns {{track: MediaStreamTrack|null, context: AudioContext|null}}
   */
  function mixAudio(tracks) {
    if (tracks.length <= 1) return { track: tracks[0] || null, context: null };
    const context = new AudioContext();
    const out = context.createMediaStreamDestination();
    tracks.forEach((t) => context.createMediaStreamSource(new MediaStream([t])).connect(out));
    return { track: out.stream.getAudioTracks()[0], context };
  }

  async function startRecording() {
    if (session) return;
    if (mode === 'scroll') {
      await startScrollCapture();
      return;
    }
    const maxShort = Number(sizeSelect.value);
    const fps = Number(fpsSelect.value);
    const wantSystemAudio = canSystemAudio && systemAudioCheckbox.checked;
    const display = await openStream({ frameRate: { ideal: fps, max: fps } }, 'toast.recordFailed', wantSystemAudio);
    if (!display) return;
    const mic = micCheckbox.checked ? await openMicrophone() : null;
    const inputs = [display, ...(mic ? [mic] : [])];
    const stopInputs = () => inputs.forEach((s) => s.getTracks().forEach((t) => t.stop()));

    // Scale the capture itself (rather than re-drawing frames), so recording keeps working while
    // the window is hidden and costs no extra CPU.
    const track = display.getVideoTracks()[0];
    const native = track.getSettings();
    if (maxShort > 0 && native.width && native.height) {
      const target = VideoOptions.fitSize(native.width, native.height, maxShort);
      if (target.width < native.width) {
        try {
          await track.applyConstraints({ width: target.width, height: target.height, frameRate: fps });
        } catch (err) {
          console.warn('could not scale the capture; recording at full size', err);
        }
      }
    }
    const settings = track.getSettings();
    const audio = mixAudio(inputs.flatMap((s) => s.getAudioTracks()));
    const stream = new MediaStream([track, ...(audio.track ? [audio.track] : [])]);
    const mimeType = VideoOptions.recordingMimeType((m) => MediaRecorder.isTypeSupported(m), !!audio.track);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: VideoOptions.recordBitrate(settings.width || 1920, settings.height || 1080, fps),
      });
    } catch (err) {
      console.error('MediaRecorder failed', err);
      stopInputs();
      if (audio.context) audio.context.close();
      toast('toast.recordFailed');
      return;
    }

    const current = {
      kind: 'video', stream, recorder, chunks: [], startedAt: 0, timer: null,
      release: () => {
        stopInputs();
        stream.getTracks().forEach((t) => t.stop());
        if (audio.context) audio.context.close();
      },
    };
    session = current;
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) current.chunks.push(e.data); });
    recorder.addEventListener('stop', () => finishRecording(current));
    track.addEventListener('ended', stopRecording); // browser "Stop sharing", or the window was closed

    recorder.start(1000);
    current.startedAt = performance.now();
    timeEl.textContent = VideoOptions.formatTime(0);
    current.timer = setInterval(() => {
      timeEl.textContent = VideoOptions.formatTime((performance.now() - current.startedAt) / 1000);
    }, TICK_MS);
    showBar();
  }

  /** Stops whichever capture is running (video or scrolling screenshot). */
  function stopRecording() {
    if (!session) return;
    if (session.kind === 'scroll') {
      if (!session.stopping) finishScrollCapture(session);
      return;
    }
    if (session.recorder.state === 'inactive') return;
    session.recorder.stop();
    session.release();
  }

  async function finishRecording(current) {
    const durationMs = performance.now() - current.startedAt;
    clearInterval(current.timer);
    session = null;
    hideBar();

    const type = current.recorder.mimeType || (current.chunks[0] && current.chunks[0].type) || 'video/webm';
    let blob = new Blob(current.chunks, { type });
    if (blob.size === 0) {
      toast('toast.recordEmpty');
      return;
    }
    if (VideoOptions.extensionFor(type) === 'webm') {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      blob = new Blob([WebmDuration.withDuration(bytes, durationMs)], { type });
    }
    App.openVideoEditor(blob, { durationMs });
  }

  /** The record shortcut: open the dialog, start when it is open, stop while recording. */
  function toggleRecording() {
    toggle('video');
  }

  /** The scrolling-screenshot shortcut: the same open -> start -> stop, in scroll mode. */
  function toggleScrollCapture() {
    toggle('scroll');
  }

  function toggle(wanted) {
    if (session) stopRecording();
    else if (isRecordDialogOpen() && mode === wanted) startRecording();
    else openRecordDialog(wanted);
  }

  // ---------- wiring ----------
  recordButton.addEventListener('click', () => openRecordDialog('video'));
  scrollButton.addEventListener('click', () => openRecordDialog('scroll'));
  $('record-close').addEventListener('click', closeRecordDialog);
  $('record-refresh').addEventListener('click', loadSources);
  startButton.addEventListener('click', startRecording);
  $('rec-stop').addEventListener('click', stopRecording);
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeRecordDialog(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRecordDialog(); });

  fillOptions();
  sizeSelect.value = String(VideoOptions.DEFAULTS.recordSize);
  fpsSelect.value = String(VideoOptions.DEFAULTS.recordFps);
  I18n.subscribe(fillOptions);
  App.onShortcutsChange(fillOptions);

  $('record-sources-wrap').hidden = !capture;
  $('record-hide-row').hidden = !capture;
  $('record-web-note').hidden = !!capture;
  setText(audioNote, capture ? 'record.audioNoteMac' : 'record.audioNoteWeb');
  if (capture) {
    capture.onStop(stopRecording);
    capture.onOpen((which) => openRecordDialog(which === 'scroll' ? 'scroll' : 'video'));
    capture.onToggle(toggleRecording);
    capture.onToggleScroll(toggleScrollCapture);
  }

  Object.assign(App, {
    openRecordDialog, isRecordDialogOpen, stopRecording, toggleRecording, toggleScrollCapture,
  });
})();
