'use strict';

// UI strings + locale handling. Pure data/logic (no DOM) so it loads in the browser (global `I18n`),
// in the Electron main process (tray menu) and in Node unit tests (module.exports).
// To add a language: add its entry to LOCALES and a full dictionary to MESSAGES (tests check parity).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.I18n = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_LOCALE = 'en';

  /** Names are written in their own language so they stay readable whatever locale is active. */
  const LOCALES = Object.freeze([
    Object.freeze({ code: 'th', name: 'ไทย' }),
    Object.freeze({ code: 'en', name: 'English' }),
  ]);

  const MESSAGES = Object.freeze({
    th: Object.freeze({
      'version.title': 'กดค้างเพื่อดูประวัติการอัปเดต',
      'lang.label': 'ภาษา',

      'btn.paste': 'วางจากคลิปบอร์ด',
      'btn.open': 'เลือกไฟล์รูป',
      'btn.arrange': 'เรียงทุกรูปเป็นแนวตั้งตามลำดับบนลงล่าง',
      'btn.fit': 'พอดีหน้าจอ',
      'btn.undo': 'Undo (Ctrl/Cmd+Z)',
      'btn.delete': 'ลบรูปที่เลือก (Delete)',
      'btn.clear': 'ล้างทั้งหมด',
      'btn.copy': 'คัดลอกรูปที่เลือก (ถ้าไม่ได้เลือกจะคัดลอกทั้งหมด) (Ctrl/Cmd+C)',
      'btn.save': 'บันทึกเป็น PNG (Ctrl/Cmd+S)',
      'btn.github': 'ดูโค้ดบน GitHub',
      'btn.history': 'แสดง/ซ่อนประวัติคลิปบอร์ด (10 รูปล่าสุด)',

      'tools.label': 'เครื่องมือแก้ไขภาพ',
      'tool.select': 'เลือก / ย้าย (V)',
      'tool.pen': 'ปากกา (P)',
      'tool.line': 'เส้นตรง (L) · กด Shift ค้างเพื่อล็อกมุม',
      'tool.arrow': 'ลูกศร (A) · วาดเสร็จพิมพ์ข้อความท้ายลูกศรได้ · กด Shift ค้างเพื่อล็อกมุม',
      'tool.rect': 'สี่เหลี่ยม (R) · Shift = จัตุรัส',
      'tool.ellipse': 'วงรี (O) · Shift = วงกลม',
      'tool.highlight': 'ไฮไลต์ (H)',
      'tool.text': 'ข้อความ (T) · ดับเบิลคลิกข้อความเพื่อแก้ไข',
      'tool.step': 'เลขลำดับ (N)',
      'tool.censor': 'เซ็นเซอร์ (M)',
      'tool.region': 'เลือกส่วนของรูป (C) · ลากกรอบบนรูป แล้ววางเป็นรูปใหม่หรือคัดลอก',
      'region.paste': 'วางส่วนที่เลือกเป็นรูปใหม่ (Enter)',
      'region.copy': 'คัดลอกส่วนที่เลือก (Ctrl/Cmd+C)',

      'ctl.color': 'สี',
      'ctl.width': 'หนา',
      'ctl.fontSize': 'ขนาดอักษร',
      'ctl.textBg': 'ป้ายพื้นหลัง',
      'ctl.textStroke': 'ขอบตัวอักษร',
      'ctl.censorMode': 'แบบ',
      'censor.pixel': 'โมเสก',
      'censor.blur': 'เบลอ',
      'censor.solid': 'ดำทึบ',
      'editor.label': 'แก้ไขข้อความ',

      'hint.title': 'วางรูปได้เลย',
      'hint.pressPrefix': 'กด',
      'hint.pressSuffix': 'หรือลากไฟล์รูปมาวาง (หลายไฟล์ได้ จะเรียงต่อกันแนวตั้ง)',
      'drop.hint': 'ปล่อยไฟล์เพื่อเพิ่มรูป',

      'changelog.title': 'ประวัติการอัปเดต',
      'changelog.close': 'ปิด',

      'toast.nothingToUndo': 'ไม่มีอะไรให้ Undo',
      'toast.noImages': 'ยังไม่มีรูป',
      'toast.saveFailed': 'บันทึกไม่สำเร็จ',
      'toast.copiedSelected': 'คัดลอกรูปที่เลือกแล้ว',
      'toast.copiedAll': 'คัดลอกภาพรวมแล้ว',
      'toast.copyFailed': 'คัดลอกไม่สำเร็จ',
      'toast.noRegion': 'ลากกรอบบนรูปเพื่อเลือกส่วนก่อน',
      'toast.regionCopied': 'คัดลอกส่วนที่เลือกแล้ว',
      'toast.regionFailed': 'วางส่วนที่เลือกไม่สำเร็จ',
      'toast.noImageFiles': 'ไม่พบไฟล์รูปภาพ',
      'toast.someFailed': 'เปิดรูปบางไฟล์ไม่ได้',
      'toast.added': 'เพิ่ม {count} รูป',
      'toast.clipboardEmpty': 'คลิปบอร์ดไม่มีรูป',
      'toast.clipboardUnreadable': 'อ่านคลิปบอร์ดไม่ได้ ลองกด Ctrl/Cmd+V',

      'tray.paste': 'วางจากคลิปบอร์ด',
      'tray.open': 'เปิด Zcreenshot',
      'tray.startWithSystem': 'เปิดพร้อมเครื่อง',
      'tray.quit': 'ออก',
      'tray.tooltip': 'Zcreenshot ({shortcut} = วางรูป)',
      'tray.history': 'ประวัติคลิปบอร์ด',

      'history.title': 'ประวัติคลิปบอร์ด',
      'history.close': 'ซ่อนประวัติ',
      'history.hint': 'ดับเบิลคลิกที่รูปเพื่อนำไปใช้งาน',
      'history.empty': 'ยังไม่มีรูป ลองคัดลอกรูปหรือแคปหน้าจอดู',
      'history.remove': 'ลบรูปนี้',
      'history.clear': 'ล้างประวัติ',
    }),
    en: Object.freeze({
      'version.title': 'Press and hold to view the changelog',
      'lang.label': 'Language',

      'btn.paste': 'Paste from clipboard',
      'btn.open': 'Add image files',
      'btn.arrange': 'Stack all images vertically, top to bottom',
      'btn.fit': 'Fit to screen',
      'btn.undo': 'Undo (Ctrl/Cmd+Z)',
      'btn.delete': 'Delete selected image (Delete)',
      'btn.clear': 'Clear all',
      'btn.copy': 'Copy the selected image, or everything if none is selected (Ctrl/Cmd+C)',
      'btn.save': 'Save as PNG (Ctrl/Cmd+S)',
      'btn.github': 'View source on GitHub',
      'btn.history': 'Show / hide clipboard history (last 10 images)',

      'tools.label': 'Image editing tools',
      'tool.select': 'Select / move (V)',
      'tool.pen': 'Pen (P)',
      'tool.line': 'Line (L) · hold Shift to snap the angle',
      'tool.arrow': 'Arrow (A) · type a label after drawing · hold Shift to snap the angle',
      'tool.rect': 'Rectangle (R) · Shift = square',
      'tool.ellipse': 'Ellipse (O) · Shift = circle',
      'tool.highlight': 'Highlight (H)',
      'tool.text': 'Text (T) · double-click text to edit',
      'tool.step': 'Step number (N)',
      'tool.censor': 'Censor (M)',
      'tool.region': 'Region select (C) · drag a box on an image, then paste it as a new image or copy it',
      'region.paste': 'Paste the selected region as a new image (Enter)',
      'region.copy': 'Copy the selected region (Ctrl/Cmd+C)',

      'ctl.color': 'Color',
      'ctl.width': 'Width',
      'ctl.fontSize': 'Font size',
      'ctl.textBg': 'Label background',
      'ctl.textStroke': 'Text outline',
      'ctl.censorMode': 'Style',
      'censor.pixel': 'Pixelate',
      'censor.blur': 'Blur',
      'censor.solid': 'Solid black',
      'editor.label': 'Edit text',

      'hint.title': 'Paste an image to start',
      'hint.pressPrefix': 'Press',
      'hint.pressSuffix': 'or drop image files here (multiple files are stacked vertically)',
      'drop.hint': 'Drop files to add images',

      'changelog.title': 'Changelog',
      'changelog.close': 'Close',

      'toast.nothingToUndo': 'Nothing to undo',
      'toast.noImages': 'No images yet',
      'toast.saveFailed': 'Could not save',
      'toast.copiedSelected': 'Copied the selected image',
      'toast.copiedAll': 'Copied the whole composition',
      'toast.copyFailed': 'Could not copy',
      'toast.noRegion': 'Drag a box on an image to pick a region first',
      'toast.regionCopied': 'Copied the selected region',
      'toast.regionFailed': 'Could not paste the region',
      'toast.noImageFiles': 'No image files found',
      'toast.someFailed': 'Some files could not be opened',
      'toast.added': 'Added {count} image(s)',
      'toast.clipboardEmpty': 'No image in the clipboard',
      'toast.clipboardUnreadable': 'Cannot read the clipboard. Try Ctrl/Cmd+V',

      'tray.paste': 'Paste from clipboard',
      'tray.open': 'Open Zcreenshot',
      'tray.startWithSystem': 'Start with system',
      'tray.quit': 'Quit',
      'tray.tooltip': 'Zcreenshot ({shortcut} = paste)',
      'tray.history': 'Clipboard history',

      'history.title': 'Clipboard history',
      'history.close': 'Hide history',
      'history.hint': 'Double-click an image to use it',
      'history.empty': 'No images yet. Copy an image or take a screenshot.',
      'history.remove': 'Remove this image',
      'history.clear': 'Clear history',
    }),
  });

  const isSupported = (code) => LOCALES.some((l) => l.code === code);

  /** First supported language in `candidates` (e.g. navigator.languages), ignoring the region part. */
  function resolveLocale(candidates) {
    for (const candidate of candidates || []) {
      const code = String(candidate).toLowerCase().split(/[-_]/)[0];
      if (isSupported(code)) return code;
    }
    return DEFAULT_LOCALE;
  }

  function format(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }

  /** Looks the key up in `locale`, then in the default locale, then falls back to the key itself. */
  function translate(locale, key, params = {}) {
    const template = (MESSAGES[locale] && MESSAGES[locale][key]) ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
    return format(template, params);
  }

  // ---------- current locale (one per process / page) ----------
  let current = DEFAULT_LOCALE;
  let listeners = [];

  const getLocale = () => current;
  const t = (key, params) => translate(current, key, params);

  /** @returns {boolean} false when `code` is not a supported locale (the current one is kept). */
  function setLocale(code) {
    if (!isSupported(code)) return false;
    if (code === current) return true;
    current = code;
    listeners.forEach((listener) => listener(code));
    return true;
  }

  /** @returns {() => void} unsubscribe */
  function subscribe(listener) {
    listeners = [...listeners, listener];
    return () => { listeners = listeners.filter((l) => l !== listener); };
  }

  return {
    DEFAULT_LOCALE, LOCALES, MESSAGES, resolveLocale, translate, t, getLocale, setLocale, subscribe,
  };
});
