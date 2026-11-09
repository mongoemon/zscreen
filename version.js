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
      version: '1.7.0',
      date: '2026-11-09',
      changes: Object.freeze({
        th: Object.freeze([
          'พูดเป็นข้อความ: อัดเสียงพูดภาษาไทยหรืออังกฤษแล้วแปลงเป็นข้อความด้วย Whisper ในเครื่อง แก้ไข คัดลอก หรือบันทึกเป็น .txt ได้ (Desktop มีโมเดลในตัว เว็บดาวน์โหลดแล้วเชื่อมต่อโฟลเดอร์)',
          'คลิปบอร์ดข้อความ: เก็บข้อความไว้ใช้ซ้ำได้สูงสุด 10 ข้อความ คลิกเพื่อคัดลอก และส่งข้อความจาก OCR / พูดเป็นข้อความ เข้ามาเก็บได้',
        ]),
        en: Object.freeze([
          'Speech to text: record Thai or English speech and turn it into text with Whisper on your device, then edit, copy or save it as .txt (built into the desktop app; the web version downloads the model and connects the folder)',
          'Text clipboard: keep up to 10 texts to reuse, click one to copy it, and send text from OCR or speech to text straight into it',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.6.0',
      date: '2026-11-05',
      changes: Object.freeze({
        th: Object.freeze([
          'ดึงข้อความจากรูป (OCR) ภาษาไทยและอังกฤษ: อ่านทั้งรูปหรือเฉพาะส่วนที่เลือก แล้วคัดลอกหรือบันทึกเป็น .txt ได้ ประมวลผลในเครื่องทั้งหมด',
          'เปิดหลายเอกสารเป็นแท็บ: แต่ละแท็บมีรูป สิ่งที่วาด และ Undo ของตัวเอง เปลี่ยนชื่อ ลากสลับลำดับ และปิดได้',
          'ข้อความบนลูกศร: ขึ้นบรรทัดใหม่ด้วย Shift+Enter, ฟอนต์เล็กลงให้สมดุลกับลูกศร และจัดชิดซ้าย/ขวาตามทิศของลูกศร',
          'ระหว่างพิมพ์ข้อความ แสดงเส้นขอบตัวอักษรให้เห็นทันทีถ้าเปิดไว้',
          'ย้ายหน้าต่าง (dialog) ได้ด้วยการลากที่หัวหน้าต่าง',
        ]),
        en: Object.freeze([
          'Extract text from images (OCR) in Thai and English: read a whole image or just a selected area, then copy it or save it as .txt, all processed on your device',
          'Multiple documents in tabs: each tab has its own images, drawings and undo; tabs can be renamed, reordered by dragging and closed',
          'Arrow labels: Shift+Enter adds a line break, the font is smaller to balance the arrow, and lines align left/right by the arrow direction',
          'While typing text, the preview shows the outline when it is turned on',
          'Dialogs can be moved by dragging their header',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.5.0',
      date: '2026-11-03',
      changes: Object.freeze({
        th: Object.freeze([
          'ปุ่มบันทึกเสียงไมโครโฟนอย่างเดียว: กดเพื่อเริ่ม กดอีกครั้งเพื่อหยุด แล้วบันทึกเป็น MP3 ทันที',
          'ย้ายปุ่มจับภาพ (บันทึกหน้าจอ, บันทึกเสียง, จับภาพแบบเลื่อน) ไปไว้กลางแถบเครื่องมือ',
          'จับภาพแบบเลื่อนบน Desktop: แถบบันทึกไม่ติดเข้าไปในภาพ',
        ]),
        en: Object.freeze([
          'Microphone-only recording button: click to start, click again to stop, and it saves as MP3 right away',
          'The capture buttons (screen recording, audio recording, scrolling screenshot) now sit in the middle of the toolbar',
          'Scrolling screenshot on desktop: the recording bar no longer ends up in the image',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.4.0',
      date: '2026-11-03',
      changes: Object.freeze({
        th: Object.freeze([
          'บันทึกหน้าจอพร้อมเสียง: เสียงในเครื่องและ/หรือไมโครโฟน (ถ้าเปิดทั้งสองจะผสมกัน) และเลือกได้ว่าจะใส่เสียงในวิดีโอที่บันทึกหรือไม่',
          'บันทึกเฉพาะเสียงเป็น MP3 หรือ M4A (AAC) เลือกบิตเรตได้ 64–320 kbps',
          'ดูสัญญาอนุญาตของซอฟต์แวร์ภายนอกได้ท้ายหน้าต่างประวัติการอัปเดต',
        ]),
        en: Object.freeze([
          'Screen recording with sound: system sound and / or the microphone (mixed when both are on), and a choice to keep the audio when saving a video',
          'Save the audio only as MP3 or M4A (AAC), at 64–320 kbps',
          'Third-party software licenses can be viewed at the bottom of the changelog',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.3.0',
      date: '2026-11-03',
      changes: Object.freeze({
        th: Object.freeze([
          'สร้างหน้าเปล่า: เลือกขนาดกระดาษ (A4, Letter ฯลฯ), ขนาดจอ/สไลด์, ขนาดโพสต์โซเชียล หรือกำหนดเอง พร้อม DPI และสีพื้นหลังหรือพื้นโปร่งใส (ปุ่มลัด Ctrl/Cmd+Alt+N)',
        ]),
        en: Object.freeze([
          'New blank page: paper sizes (A4, Letter…), screen / slide and social post sizes, or a custom size, with DPI and a background colour or transparency (Ctrl/Cmd+Alt+N)',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.2.0',
      date: '2026-11-02',
      changes: Object.freeze({
        th: Object.freeze([
          'จับภาพแบบเลื่อนหน้าจอ: เลือกหน้าต่าง แล้วเลื่อนลงช้าๆ ภาพจะต่อกันเป็นภาพยาวภาพเดียวและเพิ่มลงในแคนวาส (ปุ่มลัด Ctrl/Cmd+Alt+S)',
          'ปุ่มสนับสนุนผู้พัฒนา (Ko-fi)',
          'Desktop: ลิงก์ GitHub / Ko-fi เปิดในเบราว์เซอร์ของเครื่อง',
        ]),
        en: Object.freeze([
          'Scrolling screenshot: pick a window and scroll it down slowly; the frames are joined into one tall image on the canvas (Ctrl/Cmd+Alt+S)',
          'Support the developer button (Ko-fi)',
          'Desktop: the GitHub / Ko-fi links open in the system browser',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.1.0',
      date: '2026-11-02',
      changes: Object.freeze({
        th: Object.freeze([
          'บันทึกหน้าจอเป็นวิดีโอ: เลือกขนาดวิดีโอและเฟรมเรต แล้วเลือกบันทึกทั้งหน้าจอหรือเฉพาะหน้าต่าง',
          'หน้าแก้ไขวิดีโอ: ตัดช่วงต้น/ท้าย แล้วบันทึกเป็น GIF, วิดีโอขนาดเล็ก/บิตเรตต่ำ (MP4/WebM) หรือไฟล์ต้นฉบับ',
          'เพิ่มเฟรมจากวิดีโอลงในแคนวาสเป็นรูปได้',
          'ลากไฟล์วิดีโอมาวางเพื่อแปลงเป็น GIF ได้',
          'บันทึกเป็น MP4/WebM เร็วขึ้นมาก (แปลงด้วย WebCodecs)',
          'ปุ่มตั้งค่าปุ่มลัด: เปลี่ยนปุ่มลัดของหน้าแก้ไขรูป เครื่องมือวาด หน้าแก้ไขวิดีโอ และปุ่มลัดทั้งระบบได้ พร้อมปุ่มคืนค่าเริ่มต้น',
          'ปุ่มลัดใหม่: เปิดการตั้งค่า, เลือกไฟล์, คัดลอกทุกรูป, ประวัติคลิปบอร์ด และปุ่มลัดในหน้าแก้ไขวิดีโอ (เล่น, ตั้งจุดเริ่ม/จบ, เลื่อนทีละเฟรม, บันทึก, เพิ่มเฟรม)',
        ]),
        en: Object.freeze([
          'Screen recording: pick the video size and frame rate, then record the whole screen or one window',
          'Video editor: trim the start/end and save as GIF, a small / low-bitrate video (MP4/WebM), or the original',
          'Add a video frame to the canvas as an image',
          'Drop a video file to turn it into a GIF',
          'Much faster MP4/WebM saving (converted with WebCodecs)',
          'Shortcut settings: change the keys of the image editor, drawing tools, video editor and the system-wide shortcuts, with a button to restore the defaults',
          'New shortcuts: open settings, add files, copy every image, clipboard history, and video-editor keys (play, set start/end, step frames, save, add frame)',
        ]),
      }),
    }),
    Object.freeze({
      version: '1.0.0',
      date: '2026-10-29',
      changes: Object.freeze({
        th: Object.freeze([
          'เลือกหลายชิ้นพร้อมกัน: ลากกรอบ หรือ Ctrl+คลิกเพื่อเพิ่ม',
          'ตัดรูป: Alt+ลากขอบรูป',
          'ปุ่มคัดลอกทุกรูปไปยังคลิปบอร์ด',
          'สี่เหลี่ยม/วงรี: กด Shift ค้างเพื่อเติมสีเต็ม',
          'ปรับปรุงการทำงานของเครื่องมือวาดและการแสดงผล',
        ]),
        en: Object.freeze([
          'Multi-select: drag a box, or Ctrl+click to add to the selection',
          'Crop an image with Alt+drag on its edge',
          'New button to copy every image to the clipboard',
          'Rectangle / ellipse: hold Shift for a solid fill',
          'Drawing tool and rendering improvements',
        ]),
      }),
    }),
    Object.freeze({
      version: '0.7.0',
      date: '2026-10-28',
      changes: Object.freeze({
        th: Object.freeze([
          'ประวัติรูปบนเว็บ: เก็บรูปที่วาง/ลาก/เลือกไฟล์ไว้ 10 รูปล่าสุดในแท็บ ดับเบิลคลิกเพื่อนำกลับมาใช้',
        ]),
        en: Object.freeze([
          'Image history on the web: keeps the last 10 pasted / dropped / picked images in the tab; double-click one to reuse it',
        ]),
      }),
    }),
    Object.freeze({
      version: '0.6.1',
      date: '2026-10-28',
      changes: Object.freeze({
        th: Object.freeze([
          'แก้ปัญหาแผงประวัติคลิปบอร์ดไม่แสดง เพราะค่าที่บันทึกไว้จากเวอร์ชันหน้าต่างลอยเดิม',
        ]),
        en: Object.freeze([
          'Fixed the clipboard history panel staying hidden because of a setting saved by the old floating-window version',
        ]),
      }),
    }),
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
