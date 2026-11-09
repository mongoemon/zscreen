'use strict';

// Text clipboard: up to 10 texts kept to reuse later (bookkeeping in text-snippets.js).
// Type or paste a text and save it, then click a saved text to copy it again. The OCR and speech
// dialogs keep their text here with App.keepSnippet. The list is saved in localStorage, so it is
// still there after a reload or a restart of the desktop app, until the user removes it.
(() => {
  const { $, toast } = App;
  const { SNIPPET_LIMIT, addSnippet, removeSnippet, findSnippet, parseSnippets, nextId } = TextSnippets;
  const STORAGE_KEY = 'zcreenshot.snippets';

  const dialog = $('snippets-dialog');
  const input = $('snippet-input');
  const list = $('snippet-list');
  const empty = $('snippet-empty');
  const count = $('snippets-count');
  const fullNote = $('snippet-full');
  const addButton = $('snippet-add');
  const clearButton = $('snippets-clear');

  let snippets = load();

  function load() {
    try {
      return parseSnippets(localStorage.getItem(STORAGE_KEY));
    } catch {
      return [];
    }
  }

  function store() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    } catch (err) { // private window / blocked or full storage: the list lasts until the page closes
      console.warn('could not save the text clipboard', err);
    }
  }

  function setSnippets(next) {
    snippets = next;
    store();
    render();
  }

  async function copySnippet(id) {
    const snippet = findSnippet(snippets, id);
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.text);
      toast('toast.textCopied');
    } catch (err) {
      console.error(err);
      toast('toast.copyFailed');
    }
  }

  function removeOne(id) {
    setSnippets(removeSnippet(snippets, id));
    (list.querySelector('.snippet-pick') || input).focus();
  }

  /** Saves `text`; tells the user why when it cannot. Returns true when the text is in the list. */
  function keepSnippet(text) {
    snippets = load(); // another tab of the web version may have changed it
    const result = addSnippet(snippets, text, { id: nextId(snippets), time: Date.now() });
    if (result.status === 'empty') return false;
    if (result.status === 'full') {
      toast('snippets.full', { limit: SNIPPET_LIMIT });
      return false;
    }
    if (result.status === 'tooLong') {
      toast('snippets.tooLong');
      return false;
    }
    setSnippets(result.snippets);
    toast(result.status === 'moved' ? 'snippets.moved' : 'snippets.saved');
    return true;
  }

  function saveTyped() {
    if (keepSnippet(input.value)) input.value = '';
    input.focus();
  }

  function buildItem(snippet) {
    const item = document.createElement('li');
    item.className = 'snippet-item';

    const pick = document.createElement('button');
    pick.className = 'snippet-pick';
    pick.title = I18n.t('snippets.copyTitle');
    pick.addEventListener('click', () => copySnippet(snippet.id));
    const text = document.createElement('span');
    text.className = 'snippet-text';
    text.textContent = snippet.text;
    const time = document.createElement('span');
    time.className = 'snippet-time';
    time.textContent = new Date(snippet.time).toLocaleString(I18n.getLocale(), { dateStyle: 'short', timeStyle: 'short' });
    pick.append(text, time);

    const remove = document.createElement('button');
    remove.className = 'icon-btn snippet-remove';
    remove.title = I18n.t('snippets.remove');
    remove.setAttribute('aria-label', I18n.t('snippets.remove'));
    remove.innerHTML = '<svg class="icon"><use href="#i-trash"/></svg>';
    remove.addEventListener('click', () => removeOne(snippet.id));

    item.append(pick, remove);
    return item;
  }

  function render() {
    list.replaceChildren(...snippets.map(buildItem));
    empty.hidden = snippets.length > 0;
    count.textContent = I18n.t('snippets.count', { count: snippets.length, limit: SNIPPET_LIMIT });
    fullNote.hidden = snippets.length < SNIPPET_LIMIT;
    fullNote.textContent = I18n.t('snippets.full', { limit: SNIPPET_LIMIT });
    clearButton.disabled = snippets.length === 0;
    input.placeholder = I18n.t('snippets.placeholder');
  }

  // ---------- dialog ----------
  const isSnippetsOpen = () => !dialog.hidden;

  function openSnippets() {
    if (isSnippetsOpen()) return;
    App.commitText();
    snippets = load();
    render();
    dialog.hidden = false;
    input.focus();
  }

  function closeSnippets() {
    dialog.hidden = true;
    $('btn-snippets').focus();
  }

  function clearAll() {
    if (!window.confirm(I18n.t('snippets.clearConfirm'))) return;
    setSnippets([]);
    input.focus();
  }

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSnippets();
  });
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeSnippets(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveTyped();
    }
  });
  addButton.addEventListener('click', saveTyped);
  clearButton.addEventListener('click', clearAll);
  $('snippets-close').addEventListener('click', closeSnippets);
  $('btn-snippets').addEventListener('click', openSnippets);
  I18n.subscribe(render);
  render();

  Object.assign(App, { openSnippets, isSnippetsOpen, keepSnippet });
})();
