'use strict';

// Electron main process: lets the editor window record a screen or another window.
// Electron has no built-in picker for getDisplayMedia, so the editor lists the sources over IPC
// (with thumbnails), the user picks one in the record dialog, and the display-media handler below
// grants exactly that source when the page then calls getDisplayMedia().
const {
  desktopCapturer, ipcMain, session, systemPreferences,
} = require('electron');

const THUMB_SIZE = Object.freeze({ width: 320, height: 200 });
const CH = Object.freeze({
  sources: 'capture:sources',
  select: 'capture:select',
  recording: 'capture:recording',
  stop: 'capture:stop',
});

/** 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'; only macOS asks for permission. */
function screenPermission() {
  if (process.platform !== 'darwin') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch (err) {
    return 'unknown';
  }
}

/**
 * @param {{
 *   getWindow: () => (import('electron').BrowserWindow | null),
 *   onRecordingChange?: (recording: boolean, options: {hideWindow: boolean}) => void,
 * }} options getWindow returns the editor window (null while there is none)
 */
function createCaptureService({ getWindow, onRecordingChange = () => {} }) {
  /** @type {{id:string, name:string} | null} source picked in the record dialog, used by the next request */
  let chosen = null;
  let recording = false;

  const isFromEditor = (event) => {
    const win = getWindow();
    return win !== null && event.sender === win.webContents;
  };

  async function listSources() {
    const win = getWindow();
    const ownId = win ? win.getMediaSourceId() : null;
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: THUMB_SIZE,
      fetchWindowIcons: false,
    });
    return sources
      .filter((s) => s.id !== ownId) // recording the editor itself is never what the user wants
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      }));
  }

  function setRecording(next, options) {
    if (next === recording) return;
    recording = next;
    onRecordingChange(recording, options);
  }

  function start() {
    ipcMain.handle(CH.sources, async (event) => {
      if (!isFromEditor(event)) return null;
      return { permission: screenPermission(), sources: await listSources() };
    });
    ipcMain.handle(CH.select, (event, source) => {
      if (!isFromEditor(event) || !source || typeof source.id !== 'string' || typeof source.name !== 'string') return false;
      chosen = { id: source.id, name: source.name };
      return true;
    });
    ipcMain.on(CH.recording, (event, next, options) => {
      if (!isFromEditor(event) || typeof next !== 'boolean') return;
      setRecording(next, { hideWindow: !!(options && options.hideWindow) });
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const win = getWindow();
      const fromEditor = win && request.frame && request.frame === win.webContents.mainFrame;
      const source = chosen;
      chosen = null; // one pick, one recording
      callback(fromEditor && source ? { video: source } : null);
    });
  }

  /** Asks the editor to stop recording (tray menu, tray click, global shortcut). */
  function requestStop() {
    const win = getWindow();
    if (recording && win) win.webContents.send(CH.stop);
  }

  return { start, requestStop, isRecording: () => recording };
}

module.exports = { createCaptureService };
