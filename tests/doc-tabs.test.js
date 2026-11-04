'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../doc-tabs.js');

const tabs = (...ids) => ids.map((id) => ({ id }));
const ids = (list) => list.map((t) => t.id);

test('insertAfter puts a new tab right after the given one, or at the end', () => {
  assert.deepEqual(ids(T.insertAfter(tabs(1, 2, 3), 1, { id: 9 })), [1, 9, 2, 3]);
  assert.deepEqual(ids(T.insertAfter(tabs(1, 2, 3), 3, { id: 9 })), [1, 2, 3, 9]);
  assert.deepEqual(ids(T.insertAfter(tabs(1, 2), null, { id: 9 })), [1, 2, 9]);
  assert.deepEqual(ids(T.insertAfter([], null, { id: 9 })), [9]);
});

test('insertAfter does not change its input', () => {
  const list = tabs(1, 2);
  T.insertAfter(list, 1, { id: 9 });
  assert.deepEqual(ids(list), [1, 2]);
});

test('activeAfterClose keeps the active tab unless it is the one closing', () => {
  assert.equal(T.activeAfterClose(tabs(1, 2, 3), 3, 1), 1);
});

test('activeAfterClose moves to the right neighbour, else the left one, else none', () => {
  assert.equal(T.activeAfterClose(tabs(1, 2, 3), 2, 2), 3);
  assert.equal(T.activeAfterClose(tabs(1, 2, 3), 3, 3), 2);
  assert.equal(T.activeAfterClose(tabs(1, 2, 3), 1, 1), 2);
  assert.equal(T.activeAfterClose(tabs(1), 1, 1), null);
});

test('cycle steps through the tabs and wraps around both ends', () => {
  const list = tabs(1, 2, 3);
  assert.equal(T.cycle(list, 1, 1), 2);
  assert.equal(T.cycle(list, 3, 1), 1);
  assert.equal(T.cycle(list, 1, -1), 3);
  assert.equal(T.cycle(tabs(7), 7, 1), 7);
  assert.equal(T.cycle([], null, 1), null);
});

test('move puts a dragged tab in the place of the tab it is dropped on', () => {
  assert.deepEqual(ids(T.move(tabs(1, 2, 3, 4), 1, 3)), [2, 3, 1, 4]);
  assert.deepEqual(ids(T.move(tabs(1, 2, 3, 4), 4, 2)), [1, 4, 2, 3]);
  assert.deepEqual(ids(T.move(tabs(1, 2, 3), 2, 2)), [1, 2, 3]);
  assert.deepEqual(ids(T.move(tabs(1, 2, 3), 9, 2)), [1, 2, 3]);
});

test('cleanTitle makes one trimmed line of at most TITLE_MAX characters', () => {
  assert.equal(T.cleanTitle('  Bug   report\n2 '), 'Bug report 2');
  assert.equal(T.cleanTitle(''), '');
  assert.equal(T.cleanTitle(null), '');
  assert.equal(T.cleanTitle('x'.repeat(100)).length, T.TITLE_MAX);
  assert.equal([...T.cleanTitle('😀'.repeat(50))].length, T.TITLE_MAX); // counts characters, not UTF-16 units
});

test('fileSafeName drops path and reserved characters', () => {
  assert.equal(T.fileSafeName('a/b\\c:d*e?"f<g>h|i'), 'abcdefghi');
  assert.equal(T.fileSafeName('..hidden.'), 'hidden');
  assert.equal(T.fileSafeName('หน้าแรก v2'), 'หน้าแรก v2');
  assert.equal(T.fileSafeName('///'), '');
});
