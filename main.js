const {
  app, BrowserWindow, Tray, Menu, clipboard, globalShortcut, nativeImage, shell,
} = require('electron');
const path = require('path');
const I18n = require('./i18n.js');
const { createHistoryService } = require('./history-service.js');
const { createCaptureService } = require('./capture-service.js');
const { createGlobalShortcuts } = require('./global-shortcuts.js');

const ICON_PATH = path.join(__dirname, 'build', 'icon.png');

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
      // no spell check: on Windows/Linux it would download dictionaries from Google's servers,
      // and the app makes no network connections of its own (see the README privacy section)
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // target="_blank" links (GitHub, donate) open in the system browser, not a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

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
  onVisibleChange: () => refreshTray(), // keep the checkbox in sync
});

// Screen recording: the editor records; this process lists sources and offers ways to stop while
// the window is hidden (tray click, tray menu, global shortcut).
const screenCapture = createCaptureService({
  getWindow: () => win,
  onRecordingChange: (recording, { hideWindow }) => {
    if (win) win.webContents.setBackgroundThrottling(!recording); // keep recording while hidden
    if (recording) {
      if (hideWindow && win) win.hide();
    } else {
      showWindow(); // the recording opens in the video editor
    }
    refreshTray();
  },
});

function openRecorder() {
  showWindow();
  send('capture:open', 'video');
}

function openScrollCapture() {
  showWindow();
  send('capture:open', 'scroll');
}

/** Record shortcut: opens the record dialog, starts recording when it is open, stops when recording. */
function toggleRecording() {
  if (screenCapture.isRecording()) {
    screenCapture.requestStop();
    return;
  }
  showWindow();
  send('capture:toggle');
}

/** Scrolling-screenshot shortcut: the same open -> start -> stop, in scroll mode. */
function toggleScrollCapture() {
  if (screenCapture.isRecording()) {
    screenCapture.requestStop();
    return;
  }
  showWindow();
  send('capture:toggle-scroll');
}

// System-wide shortcuts; the user can change them in the editor's settings dialog.
const globalShortcuts = createGlobalShortcuts({
  handlers: { globalPaste: pasteFromClipboard, record: toggleRecording, scrollCapture: toggleScrollCapture },
  getWebContents: () => (win ? win.webContents : null),
  onChange: () => refreshTray(),
});

function onTrayClick() {
  if (screenCapture.isRecording()) screenCapture.requestStop();
  else showWindow();
}

function buildTrayMenu() {
  const loginEnabled = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: I18n.t('tray.paste'), accelerator: globalShortcuts.accelerator('globalPaste'), click: pasteFromClipboard },
    { label: I18n.t('tray.open'), click: showWindow },
    screenCapture.isRecording()
      ? { label: I18n.t('tray.stopRecording'), accelerator: globalShortcuts.accelerator('record'), click: screenCapture.requestStop }
      : { label: I18n.t('tray.record'), accelerator: globalShortcuts.accelerator('record'), click: openRecorder },
    {
      label: I18n.t('tray.scrollCapture'),
      accelerator: globalShortcuts.accelerator('scrollCapture'),
      enabled: !screenCapture.isRecording(),
      click: openScrollCapture,
    },
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
        refreshTray();
      },
    },
    { type: 'separator' },
    { label: I18n.t('tray.quit'), click: () => app.quit() },
  ]);
}

/** Menu and tooltip show the current shortcuts and recording state. */
function refreshTray() {
  if (!tray) return;
  const pasteKey = globalShortcuts.label('globalPaste');
  tray.setToolTip(pasteKey ? I18n.t('tray.tooltip', { shortcut: pasteKey }) : 'Zcreenshot');
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  refreshTray();
  tray.on('click', onTrayClick);
}

// Only one instance: launching again just brings the existing window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    I18n.setLocale(I18n.resolveLocale([app.getLocale()])); // tray follows the OS language
    globalShortcuts.start();
    createWindow();
    createTray();
    clipboardHistory.start();
    screenCapture.start();
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
