'use strict';

// Open documents as tabs. The editor modules all work on App.state, so only the active document
// lives there; switching tabs stores its fields (images, annotations, history, view, selection)
// on the tab and loads the next tab's fields back. Tool and style stay shared by every tab.
// Tab list rules (order, which tab follows a closed one, names) are in doc-tabs.js.
(() => {
  const { C, state: S, $ } = App;
  const list = $('doc-tab-list');
  const btnNew = $('btn-new-tab');

  /** Fields of App.state that belong to one document. */
  const DOC_KEYS = Object.freeze([
    'items', 'annotations', 'selectedId', 'selectedAnnId', 'group', 'marquee', 'crop', 'draft',
    'region', 'view', 'history', 'nextId', 'nextAnnId', 'guides',
  ]);

  const blankDoc = () => ({
    items: [],
    annotations: [],
    selectedId: null,
    selectedAnnId: null,
    group: { itemIds: [], annIds: [] },
    marquee: null,
    crop: null,
    draft: null,
    region: null,
    view: { x: C.VIEW_PAD, y: C.VIEW_PAD, scale: 1 },
    history: [],
    nextId: 1,
    nextAnnId: 1,
    guides: [],
  });

  /** @type {{id:number, number:number, title:string, doc:object|null}[]} doc is null for the active tab */
  let tabs = [];
  let activeId = null;
  let nextTabId = 1;
  let nextNumber = 1; // "Untitled N"; restarts when the last tab is closed
  let renamingId = null;
  let draggingId = null;

  const find = (id) => tabs.find((t) => t.id === id);
  const docOf = (tab) => (tab.id === activeId ? S : tab.doc);
  const hasContent = (tab) => docOf(tab).items.length > 0 || docOf(tab).annotations.length > 0;
  const titleOf = (tab) => tab.title || I18n.t('tabs.untitled', { n: tab.number });

  function makeTab() {
    return { id: nextTabId++, number: nextNumber++, title: '', doc: blankDoc() };
  }

  /** Moves the active document out of App.state onto its tab. */
  function storeActive() {
    const tab = find(activeId);
    if (!tab) return;
    App.commitText(); // a text box being typed belongs to the document it was started in
    S.drag = null;
    tab.doc = Object.fromEntries(DOC_KEYS.map((k) => [k, S[k]]));
  }

  function activate(id) {
    if (id === activeId) return;
    storeActive();
    const tab = find(id);
    Object.assign(S, tab.doc);
    tab.doc = null;
    activeId = id;
    App.updateControls();
    App.render();
    renderTabs();
  }

  function newTab() {
    const tab = makeTab();
    tabs = DocTabs.insertAfter(tabs, activeId, tab);
    activate(tab.id);
  }

  /** Frees the decoded images of a closed document (its undo snapshots share them with its items). */
  function releaseBitmaps(doc) {
    const bitmaps = new Set();
    for (const snap of [doc, ...doc.history]) for (const it of snap.items) bitmaps.add(it.bitmap);
    bitmaps.forEach((b) => b.close());
  }

  function closeTab(id) {
    const tab = find(id);
    if (!tab) return;
    if (hasContent(tab) && !window.confirm(I18n.t('tabs.closeConfirm', { name: titleOf(tab) }))) return;
    if (tabs.length === 1) { // there is always one tab: closing the last one leaves a fresh, empty one
      nextNumber = 1;
      tabs = [...tabs, makeTab()];
    }
    activate(DocTabs.activeAfterClose(tabs, id, activeId));
    tabs = tabs.filter((t) => t.id !== id);
    releaseBitmaps(tab.doc);
    renderTabs();
  }

  const cycleTab = (step) => activate(DocTabs.cycle(tabs, activeId, step));

  // ---------- rename (double-click a tab) ----------
  function startRename(id) {
    renamingId = id;
    renderTabs();
    const input = list.querySelector('.doc-tab-rename');
    input.focus();
    input.select();
  }

  function finishRename(value) {
    const tab = find(renamingId);
    renamingId = null;
    if (tab && value !== null) tab.title = DocTabs.cleanTitle(value);
    renderTabs();
  }

  function renameInput(tab) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'doc-tab-rename';
    input.value = titleOf(tab);
    input.maxLength = DocTabs.TITLE_MAX;
    input.setAttribute('aria-label', I18n.t('tabs.rename'));
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      finishRename(value);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name must not reach the canvas shortcuts (Space pans, Delete deletes)
      if (e.isComposing) return;
      if (e.key === 'Enter') finish(input.value);
      else if (e.key === 'Escape') finish(null);
    });
    input.addEventListener('blur', () => finish(input.value));
    return input;
  }

  // ---------- tab bar ----------
  function tabElement(tab) {
    const active = tab.id === activeId;
    const el = document.createElement('div');
    el.className = `doc-tab${active ? ' active' : ''}`;
    el.dataset.id = String(tab.id);
    el.draggable = renamingId !== tab.id;

    if (renamingId === tab.id) {
      el.append(renameInput(tab));
    } else {
      const button = document.createElement('button');
      button.className = 'doc-tab-btn';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(active));
      button.textContent = titleOf(tab);
      button.title = `${titleOf(tab)} · ${I18n.t('tabs.renameHint')}`;
      button.addEventListener('click', () => activate(tab.id));
      button.addEventListener('dblclick', () => startRename(tab.id));
      el.append(button);
    }

    // the close shortcut acts on the active tab only, so only its button names the key
    const closeTitle = active ? App.shortcutTitle('tabs.close', 'closeTab') : I18n.t('tabs.closeThis');
    const close = document.createElement('button');
    close.className = 'doc-tab-close';
    close.title = closeTitle;
    close.setAttribute('aria-label', closeTitle);
    close.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
    close.addEventListener('click', () => closeTab(tab.id));
    el.append(close);

    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); }); // middle click
    el.addEventListener('dragstart', (e) => {
      draggingId = tab.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', titleOf(tab));
    });
    el.addEventListener('dragover', (e) => {
      if (draggingId === null) return;
      e.preventDefault();
    });
    el.addEventListener('drop', (e) => {
      if (draggingId === null) return;
      e.preventDefault();
      tabs = DocTabs.move(tabs, draggingId, tab.id);
      renderTabs();
    });
    el.addEventListener('dragend', () => { draggingId = null; });
    return el;
  }

  function renderTabs() {
    list.replaceChildren(...tabs.map(tabElement));
    const active = find(activeId);
    document.title = active && tabs.length > 1 ? `${titleOf(active)} - Zcreenshot` : 'Zcreenshot';
    list.querySelector('.doc-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** The active tab's own name as a file name, or '' while it has its default name. */
  const documentFileName = () => DocTabs.fileSafeName(find(activeId)?.title || '');

  btnNew.addEventListener('click', newTab);
  list.addEventListener('dblclick', (e) => { if (e.target === list) newTab(); }); // empty part of the bar
  I18n.subscribe(renderTabs);
  App.onShortcutsChange(renderTabs);

  // the document already in App.state becomes the first tab
  const first = makeTab();
  first.doc = null;
  tabs = [first];
  activeId = first.id;
  renderTabs();

  Object.assign(App, {
    newTab,
    closeTab: () => closeTab(activeId),
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    documentFileName,
  });
})();
