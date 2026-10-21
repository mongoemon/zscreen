'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scene.js');

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v));
  return Object.freeze(o);
};
const item = (id, x, y, w, h) => ({ id, x, y, w, h });
const VIEW = { x: 0, y: 0, scale: 1 };

describe('clamp', () => {
  test('returns the value when inside the range', () => assert.equal(S.clamp(5, 0, 10), 5));
  test('limits to the lower bound', () => assert.equal(S.clamp(-3, 0, 10), 0));
  test('limits to the upper bound', () => assert.equal(S.clamp(99, 0, 10), 10));
});

describe('boundsOf', () => {
  test('returns null for an empty scene', () => assert.equal(S.boundsOf([]), null));

  test('covers every item', () => {
    const b = S.boundsOf([item(1, 0, 0, 100, 50), item(2, 40, 200, 100, 80)]);
    assert.deepEqual(b, { x: 0, y: 0, w: 140, h: 280 });
  });

  test('handles negative coordinates', () => {
    const b = S.boundsOf([item(1, -20, -10, 30, 30)]);
    assert.deepEqual(b, { x: -20, y: -10, w: 30, h: 30 });
  });
});

describe('stacking new images', () => {
  test('first image goes to the origin', () => {
    assert.equal(S.nextStackY([], 16), 0);
  });

  test('next image goes below the lowest item plus the gap', () => {
    const scene = [item(1, 0, 0, 100, 100), item(2, 300, 50, 100, 200)];
    assert.equal(S.nextStackY(scene, 16), 266);
  });

  test('multiple dropped files stack in order with gaps, all at x = 0', () => {
    const placed = S.stackPositions([], [{ w: 100, h: 50 }, { w: 80, h: 30 }, { w: 60, h: 20 }], 10);
    assert.deepEqual(placed, [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 60, w: 80, h: 30 },
      { x: 0, y: 100, w: 60, h: 20 },
    ]);
  });

  test('a later batch continues below the existing stack', () => {
    const placed = S.stackPositions([item(1, 0, 0, 100, 50)], [{ w: 10, h: 10 }], 16);
    assert.equal(placed[0].y, 66);
  });

  test('no sizes yields no positions', () => {
    assert.deepEqual(S.stackPositions([item(1, 0, 0, 10, 10)], [], 16), []);
  });
});

describe('arrangeVertically', () => {
  test('stacks items by their current top-to-bottom order at x = 0', () => {
    const scene = deepFreeze([item(1, 500, 300, 100, 40), item(2, 20, 0, 80, 30), item(3, 0, 100, 60, 20)]);
    const arranged = S.arrangeVertically(scene, 10);
    const byId = Object.fromEntries(arranged.map((i) => [i.id, i]));
    assert.equal(byId[2].y, 0);
    assert.equal(byId[3].y, 40);
    assert.equal(byId[1].y, 70);
    assert.ok(arranged.every((i) => i.x === 0));
  });

  test('keeps the array (z) order and does not mutate the input', () => {
    const scene = deepFreeze([item(1, 0, 90, 10, 10), item(2, 0, 0, 10, 10)]);
    const arranged = S.arrangeVertically(scene, 5);
    assert.deepEqual(arranged.map((i) => i.id), [1, 2]);
    assert.equal(scene[0].y, 90);
  });

  test('breaks vertical ties by x', () => {
    const arranged = S.arrangeVertically([item(1, 200, 0, 10, 10), item(2, 0, 0, 10, 10)], 0);
    assert.equal(arranged.find((i) => i.id === 2).y, 0);
    assert.equal(arranged.find((i) => i.id === 1).y, 10);
  });

  test('empty scene stays empty', () => assert.deepEqual(S.arrangeVertically([], 16), []));
});

describe('hit testing', () => {
  const scene = [item(1, 0, 0, 100, 100), item(2, 50, 50, 100, 100)];

  test('picks the top-most item where items overlap', () => {
    assert.equal(S.hitItem(scene, VIEW, 60, 60).id, 2);
  });

  test('picks the lower item outside the overlap', () => {
    assert.equal(S.hitItem(scene, VIEW, 10, 10).id, 1);
  });

  test('returns null on empty space', () => {
    assert.equal(S.hitItem(scene, VIEW, 400, 400), null);
  });

  test('accounts for pan and zoom', () => {
    const view = { x: 100, y: 100, scale: 2 };
    assert.equal(S.hitItem([item(1, 0, 0, 50, 50)], view, 150, 150).id, 1);
    assert.equal(S.hitItem([item(1, 0, 0, 50, 50)], view, 90, 90), null);
  });

  test('detects the resize handle at the bottom-right corner only', () => {
    const it = item(1, 0, 0, 100, 100);
    assert.equal(S.hitHandle(it, VIEW, 100, 100, 10), true);
    assert.equal(S.hitHandle(it, VIEW, 105, 95, 10), true);
    assert.equal(S.hitHandle(it, VIEW, 0, 0, 10), false);
    assert.equal(S.hitHandle(null, VIEW, 100, 100, 10), false);
  });
});

describe('resizeKeepAspect', () => {
  test('keeps the aspect ratio', () => {
    assert.deepEqual(S.resizeKeepAspect(200, 100, 100, 24), { w: 300, h: 150 });
  });

  test('never shrinks below the minimum width', () => {
    assert.deepEqual(S.resizeKeepAspect(200, 100, -500, 24), { w: 24, h: 12 });
  });
});

describe('snapRect', () => {
  const other = item(1, 0, 0, 200, 100);

  test('snaps the left edge to a neighbour left edge within the threshold', () => {
    const r = S.snapRect(item(2, 5, 300, 80, 50), [other], 8, 16);
    assert.equal(r.dx, -5);
    assert.equal(r.guides.find((g) => g.axis === 'x').pos, 0);
  });

  test('snaps to the stacking gap below a neighbour', () => {
    const r = S.snapRect(item(2, 0, 120, 200, 50), [other], 8, 16);
    assert.equal(r.dy, -4); // 100 + 16 = 116
  });

  test('snaps centres together', () => {
    const r = S.snapRect(item(2, 63, 300, 80, 50), [other], 8, 16); // centre 103 vs 100
    assert.equal(r.dx, -3);
  });

  test('does nothing when everything is farther than the threshold', () => {
    const r = S.snapRect(item(2, 50, 300, 80, 50), [other], 8, 16);
    assert.deepEqual(r, { dx: 0, dy: 0, guides: [] });
  });

  test('does not mutate its inputs', () => {
    const rect = deepFreeze(item(2, 5, 300, 80, 50));
    S.snapRect(rect, deepFreeze([other]), 8, 16);
  });
});

describe('zoomAt', () => {
  test('keeps the point under the cursor fixed', () => {
    const view = { x: 30, y: 20, scale: 1 };
    const before = S.toWorld(view, 200, 150);
    const after = S.toWorld(S.zoomAt(view, 200, 150, 2, 0.05, 8), 200, 150);
    assert.ok(Math.abs(before.x - after.x) < 1e-9);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
  });

  test('clamps to the maximum and minimum scale', () => {
    assert.equal(S.zoomAt(VIEW, 0, 0, 100, 0.05, 8).scale, 8);
    assert.equal(S.zoomAt(VIEW, 0, 0, 0.0001, 0.05, 8).scale, 0.05);
  });

  test('does not mutate the input view', () => {
    const view = deepFreeze({ x: 1, y: 2, scale: 1 });
    assert.doesNotThrow(() => S.zoomAt(view, 5, 5, 2, 0.05, 8));
  });
});

describe('fitViewFor', () => {
  const viewport = { width: 800, height: 600 };

  test('returns the default view for an empty scene', () => {
    assert.deepEqual(S.fitViewFor([], viewport, 40, 0.05, 8), { x: 40, y: 40, scale: 1 });
  });

  test('does not zoom in past 100% for small content', () => {
    const view = S.fitViewFor([item(1, 0, 0, 100, 100)], viewport, 40, 0.05, 8);
    assert.equal(view.scale, 1);
  });

  test('shrinks tall content to fit the viewport height', () => {
    const view = S.fitViewFor([item(1, 0, 0, 400, 2000)], viewport, 40, 0.05, 8);
    assert.ok(Math.abs(view.scale - (600 - 80) / 2000) < 1e-9);
  });

  test('centres content horizontally', () => {
    const view = S.fitViewFor([item(1, 0, 0, 400, 100)], viewport, 40, 0.05, 8);
    assert.equal(view.x, (800 - 400) / 2);
  });

  test('respects the minimum scale for huge content', () => {
    const view = S.fitViewFor([item(1, 0, 0, 100, 1000000)], viewport, 40, 0.05, 8);
    assert.equal(view.scale, 0.05);
  });
});

describe('revealView', () => {
  test('leaves the view alone when the item is fully visible', () => {
    const view = { x: 0, y: 0, scale: 1 };
    assert.equal(S.revealView(view, item(1, 0, 100, 100, 100), 600, 40), view);
  });

  test('scrolls an item below the fold up to the margin', () => {
    const view = S.revealView(VIEW, item(1, 0, 900, 100, 100), 600, 40);
    assert.equal(view.y, 40 - 900);
  });

  test('scrolls an item above the top into view', () => {
    const view = S.revealView({ x: 0, y: -500, scale: 1 }, item(1, 0, 0, 100, 100), 600, 40);
    assert.equal(view.y, 40);
  });
});

describe('history', () => {
  test('push appends a snapshot without mutating the old history', () => {
    const history = deepFreeze([[1]]);
    assert.deepEqual(S.pushHistory(history, [2], 50), [[1], [2]]);
  });

  test('push drops the oldest entries beyond the limit', () => {
    let history = [];
    for (let i = 0; i < 5; i++) history = S.pushHistory(history, [i], 3);
    assert.deepEqual(history, [[2], [3], [4]]);
  });

  test('undo returns the latest snapshot and the remaining history', () => {
    const result = S.undoHistory([[1], [2]]);
    assert.deepEqual(result, { snapshot: [2], history: [[1]] });
  });

  test('undo on an empty history returns null', () => {
    assert.equal(S.undoHistory([]), null);
  });
});
