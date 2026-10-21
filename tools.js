'use strict';

// Tool palette and style controls (colour, stroke width, font size, label background, censor mode).
// Style changes also apply to the selected annotation, coalesced into one undo step per drag.
(() => {
  const { C, dom, state: S, pushHistory, selectedAnnotation, replaceAnnotation } = App;
  const { ctl } = dom;

  // which style controls are relevant for each tool / selected annotation type
  const CONTROLS_FOR = {
    select: [], pen: ['color', 'width'], line: ['color', 'width'], arrow: ['color', 'width', 'stroke'],
    rect: ['color', 'width'], ellipse: ['color', 'width'], highlight: ['color'],
    text: ['color', 'text', 'stroke'], step: ['color'], censor: ['censor'], region: ['region'],
  };
  // annotation properties that each style control may change
  const EDITABLE_PROPS = {
    pen: ['color', 'width'], line: ['color', 'width'], arrow: ['color', 'width', 'stroke'],
    rect: ['color', 'width'], ellipse: ['color', 'width'], highlight: ['color'],
    text: ['color', 'size', 'bg', 'stroke'], step: ['color'], censor: ['mode'],
  };

  function updateControls() {
    const selAnn = selectedAnnotation();
    const kind = selAnn ? selAnn.type : S.tool;
    const shown = CONTROLS_FOR[kind] || [];
    document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !shown.includes(el.dataset.for); });
  }

  function setTool(name) {
    App.commitText();
    S.tool = name;
    S.draft = null;
    S.region = null;
    if (name !== 'select') {
      S.selectedId = null;
      S.selectedAnnId = null;
    }
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
    dom.canvas.style.cursor = name === 'select' ? 'default' : name === 'text' ? 'text' : 'crosshair';
    updateControls();
    App.render();
  }

  function syncControlsFrom(a) {
    if (a.color) { S.style.color = a.color; ctl.color.value = a.color; }
    if (a.width) { S.style.width = a.width; ctl.width.value = a.width; }
    if (a.type === 'text' || a.type === 'arrow') {
      S.style.textStroke = !!a.stroke; ctl.stroke.checked = !!a.stroke;
    }
    if (a.type === 'text') {
      S.style.fontSize = a.size; ctl.font.value = a.size;
      S.style.textBg = a.bg; ctl.bg.checked = a.bg;
    }
    if (a.type === 'censor') { S.style.censorMode = a.mode; ctl.censor.value = a.mode; }
  }

  function selectAnnotation(a) {
    S.selectedAnnId = a ? a.id : null;
    S.selectedId = null;
    S.styleEditOpen = false;
    if (a) syncControlsFrom(a);
    updateControls();
  }

  /** Text size depends on the style (font size / arrow width), so refresh the measured box. */
  function remeasure(a) {
    if (a.type === 'text') return { ...a, ...Draw.measureText(a) };
    if (a.type === 'arrow') return { ...a, ...Draw.measureArrowLabel(a) };
    return a;
  }

  /** Apply a style change to the selected annotation (one undo step per slider/colour drag). */
  function applyStyle(patch) {
    const sel = selectedAnnotation();
    if (!sel) return;
    const allowed = EDITABLE_PROPS[sel.type] || [];
    const changes = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    if (Object.keys(changes).length === 0) return;
    if (!S.styleEditOpen) {
      pushHistory();
      S.styleEditOpen = true;
    }
    const next = { ...sel, ...changes };
    replaceAnnotation(remeasure(next));
    App.render();
  }

  function buildSwatches() {
    const host = App.$('swatches');
    C.SWATCHES.forEach((color) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = color;
      b.style.background = color;
      b.addEventListener('click', () => {
        S.style.color = color;
        ctl.color.value = color;
        applyStyle({ color });
        S.styleEditOpen = false;
      });
      host.appendChild(b);
    });
  }

  ctl.color.addEventListener('input', () => { S.style.color = ctl.color.value; applyStyle({ color: S.style.color }); });
  ctl.width.addEventListener('input', () => { S.style.width = Number(ctl.width.value); applyStyle({ width: S.style.width }); });
  ctl.font.addEventListener('input', () => { S.style.fontSize = Number(ctl.font.value); applyStyle({ size: S.style.fontSize }); });
  ctl.bg.addEventListener('change', () => { S.style.textBg = ctl.bg.checked; applyStyle({ bg: S.style.textBg }); });
  ctl.stroke.addEventListener('change', () => { S.style.textStroke = ctl.stroke.checked; applyStyle({ stroke: S.style.textStroke }); });
  ctl.censor.addEventListener('change', () => { S.style.censorMode = ctl.censor.value; applyStyle({ mode: S.style.censorMode }); });
  Object.values(ctl).forEach((el) => el.addEventListener('change', () => { S.styleEditOpen = false; }));

  Object.assign(App, { updateControls, setTool, selectAnnotation, buildSwatches });
})();
