'use strict';

// Keyboard shortcuts in the page: the current bindings, the helpers other modules use to match
// key presses and show keys in tooltips, and the settings dialog where the user changes them.
//
// In-page shortcuts are saved in localStorage. On the desktop the system-wide ones (paste from any
// app, start/stop recording) belong to the main process (global-shortcuts.js) and go over IPC.
(() => {
  const { $, toast } = App;

  // {"<action id>": ["Mod+y", ...]} for the in-page actions that differ from their defaults
  const STORAGE_KEY = 'zcreenshot.shortcuts';
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const bridge = window.zcreenshot && window.zcreenshot.shortcuts; // desktop only
  const desktop = !!bridge;
  const isGlobalHere = (a) => desktop && a.scope === 'global';
  const actions = Shortcuts.ACTIONS.filter((a) => desktop || !a.desktopOnly);

  const GROUP_TITLES = Object.freeze({
    global: 'settings.groupGlobal',
    recording: 'settings.groupRecording',
    image: 'settings.groupImage',
    tools: 'settings.groupTools',
    video: 'settings.groupVideo',
  });
  const ERRORS = Object.freeze({
    invalid: 'settings.errInvalid',
    needsModifier: 'settings.errNeedsModifier',
    unsupported: 'settings.errUnsupported',
    reserved: 'settings.errReserved',
    conflict: 'settings.errConflict',
    taken: 'settings.errTaken',
  });

  // ---------- bindings ----------
  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) { // blocked storage or a damaged value: start from the defaults
      return {};
    }
  }

  let overrides = readStored(); // in-page changes (in the browser the record key is one of them)
  let globalState = { bindings: {}, failed: [] }; // desktop: what the main process reports
  let bindings = {};
  let listeners = [];

  function recompute() {
    const local = Shortcuts.resolve(overrides);
    bindings = Object.fromEntries(actions.map((a) => [
      a.id, isGlobalHere(a) ? (globalState.bindings[a.id] || local[a.id]) : local[a.id],
    ]));
  }

  function storeOverrides() {
    const changed = Shortcuts.diff({ ...Shortcuts.defaults(), ...bindings });
    overrides = Object.fromEntries(Object.entries(changed).filter(([id]) => !isGlobalHere(Shortcuts.getAction(id))));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (err) {
      console.warn('could not save the shortcuts', err);
    }
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }

  /**
   * Gives `id` new keys ([] turns it off).
   * @returns {Promise<null | {reason:string, other?:string}>} why it was refused, or null
   */
  async function assign(id, keys) {
    const target = Shortcuts.getAction(id);
    if (!target) return { reason: 'invalid' };
    if (isGlobalHere(target)) {
      const result = await bridge.set(id, keys);
      if (!result || !result.ok) return result || { reason: 'invalid' };
      globalState = { bindings: result.bindings, failed: result.failed };
      recompute();
    } else {
      bindings = { ...bindings, [id]: keys.map(Shortcuts.normalize) };
      storeOverrides();
    }
    notify();
    return null;
  }

  // ---------- helpers for the other modules ----------
  const shortcutMatches = (id, e) => (bindings[id] || []).some((b) => Shortcuts.matches(b, e, isMac));

  /** First key of an action ("Ctrl+Z"), '' when it has none. */
  const shortcutHint = (id) => ((bindings[id] || [])[0] ? Shortcuts.format(bindings[id][0], isMac) : '');

  /** Tooltip text: the message with its "({key})" filled in, or dropped when the action has no key. */
  function shortcutTitle(messageKey, id) {
    const key = shortcutHint(id);
    if (key) return I18n.t(messageKey, { key });
    return I18n.t(messageKey, { key: '\u0000' }).replace(/\s*\(\u0000\)/, '');
  }

  const TEXT_INPUT = /^(text|search|email|url|tel|password|number)$/;
  const CONTROL_KEYS = Object.freeze([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

  /**
   * True when the focused element should get this key itself: anything typed into a text field,
   * and Space / Enter / arrows on buttons, sliders, menus and the video player.
   */
  function focusOwnsKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const el = e.target;
    if (!(el instanceof Element)) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT.test(el.type))) return true;
    return ['BUTTON', 'INPUT', 'SELECT', 'VIDEO', 'A'].includes(el.tagName) && CONTROL_KEYS.includes(e.key);
  }

  const onShortcutsChange = (listener) => { listeners = [...listeners, listener]; };

  // ---------- settings dialog ----------
  const dialog = $('settings-dialog');
  const list = $('shortcut-list');
  const fixedList = $('fixed-shortcuts');
  let capturing = null; // action id waiting for its new keys
  let errors = {}; // action id -> message shown under its row

  const actionName = (id) => I18n.t(Shortcuts.getAction(id).label);
  const errorText = (problem) => I18n.t(ERRORS[problem.reason] || ERRORS.invalid, {
    action: problem.other ? actionName(problem.other) : '',
  });
  const isDefault = (a) => (bindings[a.id] || []).join('|') === a.defaults.map(Shortcuts.normalize).join('|');

  function keyChips(id) {
    const keys = bindings[id] || [];
    if (keys.length === 0) {
      const off = document.createElement('span');
      off.className = 'sc-off';
      off.textContent = I18n.t('settings.off');
      return [off];
    }
    return keys.map((b) => {
      const kbd = document.createElement('kbd');
      kbd.textContent = Shortcuts.format(b, isMac);
      return kbd;
    });
  }

  function textButton(labelKey, onClick, disabled) {
    const button = document.createElement('button');
    button.className = 'text-btn';
    button.textContent = I18n.t(labelKey);
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function buildRow(a) {
    const row = document.createElement('div');
    row.className = 'sc-row';
    row.dataset.action = a.id;
    row.classList.toggle('capturing', capturing === a.id);

    const name = document.createElement('span');
    name.className = 'sc-name';
    name.textContent = I18n.t(a.label);

    const keys = document.createElement('span');
    keys.className = 'sc-keys';
    if (capturing === a.id) {
      const prompt = document.createElement('span');
      prompt.className = 'sc-capture';
      prompt.textContent = I18n.t('settings.capture');
      keys.append(prompt);
    } else {
      keys.append(...keyChips(a.id));
    }

    const buttons = document.createElement('span');
    buttons.className = 'sc-buttons';
    buttons.append(
      textButton('settings.change', () => startCapture(a.id), false),
      textButton('settings.reset', () => apply(a.id, a.defaults.map(Shortcuts.normalize)), isDefault(a)),
      textButton('settings.turnOff', () => apply(a.id, []), (bindings[a.id] || []).length === 0),
    );
    row.append(name, keys, buttons);

    const note = document.createElement('p');
    note.className = 'sc-error';
    note.setAttribute('role', 'alert');
    if (errors[a.id]) note.textContent = errors[a.id];
    else if (isGlobalHere(a) && globalState.failed.includes(a.id)) note.textContent = I18n.t('settings.failedGlobal');
    note.hidden = note.textContent === '';
    return [row, note];
  }

  function renderList() {
    list.replaceChildren(...Shortcuts.GROUPS.map((group) => {
      const inGroup = actions.filter((a) => a.group === group);
      if (inGroup.length === 0) return null;
      const section = document.createElement('section');
      section.className = 'sc-group';
      const title = document.createElement('h4');
      title.textContent = I18n.t(GROUP_TITLES[group]);
      section.append(title, ...inGroup.flatMap(buildRow));
      return section;
    }).filter(Boolean));
    $('shortcuts-reset-all').disabled = actions.every(isDefault);

    // built into the editor; listed so the user knows these keys are taken
    const fixed = [
      ['settings.fixedPaste', Shortcuts.format('Mod+v', isMac)],
      ['settings.fixedPan', I18n.t('settings.holdKey', { key: 'Space' })],
      ['settings.fixedCancel', 'Esc'],
      ['settings.fixedShift', I18n.t('settings.holdKey', { key: 'Shift' })],
      ['settings.fixedCrop', I18n.t('settings.dragKey', { key: isMac ? 'Option' : 'Alt' })],
    ];
    fixedList.replaceChildren(...fixed.flatMap(([labelKey, keys]) => {
      const dt = document.createElement('dt');
      dt.textContent = I18n.t(labelKey);
      const dd = document.createElement('dd');
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      dd.append(kbd);
      return [dt, dd];
    }));
  }

  function focusRow(id) {
    const button = list.querySelector(`[data-action="${id}"] .sc-buttons button`);
    if (button) button.focus();
  }

  async function apply(id, keys) {
    capturing = null;
    const problem = await assign(id, keys);
    errors = problem ? { [id]: errorText(problem) } : {};
    renderList();
    focusRow(id);
  }

  function startCapture(id) {
    capturing = id;
    errors = {};
    renderList();
    focusRow(id);
  }

  function onCaptureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const id = capturing;
    if (e.key === 'Escape') {
      capturing = null;
      renderList();
      focusRow(id);
      return;
    }
    const pressed = Shortcuts.fromEvent(e, isMac);
    if (!pressed) return; // only a modifier so far: wait for the key
    const problem = Shortcuts.check(id, pressed, bindings, { desktop });
    if (problem) {
      capturing = null;
      errors = { [id]: `${Shortcuts.format(pressed, isMac)}: ${errorText(problem)}` };
      renderList();
      focusRow(id);
      return;
    }
    apply(id, [pressed]);
  }

  async function resetAll() {
    if (!window.confirm(I18n.t('settings.resetAllConfirm'))) return;
    errors = {};
    for (const a of actions.filter((x) => !isDefault(x))) {
      const problem = await assign(a.id, a.defaults.map(Shortcuts.normalize));
      if (problem) errors = { ...errors, [a.id]: errorText(problem) };
    }
    renderList();
    toast('toast.shortcutsReset');
  }

  const isSettingsOpen = () => !dialog.hidden;

  function openSettings() {
    capturing = null;
    errors = {};
    renderList();
    dialog.hidden = false;
    $('settings-close').focus();
  }

  function closeSettings() {
    capturing = null;
    dialog.hidden = true;
    $('btn-settings').focus();
  }

  // capture phase, so a key being recorded never reaches the editors' own shortcuts
  dialog.addEventListener('keydown', (e) => {
    if (capturing) onCaptureKey(e);
    else if (e.key === 'Escape') closeSettings();
  }, true);
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeSettings(); });
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-done').addEventListener('click', closeSettings);
  $('btn-settings').addEventListener('click', openSettings);
  $('shortcuts-reset-all').addEventListener('click', resetAll);
  I18n.subscribe(() => { if (isSettingsOpen()) renderList(); });
  onShortcutsChange(() => { if (App.applyTranslations) App.applyTranslations(); }); // tooltips show the keys

  recompute();
  if (bridge) {
    bridge.get()
      .then((state) => {
        if (!state) return;
        globalState = state;
        recompute();
        notify();
      })
      .catch((err) => console.error('could not load the system-wide shortcuts', err));
  }

  Object.assign(App, {
    shortcutMatches,
    shortcutHint,
    shortcutTitle,
    focusOwnsKey,
    onShortcutsChange,
    openSettings,
    closeSettings,
    isSettingsOpen,
  });
})();
