'use strict';

// App version + changelog. Pure data (no DOM) so it loads in the browser (global `Version`)
// and in Node unit tests (module.exports). Add new releases at the TOP of CHANGELOG and
// keep package.json "version" in sync.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Version = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /** @typedef {{version:string, date:string, changes:Readonly<Record<string, readonly string[]>>}} Release
   *  `changes` is keyed by locale code ("th", "en"); every release needs the default locale ("en"). */

  /** @type {readonly Release[]} newest first */
  const CHANGELOG = Object.freeze([
    Object.freeze({
      version: '0.6.0',
      date: '2026-10-27',
      changes: Object.freeze({
        th: Object.freeze([
          'ประวัติคลิปบอร์ด (Desktop): เก็บรูปที่คัดลอกไว้ 10 รูปล่าสุด ดับเบิลคลิกเพื่อเปิดในตัวแก้ไข',
          'เส้นกรอบสี่เหลี่ยมแบบแคบมากๆ ไม่ถูกยกเลิกอีกต่อไป',
          'เครื่องมือรูปทรงใช้ครั้งเดียว: หลังวาดเสร็จ คลิกครั้งถัดไปจะย้าย/ปรับขนาดรูปทรงแทนการวาดใหม่',
        ]),
        en: Object.freeze([
          'Clipboard history (desktop): keeps the last 10 copied images; double-click one to open it in the editor',
          'Very thin rectangle outlines are no longer cancelled',
          'Shape tools are one-shot: after drawing, the next press moves/resizes the shape instead of drawing another',
        ]),
      }),
    }),
    Object.freeze({
      version: '0.5.0',
      date: '2026-10-21',
      changes: Object.freeze({
        th: Object.freeze([
          'วาง/ลากไฟล์รูปหลายรูป แล้วต่อกันแนวตั้งอัตโนมัติ',
          'ย้าย ปรับขนาด ซูม เลื่อนมุมมอง และ Undo ได้ 50 ขั้น',
          'เครื่องมือวาด: ปากกา เส้น ลูกศร สี่เหลี่ยม วงรี ไฮไลต์ ข้อความ เลขลำดับ เซ็นเซอร์',
          'บันทึกเป็น PNG หรือคัดลอกรูปที่เลือก/ภาพรวมไปยังคลิปบอร์ด',
          'แอป Desktop (Electron) มี Tray และปุ่มลัด Ctrl/Cmd+Shift+V',
          'ใช้งานผ่านเว็บแบบ PWA ได้',
        ]),
        en: Object.freeze([
          'Paste or drop several images and they are stacked vertically automatically',
          'Move, resize, zoom, pan and undo up to 50 steps',
          'Drawing tools: pen, line, arrow, rectangle, ellipse, highlight, text, step numbers, censor',
          'Save as PNG, or copy the selected image / the whole composition to the clipboard',
          'Desktop (Electron) app with a tray icon and the Ctrl/Cmd+Shift+V shortcut',
          'Works in the browser as a PWA',
        ]),
      }),
    }),
  ]);

  const VERSION = CHANGELOG[0].version;

  /** "0.5.0" -> "v0.5" (patch is shown only when non-zero). */
  function formatVersion(version) {
    const [major = '0', minor = '0', patch = '0'] = String(version).split('.');
    return patch === '0' ? `v${major}.${minor}` : `v${major}.${minor}.${patch}`;
  }

  return { VERSION, CHANGELOG, formatVersion };
});
