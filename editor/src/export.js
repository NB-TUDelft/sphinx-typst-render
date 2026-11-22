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
// Pages an answer moves to: margin, body text size, and the note's colour.
const MARGIN = 50, BODY = 10.5, GREY = rgb(0.35, 0.35, 0.35);

const N = n => PDFName.of(n);
const textOf = v => v?.decodeText ? v.decodeText() : '';
// A field attribute, looked up the field's parents too (at most 20 up).
const inherit = (d, key) => {
  for (let n = d, i = 0; n instanceof PDFDict && i < 20; n = n.lookup(N('Parent')), i++) {
    const v = n.lookup(N(key));
    if (v !== undefined) return v;
  }
  return undefined;
};
const fieldName = d => {
  const parts = [];
  for (let n = d, i = 0; n instanceof PDFDict && i < 20; n = n.lookup(N('Parent')), i++) {
    const t = n.lookup(N('T'));
    if (t?.decodeText) parts.unshift(t.decodeText());
  }
  return parts.join('.');
};
// swap quotes inside values only, so the label syntax keeps its own
const attr = (k, v) => v === undefined || v === null || v === '' ? '' : ` ${k}="${String(v).replaceAll('"', "'")}"`;
const slotMeta = name => state.images['slot:' + name] || {};
const imageLabel = (slot, m) => `[[${P}:image slot="${slot}" filled="yes"${attr('exercise', m.exercise)}` +
  `${attr('file', m.original_filename)}${attr('sha256', m.sha256)}${attr('sha512', m.sha512)}]]`;
// Where a label goes for a box: its top left corner.
const top = r => [Math.min(r[0], r[2]), Math.max(r[1], r[3]) - 4];

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
  const x = await exportContext(a);
  const ownPages = x.pl.getPageCount();
  parkLayers(x);
  for (const [pageIndex, page] of x.pl.getPages().entries()) flattenPage(x, page, pageIndex);
  // Answers that do not fit their (fixed) box: ask once, then move or shrink.
  const over = overflowing(x);
  const choice = over.length ? await decide(over) : {};
  if (!choice) return null;                                     // export cancelled
  for (const o of over) settleOverflow(x, o, choice[o.name]);
  drawAnswers(x);
  return finish(x, ownPages);
}

// What one export works with: the document, its font, the labels, and the
// record of what was found (`exact`, written verbatim into the Info dict).
async function exportContext(a) {
  const fontBytes = await loadFieldFont();
  const pl = await PDFDocument.load(await documentBytes(a.pdfDocument), { updateMetadata: false });
  pl.registerFontkit(await loadFontkit());
  const font = await pl.embedFont(fontBytes, { subset: true });
  const charset = new Set(font.getCharacterSet());
  const ctx = pl.context;
  const acro = pl.catalog.lookup(N('AcroForm'));
  const safe = s => [...String(s).replace(/[\r\n]+/g, ' ')]
    .map(c => charset.has(c.codePointAt(0)) ? c : '?').join('');
  return {
    pl, ctx, font, charset,
    daDefault: acro instanceof PDFDict && acro.lookup(N('DA')),
    exact: { pages: [], fields: {}, checks: {}, images: {}, overflow: {} },
    texts: [],                                                  // drawn after all pages, once overflow is decided
    loose: 0,                                                   // images dragged onto pages so far
    nums: arr => (arr instanceof PDFArray) ? arr.asArray().map(v => ctx.lookup(v).asNumber()) : null,
    fontKey: n => n.node.newFontDictionary(font.name, font.ref),
    safe,
    // Invisible labels: text in render mode 3 (not painted), which text
    // extraction (pypdf, pdfplumber, PyMuPDF, pdftotext) still returns. Every
    // answer is wrapped as [[P:field name="…"]] value [[/P:field]], P being
    // config.labelPrefix.
    label: (page, key, str, lx, ly) => page.pushOperators(
      beginText(), setFontAndSize(key, 4), setTextRenderingMode(TextRenderingMode.Invisible),
      setTextMatrix(1, 0, 0, 1, lx, ly), showText(font.encodeText(safe(str))),
      setTextRenderingMode(TextRenderingMode.Fill), endText()),   // Tr is text state and survives ET: reset or the answers drawn next are invisible too
  };
}

// Park each page's own contents and annotations under PARK.
function parkLayers({ pl, ctx }) {
  const copyOf = v => { const o = v && ctx.lookup(v); return o instanceof PDFArray ? ctx.obj(o.asArray()) : v; };
  for (const page of pl.getPages()) {
    const parked = {};
    for (const k of ['Contents', 'Annots']) if (page.node.get(N(k))) parked[k] = copyOf(page.node.get(N(k)));
    page.node.set(N(PARK), ctx.obj(parked));
  }
}

// Paint one page's fields, drawings and images into it, and label what is where.
function flattenPage(x, page, pageIndex) {
  const key = x.fontKey(page);
  const { height: PH } = page.getSize();
  const info = state.pageInfo[pageIndex] || {};
  const kind = info.added ? info.kind : 'template';
  x.label(page, key, `[[${P}:page n="${pageIndex + 1}"${attr('kind', kind)}${attr('exercise', info.exercise)}]]`, 2, PH - 6);
  x.exact.pages.push({ n: pageIndex + 1, kind, exercise: info.exercise || null });
  const annots = page.node.lookup(N('Annots'));
  const list = annots instanceof PDFArray ? annots : x.ctx.obj([]);
  const here = { page, key, pageIndex, keep: [], ops: [], labels: [] };
  for (let i = 0; i < list.size(); i++) flattenAnnot(x, here, list.get(i));
  if (here.keep.length) page.node.set(N('Annots'), x.ctx.obj(here.keep)); else page.node.delete(N('Annots'));
  if (here.ops.length) page.pushOperators(...here.ops);
  for (const [str, lx, ly] of here.labels) x.label(page, key, str, lx, ly);
}

// One annotation: links stay; everything else is labelled and painted in.
function flattenAnnot(x, here, ref) {
  const d = x.ctx.lookup(ref);
  if (!(d instanceof PDFDict)) return;
  const sub = String(d.lookup(N('Subtype')) || '');
  if (sub === '/Link') { here.keep.push(ref); return; }         // bookmarks and links keep working
  if (sub === '/Popup') return;
  const flags = d.lookup(N('F'));
  if ((flags ? flags.asNumber() : 0) & (2 | 32)) return;       // hidden / no-view
  const rect = x.nums(d.lookup(N('Rect')));
  if (sub === '/Widget' && !labelWidget(x, here, d, rect)) return;
  labelImage(x, here, d, sub, rect);
  paintAppearance(x, here, d);
}

// A form field: an empty image slot is labelled, a text field queued to be
// drawn, a checkbox labelled. Whether its appearance is painted in as well.
function labelWidget(x, here, d, rect) {
  const name = fieldName(d);
  if (name.startsWith('img_')) {                                // image slot left empty
    const slot = name.slice(4);
    x.exact.images[slot] = null;
    if (rect) here.labels.push([`[[${P}:image slot="${slot}" filled="no"]]`, ...top(rect)]);
    return false;
  }
  const type = String(inherit(d, 'FT'));
  if (type === '/Tx') {                                         // text field: its value is drawn later
    queueText(x, here, d, rect, name);
    return false;
  }
  if (type === '/Btn') {                                        // checkbox / radio
    const as = d.lookup(N('AS'));
    const on = !!as && String(as) !== '/Off';
    x.exact.checks[name] = on ? String(as).slice(1) : null;
    if (rect) here.labels.push([`[[${P}:check name="${name}" checked="${on ? 'yes' : 'no'}"]]`, ...top(rect)]);
  }
  return true;
}

// A text field's value, kept for drawing once overflow is decided.
function queueText(x, here, d, rect, name) {
  const value = textOf(inherit(d, 'V'));
  const ffv = inherit(d, 'Ff'), qv = inherit(d, 'Q');
  const ff = ffv ? ffv.asNumber() : 0;
  if (!rect || ff & 8192) return;                              // no box, or a password field
  x.exact.fields[name] = value;
  x.texts.push({ page: here.page, key: here.key, rect, value, da: textOf(inherit(d, 'DA') || x.daDefault), ff, q: qv ? qv.asNumber() : 0,
    name, label: textOf(inherit(d, 'TU')) || name, pageNo: here.pageIndex + 1 });
  const pm = state.images['page:' + name];                     // notes field of an image page
  if (pm) {
    x.exact.images['page:' + name] = pm;
    here.labels.push([imageLabel('page:' + name, pm), Math.min(rect[0], rect[2]), Math.max(rect[1], rect[3]) + 14]);
  }
}

// An image in a slot, or one dragged or pasted onto the page, labelled with what is known of it.
function labelImage(x, here, d, sub, rect) {
  if (!rect) return;
  const nm = textOf(d.lookup(N('NM')));
  if (nm.startsWith(config.slotPrefix)) {                       // image in a slot
    const slot = nm.slice(config.slotPrefix.length), m = slotMeta(slot);
    x.exact.images[slot] = m;
    here.labels.push([imageLabel(slot, m), ...top(rect)]);
  } else if (sub === '/Stamp') {                                // image dragged or pasted onto the page
    const page = here.pageIndex + 1;
    const id = `loose:${page}-${++x.loose}`;
    const m = { kind: 'loose', page, exercise: exerciseAt(here.pageIndex, Math.max(rect[1], rect[3])),
      rect: rect.map(v => Math.round(v * 10) / 10) };
    x.exact.images[id] = m;
    here.labels.push([`[[${P}:image loose="${id.slice(6)}" filled="yes"${attr('exercise', m.exercise)}]]`, ...top(rect)]);
  }
}

// An annotation's normal appearance, painted into the page over its rectangle.
function paintAppearance(x, here, d) {
  const ap = d.lookup(N('AP'));
  if (!(ap instanceof PDFDict)) return;
  let apRef = ap.get(N('N')), n = x.ctx.lookup(apRef);
  if (n instanceof PDFDict) {                                   // on/off states (checkboxes)
    const as = d.lookup(N('AS'));
    if (!as) return;
    apRef = n.get(as); n = x.ctx.lookup(apRef);
  }
  if (!(n instanceof PDFStream)) return;
  if (!(apRef instanceof PDFRef)) apRef = x.ctx.register(n);
  const bbox = x.nums(n.dict.lookup(N('BBox'))), rect = x.nums(d.lookup(N('Rect')));
  if (!bbox || !rect) return;
  const matrix = x.nums(n.dict.lookup(N('Matrix'))) || [1, 0, 0, 1, 0, 0];
  // Map the appearance box (after its own Matrix) onto the annotation rectangle.
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map(([px, py]) => [matrix[0] * px + matrix[2] * py + matrix[4], matrix[1] * px + matrix[3] * py + matrix[5]]);
  const bx1 = Math.min(...pts.map(p => p[0])), bx2 = Math.max(...pts.map(p => p[0]));
  const by1 = Math.min(...pts.map(p => p[1])), by2 = Math.max(...pts.map(p => p[1]));
  const rx1 = Math.min(rect[0], rect[2]), rx2 = Math.max(rect[0], rect[2]);
  const ry1 = Math.min(rect[1], rect[3]), ry2 = Math.max(rect[1], rect[3]);
  if (bx2 - bx1 < 1e-6 || by2 - by1 < 1e-6) return;
  const sx = (rx2 - rx1) / (bx2 - bx1), sy = (ry2 - ry1) / (by2 - by1);
  const xobject = here.page.node.newXObject('Flat', apRef);
  here.ops.push(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rx1 - sx * bx1, ry1 - sy * by1),
    drawObject(xobject), popGraphicsState());
}

// Multi-line answers that do not fit their box, with where the cut falls and
// the size they would fit at.
function overflowing({ texts, font, charset }) {
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
  return over;
}

// The student's choice for one answer that does not fit: shrink it, or move
// its end ('overflow', the default) or all of it to pages after the document.
function settleOverflow(x, o, picked = 'overflow') {
  const c = picked === 'shrink' && !o.shrinkTo ? 'overflow' : picked;   // shrinking is offered only when it fits
  if (c === 'shrink') {
    o.t.opts = { size: o.shrinkTo };
    x.exact.overflow[o.name] = { choice: c, size: o.shrinkTo };
    return;
  }
  const kept = c === 'all' ? '' : o.t.txt.slice(0, o.t.cut).trimEnd();
  const moved = c === 'all' ? o.t.txt : o.t.txt.slice(o.t.cut).trimStart();
  const first = x.pl.getPageCount() + 1;
  const pages = writeOverflowPages(x, o, c, moved);
  o.t.value = kept;
  o.t.opts = { ref: c === 'all' ? `Full text on page ${first}` : `(continued on page ${first})` };
  x.exact.overflow[o.name] = { choice: c, pages, moved };
}

// The moved text on pages of its own, under a heading that says where it came from.
function writeOverflowPages(x, o, c, moved) {
  const { pl, font, label } = x;
  const { width: PW, height: PH } = pl.getPage(0).getSize();
  const pages = [];
  let pg, key, y;
  const newPage = () => {
    pg = pl.addPage([PW, PH]); key = x.fontKey(pg);
    const n = pl.getPageCount(); pages.push(n);
    label(pg, key, `[[${P}:page n="${n}" kind="overflow"${attr('field', o.name)}]]`, 2, PH - 6);
    x.exact.pages.push({ n, kind: 'overflow', exercise: exerciseAt(o.t.pageNo - 1, Math.max(o.t.rect[1], o.t.rect[3])), field: o.name });
    y = PH - MARGIN;
  };
  newPage();
  const headLines = wrapLines(x.safe(`Continued from: ${o.label} (page ${o.page})`), font, 14, PW - 2 * MARGIN);
  headLines.forEach((ln, i) => { if (ln) pg.drawText(ln, { x: MARGIN, y: y - 14 - i * 18, size: 14, font }); });
  y -= 16 + headLines.length * 18;
  pg.drawText(c === 'all' ? 'The whole answer was moved here because it did not fit its box.'
    : 'The end of this answer was moved here because it did not fit its box.', { x: MARGIN, y, size: 9, font, color: GREY });
  y -= 24;
  label(pg, key, `[[${P}:overflow name="${o.name}"]]`, MARGIN, y + BODY);
  for (const line of wrapLines(moved, font, BODY, PW - 2 * MARGIN)) {
    if (y < MARGIN) { newPage(); y -= BODY; }
    if (line) pg.drawText(line, { x: MARGIN, y, size: BODY, font });
    y -= BODY * LEAD;
  }
  label(pg, key, `[[/${P}:overflow]]`, MARGIN, Math.max(4, y));
  return pages;
}

// Every text field's answer, between its labels.
function drawAnswers({ texts, font, charset, label }) {
  for (const t of texts) {
    const { x1, x2, y1, y2 } = boxOf(t.rect);
    label(t.page, t.key, `[[${P}:field name="${t.name}"]]`, x1, y2 - 4);
    if (t.value.trim() || t.opts?.ref) drawFieldText(t.page, font, charset, t, t.opts || {});
    label(t.page, t.key, `[[/${P}:field]]`, x2 - 20, y1 + 1);
  }
}

// The form parked beside the pages' layers, a record of what the export
// holds, and the saved bytes.
function finish({ pl, ctx, exact }, ownPages) {
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
