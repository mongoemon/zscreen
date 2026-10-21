'use strict';

// Region tool: drag a box over one image, then copy just that part or paste it as a new image.
// The region is clipped to the image it started on and is transient (not part of undo history).
(() => {
  const { state: S, toast } = App;

  const MIN_REGION = 4; // smaller drags are treated as accidental clicks (world px)

  const clearRegion = () => { S.region = null; };

  /** Start a region on the image under the world point `w`; returns that image (or null). */
  function beginRegion(w) {
    const { view } = S;
    const item = Scene.hitItem(S.items, view, w.x * view.scale + view.x, w.y * view.scale + view.y);
    S.region = item ? { itemId: item.id, x: w.x, y: w.y, w: 0, h: 0 } : null;
    return item;
  }

  function updateRegion(start, w) {
    const item = S.items.find((it) => it.id === (S.region && S.region.itemId));
    if (!item) return;
    const box = Scene.intersectRect(Scene.normalizeRect(start.x, start.y, w.x, w.y), item);
    S.region = { itemId: item.id, ...(box || { x: start.x, y: start.y, w: 0, h: 0 }) };
  }

  /** Drop a region that is too small to be intentional. */
  function finishRegion() {
    if (S.region && (S.region.w < MIN_REGION || S.region.h < MIN_REGION)) clearRegion();
  }

  /** Render the region at the image's native resolution, annotations on that image included. */
  function regionCanvas() {
    const r = S.region;
    const item = S.items.find((it) => it.id === r.itemId);
    const k = item.bitmap.width / item.w;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(r.w * k));
    out.height = Math.max(1, Math.round(r.h * k));
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.scale(k, k);
    octx.translate(-r.x, -r.y);
    octx.drawImage(item.bitmap, item.x, item.y, item.w, item.h);
    const owned = S.annotations.filter((a) => a.ownerId === item.id);
    Draw.drawAnnotations(octx, owned, { items: [item], pxScale: k });
    return out;
  }

  async function regionBlob() {
    if (!S.region) {
      toast('toast.noRegion');
      return null;
    }
    return App.toPngBlob(regionCanvas());
  }

  async function copyRegion() {
    try {
      const blob = await regionBlob();
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('toast.regionCopied');
    } catch (err) {
      console.error(err);
      toast('toast.copyFailed');
    }
  }

  /** Add the region to the stack as its own image, then go back to the select tool. */
  async function pasteRegion() {
    try {
      const blob = await regionBlob();
      if (!blob) return;
      App.setTool('select');
      await App.addBlobs([blob]);
    } catch (err) {
      console.error(err);
      toast('toast.regionFailed');
    }
  }

  Object.assign(App, {
    clearRegion, beginRegion, updateRegion, finishRegion, copyRegion, pasteRegion,
  });
})();
