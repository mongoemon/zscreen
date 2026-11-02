'use strict';

// Animated GIF encoder. Pure (no DOM) so it loads in the browser (global `GifEncoder`) and in Node
// unit tests (module.exports).
//
// Built for screen recordings, where most of the picture stays still between frames:
//   - each frame only stores the rectangle that changed since the previous one;
//   - inside that rectangle, pixels that did not change are written as transparent, so the old
//     pixel shows through (disposal "do not dispose") and the LZW stream compresses them well;
//   - a frame identical to the previous one just makes the previous frame last longer;
//   - each frame gets its own palette (local color table): exact colours when a frame has 256 or
//     fewer, otherwise a median-cut palette.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.GifEncoder = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_CODE_SIZE = 12;
  const MIN_DELAY_CS = 2; // browsers treat 0-1 centiseconds as 10, so never write less than 2
  const DEFAULT_THRESHOLD = 12; // a channel must move more than this to count as a change (codec noise)

  // ---------- byte output ----------
  function createWriter() {
    let buf = new Uint8Array(1 << 16);
    let length = 0;
    function ensure(extra) {
      if (length + extra <= buf.length) return;
      let size = buf.length * 2;
      while (size < length + extra) size *= 2;
      const next = new Uint8Array(size);
      next.set(buf.subarray(0, length));
      buf = next;
    }
    const writer = {
      byte(b) { ensure(1); buf[length++] = b & 0xff; },
      u16(v) { ensure(2); buf[length++] = v & 0xff; buf[length++] = (v >> 8) & 0xff; },
      bytes(arr) { ensure(arr.length); buf.set(arr, length); length += arr.length; },
      text(s) { for (let i = 0; i < s.length; i++) writer.byte(s.charCodeAt(i)); },
      result: () => buf.slice(0, length),
    };
    return writer;
  }

  // ---------- LZW ----------
  /**
   * GIF-flavoured LZW of palette indices, packed LSB-first into 255-byte sub-blocks (terminator included).
   * @param {Uint8Array} indices
   * @param {number} minCodeSize 2..8
   * @returns {Uint8Array}
   */
  function lzwEncode(indices, minCodeSize) {
    const out = createWriter();
    const block = new Uint8Array(255);
    let blockLen = 0;
    let bitBuf = 0;
    let bitCount = 0;

    const flushBlock = () => {
      if (blockLen === 0) return;
      out.byte(blockLen);
      out.bytes(block.subarray(0, blockLen));
      blockLen = 0;
    };
    const emit = (code, size) => {
      bitBuf |= code << bitCount;
      bitCount += size;
      while (bitCount >= 8) {
        block[blockLen++] = bitBuf & 0xff;
        if (blockLen === 255) flushBlock();
        bitBuf >>>= 8;
        bitCount -= 8;
      }
    };

    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    // dictionary: key = prefixCode * 256 + nextIndex -> code
    let dict = new Map();
    let nextCode = endCode + 1;
    let codeSize = minCodeSize + 1;

    emit(clearCode, codeSize);
    if (indices.length > 0) {
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = prefix * 256 + k;
        const found = dict.get(key);
        if (found !== undefined) {
          prefix = found;
          continue;
        }
        emit(prefix, codeSize);
        if (nextCode < (1 << MAX_CODE_SIZE)) {
          dict.set(key, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < MAX_CODE_SIZE) codeSize++;
        } else {
          emit(clearCode, codeSize);
          dict = new Map();
          nextCode = endCode + 1;
          codeSize = minCodeSize + 1;
        }
        prefix = k;
      }
      emit(prefix, codeSize);
      // a decoder adds its (one step late) entry for that last code and may widen the code size
      // before reading the end code, so the end code has to be written at the wider size too
      if (nextCode === (1 << codeSize) && codeSize < MAX_CODE_SIZE) codeSize++;
    }
    emit(endCode, codeSize);
    if (bitCount > 0) {
      block[blockLen++] = bitBuf & 0xff;
      if (blockLen === 255) flushBlock();
    }
    flushBlock();
    out.byte(0);
    return out.result();
  }

  // ---------- palette ----------
  /**
   * Builds a palette for `count` RGB colours read by `colorAt(i)` (0xRRGGBB) and a mapper onto it.
   * @returns {{palette: number[], map: (rgb:number) => number}} palette entries are 0xRRGGBB
   */
  function buildPalette(colorAt, count, maxColors) {
    // exact palette when the frame has few colours (typical for UI recordings)
    const exact = new Map();
    for (let i = 0; i < count && exact.size <= maxColors; i++) {
      const c = colorAt(i);
      if (!exact.has(c)) exact.set(c, exact.size);
    }
    if (exact.size <= maxColors) {
      return { palette: [...exact.keys()], map: (rgb) => exact.get(rgb) };
    }
    return medianCut(colorAt, count, maxColors);
  }

  // 6 bits per channel histogram: fine enough for video, small enough to sort quickly.
  const BIN_BITS = 6;
  const SHIFT = 8 - BIN_BITS;
  const BINS = 1 << (BIN_BITS * 3);
  const binOf = (rgb) => ((((rgb >> 16) & 0xff) >> SHIFT) << (BIN_BITS * 2))
    | ((((rgb >> 8) & 0xff) >> SHIFT) << BIN_BITS)
    | ((rgb & 0xff) >> SHIFT);

  function medianCut(colorAt, count, maxColors) {
    const counts = new Uint32Array(BINS);
    const sumR = new Float64Array(BINS);
    const sumG = new Float64Array(BINS);
    const sumB = new Float64Array(BINS);
    for (let i = 0; i < count; i++) {
      const c = colorAt(i);
      const b = binOf(c);
      counts[b]++;
      sumR[b] += (c >> 16) & 0xff;
      sumG[b] += (c >> 8) & 0xff;
      sumB[b] += c & 0xff;
    }
    const bins = [];
    for (let b = 0; b < BINS; b++) {
      if (counts[b] > 0) {
        bins.push({
          n: counts[b], r: sumR[b] / counts[b], g: sumG[b] / counts[b], b: sumB[b] / counts[b],
        });
      }
    }

    const describe = (list) => {
      let n = 0;
      const lo = [255, 255, 255];
      const hi = [0, 0, 0];
      for (const e of list) {
        n += e.n;
        const ch = [e.r, e.g, e.b];
        for (let k = 0; k < 3; k++) {
          if (ch[k] < lo[k]) lo[k] = ch[k];
          if (ch[k] > hi[k]) hi[k] = ch[k];
        }
      }
      const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const axis = ranges.indexOf(Math.max(...ranges));
      return { list, n, axis, score: ranges[axis] * n };
    };

    let boxes = [describe(bins)];
    while (boxes.length < maxColors) {
      let pick = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].list.length > 1 && (pick < 0 || boxes[i].score > boxes[pick].score)) pick = i;
      }
      if (pick < 0 || boxes[pick].score === 0) break;
      const { list, n, axis } = boxes[pick];
      const key = ['r', 'g', 'b'][axis];
      const sorted = [...list].sort((p, q) => p[key] - q[key]);
      // split at the population median, keeping at least one bin on each side
      let acc = 0;
      let cut = 1;
      for (; cut < sorted.length - 1; cut++) {
        acc += sorted[cut - 1].n;
        if (acc >= n / 2) break;
      }
      boxes = [
        ...boxes.slice(0, pick), describe(sorted.slice(0, cut)), describe(sorted.slice(cut)), ...boxes.slice(pick + 1),
      ];
    }

    const palette = boxes.map(({ list, n }) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const e of list) { r += e.r * e.n; g += e.g * e.n; b += e.b * e.n; }
      return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    });

    const lookup = new Int16Array(BINS).fill(-1);
    const nearest = (rgb) => {
      const r = (rgb >> 16) & 0xff;
      const g = (rgb >> 8) & 0xff;
      const b = rgb & 0xff;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const p = palette[i];
        const dr = r - ((p >> 16) & 0xff);
        const dg = g - ((p >> 8) & 0xff);
        const db = b - (p & 0xff);
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; // rough perceptual weights
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    };
    return {
      palette,
      map: (rgb) => {
        const b = binOf(rgb);
        if (lookup[b] < 0) lookup[b] = nearest(rgb);
        return lookup[b];
      },
    };
  }

  // ---------- frames ----------
  const differs = (a, b, o, threshold) => Math.abs(a[o] - b[o]) > threshold
    || Math.abs(a[o + 1] - b[o + 1]) > threshold
    || Math.abs(a[o + 2] - b[o + 2]) > threshold;

  /** Bounding box of pixels that moved more than `threshold` on any channel, or null when none did. */
  function changedRect(rgba, ref, width, height, threshold) {
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0, o = y * width * 4; x < width; x++, o += 4) {
        if (!differs(rgba, ref, o, threshold)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {{loop?: number, threshold?: number}} [options] loop: 0 = forever (default), n = n extra plays
   */
  function create(width, height, { loop = 0, threshold = DEFAULT_THRESHOLD } = {}) {
    if (!(width > 0 && height > 0 && width <= 0xffff && height <= 0xffff)) throw new RangeError('bad GIF size');
    const out = createWriter();
    out.text('GIF89a');
    out.u16(width);
    out.u16(height);
    out.byte(0); // no global colour table; every frame has its own
    out.byte(0); // background colour index
    out.byte(0); // pixel aspect ratio
    // NETSCAPE2.0 application extension: loop count
    out.bytes([0x21, 0xff, 0x0b]);
    out.text('NETSCAPE2.0');
    out.bytes([0x03, 0x01]);
    out.u16(loop);
    out.byte(0);

    // Source colour last written for each pixel. Changes are measured against this (not against the
    // previous source frame) so slow fades below the threshold cannot drift away unnoticed.
    const ref = new Uint8ClampedArray(width * height * 4);
    let frameCount = 0;
    let pending = null; // encoded frame waiting to learn how long it lasts
    let elapsedMs = 0; // timeline position, so rounding to centiseconds never drifts
    let writtenCs = 0;

    function writePending() {
      if (!pending) return;
      const delay = Math.max(MIN_DELAY_CS, Math.round(elapsedMs / 10) - writtenCs);
      writtenCs += delay;
      const {
        rect, indices, palette, transparent,
      } = pending;
      let bits = 1;
      while ((1 << bits) < palette.length) bits++;

      out.bytes([0x21, 0xf9, 0x04]);
      out.byte((1 << 2) | (transparent >= 0 ? 1 : 0)); // disposal 1 = keep this frame under the next one
      out.u16(Math.min(delay, 0xffff));
      out.byte(transparent >= 0 ? transparent : 0);
      out.byte(0);

      out.byte(0x2c);
      out.u16(rect.x);
      out.u16(rect.y);
      out.u16(rect.w);
      out.u16(rect.h);
      out.byte(0x80 | (bits - 1)); // local colour table, not interlaced
      for (let i = 0; i < (1 << bits); i++) {
        const c = palette[i] || 0;
        out.bytes([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]);
      }
      const minCodeSize = Math.max(2, bits);
      out.byte(minCodeSize);
      out.bytes(lzwEncode(indices, minCodeSize));
      pending = null;
    }

    /**
     * @param {Uint8ClampedArray|Uint8Array} rgba width*height*4 pixels (alpha is ignored)
     * @param {number} durationMs how long this frame stays on screen
     */
    function addFrame(rgba, durationMs) {
      if (rgba.length !== width * height * 4) throw new RangeError('frame size does not match the GIF');
      const first = frameCount === 0;
      const rect = first ? { x: 0, y: 0, w: width, h: height } : changedRect(rgba, ref, width, height, threshold);
      frameCount++;
      if (!rect) { // nothing visible changed: the previous frame simply lasts longer
        elapsedMs += durationMs;
        return;
      }
      writePending();

      const count = rect.w * rect.h;
      const offsets = new Uint32Array(count); // byte offset of each pixel of rect in the full frame
      const changed = new Uint8Array(count);
      let drawnCount = 0;
      for (let i = 0; i < count; i++) {
        const o = ((rect.y + Math.floor(i / rect.w)) * width + rect.x + (i % rect.w)) * 4;
        offsets[i] = o;
        if (first || differs(rgba, ref, o, threshold)) {
          changed[i] = 1;
          drawnCount++;
        }
      }
      const drawn = new Uint32Array(drawnCount);
      for (let i = 0, j = 0; i < count; i++) if (changed[i]) drawn[j++] = offsets[i];

      const useTransparency = drawnCount < count;
      const rgbAt = (o) => (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
      const { palette, map } = buildPalette((i) => rgbAt(drawn[i]), drawnCount, useTransparency ? 255 : 256);
      const transparent = useTransparency ? palette.length : -1;

      const indices = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        if (!changed[i]) {
          indices[i] = transparent;
          continue;
        }
        const o = offsets[i];
        indices[i] = map(rgbAt(o));
        ref[o] = rgba[o];
        ref[o + 1] = rgba[o + 1];
        ref[o + 2] = rgba[o + 2];
      }
      pending = {
        rect, indices, palette: useTransparency ? [...palette, 0] : palette, transparent,
      };
      elapsedMs += durationMs;
    }

    /** @returns {Uint8Array} the complete .gif file */
    function finish() {
      if (frameCount === 0) throw new Error('a GIF needs at least one frame');
      writePending();
      out.byte(0x3b);
      return out.result();
    }

    return { addFrame, finish };
  }

  return {
    create, lzwEncode, buildPalette, changedRect,
  };
});
