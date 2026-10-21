'use strict';

// Viewport: canvas sizing, fit/zoom/reveal helpers and the main render pass
// (images, annotations, selection outlines and handles).
(() => {
  const { C, dom, state: S } = App;
  const { canvas, ctx, stage } = dom;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = stage.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    render();
  }

  const contentRects = () => [...S.items, ...S.annotations.map(Scene.annotationBounds)];

  function fitView() {
    const { width, height } = stage.getBoundingClientRect();
    S.view = Scene.fitViewFor(contentRects(), { width, height }, C.VIEW_PAD, C.MIN_SCALE, C.MAX_SCALE);
  }

  function revealItem(it) {
    const { height } = stage.getBoundingClientRect();
    S.view = Scene.revealView(S.view, it, height, C.VIEW_PAD);
  }

  function zoomAt(sx, sy, factor) {
    S.view = Scene.zoomAt(S.view, sx, sy, factor, C.MIN_SCALE, C.MAX_SCALE);
    if (S.editing) App.positionEditor();
    render();
  }

  function zoomCenter(factor) {
    const r = canvas.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }

  function strokeSelectionBox(b, scale) {
    ctx.save();
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeStyle = '#ff7a45';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  function drawHandle(x, y) {
    const hs = C.HANDLE / S.view.scale;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#ff7a45';
    ctx.lineWidth = 2 / S.view.scale;
    ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
    ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
    ctx.restore();
  }

  function drawGuides() {
    if (S.guides.length === 0) return;
    const scale = S.view.scale;
    ctx.save();
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.strokeStyle = '#ff2d95';
    ctx.beginPath();
    for (const g of S.guides) {
      if (g.axis === 'x') { ctx.moveTo(g.pos, g.from); ctx.lineTo(g.pos, g.to); }
      else { ctx.moveTo(g.from, g.pos); ctx.lineTo(g.to, g.pos); }
    }
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const view = S.view;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    ctx.imageSmoothingQuality = 'high';

    for (const it of S.items) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 18 / view.scale;
      ctx.shadowOffsetY = 4 / view.scale;
      ctx.fillStyle = '#fff';
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.restore();
      ctx.drawImage(it.bitmap, it.x, it.y, it.w, it.h);
    }

    // the annotation being edited is hidden (the textarea shows it); an arrow keeps its shaft and head
    const visible = S.annotations.flatMap((a) => {
      if (!S.editing || S.editing.id !== a.id) return [a];
      return a.type === 'arrow' ? [{ ...a, label: '' }] : [];
    });
    Draw.drawAnnotations(ctx, S.draft ? [...visible, S.draft] : visible, {
      items: S.items,
      pxScale: dpr * view.scale,
    });

    const sel = App.selected();
    if (sel) {
      ctx.save();
      ctx.lineWidth = 2 / view.scale;
      ctx.strokeStyle = '#ff7a45';
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
      if (S.tool === 'select') drawHandle(sel.x + sel.w, sel.y + sel.h);
    }

    drawGuides();

    const selAnn = App.selectedAnnotation();
    if (selAnn && !(S.editing && S.editing.id === selAnn.id)) {
      strokeSelectionBox(Scene.annotationBounds(selAnn), view.scale);
      Scene.annotationHandles(selAnn).forEach((h) => drawHandle(h.x, h.y));
    }

    dom.hint.hidden = S.items.length > 0 || S.annotations.length > 0;
    dom.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    dom.btnDelete.disabled = !sel && !selAnn;
    dom.btnUndo.disabled = S.history.length === 0;
  }

  Object.assign(App, { resizeCanvas, fitView, revealItem, zoomAt, zoomCenter, render });
})();
