'use strict';

// Every dialog can be moved by dragging its header. The card is shifted with the CSS `translate`
// property (its layout stays centred), kept so the header never leaves the window, and put back
// in the middle each time the dialog closes.
(() => {
  const HEADS = '.modal-head, .changelog-head';
  const CARDS = '.modal-card, .changelog-card';
  const CONTROLS = 'button, input, select, textarea, a, label, [contenteditable]';
  const KEEP_VISIBLE = 80; // px of the header that must stay inside the window horizontally

  function startDrag(e) {
    if (e.button !== 0 || e.target.closest(CONTROLS)) return;
    const head = e.target.closest(HEADS);
    const card = head && head.closest(CARDS);
    if (!card) return;
    e.preventDefault();

    const [ox = 0, oy = 0] = (card.style.translate || '').split(' ').map(parseFloat);
    const rect = card.getBoundingClientRect();
    const headH = head.getBoundingClientRect().height;
    const startX = e.clientX;
    const startY = e.clientY;
    head.setPointerCapture(e.pointerId);
    head.classList.add('dragging');

    const move = (ev) => {
      const left = Math.min(Math.max(rect.left + ev.clientX - startX, KEEP_VISIBLE - rect.width),
        window.innerWidth - KEEP_VISIBLE);
      const top = Math.min(Math.max(rect.top + ev.clientY - startY, 0), window.innerHeight - headH);
      card.style.translate = `${ox + left - rect.left}px ${oy + top - rect.top}px`;
    };
    const end = () => {
      head.classList.remove('dragging');
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  function setupDialogDrag() {
    document.addEventListener('pointerdown', startDrag);
    // a dialog that is closed and opened again starts centred
    const recenter = new MutationObserver((records) => {
      for (const { target } of records) {
        if (target.hidden) target.querySelectorAll(CARDS).forEach((card) => { card.style.translate = ''; });
      }
    });
    document.querySelectorAll('[role="dialog"]').forEach((el) => {
      recenter.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    });
  }

  Object.assign(App, { setupDialogDrag });
})();
