'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Snippets = require('../text-snippets.js');

const snip = (id, text = `text ${id}`) => ({ id, text, time: id });
const add = (list, text, id = Snippets.nextId(list)) => Snippets.addSnippet(list, text, { id, time: 100 + id });

test('the text clipboard keeps up to 10 texts', () => assert.equal(Snippets.SNIPPET_LIMIT, 10));

test('addSnippet puts the newest first, trims it and does not touch the input', () => {
  const before = Object.freeze([snip(1)]);
  const { snippets, status } = add(before, '  hello\n');
  assert.equal(status, 'added');
  assert.deepEqual(snippets.map((s) => s.text), ['hello', 'text 1']);
  assert.deepEqual(before.map((s) => s.id), [1]);
});

test('addSnippet refuses empty and whitespace-only text', () => {
  const list = [snip(1)];
  for (const text of ['', '   ', '\n\t', null, undefined]) {
    const result = add(list, text);
    assert.equal(result.status, 'empty');
    assert.equal(result.snippets, list);
  }
});

test('addSnippet refuses text over the size limit', () => {
  const result = add([], 'x'.repeat(Snippets.MAX_CHARS + 1));
  assert.equal(result.status, 'tooLong');
  assert.deepEqual(result.snippets, []);
  assert.equal(add([], 'x'.repeat(Snippets.MAX_CHARS)).status, 'added');
});

test('addSnippet refuses an 11th text instead of dropping an old one', () => {
  let list = [];
  for (let i = 1; i <= 10; i++) list = add(list, `t${i}`).snippets;
  assert.equal(list.length, 10);
  const result = add(list, 'one more');
  assert.equal(result.status, 'full');
  assert.equal(result.snippets, list);
});

test('saving the same text again moves it to the front, even when the list is full', () => {
  let list = [];
  for (let i = 1; i <= 10; i++) list = add(list, `t${i}`).snippets;
  const result = add(list, ' t3 ');
  assert.equal(result.status, 'moved');
  assert.equal(result.snippets.length, 10);
  assert.equal(result.snippets[0].text, 't3');
  assert.equal(result.snippets[0].id, 3, 'keeps its id');
  assert.equal(result.snippets.filter((s) => s.text === 't3').length, 1);
});

test('removeSnippet and findSnippet work by id', () => {
  const list = [snip(2), snip(1)];
  assert.deepEqual(Snippets.removeSnippet(list, 2).map((s) => s.id), [1]);
  assert.deepEqual(Snippets.removeSnippet(list, 9), list);
  assert.equal(Snippets.findSnippet(list, 1).text, 'text 1');
  assert.equal(Snippets.findSnippet(list, 9), null);
});

test('nextId is one above the highest id', () => {
  assert.equal(Snippets.nextId([]), 1);
  assert.equal(Snippets.nextId([snip(3), snip(7)]), 8);
});

test('parseSnippets reads a saved list back', () => {
  const list = [snip(2, 'b'), snip(1, 'a')];
  assert.deepEqual(Snippets.parseSnippets(JSON.stringify(list)), list);
});

test('parseSnippets ignores missing, broken or tampered data', () => {
  for (const raw of [null, '', 'not json', '{}', '"text"', '42']) assert.deepEqual(Snippets.parseSnippets(raw), []);
  const raw = JSON.stringify([
    snip(1), null, { id: 'x', text: 'a', time: 1 }, { id: 2, text: 5, time: 1 }, { id: 3, text: '  ', time: 1 },
    { id: 4, text: 'ok', time: 'soon' }, snip(1, 'duplicate id'), snip(5),
  ]);
  assert.deepEqual(Snippets.parseSnippets(raw).map((s) => s.id), [1, 5]);
});

test('parseSnippets keeps at most the limit', () => {
  const many = Array.from({ length: 15 }, (_, i) => snip(i + 1));
  assert.equal(Snippets.parseSnippets(JSON.stringify(many)).length, 10);
});
