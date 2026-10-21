'use strict';

// Non-pointer input: clipboard paste, file drop / picker, the tray bridge (Electron), keyboard
// shortcuts and the toolbar buttons.
(() => {
  const { dom, state: S, $ } = App;
  const { canvas, dropMask, fileInput, textEditor } = dom;

  const isMac = navigator.platform.toLowerCase().includes('mac');
  const TOOL_KEYS = {
    v: 'select', p: 'pen', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse',
    h: 'highlight', t: 'text', n: 'step', m: 'censor',
  };

  // ---------- paste / drop / file picker ----------
  document.addEventListener('paste', (e) => {
    if (e.target === textEditor) return;
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
    if (files.length > 0) App.addBlobs(files);
  });

  // Images pushed from the tray menu / global shortcut (main process reads the clipboard).
  if (window.zcreenshot) {
    window.zcreenshot.onClipboardImage((bytes) => {
      App.addBlobs([new Blob([bytes], { type: 'image/png' })]);
    });
    window.zcreenshot.onClipboardEmpty(() => App.toast('toast.clipboardEmpty'));
  }

  fileInput.addEventListener('change', () => {
    App.addBlobs([...fileInput.files]);
    fileInput.value = '';
  });

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (App.isChangelogOpen()) { // changelog open: only Esc does anything
      if (e.key === 'Escape') App.closeChangelog();
      return;
    }
    if (e.target === textEditor) return; // typing text: no shortcuts
    if (e.code === 'Space') {
      S.spaceDown = true;
      canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = Keys.shortcutKey(e); // works on any layout, e.g. Ctrl+Z on a Thai keyboard

    if (mod && key === 'z') { e.preventDefault(); App.undo(); }
    else if (mod && key === 's') { e.preventDefault(); App.savePng(); }
    else if (mod && key === 'c') { e.preventDefault(); App.copyImage(); }
    else if (mod && key === '0') { e.preventDefault(); App.fitView(); App.render(); }
    else if (mod && (key === '=' || key === '+')) { e.preventDefault(); App.zoomCenter(1.2); }
    else if (mod && key === '-') { e.preventDefault(); App.zoomCenter(1 / 1.2); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); App.deleteSelected(); }
    else if (e.key === 'Escape') {
      S.draft = null;
      S.selectedId = null;
      S.selectedAnnId = null;
      if (S.tool !== 'select') App.setTool('select');
      App.updateControls();
      App.render();
    } else if (!mod && !e.altKey && TOOL_KEYS[key]) { App.setTool(TOOL_KEYS[key]); }
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
  $('btn-copy').addEventListener('click', () => App.copyImage());
  $('btn-save').addEventListener('click', () => App.savePng());
})();
