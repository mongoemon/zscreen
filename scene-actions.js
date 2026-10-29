'use strict';

// Whole-scene actions: add images (paste / drop / picker), delete, clear and re-stack.
(() => {
  const { C, state: S, pushHistory, toast } = App;

  /** `record: false` keeps an image out of the history (it came from there, or is an internal copy). */
  async function addBlobs(blobs, { record = true } = {}) {
    const images = blobs.filter((b) => b && b.type.startsWith('image/'));
    if (images.length === 0) {
      toast('toast.noImageFiles');
      return;
    }

    const wasEmpty = S.items.length === 0;
    const bitmaps = [];
    for (const blob of images) {
      try {
        bitmaps.push(await createImageBitmap(blob));
      } catch (err) {
        console.error('decode failed', err);
        toast('toast.someFailed');
      }
    }
    if (bitmaps.length === 0) return;
    if (record && App.webHistory) App.webHistory.record(images);

    const sizes = bitmaps.map((b) => ({ w: b.width, h: b.height }));
    const placed = Scene.stackPositions(S.items, sizes, C.GAP);
    const added = bitmaps.map((bitmap, i) => ({ id: S.nextId++, bitmap, ...placed[i] }));

    pushHistory();
    S.items = [...S.items, ...added];
    App.setSelection({ itemIds: [added[added.length - 1].id], annIds: [] });
    if (wasEmpty) App.fitView();
    else App.revealItem(added[0]);
    App.render();
    toast('toast.added', { count: added.length });
  }

  async function pasteFromClipboardApi() {
    try {
      const clipItems = await navigator.clipboard.read();
      const blobs = [];
      for (const ci of clipItems) {
        const type = ci.types.find((t) => t.startsWith('image/'));
        if (type) blobs.push(await ci.getType(type));
      }
      if (blobs.length === 0) {
        toast('toast.clipboardEmpty');
        return;
      }
      await addBlobs(blobs);
    } catch (err) {
      console.error(err);
      toast('toast.clipboardUnreadable');
    }
  }

  function deleteGroup() {
    const { itemIds, annIds } = S.group;
    pushHistory();
    S.items = S.items.filter((it) => !itemIds.includes(it.id));
    // annotations go with their image, and the explicitly selected ones go too
    S.annotations = S.annotations.filter((a) => !annIds.includes(a.id) && !itemIds.includes(a.ownerId));
    App.clearSelection();
    App.render();
  }

  function deleteSelected() {
    if (App.groupSize() > 0) {
      deleteGroup();
      return;
    }
    if (S.selectedAnnId !== null) {
      pushHistory();
      S.annotations = S.annotations.filter((a) => a.id !== S.selectedAnnId);
      S.selectedAnnId = null;
    } else if (S.selectedId !== null) {
      pushHistory();
      const id = S.selectedId;
      S.items = S.items.filter((it) => it.id !== id);
      S.annotations = S.annotations.filter((a) => a.ownerId !== id); // annotations go with their image
      S.selectedId = null;
    } else {
      return;
    }
    App.updateControls();
    App.render();
  }

  function clearAll() {
    if (S.items.length === 0 && S.annotations.length === 0) return;
    pushHistory();
    S.items = [];
    S.annotations = [];
    App.clearSelection();
    App.fitView();
    App.render();
  }

  function arrangeVertically() {
    if (S.items.length === 0) return;
    pushHistory();
    const arranged = Scene.arrangeVertically(S.items, C.GAP);
    S.annotations = Scene.carryAnnotations(S.annotations, S.items, arranged);
    S.items = arranged;
    App.fitView();
    App.render();
  }

  Object.assign(App, { addBlobs, pasteFromClipboardApi, deleteSelected, clearAll, arrangeVertically });
})();
