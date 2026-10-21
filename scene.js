'use strict';

// Pure scene/viewport logic, free of DOM access so it can run in the browser (global `Scene`)
// and in Node unit tests (module.exports). Nothing here mutates its arguments.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Scene = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * @typedef {{id:number, x:number, y:number, w:number, h:number}} Rect
   * @typedef {{x:number, y:number, scale:number}} View
   */

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Bounding box of all items, or null when there are none. */
  function boundsOf(list) {
    if (list.length === 0) return null;
    const x1 = Math.min(...list.map((i) => i.x));
    const y1 = Math.min(...list.map((i) => i.y));
    const x2 = Math.max(...list.map((i) => i.x + i.w));
    const y2 = Math.max(...list.map((i) => i.y + i.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** Y where the next stacked image starts: 0 for an empty scene, otherwise below everything. */
  function nextStackY(list, gap) {
    if (list.length === 0) return 0;
    return Math.max(...list.map((i) => i.y + i.h)) + gap;
  }

  /** Positions for new images (given as sizes) stacked vertically below the existing scene. */
  function stackPositions(list, sizes, gap) {
    let y = nextStackY(list, gap);
    return sizes.map(({ w, h }) => {
      const placed = { x: 0, y, w, h };
      y += h + gap;
      return placed;
    });
  }

  /** Re-stack every item at x=0 in top-to-bottom order; array (z-)order is preserved. */
  function arrangeVertically(list, gap) {
    const ordered = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    const placedY = new Map();
    let y = 0;
    for (const it of ordered) {
      placedY.set(it.id, y);
      y += it.h + gap;
    }
    return list.map((it) => ({ ...it, x: 0, y: placedY.get(it.id) }));
  }

  const toWorld = (view, sx, sy) => ({ x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale });

  /** Top-most item under a screen point (the last in the array is drawn on top). */
  function hitItem(list, view, sx, sy) {
    const p = toWorld(view, sx, sy);
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (p.x >= it.x && p.x <= it.x + it.w && p.y >= it.y && p.y <= it.y + it.h) return it;
    }
    return null;
  }

  /** True when a screen point is on the bottom-right resize handle of an item. */
  function hitHandle(item, view, sx, sy, handleSize) {
    if (!item) return false;
    const hx = (item.x + item.w) * view.scale + view.x;
    const hy = (item.y + item.h) * view.scale + view.y;
    return Math.abs(sx - hx) <= handleSize && Math.abs(sy - hy) <= handleSize;
  }

  /** New size when the handle moves by dxWorld, keeping the aspect ratio and a minimum width. */
  function resizeKeepAspect(origW, origH, dxWorld, minW) {
    const w = Math.max(minW, origW + dxWorld);
    return { w, h: (w * origH) / origW };
  }

  /** Zoom by `factor` keeping the world point under (sx, sy) fixed on screen. */
  function zoomAt(view, sx, sy, factor, minScale, maxScale) {
    const scale = clamp(view.scale * factor, minScale, maxScale);
    const k = scale / view.scale;
    return { scale, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
  }

  /** View that shows the whole scene centred in the viewport (never zoomed in past 100%). */
  function fitViewFor(list, viewport, pad, minScale, maxScale) {
    const b = boundsOf(list);
    if (!b) return { x: pad, y: pad, scale: 1 };
    const scale = clamp(
      Math.min((viewport.width - pad * 2) / b.w, (viewport.height - pad * 2) / b.h, 1),
      minScale,
      maxScale,
    );
    return {
      scale,
      x: (viewport.width - b.w * scale) / 2 - b.x * scale,
      y: Math.max(pad, (viewport.height - b.h * scale) / 2) - b.y * scale,
    };
  }

  /** Scroll vertically so an off-screen item starts at `margin`; unchanged when already visible. */
  function revealView(view, item, viewportHeight, margin) {
    const top = item.y * view.scale + view.y;
    const bottom = (item.y + item.h) * view.scale + view.y;
    if (top >= 0 && bottom <= viewportHeight) return view;
    return { ...view, y: margin - item.y * view.scale };
  }

  /**
   * Snap a dragged rect to its neighbours. Per axis it aligns start/centre/end with the same
   * lines of other items, or sits exactly `gap` away from their edges (the stacking gap).
   * Returns the correction {dx, dy} plus guide lines {axis, pos, from, to} in world coordinates,
   * where axis 'x' is a vertical line at x=pos spanning from..to in y (and vice versa).
   */
  function snapRect(rect, others, threshold, gap) {
    const lines = (start, size) => [start, start + size / 2, start + size];
    const best = (pos, size) => {
      const mine = lines(rect[pos], rect[size]);
      let found = null;
      for (const o of others) {
        const theirs = lines(o[pos], o[size]);
        const pairs = [];
        mine.forEach((m) => theirs.forEach((t) => pairs.push({ delta: t - m, at: t })));
        pairs.push({ delta: o[pos] + o[size] + gap - mine[0], at: o[pos] + o[size] });
        pairs.push({ delta: o[pos] - gap - mine[2], at: o[pos] });
        for (const p of pairs) {
          const dist = Math.abs(p.delta);
          if (dist <= threshold && (!found || dist < found.dist)) found = { ...p, dist, other: o };
        }
      }
      return found;
    };

    const bx = best('x', 'w');
    const by = best('y', 'h');
    const dx = bx ? bx.delta : 0;
    const dy = by ? by.delta : 0;
    const moved = { ...rect, x: rect.x + dx, y: rect.y + dy };
    const guides = [];
    if (bx) {
      guides.push({
        axis: 'x', pos: bx.at,
        from: Math.min(moved.y, bx.other.y), to: Math.max(moved.y + moved.h, bx.other.y + bx.other.h),
      });
    }
    if (by) {
      guides.push({
        axis: 'y', pos: by.at,
        from: Math.min(moved.x, by.other.x), to: Math.max(moved.x + moved.w, by.other.x + by.other.w),
      });
    }
    return { dx, dy, guides };
  }

  /** Append a snapshot, keeping at most `limit` entries. */
  function pushHistory(history, snapshot, limit) {
    return [...history.slice(-(limit - 1)), snapshot];
  }

  /** Pop the latest snapshot; null when there is nothing to undo. */
  function undoHistory(history) {
    if (history.length === 0) return null;
    return { snapshot: history[history.length - 1], history: history.slice(0, -1) };
  }

  // ---------- annotations ----------
  // Annotation shapes (all in world coordinates, each has `id` and `ownerId` = image it sits on, or null):
  //   pen {points[], color, width}        line/arrow {x1,y1,x2,y2, color, width}
  //   arrow also: label?, labelW, labelH  (text behind the tail, see arrowLabelRect)
  //   rect/ellipse {x,y,w,h, color, width}  highlight {x,y,w,h, color}   censor {x,y,w,h, mode}
  //   text {x,y,w,h, text, size, color, bg}  step {x,y, n, size(radius), color}
  const RECT_TYPES = new Set(['rect', 'ellipse', 'highlight', 'censor']);
  const isRectLike = (a) => RECT_TYPES.has(a.type);
  const isLineLike = (a) => a.type === 'line' || a.type === 'arrow';
  const arrowHeadSize = (width) => Math.max(12, width * 4);

  // An arrow may carry a text label behind its tail (x1,y1). The label's font size follows the arrow's
  // head size, so a bigger arrow gets bigger text. `labelW`/`labelH` are the measured text size
  // (measured in draw.js); the box position is derived from the arrow, so it moves/turns with it.
  const ARROW_LABEL_RATIO = 1.5; // font size relative to the arrow head size
  const ARROW_LABEL_GAP = 12; // clear space between the tail and the label (world px)
  const arrowLabelSize = (width) => Math.round(arrowHeadSize(width) * ARROW_LABEL_RATIO);

  /** Box of an arrow's label, centred beyond the tail on the side away from the head; null if unlabelled. */
  function arrowLabelRect(a) {
    if (a.type !== 'arrow' || !a.label) return null;
    const { labelW: w, labelH: h } = a;
    const dx = a.x1 - a.x2;
    const dy = a.y1 - a.y2;
    const len = Math.hypot(dx, dy);
    const ux = len === 0 ? 0 : dx / len;
    const uy = len === 0 ? -1 : dy / len; // zero-length arrow: label goes above the point
    // The box is centred on the line extending from the tail and sits so that this line enters it
    // `gap` from the tail. Its half-extent is measured along that line (not along the whole box), so a
    // long label keeps hugging the tail at any angle instead of drifting away as it grows.
    const halfAlong = (size, u) => (u === 0 ? Infinity : size / 2 / Math.abs(u));
    const dist = a.width / 2 + ARROW_LABEL_GAP + Math.min(halfAlong(w, ux), halfAlong(h, uy));
    return { x: a.x1 + ux * dist - w / 2, y: a.y1 + uy * dist - h / 2, w, h };
  }

  const inRect = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

  function normalizeRect(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  /** Apply a point transform to every coordinate of an annotation. */
  function mapAnnotation(a, f) {
    if (a.type === 'pen') return { ...a, points: a.points.map((p) => f(p.x, p.y)) };
    if (isLineLike(a)) {
      const p1 = f(a.x1, a.y1);
      const p2 = f(a.x2, a.y2);
      return { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    if (isRectLike(a)) {
      const p1 = f(a.x, a.y);
      const p2 = f(a.x + a.w, a.y + a.h);
      return { ...a, ...normalizeRect(p1.x, p1.y, p2.x, p2.y) };
    }
    const p = f(a.x, a.y); // text, step
    return { ...a, x: p.x, y: p.y };
  }

  const translateAnnotation = (a, dx, dy) => mapAnnotation(a, (x, y) => ({ x: x + dx, y: y + dy }));

  const mapOwned = (list, ownerId, f) => list.map((a) => (a.ownerId === ownerId ? mapAnnotation(a, f) : a));
  const translateOwned = (list, ownerId, dx, dy) => mapOwned(list, ownerId, (x, y) => ({ x: x + dx, y: y + dy }));
  const scaleOwned = (list, ownerId, origin, k) => mapOwned(list, ownerId, (x, y) => ({
    x: origin.x + (x - origin.x) * k,
    y: origin.y + (y - origin.y) * k,
  }));

  /** After items were repositioned (e.g. arranged), move each annotation with its owner image. */
  function carryAnnotations(list, oldItems, newItems) {
    const before = new Map(oldItems.map((i) => [i.id, i]));
    const after = new Map(newItems.map((i) => [i.id, i]));
    return list.map((a) => {
      const o = before.get(a.ownerId);
      const n = after.get(a.ownerId);
      if (!o || !n || (n.x === o.x && n.y === o.y)) return a;
      return translateAnnotation(a, n.x - o.x, n.y - o.y);
    });
  }

  /** Id of the top-most item under a world point, or null. */
  function ownerAt(list, x, y) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (inRect({ x, y }, list[i].x, list[i].y, list[i].w, list[i].h)) return list[i].id;
    }
    return null;
  }

  function annotationBounds(a) {
    if (a.type === 'pen' || isLineLike(a)) {
      const pts = a.type === 'pen' ? a.points : [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }];
      const pad = a.type === 'arrow' ? arrowHeadSize(a.width) : a.width / 2;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      const body = { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
      const label = arrowLabelRect(a);
      return label ? boundsOf([body, label]) : body;
    }
    if (isRectLike(a)) return { x: a.x, y: a.y, w: a.w, h: a.h };
    if (a.type === 'step') return { x: a.x - a.size, y: a.y - a.size, w: a.size * 2, h: a.size * 2 };
    return { x: a.x, y: a.y, w: a.w || 0, h: a.h || 0 }; // text
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function annotationHit(a, p, tol) {
    switch (a.type) {
      case 'pen': {
        const reach = tol + a.width / 2;
        if (a.points.length === 1) return Math.hypot(p.x - a.points[0].x, p.y - a.points[0].y) <= reach;
        return a.points.some((pt, i) => i > 0
          && distToSegment(p.x, p.y, a.points[i - 1].x, a.points[i - 1].y, pt.x, pt.y) <= reach);
      }
      case 'line':
        return distToSegment(p.x, p.y, a.x1, a.y1, a.x2, a.y2) <= tol + a.width / 2;
      case 'arrow': {
        if (distToSegment(p.x, p.y, a.x1, a.y1, a.x2, a.y2) <= tol + a.width / 2) return true;
        const label = arrowLabelRect(a);
        return label !== null && inRect(p, label.x - tol, label.y - tol, label.w + 2 * tol, label.h + 2 * tol);
      }
      case 'rect': {
        const reach = tol + a.width / 2;
        const outer = inRect(p, a.x - reach, a.y - reach, a.w + 2 * reach, a.h + 2 * reach);
        const hollow = a.w > 2 * reach && a.h > 2 * reach
          && inRect(p, a.x + reach, a.y + reach, a.w - 2 * reach, a.h - 2 * reach);
        return outer && !hollow;
      }
      case 'ellipse': {
        const reach = tol + a.width / 2;
        const rx = a.w / 2;
        const ry = a.h / 2;
        if (rx < reach || ry < reach) return inRect(p, a.x - reach, a.y - reach, a.w + 2 * reach, a.h + 2 * reach);
        const r = Math.hypot((p.x - (a.x + rx)) / rx, (p.y - (a.y + ry)) / ry);
        return Math.abs(r - 1) <= reach / Math.min(rx, ry);
      }
      default: {
        const b = annotationBounds(a);
        return inRect(p, b.x - tol, b.y - tol, b.w + 2 * tol, b.h + 2 * tol);
      }
    }
  }

  /** Top-most annotation under a world point (outline-only for hollow shapes). */
  function hitAnnotation(list, p, tol) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (annotationHit(list[i], p, tol)) return list[i];
    }
    return null;
  }

  function annotationHandles(a) {
    if (isLineLike(a)) return [{ key: 'p1', x: a.x1, y: a.y1 }, { key: 'p2', x: a.x2, y: a.y2 }];
    if (isRectLike(a)) {
      return [
        { key: 'nw', x: a.x, y: a.y },
        { key: 'ne', x: a.x + a.w, y: a.y },
        { key: 'sw', x: a.x, y: a.y + a.h },
        { key: 'se', x: a.x + a.w, y: a.y + a.h },
      ];
    }
    return [];
  }

  function hitAnnotationHandle(a, p, tol) {
    const h = annotationHandles(a).find((c) => Math.hypot(p.x - c.x, p.y - c.y) <= tol);
    return h ? h.key : null;
  }

  /** Drag one handle to (x, y); the opposite corner of a rectangle stays fixed. */
  function moveHandle(a, key, x, y) {
    if (isLineLike(a)) return key === 'p1' ? { ...a, x1: x, y1: y } : { ...a, x2: x, y2: y };
    if (isRectLike(a)) {
      const ox = key === 'nw' || key === 'sw' ? a.x + a.w : a.x;
      const oy = key === 'nw' || key === 'ne' ? a.y + a.h : a.y;
      return { ...a, ...normalizeRect(ox, oy, x, y) };
    }
    return a;
  }

  /** Shift-drag helper: snap lines to 45 degree steps, rectangles/ellipses to squares. */
  function constrainEnd(type, sx, sy, ex, ey) {
    const dx = ex - sx;
    const dy = ey - sy;
    if (type === 'line' || type === 'arrow') {
      const len = Math.hypot(dx, dy);
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      return { x: sx + len * Math.cos(angle), y: sy + len * Math.sin(angle) };
    }
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: sx + Math.sign(dx || 1) * side, y: sy + Math.sign(dy || 1) * side };
  }

  /** Triangle [tip, left, right] for an arrow head at (x2, y2) pointing away from (x1, y1). */
  function arrowHeadPoints(x1, y1, x2, y2, size) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const wing = (delta) => ({
      x: x2 - size * Math.cos(angle + delta),
      y: y2 - size * Math.sin(angle + delta),
    });
    return [{ x: x2, y: y2 }, wing(-Math.PI / 6), wing(Math.PI / 6)];
  }

  const nextStepNumber = (list) => list.reduce((m, a) => (a.type === 'step' ? Math.max(m, a.n) : m), 0) + 1;

  /** Black or white, whichever is readable on top of a #rrggbb colour. */
  function contrastColor(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return luminance > 0.6 ? '#000000' : '#ffffff';
  }

  return {
    normalizeRect,
    mapAnnotation,
    translateAnnotation,
    translateOwned,
    scaleOwned,
    carryAnnotations,
    ownerAt,
    annotationBounds,
    distToSegment,
    hitAnnotation,
    annotationHandles,
    hitAnnotationHandle,
    moveHandle,
    constrainEnd,
    arrowHeadPoints,
    arrowHeadSize,
    arrowLabelSize,
    arrowLabelRect,
    nextStepNumber,
    contrastColor,
    clamp,
    boundsOf,
    nextStackY,
    stackPositions,
    arrangeVertically,
    toWorld,
    hitItem,
    hitHandle,
    resizeKeepAspect,
    snapRect,
    zoomAt,
    fitViewFor,
    revealView,
    pushHistory,
    undoHistory,
  };
});
