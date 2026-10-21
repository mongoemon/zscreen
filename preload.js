const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge: the renderer can only subscribe to these two events from the tray/main process.
contextBridge.exposeInMainWorld('zcreenshot', {
  onClipboardImage: (callback) => {
    ipcRenderer.on('clipboard-image', (_event, bytes) => callback(bytes));
  },
  onClipboardEmpty: (callback) => {
    ipcRenderer.on('clipboard-empty', () => callback());
  },
});
