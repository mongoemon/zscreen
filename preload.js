const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge: the renderer can subscribe to these two events from the tray/main process, use
// the clipboard history that the main process records, record the screen and change the
// system-wide shortcuts.
contextBridge.exposeInMainWorld('zcreenshot', {
  onClipboardImage: (callback) => {
    ipcRenderer.on('clipboard-image', (_event, bytes) => callback(bytes));
  },
  onClipboardEmpty: (callback) => {
    ipcRenderer.on('clipboard-empty', () => callback());
  },
  history: {
    getState: () => ipcRenderer.invoke('history:state'),
    onChanged: (callback) => {
      ipcRenderer.on('history:changed', (_event, items) => callback(items));
    },
    onVisible: (callback) => {
      ipcRenderer.on('history:visible', (_event, visible) => callback(visible));
    },
    setVisible: (visible) => ipcRenderer.send('history:set-visible', visible),
    use: (id) => ipcRenderer.send('history:use', id),
    remove: (id) => ipcRenderer.send('history:remove', id),
    clear: () => ipcRenderer.send('history:clear'),
  },
  // Screen recording: list screens/windows, pick one for the next getDisplayMedia() call, and tell
  // the main process when recording starts/stops (it hides the window and offers tray/shortcut stop).
  capture: {
    getSources: () => ipcRenderer.invoke('capture:sources'),
    select: (source) => ipcRenderer.invoke('capture:select', source),
    setRecording: (recording, options) => ipcRenderer.send('capture:recording', recording, options),
    onStop: (callback) => {
      ipcRenderer.on('capture:stop', () => callback());
    },
    onOpen: (callback) => {
      ipcRenderer.on('capture:open', (_event, mode) => callback(mode));
    },
    onToggle: (callback) => {
      ipcRenderer.on('capture:toggle', () => callback());
    },
    onToggleScroll: (callback) => {
      ipcRenderer.on('capture:toggle-scroll', () => callback());
    },
  },
  // System-wide shortcuts live in the main process (registered before any window exists).
  shortcuts: {
    get: () => ipcRenderer.invoke('shortcuts:get'),
    set: (id, bindings) => ipcRenderer.invoke('shortcuts:set', id, bindings),
  },
});
