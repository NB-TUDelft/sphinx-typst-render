// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer, assembled from pdf.js's own components: PDFViewer (pages, form
// fields, the drawing tool, zoom, pinch), EventBus, PDFLinkService,
// DownloadManager and ProgressBar, wired the way pdf.js's stock viewer app
// (web/app.js) wires them. What that app adds on top, its toolbar, sidebar,
// find bar, preferences and PDF scripts, the editor replaces or does without.
// Printing is ported from the app's print service (web/pdf_print_service.js),
// which pdfjs-dist does not export.
import { AnnotationEditorType, AnnotationMode, GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
// pdf_viewer.mjs reads the library from globalThis.pdfjsLib, which importing
// pdfjs-dist sets, so it must be imported second.
import { DownloadManager, EventBus, PDFLinkService, PDFViewer, ProgressBar } from 'pdfjs-dist/web/pdf_viewer.mjs';

// The runtime files sit beside this bundle (see build.mjs).
const HERE = new URL('.', import.meta.url);
export const assetUrl = path => new URL(path, HERE).href;

// The worker carries this bundle's ?v= cache key, so a new release is not
// mixed with a cached worker of the previous one.
GlobalWorkerOptions.workerSrc = assetUrl('pdf.worker.mjs' + new URL(import.meta.url).search);

// Files a PDF may need while it loads, as the stock viewer passes them.
export const documentOptions = {
  cMapUrl: assetUrl('pdfjs/cmaps/'),
  iccUrl: assetUrl('pdfjs/iccs/'),
  standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
  wasmUrl: assetUrl('pdfjs/wasm/'),
};

// pdf.js prints at 150 dpi (PRINT_UNITS in web/pdf_print_service.js).
const PRINT_UNITS = 150 / 72;

class Viewer {
  #nativePrint = window.print.bind(window);
  #printing = false;
  // The open document's loading task. Destroying it frees the document, as
  // the stock app's close() does (pdfLoadingTask.destroy()).
  #loadingTask = null;

  constructor() {
    const container = document.getElementById('viewerContainer');
    this.eventBus = new EventBus();
    this.linkService = new PDFLinkService({ eventBus: this.eventBus });
    this.downloadManager = new DownloadManager();
    this.pdfViewer = new PDFViewer({
      container,
      eventBus: this.eventBus,
      linkService: this.linkService,
      downloadManager: this.downloadManager,
      annotationMode: AnnotationMode.ENABLE_FORMS,
      // NONE rather than DISABLE: the editor layer has to exist for the Draw tool.
      annotationEditorMode: AnnotationEditorType.NONE,
      imageResourcesPath: assetUrl('pdfjs/images/'),
    });
    this.linkService.setViewer(this.pdfViewer);
    this.loadingBar = new ProgressBar(document.getElementById('loadingBar'));
    this.pdfDocument = null;
    this.filename = null;

    // The stock app's handlers for the editor tools
    // (webViewerSwitchAnnotationEditorMode and ...Params in web/app.js).
    this.eventBus.on('switchannotationeditormode', ({ mode, editId, isFromKeyboard }) => {
      this.pdfViewer.annotationEditorMode = { mode, editId, isFromKeyboard };
    });
    this.eventBus.on('switchannotationeditorparams', ({ type, value }) => {
      this.pdfViewer.annotationEditorParams = { type, value };
    });
    window.addEventListener('keydown', e => this.#onKeyDown(e));
    container.addEventListener('wheel', e => this.#onWheel(e), { passive: false });
    // A print started from a script goes through the rendering below, as in
    // the stock viewer, which also replaces window.print.
    window.print = () => this.print();
  }

  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  }

  // Opens the PDF that ?file= names. It must be on this site.
  async start() {
    const file = new URLSearchParams(location.search).get('file');
    if (!file) return;
    const url = new URL(file, location.href);
    if (url.origin !== location.origin) throw new Error('the file must be on this site');
    await this.open({ url: url.href });
  }

  // Opens a document from a URL or from bytes. While one is open (the
  // editor's rewrites), the new one replaces it in place and keeps the zoom,
  // without the blank page the stock app shows between close and open.
  async open({ url = null, data = null, filename = null }) {
    const scale = this.pdfDocument ? this.pdfViewer.currentScaleValue : null;
    const task = getDocument({ ...documentOptions, ...(data ? { data } : { url }) });
    task.onProgress = ({ loaded, total }) => {
      this.loadingBar.percent = total ? Math.round((100 * loaded) / total) : NaN;
    };
    this.loadingBar.show();
    let doc;
    try {
      doc = await task.promise;
    } finally {
      this.loadingBar.hide();
    }
    const oldTask = this.#loadingTask;
    this.#loadingTask = task;
    this.pdfDocument = doc;
    this.filename = filename
      || (url ? decodeURIComponent(new URL(url).pathname.split('/').pop()) : 'document.pdf');
    const pagesInit = new Promise(resolve => this.eventBus.on('pagesinit', resolve, { once: true }));
    this.pdfViewer.setDocument(doc);
    this.linkService.setDocument(doc);
    await pagesInit;
    this.pdfViewer.currentScaleValue = scale || 'auto';
    oldTask?.destroy();
    this.eventBus.dispatch('documentloaded', { source: this });
  }

  // "Open a saved copy": a PDF from this computer replaces the open one.
  openFile() {
    const input = Object.assign(document.createElement('input'), {
      type: 'file', accept: '.pdf,application/pdf', className: 'lb-hidden-input',
    });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try {
        await this.open({ data: new Uint8Array(await file.arrayBuffer()), filename: file.name });
      } catch (error) {
        this.eventBus.dispatch('documenterror', { source: this, error });
      }
    });
    input.addEventListener('cancel', () => input.remove());
    document.body.append(input);
    input.click();
  }

  // An editable copy, form fields and drawings kept, written by pdf.js.
  async saveCopy() {
    if (!this.pdfDocument) return;
    this.#finishDrawing();
    const doc = this.pdfDocument;
    const data = doc.annotationStorage.size > 0 ? await doc.saveDocument() : await doc.getData();
    this.downloadManager.downloadData(data, this.filename, 'application/pdf');
  }

  // As pdf.js's print service: every page rendered with the print intent and
  // the form values and drawings (annotationStorage.print) at 150 dpi, as
  // images in #printContainer, which is all the print stylesheet shows.
  async print() {
    const doc = this.pdfDocument;
    if (!doc || this.#printing) return;
    this.#printing = true;
    this.#finishDrawing();
    const container = document.getElementById('printContainer');
    const pageSize = document.createElement('style');
    const urls = [];
    const cleanup = () => {
      delete document.body.dataset.printing;
      container.replaceChildren();
      pageSize.remove();
      urls.forEach(u => URL.revokeObjectURL(u));
      this.#printing = false;
    };
    try {
      const storage = doc.annotationStorage.print;
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      pageSize.textContent = `@page { size: ${first.width}pt ${first.height}pt; margin: 0; }`;
      document.head.append(pageSize);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * PRINT_UNITS);
        canvas.height = Math.floor(viewport.height * PRINT_UNITS);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas, canvasContext: ctx, viewport,
          transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0],
          intent: 'print',
          annotationMode: AnnotationMode.ENABLE_STORAGE,
          printAnnotationStorage: storage,
        }).promise;
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        urls.push(img.src);
        const sheet = document.createElement('div');
        sheet.className = 'printedPage';
        sheet.append(img);
        container.append(sheet);
        await img.decode();
      }
    } catch (error) {
      cleanup();
      throw error;
    }
    document.body.dataset.printing = '';
    window.addEventListener('afterprint', cleanup, { once: true });
    this.#nativePrint();
  }

  // Commit a drawing still in progress, so it is saved and printed too.
  #finishDrawing() {
    this.pdfViewer._layerProperties?.annotationEditorUIManager?.endCurrentEditing?.();
  }

  // A few of the stock viewer's shortcuts (webViewerKeyDown in web/app.js).
  #onKeyDown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    switch (e.key) {
      case '+': case '=': this.pdfViewer.increaseScale(); break;
      case '-': this.pdfViewer.decreaseScale(); break;
      case '0': this.pdfViewer.currentScaleValue = 'auto'; break;
      case 'p': case 'P': this.print().catch(error => console.error('[typst-editor] print', error)); break;
      case 'o': case 'O': this.openFile(); break;
      default: return;
    }
    e.preventDefault();
  }

  // Ctrl + wheel and trackpad pinches zoom the pages, not the browser
  // (webViewerWheel in web/app.js): a pinch in small steps, a wheel click by one.
  #onWheel(e) {
    if (!(e.ctrlKey || e.metaKey) || !this.pdfDocument) return;
    e.preventDefault();
    const origin = [e.clientX, e.clientY];
    if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
      this.pdfViewer.updateScale({ scaleFactor: Math.exp(-e.deltaY / 100), origin, drawingDelay: 400 });
    } else {
      this.pdfViewer.updateScale({ steps: e.deltaY < 0 ? 1 : -1, origin, drawingDelay: 400 });
    }
  }
}

export const viewer = new Viewer();
