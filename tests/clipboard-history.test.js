'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const History = require('../clipboard-history.js');

const entry = (id, hash = `h${id}`) => ({
  id, hash, png: Buffer.from([id]), thumb: `data:${id}`, width: 10, height: 20, time: id,
});

test('the history keeps 10 images', () => assert.equal(History.HISTORY_LIMIT, 10));

test('addEntry puts the newest first and does not touch the input', () => {
  const before = Object.freeze([entry(1)]);
  const after = History.addEntry(before, entry(2));
  assert.deepEqual(after.map((e) => e.id), [2, 1]);
  assert.deepEqual(before.map((e) => e.id), [1]);
});

test('addEntry drops the oldest entry beyond the limit', () => {
  let entries = [];
  for (let id = 1; id <= 12; id++) entries = History.addEntry(entries, entry(id));
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.map((e) => e.id), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
});

test('addEntry replaces an older entry with the same image hash and moves it to the front', () => {
  const entries = [entry(2), entry(1, 'same')];
  const after = History.addEntry(entries, entry(3, 'same'));
  assert.deepEqual(after.map((e) => e.id), [3, 2]);
});

test('removeEntry and findEntry work by id', () => {
  const entries = [entry(3), entry(2), entry(1)];
  assert.deepEqual(History.removeEntry(entries, 2).map((e) => e.id), [3, 1]);
  assert.equal(History.removeEntry(entries, 99).length, 3);
  assert.equal(History.findEntry(entries, 2).id, 2);
  assert.equal(History.findEntry(entries, 99), null);
});

test('toListItem leaves out the full-size PNG and the hash', () => {
  const item = History.toListItem(entry(1));
  assert.deepEqual(Object.keys(item).sort(), ['height', 'id', 'thumb', 'time', 'width']);
});
