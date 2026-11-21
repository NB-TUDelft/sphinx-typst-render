// SPDX-License-Identifier: AGPL-3.0-or-later
// Text in form fields: the font, line wrapping and fitting rules, shared by
// the export and the live hints so both measure alike.
import { rgb } from 'pdf-lib';
import { assetUrl } from './viewer.js';

// Form-field text is drawn here rather than taken from the viewer's
// appearance streams: once a field holds a character outside WinAnsi
// (Ω, µ, ...) pdf.js saves every field without an appearance. The text is set
// in Liberation Sans (one of pdf.js's standard fonts), embedded as a subset.
let fieldFontBytes = null;
export async function loadFieldFont() {
  if (!fieldFontBytes) {
    const r = await fetch(assetUrl('pdfjs/standard_fonts/LiberationSans-Regular.ttf'));
    if (!r.ok) throw new Error('could not load the font');
    fieldFontBytes = await r.arrayBuffer();
  }
  return fieldFontBytes;
}

// fontkit embeds that font in the export. Nothing else needs it, so the build
// splits it into a chunk of its own that loads on first use.
export const loadFontkit = () => import('@pdf-lib/fontkit').then(m => m.default);

// Lines as a textarea shows them: every space counts (leading and repeated
// spaces too), a space at the end of a full line hangs there, and an empty
// paragraph is an empty line.
export function wrapLines(text, font, size, width) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = null;                                            // null: nothing on this line yet
    for (const word of para.split(' ')) {
      const tryLine = line === null ? word : line + ' ' + word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue; }
      if (word === '') continue;                                // extra space at a line end
      if (line) out.push(line);
      let piece = '';
      for (const ch of word) {                                  // words longer than the box
        if (font.widthOfTextAtSize(piece + ch, size) > width && piece) { out.push(piece); piece = ''; }
        piece += ch;
      }
      line = piece;
    }
    out.push(line ?? '');
  }
  return out;
}

// Text fitting, shared by the export and the live hints. Boxes never grow:
// text is drawn at the box's own size, and only shrinks when the student
// picks that, never below MIN_PT.
export const MIN_PT = 6, PAD = 2, LEAD = 1.2;
export const boxOf = rect => {
  const x1 = Math.min(rect[0], rect[2]), x2 = Math.max(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]), y2 = Math.max(rect[1], rect[3]);
  return { x1, x2, y1, y2, w: x2 - x1, h: y2 - y1 };
};
export const daSize = da => parseFloat(((da || '').match(/([\d.]+)\s+Tf/) || [])[1]) || 0;
export const startSize = (ff, sizeDA, h) => sizeDA || ((ff & 4096) ? 10 : Math.min(12, (h - 2) / 1.2));
export const fitsAt = (font, text, multi, w, h, size, extraLines = 0) => multi
  ? (wrapLines(text, font, size, w - 2 * PAD).length + extraLines) * size * LEAD <= h - 2 * PAD
  : font.widthOfTextAtSize(text.replace(/\n/g, ' '), size) <= w - 2 * PAD;
// Largest size from `start` down to MIN_PT (1 pt integer steps) at which the text fits; null if none.
export function fitSize(font, text, multi, w, h, start, extraLines = 0) {
  if (fitsAt(font, text, multi, w, h, start, extraLines)) return start;
  for (let s = Math.floor(start) - (Math.floor(start) === start ? 1 : 0); s >= MIN_PT; s -= 1) {
    if (fitsAt(font, text, multi, w, h, s, extraLines)) return s;
  }
  return null;
}
// Where a too-long answer is cut: after the last ".", "!", "?" or line break whose text
// still fits (leaving `extraLines` free for the reference); else the last space; else 0.
// A longer start never fits better than a shorter one, so a binary search
// finds the last cut that fits: a handful of tries instead of one per word,
// which kept long answers from freezing the page on every keystroke and zoom.
export function splitPoint(font, text, w, h, size, extraLines) {
  const ok = n => fitsAt(font, text.slice(0, n).trimEnd(), true, w, h, size, extraLines);
  const lastOk = cuts => {
    let lo = 0, hi = cuts.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ok(cuts[mid])) { best = cuts[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  };
  return lastOk([...text.matchAll(/[.!?](?=\s|$)|\n/g)].map(m => m.index + 1))
    || lastOk([...text.matchAll(/\s+/g)].map(m => m.index));
}

export function drawFieldText(page, font, charset, rect, value, da, ff, q, opts = {}) {
  const { x1, x2, y1, y2, w, h } = boxOf(rect);
  const text = [...value.replace(/\r\n?/g, '\n')]
    .map(c => (c === '\n' || charset.has(c.codePointAt(0))) ? c : '?').join('');
  let color = rgb(0, 0, 0);
  const mRgb = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/), mG = da.match(/([\d.]+)\s+g(\s|$)/);
  if (mRgb) color = rgb(+mRgb[1], +mRgb[2], +mRgb[3]); else if (mG) color = rgb(+mG[1], +mG[1], +mG[1]);
  const xFor = (line, size) => {
    const tw = font.widthOfTextAtSize(line, size);
    return q === 1 ? x1 + (w - tw) / 2 : q === 2 ? x2 - PAD - tw : x1 + PAD;
  };
  const start = startSize(ff, daSize(da), h);
  const red = rgb(0.75, 0, 0);
  if (ff & 4096) {                                              // multi-line
    const size = opts.size || fitSize(font, text, true, w, h, start, opts.ref ? 1 : 0) || MIN_PT;
    const lines = text ? wrapLines(text, font, size, w - 2 * PAD) : [];
    const yAt = i => y2 - PAD - size * (0.9 + LEAD * i);
    lines.forEach((line, i) => {
      if (line && yAt(i) >= y1) page.drawText(line, { x: xFor(line, size), y: yAt(i), size, font, color });
    });
    if (opts.ref) {
      const rs = Math.min(9, size);
      page.drawText(opts.ref, { x: x1 + PAD, y: Math.max(y1 + PAD, yAt(lines.length) + (size - rs) * 0.9), size: rs, font, color: red });
    }
  } else {
    const line = text.replace(/\n/g, ' ');
    const size = opts.size || fitSize(font, line, false, w, h, start) || MIN_PT;
    page.drawText(line, { x: xFor(line, size), y: y1 + h / 2 - size * 0.35, size, font, color });
  }
}
