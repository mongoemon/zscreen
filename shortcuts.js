'use strict';

// Keyboard shortcuts: the list of actions with their default keys, and helpers to read a key press,
// match it, show it and turn it into an Electron accelerator. Pure (no DOM) so it loads in the
// browser (global `Shortcuts`), in the Electron main process (global shortcuts) and in Node tests.
//
// A binding is a string such as "Mod+Shift+v": modifiers in the order Mod, Ctrl, Alt, Shift, then
// one key. "Mod" is Cmd on macOS and Ctrl elsewhere; "Ctrl" only appears on macOS (the Control key).
// Keys are lowercase names from Keys.shortcutKey ("v", "0", "=", "delete", "arrowleft"), with
// "space" and "plus" standing in for " " and "+".
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./keys.js') : root.Keys);
  if (isNode) {
    module.exports = api;
  } else {
    root.Shortcuts = api;
  }
})(typeof self !== 'undefined' ? self : this, function (Keys) {
  /**
   * scope: where the shortcut listens, which decides what it may clash with.
   *   'global' = system-wide (desktop main process): clashes with everything;
   *   'image'  = the screenshot editor; 'video' = the video editor (only one of the two has the keys).
   * group: section in the settings dialog. desktopOnly: hidden in the browser.
   * @typedef {{id:string, scope:'global'|'image'|'video', group:string, label:string,
   *   defaults:readonly string[], desktopOnly?:boolean}} Action
   */
  const action = (id, scope, group, label, defaults, extra = {}) => Object.freeze({
    id, scope, group, label, defaults: Object.freeze(defaults), ...extra,
  });

  /** @type {readonly Action[]} */
  const ACTIONS = Object.freeze([
    action('globalPaste', 'global', 'global', 'sc.globalPaste', ['Mod+Shift+V'], { desktopOnly: true }),
    action('record', 'global', 'recording', 'sc.record', ['Mod+Alt+R']),
    action('scrollCapture', 'global', 'recording', 'sc.scrollCapture', ['Mod+Alt+S']),

    action('settings', 'image', 'image', 'sc.settings', ['Mod+,']),
    action('openFiles', 'image', 'image', 'sc.openFiles', ['Mod+O']),
    action('undo', 'image', 'image', 'sc.undo', ['Mod+Z']),
    action('save', 'image', 'image', 'sc.save', ['Mod+S']),
    action('copy', 'image', 'image', 'sc.copy', ['Mod+C']),
    action('copyAll', 'image', 'image', 'sc.copyAll', ['Mod+Alt+C']),
    action('regionPaste', 'image', 'image', 'sc.regionPaste', ['Enter']),
    action('deleteSelected', 'image', 'image', 'sc.deleteSelected', ['Delete', 'Backspace']),
    action('fit', 'image', 'image', 'sc.fit', ['Mod+0']),
    action('zoomIn', 'image', 'image', 'sc.zoomIn', ['Mod+=', 'Mod+Shift+plus', 'Mod+plus']),
    action('zoomOut', 'image', 'image', 'sc.zoomOut', ['Mod+-']),
    action('toggleHistory', 'image', 'image', 'sc.toggleHistory', ['Mod+Alt+H']),
    action('arrange', 'image', 'image', 'sc.arrange', []),
    action('clearAll', 'image', 'image', 'sc.clearAll', []),

    action('toolSelect', 'image', 'tools', 'sc.toolSelect', ['V']),
    action('toolRegion', 'image', 'tools', 'sc.toolRegion', ['C']),
    action('toolPen', 'image', 'tools', 'sc.toolPen', ['P']),
    action('toolLine', 'image', 'tools', 'sc.toolLine', ['L']),
    action('toolArrow', 'image', 'tools', 'sc.toolArrow', ['A']),
    action('toolRect', 'image', 'tools', 'sc.toolRect', ['R']),
    action('toolEllipse', 'image', 'tools', 'sc.toolEllipse', ['O']),
    action('toolHighlight', 'image', 'tools', 'sc.toolHighlight', ['H']),
    action('toolText', 'image', 'tools', 'sc.toolText', ['T']),
    action('toolStep', 'image', 'tools', 'sc.toolStep', ['N']),
    action('toolCensor', 'image', 'tools', 'sc.toolCensor', ['M']),

    action('videoPlay', 'video', 'video', 'sc.videoPlay', ['Space']),
    action('videoSetStart', 'video', 'video', 'sc.videoSetStart', ['I']),
    action('videoSetEnd', 'video', 'video', 'sc.videoSetEnd', ['O']),
    action('videoPrevFrame', 'video', 'video', 'sc.videoPrevFrame', ['ArrowLeft']),
    action('videoNextFrame', 'video', 'video', 'sc.videoNextFrame', ['ArrowRight']),
    action('videoSave', 'video', 'video', 'sc.videoSave', ['Mod+S']),
    action('videoAddFrame', 'video', 'video', 'sc.videoAddFrame', ['F']),
  ]);

  const GROUPS = Object.freeze(['global', 'recording', 'image', 'tools', 'video']);

  /** Keys the app keeps for itself in each scope (paste, hold-to-pan, cancel, moving the focus). */
  const RESERVED = Object.freeze({
    image: Object.freeze(['Mod+V', 'Space', 'Escape', 'Tab', 'Shift+Tab']),
    video: Object.freeze(['Escape', 'Tab', 'Shift+Tab']),
    global: Object.freeze([]),
  });

  const byId = new Map(ACTIONS.map((a) => [a.id, a]));
  const MODIFIERS = Object.freeze(['mod', 'ctrl', 'alt', 'shift']);
  const MODIFIER_NAMES = Object.freeze({
    mod: 'Mod', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift',
  });
  const LONE_MODIFIER_KEYS = new Set(['shift', 'control', 'alt', 'meta', 'altgraph', 'os', 'capslock', 'fn']);
  const UNUSABLE_KEYS = new Set(['', 'dead', 'unidentified', 'process', 'compose']);
  const KEY_ALIASES = Object.freeze({
    ' ': 'space',
    '+': 'plus',
    esc: 'escape',
    spacebar: 'space',
    left: 'arrowleft',
    right: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
  });

  /**
   * @param {string} text
   * @returns {{mod:boolean, ctrl:boolean, alt:boolean, shift:boolean, key:string} | null}
   */
  function parse(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    const parts = text.split('+');
    const rawKey = parts.pop().toLowerCase();
    const key = KEY_ALIASES[rawKey] || rawKey;
    if (UNUSABLE_KEYS.has(key) || LONE_MODIFIER_KEYS.has(key)) return null;
    const result = {
      mod: false, ctrl: false, alt: false, shift: false, key,
    };
    for (const part of parts) {
      const name = part.toLowerCase();
      if (!MODIFIERS.includes(name) || result[name]) return null;
      result[name] = true;
    }
    return result;
  }

  const stringify = (p) => [...MODIFIERS.filter((m) => p[m]).map((m) => MODIFIER_NAMES[m]), p.key].join('+');

  /** Canonical form ("shift+mod+V" -> "Mod+Shift+v"), or null when it is not a valid binding. */
  function normalize(text) {
    const p = parse(text);
    return p ? stringify(p) : null;
  }

  /**
   * The binding a key press stands for, or null for a lone modifier / dead key.
   * @param {{key?:string, code?:string, metaKey?:boolean, ctrlKey?:boolean, altKey?:boolean, shiftKey?:boolean}} e
   * @param {boolean} isMac
   */
  function fromEvent(e, isMac) {
    if (e.key === 'Dead') return null; // first half of an accented letter, not a key of its own
    const raw = Keys.shortcutKey(e);
    const key = KEY_ALIASES[raw] || raw;
    if (UNUSABLE_KEYS.has(key) || LONE_MODIFIER_KEYS.has(key)) return null;
    return stringify({
      mod: isMac ? !!e.metaKey : !!e.ctrlKey,
      ctrl: isMac && !!e.ctrlKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      key,
    });
  }

  function matches(binding, e, isMac) {
    const pressed = fromEvent(e, isMac);
    return pressed !== null && pressed === normalize(binding);
  }

  const KEY_LABELS = Object.freeze({
    space: 'Space',
    plus: '+',
    escape: 'Esc',
    enter: 'Enter',
    tab: 'Tab',
    delete: 'Delete',
    backspace: 'Backspace',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    insert: 'Insert',
  });

  /** "Mod+Shift+v" -> "Cmd+Shift+V" on macOS, "Ctrl+Shift+V" elsewhere ('' when invalid). */
  function format(binding, isMac) {
    const p = parse(binding);
    if (!p) return '';
    const names = {
      mod: isMac ? 'Cmd' : 'Ctrl', ctrl: 'Ctrl', alt: isMac ? 'Option' : 'Alt', shift: 'Shift',
    };
    return [...MODIFIERS.filter((m) => p[m]).map((m) => names[m]), KEY_LABELS[p.key] || p.key.toUpperCase()].join('+');
  }

  const ACCELERATOR_KEYS = Object.freeze({
    space: 'Space',
    plus: 'Plus',
    escape: 'Escape',
    enter: 'Enter',
    tab: 'Tab',
    delete: 'Delete',
    backspace: 'Backspace',
    arrowleft: 'Left',
    arrowright: 'Right',
    arrowup: 'Up',
    arrowdown: 'Down',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    insert: 'Insert',
  });
  const ACCELERATOR_PUNCTUATION = new Set(['=', '-', ',', '.', '/', ';', "'", '[', ']', '\\', '`']);

  /** Electron accelerator ("CommandOrControl+Shift+V"), or null when Electron cannot express the key. */
  function toAccelerator(binding) {
    const p = parse(binding);
    if (!p) return null;
    let key = ACCELERATOR_KEYS[p.key] || null;
    if (!key && (/^[a-z0-9]$/.test(p.key) || /^f([1-9]|1\d|2[0-4])$/.test(p.key))) key = p.key.toUpperCase();
    if (!key && ACCELERATOR_PUNCTUATION.has(p.key)) key = p.key;
    if (!key) return null;
    const mods = [];
    if (p.mod) mods.push('CommandOrControl');
    if (p.ctrl) mods.push('Control');
    if (p.alt) mods.push('Alt');
    if (p.shift) mods.push('Shift');
    return [...mods, key].join('+');
  }

  const defaults = () => Object.fromEntries(ACTIONS.map((a) => [a.id, a.defaults.map(normalize)]));

  /**
   * Default bindings with the saved changes applied. Unknown actions and invalid bindings in
   * `overrides` are ignored, so a stale or hand-edited settings file cannot break anything.
   * @param {Record<string, string[]>} [overrides] action id -> bindings ([] = turned off)
   * @returns {Record<string, string[]>}
   */
  function resolve(overrides) {
    const result = defaults();
    if (!overrides || typeof overrides !== 'object') return result;
    for (const [id, list] of Object.entries(overrides)) {
      if (!byId.has(id) || !Array.isArray(list)) continue;
      result[id] = [...new Set(list.map(normalize).filter(Boolean))];
    }
    return result;
  }

  /** Only the actions whose bindings differ from the defaults (what gets saved). */
  function diff(bindings) {
    const base = defaults();
    const result = {};
    for (const a of ACTIONS) {
      const list = bindings[a.id] || [];
      if (list.join('|') !== base[a.id].join('|')) result[a.id] = [...list];
    }
    return result;
  }

  const clashes = (a, b) => a.scope === 'global' || b.scope === 'global' || a.scope === b.scope;

  /**
   * Why `binding` cannot be given to action `id`, or null when it can.
   * @param {Record<string, string[]>} bindings current bindings (the action's own are ignored)
   * @param {{desktop?: boolean}} [options] desktop: global shortcuts exist (in the browser the
   *   "global" record shortcut is an ordinary in-page key, and desktop-only actions do not exist)
   * @returns {null | {reason:'invalid'|'needsModifier'|'unsupported'|'reserved'|'conflict', other?:string}}
   */
  function check(id, binding, bindings, { desktop = true } = {}) {
    const target = byId.get(id);
    const normalized = normalize(binding);
    if (!target || !normalized) return { reason: 'invalid' };
    if (target.scope === 'global' && desktop) {
      const p = parse(normalized);
      if (!p.mod && !p.ctrl && !p.alt) return { reason: 'needsModifier' };
      if (!toAccelerator(normalized)) return { reason: 'unsupported' };
    }
    const reservedScopes = target.scope === 'global' ? Object.keys(RESERVED) : [target.scope];
    if (reservedScopes.some((scope) => RESERVED[scope].map(normalize).includes(normalized))) return { reason: 'reserved' };
    for (const other of ACTIONS) {
      if (other.id === id || !clashes(target, other)) continue;
      if (other.desktopOnly && !desktop) continue;
      if ((bindings[other.id] || []).includes(normalized)) return { reason: 'conflict', other: other.id };
    }
    return null;
  }

  return {
    ACTIONS,
    GROUPS,
    RESERVED,
    getAction: (id) => byId.get(id) || null,
    parse,
    normalize,
    fromEvent,
    matches,
    format,
    toAccelerator,
    defaults,
    resolve,
    diff,
    check,
  };
});
