'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scene.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const deepFreeze = (o) => {
  Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v));
  return Object.freeze(o);
};

const line = (o = {}) => ({ id: 1, ownerId: null, type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, color: '#f00', width: 4, ...o });
const rect = (o = {}) => ({ id: 2, ownerId: null, type: 'rect', x: 10, y: 20, w: 100, h: 50, color: '#f00', width: 4, ...o });
const pen = (o = {}) => ({ id: 3, ownerId: null, type: 'pen', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], color: '#f00', width: 4, ...o });
const text = (o = {}) => ({ id: 4, ownerId: null, type: 'text', x: 5, y: 5, w: 80, h: 30, text: 'hi', size: 20, color: '#f00', bg: false, ...o });
const step = (o = {}) => ({ id: 5, ownerId: null, type: 'step', x: 100, y: 100, n: 1, size: 14, color: '#f00', ...o });

describe('intersectRect', () => {
  const box = { x: 10, y: 10, w: 100, h: 50 };
  test('clips a rect to the part that overlaps', () => {
    assert.deepEqual(S.intersectRect({ x: 0, y: 30, w: 40, h: 100 }, box), { x: 10, y: 30, w: 30, h: 30 });
  });
  test('returns null when the rects only touch or are apart', () => {
    assert.equal(S.intersectRect({ x: 110, y: 10, w: 20, h: 20 }, box), null);
    assert.equal(S.intersectRect({ x: 500, y: 500, w: 5, h: 5 }, box), null);
  });
});

describe('normalizeRect', () => {
  test('orders corners regardless of drag direction', () => {
    assert.deepEqual(S.normalizeRect(50, 60, 10, 20), { x: 10, y: 20, w: 40, h: 40 });
  });
});

describe('mapAnnotation / translate', () => {
  test('moves every kind of annotation by the same delta', () => {
    assert.deepEqual(S.translateAnnotation(line(), 5, 7), line({ x1: 5, y1: 7, x2: 105, y2: 7 }));
    assert.deepEqual(S.translateAnnotation(rect(), 5, 7), rect({ x: 15, y: 27 }));
    assert.deepEqual(S.translateAnnotation(text(), 5, 7), text({ x: 10, y: 12 }));
    assert.deepEqual(S.translateAnnotation(step(), 5, 7), step({ x: 105, y: 107 }));
    assert.deepEqual(S.translateAnnotation(pen(), 1, 1).points[2], { x: 51, y: 51 });
  });

  test('does not mutate its input', () => {
    const a = deepFreeze(rect());
    assert.doesNotThrow(() => S.translateAnnotation(a, 3, 3));
  });

  test('a flipping transform keeps rectangles normalised', () => {
    const flipped = S.mapAnnotation(rect(), (x, y) => ({ x: -x, y }));
    assert.ok(flipped.w >= 0 && flipped.h >= 0);
    assert.equal(flipped.x, -110);
  });
});

describe('owner-bound annotations', () => {
  const list = [line({ ownerId: 7 }), rect({ ownerId: 8 }), text({ ownerId: null })];

  test('translateOwned moves only that owner annotations', () => {
    const out = S.translateOwned(list, 7, 10, 20);
    assert.equal(out[0].x1, 10);
    assert.equal(out[1].x, 10);
    assert.equal(out[2].x, 5);
  });

  test('scaleOwned scales geometry around the image origin', () => {
    const out = S.scaleOwned([rect({ ownerId: 7, x: 20, y: 20, w: 40, h: 20 })], 7, { x: 10, y: 10 }, 2);
    assert.deepEqual([out[0].x, out[0].y, out[0].w, out[0].h], [30, 30, 80, 40]);
  });

  test('carryAnnotations follows the owner when images are rearranged', () => {
    const before = [{ id: 7, x: 0, y: 0, w: 10, h: 10 }, { id: 8, x: 0, y: 100, w: 10, h: 10 }];
    const after = [{ id: 7, x: 0, y: 50, w: 10, h: 10 }, { id: 8, x: 0, y: 100, w: 10, h: 10 }];
    const out = S.carryAnnotations(list, before, after);
    assert.equal(out[0].y1, 50); // owner 7 moved down by 50
    assert.equal(out[1], list[1]); // owner 8 unchanged, same reference
    assert.equal(out[2], list[2]); // no owner, untouched
  });

  test('ownerAt finds the top-most image under a point', () => {
    const items = [{ id: 1, x: 0, y: 0, w: 100, h: 100 }, { id: 2, x: 50, y: 50, w: 100, h: 100 }];
    assert.equal(S.ownerAt(items, 60, 60), 2);
    assert.equal(S.ownerAt(items, 10, 10), 1);
    assert.equal(S.ownerAt(items, 500, 500), null);
  });
});

describe('annotationBounds', () => {
  test('rectangle bounds are the rectangle', () => {
    assert.deepEqual(S.annotationBounds(rect()), { x: 10, y: 20, w: 100, h: 50 });
  });

  test('a line is padded by half its stroke width', () => {
    assert.deepEqual(S.annotationBounds(line()), { x: -2, y: -2, w: 104, h: 4 });
  });

  test('an arrow is padded enough to contain its head', () => {
    const b = S.annotationBounds(line({ type: 'arrow' }));
    assert.ok(b.x <= -S.arrowHeadSize(4) && b.h >= 2 * S.arrowHeadSize(4));
  });

  test('pen bounds cover all points', () => {
    assert.deepEqual(S.annotationBounds(pen()), { x: -2, y: -2, w: 54, h: 54 });
  });

  test('step bounds are a square around its centre', () => {
    assert.deepEqual(S.annotationBounds(step()), { x: 86, y: 86, w: 28, h: 28 });
  });

  test('text bounds use the stored size', () => {
    assert.deepEqual(S.annotationBounds(text()), { x: 5, y: 5, w: 80, h: 30 });
  });
});

describe('distToSegment', () => {
  test('perpendicular distance inside the segment', () => near(S.distToSegment(5, 3, 0, 0, 10, 0), 3));
  test('distance to the nearest end beyond the segment', () => near(S.distToSegment(13, 4, 0, 0, 10, 0), 5));
  test('degenerate segment is a point', () => near(S.distToSegment(3, 4, 0, 0, 0, 0), 5));
});

describe('hitAnnotation', () => {
  test('hits a line near it but not far away', () => {
    assert.ok(S.hitAnnotation([line()], { x: 50, y: 5 }, 4));
    assert.equal(S.hitAnnotation([line()], { x: 50, y: 30 }, 4), null);
  });

  test('a hollow rectangle is hit on its edge but not in the middle', () => {
    const r = rect({ x: 0, y: 0, w: 200, h: 100 });
    assert.ok(S.hitAnnotation([r], { x: 0, y: 50 }, 4));
    assert.equal(S.hitAnnotation([r], { x: 100, y: 50 }, 4), null);
  });

  test('a hollow ellipse is hit on its outline but not at the centre', () => {
    const e = rect({ type: 'ellipse', x: 0, y: 0, w: 200, h: 100 });
    assert.ok(S.hitAnnotation([e], { x: 200, y: 50 }, 4));
    assert.equal(S.hitAnnotation([e], { x: 100, y: 50 }, 4), null);
  });

  test('filled kinds (text, censor, highlight, step) are hit anywhere inside', () => {
    const censor = { id: 9, ownerId: null, type: 'censor', x: 0, y: 0, w: 100, h: 100, mode: 'solid' };
    assert.ok(S.hitAnnotation([censor], { x: 50, y: 50 }, 2));
    assert.ok(S.hitAnnotation([text()], { x: 40, y: 20 }, 2));
    assert.ok(S.hitAnnotation([step()], { x: 100, y: 100 }, 2));
  });

  test('pen is hit along its path, including a single-dot stroke', () => {
    assert.ok(S.hitAnnotation([pen()], { x: 25, y: 1 }, 4));
    assert.equal(S.hitAnnotation([pen()], { x: 20, y: 40 }, 4), null);
    assert.ok(S.hitAnnotation([pen({ points: [{ x: 10, y: 10 }] })], { x: 11, y: 11 }, 4));
  });

  test('the top-most (last) annotation wins', () => {
    const a = rect({ id: 1, type: 'highlight' });
    const b = rect({ id: 2, type: 'highlight' });
    assert.equal(S.hitAnnotation([a, b], { x: 50, y: 40 }, 2).id, 2);
  });
});

describe('handles', () => {
  test('lines expose two endpoints and rectangles four corners', () => {
    assert.equal(S.annotationHandles(line()).length, 2);
    assert.equal(S.annotationHandles(rect()).length, 4);
    assert.equal(S.annotationHandles(text()).length, 0);
  });

  test('hitAnnotationHandle returns the nearest handle key', () => {
    assert.equal(S.hitAnnotationHandle(line(), { x: 99, y: 1 }, 5), 'p2');
    assert.equal(S.hitAnnotationHandle(rect(), { x: 10, y: 20 }, 5), 'nw');
    assert.equal(S.hitAnnotationHandle(rect(), { x: 60, y: 45 }, 5), null);
  });

  test('moving a line end keeps the other end fixed', () => {
    const out = S.moveHandle(line(), 'p2', 30, 40);
    assert.deepEqual([out.x1, out.y1, out.x2, out.y2], [0, 0, 30, 40]);
  });

  test('dragging a rectangle corner keeps the opposite corner fixed', () => {
    const out = S.moveHandle(rect({ x: 0, y: 0, w: 100, h: 100 }), 'nw', 20, 30);
    assert.deepEqual([out.x, out.y, out.w, out.h], [20, 30, 80, 70]);
  });

  test('dragging a corner past the opposite one flips the rectangle', () => {
    const out = S.moveHandle(rect({ x: 0, y: 0, w: 100, h: 100 }), 'se', -50, -50);
    assert.deepEqual([out.x, out.y, out.w, out.h], [-50, -50, 50, 50]);
  });
});

describe('constrainEnd (shift-drag)', () => {
  test('snaps a nearly horizontal line to horizontal', () => {
    const p = S.constrainEnd('line', 0, 0, 100, 8);
    near(p.y, 0, 1e-6);
    assert.ok(p.x > 99);
  });

  test('snaps to a 45 degree diagonal', () => {
    const p = S.constrainEnd('arrow', 0, 0, 100, 90);
    near(p.x, p.y, 1e-6);
  });

  test('turns a rectangle drag into a square using the longer side', () => {
    assert.deepEqual(S.constrainEnd('rect', 10, 10, 60, 30), { x: 60, y: 60 });
    assert.deepEqual(S.constrainEnd('ellipse', 10, 10, -20, 5), { x: -20, y: -20 });
  });
});

describe('arrowHeadPoints', () => {
  test('tip is the arrow end and the wings sit behind it, symmetric around the shaft', () => {
    const [tip, left, right] = S.arrowHeadPoints(0, 0, 100, 0, 20);
    assert.deepEqual(tip, { x: 100, y: 0 });
    assert.ok(left.x < 100 && right.x < 100);
    near(left.x, right.x);
    near(left.y, -right.y);
  });

  test('zero-length arrows do not produce NaN', () => {
    const pts = S.arrowHeadPoints(5, 5, 5, 5, 10);
    assert.ok(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  });
});

describe('small helpers', () => {
  test('nextStepNumber starts at 1 and continues after the highest step', () => {
    assert.equal(S.nextStepNumber([]), 1);
    assert.equal(S.nextStepNumber([step({ n: 1 }), step({ id: 6, n: 4 }), line()]), 5);
  });

  test('contrastColor picks readable text for light and dark backgrounds', () => {
    assert.equal(S.contrastColor('#ffffff'), '#000000');
    assert.equal(S.contrastColor('#ffcc00'), '#000000');
    assert.equal(S.contrastColor('#000000'), '#ffffff');
    assert.equal(S.contrastColor('#0a84ff'), '#ffffff');
  });
});

describe('arrow labels', () => {
  const arrow = (o = {}) => line({ type: 'arrow', label: 'ดูตรงนี้ look here', labelW: 80, labelH: 30, ...o });

  test('label size follows the arrow size (head size) and never shrinks below the smallest head', () => {
    assert.equal(S.arrowLabelSize(4), Math.round(S.arrowHeadSize(4) * 1.5));
    assert.ok(S.arrowLabelSize(8) > S.arrowLabelSize(4));
    assert.ok(S.arrowLabelSize(24) > S.arrowLabelSize(8));
    assert.equal(S.arrowLabelSize(1), S.arrowLabelSize(2)); // thin arrows share the minimum head size
  });

  test('an arrow without a label has no label box', () => {
    assert.equal(S.arrowLabelRect(line({ type: 'arrow' })), null);
    assert.equal(S.arrowLabelRect(arrow({ label: '' })), null);
  });

  test('the box sits behind the tail, on the side away from the head', () => {
    const right = S.arrowLabelRect(arrow()); // tail (0,0) -> head (100,0)
    assert.ok(right.x + right.w <= 0);
    near(right.y + right.h / 2, 0);
    const down = S.arrowLabelRect(arrow({ x2: 0, y2: 100 })); // pointing down: label above the tail
    assert.ok(down.y + down.h <= 0);
    near(down.x + down.w / 2, 0);
  });

  test('the box never covers the tail, whatever the angle', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const r = S.arrowLabelRect(arrow({ x1: 50, y1: 50, x2: 50 + 100 * Math.cos(rad), y2: 50 + 100 * Math.sin(rad) }));
      const covers = 50 >= r.x && 50 <= r.x + r.w && 50 >= r.y && 50 <= r.y + r.h;
      assert.ok(!covers, `label covers the tail at ${deg} degrees`);
    }
  });

  test('the label stays close to the tail however long the text is and whatever the angle', () => {
    const distToBox = (p, r) => Math.hypot(
      Math.max(r.x - p.x, 0, p.x - (r.x + r.w)),
      Math.max(r.y - p.y, 0, p.y - (r.y + r.h)),
    );
    for (const [labelW, labelH] of [[14, 31], [200, 31], [400, 31], [400, 93], [60, 200]]) {
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = (deg * Math.PI) / 180;
        const a = arrow({
          x1: 50, y1: 50, x2: 50 + 100 * Math.cos(rad), y2: 50 + 100 * Math.sin(rad), labelW, labelH,
        });
        const d = distToBox({ x: 50, y: 50 }, S.arrowLabelRect(a));
        assert.ok(d > 0 && d <= 16, `${d.toFixed(1)}px from the tail (${labelW}x${labelH} at ${deg} degrees)`);
      }
    }
  });

  test('a zero-length arrow still gets a finite box (above the point)', () => {
    const r = S.arrowLabelRect(arrow({ x2: 0, y2: 0 }));
    assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite));
    assert.ok(r.y + r.h <= 0);
  });

  test('bounds include the label so export and selection cover it', () => {
    const plain = S.annotationBounds(arrow({ label: '' }));
    const withLabel = S.annotationBounds(arrow());
    assert.ok(withLabel.x < plain.x);
    assert.ok(withLabel.w > plain.w);
    const r = S.arrowLabelRect(arrow());
    assert.ok(withLabel.x <= r.x && withLabel.y <= r.y);
    assert.ok(withLabel.x + withLabel.w >= r.x + r.w && withLabel.y + withLabel.h >= r.y + r.h);
  });

  test('clicking the label selects the arrow, clicking empty space beside it does not', () => {
    const a = arrow();
    const r = S.arrowLabelRect(a);
    assert.equal(S.hitAnnotation([a], { x: r.x + r.w / 2, y: r.y + r.h / 2 }, 2), a);
    assert.equal(S.hitAnnotation([a], { x: r.x - 50, y: r.y - 50 }, 2), null);
  });

  test('moving an arrow moves its label and keeps the measured size', () => {
    const a = arrow();
    const moved = S.translateAnnotation(a, 30, 40);
    const r0 = S.arrowLabelRect(a);
    const r1 = S.arrowLabelRect(moved);
    near(r1.x - r0.x, 30);
    near(r1.y - r0.y, 40);
    assert.equal(moved.labelW, 80);
    assert.equal(moved.label, a.label);
  });

  test('dragging the head handle turns the label around the tail', () => {
    const a = arrow();
    const turned = S.moveHandle(a, 'p2', 0, 100);
    assert.ok(S.arrowLabelRect(turned).y + 30 <= 0);
  });
});
