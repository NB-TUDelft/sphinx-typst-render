// SPDX-License-Identifier: AGPL-3.0-or-later
/* Fill-in editor on pdf.js, shipped with sphinx-typst-render.
 *
 * viewer.js builds the viewer from pdf.js's own components: the pages, form
 * fields, the Draw tool, zoom and print come from there. On top, this adds:
 *   - image boxes: an "Insert image" button on each img_* field; the image is
 *     fitted inside the box and tagged with its section
 *   - its own toolbar, and an Export button that writes a flattened hand-in
 *     PDF with invisible [[<labelPrefix>:...]] labels around every answer;
 *     the export parks its editable layer inside itself, so opening it here
 *     again puts the fields back and the student can keep working on it
 *   - appending text pages (one big field) and image pages at the end, and
 *     deleting pages that were added (the document's own pages are locked)
 *   - autosave in the browser (IndexedDB), with an offer to restore
 *
 * Every structural change round-trips through pdf-lib: the viewer's current
 * state (form values and annotations) is saved to bytes, changed, and opened
 * again on the same page. Bookkeeping lives in the PDF itself (Info keys and a
 * page-dictionary flag), so a saved copy can be reopened and edited later.
 */
import { config } from './config.js';
import { app, state, AUTOSAVE_MS } from './state.js';
import { toast } from './util.js';
import { setTestFileHook } from './images.js';
import { setSaveBadge } from './status.js';
import { autosaveNow, offerRestore } from './autosave.js';
import { analyse, unparked } from './document.js';
import { insertBlankPage, insertImagePage, deleteCurrentPage } from './pages.js';
import { flattenedBytes, exportPdf } from './export.js';
import { buildBar, syncMode, syncPage, syncZoom, syncTitle, updateDeleteButton } from './toolbar.js';
import { fillSidebar, markCurrent } from './sidebar.js';
import { decoratePage } from './slots.js';
import { onZoom, attachHints, keepFocusThroughZoom, MAX_ZOOM } from './hints.js';

setInterval(autosaveNow, AUTOSAVE_MS);

// Tell other tabs which document is open here; the later tab turns its autosave off.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(config.storage) : null;
if (channel) channel.onmessage = ({ data }) => {
  if (!data || data.id !== state.saveKey || !state.saveKey) return;
  if (data.type === 'hello' && !state.otherTab) channel.postMessage({ type: 'taken', id: state.saveKey });
  if (data.type === 'taken' && !state.otherTab) {
    state.otherTab = true;
    setSaveBadge('Autosave off (open in another tab)');
    toast(`This ${config.noun} is open in another tab too. Autosave is off here, so please work in one tab.`, 9000);
  }
};

async function onDocumentLoaded() {
  const a = app();
  const fresh = !state.reopening; // a file the student opened, not our own rewrite
  if (fresh) {
    // New document: per-document bookkeeping starts over.
    state.doc = null;
    state.filename = a.filename || 'document.pdf';
    state.opCount = 0;
    state.lastHash = null;
    state.otherTab = false;
  }
  const doc = a.pdfDocument;
  if (fresh) {
    const editable = await unparked(doc).catch(err => { console.error('[typst-editor] could not reopen the export', err); return null; });
    if (editable && a.pdfDocument === doc) {
      await a.open({ data: editable, filename: state.filename });
      toast(`Opened your exported ${config.noun}. You can keep working on it.`, 6000);
      return;
    }
  }
  await analyse();
  if (a.pdfDocument !== doc) return; // another file was opened meanwhile
  state.doc = doc;
  buildBar();
  syncTitle();
  updateDeleteButton();
  for (let i = 1; i <= a.pagesCount; i++) decoratePage(i);
  fillSidebar();
  state.reopening = false;
  if (state.onAnalysed) { state.onAnalysed(); state.onAnalysed = null; }
  if (fresh) {
    setSaveBadge('');
    if (channel) channel.postMessage({ type: 'hello', id: state.saveKey });
    await offerRestore();
  }
}

// Ctrl+S downloads nothing: the work saves itself in this browser, Export PDF
// makes the hand-in file, and the menu downloads a copy to keep filling in elsewhere.
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toast('No need to save: your work saves itself in this browser. Use Export PDF to hand it in.', 5000);
  }
}, true);

const bus = app().eventBus;
bus.on('scalechanging', ({ scale }) => {
  if (scale > MAX_ZOOM + 1e-6) { app().pdfViewer.currentScale = MAX_ZOOM; return; }   // pdf.js itself goes to 1000 %
  keepFocusThroughZoom();
  syncZoom(); onZoom();
});
bus.on('pagesloaded', () => { syncPage(); syncZoom(); });
bus.on('annotationeditormodechanged', ({ mode }) => syncMode(mode));
bus.on('documentloaded', () => onDocumentLoaded().catch(err => {
  console.error('[typst-editor]', err);
  state.reopening = false;
  if (state.onAnalysed) state.onAnalysed(); // do not leave a waiting action hanging
}));
bus.on('pagerendered', ({ pageNumber }) => decoratePage(pageNumber));
bus.on('annotationlayerrendered', ({ pageNumber }) => attachHints(pageNumber));
bus.on('pagechanging', () => { updateDeleteButton(); markCurrent(); });
bus.on('documenterror', ({ error }) => toast('Could not open that file: ' + error.message, 8000));

// Read-only state and a file hook for automated tests.
window.typstRenderEditor = {
  state: () => JSON.parse(JSON.stringify({
    id: state.id, slots: state.slots, exercises: state.exercises, pageInfo: state.pageInfo, images: state.images,
  })),
  // Takes the id of a file input, so test drivers in sandboxes need not pass a function.
  setTestFile: id => setTestFileHook(all => { const f = document.getElementById(id)?.files || [];
    return all ? [...f] : f[0] || null; }),
  autosaveNow, exportPdf,
  // Export bytes with a scripted overflow choice ('all' | 'overflow' | 'shrink'), and the items it was asked about.
  exportBytesWith: async pick => { let asked = []; const b = await flattenedBytes(items => {
    asked = items.map(i => ({ name: i.name, page: i.page, extra: i.extra, shrinkTo: i.shrinkTo }));
    return Object.fromEntries(items.map(i => [i.name, pick])); }); return { bytes: b, asked }; },
  insertBlankPage, insertImagePage, deleteCurrentPage,
  slotInsert: name => document.querySelector(`.lb-slot[data-slot="${name}"] [data-act="slot-insert"]`)?.click(),
};

buildBar();
app().start().catch(err => {
  console.error('[typst-editor]', err);
  toast(`Could not open the ${config.noun}: ${err.message}`, 10000);
});
