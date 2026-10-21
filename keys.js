'use strict';

// Keyboard-layout-independent shortcut keys. Pure (no DOM) so it loads in the browser (global `Keys`)
// and in Node unit tests (module.exports).
//
// `KeyboardEvent.key` follows the active layout: on a Thai layout Ctrl+Z reports a Thai letter, so
// `key === 'z'` never matches. `KeyboardEvent.code` is the physical key. We prefer `key` when it is a
// Latin letter/digit (keeps AZERTY / Dvorak shortcuts where users expect them) and fall back to the
// physical key otherwise.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Keys = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const LATIN_KEY = /^[a-z0-9=+-]$/i;
  const LETTER_OR_DIGIT_CODE = /^(?:Key([A-Z])|Digit([0-9]))$/;
  const PUNCTUATION_CODES = Object.freeze({ Equal: '=', Minus: '-' });

  /**
   * @param {{key?: string, code?: string}} e a KeyboardEvent (or anything shaped like one)
   * @returns {string} lowercase key to match shortcuts against ('z', '0', '=', 'escape', ...)
   */
  function shortcutKey(e) {
    const key = typeof e.key === 'string' ? e.key : '';
    if (LATIN_KEY.test(key)) return key.toLowerCase();
    const code = typeof e.code === 'string' ? e.code : '';
    const match = LETTER_OR_DIGIT_CODE.exec(code);
    if (match) return (match[1] || match[2]).toLowerCase();
    if (code in PUNCTUATION_CODES) return PUNCTUATION_CODES[code];
    return key.toLowerCase();
  }

  return { shortcutKey };
});
