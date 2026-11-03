'use strict';

// Video editor: preview a recording (or a dropped video file), trim it, and save it as
//   - GIF (frames sampled by seeking, encoded by gif-encoder.js),
//   - a smaller / lower-bitrate MP4 or WebM: converted with Mediabunny + WebCodecs (much faster than
//     real time); where that is not available it falls back to playing the clip through a canvas
//     into a MediaRecorder, which takes as long as the clip,
//   - the sound only (MP3 via the LAME encoder in mediabunny-mp3-encoder.min.js, M4A / AAC where
//     the system can encode it; WAV as the last resort), or
//   - the original recording as is.
// "Add this frame to the canvas" puts the current frame into the screenshot editor as an image.
(() => {
  const { $, toast } = App;
  const V = VideoOptions;

  const dialog = $('video-editor');
  const video = $('video-preview');
  const controls = $('video-controls');
  const info = $('video-info');
  const trimStart = $('trim-start');
  const trimEnd = $('trim-end');
  const formatSelect = $('video-format');
  const sizeSelect = $('video-size');
  const fpsSelect = $('video-fps');
  const qualitySelect = $('video-quality');
  const audioCheckbox = $('video-audio');
  const audioRow = $('video-audio-row');
  const audioBitrateSelect = $('audio-bitrate');
  const estimate = $('video-estimate');
  const progressRow = $('video-progress-row');
  const progress = $('video-progress');
  const progressLabel = $('video-progress-label');
  const saveButton = $('video-save');
  const cancelButton = $('video-cancel');
  const frameButton = $('video-frame');

  const CANCELLED = new Error('export cancelled');
  const FORMAT_LABELS = Object.freeze({
    gif: 'format.gif',
    mp4: 'format.mp4',
    webm: 'format.webm',
    mp3: 'format.mp3',
    m4a: 'format.m4a',
    wav: 'format.wav',
    original: 'format.original',
  });
  const QUALITY_LABELS = Object.freeze({ low: 'quality.low', medium: 'quality.medium', high: 'quality.high' });
  const PROGRESS_LABELS = Object.freeze({
    gif: 'video.progressGif', fast: 'video.progressConvert', realtime: 'video.progressVideo', audio: 'video.progressAudio',
  });
  /** Video codecs to try per container for the fast path, best first. */
  const FAST_CODECS = Object.freeze({ mp4: Object.freeze(['avc']), webm: Object.freeze(['vp9', 'vp8']) });
  /** Audio codecs to prefer per container (AAC plays everywhere MP4 does, Opus in MP4 does not). */
  const FAST_AUDIO_CODECS = Object.freeze({ mp4: Object.freeze(['aac']), webm: Object.freeze(['opus']) });
  const MB = window.Mediabunny;
  const canConvertFast = !!(MB && window.VideoEncoder && window.VideoDecoder);
  const isTypeSupported = (m) => !!window.MediaRecorder && MediaRecorder.isTypeSupported(m);

  /**
   * "Audio only" formats. Browsers have no MP3 encoder of their own, so MP3 comes from the bundled
   * LAME build; WAV (uncompressed, so large) only where neither compressed format can be made.
   */
  const AUDIO_FORMATS = Object.freeze({
    mp3: Object.freeze({
      codec: 'mp3', mime: 'audio/mpeg', output: () => new MB.Mp3OutputFormat(),
    }),
    m4a: Object.freeze({
      codec: 'aac', mime: 'audio/mp4', output: () => new MB.Mp4OutputFormat(),
    }),
    wav: Object.freeze({
      // uncompressed: the bitrate is fixed (48 kHz stereo 16-bit), so no bitrate choice
      codec: 'pcm-s16', mime: 'audio/wav', fixedBitrate: 48000 * 2 * 16, output: () => new MB.WavOutputFormat(),
    }),
  });
  const isAudioFormat = (format) => Object.hasOwn(AUDIO_FORMATS, format);
  /** Bits per second an audio-only format will be written at. */
  const audioBitrate = (format) => AUDIO_FORMATS[format].fixedBitrate || Number(audioBitrateSelect.value);

  /** Which formats each `data-for-format` field applies to. */
  const FIELD_FORMATS = Object.freeze({
    encode: (f) => f === 'gif' || f === 'mp4' || f === 'webm', // size, frame rate
    video: (f) => f === 'mp4' || f === 'webm', // quality, include audio
    audio: (f) => isAudioFormat(f) && !AUDIO_FORMATS[f].fixedBitrate, // audio bitrate
  });

  /** @type {Promise<string[]>} audio-only formats this browser can write */
  const audioFormatsReady = (async () => {
    if (!MB || !window.AudioDecoder) return [];
    if (window.MediabunnyMp3Encoder) MediabunnyMp3Encoder.registerMp3Encoder(); // LAME (WASM) in a worker
    const can = async (format) => {
      try {
        return await MB.canEncodeAudio(AUDIO_FORMATS[format].codec);
      } catch (err) {
        return false;
      }
    };
    const compressed = [];
    for (const format of ['mp3', 'm4a']) if (await can(format)) compressed.push(format);
    if (compressed.length > 0) return compressed;
    return (await can('wav')) ? ['wav'] : [];
  })();
  let audioFormats = [];

  /**
   * @type {{blob:Blob, url:string, duration:number, width:number, height:number, hasAudio:boolean,
   *   saved:boolean} | null}
   */
  let current = null;
  /**
   * Export in progress. `cancel` is set by the fast path, which can abort its conversion right away.
   * @type {{cancelled:boolean, kind:'gif'|'fast'|'realtime', cancel:(() => void)|null} | null}
   */
  let job = null;

  function cancelJob() {
    if (!job) return;
    job.cancelled = true;
    if (job.cancel) job.cancel();
  }

  // ---------- helpers ----------
  /** Resolves on `okEvent`, rejects on `error`. */
  const once = (target, okEvent) => new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(target.error || new Error(`${okEvent} failed`)); };
    const cleanup = () => {
      target.removeEventListener(okEvent, ok);
      target.removeEventListener('error', fail);
    };
    target.addEventListener(okEvent, ok);
    target.addEventListener('error', fail);
  });

  // Chrome can leave a seek on a paused, freshly loaded recording pending until something else
  // touches the element, so a seek that has not finished in a while is issued again (waiting twice
  // as long each time, so a seek that is merely slow on a big file still gets to finish).
  const SEEK_RETRY_MS = 400;

  function seek(time) {
    const done = once(video, 'seeked');
    video.currentTime = time;
    let timer = null;
    const retry = (delay) => {
      timer = setTimeout(() => {
        video.currentTime = time;
        retry(delay * 2);
      }, delay);
    };
    retry(SEEK_RETRY_MS);
    return done.finally(() => clearTimeout(timer));
  }

  /** Files without a duration in their header report Infinity until the browser has scanned them. */
  async function resolveDuration(fallbackS) {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    if (fallbackS > 0) return fallbackS;
    const changed = once(video, 'durationchange');
    video.currentTime = Number.MAX_SAFE_INTEGER;
    await changed;
    await seek(0);
    return Number.isFinite(video.duration) ? video.duration : 0;
  }

  const trim = () => V.clampTrim(Number(trimStart.value), Number(trimEnd.value), current.duration);
  const outputSize = () => V.fitSize(current.width, current.height, Number(sizeSelect.value));
  const sizeLabel = (size) => (size === 0 ? I18n.t('size.original') : `${size}p`);
  const fpsLabel = (fps) => I18n.t('unit.fps', { fps });
  const qualityLabel = (q) => I18n.t(QUALITY_LABELS[q]);
  const kbpsLabel = (bitsPerSecond) => I18n.t('unit.kbps', { kbps: bitsPerSecond / 1000 });

  function fillSelect(select, values, label, preferred) {
    select.replaceChildren(...values.map((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = label(value);
      return option;
    }));
    select.value = String(values.includes(preferred) ? preferred : values[0]);
  }

  // ---------- form ----------
  function fillFormats(preferred) {
    const formats = [
      'gif', ...V.supportedContainers(isTypeSupported), ...(current.hasAudio ? audioFormats : []), 'original',
    ];
    fillSelect(formatSelect, formats, (f) => I18n.t(FORMAT_LABELS[f]), preferred);
  }

  /** New format: its own default size / frame rate, and only the fields that apply to it. */
  function applyFormatDefaults() {
    const format = formatSelect.value;
    const defaults = format === 'gif' ? V.DEFAULTS.gif : V.DEFAULTS.video;
    // the default preset when the source is bigger than it, the original size otherwise
    fillSelect(sizeSelect, V.sizesFor(current.width, current.height), sizeLabel, defaults.size);
    fillSelect(fpsSelect, V.EXPORT_FPS, fpsLabel, defaults.fps);
    fillSelect(qualitySelect, V.QUALITIES, qualityLabel, qualitySelect.value || V.DEFAULTS.video.quality);
    fillSelect(audioBitrateSelect, V.AUDIO_BITRATES, kbpsLabel, Number(audioBitrateSelect.value) || V.DEFAULTS.audioBitrate);
    dialog.querySelectorAll('[data-for-format]').forEach((el) => {
      el.hidden = !FIELD_FORMATS[el.dataset.forFormat](format);
    });
    if (!current.hasAudio) audioRow.hidden = true;
    updateSummary();
  }

  function relabel() { // language changed: rebuild the option labels, keep the values
    if (!current) return;
    const [format, size, fps, quality, kbps] = [formatSelect, sizeSelect, fpsSelect, qualitySelect, audioBitrateSelect]
      .map((s) => s.value);
    fillFormats(format);
    fillSelect(sizeSelect, V.sizesFor(current.width, current.height), sizeLabel, Number(size));
    fillSelect(fpsSelect, V.EXPORT_FPS, fpsLabel, Number(fps));
    fillSelect(qualitySelect, V.QUALITIES, qualityLabel, quality);
    fillSelect(audioBitrateSelect, V.AUDIO_BITRATES, kbpsLabel, Number(kbps));
    updateSummary();
  }

  function updateSummary() {
    if (!current) return;
    const { start, end } = trim();
    $('trim-start-label').textContent = V.formatTime(start);
    $('trim-end-label').textContent = V.formatTime(end);
    info.textContent = `${current.width} × ${current.height} · ${V.formatTime(current.duration)}`;
    const format = formatSelect.value;
    const { width, height } = outputSize();
    const length = V.formatTime(end - start);
    if (format === 'original') {
      estimate.textContent = I18n.t('video.summaryOriginal', { size: V.formatBytes(current.blob.size) });
    } else if (format === 'gif') {
      estimate.textContent = I18n.t('video.summaryGif', { width, height, length });
    } else if (isAudioFormat(format)) {
      const size = V.formatBytes(V.estimateBytes(audioBitrate(format), end - start));
      estimate.textContent = I18n.t('video.summaryAudio', { length, size });
    } else {
      const bitrate = V.bitrateFor(width, height, Number(fpsSelect.value), qualitySelect.value);
      estimate.textContent = I18n.t('video.summaryVideo', {
        width, height, length, size: V.formatBytes(V.estimateBytes(bitrate, end - start)),
      });
    }
  }

  function onTrimInput(e) {
    const { start, end } = trim();
    trimStart.value = String(start);
    trimEnd.value = String(end);
    video.currentTime = e.target === trimEnd ? end : start; // show the frame being picked
    updateSummary();
  }

  /** Whether the file has a sound track (assumed yes when it cannot be checked). */
  async function hasAudioTrack(blob) {
    if (!MB) return true;
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      return !!(await input.getPrimaryAudioTrack());
    } catch (err) {
      return true;
    } finally {
      input.dispose();
    }
  }

  // ---------- open / close ----------
  const isVideoEditorOpen = () => !dialog.hidden;

  /**
   * @param {Blob} blob a recording or a video file
   * @param {{durationMs?: number}} [meta] durationMs: known length (recordings), used when the file has none
   */
  async function openVideoEditor(blob, { durationMs = 0 } = {}) {
    if (current && !closeVideoEditor()) return;
    const url = URL.createObjectURL(blob);
    const loaded = once(video, 'loadedmetadata');
    video.src = url;
    try {
      await loaded;
      const duration = await resolveDuration(durationMs / 1000);
      if (!(duration > 0) || !video.videoWidth) throw new Error('no video track, or zero length');
      current = {
        blob,
        url,
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        hasAudio: await hasAudioTrack(blob),
        saved: false,
      };
    } catch (err) {
      console.error('could not open the video', err);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      toast('toast.videoLoadFailed');
      return;
    }
    [trimStart, trimEnd].forEach((input) => { input.max = String(current.duration); });
    trimStart.value = '0';
    trimEnd.value = String(current.duration);
    audioCheckbox.checked = true; // keep the sound unless the user turns it off for this video
    audioFormats = await audioFormatsReady;
    fillFormats(formatSelect.value || 'gif');
    applyFormatDefaults();
    if (video.currentTime !== 0) await seek(0).catch(() => {});
    dialog.hidden = false;
    $('video-card').focus(); // not a button, so Space plays the video instead of pressing it
  }

  /** @returns {boolean} false when the editor stays open (an export is running, or the user kept it) */
  function closeVideoEditor() {
    if (job) { // stop the export first; closing mid-seek would leave it waiting forever
      cancelJob();
      return false;
    }
    if (!current) {
      dialog.hidden = true;
      return true;
    }
    if (!current.saved && !window.confirm(I18n.t('video.discardConfirm'))) return false;
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(current.url);
    current = null;
    dialog.hidden = true;
    return true;
  }

  // ---------- export ----------
  function setBusy(busy) {
    controls.disabled = busy;
    video.controls = !busy;
    saveButton.disabled = busy;
    frameButton.disabled = busy;
    cancelButton.hidden = !busy;
    progressRow.hidden = !busy;
    if (busy) setProgress(0);
  }

  function setProgress(fraction) {
    const value = Math.min(1, Math.max(0, fraction));
    progress.value = value;
    progressLabel.textContent = I18n.t(PROGRESS_LABELS[job.kind], { percent: Math.round(value * 100) });
  }

  function frameCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    return { canvas, ctx };
  }

  async function exportGif({
    start, end, width, height, fps,
  }) {
    const { ctx } = frameCanvas(width, height);
    const gif = GifEncoder.create(width, height);
    const times = V.frameTimes(start, end, fps);
    for (let i = 0; i < times.length; i++) {
      if (job.cancelled) throw CANCELLED;
      await seek(times[i]);
      ctx.drawImage(video, 0, 0, width, height);
      gif.addFrame(ctx.getImageData(0, 0, width, height).data, 1000 / fps);
      setProgress((i + 1) / times.length);
    }
    return new Blob([gif.finish()], { type: 'image/gif' });
  }

  /**
   * Audio only: Mediabunny reads the file, drops the picture and re-encodes the trimmed sound.
   * @param {{start:number, end:number, format:string}} options format: a key of AUDIO_FORMATS
   */
  async function exportAudio({ start, end, format }) {
    const spec = AUDIO_FORMATS[format];
    const input = new MB.Input({ source: new MB.BlobSource(current.blob), formats: MB.ALL_FORMATS });
    try {
      const output = new MB.Output({ format: spec.output(), target: new MB.BufferTarget() });
      const conversion = await MB.Conversion.init({
        input,
        output,
        trim: { start, end },
        video: { discard: true },
        audio: { codec: spec.codec, forceTranscode: true, ...(spec.fixedBitrate ? {} : { bitrate: audioBitrate(format) }) },
        showWarnings: false,
      });
      if (!conversion.isValid) throw new Error(`cannot write ${format} audio`);
      conversion.onProgress = setProgress;
      job.cancel = () => { conversion.cancel(); };
      if (job.cancelled) throw CANCELLED;
      try {
        await conversion.execute();
      } catch (err) {
        if (err instanceof MB.ConversionCanceledError) throw CANCELLED;
        throw err;
      }
      return new Blob([output.target.buffer], { type: spec.mime });
    } finally {
      job.cancel = null;
      input.dispose();
    }
  }

  /**
   * Fast path: Mediabunny reads the file, WebCodecs decodes / scales / re-encodes it as fast as the
   * machine allows, and the result is written as a proper MP4 / WebM (with duration and seek index).
   * @returns {Promise<Blob|null>} null when this browser cannot encode the format (or its sound) this way
   */
  async function convertFast({
    start, end, width, height, fps, format, bitrate, withAudio,
  }) {
    const quality = new MB.Quality({ bitrate });
    const codec = await MB.getFirstEncodableVideoCodec(FAST_CODECS[format], { width, height, quality });
    if (!codec) return null;
    const audioCodec = withAudio ? await MB.getFirstEncodableAudioCodec(FAST_AUDIO_CODECS[format]) : null;
    const input = new MB.Input({ source: new MB.BlobSource(current.blob), formats: MB.ALL_FORMATS });
    try {
      const output = new MB.Output({
        format: format === 'mp4' ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat(),
        target: new MB.BufferTarget(),
      });
      const conversion = await MB.Conversion.init({
        input,
        output,
        trim: { start, end },
        video: {
          width, height, fit: 'fill', frameRate: fps, codec, quality, forceTranscode: true,
        },
        // kept sound goes into the container's preferred codec when this machine can encode it,
        // otherwise it is copied / re-encoded into whatever the container accepts
        audio: { discard: !withAudio, ...(audioCodec ? { codec: audioCodec } : {}) },
        showWarnings: false,
      });
      if (!conversion.isValid) return null;
      // sound that cannot be encoded here would be dropped silently; the real-time path keeps it
      if (withAudio && conversion.discardedTracks.some((d) => d.track.type === 'audio' && d.reason !== 'discarded_by_user')) {
        return null;
      }
      conversion.onProgress = setProgress;
      job.cancel = () => { conversion.cancel(); };
      if (job.cancelled) throw CANCELLED;
      try {
        await conversion.execute();
      } catch (err) {
        if (err instanceof MB.ConversionCanceledError) throw CANCELLED;
        throw err;
      }
      return new Blob([output.target.buffer], { type: output.format.mimeType });
    } finally {
      job.cancel = null;
      input.dispose();
    }
  }

  /**
   * Plays the trimmed range once, drawing each frame into a canvas that a MediaRecorder encodes;
   * with `withAudio` the sound playing from the video element is recorded along with it.
   */
  async function exportVideo({
    start, end, width, height, fps, format, bitrate, withAudio,
  }) {
    const { canvas, ctx } = frameCanvas(width, height);
    const stream = canvas.captureStream(fps);
    if (withAudio && video.captureStream) video.captureStream().getAudioTracks().forEach((t) => stream.addTrack(t));
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeType = V.pickMimeType(isTypeSupported, format, hasAudio) || V.pickMimeType(isTypeSupported, format);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks = [];
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) chunks.push(e.data); });
    const stopped = once(recorder, 'stop');

    await seek(start);
    ctx.drawImage(video, 0, 0, width, height);
    recorder.start(1000);
    const startedAt = performance.now();
    await new Promise((resolve, reject) => {
      let done = false; // a frame callback already queued may still fire after the end
      const finish = () => {
        done = true;
        video.removeEventListener('ended', finish);
        video.removeEventListener('pause', finish);
        resolve();
      };
      let schedule;
      const step = () => {
        if (done) return;
        ctx.drawImage(video, 0, 0, width, height);
        setProgress((video.currentTime - start) / (end - start));
        if (job.cancelled || video.currentTime >= end || video.ended) finish();
        else schedule();
      };
      schedule = video.requestVideoFrameCallback
        ? () => video.requestVideoFrameCallback(step)
        : () => setTimeout(step, 1000 / fps);
      video.addEventListener('ended', finish);
      video.addEventListener('pause', finish);
      video.play().then(schedule, reject);
    });
    video.pause();
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    await stopped;
    if (job.cancelled) throw CANCELLED;

    const blob = new Blob(chunks, { type: mimeType });
    if (V.extensionFor(mimeType) !== 'webm') return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new Blob([WebmDuration.withDuration(bytes, performance.now() - startedAt)], { type: mimeType });
  }

  async function save() {
    if (!current || job) return;
    const format = formatSelect.value;
    const name = `zcreenshot-${App.fileStamp()}`;
    if (format === 'original') {
      App.downloadBlob(current.blob, `${name}.${V.extensionFor(current.blob.type)}`);
      current.saved = true;
      return;
    }

    const { start, end } = trim();
    const { width, height } = outputSize();
    const fps = Number(fpsSelect.value);
    let kind = 'realtime';
    if (format === 'gif') kind = 'gif';
    else if (isAudioFormat(format)) kind = 'audio';
    else if (canConvertFast) kind = 'fast';
    job = { cancelled: false, kind, cancel: null };
    video.pause();
    setBusy(true);
    try {
      let blob = null;
      if (format === 'gif') {
        blob = await exportGif({
          start, end, width, height, fps,
        });
      } else if (kind === 'audio') {
        blob = await exportAudio({ start, end, format });
      } else {
        const bitrate = V.bitrateFor(width, height, fps, qualitySelect.value);
        const withAudio = current.hasAudio && audioCheckbox.checked;
        if (job.kind === 'fast') {
          try {
            blob = await convertFast({
              start, end, width, height, fps, format, bitrate, withAudio,
            });
          } catch (err) {
            if (err === CANCELLED) throw err;
            console.warn('fast conversion failed; converting in real time instead', err);
          }
        }
        if (!blob) {
          job.kind = 'realtime';
          setProgress(0);
          blob = await exportVideo({
            start, end, width, height, fps, format, bitrate, withAudio,
          });
        }
      }
      App.downloadBlob(blob, `${name}.${format}`);
      current.saved = true;
      toast('toast.videoSaved', { size: V.formatBytes(blob.size) });
    } catch (err) {
      if (err !== CANCELLED) {
        console.error('video export failed', err);
        toast('toast.exportFailed');
      }
    } finally {
      job = null;
      setBusy(false);
      video.currentTime = start;
    }
  }

  async function addFrameToCanvas() {
    if (!current || job) return;
    video.pause();
    const { canvas, ctx } = frameCanvas(current.width, current.height);
    ctx.drawImage(video, 0, 0, current.width, current.height);
    try {
      await App.addBlobs([await App.toPngBlob(canvas)], { record: false });
      toast('toast.frameAdded');
    } catch (err) {
      console.error(err);
      toast('toast.exportFailed');
    }
  }

  // ---------- wiring ----------
  // The preview plays only the trimmed range.
  video.addEventListener('play', () => {
    if (!current || job) return;
    const { start, end } = trim();
    if (video.currentTime < start || video.currentTime >= end - 0.05) video.currentTime = start;
  });
  video.addEventListener('timeupdate', () => {
    if (!current || job) return;
    if (video.currentTime >= trim().end && !video.paused) video.pause();
  });

  trimStart.addEventListener('input', onTrimInput);
  trimEnd.addEventListener('input', onTrimInput);
  $('trim-set-start').addEventListener('click', () => {
    trimStart.value = String(Math.min(video.currentTime, Number(trimEnd.value)));
    updateSummary();
  });
  $('trim-set-end').addEventListener('click', () => {
    trimEnd.value = String(Math.max(video.currentTime, Number(trimStart.value)));
    updateSummary();
  });
  formatSelect.addEventListener('change', applyFormatDefaults);
  [sizeSelect, fpsSelect, qualitySelect, audioBitrateSelect].forEach((s) => s.addEventListener('change', updateSummary));
  saveButton.addEventListener('click', save);
  cancelButton.addEventListener('click', cancelJob);
  frameButton.addEventListener('click', addFrameToCanvas);
  $('video-close').addEventListener('click', () => closeVideoEditor());
  const FRAME_STEP_S = 1 / 30;
  const stepFrame = (direction) => {
    video.pause();
    video.currentTime = Math.min(current.duration, Math.max(0, video.currentTime + direction * FRAME_STEP_S));
  };
  /** What each video-editor shortcut does (keys come from shortcut-settings.js). */
  const VIDEO_ACTIONS = Object.freeze({
    videoPlay: () => (video.paused ? video.play() : video.pause()),
    videoSetStart: () => $('trim-set-start').click(),
    videoSetEnd: () => $('trim-set-end').click(),
    videoPrevFrame: () => stepFrame(-1),
    videoNextFrame: () => stepFrame(1),
    videoSave: () => save(),
    videoAddFrame: () => addFrameToCanvas(),
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeVideoEditor(); // during an export this cancels it
      return;
    }
    if (!current || job || App.focusOwnsKey(e)) return;
    const id = Object.keys(VIDEO_ACTIONS).find((name) => App.shortcutMatches(name, e));
    if (!id) return;
    e.preventDefault();
    VIDEO_ACTIONS[id]();
  });
  I18n.subscribe(relabel);

  Object.assign(App, { openVideoEditor, closeVideoEditor, isVideoEditorOpen });
})();
