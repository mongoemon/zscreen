'use strict';

// Entry point. All behaviour lives in the modules loaded before this script (see index.html):
//   app.js           shared namespace: constants, DOM handles, state, history
//   viewport.js      canvas sizing, fit/zoom, render pass
//   text-editor.js   in-place text editing
//   tools.js         tool palette + style controls
//   annotate.js      creating annotations
//   scene-actions.js add/delete/clear/arrange images
//   export.js        flatten + save/copy PNG
//   pointer.js       mouse / touch / pen interaction
//   input.js         paste, drop, keyboard, toolbar buttons
//   i18n.js          UI strings + locale (pure; also used by main.js for the tray)
//   i18n-dom.js      applies translations to the page + language switcher
//   version-badge.js version number + changelog
(() => {
  // PWA: register the service worker only when served over http(s) (not inside Electron's file://).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // A new worker takes over right away (skipWaiting + claim); reload once so this tab runs the new files too.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch((err) => console.error('sw registration failed', err));
  }

  App.setupLocalization();
  App.setupVersionBadge();
  App.buildSwatches();
  App.updateControls();
  window.addEventListener('resize', App.resizeCanvas);
  App.resizeCanvas();
})();
