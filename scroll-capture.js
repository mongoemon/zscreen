'use strict';

// Scrolling screenshot: reads frames from a screen / window capture stream while the user scrolls,
// joins them with ScrollStitch (scroll-stitch.js), and turns the result into one PNG.
// The record dialog and bar (recorder.js) pick the source, start it and stop it.
(() => {
  // Two frames must overlap to be joined, so a fast trackpad flick needs frequent frames (at 120 ms
  // most frames of a quick scroll were lost). Joining a frame takes ~20 ms on a Retina screen;
  // when it takes longer, frames are simply taken back to back.
  const FRAME_INTERVAL_MS = 50;

  /**
   * @param {MediaStream} stream a getDisplayMedia() stream (stopped when the capture stops)
   * @param {{onProgress?: (r: {status:string, height:number}) => void}} [options]
   * @returns {{stop: () => Promise<Blob | null>}} stop: the joined image (null when no frame arrived)
   */
  function startScrollCapture(stream, { onProgress = () => {} } = {}) {
    const track = stream.getVideoTracks()[0];
    const stitcher = ScrollStitch.createStitcher();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stopped = false;
    let lastAt = -Infinity;

    function take(source, width, height) {
      if (stopped || !width || !height) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(source, 0, 0, width, height);
      onProgress(stitcher.push(ctx.getImageData(0, 0, width, height)));
    }

    // Track processor: frames keep coming while this window is hidden or in the background (a
    // <video> stops painting then). Browsers without it fall back to sampling a <video>.
    // A screen capture only sends frames when something changes, so a frame that arrives too soon
    // is kept and used a little later: otherwise the last bit of scrolling could be dropped.
    let finish;
    if (typeof MediaStreamTrackProcessor === 'function') {
      let pending = null;
      let pendingTimer = null;
      const takeFrame = (frame) => {
        lastAt = performance.now();
        take(frame, frame.displayWidth, frame.displayHeight);
      };
      const flushPending = () => {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        if (!pending) return;
        const frame = pending;
        pending = null;
        try {
          takeFrame(frame);
        } finally {
          frame.close();
        }
      };

      const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      const loop = (async () => {
        for (;;) {
          const { value: frame, done } = await reader.read();
          if (done) return;
          try {
            const wait = FRAME_INTERVAL_MS - (performance.now() - lastAt);
            if (wait <= 0) {
              if (pending) pending.close();
              pending = null;
              takeFrame(frame);
            } else {
              if (pending) pending.close();
              pending = frame.clone();
              if (!pendingTimer) pendingTimer = setTimeout(flushPending, wait);
            }
          } finally {
            frame.close();
          }
        }
      })().catch((err) => console.warn('scroll capture: frame reader stopped', err));
      finish = () => reader.cancel().catch(() => {}).then(() => loop).then(flushPending);
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      video.play().catch((err) => console.warn('scroll capture: preview did not play', err));
      const timer = setInterval(() => take(video, video.videoWidth, video.videoHeight), FRAME_INTERVAL_MS);
      finish = async () => {
        clearInterval(timer);
        video.srcObject = null;
      };
    }

    async function stop() {
      await finish();
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      const result = stitcher.result();
      if (!result) return null;
      const out = document.createElement('canvas');
      out.width = result.width;
      out.height = result.height;
      const outCtx = out.getContext('2d');
      for (const { y, frame } of result.pieces) {
        outCtx.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, y);
      }
      return App.toPngBlob(out);
    }

    return { stop };
  }

  Object.assign(App, { startScrollCapture });
})();
