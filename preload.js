const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge: the renderer can subscribe to these two events from the tray/main process, and use
// the clipboard history that the main process records.
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
});
