'use strict';

// Creating annotations: the live draft while dragging, and one-click kinds (number badge, text).
(() => {
  const { state: S, pushHistory } = App;

  const MIN_SHAPE = 3; // smaller drags are treated as accidental clicks (world px)
  const STEP_RADIUS = 14;

  function makeDraft(type, w) {
    const base = {
      id: S.nextAnnId++,
      ownerId: Scene.ownerAt(S.items, w.x, w.y),
      type,
      color: S.style.color,
      width: S.style.width,
    };
    if (type === 'pen') return { ...base, points: [w] };
    if (type === 'line' || type === 'arrow') return { ...base, x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    if (type === 'censor') return { ...base, x: w.x, y: w.y, w: 0, h: 0, mode: S.style.censorMode };
    return { ...base, x: w.x, y: w.y, w: 0, h: 0 }; // rect, ellipse, highlight
  }

  function updateDraft(w, shift) {
    const s = S.drag.start;
    const draft = S.draft;
    if (draft.type === 'pen') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(w.x - last.x, w.y - last.y) < 1 / S.view.scale) return;
      S.draft = { ...draft, points: [...draft.points, w] };
      return;
    }
    const end = shift ? Scene.constrainEnd(draft.type, s.x, s.y, w.x, w.y) : w;
    if (draft.type === 'line' || draft.type === 'arrow') {
      S.draft = { ...draft, x2: end.x, y2: end.y };
    } else {
      S.draft = { ...draft, ...Scene.normalizeRect(s.x, s.y, end.x, end.y) };
    }
  }

  function isTooSmall(a) {
    if (a.type === 'pen') return a.points.length < 2;
    if (a.type === 'line' || a.type === 'arrow') return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < MIN_SHAPE;
    return a.w < MIN_SHAPE || a.h < MIN_SHAPE;
  }

  function commitDraft() {
    const a = S.draft;
    S.draft = null;
    if (!a || isTooSmall(a)) return;
    pushHistory();
    S.annotations = [...S.annotations, a];
    App.selectAnnotation(a);
    // an arrow invites a label right away (Enter / Esc / click away to skip it)
    if (a.type === 'arrow') App.openTextEditor({ ...a, fresh: true });
  }

  function placeStep(w) {
    const a = {
      id: S.nextAnnId++,
      ownerId: Scene.ownerAt(S.items, w.x, w.y),
      type: 'step',
      x: w.x,
      y: w.y,
      n: Scene.nextStepNumber(S.annotations),
      size: STEP_RADIUS,
      color: S.style.color,
    };
    pushHistory();
    S.annotations = [...S.annotations, a];
    App.selectAnnotation(a);
    App.render();
  }

  function startText(w) {
    App.openTextEditor({
      id: S.nextAnnId++,
      ownerId: Scene.ownerAt(S.items, w.x, w.y),
      type: 'text',
      x: w.x,
      y: w.y,
      w: 0,
      h: 0,
      text: '',
      size: S.style.fontSize,
      color: S.style.color,
      bg: S.style.textBg,
    });
  }

  Object.assign(App, { makeDraft, updateDraft, commitDraft, placeStep, startText });
})();
