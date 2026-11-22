// SPDX-License-Identifier: AGPL-3.0-or-later
import { AnnotationMode } from 'pdfjs-dist';
import { $ } from './util.js';
import { app, ui } from './state.js';
import { config } from './config.js';

// ----------------------------------------------------------- page sidebar
// Our own page overview: pdf.js's sidebar also merges and reorders files,
// which a logbook must not do. Thumbnails render when they scroll into view
// (with what is typed and drawn so far); click one to go to that page.
const SIDE_KEY = `${config.storage}-sidebar`, THUMB_W = 128;
export const side = { el: null, list: null, observer: null, open: false, doc: null, gen: 0 };
const sideWanted = () => {
  try { const v = localStorage.getItem(SIDE_KEY); if (v) return v === 'open'; } catch (_) { /* storage blocked: go by the width */ }
  return innerWidth >= 1100;
};
export function buildSidebar() {
  side.list = $('div', { class: 'lb-side-list' });
  side.el = $('nav', { id: 'lbSide', 'aria-label': 'Page overview' }, side.list);
  document.body.append(side.el);
  setSidebar(sideWanted(), false);
}
export function setSidebar(open, remember = true) {
  side.open = open;
  document.body.classList.toggle('lb-side-open', open);
  side.el.inert = !open;
  ui.sideBtn?.setAttribute('aria-pressed', String(open));
  ui.sideBtn?.classList.toggle('lb-on', open);
  if (remember) { try { localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed'); } catch (_) {} }
  if (open) fillSidebar();
  globalThis.dispatchEvent(new Event('resize'));          // pdf.js fits the page to the new width
}
export function fillSidebar() {
  const a = app(), doc = a?.pdfDocument;
  if (!side.list || !doc || !side.open) return;
  if (side.doc === doc && side.list.children.length === a.pagesCount) { markCurrent(); return; }
  side.doc = doc;
  const gen = ++side.gen;
  side.observer?.disconnect();
  side.list.replaceChildren();
  side.observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { side.observer.unobserve(e.target); void drawThumb(e.target, gen); }
  }, { root: side.el, rootMargin: '300px' });
  for (let n = 1; n <= a.pagesCount; n++) {
    const vp = a.pdfViewer.getPageView(n - 1)?.viewport;
    const canvas = $('canvas', { class: 'lb-thumb-canvas' });
    canvas.style.aspectRatio = vp ? `${vp.width} / ${vp.height}` : '1 / 1.414';
    const item = $('button', { type: 'button', class: 'lb-thumb', id: 'lbThumb_' + n, 'data-page': n, 'aria-label': 'Page ' + n,
      onclick: () => { a.pdfViewer.currentPageNumber = n; if (innerWidth < 700) setSidebar(false, false); } },
      canvas, $('span', { class: 'lb-thumb-num' }, String(n)));
    side.list.append(item);
    side.observer.observe(item);
  }
  markCurrent();
}
async function drawThumb(item, gen) {
  const n = +item.dataset.page, canvas = item.querySelector('canvas');
  try {
    const page = await app().pdfDocument.getPage(n);
    if (gen !== side.gen) return;
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: THUMB_W * (window.devicePixelRatio || 1) / base.width });
    canvas._lbTask?.cancel();             // a redraw replaces one still running
    await canvas._lbTask?.promise.catch(() => {});
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const mode = AnnotationMode.ENABLE_STORAGE;   // include typed answers
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, annotationMode: mode });
    canvas._lbTask = task;
    await task.promise;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.warn('[typst-editor] thumbnail', n, err);
  }
}
let lastPage = 1;
export function markCurrent() {
  if (!side.list) return;
  const cur = app()?.pdfViewer?.currentPageNumber || 1;
  // Redraw the page just left, so its thumbnail shows what was typed there.
  if (side.open && lastPage !== cur) { const prev = side.list.querySelector(`[data-page="${lastPage}"]`); if (prev) void drawThumb(prev, side.gen); }
  lastPage = cur;
  for (const it of side.list.children) {
    const on = +it.dataset.page === cur;
    it.classList.toggle('lb-current', on);
    if (on) it.setAttribute('aria-current', 'page'); else it.removeAttribute('aria-current');
  }
  side.list.querySelector('.lb-current')?.scrollIntoView({ block: 'nearest' });
}
