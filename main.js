const {
  app, BrowserWindow, Tray, Menu, clipboard, globalShortcut, nativeImage,
} = require('electron');
const path = require('path');
const I18n = require('./i18n.js');
const { createHistoryService } = require('./history-service.js');

const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const PASTE_SHORTCUT = 'CommandOrControl+Shift+V';

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let isQuitting = false;
let rendererReady = false;
/** Messages sent before the renderer finished loading (e.g. first launch from the tray). */
let pending = [];

function send(channel, payload) {
  if (win && rendererReady) {
    win.webContents.send(channel, payload);
  } else {
    pending = [...pending, { channel, payload }];
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1b1c20',
    title: 'Zcreenshot',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    const queued = pending;
    pending = [];
    queued.forEach(({ channel, payload }) => win.webContents.send(channel, payload));
  });

  // Closing the window keeps the app alive in the tray.
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function pasteFromClipboard() {
  const image = clipboard.readImage();
  showWindow();
  if (image.isEmpty()) {
    send('clipboard-empty');
    return;
  }
  send('clipboard-image', image.toPNG());
}

// Images recorded from the clipboard; double-clicking one in the editor's history panel opens it.
const clipboardHistory = createHistoryService({
  getWebContents: () => (win ? win.webContents : null),
  onUse: (png) => {
    showWindow();
    send('clipboard-image', png);
  },
  onVisibleChange: () => { if (tray) tray.setContextMenu(buildTrayMenu()); }, // keep the checkbox in sync
});

function buildTrayMenu() {
  const loginEnabled = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: I18n.t('tray.paste'), accelerator: PASTE_SHORTCUT, click: pasteFromClipboard },
    { label: I18n.t('tray.open'), click: showWindow },
    {
      label: I18n.t('tray.history'),
      type: 'checkbox',
      checked: clipboardHistory.isVisible(),
      click: clipboardHistory.toggle,
    },
    { type: 'separator' },
    {
      label: I18n.t('tray.startWithSystem'),
      type: 'checkbox',
      checked: loginEnabled,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    { label: I18n.t('tray.quit'), click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  const modifier = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  tray.setToolTip(I18n.t('tray.tooltip', { shortcut: `${modifier}+Shift+V` }));
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

// Only one instance: launching again just brings the existing window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    I18n.setLocale(I18n.resolveLocale([app.getLocale()])); // tray follows the OS language
    createWindow();
    createTray();
    clipboardHistory.start();
    if (!globalShortcut.register(PASTE_SHORTCUT, pasteFromClipboard)) {
      console.warn(`Global shortcut ${PASTE_SHORTCUT} is already taken`);
    }
    app.on('activate', showWindow);
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clipboardHistory.stop();
  });
  // Stay alive in the tray when every window is closed.
  app.on('window-all-closed', () => {});
}
