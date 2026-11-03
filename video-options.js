'use strict';

// Choices and arithmetic for screen recording and video export: output sizes, frame rates, bitrates,
// container / codec selection and trimming. Pure (no DOM) so it loads in the browser (global
// `VideoOptions`) and in Node unit tests (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VideoOptions = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /** Size presets by the short side ("720p"); 0 keeps the original size. */
  const SIZES = Object.freeze([0, 1080, 720, 480, 360, 240]);
  const RECORD_FPS = Object.freeze([15, 30, 60]);
  const EXPORT_FPS = Object.freeze([5, 10, 15, 24, 30]);
  /** Bits per second offered for audio-only MP3 / M4A (both encoders accept 64-320 kbps). */
  const AUDIO_BITRATES = Object.freeze([64000, 96000, 128000, 192000, 256000, 320000]);
  const DEFAULTS = Object.freeze({
    recordSize: 0,
    recordFps: 30,
    gif: Object.freeze({ size: 480, fps: 10 }),
    video: Object.freeze({ size: 720, fps: 30, quality: 'low' }),
    audioBitrate: 128000,
  });

  /** Bits per pixel per frame. "low" is aimed at small files that still read fine for UI recordings. */
  const QUALITY = Object.freeze({ low: 0.03, medium: 0.07, high: 0.15 });
  const QUALITIES = Object.freeze(Object.keys(QUALITY));
  const RECORD_QUALITY = 0.12;
  const MIN_BITRATE = 150000;
  const MAX_BITRATE = 25000000;
  const MIN_TRIM_S = 0.1;

  /** MediaRecorder MIME candidates per container, best first. */
  const MIME_CANDIDATES = Object.freeze({
    mp4: Object.freeze(['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4']),
    webm: Object.freeze(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']),
  });
  /** The same with an audio codec, for streams that carry sound. */
  const MIME_CANDIDATES_AUDIO = Object.freeze({
    mp4: Object.freeze(['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']),
    webm: Object.freeze(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']),
  });

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  /**
   * Output size for a `width` x `height` source scaled so its short side is at most `maxShort`
   * (0 = no limit). Never upscales; both sides are even (video encoders need that).
   */
  function fitSize(width, height, maxShort) {
    const short = Math.min(width, height);
    const scale = maxShort > 0 && short > maxShort ? maxShort / short : 1;
    return { width: even(width * scale), height: even(height * scale) };
  }

  /** Size presets worth offering for a source: "original" plus every preset smaller than it. */
  function sizesFor(width, height) {
    const short = Math.min(width, height);
    return SIZES.filter((s) => s === 0 || s < short);
  }

  /** Bits per second for the given output; `quality` is a QUALITY key or a bits-per-pixel number. */
  function bitrateFor(width, height, fps, quality) {
    const bpp = typeof quality === 'number' ? quality : QUALITY[quality] ?? QUALITY.medium;
    return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, width * height * fps * bpp)));
  }

  const recordBitrate = (width, height, fps) => bitrateFor(width, height, fps, RECORD_QUALITY);

  const estimateBytes = (bitsPerSecond, seconds) => Math.round((bitsPerSecond * seconds) / 8);

  /**
   * @param {(mime:string) => boolean} isSupported usually MediaRecorder.isTypeSupported
   * @param {'mp4'|'webm'} container
   * @param {boolean} [withAudio] the stream also has an audio track
   * @returns {string|null}
   */
  function pickMimeType(isSupported, container, withAudio = false) {
    const candidates = (withAudio ? MIME_CANDIDATES_AUDIO : MIME_CANDIDATES)[container] || [];
    return candidates.find((m) => isSupported(m)) || null;
  }

  /** Containers this browser can record, best first. */
  const supportedContainers = (isSupported) => ['mp4', 'webm'].filter((c) => pickMimeType(isSupported, c));

  /** MIME for raw screen recordings: WebM first (we can add its missing duration), MP4 otherwise. */
  const recordingMimeType = (isSupported, withAudio = false) => (
    pickMimeType(isSupported, 'webm', withAudio) || pickMimeType(isSupported, 'mp4', withAudio)
  );

  const extensionFor = (mime) => (String(mime).startsWith('video/mp4') ? 'mp4' : 'webm');

  /** Keeps start/end inside [0, duration] with end at least MIN_TRIM_S after start. */
  function clampTrim(start, end, duration) {
    const total = Math.max(0, duration);
    const s = Math.min(Math.max(0, start), Math.max(0, total - MIN_TRIM_S));
    const e = Math.max(Math.min(total, end), Math.min(total, s + MIN_TRIM_S));
    return { start: s, end: e };
  }

  /** Times (s) at which to sample frames for a GIF between start and end at `fps`. Always at least one. */
  function frameTimes(start, end, fps) {
    const step = 1 / fps;
    const count = Math.max(1, Math.floor((end - start) * fps + 1e-6));
    return Array.from({ length: count }, (_, i) => start + i * step);
  }

  /** 75.25 -> "1:15.2" */
  function formatTime(seconds) {
    const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
    const m = Math.floor(tenths / 600);
    const s = Math.floor((tenths % 600) / 10);
    return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
  }

  /** 1536 -> "1.5 KB" */
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return {
    SIZES,
    RECORD_FPS,
    EXPORT_FPS,
    AUDIO_BITRATES,
    DEFAULTS,
    QUALITY,
    QUALITIES,
    MIME_CANDIDATES,
    MIME_CANDIDATES_AUDIO,
    fitSize,
    sizesFor,
    bitrateFor,
    recordBitrate,
    estimateBytes,
    pickMimeType,
    supportedContainers,
    recordingMimeType,
    extensionFor,
    clampTrim,
    frameTimes,
    formatTime,
    formatBytes,
  };
});
