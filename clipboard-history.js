'use strict';

// Pure bookkeeping for the clipboard history (no Electron, so it is unit-tested in Node; the browser
// build loads it too, as the global `ClipboardHistory`).
// Newest entry first; every function returns a new array and never edits its input.
const HISTORY_LIMIT = 10;

/**
 * @typedef {{id:number, hash:string, png:Buffer, thumb:string, width:number, height:number, time:number}} Entry
 */

/** Adds `entry` at the front. An older entry with the same image hash is replaced (re-copying moves it up). */
function addEntry(entries, entry, limit = HISTORY_LIMIT) {
  return [entry, ...entries.filter((e) => e.hash !== entry.hash)].slice(0, limit);
}

const removeEntry = (entries, id) => entries.filter((e) => e.id !== id);

const findEntry = (entries, id) => entries.find((e) => e.id === id) || null;

/** What the history window needs to draw a card: everything except the full-size PNG and the hash. */
const toListItem = ({ id, thumb, width, height, time }) => ({ id, thumb, width, height, time });

const api = { HISTORY_LIMIT, addEntry, removeEntry, findEntry, toListItem };
if (typeof module === 'object' && module.exports) module.exports = api;
else window.ClipboardHistory = api;
