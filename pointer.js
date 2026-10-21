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
      S.selectedId = null;
      S.selectedAnnId = null;
      App.updateControls();
      S.drag = { kind: 'pan', sx, sy, view: S.view };
    }
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
    S.draft = App.makeDraft(S.tool, w);
    S.drag = { kind: 'draw', sx, sy, start: w };
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
    if (S.tool === 'select') beginSelectDrag(sx, sy, w);
    else beginDraw(sx, sy, w);
    App.render();
  });

  function cursorFor(sx, sy) {
    if (S.spaceDown) return 'grab';
    if (S.tool !== 'select') return S.tool === 'text' ? 'text' : 'crosshair';
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
      canvas.style.cursor = cursorFor(sx, sy);
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
        S.annotations = Scene.translateOwned(drag.annStart, drag.id, dx + snap.dx, dy + snap.dy);
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
      case 'draw':
        App.updateDraft(w, e.shiftKey);
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

  function endDrag(e) {
    if (!S.drag) return;
    const finished = S.drag;
    S.drag = null;
    S.guides = [];
    if (finished.kind === 'draw') {
      App.commitDraft();
    } else if (finished.kind !== 'pan' && !finished.moved) {
      dropLastHistory(); // a plain click must not leave an empty undo step behind
    } else if (finished.kind === 'ann-move') {
      reassignOwner(finished.id);
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
