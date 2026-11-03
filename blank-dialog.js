'use strict';

// "New blank page" dialog: pick a preset (paper sizes at a DPI, screen, social) or type any width x
// height, then the page is added to the canvas as a plain image, so every tool and export works on it.
// The last choices are remembered in localStorage (a convenience only; defaults come from BlankPage).
(() => {
  const { $, toast } = App;

  const STORAGE_KEY = 'zcreenshot.blankPage';
  const CUSTOM = 'custom';
  const GROUP_TITLES = Object.freeze({ paper: 'blank.groupPaper', screen: 'blank.groupScreen', social: 'blank.groupSocial' });

  const dialog = $('blank-dialog');
  const form = $('blank-form');
  const presetSelect = $('blank-preset');
  const dpiSelect = $('blank-dpi');
  const widthInput = $('blank-width');
  const heightInput = $('blank-height');
  const colorInput = $('blank-color');
  const transparentInput = $('blank-transparent');
  const info = $('blank-info');

  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) { // blocked storage or a damaged value: start from the defaults
      return {};
    }
  }

  function store(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (err) {
      console.warn('could not remember the blank page size', err);
    }
  }

  const dpi = () => Number(dpiSelect.value) || BlankPage.DEFAULTS.dpi;
  const fieldSize = () => ({
    width: BlankPage.clampSide(widthInput.value, BlankPage.MIN_SIDE),
    height: BlankPage.clampSide(heightInput.value, BlankPage.MIN_SIDE),
  });
  const fmt = (n) => (Math.round(n * 10) / 10).toString();

  function presetText(p) {
    if (p.unit === 'mm') return `${p.id} · ${fmt(p.w)} × ${fmt(p.h)} mm`;
    return `${I18n.t(p.label)} · ${p.w} × ${p.h}`;
  }

  function buildOptions() {
    const selected = presetSelect.value;
    const custom = document.createElement('option');
    custom.value = CUSTOM;
    custom.textContent = I18n.t('blank.custom');
    const groups = BlankPage.GROUPS.map((group) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = I18n.t(GROUP_TITLES[group]);
      optgroup.append(...BlankPage.PRESETS.filter((p) => p.group === group).map((p) => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = presetText(p);
        return option;
      }));
      return optgroup;
    });
    presetSelect.replaceChildren(custom, ...groups);
    if (selected) presetSelect.value = selected;

    const chosenDpi = dpiSelect.value;
    dpiSelect.replaceChildren(...BlankPage.DPIS.map((d) => {
      const option = document.createElement('option');
      option.value = String(d);
      option.textContent = I18n.t('blank.dpiValue', { dpi: d });
      return option;
    }));
    if (chosenDpi) dpiSelect.value = chosenDpi;
  }

  function updateInfo() {
    const { width, height } = fieldSize();
    const mm = (px) => fmt((px / dpi()) * 25.4);
    info.textContent = I18n.t('blank.info', {
      width, height, mmWidth: mm(width), mmHeight: mm(height), dpi: dpi(),
    });
    colorInput.disabled = transparentInput.checked;
  }

  function setFields(size) {
    widthInput.value = String(size.width);
    heightInput.value = String(size.height);
  }

  /** Fills the size from the chosen preset, keeping the orientation the fields already have. */
  function applyPreset() {
    const { width, height } = fieldSize();
    const landscape = width === height ? null : width > height;
    const size = BlankPage.sizeFor(presetSelect.value, dpi(), landscape);
    if (size) setFields(size);
    updateInfo();
  }

  /** Typed sizes select the matching preset, or "custom". */
  function syncPreset() {
    const { width, height } = fieldSize();
    presetSelect.value = BlankPage.matchPreset(width, height, dpi()) || CUSTOM;
    updateInfo();
  }

  const isBlankDialogOpen = () => !dialog.hidden;

  function openBlankDialog() {
    const saved = readStored();
    buildOptions();
    dpiSelect.value = String(BlankPage.DPIS.includes(saved.dpi) ? saved.dpi : BlankPage.DEFAULTS.dpi);
    if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
      setFields({ width: BlankPage.clampSide(saved.width), height: BlankPage.clampSide(saved.height) });
    } else {
      setFields(BlankPage.sizeFor(BlankPage.DEFAULTS.preset, dpi()));
    }
    colorInput.value = /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : BlankPage.DEFAULTS.color;
    transparentInput.checked = saved.transparent === true;
    syncPreset();
    dialog.hidden = false;
    presetSelect.focus();
  }

  function closeBlankDialog() {
    dialog.hidden = true;
    $('btn-blank').focus();
  }

  async function createPage() {
    const { width, height } = fieldSize();
    const page = document.createElement('canvas');
    page.width = width;
    page.height = height;
    if (!transparentInput.checked) {
      const ctx = page.getContext('2d');
      ctx.fillStyle = colorInput.value;
      ctx.fillRect(0, 0, width, height);
    }
    let bitmap;
    try {
      bitmap = await createImageBitmap(page);
    } catch (err) {
      console.error('blank page failed', err);
      toast('toast.blankFailed');
      return;
    }
    store({
      width, height, dpi: dpi(), color: colorInput.value, transparent: transparentInput.checked,
    });
    closeBlankDialog();
    App.placeBitmaps([bitmap]);
    toast('toast.blankAdded', { width, height });
  }

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value !== CUSTOM) applyPreset();
    else updateInfo();
  });
  dpiSelect.addEventListener('change', () => {
    const p = BlankPage.getPreset(presetSelect.value);
    if (p && p.unit === 'mm') applyPreset(); // paper keeps its size in mm, so the pixels change
    else syncPreset();
  });
  widthInput.addEventListener('input', syncPreset);
  heightInput.addEventListener('input', syncPreset);
  [widthInput, heightInput].forEach((input) => input.addEventListener('change', () => {
    input.value = String(BlankPage.clampSide(input.value, BlankPage.MIN_SIDE));
    syncPreset();
  }));
  $('blank-swap').addEventListener('click', () => {
    const { width, height } = fieldSize();
    setFields({ width: height, height: width });
    syncPreset();
  });
  transparentInput.addEventListener('change', updateInfo);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    createPage();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeBlankDialog();
    }
  });
  dialog.addEventListener('pointerdown', (e) => { if (e.target === dialog) closeBlankDialog(); });
  $('blank-close').addEventListener('click', closeBlankDialog);
  $('btn-blank').addEventListener('click', openBlankDialog);
  I18n.subscribe(() => {
    if (!isBlankDialogOpen()) return;
    buildOptions();
    updateInfo();
  });

  Object.assign(App, { openBlankDialog, closeBlankDialog, isBlankDialogOpen });
})();
