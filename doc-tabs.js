'use strict';

// Pure tab-list logic for open documents, free of DOM access so it runs in the browser (global
// `DocTabs`) and in Node unit tests (module.exports). A tab is {id, ...}; the list order is the
// order shown in the tab bar. Nothing here mutates its arguments.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.DocTabs = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const TITLE_MAX = 40;

  const indexOf = (list, id) => list.findIndex((t) => t.id === id);

  /** New list with `tab` placed right after the tab `afterId` (at the end when it is not found). */
  function insertAfter(list, afterId, tab) {
    const i = indexOf(list, afterId);
    if (i < 0) return [...list, tab];
    return [...list.slice(0, i + 1), tab, ...list.slice(i + 1)];
  }

  /**
   * Which tab becomes active when `closingId` closes: unchanged unless it was the active one, then
   * its right neighbour, else its left one; null when no tab is left.
   */
  function activeAfterClose(list, closingId, activeId) {
    if (closingId !== activeId) return activeId;
    const i = indexOf(list, closingId);
    const rest = list.filter((t) => t.id !== closingId);
    if (rest.length === 0) return null;
    return rest[Math.min(Math.max(i, 0), rest.length - 1)].id;
  }

  /** Id `step` tabs away from `activeId`, wrapping around both ends. */
  function cycle(list, activeId, step) {
    if (list.length === 0) return null;
    const i = Math.max(indexOf(list, activeId), 0);
    const n = list.length;
    return list[(((i + step) % n) + n) % n].id;
  }

  /** New list with tab `fromId` moved to the place of tab `toId` (used by drag-to-reorder). */
  function move(list, fromId, toId) {
    const from = indexOf(list, fromId);
    const to = indexOf(list, toId);
    if (from < 0 || to < 0 || from === to) return list;
    const rest = list.filter((t) => t.id !== fromId);
    return [...rest.slice(0, to), list[from], ...rest.slice(to)];
  }

  /** A typed tab name: one line, trimmed, at most TITLE_MAX characters; '' means "use the default". */
  function cleanTitle(text) {
    return [...String(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, TITLE_MAX).join('');
  }

  /** The name as a file name (no path or reserved characters); '' when nothing usable is left. */
  function fileSafeName(title) {
    // eslint-disable-next-line no-control-regex
    return cleanTitle(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^[.\s]+|[.\s]+$/g, '');
  }

  return {
    TITLE_MAX, insertAfter, activeAfterClose, cycle, move, cleanTitle, fileSafeName,
  };
});
