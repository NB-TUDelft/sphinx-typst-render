// SPDX-License-Identifier: AGPL-3.0-or-later
// Reading the open document (fields, image boxes, sections) and changing it:
// every structural change saves the viewer's state, edits it with pdf-lib
// and opens the result again on the same page.
import {
  PDFDocument, PDFName, PDFString, PDFHexString, PDFBool, PDFArray, PDFDict,
  degrees, drawImage as opDrawImage, pushGraphicsState, popGraphicsState,
} from 'pdf-lib';
import { app, state, KEY, GENERAL } from './state.js';
import { toast, ansi } from './util.js';
import { contain } from './images.js';
import { saveKeyOf } from './storage.js';
import { autosaveNow } from './autosave.js';
import { config } from './config.js';

// The document as bytes, with what was typed and drawn. pdf.js asks for
// getData() rather than saveDocument() when nothing changed since it loaded.
export const documentBytes = doc => (doc.annotationStorage.size > 0 ? doc.saveDocument() : doc.getData());

// ----------------------------------------------------------- reading
// Sections and their sub-parts (subsection() in the templates), in page order.
// A sub-part's title is "SECTION (Tasks ...) › Sub-part", so tags stay readable
// on their own; `label` and `depth` are for the dropdown.
async function readOutline(doc) {
  const out = [];
  const items = (await doc.getOutline()) || [];
  const walk = async (list, parent = null, depth = 0) => {
    for (const it of list) {
      let page = -1, top = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
          if (dest[1] && dest[1].name === 'XYZ' && typeof dest[3] === 'number') top = dest[3];
        }
      } catch (_) {}
      const title = parent ? `${parent} › ${it.title}` : it.title;
      out.push({ title, label: it.title, depth, page, top });
      if (it.items && it.items.length) await walk(it.items, title, depth + 1);
    }
  };
  await walk(items);
  return out;
}

// Exercise for a page: the last section that starts on or before it.
export function exerciseForPage(pageIndex) {
  const pi = state.pageInfo[pageIndex];
  if (pi && pi.added && pi.exercise) return pi.exercise;
  let found = null;
  for (const e of state.exercises) if (e.page >= 0 && e.page <= pageIndex) found = e.title;
  return found || GENERAL;
}

// The section or sub-part that starts above a point (its top edge, in PDF
// units) on a page, or earlier. Added pages carry their own.
export function exerciseAt(page, top) {
  const pi = state.pageInfo[page];
  if (pi && pi.added && pi.exercise) return pi.exercise;
  let found = null;
  for (const e of state.exercises) {
    if (e.page < 0) continue;
    if (e.page < page || (e.page === page && (e.top === null || e.top >= top))) found = e.title;
  }
  return found || GENERAL;
}

const templateIndexOf = (ordinal) => {
  let n = -1;
  for (let i = 0; i < state.pageInfo.length; i++) {
    if (!state.pageInfo[i].added && ++n === ordinal) return i;
  }
  return -1;
};
// A template box is found by its template page; a box on an added page by that page's id.
export const slotPageIndex = slot => slot.pageId
  ? state.pageInfo.findIndex(p => p.id === slot.pageId) : templateIndexOf(slot.ordinal);

export async function analyse() {
  const a = app(), doc = a.pdfDocument;
  const bytes = await doc.getData();
  const pl = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = pl.getInfoDict();
  const infoStr = k => {
    const v = info.lookup(PDFName.of(k));
    return v && v.decodeText ? v.decodeText() : null;
  };
  state.pageInfo = pl.getPages().map(p => {
    const added = p.node.lookup(PDFName.of(KEY.added)) === PDFBool.True;
    const kind = p.node.lookup(PDFName.of(KEY.kind));
    const ex = p.node.lookup(PDFName.of(KEY.exercise));
    const pid = p.node.lookup(PDFName.of(KEY.pageId));
    const text = v => v && v.decodeText ? v.decodeText() : null;
    return { added, kind: text(kind), exercise: text(ex), id: text(pid) };
  });
  state.id = infoStr(KEY.id) || (a.filename || 'document.pdf').replace(/\.pdf$/i, '').replace(/[_ ]edited$/i, '');
  state.saveKey = saveKeyOf(state.id);
  const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch (_) { return fallback; } };
  state.images = parse(infoStr(KEY.images), {});
  state.exercises = await readOutline(doc);

  const stored = parse(infoStr(KEY.slots), null);
  if (Array.isArray(stored)) {
    state.slots = stored;
  } else {
    // First open of a template: slots come from the img_* form fields.
    state.slots = [];
    // getFieldObjects() comes back empty in pdf.js 6 here, so read widgets per page.
    for (let p = 0; p < doc.numPages; p++) {
      const annots = await (await doc.getPage(p + 1)).getAnnotations({ intent: 'display' });
      for (const o of annots) {
        if (!o.fieldName || !o.fieldName.startsWith('img_') || !o.rect) continue;
        let ordinal = -1;
        for (let i = 0; i <= p; i++) if (!state.pageInfo[i].added) ordinal++;
        state.slots.push({ name: o.fieldName.slice(4), ordinal, rect: o.rect });
      }
    }
  }
  for (const s of state.slots) {
    if (s.pageId) continue;               // a box on an added page keeps the exercise it was made for
    s.exercise = s.exercise || exerciseAt(templateIndexOf(s.ordinal), Math.max(s.rect[1], s.rect[3]));
  }
}

// ------------------------------------------------------------ rewriting
export async function reopen(bytes) {
  const a = app();
  const page = a.pdfViewer.currentPageNumber;
  state.reopening = true;
  let timer;
  // Wait for the pages and for onDocumentLoaded to have read slots and tags.
  const pages = new Promise(r => a.eventBus.on('pagesloaded', r, { once: true }));
  const analysed = new Promise(r => { state.onAnalysed = r; });
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`the ${config.noun} took too long to reopen`)), 60000);
  });
  try {
    await a.open({ data: bytes, filename: state.filename });
    await Promise.race([Promise.all([pages, analysed]), timeout]);
  } finally {
    clearTimeout(timer);
    state.onAnalysed = null;
  }
  a.pdfViewer.currentPageNumber = Math.min(page, a.pagesCount);
}

// Save the live viewer state, let `fn` change it with pdf-lib, reopen.
export async function transform(fn, targetPage) {
  const a = app();
  a.pdfViewer._layerProperties?.annotationEditorUIManager?.endCurrentEditing?.();
  while (state.busy) await new Promise(r => setTimeout(r, 50));
  state.busy = true;
  document.body.classList.add('lb-busy');
  try {
    const pl = await PDFDocument.load(await documentBytes(a.pdfDocument), { updateMetadata: false });
    const result = await fn(pl);
    pl.setKeywords([config.keywords]);
    pl.getInfoDict().set(PDFName.of(KEY.id), PDFHexString.fromText(state.id));
    pl.getInfoDict().set(PDFName.of(KEY.slots), PDFHexString.fromText(JSON.stringify(
      state.slots.map(({ name, ordinal, pageId, rect, exercise }) => ({ name, ordinal, pageId, rect, exercise })))));
    pl.getInfoDict().set(PDFName.of(KEY.images), PDFHexString.fromText(JSON.stringify(state.images)));
    // pdf.js already wrote the field appearances (with fonts that cover Ω, µ, ...);
    // pdf-lib regenerating them with WinAnsi Helvetica would fail on those characters.
    const bytes = await pl.save({ updateFieldAppearances: false });
    state.opCount++;
    await reopen(bytes);  // busy stays set until the new document is up
    if (targetPage) app().pdfViewer.currentPageNumber = targetPage;
    await autosaveNow(true);
    return result;
  } catch (err) {
    console.error('[typst-editor]', err);
    toast('Something went wrong: ' + err.message);
  } finally {
    state.busy = false;
    document.body.classList.remove('lb-busy');
  }
}

const slotNM = name => config.slotPrefix + name;

function removeAnnotsByNM(page, nm) {
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return;
  const keep = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const d = page.doc.context.lookup(ref);
    const n = d instanceof PDFDict ? d.lookup(PDFName.of('NM')) : null;
    if (!(n && n.decodeText && n.decodeText() === nm)) keep.push(ref);
  }
  page.node.set(PDFName.of('Annots'), page.doc.context.obj(keep));
}

// The slot image is a Stamp annotation (not page content), so Replace and
// Remove can take it out again cleanly.
export async function placeInSlot(slot, rec) {
  const pageIndex = slotPageIndex(slot);
  await transform(async pl => {
    const page = pl.getPage(pageIndex);
    removeAnnotsByNM(page, slotNM(slot.name));
    try { const f = pl.getForm().getField('img_' + slot.name); pl.getForm().removeField(f); } catch (_) {}
    if (!rec) { delete state.images['slot:' + slot.name]; return; }
    await stampImage(pl, page, slot, rec, pageIndex);
  }, pageIndex + 1);
}

// Put an image into a box as a Stamp annotation, centred and scaled to fit.
export async function stampImage(pl, page, slot, rec, pageIndex) {
    const [x1, y1, x2, y2] = slot.rect;
    const inset = 2;
    const fit = contain(rec.w, rec.h, (x2 - x1) - 2 * inset, (y2 - y1) - 2 * inset);
    const x = x1 + ((x2 - x1) - fit.w) / 2, y = y1 + ((y2 - y1) - fit.h) / 2;
    const img = await pl.embedJpg(rec.bytes);
    const ctx = pl.context;
    const ops = [pushGraphicsState(), ...opDrawImage('Im0', { x: 0, y: 0, width: fit.w, height: fit.h, rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0) }), popGraphicsState()];
    const ap = ctx.register(ctx.formXObject(ops, {
      BBox: [0, 0, fit.w, fit.h], Resources: { XObject: { Im0: img.ref } },
    }));
    const annot = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Stamp', Rect: [x, y, x + fit.w, y + fit.h], F: 4 | 128,
      NM: PDFString.of(slotNM(slot.name)),
      Contents: PDFHexString.fromText(ansi('Image for: ' + slot.exercise)),
      AP: { N: ap },
    }));
    page.node.addAnnot(annot);
    state.images['slot:' + slot.name] = { ...rec.meta, kind: 'slot', slot: slot.name, exercise: slot.exercise, page: pageIndex + 1 };
}

export function markAdded(page, kind, exercise, pageId) {
  page.node.set(PDFName.of(KEY.added), PDFBool.True);
  if (pageId) page.node.set(PDFName.of(KEY.pageId), PDFHexString.fromText(pageId));
  page.node.set(PDFName.of(KEY.kind), PDFHexString.fromText(kind));
  if (exercise) page.node.set(PDFName.of(KEY.exercise), PDFHexString.fromText(exercise));
}
