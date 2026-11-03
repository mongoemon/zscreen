'use strict';

// Sizes for a new blank page: paper / screen / social presets, mm -> px at a chosen DPI, orientation
// and limits. Pure (no DOM) so it loads in the browser (global `BlankPage`) and in Node unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BlankPage = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Paper sizes are in mm (portrait) and become pixels at the chosen DPI; the others are pixels.
   * `label` is an I18n key, or null when the id itself is the name (A4, Letter...).
   * @typedef {{id:string, group:'paper'|'screen'|'social', w:number, h:number, unit:'mm'|'px', label:string|null}} Preset
   */
  const preset = (id, group, w, h, unit, label = null) => Object.freeze({ id, group, w, h, unit, label });

  /** @type {readonly Preset[]} */
  const PRESETS = Object.freeze([
    preset('A3', 'paper', 297, 420, 'mm'),
    preset('A4', 'paper', 210, 297, 'mm'),
    preset('A5', 'paper', 148, 210, 'mm'),
    preset('B5', 'paper', 176, 250, 'mm'),
    preset('Letter', 'paper', 215.9, 279.4, 'mm'),
    preset('Legal', 'paper', 215.9, 355.6, 'mm'),
    preset('hd', 'screen', 1280, 720, 'px', 'preset.hd'),
    preset('fhd', 'screen', 1920, 1080, 'px', 'preset.fhd'),
    preset('qhd', 'screen', 2560, 1440, 'px', 'preset.qhd'),
    preset('square', 'social', 1080, 1080, 'px', 'preset.square'),
    preset('portraitPost', 'social', 1080, 1350, 'px', 'preset.portraitPost'),
    preset('story', 'social', 1080, 1920, 'px', 'preset.story'),
    preset('linkPreview', 'social', 1200, 630, 'px', 'preset.linkPreview'),
  ]);
  const GROUPS = Object.freeze(['paper', 'screen', 'social']);
  const DPIS = Object.freeze([72, 96, 150, 300]);
  const MIN_SIDE = 16;
  const MAX_SIDE = 10000; // browsers refuse much larger canvases
  const DEFAULTS = Object.freeze({ preset: 'A4', dpi: 96, color: '#ffffff' });

  const byId = new Map(PRESETS.map((p) => [p.id, p]));
  const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);

  /** A whole number of pixels within [MIN_SIDE, MAX_SIDE]; `fallback` when the input is not a number. */
  function clampSide(value, fallback = MIN_SIDE) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(MAX_SIDE, Math.max(MIN_SIDE, n));
  }

  /**
   * Pixel size of a preset. `landscape` puts the long side across; null keeps the preset's own shape.
   * @returns {{width:number, height:number} | null} null for an unknown preset
   */
  function sizeFor(id, dpi, landscape = null) {
    const p = byId.get(id);
    if (!p) return null;
    const w = p.unit === 'mm' ? mmToPx(p.w, dpi) : p.w;
    const h = p.unit === 'mm' ? mmToPx(p.h, dpi) : p.h;
    const swap = landscape !== null && landscape !== w > h && w !== h;
    return { width: clampSide(swap ? h : w), height: clampSide(swap ? w : h) };
  }

  /** The preset with exactly this size at `dpi` (either orientation), or null. */
  function matchPreset(width, height, dpi) {
    const found = PRESETS.find((p) => {
      const s = sizeFor(p.id, dpi);
      return (s.width === width && s.height === height) || (s.width === height && s.height === width);
    });
    return found ? found.id : null;
  }

  return {
    PRESETS,
    GROUPS,
    DPIS,
    MIN_SIDE,
    MAX_SIDE,
    DEFAULTS,
    getPreset: (id) => byId.get(id) || null,
    mmToPx,
    clampSide,
    sizeFor,
    matchPreset,
  };
});
