// SPDX-License-Identifier: AGPL-3.0-or-later
// Pages students add at the end (text pages and image pages), and deleting them.
import { StandardFonts, rgb } from 'pdf-lib';
import { app, state } from './state.js';
import { toast, ansi } from './util.js';
import { getImageFiles, imageRecord } from './images.js';
import { wrapLines } from './text.js';
import { askTextPage, askImagePage, askConfirm } from './dialogs.js';
import { transform, exerciseForPage, stampImage, markAdded } from './document.js';

// Added pages always go at the end of the logbook (no reordering).
// A text page is one big text field, so what is written on it stays readable by code.
export async function insertBlankPage() {
  const a = app();
  const at = a.pagesCount;
  const exercise = await askTextPage(exerciseForPage(a.pdfViewer.currentPageNumber - 1));
  if (!exercise) return;
  await transform(async pl => {
    const { width: W, height: H } = pl.getPage(0).getSize();
    const page = pl.insertPage(at, [W, H]);
    const bold = await pl.embedFont(StandardFonts.HelveticaBold);
    const regular = await pl.embedFont(StandardFonts.Helvetica);
    const M = 40;
    const head = ansi('Text for: ' + exercise);
    const headLines = wrapLines(head, bold, 12, W - 2 * M);
    headLines.forEach((ln, i) => ln && page.drawText(ln, { x: M, y: H - M - 12 - i * 15, size: 12, font: bold }));
    const subY = H - M - 12 - headLines.length * 15 - 2;
    page.drawText('Added page', { x: M, y: subY, size: 8, font: regular, color: rgb(0.45, 0.45, 0.45) });
    const id = 'added_text_' + Date.now().toString(36);
    const field = pl.getForm().createTextField(id);
    field.enableMultiline();
    const topGap = (H - subY) + 12;
    field.addToPage(page, { x: M, y: M, width: W - 2 * M, height: H - M - topGap, font: regular, borderWidth: 0.5,
                            borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(0.97, 0.98, 0.98) });
    field.setFontSize(10);
    markAdded(page, 'text', exercise);
  }, at + 1);
}

// An image page holds a grid of image boxes (1 x 1 up to 3 across, 6 down)
// and a notes box. The chosen images fill the boxes left to right, top to
// bottom; each box can be filled, replaced or emptied later like any other.
export async function insertImagePage() {
  const at = app().pagesCount;
  const choice = await askImagePage(exerciseForPage(app().pdfViewer.currentPageNumber - 1));
  if (!choice) return;
  const { exercise, cols, rows } = choice;
  const files = await getImageFiles();
  if (!files || !files.length) return;
  const recs = [];
  for (const file of files.slice(0, cols * rows)) {
    try { recs.push(await imageRecord(file)); }
    catch (err) { toast(`Could not read ${file.name} (${err.message}). Try a JPEG or PNG.`); }
  }
  if (!recs.length) return;
  if (files.length > cols * rows) toast(cols * rows === 1 ? 'Only the first image fits on this page.' : `Only the first ${cols * rows} images fit on this page.`);
  await transform(async pl => {
    const { width: W, height: H } = pl.getPage(0).getSize();
    const page = pl.insertPage(at, [W, H]);
    const bold = await pl.embedFont(StandardFonts.HelveticaBold);
    const regular = await pl.embedFont(StandardFonts.Helvetica);
    const M = 40, notesH = rows > 3 ? 90 : 120, gap = 8;
    const head = ansi('Image for: ' + exercise);
    const headLines = wrapLines(head, bold, 12, W - 2 * M);
    headLines.forEach((ln, i) => ln && page.drawText(ln, { x: M, y: H - M - 12 - i * 15, size: 12, font: bold }));
    const subY = H - M - 12 - headLines.length * 15 - 2;
    page.drawText('Added page', { x: M, y: subY, size: 8, font: regular, color: rgb(0.45, 0.45, 0.45) });
    const pageId = 'p' + Date.now().toString(36);
    const top = subY - 12, bottom = M + notesH + 24;
    const cw = (W - 2 * M - (cols - 1) * gap) / cols, ch = (top - bottom - (rows - 1) * gap) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = M + c * (cw + gap), y = top - (r + 1) * ch - r * gap;
      // the same box as an image box in the templates (logbook_common.typ image_slot)
      page.drawRectangle({ x, y, width: cw, height: ch, borderWidth: 0.5, borderColor: rgb(0.667, 0.667, 0.667), color: rgb(247 / 255, 249 / 255, 251 / 255) });
      const slot = { name: `${pageId}_r${r + 1}c${c + 1}`, pageId, rect: [x, y, x + cw, y + ch], exercise };
      state.slots.push(slot);
      cells.push(slot);
    }
    page.drawText('Notes:', { x: M, y: M + notesH + 6, size: 9, font: bold });
    const id = 'added_notes_' + Date.now().toString(36);
    const notes = pl.getForm().createTextField(id);
    notes.enableMultiline();
    notes.addToPage(page, { x: M, y: M, width: W - 2 * M, height: notesH, font: regular, borderWidth: 0.5, borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(0.97, 0.98, 0.98) });
    notes.setFontSize(9);
    markAdded(page, 'image', exercise, pageId);
    for (let i = 0; i < recs.length; i++) await stampImage(pl, page, cells[i], recs[i], at);
  }, at + 1);
}

export async function deleteCurrentPage() {
  const n = app().pdfViewer.currentPageNumber;
  const info = state.pageInfo[n - 1];
  if (!info || !info.added) return;
  if (!await askConfirm(`Delete page ${n}?`, 'This page and everything on it will be removed.', 'Delete page')) return;
  await transform(async pl => {
    // drop metadata of an image page's notes field on this page
    const page = pl.getPage(n - 1);
    const widgetIds = new Set();
    for (const f of pl.getForm().getFields()) {
      if (f.acroField.getWidgets().some(w => String(w.P && w.P()) === String(page.ref))) {
        widgetIds.add(f.getName());
        pl.getForm().removeField(f);
      }
    }
    for (const id of widgetIds) delete state.images['page:' + id];
    if (info.id) {                        // image boxes on this page, and their images
      for (const s of state.slots.filter(s => s.pageId === info.id)) delete state.images['slot:' + s.name];
      state.slots = state.slots.filter(s => s.pageId !== info.id);
    }
    pl.removePage(n - 1);
  }, Math.max(1, n - 1));
}
