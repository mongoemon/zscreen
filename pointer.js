'use strict';

// Pointer interaction on the canvas: select / move / resize images and annotations, draw new
// annotations, pan (space or middle button or empty space) and wheel zoom / scroll.
(() => {
  const {
    C, dom, state: S, pointerPos, pushHistory, dropLastHistory, updateItem, replaceAnnotation,
    selected, selectedAnnotation,
  } = App;
  const { canvas } = dom;

  const hitHandle = (sx, sy) => Scene.hitHandle(selected(), S.view, sx, sy, C.HANDLE);
  const hitItem = (sx, sy) => Scene.hitItem(S.items, S.view, sx, sy);
  const hitAnnotationAt = (w) => Scene.hitAnnotation(S.annotations, w, C.HIT_TOLERANCE / S.view.scale);

  function beginSelectDrag(sx, sy, w) {
    const selAnn = selectedAnnotation();
    const handleKey = selAnn && Scene.hitAnnotationHandle(selAnn, w, C.HANDLE / S.view.scale);
    if (handleKey) {
      pushHistory();
      S.drag = { kind: 'ann-handle', sx, sy, id: selAnn.id, key: handleKey, orig: selAnn, moved: false };
      return;
    }

    if (hitHandle(sx, sy)) {
      const it = selected();
      pushHistory();
      S.drag = {
        kind: 'resize', sx, sy, id: it.id, w: it.w, h: it.h, ox: it.x, oy: it.y, annStart: S.annotations, moved: false,
      };
      return;
    }

    if (App.groupSize() > 0) {
      const annUnder = hitAnnotationAt(w);
      const itemUnder = annUnder ? null : hitItem(sx, sy);
      if ((annUnder && App.inGroup('ann', annUnder.id)) || (itemUnder && App.inGroup('item', itemUnder.id))) {
        pushHistory();
        S.drag = { kind: 'group-move', sx, sy, items: S.items, anns: S.annotations, moved: false, carried: false };
        return;
      }
    }

    const ann = hitAnnotationAt(w);
    if (ann) {
      pushHistory();
      // bring to front by reordering (new array, objects untouched)
      S.annotations = [...S.annotations.filter((a) => a.id !== ann.id), ann];
      App.selectAnnotation(ann);
      S.drag = { kind: 'ann-move', sx, sy, id: ann.id, orig: ann, moved: false };
      return;
    }

    const hit = hitItem(sx, sy);
    if (hit) {
      pushHistory();
      S.items = [...S.items.filter((i) => i.id !== hit.id), hit];
      S.selectedId = hit.id;
      S.selectedAnnId = null;
      App.updateControls();
      S.drag = { kind: 'move', sx, sy, id: hit.id, x: hit.x, y: hit.y, annStart: S.annotations, moved: false };
    } else {
      // empty space: drag a selection box (a plain click clears the selection on release)
      S.drag = { kind: 'marquee', sx, sy, start: w, additive: false, base: null, moved: false };
    }
  }

  /** Ctrl/Cmd+press with the select tool: toggle what is under the pointer, or start an additive box. */
  function beginAdditive(sx, sy, w) {
    const ann = hitAnnotationAt(w);
    const item = ann ? null : hitItem(sx, sy);
    if (ann) App.toggleInSelection('ann', ann.id);
    else if (item) App.toggleInSelection('item', item.id);
    else S.drag = { kind: 'marquee', sx, sy, start: w, additive: true, base: App.currentSelection(), moved: false };
  }

  /** Moves every selected object; their annotations stay behind unless Shift is held. */
  function moveGroup(drag, dx, dy, carry) {
    const { itemIds, annIds } = S.group;
    drag.carried = carry;
    S.items = drag.items.map((it) => (itemIds.includes(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it));
    S.annotations = drag.anns.map((a) => {
      const follows = annIds.includes(a.id) || (carry && itemIds.includes(a.ownerId));
      return follows ? Scene.translateAnnotation(a, dx, dy) : a;
    });
  }

  /** Alt+press on an edge of the selected image starts cropping it; false when the press is not on an edge. */
  function beginCrop(sx, sy) {
    const it = selected();
    const edges = Scene.hitImageEdge(it, S.view, sx, sy, C.HANDLE);
    if (!edges) return false;
    const orig = { x: it.x, y: it.y, w: it.w, h: it.h };
    S.drag = { kind: 'crop', sx, sy, id: it.id, edges, orig, moved: false };
    S.crop = { orig, rect: orig };
    return true;
  }

  /** Cuts the image down to the dragged rect (undoable: history keeps the old bitmap). */
  async function finishCrop({ id, orig, moved }) {
    const crop = S.crop;
    S.crop = null;
    const item = S.items.find((it) => it.id === id);
    if (!moved || !crop || !item || (crop.rect.w === orig.w && crop.rect.h === orig.h)) return;
    const { rect } = crop;
    const { sx, sy, sw, sh } = Scene.cropSource(item, rect, item.bitmap.width, item.bitmap.height);
    try {
      const bitmap = await createImageBitmap(item.bitmap, sx, sy, sw, sh);
      pushHistory();
      updateItem(id, { bitmap, ...rect });
    } catch (err) {
      console.error('crop failed', err);
      App.toast('toast.cropFailed');
    }
    App.render();
  }

  function finishMarquee({ moved, additive, base }) {
    const box = S.marquee;
    S.marquee = null;
    if (!moved || !box) {
      if (!additive) App.clearSelection();
      return;
    }
    const hits = { itemIds: Scene.itemsInRect(S.items, box), annIds: Scene.annotationsInRect(S.annotations, box) };
    App.setSelection(additive
      ? { itemIds: Scene.mergeIds(base.itemIds, hits.itemIds), annIds: Scene.mergeIds(base.annIds, hits.annIds) }
      : hits);
  }

  function beginDraw(sx, sy, w) {
    if (S.tool === 'text') {
      App.startText(w);
      return;
    }
    if (S.tool === 'step') {
      App.placeStep(w);
      return;
    }
    if (S.tool === 'region') {
      if (App.beginRegion(w)) S.drag = { kind: 'region', sx, sy, start: w };
      return;
    }
    S.draft = App.makeDraft(S.tool, w);
    S.drag = { kind: 'draw', sx, sy, start: w };
  }

  // Shape tools are one-shot: once a shape has just been drawn (it is still selected), the next
  // press manipulates things instead of starting another shape. Re-pick the tool to draw again.
  const ONE_SHOT_TOOLS = new Set(['line', 'arrow', 'rect', 'ellipse']);

  /**
   * How a press with a drawing tool relates to the select tool:
   * 'press' = act as select right now, 'release' = keep drawing on drag and only select on a plain click
   * (a press on an image), null = stay with the drawing tool.
   */
  function selectIntent(sx, sy, w) {
    if (S.tool === 'select' || S.tool === 'region') return null;
    const selAnn = selectedAnnotation();
    if (selAnn && Scene.hitAnnotationHandle(selAnn, w, C.HANDLE / S.view.scale)) return 'press';
    if (hitHandle(sx, sy)) return 'press';
    if (!selAnn || !ONE_SHOT_TOOLS.has(S.tool)) return null;
    return !hitAnnotationAt(w) && hitItem(sx, sy) ? 'release' : 'press';
  }

  canvas.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus handling in our hands

  canvas.addEventListener('pointerdown', (e) => {
    App.commitText();
    const { x: sx, y: sy } = pointerPos(e);
    canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || S.spaceDown) {
      S.drag = { kind: 'pan', sx, sy, view: S.view };
      return;
    }
    if (e.button !== 0) return;

    const w = Scene.toWorld(S.view, sx, sy);
    if (S.tool === 'select' && (e.ctrlKey || e.metaKey)) {
      beginAdditive(sx, sy, w);
      App.render();
      return;
    }
    if (S.tool === 'select' && e.altKey && beginCrop(sx, sy)) {
      App.render();
      return;
    }
    const intent = selectIntent(sx, sy, w);
    if (intent === 'press') App.setTool('select');
    if (S.tool === 'select') beginSelectDrag(sx, sy, w);
    else beginDraw(sx, sy, w);
    if (intent === 'release' && S.drag && S.drag.kind === 'draw') S.drag.selectOnClick = w;
    App.render();
  });

  function cursorFor(sx, sy, alt) {
    if (S.spaceDown) return 'grab';
    if (S.tool !== 'select') return S.tool === 'text' ? 'text' : 'crosshair';
    if (alt && Scene.hitImageEdge(selected(), S.view, sx, sy, C.HANDLE)) return 'crosshair';
    const w = Scene.toWorld(S.view, sx, sy);
    const selAnn = selectedAnnotation();
    if (selAnn && Scene.hitAnnotationHandle(selAnn, w, C.HANDLE / S.view.scale)) return 'pointer';
    if (hitHandle(sx, sy)) return 'nwse-resize';
    return hitAnnotationAt(w) || hitItem(sx, sy) ? 'move' : 'default';
  }

  canvas.addEventListener('pointermove', (e) => {
    const { x: sx, y: sy } = pointerPos(e);
    const drag = S.drag;
    if (!drag) {
      canvas.style.cursor = cursorFor(sx, sy, e.altKey);
      return;
    }

    const w = Scene.toWorld(S.view, sx, sy);
    const dx = (sx - drag.sx) / S.view.scale;
    const dy = (sy - drag.sy) / S.view.scale;
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 2) drag.moved = true;

    switch (drag.kind) {
      case 'pan':
        S.view = { ...drag.view, x: drag.view.x + (sx - drag.sx), y: drag.view.y + (sy - drag.sy) };
        break;
      case 'move': {
        const it = S.items.find((i) => i.id === drag.id);
        const target = { x: drag.x + dx, y: drag.y + dy, w: it.w, h: it.h };
        // hold Alt to move freely without snapping
        const snap = e.altKey
          ? { dx: 0, dy: 0, guides: [] }
          : Scene.snapRect(target, S.items.filter((i) => i.id !== drag.id), C.SNAP_DIST / S.view.scale, C.GAP);
        S.guides = snap.guides;
        updateItem(drag.id, { x: target.x + snap.dx, y: target.y + snap.dy });
        // annotations stay put unless Shift is held, then they travel with their image
        drag.carried = e.shiftKey;
        S.annotations = e.shiftKey
          ? Scene.translateOwned(drag.annStart, drag.id, dx + snap.dx, dy + snap.dy)
          : drag.annStart;
        break;
      }
      case 'resize': {
        const size = Scene.resizeKeepAspect(drag.w, drag.h, dx, C.MIN_ITEM_SIZE);
        updateItem(drag.id, size);
        S.annotations = Scene.scaleOwned(drag.annStart, drag.id, { x: drag.ox, y: drag.oy }, size.w / drag.w);
        break;
      }
      case 'ann-move':
        replaceAnnotation(Scene.translateAnnotation(drag.orig, dx, dy));
        break;
      case 'ann-handle':
        replaceAnnotation(Scene.moveHandle(drag.orig, drag.key, w.x, w.y));
        break;
      case 'group-move':
        moveGroup(drag, dx, dy, e.shiftKey);
        break;
      case 'crop':
        S.crop = { orig: drag.orig, rect: Scene.cropRect(drag.orig, drag.edges, w, C.MIN_ITEM_SIZE) };
        break;
      case 'marquee':
        S.marquee = Scene.normalizeRect(drag.start.x, drag.start.y, w.x, w.y);
        break;
      case 'draw':
        App.updateDraft(w, e.shiftKey);
        break;
      case 'region':
        App.updateRegion(drag.start, w);
        break;
      default:
        break;
    }
    App.render();
  });

  /** After dragging an annotation, it belongs to whichever image it now sits on. */
  function reassignOwner(id) {
    const a = S.annotations.find((x) => x.id === id);
    if (!a) return;
    const b = Scene.annotationBounds(a);
    replaceAnnotation({ ...a, ownerId: Scene.ownerAt(S.items, b.x + b.w / 2, b.y + b.h / 2) });
  }

  /** Annotations left behind by a moved image belong to whichever image they now sit on. */
  function reassignOwned(imageId) {
    S.annotations = S.annotations.map((a) => {
      if (a.ownerId !== imageId) return a;
      const b = Scene.annotationBounds(a);
      return { ...a, ownerId: Scene.ownerAt(S.items, b.x + b.w / 2, b.y + b.h / 2) };
    });
  }

  /** A plain click with a one-shot tool: now, on release, switch to select and pick what was pressed. */
  function selectByClick({ sx, sy, selectOnClick: w }) {
    App.setTool('select');
    beginSelectDrag(sx, sy, w);
    S.drag = null;
    dropLastHistory(); // like any plain click, it must not leave an empty undo step
  }

  function endDrag(e) {
    if (!S.drag) return;
    const finished = S.drag;
    S.drag = null;
    S.guides = [];
    if (finished.kind === 'draw' && finished.selectOnClick && !finished.moved) {
      S.draft = null;
      selectByClick(finished);
    } else if (finished.kind === 'draw' && !finished.moved) {
      // a plain click with a drawing tool draws nothing: deselect and fall back to the select tool
      S.draft = null;
      App.clearSelection();
      App.setTool('select');
    } else if (finished.kind === 'draw') {
      // Shift pressed or released right before letting go still counts for the fill
      if (S.draft && (S.draft.type === 'rect' || S.draft.type === 'ellipse')) S.draft = { ...S.draft, fill: e.shiftKey };
      App.commitDraft();
    } else if (finished.kind === 'region') {
      App.finishRegion();
    } else if (finished.kind === 'marquee') {
      finishMarquee(finished);
    } else if (finished.kind === 'crop') {
      finishCrop(finished);
    } else if (finished.kind !== 'pan' && !finished.moved) {
      dropLastHistory(); // a plain click must not leave an empty undo step behind
    } else if (finished.kind === 'ann-move') {
      reassignOwner(finished.id);
    } else if (finished.kind === 'move' && !finished.carried) {
      reassignOwned(finished.id);
    } else if (finished.kind === 'group-move') {
      if (!finished.carried) S.group.itemIds.forEach(reassignOwned);
      S.group.annIds.forEach(reassignOwner);
    }
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    App.render();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('dblclick', (e) => {
    if (S.tool !== 'select') return;
    const { x, y } = pointerPos(e);
    const hit = hitAnnotationAt(Scene.toWorld(S.view, x, y));
    if (hit && (hit.type === 'text' || hit.type === 'arrow')) App.openTextEditor(hit);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { x: sx, y: sy } = pointerPos(e);
    if (e.ctrlKey || e.metaKey) {
      App.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
    } else {
      S.view = { ...S.view, x: S.view.x - e.deltaX, y: S.view.y - e.deltaY };
      if (S.editing) App.positionEditor();
      App.render();
    }
  }, { passive: false });
})();
