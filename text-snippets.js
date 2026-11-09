'use strict';

// Pure bookkeeping for the text clipboard: texts the user keeps to reuse later (no DOM, so it is
// unit-tested in Node; the browser loads it as the global `TextSnippets`).
// Newest first; every function returns a new array and never edits its input.
// Unlike the image history nothing is dropped on its own: when the list is full, a new text is
// refused until the user removes one.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TextSnippets = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const SNIPPET_LIMIT = 10;
  const MAX_CHARS = 20000; // keeps the saved list well inside the localStorage quota

  /**
   * @typedef {{id:number, text:string, time:number}} Snippet
   * @typedef {'added'|'moved'|'empty'|'tooLong'|'full'} AddStatus
   */

  /**
   * Adds `text` (trimmed) at the front. The same text already in the list moves to the front
   * instead (this also works when the list is full).
   * @returns {{snippets: Snippet[], status: AddStatus}}
   */
  function addSnippet(snippets, text, { id, time }, limit = SNIPPET_LIMIT) {
    const value = String(text == null ? '' : text).trim();
    if (value === '') return { snippets, status: 'empty' };
    if (value.length > MAX_CHARS) return { snippets, status: 'tooLong' };
    const same = snippets.find((s) => s.text === value);
    if (same) return { snippets: [{ ...same, time }, ...snippets.filter((s) => s !== same)], status: 'moved' };
    if (snippets.length >= limit) return { snippets, status: 'full' };
    return { snippets: [{ id, text: value, time }, ...snippets], status: 'added' };
  }

  const removeSnippet = (snippets, id) => snippets.filter((s) => s.id !== id);

  const findSnippet = (snippets, id) => snippets.find((s) => s.id === id) || null;

  /** Reads what was saved (a JSON string, or null); anything malformed is skipped, never thrown. */
  function parseSnippets(raw, limit = SNIPPET_LIMIT) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const out = [];
    for (const s of data) {
      if (!s || !Number.isInteger(s.id) || typeof s.text !== 'string' || !Number.isFinite(s.time)) continue;
      const text = s.text.trim();
      if (text === '' || text.length > MAX_CHARS || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, text, time: s.time });
      if (out.length === limit) break;
    }
    return out;
  }

  /** The next free id (ids only have to be unique within the list). */
  const nextId = (snippets) => snippets.reduce((max, s) => Math.max(max, s.id), 0) + 1;

  return { SNIPPET_LIMIT, MAX_CHARS, addSnippet, removeSnippet, findSnippet, parseSnippets, nextId };
});
