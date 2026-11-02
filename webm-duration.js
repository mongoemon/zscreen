'use strict';

// MediaRecorder writes WebM files without a Duration, so players show no length and seek poorly.
// withDuration() adds one to the Segment's Info element. Pure (no DOM): global `WebmDuration` in the
// browser, module.exports in Node unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WebmDuration = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ID = Object.freeze({
    EBML: 0x1a45dfa3,
    SEGMENT: 0x18538067,
    INFO: 0x1549a966,
    TIMECODE_SCALE: 0x2ad7b1,
    DURATION: 0x4489,
    CLUSTER: 0x1f43b675,
  });
  const DEFAULT_TIMECODE_SCALE = 1000000; // ns per timestamp unit, i.e. milliseconds

  /** Length in bytes of the variable-size integer starting with `first`, or 0 when invalid. */
  function vintLength(first) {
    for (let len = 1; len <= 8; len++) if (first & (0x80 >> (len - 1))) return len;
    return 0;
  }

  function readUint(bytes, pos, len) {
    let value = 0;
    for (let i = 0; i < len; i++) value = value * 256 + bytes[pos + i];
    return value;
  }

  function encodeSize(value) {
    for (let len = 1; len <= 8; len++) {
      if (value < 2 ** (7 * len) - 1) { // all ones is reserved for "unknown size"
        const out = new Uint8Array(len);
        let v = value;
        for (let i = len - 1; i >= 0; i--) {
          out[i] = v % 256;
          v = Math.floor(v / 256);
        }
        out[0] |= 0x80 >> (len - 1);
        return out;
      }
    }
    throw new RangeError('EBML size too large');
  }

  /**
   * Element header at `pos`, or null when it is malformed or does not fit before `limit`.
   * `unknown` is the all-ones "size unknown" value MediaRecorder uses for the Segment; such an
   * element runs to `limit`.
   */
  function header(bytes, pos, limit) {
    const idLen = vintLength(bytes[pos]);
    if (!idLen || idLen > 4 || pos + idLen >= limit) return null;
    const sizePos = pos + idLen;
    const sizeLen = vintLength(bytes[sizePos]);
    if (!sizeLen || sizePos + sizeLen > limit) return null;
    let size = bytes[sizePos] & (0xff >> sizeLen);
    let unknown = size === (0xff >> sizeLen);
    for (let i = 1; i < sizeLen; i++) {
      size = size * 256 + bytes[sizePos + i];
      if (bytes[sizePos + i] !== 0xff) unknown = false;
    }
    const dataStart = sizePos + sizeLen;
    const end = unknown ? limit : dataStart + size;
    if (end > limit) return null;
    return {
      id: readUint(bytes, pos, idLen), idLen, dataStart, size, unknown, end,
    };
  }

  /** Finds Segment > Info, stopping at the first Cluster (Info always comes before the media). */
  function findInfo(bytes) {
    const ebml = header(bytes, 0, bytes.length);
    if (!ebml || ebml.id !== ID.EBML || ebml.unknown) return null;
    const segment = header(bytes, ebml.end, bytes.length);
    if (!segment || segment.id !== ID.SEGMENT) return null;
    for (let pos = segment.dataStart; pos < segment.end;) {
      const el = header(bytes, pos, segment.end);
      if (!el || el.unknown || el.id === ID.CLUSTER) return null;
      if (el.id === ID.INFO) return { pos, el };
      pos = el.end;
    }
    return null;
  }

  /** @returns {{scale:number, duration:{dataStart:number, size:number}|null}|null} null when malformed */
  function readInfo(bytes, el) {
    let scale = DEFAULT_TIMECODE_SCALE;
    let duration = null;
    for (let p = el.dataStart; p < el.end;) {
      const child = header(bytes, p, el.end);
      if (!child || child.unknown) return null;
      if (child.id === ID.TIMECODE_SCALE && child.size <= 6) scale = readUint(bytes, child.dataStart, child.size) || scale;
      if (child.id === ID.DURATION) duration = child;
      p = child.end;
    }
    return { scale, duration };
  }

  /**
   * @param {Uint8Array} bytes a WebM file
   * @param {number} durationMs
   * @returns {Uint8Array} the file with a Duration in Segment > Info; the input itself when it already
   *   has one, or when the layout is not one this understands (never throws on odd input)
   */
  function withDuration(bytes, durationMs) {
    if (!(durationMs > 0)) return bytes;
    const found = findInfo(bytes);
    if (!found) return bytes;
    const { pos, el } = found;
    const info = readInfo(bytes, el);
    if (!info || info.duration) return bytes;

    const duration = new Uint8Array(11);
    duration.set([0x44, 0x89, 0x88]); // Duration ID, size 8 (float64)
    new DataView(duration.buffer).setFloat64(3, (durationMs * 1e6) / info.scale);
    const parts = [
      bytes.subarray(0, pos + el.idLen),
      encodeSize(el.size + duration.length),
      bytes.subarray(el.dataStart, el.end),
      duration,
      bytes.subarray(el.end),
    ];
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  /** The Duration in milliseconds, or null when the file has none. */
  function readDuration(bytes) {
    const found = findInfo(bytes);
    const info = found && readInfo(bytes, found.el);
    if (!info || !info.duration) return null;
    const { dataStart, size } = info.duration;
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, size);
    const value = size === 8 ? view.getFloat64(0) : view.getFloat32(0);
    return (value * info.scale) / 1e6;
  }

  return {
    withDuration, readDuration, encodeSize, ID,
  };
});
