'use strict';

// In-place text editing: a <textarea> overlaid on the canvas at the annotation's screen position.
// Edits two kinds of annotation: free text boxes ("text") and the label behind an arrow's tail
// ("arrow"). Enter commits, Shift+Enter adds a line, Esc cancels, losing focus commits.
(() => {
  const { dom, state: S, pushHistory } = App;
  const { textEditor } = dom;

  const isArrow = (a) => a.type === 'arrow';
  const textOf = (a) => (isArrow(a) ? a.label || '' : a.text);

  function fitEditor(minWidth = 60) {
    textEditor.style.width = '1px';
    textEditor.style.height = '1px';
    textEditor.style.width = `${Math.max(textEditor.scrollWidth + 6, minWidth)}px`;
    textEditor.style.height = `${textEditor.scrollHeight}px`;
  }

  /** Arrow label: sized like the drawn label and centred on the box it will occupy while typing. */
  function positionArrowEditor(a, view) {
    const live = { ...a, label: textEditor.value || ' ' };
    const rect = Scene.arrowLabelRect({ ...live, ...Draw.measureArrowLabel(live) });
    textEditor.style.font = Draw.fontOf(Scene.arrowLabelSize(a.width) * view.scale);
    textEditor.style.lineHeight = '1.3';
    textEditor.style.padding = '0px';
    textEditor.style.textAlign = 'center';
    textEditor.style.color = a.color;
    textEditor.style.background = 'rgba(0,0,0,0.25)';
    fitEditor(8); // no wide minimum: the box must match the label it will become, or it sits off the tail
    const cx = (rect.x + rect.w / 2) * view.scale + view.x;
    const cy = (rect.y + rect.h / 2) * view.scale + view.y;
    textEditor.style.left = `${cx - textEditor.offsetWidth / 2}px`;
    textEditor.style.top = `${cy - textEditor.offsetHeight / 2}px`;
  }

  function positionEditor() {
    const a = S.editing;
    const view = S.view;
    if (isArrow(a)) {
      positionArrowEditor(a, view);
      return;
    }
    const pad = a.bg ? Draw.TEXT_PAD * view.scale : 0;
    textEditor.style.left = `${a.x * view.scale + view.x}px`;
    textEditor.style.top = `${a.y * view.scale + view.y}px`;
    textEditor.style.font = Draw.fontOf(a.size * view.scale);
    textEditor.style.lineHeight = '1.3';
    textEditor.style.padding = `${pad}px`;
    textEditor.style.textAlign = 'left';
    textEditor.style.color = a.bg ? Scene.contrastColor(a.color) : a.color;
    textEditor.style.background = a.bg ? a.color : 'rgba(0,0,0,0.25)';
    fitEditor();
  }

  /** @param {object} a a text annotation, or an arrow (add `fresh: true` when it was just drawn) */
  function openTextEditor(a) {
    S.editing = a;
    textEditor.value = textOf(a);
    textEditor.hidden = false;
    positionEditor();
    textEditor.focus();
    textEditor.select();
    App.render();
  }

  function cancelText() {
    S.editing = null;
    textEditor.hidden = true;
  }

  function commitArrowLabel(a, value) {
    const current = S.annotations.find((x) => x.id === a.id);
    const label = value.replace(/\s+$/, '');
    if (!current || label === (current.label || '')) return;
    // a just-drawn arrow already has its undo step; typing its label must not add a second one
    if (!a.fresh) pushHistory();
    const next = { ...current, label, ...Draw.measureArrowLabel({ ...current, label }) };
    S.annotations = S.annotations.map((x) => (x.id === a.id ? next : x));
    App.selectAnnotation(next);
  }

  function commitTextBox(a, value) {
    const text = value.replace(/\s+$/, '');
    const exists = S.annotations.some((x) => x.id === a.id);
    if (!text) {
      if (exists) {
        pushHistory();
        S.annotations = S.annotations.filter((x) => x.id !== a.id);
        S.selectedAnnId = null;
      }
      return;
    }
    const next = { ...a, text };
    const measured = { ...next, ...Draw.measureText(next) };
    pushHistory();
    S.annotations = exists
      ? S.annotations.map((x) => (x.id === a.id ? measured : x))
      : [...S.annotations, measured];
    App.selectAnnotation(measured);
  }

  function commitText() {
    if (!S.editing) return;
    const a = S.editing;
    const value = textEditor.value;
    cancelText();
    if (isArrow(a)) commitArrowLabel(a, value);
    else commitTextBox(a, value);
    App.render();
  }

  textEditor.addEventListener('input', () => { if (S.editing) positionEditor(); });
  textEditor.addEventListener('blur', commitText);
  textEditor.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // Enter that confirms an IME candidate must not commit the text
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelText();
      App.render();
    }
  });

  Object.assign(App, { positionEditor, openTextEditor, cancelText, commitText });
})();
