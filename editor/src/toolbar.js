// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's own toolbar (it replaces pdf.js's), its menus and tool modes.
import { AnnotationEditorParamsType, AnnotationEditorType } from 'pdfjs-dist';
import { app, state, ui } from './state.js';
import { $, toast } from './util.js';
import { idb, PREV, saveKeyOf } from './storage.js';
import { bindBadge } from './status.js';
import { askConfirm } from './dialogs.js';
import { exportPdf } from './export.js';
import { insertBlankPage, insertImagePage, deleteCurrentPage } from './pages.js';
import { buildSidebar, setSidebar, side } from './sidebar.js';
import { config } from './config.js';

const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function svgIcon(path) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = path;
  return s;
}
const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  prev: `<path ${S} d="M12.5 4.5 7 10l5.5 5.5"/>`,
  next: `<path ${S} d="M7.5 4.5 13 10l-5.5 5.5"/>`,
  minus: `<path ${S} d="M5 10h10"/>`,
  plus: `<path ${S} d="M10 5v10M5 10h10"/>`,
  select: `<path ${S} d="M5 3.5l10 6.2-4.4 1.1-2.1 4.2z"/>`,
  draw: `<path ${S} d="M13.5 3.8l2.7 2.7-8.8 8.8-3.6.9.9-3.6z"/><path ${S} d="M11.6 5.7l2.7 2.7"/>`,
  blank: `<path ${S} d="M5 2.8h6.5l3.5 3.5v10.9H5z"/><path ${S} d="M10 9v5M7.5 11.5h5"/>`,
  imagePage: `<path ${S} d="M5 2.8h6.5l3.5 3.5v10.9H5z"/><path ${S} d="M6.8 15l2.4-2.6 1.8 1.7 1.3-1.2 1.4 1.5"/><circle cx="8.6" cy="9.4" r="1" fill="currentColor"/>`,
  trash: `<path ${S} d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>`,
  export: `<path ${S} d="M10 3.5v9M6.3 8.8 10 12.5l3.7-3.7M4 15v1.5h12V15"/>`,
  shield: `<path ${S} d="M10 2.8l5.8 2.2v4.6c0 3.6-2.5 6.3-5.8 7.6-3.3-1.3-5.8-4-5.8-7.6V5z"/><path ${S} d="M7.6 10l1.7 1.7 3.2-3.4"/>`,
  pages: `<rect ${S} x="3" y="3.5" width="14" height="13" rx="1.5"/><path ${S} d="M7.5 3.5v13"/>`,
  more: '<circle cx="5" cy="10" r="1.4" fill="currentColor"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/><circle cx="15" cy="10" r="1.4" fill="currentColor"/>',
};
const icon = name => { const s = svgIcon(ICONS[name]); s.setAttribute('viewBox', '0 0 20 20'); return s; };

// pdf.js editor modes and their parameters (see AnnotationEditorType / ParamsType in pdf.mjs)
// Only Select and Draw: free text boxes, highlights and stamps put loose
// content anywhere on a page, which code reading the export cannot place.
const MODE = { NONE: AnnotationEditorType.NONE, INK: AnnotationEditorType.INK };
const PARAM = { INK_COLOR: AnnotationEditorParamsType.INK_COLOR, INK_THICKNESS: AnnotationEditorParamsType.INK_THICKNESS };
const STYLE = {
  [MODE.INK]: { colorParam: PARAM.INK_COLOR, colors: ['#1d1d1f', '#1f5fd1', '#c8321e', '#178a4c'],
                sizeParam: PARAM.INK_THICKNESS, sizes: [[1, 'S'], [2, 'M'], [4, 'L']] },
};
const chosen = {}; // per mode: {color, size}

export function buildBar() {
  if (document.getElementById('lbBar')) return;
  const outer = document.getElementById('outerContainer');
  if (!outer) return;
  const btn = (id, label, iconName, onclick, opts = {}) => {
    const b = $('button', { id, type: 'button', class: 'lb-tb' + (opts.cls ? ' ' + opts.cls : ''), title: opts.title || label, 'aria-label': label, onclick });
    if (iconName) b.append(icon(iconName));
    if (opts.text) b.append($('span', { class: 'lb-tb-label' }, opts.text));
    return b;
  };
  const a = () => app();

  ui.title = $('div', { class: 'lb-title' }, config.brand ? $('span', { class: 'lb-mark' }, config.brand) : null,
    $('span', { class: 'lb-name' }, capital(config.noun)));
  ui.pageInput = $('input', { id: 'lbPageNumber', class: 'lb-page-input', type: 'text', inputmode: 'numeric', 'aria-label': 'Page number', value: '1' });
  ui.pageInput.addEventListener('change', () => {
    const n = parseInt(ui.pageInput.value, 10);
    if (n >= 1 && n <= a().pagesCount) a().pdfViewer.currentPageNumber = n; else syncPage();
  });
  ui.pageInput.addEventListener('focus', () => ui.pageInput.select());
  ui.pageCount = $('span', { class: 'lb-page-count' }, '/ 1');
  ui.zoom = $('span', { class: 'lb-zoom-value', id: 'lbZoomValue' }, '100%');
  const nav = $('div', { class: 'lb-group', role: 'group', 'aria-label': 'Pages' },
    btn('lbPrev', 'Previous page', 'prev', () => a().pdfViewer.previousPage()),
    ui.pageInput, ui.pageCount,
    btn('lbNext', 'Next page', 'next', () => a().pdfViewer.nextPage()));
  const zoom = $('div', { class: 'lb-group lb-hide-sm', role: 'group', 'aria-label': 'Zoom' },
    btn('lbZoomOut', 'Zoom out', 'minus', () => a().pdfViewer.decreaseScale()),
    $('button', { id: 'lbZoomFit', type: 'button', class: 'lb-tb lb-zoom-btn', title: 'Fit to width', 'aria-label': 'Fit to width',
                  onclick: () => { a().pdfViewer.currentScaleValue = 'page-width'; } }, ui.zoom),
    btn('lbZoomIn', 'Zoom in', 'plus', () => a().pdfViewer.increaseScale()));

  ui.tools = {};
  const tool = (mode, id, label, iconName) => {
    const b = btn(id, label, iconName, () => setMode(ui.mode === mode && mode !== MODE.NONE ? MODE.NONE : mode),
      { cls: 'lb-tool', text: label });
    b.setAttribute('aria-pressed', 'false');
    ui.tools[mode] = b;
    return b;
  };
  const toolGroup = $('div', { class: 'lb-group lb-tools', role: 'toolbar', 'aria-label': 'Tools' },
    tool(MODE.NONE, 'lbToolSelect', 'Select', 'select'),
    tool(MODE.INK, 'lbToolDraw', 'Draw', 'draw'));
  ui.style = $('div', { class: 'lb-group lb-style', role: 'group', 'aria-label': 'Colour and size', hidden: '' });
  // colours and sizes float under the tools, so the bar never changes height
  const tools = $('div', { class: 'lb-tools-wrap' }, toolGroup, ui.style);

  ui.del = btn('lbDeletePage', 'Delete this page', 'trash', deleteCurrentPage, { cls: 'lb-danger-ghost', text: 'Delete page' });
  const pages = $('div', { class: 'lb-group', role: 'group', 'aria-label': 'Add pages' },
    btn('lbInsertImagePage', 'Add image page at the end', 'imagePage', insertImagePage, { text: 'Image page' }),
    btn('lbInsertBlank', 'Add a text page at the end', 'blank', insertBlankPage, { text: 'Text page' }),
    ui.del);

  const badge = $('span', { id: 'lbSaveBadge', class: 'lb-status', role: 'status' }, '');
  bindBadge(badge);
  ui.exportBtn = btn('lbExport', 'Export PDF to hand in', 'export', exportPdf, { cls: 'lb-export', text: 'Export PDF' });
  ui.menu = $('div', { class: 'lb-menu', role: 'menu', hidden: '' });
  const menuItem = (id, label, fn) => $('button', { id, type: 'button', class: 'lb-menu-item', role: 'menuitem',
    onclick: () => { closeMenu(); fn(); } }, label);
  ui.menu.append(
    menuItem('lbMenuOpen', 'Import a PDF…', () => a().openFile()),
    menuItem('lbMenuSave', 'Download to keep filling in elsewhere (tablet, PDF app)', () => a().saveCopy()),
    ...(config.showPrint ? [menuItem('lbMenuPrint', 'Print…', () => a().print())] : []),
    ...(config.showBack && config.backUrl ? [$('div', { class: 'lb-menu-sep' }),
    menuItem('lbMenuBack', 'Back to the page', () => { location.href = config.backUrl; })] : []));
  const moreBtn = btn('lbMore', 'More', 'more', e => { e.stopPropagation(); const open = ui.menu.hidden; closeMenu(); if (open) openMenu(); });
  moreBtn.setAttribute('aria-haspopup', 'menu');
  ui.pmenu = $('div', { class: 'lb-menu lb-privacy-menu', role: 'menu', hidden: '' },
    $('div', { class: 'lb-menu-note' }, 'Your work is stored only in this browser on this device.'),
    menuItem('lbClearThis', `Delete saved work for this ${config.noun}…`, () => clearSaved(false)),
    menuItem('lbClearAll', `Delete saved work for all ${config.nounPlural}…`, () => clearSaved(true)));
  ui.pmenu.querySelectorAll('.lb-menu-item').forEach(b => b.classList.add('lb-menu-danger'));
  const shieldBtn = btn('lbPrivacy', 'Privacy and stored data', 'shield', e => {
    e.stopPropagation(); const open = ui.pmenu.hidden; closeMenu(); if (open) { ui.pmenu.hidden = false; ui.pmenu.querySelector('button')?.focus(); }
  }, { cls: 'lb-privacy' });
  shieldBtn.setAttribute('aria-haspopup', 'menu');
  const right = $('div', { class: 'lb-right' }, badge, ui.exportBtn,
    $('div', { class: 'lb-menu-wrap' }, moreBtn, ui.menu),
    $('div', { class: 'lb-menu-wrap' }, shieldBtn, ui.pmenu));

  ui.sideBtn = btn('lbSidebar', 'Show or hide the page overview', 'pages', () => setSidebar(!side.open), { cls: 'lb-side-btn' });
  const bar = $('header', { id: 'lbBar' },
    $('div', { class: 'lb-row' }, ui.sideBtn, ui.title, nav, zoom, tools, pages, right));
  document.body.prepend(bar);
  document.body.classList.add('lb-custom');
  // pdf.js lays out the pages below var(--toolbar-height): make that our bar's height.
  const fit = () => {
    outer.style.setProperty('--toolbar-height', bar.offsetHeight + 'px');
    document.documentElement.style.setProperty('--lb-bar-h', bar.offsetHeight + 'px');
  };
  new ResizeObserver(fit).observe(bar); fit();
  // Rather than wrap to a second row, drop labels step by step until the bar
  // fits: tool labels, the save text (its dot stays), page button labels, the
  // logbook name. Every button keeps its tooltip. Phones may still wrap.
  const row = bar.firstElementChild, steps = ['lb-c1', 'lb-c2', 'lb-c3', 'lb-c4'];
  const wraps = () => { const kids = [...row.children].filter(k => k.offsetParent);
    return kids.some(k => k.offsetTop > kids[0].offsetTop + 8); };
  const compact = () => {
    bar.classList.remove(...steps);
    for (const s of steps) { if (!wraps()) break; bar.classList.add(s); }
  };
  let compactFrame = 0;
  const recompact = () => { cancelAnimationFrame(compactFrame); compactFrame = requestAnimationFrame(compact); };
  window.addEventListener('resize', recompact);
  new MutationObserver(recompact).observe(row, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  recompact();
  buildSidebar();
  document.addEventListener('click', e => {
    if (!ui.menu.contains(e.target) && !ui.pmenu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  syncMode(MODE.NONE);
}
const openMenu = () => { ui.menu.hidden = false; ui.menu.querySelector('button')?.focus(); };
const closeMenu = () => { if (ui.menu) ui.menu.hidden = true; if (ui.pmenu) ui.pmenu.hidden = true; };

// Privacy: delete the work this browser keeps, after two confirmations.
async function clearSaved(all) {
  const what = all ? `all ${config.nounPlural}` : `this ${config.noun}`;
  if (!await askConfirm(`Delete saved work for ${what}?`,
    `This removes your work on ${what} from this browser. Anything you haven't exported is lost.`,
    'Continue')) return;
  if (!await askConfirm('Are you sure?',
    `You can't get it back. Close other ${config.noun} tabs first, or they will save it again.`,
    all ? 'Delete everything' : 'Delete my work')) return;
  state.wiped = true;
  let ok = true;
  if (all) ok = await idb.wipeAll();
  else {
    // This document's save, its older saves, and any save not yet moved to its key.
    for (const k of await idb.keys()) {
      if (typeof k !== 'string') continue;
      if (k === state.saveKey || k.startsWith(`${PREV}${state.saveKey}:`) || (!k.startsWith(PREV) && saveKeyOf(k) === state.saveKey))
        ok = (await idb.wipe(k)) && ok;
    }
  }
  toast(ok ? `Saved work for ${what} deleted. Reloading…` : 'Some saved work could not be removed.', 4000);
  if (ok) setTimeout(() => location.reload(), 1200);
}

function setMode(mode) {
  const a = app();
  if (!a?.pdfDocument) return;
  a.eventBus.dispatch('switchannotationeditormode', { source: window, mode });
}
export function syncMode(mode) {
  ui.mode = mode;
  for (const [m, b] of Object.entries(ui.tools || {})) {
    const on = Number(m) === mode;
    b.classList.toggle('lb-on', on); b.setAttribute('aria-pressed', String(on));
  }
  buildStyle(mode);
}
const COLOR_NAMES = { '#1d1d1f': 'Black', '#1f5fd1': 'Blue', '#c8321e': 'Red', '#178a4c': 'Green' };
function buildStyle(mode) {
  if (!ui.style) return;
  const st = STYLE[mode];
  ui.style.replaceChildren();
  ui.style.hidden = !st;
  if (!st) return;
  const c = chosen[mode] ||= { color: st.colors[0], size: st.sizes ? st.sizes[1][0] : null };
  const apply = () => {
    const bus = app().eventBus;
    bus.dispatch('switchannotationeditorparams', { source: window, type: st.colorParam, value: c.color });
    if (st.sizeParam) bus.dispatch('switchannotationeditorparams', { source: window, type: st.sizeParam, value: c.size });
    buildStyle(mode);
  };
  for (const col of st.colors) {
    const cname = COLOR_NAMES[col] || col;
    const s = $('button', { id: 'lbSwatch_' + cname.toLowerCase().replace(/[^a-z0-9]+/g, '_'), type: 'button',
      class: 'lb-swatch' + (col === c.color ? ' lb-on' : ''), title: cname, 'aria-label': 'Colour ' + cname,
      onclick: () => { c.color = col; apply(); } });
    s.style.setProperty('--sw', col);
    ui.style.append(s);
  }
  if (st.sizes) {
    ui.style.append($('span', { class: 'lb-style-sep' }));
    for (const [v, lab] of st.sizes) ui.style.append($('button', { id: 'lbSize_' + lab, type: 'button',
      class: 'lb-size' + (v === c.size ? ' lb-on' : ''), title: 'Size ' + lab, 'aria-label': 'Size ' + lab,
      onclick: () => { c.size = v; apply(); } }, lab));
  }
}

export function syncPage() {
  const a = app();
  if (!ui.pageInput || !a?.pdfViewer) return;
  if (document.activeElement !== ui.pageInput) ui.pageInput.value = String(a.pdfViewer.currentPageNumber || 1);
  ui.pageCount.textContent = '/ ' + (a.pagesCount || 1);
}
export function syncZoom() {
  const a = app();
  if (ui.zoom && a?.pdfViewer) ui.zoom.textContent = Math.round((a.pdfViewer.currentScale || 1) * 100) + '%';
}
export function syncTitle() {
  if (!ui.title) return;
  const name = (state.id || capital(config.noun))
    .replace(new RegExp(`_${escapeRegExp(config.noun)}$`, 'i'), '').replace(/_/g, ' ');
  ui.title.querySelector('.lb-name').textContent = name;
  document.title = `${name} · ${config.brand ? config.brand + ' ' : ''}${config.noun}`;
}

export function updateDeleteButton() {
  syncPage();
  if (!ui.del) return;
  const info = state.pageInfo[app().pdfViewer.currentPageNumber - 1];
  ui.del.hidden = !(info && info.added); // only pages the student added can go
}
