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
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
  if (!canRecord) {
    recordButton.hidden = true;
    App.toggleRecording = () => {};
    return;
  }

  const TICK_MS = 100;

  const dialog = $('record-dialog');
  const sizeSelect = $('record-size');
  const fpsSelect = $('record-fps');
  const hideCheckbox = $('record-hide');
  const sourcesEl = $('record-sources');
  const permissionNote = $('record-permission');
  const startButton = $('record-start');
  const bar = $('rec-bar');
  const timeEl = $('rec-time');

  let sources = [];
  let chosenId = null;
  let session = null; // {stream, recorder, chunks, startedAt, timer} while recording

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
    const shortcut = App.shortcutHint('record');
    let stopHint = I18n.t('record.stopHintWeb');
    if (capture) stopHint = shortcut ? I18n.t('record.stopHintDesktop', { shortcut }) : I18n.t('record.stopHintDesktopNoKey');
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

  function openRecordDialog() {
    if (session || App.isVideoEditorOpen()) return;
    dialog.hidden = false;
    startButton.focus();
    if (capture) loadSources();
  }

  function closeRecordDialog() {
    dialog.hidden = true;
    recordButton.focus();
  }

  // ---------- recording ----------
  async function startRecording() {
    if (session) return;
    const maxShort = Number(sizeSelect.value);
    const fps = Number(fpsSelect.value);
    if (capture) {
      const source = sources.find((s) => s.id === chosenId);
      if (!source) {
        toast('toast.pickSource');
        return;
      }
      await capture.select({ id: source.id, name: source.name });
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps, max: fps } },
        audio: false,
      });
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') { // not just "cancelled in the picker"
        console.error('getDisplayMedia failed', err);
        toast('toast.recordFailed');
      }
      return;
    }

    // Scale the capture itself (rather than re-drawing frames), so recording keeps working while
    // the window is hidden and costs no extra CPU.
    const track = stream.getVideoTracks()[0];
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
    const mimeType = VideoOptions.recordingMimeType((m) => MediaRecorder.isTypeSupported(m));
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: VideoOptions.recordBitrate(settings.width || 1920, settings.height || 1080, fps),
      });
    } catch (err) {
      console.error('MediaRecorder failed', err);
      stream.getTracks().forEach((t) => t.stop());
      toast('toast.recordFailed');
      return;
    }

    const current = {
      stream, recorder, chunks: [], startedAt: 0, timer: null,
    };
    session = current;
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) current.chunks.push(e.data); });
    recorder.addEventListener('stop', () => finishRecording(current));
    track.addEventListener('ended', stopRecording); // browser "Stop sharing", or the window was closed

    closeRecordDialog();
    recorder.start(1000);
    current.startedAt = performance.now();
    timeEl.textContent = VideoOptions.formatTime(0);
    current.timer = setInterval(() => {
      timeEl.textContent = VideoOptions.formatTime((performance.now() - current.startedAt) / 1000);
    }, TICK_MS);
    bar.hidden = false;
    recordButton.disabled = true;
    if (capture) capture.setRecording(true, { hideWindow: hideCheckbox.checked });
  }

  function stopRecording() {
    if (!session || session.recorder.state === 'inactive') return;
    session.recorder.stop();
    session.stream.getTracks().forEach((t) => t.stop());
  }

  async function finishRecording(current) {
    const durationMs = performance.now() - current.startedAt;
    clearInterval(current.timer);
    session = null;
    bar.hidden = true;
    recordButton.disabled = false;
    if (capture) capture.setRecording(false);

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
    if (session) stopRecording();
    else if (isRecordDialogOpen()) startRecording();
    else openRecordDialog();
  }

  // ---------- wiring ----------
  recordButton.addEventListener('click', openRecordDialog);
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
  if (capture) {
    capture.onStop(stopRecording);
    capture.onOpen(openRecordDialog);
    capture.onToggle(toggleRecording);
  }

  Object.assign(App, {
    openRecordDialog, isRecordDialogOpen, stopRecording, toggleRecording,
  });
})();
