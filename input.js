'use strict';

// Non-pointer input: clipboard paste, file drop / picker (images go on the canvas, a video opens in
// the video editor), the tray bridge (Electron), keyboard shortcuts and the toolbar buttons.
(() => {
  const { dom, state: S, $ } = App;
  const { canvas, dropMask, fileInput, textEditor } = dom;

  const TOOL_ACTIONS = Object.freeze({
    toolSelect: 'select',
    toolRegion: 'region',
    toolPen: 'pen',
    toolLine: 'line',
    toolArrow: 'arrow',
    toolRect: 'rect',
    toolEllipse: 'ellipse',
    toolHighlight: 'highlight',
    toolText: 'text',
    toolStep: 'step',
    toolCensor: 'censor',
  });

  /** What each image-editor shortcut does (keys come from shortcut-settings.js). */
  const IMAGE_ACTIONS = Object.freeze({
    settings: () => App.openSettings(),
    openFiles: () => fileInput.click(),
    newBlank: () => App.openBlankDialog(),
    undo: () => App.undo(),
    save: () => App.savePng(),
    copy: () => (S.region ? App.copyRegion() : App.copyImage()),
    copyAll: () => App.copyAll(),
    exportText: () => App.exportText(),
    speechToText: () => App.openSpeechToText(),
    textClipboard: () => App.openSnippets(),
    regionPaste: () => App.pasteRegion(),
    deleteSelected: () => App.deleteSelected(),
    fit: () => { App.fitView(); App.render(); },
    zoomIn: () => App.zoomCenter(1.2),
    zoomOut: () => App.zoomCenter(1 / 1.2),
    toggleHistory: () => $('btn-history').click(),
    arrange: () => App.arrangeVertically(),
    clearAll: () => App.clearAll(),
    newTab: () => App.newTab(),
    closeTab: () => App.closeTab(),
    nextTab: () => App.nextTab(),
    prevTab: () => App.prevTab(),
    ...Object.fromEntries(Object.entries(TOOL_ACTIONS).map(([id, tool]) => [id, () => App.setTool(tool)])),
  });
  /** Shortcuts that only apply in some states; otherwise the key keeps its normal meaning. */
  const ACTIVE_WHEN = Object.freeze({ regionPaste: () => !!S.region });

  /** A record / video dialog is up: the canvas shortcuts, paste and drop are off. */
  const modalOpen = () => document.querySelector('.modal:not([hidden])') !== null;

  function addFiles(files) {
    const video = files.find((f) => f.type.startsWith('video/'));
    if (video) {
      App.openVideoEditor(video);
      return;
    }
    App.addBlobs(files);
  }

  // ---------- paste / drop / file picker ----------
  document.addEventListener('paste', (e) => {
    if (e.target === textEditor || modalOpen()) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length === 0) return;
    e.preventDefault();
    App.addBlobs(files);
  });

  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropMask.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropMask.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropMask.hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length > 0 && !modalOpen()) addFiles(files);
  });

  // Images pushed from the tray menu / global shortcut (main process reads the clipboard).
  if (window.zcreenshot) {
    window.zcreenshot.onClipboardImage((bytes) => {
      App.addBlobs([new Blob([bytes], { type: 'image/png' })]);
    });
    window.zcreenshot.onClipboardEmpty(() => App.toast('toast.clipboardEmpty'));
  }

  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (App.isChangelogOpen()) { // changelog open: only Esc does anything
      if (e.key === 'Escape') App.closeChangelog();
      return;
    }
    // Record works over the record dialog too (open -> start -> stop). On the desktop this key is
    // normally system-wide and never reaches the page; this covers the browser.
    if (!App.isSettingsOpen() && !App.isVideoEditorOpen() && App.shortcutMatches('record', e)) {
      e.preventDefault();
      App.toggleRecording();
      return;
    }
    if (!App.isSettingsOpen() && !App.isVideoEditorOpen() && App.shortcutMatches('scrollCapture', e)) {
      e.preventDefault();
      App.toggleScrollCapture();
      return;
    }
    if (modalOpen()) return; // the dialog handles its own keys (Esc closes it)
    if (e.target === textEditor) return; // typing text: no shortcuts
    if (e.code === 'Space') { // built in: hold Space to pan
      S.spaceDown = true;
      canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') { // built in: cancel / deselect
      S.draft = null;
      App.clearSelection();
      if (S.tool !== 'select') App.setTool('select');
      App.render();
      return;
    }
    if (App.focusOwnsKey(e)) return;
    const id = Object.keys(IMAGE_ACTIONS).find((name) => App.shortcutMatches(name, e)
      && (!ACTIVE_WHEN[name] || ACTIVE_WHEN[name]()));
    if (!id) return;
    e.preventDefault();
    IMAGE_ACTIONS[id]();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      S.spaceDown = false;
      canvas.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
    }
  });

  // ---------- toolbar ----------
  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => App.setTool(b.dataset.tool)));
  $('btn-paste').addEventListener('click', () => App.pasteFromClipboardApi());
  $('btn-open').addEventListener('click', () => fileInput.click());
  $('btn-arrange').addEventListener('click', () => App.arrangeVertically());
  $('btn-fit').addEventListener('click', () => { App.fitView(); App.render(); });
  $('btn-undo').addEventListener('click', () => App.undo());
  $('btn-delete').addEventListener('click', () => App.deleteSelected());
  $('btn-clear').addEventListener('click', () => App.clearAll());
  $('btn-region-paste').addEventListener('click', () => App.pasteRegion());
  $('btn-region-copy').addEventListener('click', () => App.copyRegion());
  $('btn-copy').addEventListener('click', () => App.copyImage());
  $('btn-copy-all').addEventListener('click', () => App.copyAll());
  $('btn-save').addEventListener('click', () => App.savePng());
})();
