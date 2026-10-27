'use strict';

// Clipboard-history side panel. The desktop app records the real clipboard in the main process;
// the browser has no such access, so web-history.js records pasted / dropped images instead.
// Either way this panel just draws the cards and shows/hides itself on request.
// Double-click (or Enter) on a card puts that image on the canvas.
(() => {
  const bridge = (window.zcreenshot && window.zcreenshot.history) || App.webHistory;
  if (!bridge) return;

  const { $ } = App;
  const panel = $('history-panel');
  const list = $('history-list');
  const empty = $('history-empty');
  const clearButton = $('history-clear');
  const toggleButton = $('btn-history');

  let items = [];
  let visible = false;

  function buildCard(item) {
    const card = document.createElement('li');
    card.className = 'history-card';

    const pick = document.createElement('button');
    pick.className = 'history-pick';
    pick.addEventListener('dblclick', () => bridge.use(item.id));
    pick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') bridge.use(item.id);
    });

    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    img.draggable = false;

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const size = document.createElement('span');
    size.textContent = `${item.width} × ${item.height}`;
    const time = document.createElement('span');
    time.textContent = new Date(item.time).toLocaleTimeString(I18n.getLocale());
    meta.append(size, time);
    pick.append(img, meta);

    const remove = document.createElement('button');
    remove.className = 'history-remove';
    remove.textContent = '×';
    remove.title = I18n.t('history.remove');
    remove.setAttribute('aria-label', I18n.t('history.remove'));
    remove.addEventListener('click', () => bridge.remove(item.id));

    card.append(pick, remove);
    return card;
  }

  function render(next) {
    items = next;
    list.replaceChildren(...items.map(buildCard));
    empty.hidden = items.length > 0;
    clearButton.disabled = items.length === 0;
  }

  function showPanel(next) {
    visible = next;
    panel.hidden = !visible;
    toggleButton.setAttribute('aria-pressed', String(visible));
    App.resizeCanvas(); // the stage just got narrower / wider
  }

  toggleButton.hidden = false;
  toggleButton.addEventListener('click', () => bridge.setVisible(!visible));
  $('history-close').addEventListener('click', () => bridge.setVisible(false));
  clearButton.addEventListener('click', () => bridge.clear());
  bridge.onChanged(render);
  bridge.onVisible(showPanel);
  I18n.subscribe(() => render(items)); // card tooltips and times follow the language
  bridge.getState()
    .then((state) => {
      if (!state) return;
      render(state.items);
      showPanel(state.visible);
    })
    .catch((err) => console.error('could not load the clipboard history', err));
})();
