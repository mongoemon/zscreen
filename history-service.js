'use strict';

// Electron main process: watches the clipboard for images and keeps the last few in memory. The
// editor window shows them in a side panel (history-panel.js); everything crosses IPC because only
// this process can read the clipboard when the app is not focused.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, clipboard, ipcMain } = require('electron');
const History = require('./clipboard-history.js');

const POLL_MS = 1000;
const THUMB_WIDTH = 240;
const CH = Object.freeze({
  state: 'history:state',
  changed: 'history:changed',
  visible: 'history:visible',
  setVisible: 'history:set-visible',
  use: 'history:use',
  remove: 'history:remove',
  clear: 'history:clear',
});

const SETTINGS_FILE = 'history-settings.json'; // {"show": boolean} in the user data folder

/**
 * @param {{
 *   getWebContents: () => (import('electron').WebContents | null),
 *   onUse: (png: Buffer) => void,
 *   onVisibleChange?: (visible: boolean) => void,
 * }} options getWebContents returns the editor window's page (null while there is none)
 */
function createHistoryService({ getWebContents, onUse, onVisibleChange = () => {} }) {
  /** @type {import('./clipboard-history.js').Entry[]} */
  let entries = [];
  let nextId = 1;
  let lastHash = null; // hash of the image currently on the clipboard, so a poll doesn't re-add it
  let timer = null;
  let visible = true; // the panel is shown by default

  const settingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILE);

  /** Shown by default; only an explicit "off" is remembered. */
  function loadVisibleSetting() {
    try {
      return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).show !== false;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('clipboard history: could not read the settings', err);
      return true;
    }
  }

  function saveVisibleSetting() {
    try {
      fs.writeFileSync(settingsPath(), JSON.stringify({ show: visible }));
    } catch (err) {
      console.warn('clipboard history: could not save the settings', err);
    }
  }

  const listItems = () => entries.map(History.toListItem);
  const isFromEditor = (event) => {
    const target = getWebContents();
    return target !== null && event.sender === target;
  };
  const pushToEditor = (channel, payload) => {
    const target = getWebContents();
    if (target) target.send(channel, payload);
  };

  function setEntries(next) {
    entries = next;
    pushToEditor(CH.changed, listItems());
  }

  function setVisible(next) {
    if (next === visible) return;
    visible = next;
    saveVisibleSetting();
    pushToEditor(CH.visible, visible);
    onVisibleChange(visible);
  }

  function capture() {
    if (!clipboard.availableFormats().some((f) => f.startsWith('image/'))) {
      lastHash = null;
      return;
    }
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      lastHash = null;
      return;
    }
    const hash = crypto.createHash('sha1').update(image.toBitmap()).digest('hex');
    if (hash === lastHash) return;
    lastHash = hash;
    const { width, height } = image.getSize();
    const thumb = image.resize({ width: Math.min(THUMB_WIDTH, width) }).toDataURL();
    setEntries(History.addEntry(entries, {
      id: nextId++, hash, png: image.toPNG(), thumb, width, height, time: Date.now(),
    }));
  }

  function poll() {
    try {
      capture();
    } catch (err) { // the clipboard can be locked by another app for a moment; try again next tick
      console.warn('clipboard history: could not read the clipboard', err);
    }
  }

  function start() {
    visible = loadVisibleSetting();
    ipcMain.handle(CH.state, (event) => (isFromEditor(event) ? { visible, items: listItems() } : null));
    ipcMain.on(CH.setVisible, (event, next) => {
      if (isFromEditor(event) && typeof next === 'boolean') setVisible(next);
    });
    ipcMain.on(CH.use, (event, id) => {
      if (!isFromEditor(event) || !Number.isInteger(id)) return;
      const entry = History.findEntry(entries, id);
      if (entry) onUse(entry.png);
    });
    ipcMain.on(CH.remove, (event, id) => {
      if (isFromEditor(event) && Number.isInteger(id)) setEntries(History.removeEntry(entries, id));
    });
    ipcMain.on(CH.clear, (event) => {
      if (isFromEditor(event)) setEntries([]);
    });
    poll(); // whatever is already on the clipboard counts as the first entry
    timer = setInterval(poll, POLL_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return {
    start, stop, toggle: () => setVisible(!visible), isVisible: () => visible,
  };
}

module.exports = { createHistoryService };
