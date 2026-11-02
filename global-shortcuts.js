'use strict';

// Electron main process: system-wide shortcuts (they work while another app is in front).
// Their bindings live here, in shortcuts.json in the user data folder, because they must be
// registered at startup before any window exists. The editor's settings dialog reads and changes
// them over IPC; every other shortcut is handled inside the page (shortcut-settings.js).
const fs = require('fs');
const path = require('path');
const { app, globalShortcut, ipcMain } = require('electron');
const Shortcuts = require('./shortcuts.js');

// {"<action id>": ["Mod+Shift+v", ...]} for the global actions that differ from their defaults
const SETTINGS_FILE = 'shortcuts.json';
const GLOBAL_IDS = Object.freeze(Shortcuts.ACTIONS.filter((a) => a.scope === 'global').map((a) => a.id));
const CH = Object.freeze({ get: 'shortcuts:get', set: 'shortcuts:set' });
const isMac = process.platform === 'darwin';

/**
 * @param {{
 *   handlers: Record<string, () => void>,
 *   getWebContents: () => (import('electron').WebContents | null),
 *   onChange?: () => void,
 * }} options handlers: action id -> what the shortcut does; onChange: bindings changed (e.g. redo the tray)
 */
function createGlobalShortcuts({ handlers, getWebContents, onChange = () => {} }) {
  /** @type {Record<string, string[]>} */
  let bindings = {};
  /** @type {Record<string, string[]>} accelerators currently registered, per action */
  let registered = {};
  /** action ids whose shortcut another app already owns */
  let failed = [];

  const settingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILE);
  const onlyGlobal = (all) => Object.fromEntries(GLOBAL_IDS.map((id) => [id, all[id] || []]));

  function load() {
    try {
      return onlyGlobal(Shortcuts.resolve(JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('shortcuts: could not read the settings', err);
      return onlyGlobal(Shortcuts.defaults());
    }
  }

  function save() {
    try {
      fs.writeFileSync(settingsPath(), JSON.stringify(Shortcuts.diff({ ...Shortcuts.defaults(), ...bindings })));
    } catch (err) {
      console.warn('shortcuts: could not save the settings', err);
    }
  }

  function unregister(id) {
    (registered[id] || []).forEach((acc) => globalShortcut.unregister(acc));
    registered = { ...registered, [id]: [] };
  }

  /** @returns {boolean} false when any of the keys is taken by another app (the rest stay registered) */
  function register(id, list) {
    const done = [];
    let ok = true;
    for (const binding of list) {
      const acc = Shortcuts.toAccelerator(binding);
      if (acc && globalShortcut.register(acc, handlers[id])) done.push(acc);
      else ok = false;
    }
    registered = { ...registered, [id]: done };
    return ok;
  }

  function registerAll() {
    failed = GLOBAL_IDS.filter((id) => {
      unregister(id);
      if (register(id, bindings[id])) return false;
      console.warn(`shortcuts: ${bindings[id].join(', ')} for ${id} is already taken`);
      return true;
    });
  }

  const state = () => ({ bindings, failed });

  /**
   * Only checks the key itself and the other global shortcuts: the editor knows the in-page keys
   * (including the user's changes) and checks against those before asking.
   * @returns {{ok:true, bindings:Record<string,string[]>, failed:string[]} | {ok:false, reason:string, other?:string}}
   */
  function change(id, list) {
    if (!GLOBAL_IDS.includes(id) || !Array.isArray(list)) return { ok: false, reason: 'invalid' };
    const next = list.map(Shortcuts.normalize);
    if (next.some((b) => !b)) return { ok: false, reason: 'invalid' };
    const otherGlobals = Object.fromEntries(Shortcuts.ACTIONS.map((a) => [
      a.id, a.id !== id && GLOBAL_IDS.includes(a.id) ? bindings[a.id] : [],
    ]));
    for (const binding of next) {
      const problem = Shortcuts.check(id, binding, otherGlobals);
      if (problem) return { ok: false, ...problem };
    }
    const previous = bindings[id];
    unregister(id);
    if (!register(id, next)) { // another app owns it: put the old keys back
      unregister(id);
      register(id, previous);
      return { ok: false, reason: 'taken' };
    }
    bindings = { ...bindings, [id]: next };
    failed = failed.filter((f) => f !== id);
    save();
    onChange();
    return { ok: true, ...state() };
  }

  const isFromEditor = (event) => {
    const target = getWebContents();
    return target !== null && event.sender === target;
  };

  function start() {
    bindings = load();
    registerAll();
    ipcMain.handle(CH.get, (event) => (isFromEditor(event) ? state() : null));
    ipcMain.handle(CH.set, (event, id, list) => (isFromEditor(event) ? change(id, list) : { ok: false, reason: 'invalid' }));
  }

  /** First accelerator of an action (for the tray menu), or undefined when it has none. */
  const accelerator = (id) => (bindings[id] && bindings[id][0] ? Shortcuts.toAccelerator(bindings[id][0]) : undefined);

  /** "Cmd+Shift+V" style label of an action's first key, '' when it has none. */
  const label = (id) => (bindings[id] && bindings[id][0] ? Shortcuts.format(bindings[id][0], isMac) : '');

  return { start, accelerator, label };
}

module.exports = { createGlobalShortcuts };
