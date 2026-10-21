'use strict';

// Canvas drawing for annotations. Used both for the live view and for PNG export, so what you see is
// what you save. Coordinates are world units; `env.pxScale` = device pixels per world unit (needed
// because canvas filters such as blur are specified in device pixels, not in the transformed space).
(function (root) {
  const FONT_FAMILY = 'system-ui, "Segoe UI", "Noto Sans Thai", sans-serif';
  const LINE_HEIGHT = 1.3;
  const TEXT_PAD = 6;
  const PIXEL_BLOCK = 12; // mosaic cell size, world px
  const BLUR_RADIUS = 10; // world px

  const scratch = document.createElement('canvas'); // reused for measuring and censor sampling
  const scratchCtx = scratch.getContext('2d');

  const fontOf = (size) => `${size}px ${FONT_FAMILY}`;

  function measureLines(text, size, pad) {
    scratchCtx.font = fontOf(size);
    const lines = text.split('\n');
    const w = Math.max(...lines.map((l) => scratchCtx.measureText(l).width)) + pad;
    return { w, h: lines.length * size * LINE_HEIGHT + pad };
  }

  /** Size of a text annotation (including the label padding when it has a background). */
  const measureText = (a) => measureLines(a.text, a.size, a.bg ? TEXT_PAD * 2 : 0);

  /** Measured size of an arrow's label (its font size comes from the arrow's width); zero when unlabelled. */
  function measureArrowLabel(a) {
    if (!a.label) return { labelW: 0, labelH: 0 };
    const { w, h } = measureLines(a.label, root.Scene.arrowLabelSize(a.width), 0);
    return { labelW: w, labelH: h };
  }

  /** Draw the images that overlap the censor region into the scratch canvas, scaled by `k`. */
  function sampleItems(items, region, k, outW, outH, offsetX, offsetY) {
    scratch.width = Math.max(1, Math.ceil(outW));
    scratch.height = Math.max(1, Math.ceil(outH));
    scratchCtx.imageSmoothingQuality = 'high';
    for (const it of items) {
      scratchCtx.drawImage(
        it.bitmap,
        (it.x - region.x) * k + offsetX,
        (it.y - region.y) * k + offsetY,
        it.w * k,
        it.h * k,
      );
    }
  }

  function drawCensor(ctx, a, env) {
    if (a.w < 1 || a.h < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();

    if (a.mode === 'solid') {
      ctx.fillStyle = '#000';
      ctx.fillRect(a.x, a.y, a.w, a.h);
    } else if (a.mode === 'blur') {
      const pad = BLUR_RADIUS * 3; // sample beyond the box so edges do not fade out
      sampleItems(env.items, a, 1, a.w + pad * 2, a.h + pad * 2, pad, pad);
      ctx.filter = `blur(${BLUR_RADIUS * env.pxScale}px)`;
      ctx.drawImage(scratch, a.x - pad, a.y - pad, scratch.width, scratch.height);
    } else {
      const cols = Math.ceil(a.w / PIXEL_BLOCK);
      const rows = Math.ceil(a.h / PIXEL_BLOCK);
      sampleItems(env.items, a, 1 / PIXEL_BLOCK, cols, rows, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, a.x, a.y, cols * PIXEL_BLOCK, rows * PIXEL_BLOCK);
    }
    ctx.restore();
  }

  function drawArrow(ctx, a) {
    const size = root.Scene.arrowHeadSize(a.width);
    const [tip, left, right] = root.Scene.arrowHeadPoints(a.x1, a.y1, a.x2, a.y2, size);
    const baseX = (left.x + right.x) / 2;
    const baseY = (left.y + right.y) / 2;
    ctx.beginPath();
    ctx.moveTo(a.x1, a.y1);
    ctx.lineTo(baseX, baseY); // stop at the head's base so the stroke does not poke through the tip
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fillStyle = a.color;
    ctx.fill();
    drawArrowLabel(ctx, a);
  }

  /** Label behind the arrow's tail; lines are centred on the label box. */
  function drawArrowLabel(ctx, a) {
    const rect = root.Scene.arrowLabelRect(a);
    if (!rect) return;
    const size = root.Scene.arrowLabelSize(a.width);
    ctx.font = fontOf(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = a.color;
    a.label.split('\n').forEach((line, i) => {
      ctx.fillText(line, rect.x + rect.w / 2, rect.y + i * size * LINE_HEIGHT);
    });
  }

  function drawText(ctx, a) {
    const lines = a.text.split('\n');
    const pad = a.bg ? TEXT_PAD : 0;
    ctx.font = fontOf(a.size);
    ctx.textBaseline = 'top';
    if (a.bg) {
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, a.w, a.h, 6);
      ctx.fill();
    }
    ctx.fillStyle = a.bg ? root.Scene.contrastColor(a.color) : a.color;
    lines.forEach((line, i) => ctx.fillText(line, a.x + pad, a.y + pad + i * a.size * LINE_HEIGHT));
  }

  function drawStep(ctx, a) {
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = root.Scene.contrastColor(a.color);
    ctx.font = `bold ${a.size * 1.15}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(a.n), a.x, a.y + a.size * 0.06);
  }

  function drawOne(ctx, a, env) {
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (a.type) {
      case 'pen':
        ctx.beginPath();
        ctx.moveTo(a.points[0].x, a.points[0].y);
        a.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
        break;
      case 'arrow':
        drawArrow(ctx, a);
        break;
      case 'rect':
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'highlight':
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = a.color;
        ctx.fillRect(a.x, a.y, a.w, a.h);
        break;
      case 'text':
        drawText(ctx, a);
        break;
      case 'step':
        drawStep(ctx, a);
        break;
      case 'censor':
        drawCensor(ctx, a, env);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  /**
   * Draw annotations on top of already-drawn images. Censors go first so they only ever hide the
   * pictures, never another annotation drawn above them.
   */
  function drawAnnotations(ctx, annotations, env) {
    annotations.filter((a) => a.type === 'censor').forEach((a) => drawOne(ctx, a, env));
    annotations.filter((a) => a.type !== 'censor').forEach((a) => drawOne(ctx, a, env));
  }

  root.Draw = {
    drawAnnotations, measureText, measureArrowLabel, TEXT_PAD, fontOf,
  };
})(window);
