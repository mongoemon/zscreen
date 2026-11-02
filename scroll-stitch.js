'use strict';

// Scrolling screenshot: joins frames of a window being scrolled into one tall image.
// Pure (no DOM) so it runs in the browser (global `ScrollStitch`) and in Node tests.
//
// Each frame is reduced to a small "signature" per row (the mean brightness of a few column
// blocks). For every new frame, compared with the last kept one ("ref"):
//   - rows that did not change are left out: sticky headers / footers, blank space;
//   - every changed row votes for the shift that makes it line up with a row of ref; the shift
//     with the most votes wins. Rows that changed for another reason (the title bar turning active
//     when the window is clicked, the mouse pointer, an overlay scrollbar) just lose the vote;
//   - the rows below the content that moved (a fixed footer) are kept back until the end.
// The output is "committed" content down to row `end` of ref; each frame appends the rows that
// scrolled in below it. At the end, ref's rows below `end` (its footer) close the image.
// Scrolling back up is ignored until the page comes back past the last kept frame.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory();
  if (isNode) {
    module.exports = api;
  } else {
    root.ScrollStitch = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const BLOCKS = 64; // column blocks per row signature
  const SAME_ROW = 1.5; // mean block difference below which a row counts as unchanged
  // mean block difference below which two rows count as the same content; loose enough for a
  // capture that is scaled (the shift is then not a whole number of pixels)
  const MATCH = 12;
  const TEXTURE = 6; // brightness range a row needs to say anything (blank rows match anything)
  const MIN_VOTES = 6; // matching rows a shift needs before it is trusted
  const MIN_SHARE = 0.6; // ... and the share of the rows it could match that do match
  const SAMPLE_ROWS = 200; // changed rows that vote
  const CLOSE_VOTE = 0.9; // shifts with this share of the top vote are checked pixel by pixel
  const MAX_CLOSE = 40; // ... at most this many of them
  const MIN_OVERLAP = 16; // rows two frames must share
  // Rows at the bottom of a window that are never taken mid-way: macOS draws the window's rounded
  // corners there, which would otherwise show up at every seam. They scroll up into the next frame.
  // (macOS 26 corners are up to ~26 pt, so ~52 px on a Retina screen)
  const EDGE_MIN = 64;
  const EDGE_SHARE = 0.05;
  // the largest canvas browsers reliably create: 32767 px on a side, ~268M px in all
  const MAX_SIDE = 32000;
  const MAX_AREA = 250e6;

  /** Largest result height for frames `width` px wide. */
  const maxHeightFor = (width) => Math.max(1, Math.min(MAX_SIDE, Math.floor(MAX_AREA / Math.max(1, width))));

  /**
   * @typedef {{width:number, height:number, data:Uint8ClampedArray|Uint8Array}} Frame RGBA pixels
   * @typedef {{blocks:number, height:number, rows:Float32Array, soft:Float32Array, range:Float32Array}} Signature
   *   rows: height x blocks mean brightness; soft: the same blurred over 3 rows (for matching
   *   scaled captures); range: per-row max - min across the blocks
   */

  /** @param {Frame} frame @returns {Signature} */
  function signature(frame) {
    const { width, height, data } = frame;
    const blocks = Math.max(1, Math.min(BLOCKS, width));
    const rows = new Float32Array(height * blocks);
    const range = new Float32Array(height);
    const step = width > blocks * 8 ? 2 : 1; // every 2nd pixel is plenty on wide frames
    for (let y = 0; y < height; y++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let b = 0; b < blocks; b++) {
        const x0 = Math.floor((b * width) / blocks);
        const x1 = Math.floor(((b + 1) * width) / blocks);
        let sum = 0;
        let n = 0;
        for (let x = x0; x < x1; x += step) {
          const i = (y * width + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          n++;
        }
        const v = n ? sum / n : 0;
        rows[y * blocks + b] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      range[y] = hi - lo;
    }
    // 1-2-3-2-1 blur over 5 rows: a half-pixel shift then barely changes a row
    const soft = new Float32Array(rows.length);
    for (let y = 0; y < height; y++) {
      for (let b = 0; b < blocks; b++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const yy = Math.min(height - 1, Math.max(0, y + k));
          sum += rows[yy * blocks + b] * (3 - Math.abs(k));
        }
        soft[y * blocks + b] = sum / 9;
      }
    }
    return {
      blocks, height, rows, soft, range,
    };
  }

  /**
   * Mean block difference of row `ra` of `a` and row `rb` of `b`, leaving out the worst block
   * (a scrollbar thumb or the mouse pointer only changes one).
   */
  function rowDiff(a, ra, b, rb, key = 'rows') {
    const n = a.blocks;
    const va = a[key];
    const vb = b[key];
    const oa = ra * n;
    const ob = rb * n;
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(va[oa + i] - vb[ob + i]);
      sum += d;
      if (d > worst) worst = d;
    }
    return n > 1 ? (sum - worst) / (n - 1) : sum;
  }

  const unchanged = (a, b, r) => rowDiff(a, r, b, r) < SAME_ROW;

  /** Rows at the bottom that did not change between `a` and `b` (a fixed footer, or blank space). */
  function staticBottom(a, b) {
    let n = 0;
    while (n < a.height && unchanged(a, b, a.height - 1 - n)) n++;
    return n;
  }

  /**
   * How far the content moved up from `prev` to `cur`.
   * @returns {{status:'same'} | {status:'moved', dy:number} | {status:'lost'}}
   *   same: no real movement; lost: moved further than one frame, or back up
   */
  function findShift(prev, cur) {
    const { height } = cur;
    const changed = [];
    for (let r = 0; r < height; r++) {
      if ((cur.range[r] >= TEXTURE || prev.range[r] >= TEXTURE) && !unchanged(prev, cur, r)) changed.push(r);
    }
    if (changed.length < MIN_VOTES) return { status: 'same' };
    const stride = Math.max(1, Math.floor(changed.length / SAMPLE_ROWS));
    const voters = changed.filter((r, i) => i % stride === 0 && cur.range[r] >= TEXTURE);
    if (voters.length < MIN_VOTES) return { status: 'lost' };

    const scored = [];
    for (let dy = 1; dy <= height - MIN_OVERLAP; dy++) {
      // cur row r shows what prev showed at row r + dy
      let candidates = 0;
      let votes = 0;
      for (const r of voters) {
        if (r + dy >= height) break;
        candidates++;
        if (rowDiff(prev, r + dy, cur, r, 'soft') < MATCH) votes++;
      }
      if (candidates < MIN_VOTES) break; // larger shifts only leave fewer rows
      if (votes >= MIN_VOTES && votes >= candidates * MIN_SHARE) scored.push({ dy, votes });
    }
    if (scored.length === 0) return { status: 'lost' };
    // every changed row, not just the voters: telling 499 from 500 can come down to a text edge
    return { status: 'moved', dy: refine(prev, cur, changed, scored) };
  }

  /**
   * The blurred vote is loose, so shifts next to the right one (or a line apart, on evenly spaced
   * text) score almost as well: of the shifts close to the top vote, take the one whose rows
   * differ least, unblurred. Each row's difference is capped, so rows that match nowhere (the
   * title bar, the pointer) weigh the same for every shift and cannot tip it.
   */
  function refine(prev, cur, rows, scored) {
    const top = Math.max(...scored.map((s) => s.votes));
    const close = scored.filter((s) => s.votes >= top * CLOSE_VOTE)
      .sort((a, b) => b.votes - a.votes)
      .slice(0, MAX_CLOSE);
    let best = null;
    for (const { dy } of close) {
      let sum = 0;
      let n = 0;
      for (const r of rows) {
        if (r + dy >= cur.height) break;
        sum += Math.min(rowDiff(prev, r + dy, cur, r), MATCH);
        n++;
      }
      const err = sum / n;
      if (!best || err < best.err) best = { dy, err };
    }
    return best.dy;
  }

  /** Rows [y, y + h) of a frame as a frame of their own (copied, so the source can be reused). */
  function sliceRows(frame, y, h) {
    const rowBytes = frame.width * 4;
    return { width: frame.width, height: h, data: frame.data.slice(y * rowBytes, (y + h) * rowBytes) };
  }

  /**
   * @param {{maxHeight?: number}} [options] maxHeight: stop growing past this (default: canvas limit)
   */
  function createStitcher(options = {}) {
    let size = null; // {width, height} of every accepted frame
    let ref = null; // {frame, sig}: the last frame whose content was kept
    let started = false; // the page has moved at least once
    /** @type {Frame[]} committed content, top to bottom */
    let pieces = [];
    let committed = 0; // rows in `pieces`
    let end = 0; // row of ref where the committed content ends
    let maxHeight = options.maxHeight || Infinity;

    // committed content + ref's rows below it (before the first move: the whole first frame)
    const height = () => (ref ? committed + size.height - end : 0);

    function commit(frame, y, h) {
      if (h <= 0) return;
      pieces = [...pieces, sliceRows(frame, y, h)];
      committed += h;
    }

    /**
     * @param {Frame} frame
     * @returns {{status:'first'|'same'|'added'|'lost'|'resized'|'full', height:number}}
     */
    function push(frame) {
      if (!ref) {
        size = { width: frame.width, height: frame.height };
        const copy = sliceRows(frame, 0, frame.height);
        ref = { frame: copy, sig: signature(copy) };
        maxHeight = Math.min(maxHeight, maxHeightFor(frame.width));
        return { status: 'first', height: height() };
      }
      if (frame.width !== size.width || frame.height !== size.height) return { status: 'resized', height: height() };
      if (height() >= maxHeight) return { status: 'full', height: height() };

      const sig = signature(frame);
      const shift = findShift(ref.sig, sig);
      if (shift.status === 'lost') return { status: 'lost', height: height() };
      const copy = () => sliceRows(frame, 0, frame.height);
      if (shift.status === 'same') {
        // keep up with small changes (the window turning active, a hover) without moving
        ref = { frame: copy(), sig };
        return { status: 'same', height: height() };
      }

      const edge = Math.min(Math.round(size.height / 4), Math.max(EDGE_MIN, Math.round(size.height * EDGE_SHARE)));
      const bottom = size.height - Math.max(staticBottom(ref.sig, sig), edge);
      if (!started) { // the first frame, down to its fixed footer
        started = true;
        end = bottom;
        commit(ref.frame, 0, end);
      }
      const from = Math.max(0, end - shift.dy); // where the committed content ends in this frame
      // everything below `from` ends up in the image (committed now, or ref's tail at the end)
      if (committed + size.height - from > maxHeight) return { status: 'full', height: height() };
      const to = Math.max(bottom, from);
      commit(frame, from, to - from);
      end = to;
      ref = { frame: copy(), sig };
      return { status: 'added', height: height() };
    }

    /**
     * The pieces of the result, top to bottom, with where each goes.
     * @returns {{width:number, height:number, pieces:{y:number, frame:Frame}[]} | null}
     */
    function result() {
      if (!ref) return null;
      const all = [...pieces];
      if (end < size.height) all.push(sliceRows(ref.frame, end, size.height - end));
      let y = 0;
      const placed = all.map((frame) => {
        const piece = { y, frame };
        y += frame.height;
        return piece;
      });
      return { width: size.width, height: y, pieces: placed };
    }

    return { push, result, height };
  }

  return {
    signature, findShift, sliceRows, createStitcher, maxHeightFor,
  };
});
