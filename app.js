'use strict';

// Shared namespace for the app's plain-script modules (no bundler / ES modules, so the same files run
// from file://, Electron and the PWA). It owns the constants, DOM handles, the single mutable state
// object and a few small helpers. Feature modules attach their public functions to `App` and call
// each other through it at runtime, so script order only matters for load-time wiring.
window.App = (() => {
  const $ = (id) => document.getElementById(id);

  const C = Object.freeze({
    GAP: 16, // vertical gap between stacked images (world px)
    HANDLE: 10, // handle hit size (screen px)
    HIT_TOLERANCE: 6, // pointer tolerance when picking annotations (screen px)
    VIEW_PAD: 40, // margin kept around content when fitting / revealing (screen px)
    MIN_SCALE: 0.05,
    MAX_SCALE: 8,
    MIN_ITEM_SIZE: 24,
    SNAP_DIST: 8, // how close (screen px) a dragged image must get before it snaps to a neighbour
    HISTORY_LIMIT: 50,
    SWATCHES: Object.freeze(['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000']),
  });

  const canvas = $('canvas');
  const dom = {
    canvas,
    ctx: canvas.getContext('2d'),
    stage: $('stage'),
    hint: $('hint'),
    dropMask: $('dropmask'),
    toastEl: $('toast'),
    zoomLabel: $('zoom-label'),
    fileInput: $('file-input'),
    textEditor: $('text-editor'),
    btnDelete: $('btn-delete'),
    btnUndo: $('btn-undo'),
    ctl: {
      color: $('ctl-color'), width: $('ctl-width'), font: $('ctl-font'), bg: $('ctl-bg'), stroke: $('ctl-stroke'), censor: $('ctl-censor'),
    },
  };

  /**
   * @typedef {{id:number, bitmap:ImageBitmap, x:number, y:number, w:number, h:number}} Item
   * Everything the UI mutates lives here. Values are replaced, never edited in place, so history
   * snapshots (which share structure) stay valid.
   */
  const state = {
    /** @type {Item[]} */
    items: [],
    annotations: [], // drawn above all images; each knows its owner image (ownerId)
    selectedId: null, // selected image
    selectedAnnId: null, // selected annotation
    group: { itemIds: [], annIds: [] }, // two or more selected objects (then selectedId / selectedAnnId are null)
    marquee: null, // selection box being dragged (world units)
    crop: null, // {orig, rect}: the image rect and the part that is kept while Alt-dragging an edge (world units)
    draft: null, // annotation being drawn right now
    region: null, // {itemId, x, y, w, h} box picked with the region tool (world units, inside one image)
    editing: null, // text annotation being edited in the textarea
    tool: 'select',
    style: { color: C.SWATCHES[0], width: 8, fontSize: 28, censorMode: 'pixel', textBg: false, textStroke: true },
    view: { x: C.VIEW_PAD, y: C.VIEW_PAD, scale: 1 },
    history: [],
    nextId: 1,
    nextAnnId: 1,
    spaceDown: false,
    drag: null, // active pointer interaction
    guides: [], // snap guide lines shown while dragging an image
    styleEditOpen: false, // true while one slider/colour drag is being coalesced into one undo step
  };

  const selected = () => state.items.find((it) => it.id === state.selectedId) || null;
  const selectedAnnotation = () => state.annotations.find((a) => a.id === state.selectedAnnId) || null;

  let toastTimer = null;
  /** @param {string} key an I18n message key; params fill its {placeholders} */
  function toast(key, params) {
    dom.toastEl.textContent = I18n.t(key, params);
    dom.toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { dom.toastEl.hidden = true; }, 1800);
  }

  function pointerPos(e) {
    const r = dom.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- history: snapshots of images + annotations ----------
  const snapshot = () => ({ items: state.items, annotations: state.annotations });

  function pushHistory() {
    state.history = Scene.pushHistory(state.history, snapshot(), C.HISTORY_LIMIT);
  }

  function dropLastHistory() {
    state.history = state.history.slice(0, -1);
  }

  function undo() {
    const result = Scene.undoHistory(state.history);
    if (!result) {
      toast('toast.nothingToUndo');
      return;
    }
    App.cancelText();
    state.items = result.snapshot.items;
    state.annotations = result.snapshot.annotations;
    state.history = result.history;
    App.pruneSelection();
    App.render();
  }

  function updateItem(id, patch) {
    state.items = state.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
  }

  function replaceAnnotation(next) {
    state.annotations = state.annotations.map((a) => (a.id === next.id ? next : a));
  }

  return {
    $,
    C,
    dom,
    state,
    selected,
    selectedAnnotation,
    toast,
    pointerPos,
    pushHistory,
    dropLastHistory,
    undo,
    updateItem,
    replaceAnnotation,
  };
})();
