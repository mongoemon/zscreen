'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shortcuts.js');
const I18n = require('../i18n.js');

const press = (key, mods = {}, code = '') => ({
  key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods,
});

test('normalize puts modifiers in a fixed order and lowercases the key', () => {
  assert.equal(S.normalize('shift+mod+V'), 'Mod+Shift+v');
  assert.equal(S.normalize('Alt+Mod+R'), 'Mod+Alt+r');
  assert.equal(S.normalize('Space'), 'space');
  assert.equal(S.normalize('ArrowLeft'), 'arrowleft');
  assert.equal(S.normalize('Mod+plus'), 'Mod+plus');
  assert.equal(S.normalize(''), null);
  assert.equal(S.normalize('Mod+Mod+V'), null);
  assert.equal(S.normalize('Hyper+V'), null);
  assert.equal(S.normalize('Mod+Shift'), null);
});

test('fromEvent reads Cmd on macOS and Ctrl elsewhere', () => {
  assert.equal(S.fromEvent(press('z', { metaKey: true }), true), 'Mod+z');
  assert.equal(S.fromEvent(press('z', { ctrlKey: true }), false), 'Mod+z');
  assert.equal(S.fromEvent(press('z', { ctrlKey: true }), true), 'Ctrl+z'); // the Control key on a Mac
  assert.equal(S.fromEvent(press('Z', { ctrlKey: true, shiftKey: true }), false), 'Mod+Shift+z');
  assert.equal(S.fromEvent(press(' '), false), 'space');
  assert.equal(S.fromEvent(press('+', { ctrlKey: true, shiftKey: true }), false), 'Mod+Shift+plus');
  assert.equal(S.fromEvent(press('Shift', { shiftKey: true }), false), null);
  assert.equal(S.fromEvent(press('Dead', {}, 'Quote'), false), null);
});

test('fromEvent uses the physical key on non-Latin layouts and for Option combinations', () => {
  assert.equal(S.fromEvent(press('ผ', { ctrlKey: true }, 'KeyZ'), false), 'Mod+z'); // Thai layout
  assert.equal(S.fromEvent(press('®', { metaKey: true, altKey: true }, 'KeyR'), true), 'Mod+Alt+r'); // macOS Option
  assert.equal(S.fromEvent(press('ม', { metaKey: true }, 'Comma'), true), 'Mod+,');
});

test('matches compares a press with a binding', () => {
  assert.ok(S.matches('Mod+Shift+V', press('V', { ctrlKey: true, shiftKey: true }), false));
  assert.ok(!S.matches('Mod+V', press('V', { ctrlKey: true, shiftKey: true }), false));
  assert.ok(S.matches('Delete', press('Delete'), false));
  assert.ok(!S.matches('nonsense+x', press('x'), false));
});

test('format shows platform names', () => {
  assert.equal(S.format('Mod+Alt+r', true), 'Cmd+Option+R');
  assert.equal(S.format('Mod+Alt+r', false), 'Ctrl+Alt+R');
  assert.equal(S.format('arrowleft', false), '←');
  assert.equal(S.format('Mod+plus', false), 'Ctrl++');
  assert.equal(S.format('space', true), 'Space');
  assert.equal(S.format('bad+x', true), '');
});

test('toAccelerator produces Electron accelerators', () => {
  assert.equal(S.toAccelerator('Mod+Shift+v'), 'CommandOrControl+Shift+V');
  assert.equal(S.toAccelerator('Mod+Alt+r'), 'CommandOrControl+Alt+R');
  assert.equal(S.toAccelerator('Ctrl+Alt+f5'), 'Control+Alt+F5');
  assert.equal(S.toAccelerator('Mod+arrowleft'), 'CommandOrControl+Left');
  assert.equal(S.toAccelerator('Mod+plus'), 'CommandOrControl+Plus');
  assert.equal(S.toAccelerator('Mod+,'), 'CommandOrControl+,');
  assert.equal(S.toAccelerator('Mod+ß'), null);
});

test('every default is valid and no two defaults clash', () => {
  const bindings = S.defaults();
  for (const a of S.ACTIONS) {
    assert.ok(S.GROUPS.includes(a.group), `${a.id} has an unknown group`);
    for (const b of a.defaults) {
      assert.ok(S.normalize(b), `${a.id}: ${b} is invalid`);
      assert.equal(S.check(a.id, b, bindings), null, `${a.id}: ${b} clashes`);
      if (a.scope === 'global') assert.ok(S.toAccelerator(b), `${a.id}: ${b} cannot be a global shortcut`);
    }
  }
});

test('every action has a label in every language', () => {
  for (const a of S.ACTIONS) {
    for (const { code } of I18n.LOCALES) assert.ok(a.label in I18n.MESSAGES[code], `${code} has no ${a.label}`);
  }
});

test('check reports clashes within a scope, with global shortcuts, and reserved keys', () => {
  const bindings = S.defaults();
  assert.deepEqual(S.check('toolPen', 'L', bindings), { reason: 'conflict', other: 'toolLine' });
  assert.equal(S.check('videoSave', 'Mod+S', bindings), null); // same key as Save PNG, other editor
  assert.equal(S.check('videoAddFrame', 'P', bindings), null);
  assert.deepEqual(S.check('undo', 'Mod+Alt+R', bindings), { reason: 'conflict', other: 'record' });
  assert.deepEqual(S.check('record', 'Mod+Z', bindings), { reason: 'conflict', other: 'undo' });
  assert.deepEqual(S.check('undo', 'Mod+V', bindings), { reason: 'reserved' });
  assert.deepEqual(S.check('record', 'Mod+V', bindings), { reason: 'reserved' });
  assert.deepEqual(S.check('videoPlay', 'Escape', bindings), { reason: 'reserved' });
  assert.deepEqual(S.check('record', 'R', bindings), { reason: 'needsModifier' });
  assert.deepEqual(S.check('record', 'Mod+ß', bindings), { reason: 'unsupported' });
  assert.deepEqual(S.check('undo', 'Mod+Mod+z', bindings), { reason: 'invalid' });
});

test('in the browser, desktop-only actions are ignored and the record key is a normal key', () => {
  const bindings = S.defaults();
  assert.equal(S.check('undo', 'Mod+Shift+V', bindings, { desktop: false }), null);
  assert.deepEqual(S.check('undo', 'Mod+Shift+V', bindings), { reason: 'conflict', other: 'globalPaste' });
  assert.equal(S.check('record', 'Mod+ß', bindings, { desktop: false }), null);
});

test('resolve applies overrides and ignores junk; diff keeps only changes', () => {
  const resolved = S.resolve({
    undo: ['mod+y'], arrange: ['Mod+Alt+A'], toolPen: [], bogus: ['X'], copy: 'Mod+C', fit: ['bad+key', 'Mod+9'],
  });
  assert.deepEqual(resolved.undo, ['Mod+y']);
  assert.deepEqual(resolved.arrange, ['Mod+Alt+a']);
  assert.deepEqual(resolved.toolPen, []);
  assert.deepEqual(resolved.copy, ['Mod+c']);
  assert.deepEqual(resolved.fit, ['Mod+9']);
  assert.ok(!('bogus' in resolved));
  assert.deepEqual(S.diff(resolved), {
    undo: ['Mod+y'], arrange: ['Mod+Alt+a'], toolPen: [], fit: ['Mod+9'],
  });
  assert.deepEqual(S.diff(S.defaults()), {});
  assert.deepEqual(S.resolve(null), S.defaults());
});
