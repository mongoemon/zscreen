'use strict';

// Browser stand-in for the desktop clipboard history. A web page cannot watch the clipboard, so this
// keeps the images that were pasted, dropped or picked in this tab (newest first, in memory only).
// It offers the same bridge the Electron preload gives history-panel.js.
(() => {
  if (window.zcreenshot) return; // the desktop app records the real clipboard instead

  const { addEntry, removeEntry, findEntry, toListItem } = ClipboardHistory;
  const THUMB_WIDTH = 240;
  const VISIBLE_KEY = 'zcreenshot-history-visible';

  const changedListeners = [];
  const visibleListeners = [];
  let entries = [];
  let nextId = 1;
  let visible = loadVisible();

  /** Shown by default; only an explicit "off" is remembered. */
  function loadVisible() {
    try {
      return localStorage.getItem(VISIBLE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  function saveVisible() {
    try {
      localStorage.setItem(VISIBLE_KEY, String(visible));
    } catch { /* private window / blocked storage: the choice just is not remembered */ }
  }

  const listItems = () => entries.map(toListItem);

  function setEntries(next) {
    entries = next;
    for (const cb of changedListeners) cb(listItems());
  }

  async function hashOf(blob) {
    try {
      const digest = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { // no SubtleCrypto (insecure context): same size and type counts as the same image
      return `${blob.type}:${blob.size}`;
    }
  }

  function makeThumb(bitmap) {
    const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(bitmap.width * scale));
    thumb.height = Math.max(1, Math.round(bitmap.height * scale));
    thumb.getContext('2d').drawImage(bitmap, 0, 0, thumb.width, thumb.height);
    return thumb.toDataURL();
  }

  async function recordOne(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      setEntries(addEntry(entries, {
        id: nextId++,
        hash: await hashOf(blob),
        png: blob, // the original image blob (the field name is shared with the desktop entries)
        thumb: makeThumb(bitmap),
        width: bitmap.width,
        height: bitmap.height,
        time: Date.now(),
      }));
    } finally {
      bitmap.close();
    }
  }

  async function record(blobs) {
    for (const blob of blobs) {
      try {
        await recordOne(blob);
      } catch (err) { // history is a convenience; never get in the way of adding the image
        console.warn('could not add the image to the history', err);
      }
    }
  }

  function setVisible(next) {
    visible = next;
    saveVisible();
    for (const cb of visibleListeners) cb(visible);
  }

  App.webHistory = {
    record,
    getState: () => Promise.resolve({ visible, items: listItems() }),
    onChanged: (cb) => changedListeners.push(cb),
    onVisible: (cb) => visibleListeners.push(cb),
    setVisible,
    use: (id) => {
      const entry = findEntry(entries, id);
      if (entry) App.addBlobs([entry.png], { record: false });
    },
    remove: (id) => setEntries(removeEntry(entries, id)),
    clear: () => setEntries([]),
  };
})();
