// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  PDFDocument, PDFName, PDFHexString, PDFArray, PDFDict, PDFStream, PDFRef, rgb,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
  beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, showText,
} from 'pdf-lib';
import { app, state, KEY } from './state.js';
import { toast, nowIso } from './util.js';
import {
  loadFieldFont, loadFontkit, wrapLines, boxOf, daSize, startSize, fitsAt, fitSize, splitPoint, drawFieldText, LEAD,
} from './text.js';
import { askOverflow } from './dialogs.js';
import { documentBytes, exerciseAt } from './document.js';
import { setSaveBadge } from './status.js';
import { config } from './config.js';

// Prefix of the invisible labels around every answer, e.g. [[FORM:field ...]].
const P = config.labelPrefix;
// Key the editable layer is parked under, on each page and in the catalog.
const PARK = config.parkKey;

// ------------------------------------------------------- flattened export
// The hand-in PDF has no form fields or annotations left: every field value,
// drawing, text box and image is painted into the page itself, so any PDF
// reader or grading script sees it as ordinary page content. The editable
// layer (each page's own contents and annotations, and the form) is parked
// under PARK, which viewers ignore; opening the export in this editor puts
// it back (unparked() in document.js). The photos and drawings are stored
// once, shared by both, so the file barely grows.

export async function flattenedBytes(decide = askOverflow) {
  const a = app();
  a.pdfViewer._layerProperties?.annotationEditorUIManager?.endCurrentEditing?.();
  const fontBytes = await loadFieldFont();
  const pl = await PDFDocument.load(await documentBytes(a.pdfDocument), { updateMetadata: false });
  pl.registerFontkit(await loadFontkit());
  const font = await pl.embedFont(fontBytes, { subset: true });
  const charset = new Set(font.getCharacterSet());
  const ctx = pl.context;
  const N = n => PDFName.of(n);
  const nums = arr => (arr instanceof PDFArray) ? arr.asArray().map(x => ctx.lookup(x).asNumber()) : null;
  const inherit = (d, key) => {
    for (let n = d, i = 0; n instanceof PDFDict && i < 20; n = n.lookup(N('Parent')), i++) {
      const v = n.lookup(N(key)); if (v !== undefined) return v;
    }
    return undefined;
  };
  const acro = pl.catalog.lookup(N('AcroForm'));
  const daDefault = acro instanceof PDFDict && acro.lookup(N('DA'));
  const textOf = v => (v && v.decodeText) ? v.decodeText() : '';
  const fieldName = d => {
    const parts = [];
    for (let n = d, i = 0; n instanceof PDFDict && i < 20; n = n.lookup(N('Parent')), i++) {
      const t = n.lookup(N('T')); if (t && t.decodeText) parts.unshift(t.decodeText());
    }
    return parts.join('.');
  };
  // Invisible labels: text in render mode 3 (not painted), which text
  // extraction (pypdf, pdfplumber, PyMuPDF, pdftotext) still returns. Every
  // answer is wrapped as [[P:field name="…"]] value [[/P:field]], P being
  // config.labelPrefix.
  const fontKey = n => n.node.newFontDictionary(font.name, font.ref);
  const safe = s => [...String(s).replace(/[\r\n]+/g, ' ')]
    .map(c => charset.has(c.codePointAt(0)) ? c : '?').join('');
  const label = (page, key, str, x, y) => page.pushOperators(
    beginText(), setFontAndSize(key, 4), setTextRenderingMode(TextRenderingMode.Invisible),
    setTextMatrix(1, 0, 0, 1, x, y), showText(font.encodeText(safe(str))),
    setTextRenderingMode(TextRenderingMode.Fill), endText());   // Tr is text state and survives ET: reset or the answers drawn next are invisible too
  const attr = (k, v) => v === undefined || v === null || v === '' ? '' : ` ${k}="${String(v).replace(/"/g, "'")}"`;   // swap quotes inside values only, so the label syntax keeps its own
  const exact = { pages: [], fields: {}, checks: {}, images: {}, overflow: {} };   // the same, verbatim, in the Info dict
  const texts = [];                                             // drawn after all pages, once overflow is decided
  const slotMeta = name => state.images['slot:' + name] || {};
  const imageLabel = (slot, m) => `[[${P}:image slot="${slot}" filled="yes"${attr('exercise', m.exercise)}` +
    `${attr('file', m.original_filename)}${attr('sha256', m.sha256)}${attr('sha512', m.sha512)}]]`;

  const ownPages = pl.getPageCount();
  const copyOf = v => { const o = v && ctx.lookup(v); return o instanceof PDFArray ? ctx.obj(o.asArray()) : v; };
  for (const page of pl.getPages()) {
    const parked = {};
    for (const k of ['Contents', 'Annots']) if (page.node.get(N(k))) parked[k] = copyOf(page.node.get(N(k)));
    page.node.set(N(PARK), ctx.obj(parked));
  }
  for (const [pageIndex, page] of pl.getPages().entries()) {
    const key = fontKey(page);
    const { height: PH } = page.getSize();
    const info = state.pageInfo[pageIndex] || {};
    label(page, key, `[[${P}:page n="${pageIndex + 1}"${attr('kind', info.added ? info.kind : 'template')}${attr('exercise', info.exercise)}]]`, 2, PH - 6);
    exact.pages.push({ n: pageIndex + 1, kind: info.added ? info.kind : 'template', exercise: info.exercise || null });
    const annots = page.node.lookup(N('Annots'));
    const list = annots instanceof PDFArray ? annots : ctx.obj([]);
    const keep = [], ops = [], labels = [];
    for (let i = 0; i < list.size(); i++) {
      const ref = list.get(i);
      const d = ctx.lookup(ref);
      if (!(d instanceof PDFDict)) continue;
      const sub = String(d.lookup(N('Subtype')) || '');
      if (sub === '/Link') { keep.push(ref); continue; }        // bookmarks and links keep working
      if (sub === '/Popup') continue;
      const flags = d.lookup(N('F')); const f = flags ? flags.asNumber() : 0;
      if (f & 2 || f & 32) continue;                            // hidden / no-view
      const rectHere = nums(d.lookup(N('Rect')));
      const top = r => [Math.min(r[0], r[2]), Math.max(r[1], r[3]) - 4];
      if (sub === '/Widget' && fieldName(d).startsWith('img_')) {         // image slot left empty
        const slot = fieldName(d).slice(4);
        exact.images[slot] = null;
        if (rectHere) labels.push([`[[${P}:image slot="${slot}" filled="no"]]`, ...top(rectHere)]);
        continue;
      }
      if (sub === '/Widget' && String(inherit(d, 'FT')) === '/Tx') {      // text field: draw its value
        const value = textOf(inherit(d, 'V'));
        const ffv = inherit(d, 'Ff'), qv = inherit(d, 'Q');
        const ff = ffv ? ffv.asNumber() : 0;
        if (rectHere && !(ff & 8192)) {
          const name = fieldName(d);
          exact.fields[name] = value;
          texts.push({ page, key, rect: rectHere, value, da: textOf(inherit(d, 'DA') || daDefault), ff, q: qv ? qv.asNumber() : 0,
            name, label: textOf(inherit(d, 'TU')) || name, pageNo: pageIndex + 1 });
          const pm = state.images['page:' + name];                         // notes field of an image page
          if (pm) {
            exact.images['page:' + name] = pm;
            labels.push([imageLabel('page:' + name, pm), Math.min(rectHere[0], rectHere[2]), Math.max(rectHere[1], rectHere[3]) + 14]);
          }
        }
        continue;
      }
      if (sub === '/Widget' && String(inherit(d, 'FT')) === '/Btn') {     // checkbox / radio
        const name = fieldName(d), as = d.lookup(N('AS'));
        const on = !!as && String(as) !== '/Off';
        exact.checks[name] = on ? String(as).slice(1) : null;
        if (rectHere) labels.push([`[[${P}:check name="${name}" checked="${on ? 'yes' : 'no'}"]]`, ...top(rectHere)]);
      }
      const nm = textOf(d.lookup(N('NM')));
      if (nm.startsWith(config.slotPrefix) && rectHere) {                 // image in a slot
        const slot = nm.slice(config.slotPrefix.length), m = slotMeta(slot);
        exact.images[slot] = m;
        labels.push([imageLabel(slot, m), ...top(rectHere)]);
      }
      const ap = d.lookup(N('AP'));
      if (!(ap instanceof PDFDict)) continue;
      let apRef = ap.get(N('N')), n = ctx.lookup(apRef);
      if (n instanceof PDFDict) {                               // on/off states (checkboxes)
        const as = d.lookup(N('AS'));
        if (!as) continue;
        apRef = n.get(as); n = ctx.lookup(apRef);
      }
      if (!(n instanceof PDFStream)) continue;
      if (!(apRef instanceof PDFRef)) apRef = ctx.register(n);
      const bbox = nums(n.dict.lookup(N('BBox'))), rect = nums(d.lookup(N('Rect')));
      if (!bbox || !rect) continue;
      const m = nums(n.dict.lookup(N('Matrix'))) || [1, 0, 0, 1, 0, 0];
      // Map the appearance box (after its own Matrix) onto the annotation rectangle.
      const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
        .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const bx1 = Math.min(...pts.map(p => p[0])), bx2 = Math.max(...pts.map(p => p[0]));
      const by1 = Math.min(...pts.map(p => p[1])), by2 = Math.max(...pts.map(p => p[1]));
      const rx1 = Math.min(rect[0], rect[2]), rx2 = Math.max(rect[0], rect[2]);
      const ry1 = Math.min(rect[1], rect[3]), ry2 = Math.max(rect[1], rect[3]);
      if (bx2 - bx1 < 1e-6 || by2 - by1 < 1e-6) continue;
      const sx = (rx2 - rx1) / (bx2 - bx1), sy = (ry2 - ry1) / (by2 - by1);
      const name = page.node.newXObject('Flat', apRef);
      ops.push(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rx1 - sx * bx1, ry1 - sy * by1),
        drawObject(name), popGraphicsState());
    }
    if (keep.length) page.node.set(N('Annots'), ctx.obj(keep)); else page.node.delete(N('Annots'));
    if (ops.length) page.pushOperators(...ops);
    for (const [str, x, y] of labels) label(page, key, str, x, y);
  }

  // Answers that do not fit their (fixed) box: ask once, then move or shrink.
  const clean = v => [...v.replace(/\r\n?/g, '\n')].map(c => (c === '\n' || charset.has(c.codePointAt(0))) ? c : '?').join('');
  const over = [];
  for (const t of texts) {
    if (!(t.ff & 4096) || !t.value.trim()) continue;
    const b = boxOf(t.rect), txt = clean(t.value), start = startSize(t.ff, daSize(t.da), b.h);
    if (fitsAt(font, txt, true, b.w, b.h, start)) continue;
    // Same rule as the live view: at the box's own size, the part that does not
    // fit (the yellow part) moves. Shrinking is the student's choice, offered
    // when the whole answer fits at MIN_PT or larger.
    const shrinkTo = fitSize(font, txt, true, b.w, b.h, start);
    const cut = splitPoint(font, txt, b.w, b.h, start, 1);
    Object.assign(t, { txt, cut });
    over.push({ name: t.name, label: t.label, page: t.pageNo, extra: txt.length - cut, shrinkTo, t });
  }
  const choice = over.length ? await decide(over) : {};
  if (!choice) return null;                                     // export cancelled
  const [PW, PH0] = (() => { const s = pl.getPage(0).getSize(); return [s.width, s.height]; })();
  const M = 50, BS = 10.5, grey = rgb(0.35, 0.35, 0.35);
  for (const o of over) {
    let c = choice[o.name] || 'overflow';
    if (c === 'shrink' && !o.shrinkTo) c = 'overflow';
    if (c === 'shrink') { o.t.opts = { size: o.shrinkTo }; exact.overflow[o.name] = { choice: c, size: o.shrinkTo }; continue; }
    const kept = c === 'all' ? '' : o.t.txt.slice(0, o.t.cut).trimEnd();
    const moved = c === 'all' ? o.t.txt : o.t.txt.slice(o.t.cut).trimStart();
    const first = pl.getPageCount() + 1, pages = [];
    let pg, key, y;
    const newPage = () => {
      pg = pl.addPage([PW, PH0]); key = fontKey(pg);
      const n = pl.getPageCount(); pages.push(n);
      label(pg, key, `[[${P}:page n="${n}" kind="overflow"${attr('field', o.name)}]]`, 2, PH0 - 6);
      exact.pages.push({ n, kind: 'overflow', exercise: exerciseAt(o.t.pageNo - 1, Math.max(o.t.rect[1], o.t.rect[3])), field: o.name });
      y = PH0 - M;
    };
    newPage();
    const headLines = wrapLines(safe(`Continued from: ${o.label} (page ${o.page})`), font, 14, PW - 2 * M);
    headLines.forEach((ln, i) => { if (ln) pg.drawText(ln, { x: M, y: y - 14 - i * 18, size: 14, font }); });
    y -= 16 + headLines.length * 18;
    pg.drawText(c === 'all' ? 'The whole answer was moved here because it did not fit its box.'
      : 'The end of this answer was moved here because it did not fit its box.', { x: M, y, size: 9, font, color: grey });
    y -= 24;
    label(pg, key, `[[${P}:overflow name="${o.name}"]]`, M, y + BS);
    for (const line of wrapLines(moved, font, BS, PW - 2 * M)) {
      if (y < M) { newPage(); y -= BS; }
      if (line) pg.drawText(line, { x: M, y, size: BS, font });
      y -= BS * LEAD;
    }
    label(pg, key, `[[/${P}:overflow]]`, M, Math.max(4, y));
    o.t.value = kept;
    o.t.opts = { ref: c === 'all' ? `Full text on page ${first}` : `(continued on page ${first})` };
    exact.overflow[o.name] = { choice: c, pages, moved };
  }
  for (const t of texts) {
    const { x1, x2, y1, y2 } = boxOf(t.rect);
    label(t.page, t.key, `[[${P}:field name="${t.name}"]]`, x1, y2 - 4);
    if (t.value.trim() || t.opts?.ref) drawFieldText(t.page, font, charset, t.rect, t.value, t.da, t.ff, t.q, t.opts || {});
    label(t.page, t.key, `[[/${P}:field]]`, x2 - 20, y1 + 1);
  }
  const acroRef = pl.catalog.get(N('AcroForm'));
  pl.catalog.set(N(PARK), ctx.obj({ Version: 1, PageCount: ownPages, ...(acroRef ? { AcroForm: acroRef } : {}) }));
  pl.catalog.delete(N('AcroForm'));
  pl.setKeywords([config.keywords]);
  pl.setProducer(config.producer);
  if (state.id) pl.getInfoDict().set(N(KEY.id), PDFHexString.fromText(state.id));
  pl.getInfoDict().set(N('LogbookExported'), PDFHexString.fromText(nowIso()));
  pl.getInfoDict().set(N('LogbookFields'), PDFHexString.fromText(JSON.stringify(exact)));
  return pl.save({ updateFieldAppearances: false });
}

export async function exportPdf() {
  if (!app()?.pdfDocument) return;
  if (state.busy) { toast('Still preparing your PDF…', 3000); return; }
  state.busy = true;
  document.body.classList.add('lb-busy');
  setSaveBadge('Preparing your PDF…');
  try {
    const bytes = await flattenedBytes();
    if (!bytes) { setSaveBadge('Export cancelled', 'warn'); return; }
    app().downloadManager.downloadData(bytes, (state.id || config.noun) + '.pdf', 'application/pdf');
    setSaveBadge('Exported ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
    toast(config.exportMessage, 7000);
  } catch (err) {
    console.error('[typst-editor] export failed', err);
    setSaveBadge('Export failed', 'warn');
    toast('Export failed: ' + err.message, 8000);
  } finally {
    state.busy = false;
    document.body.classList.remove('lb-busy');
  }
}
