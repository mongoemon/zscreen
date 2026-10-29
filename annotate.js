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
    const outline = { stroke: S.style.textStroke }; // contrasting rim, shared with the text outline option
    if (type === 'pen') return { ...base, ...outline, points: [w] };
    if (type === 'arrow') return { ...base, ...outline, x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    if (type === 'line') return { ...base, ...outline, x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    if (type === 'censor') return { ...base, x: w.x, y: w.y, w: 0, h: 0, mode: S.style.censorMode };
    if (type === 'highlight') return { ...base, x: w.x, y: w.y, w: 0, h: 0 };
    return { ...base, ...outline, x: w.x, y: w.y, w: 0, h: 0 }; // rect, ellipse
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
    if (draft.type === 'line' || draft.type === 'arrow') {
      const end = shift ? Scene.constrainEnd(draft.type, s.x, s.y, w.x, w.y) : w;
      S.draft = { ...draft, x2: end.x, y2: end.y };
    } else if (draft.type === 'rect' || draft.type === 'ellipse') {
      S.draft = { ...draft, ...Scene.normalizeRect(s.x, s.y, w.x, w.y), fill: !!shift }; // Shift = solid fill
    } else {
      S.draft = { ...draft, ...Scene.normalizeRect(s.x, s.y, w.x, w.y) };
    }
  }

  function isTooSmall(a) {
    if (a.type === 'pen') return a.points.length < 2;
    if (a.type === 'line' || a.type === 'arrow') return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < MIN_SHAPE;
    // a thin box is still a valid shape; only a click-sized drag (both sides tiny) is dropped
    return a.w < MIN_SHAPE && a.h < MIN_SHAPE;
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
      stroke: S.style.textStroke,
    });
  }

  Object.assign(App, { makeDraft, updateDraft, commitDraft, placeStep, startText });
})();
