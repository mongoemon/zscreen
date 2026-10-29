'use strict';

// Export: flatten images + annotations into one PNG at native resolution (save or copy).
(() => {
  const { state: S, toast } = App;

  function composeCanvas(list, anns) {
    const b = Scene.boundsOf([...list, ...anns.map(Scene.annotationBounds)]);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.ceil(b.w));
    out.height = Math.max(1, Math.ceil(b.h));
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.translate(-b.x, -b.y);
    for (const it of list) octx.drawImage(it.bitmap, it.x, it.y, it.w, it.h);
    Draw.drawAnnotations(octx, anns, { items: list, pxScale: 1 });
    return out;
  }

  const toPngBlob = (c) => new Promise((resolve, reject) => {
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });

  async function savePng() {
    App.commitText();
    if (S.items.length === 0 && S.annotations.length === 0) {
      toast('toast.noImages');
      return;
    }
    try {
      const blob = await toPngBlob(composeCanvas(S.items, S.annotations));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `zcreenshot-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error(err);
      toast('toast.saveFailed');
    }
  }

  // Copies the selected image (with its annotations); the whole composition when nothing is selected.
  async function copyImage() {
    App.commitText();
    if (S.items.length === 0) {
      toast('toast.noImages');
      return;
    }
    const selAnn = App.selectedAnnotation();
    const target = App.selected() || (selAnn && S.items.find((it) => it.id === selAnn.ownerId)) || null;
    const list = target ? [target] : S.items;
    const anns = target ? S.annotations.filter((a) => a.ownerId === target.id) : S.annotations;
    try {
      const blob = await toPngBlob(composeCanvas(list, anns));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(target ? 'toast.copiedSelected' : 'toast.copiedAll');
    } catch (err) {
      console.error(err);
      toast('toast.copyFailed');
    }
  }

  // Copies every image with all annotations as one picture, whatever is selected.
  async function copyAll() {
    App.commitText();
    if (S.items.length === 0) {
      toast('toast.noImages');
      return;
    }
    try {
      const blob = await toPngBlob(composeCanvas(S.items, S.annotations));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('toast.copiedAll');
    } catch (err) {
      console.error(err);
      toast('toast.copyFailed');
    }
  }

  Object.assign(App, { composeCanvas, toPngBlob, savePng, copyImage, copyAll });
})();
