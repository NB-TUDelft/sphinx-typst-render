// SPDX-License-Identifier: AGPL-3.0-or-later
import { $ } from './util.js';
import { app } from './state.js';
import { loadFieldFont, wrapLines, boxOf, startSize, fitsAt, splitPoint, PAD, LEAD } from './text.js';

// -------------------------------------------------------------- live hints
// While typing, measure with the same font and fitting rules as the export:
// single-line boxes stop at what fits at 6 pt; every box shows "N characters
// left" from 30 left; multi-line text that will not fit is marked yellow.
const HINT_FROM = 30;
let measurer = null;
async function liveFont() {
  if (measurer) return measurer;
  const bytes = await loadFieldFont();
  const face = new FontFace('LbLiberation', bytes.slice(0));
  await face.load();
  document.fonts.add(face);
  const cx = document.createElement('canvas').getContext('2d');
  // pt and px scale alike, so a width at "size px" is the width at size pt.
  measurer = { widthOfTextAtSize: (s, size) => { cx.font = `${size}px LbLiberation`; return cx.measureText(s).width; } };
  measurer.avg = size => measurer.widthOfTextAtSize('etaoinshrdlucmfwyp ', size) / 19;
  return measurer;
}
// pdf.js hides the form layer for a moment while it redraws at a new zoom,
// which takes the cursor out of the box being typed in. Put it back, with
// the same selection, once the box is shown again (unless the student has
// clicked somewhere else by then). Its hint then comes back with it.
export const MAX_ZOOM = 4;
// Watched until the student clicks or types somewhere else (or 10 s pass):
// pdf.js can redraw, and drop the cursor, a while after the zoom itself.
let zoomFocus = null;
export function keepFocusThroughZoom() {
  const el = document.activeElement;
  if (el && el.closest && el.closest('.annotationLayer') && 'selectionStart' in el)
    zoomFocus = { el, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
  if (!zoomFocus) return;
  const z = zoomFocus, running = !!z.until;
  z.until = performance.now() + 10000;
  if (running) return;
  const elsewhere = e => { if (!z.el.contains(e.target) && !e.ctrlKey && !e.metaKey && e.key !== 'Control') stop(); };
  const stop = () => {
    if (zoomFocus === z) zoomFocus = null;
    document.removeEventListener('pointerdown', elsewhere, true);
    document.removeEventListener('keydown', elsewhere, true);
  };
  document.addEventListener('pointerdown', elsewhere, true);
  document.addEventListener('keydown', elsewhere, true);
  const watch = () => {
    if (zoomFocus !== z) return stop();
    const active = document.activeElement;
    if (performance.now() > z.until || !z.el.isConnected || (active !== document.body && active !== z.el)) return stop();
    if (active === z.el) {                          // keep the latest selection
      z.start = z.el.selectionStart; z.end = z.el.selectionEnd; z.scroll = z.el.scrollTop;
    } else if (z.el.offsetParent && getComputedStyle(z.el).visibility !== 'hidden') {
      z.el.focus({ preventScroll: true });
      try { z.el.setSelectionRange(z.start, z.end); } catch (_) {}
      z.el.scrollTop = z.scroll;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

// Every live box's update(). The yellow mark copies the box's font and padding
// in px, so it is redrawn after each zoom (onZoom).
const liveUpdates = new Set();
let zoomFrame = 0;
export const onZoom = () => {
  cancelAnimationFrame(zoomFrame);
  zoomFrame = requestAnimationFrame(() => { for (const u of [...liveUpdates]) u(); });
};
const fieldsByPage = {};                                        // pageNumber -> Promise<[{id, rect, multi, start}]>
function pageFields(pageNumber) {
  if (!fieldsByPage[pageNumber]) {
    fieldsByPage[pageNumber] = app().pdfDocument.getPage(pageNumber).then(p => p.getAnnotations()).then(list => list
      .filter(x => x.fieldType === 'Tx' && !x.readOnly && !(x.fieldFlags & 8192) && !String(x.fieldName).startsWith('img_'))
      .map(x => {
        const b = boxOf(x.rect), multi = !!x.multiLine;
        return { id: x.id, rect: x.rect, multi, b,
          start: startSize(multi ? 4096 : 0, x.defaultAppearanceData?.fontSize || 0, b.h) };
      }));
  }
  return fieldsByPage[pageNumber];
}
// What fits, for one box and its current text.
// Measured at the box's own size: text is not shrunk while typing.
function measure(f, font, text) {
  const { w, h } = f.b, avail = w - 2 * PAD, size = f.start, avgS = font.avg(size);
  if (!f.multi) {
    const used = font.widthOfTextAtSize(text.replace(/\n/g, ' '), size);
    return { left: Math.floor((avail - used) / avgS) };
  }
  if (fitsAt(font, text, true, w, h, size)) {
    const lines = text ? wrapLines(text, font, size, avail) : [''];
    const room = Math.floor((h - 2 * PAD) / (size * LEAD));
    const last = font.widthOfTextAtSize(lines[lines.length - 1], size);
    return { left: Math.floor((avail - last) / avgS) + (room - lines.length) * Math.floor(avail / avgS) };
  }
  const cut = splitPoint(font, text, w, h, size, 1);
  return { left: 0, cut, moved: text.length - cut };
}
export function attachHints(pageNumber) {
  const pv = app().pdfViewer.getPageView(pageNumber - 1);
  if (!pv || !pv.div) return;
  Promise.all([pageFields(pageNumber), liveFont()]).then(([fields, font]) => {
    for (const f of fields) {
      const el = pv.div.querySelector(`.annotationLayer [data-element-id="${f.id}"]`);
      if (!el || el.dataset.lbHint) continue;
      el.dataset.lbHint = '1';
      const section = el.parentElement;
      let mirror = null, hint = null, sbWidth = 0;
      // Sizes and positions as calc(... * var(--total-scale-factor)), like pdf.js's
      // own, so they follow the zoom without being set again.
      const scaled = px => `calc(${px}px * var(--total-scale-factor))`;
      const place = () => {
        const v = pv.viewport;
        const [ax, ay] = v.convertToViewportPoint(f.b.x1, f.b.y1);
        const [bx, by] = v.convertToViewportPoint(f.b.x2, f.b.y2);
        return { left: scaled(Math.min(ax, bx) / v.scale), top: scaled((Math.max(ay, by) + 3) / v.scale) };
      };
      const update = () => {
        if (!el.isConnected) { liveUpdates.delete(update); return; }
        const text = el.value.replace(/\r\n?/g, '\n');
        el.style.fontSize = scaled(f.start);            // always the box's own size; shrinking is an export choice
        const m = measure(f, font, text);
        if (!f.multi) {
          if (el.dataset.lbOwnMax === undefined) el.dataset.lbOwnMax = String(el.maxLength > 0 ? el.maxLength : Infinity);
          const own = +el.dataset.lbOwnMax;
          el.maxLength = Math.min(own, text.length + Math.max(0, m.left));
        }
        // yellow mark on the part that moves
        if (f.multi && m.cut !== undefined) {
          if (!mirror) { mirror = $('div', { class: 'lb-mirror', 'aria-hidden': 'true' }); section.insertBefore(mirror, el); }
          const cs = getComputedStyle(el);
          for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'textAlign', 'borderWidth', 'borderStyle', 'boxSizing'])
            mirror.style[p] = cs[p];
          mirror.style.borderColor = 'transparent';
          mirror.style.right = 'auto';
          // As wide as the box minus its scrollbar, so lines wrap where the box wraps them.
          // Measured only while the box is shown: pdf.js hides the layer for a moment on zoom.
          if (el.offsetWidth) sbWidth = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
          mirror.style.width = `calc(100% - ${sbWidth}px)`;
          mirror.replaceChildren(document.createTextNode(text.slice(0, m.cut)), $('mark', {}, text.slice(m.cut) || ' '));
          mirror.scrollTop = el.scrollTop;
        } else if (mirror) { mirror.remove(); mirror = null; }
        // the hint, only while this box has focus
        const focused = document.activeElement === el;
        let msg = null;
        if (focused && m.moved) msg = 'Too long for this box. When you export, the yellow part moves to an extra page, after a full stop or a new line.';
        else if (focused && m.left <= 0) msg = 'This box is full. To write more, add a Text page.';
        else if (focused && m.left <= HINT_FROM) msg = `${m.left} characters left`;
        if (focused) for (const other of document.querySelectorAll('.lb-hint')) if (other !== hint) other.remove();   // one at a time
        if (!msg) { if (hint) { hint.remove(); hint = null; } return; }
        if (!hint || !hint.isConnected) { hint = $('div', { class: 'lb-hint', role: 'status' }); pv.div.append(hint); }
        hint.className = 'lb-hint' + (m.moved || m.left <= 0 ? ' lb-warn' : '');
        hint.textContent = msg;
        Object.assign(hint.style, place());
      };
      liveUpdates.add(update);
      el.addEventListener('input', update);
      el.addEventListener('focus', update);
      el.addEventListener('blur', update);
      el.addEventListener('scroll', () => { if (mirror) mirror.scrollTop = el.scrollTop; });
      update();
    }
  }).catch(err => console.warn('[typst-editor] live hints', err));
}
