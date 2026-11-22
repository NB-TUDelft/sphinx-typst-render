// SPDX-License-Identifier: AGPL-3.0-or-later
// Dialogs: a small modal, and the questions the editor asks.
import { $ } from './util.js';
import { state, GENERAL } from './state.js';

export function modal(title, body, actions, label) {
  // actions: [{text, primary, danger, id, value}]; resolves with the chosen value (null on cancel)
  return new Promise(resolve => {
    const prev = document.activeElement;
    const close = v => { overlay.remove(); prev?.focus?.(); resolve(v); };
    const buttons = actions.map(x => $('button', {
      type: 'button', class: 'lb-btn' + (x.primary ? ' lb-primary' : '') + (x.danger ? ' lb-danger' : ''),
      ...(x.id ? { id: x.id } : {}), onclick: () => close(typeof x.value === 'function' ? x.value() : x.value) }, x.text));
    const dlg = $('div', { class: 'lb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title },
      $('h2', {}, title), ...body, $('div', { class: 'lb-modal-actions' }, ...buttons));
    const overlay = $('div', { class: 'lb-modal-backdrop', onclick: e => { if (e.target === overlay) close(null); } }, dlg);
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [...dlg.querySelectorAll('button, select, input, textarea')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    document.body.append(overlay);
    (dlg.querySelector('select, input') || buttons[buttons.length - 1]).focus();
  });
}

// Exercise and layout for a new image page. The layout picker works like
// Word's insert-table grid: hover to preview, click to choose.
// The exercise picker for added pages: sections, with their sub-parts indented.
function exerciseSelect(preselect) {
  const seen = new Set(), opts = [];
  for (const e of [...state.exercises, { title: GENERAL, label: GENERAL, depth: 0 }]) {
    if (seen.has(e.title)) continue;
    seen.add(e.title);
    const o = $('option', { value: e.title }, '\u00a0\u00a0\u00a0\u00a0'.repeat(e.depth || 0) + (e.label || e.title));
    if (e.title === preselect) o.selected = true;
    opts.push(o);
  }
  return $('select', { class: 'lb-select', 'aria-label': 'Exercise' }, ...opts);
}

export function askTextPage(preselect) {
  const select = exerciseSelect(preselect);
  return modal('Add text page', [
    $('p', { class: 'lb-modal-text' }, 'The text goes on a new page at the end.'),
    $('label', { class: 'lb-field' }, $('span', {}, 'Which exercise is it for?'), select)],
    [{ text: 'Cancel', value: null }, { text: 'Add page', primary: true, id: 'lbTextPageOk', value: () => select.value }]);
}

// Largest grid on an image page.
const GRID_MAX = { cols: 3, rows: 6 };
export function askImagePage(preselect) {
  const select = exerciseSelect(preselect);
  let pick = { cols: 1, rows: 1 };
  const label = $('span', { class: 'lb-grid-label', 'aria-live': 'polite' });
  const grid = $('div', { class: 'lb-grid', role: 'grid', 'aria-label': 'Images on the page' });
  const show = (cols, rows) => {
    for (const cell of grid.children) {
      cell.classList.toggle('lb-on', +cell.dataset.c <= cols && +cell.dataset.r <= rows);
      cell.classList.toggle('lb-chosen', +cell.dataset.c === pick.cols && +cell.dataset.r === pick.rows);
    }
    const n = cols * rows;
    label.textContent = `${cols} × ${rows}: ${n} image${n > 1 ? 's' : ''}`;
  };
  for (let r = 1; r <= GRID_MAX.rows; r++) for (let c = 1; c <= GRID_MAX.cols; c++) {
    const cell = $('button', { type: 'button', class: 'lb-grid-cell', id: `lbGrid_${c}x${r}`, 'data-c': c, 'data-r': r,
      'aria-label': `${c} across, ${r} down`,
      onclick: () => { pick = { cols: c, rows: r }; show(c, r); } });
    cell.addEventListener('mouseenter', () => show(c, r));
    cell.addEventListener('focus', () => show(c, r));
    grid.append(cell);
  }
  grid.addEventListener('mouseleave', () => show(pick.cols, pick.rows));
  show(1, 1);
  return modal('Add image page', [
    $('p', { class: 'lb-modal-text' }, 'A new page is added at the end with empty image boxes and a box for notes. Add images later by pressing Insert image in a box.'),
    $('label', { class: 'lb-field' }, $('span', {}, 'Which exercise is it for?'), select),
    $('div', { class: 'lb-field' }, $('span', {}, 'How many images on the page?'), $('div', { class: 'lb-grid-wrap' }, grid, label))],
    [{ text: 'Cancel', value: null },
     { text: 'Add page', primary: true, id: 'lbExerciseOk', value: () => ({ exercise: select.value, ...pick }) }]);
}

export const askConfirm = (title, text, ok, danger = true) => modal(title, [$('p', { class: 'lb-modal-text' }, text)],
  [{ text: 'Cancel', value: false }, { text: ok, primary: true, danger, id: 'lbConfirmOk', value: true }]);

// Ask once, on export, what to do with every answer that does not fit its box.
// Resolves to {name: 'all' | 'overflow' | 'shrink'} or null on cancel.
export function askOverflow(items) {
  const picked = Object.fromEntries(items.map(it => [it.name, 'overflow']));
  const table = $('div', { class: 'lb-overflow-table' },
    $('div', { class: 'lb-ov-head' },
      $('span', {}, 'Question'),
      $('span', {}, 'Move the rest'),
      $('span', {}, 'Move all'),
      $('span', {}, 'Shrink text')));
  for (const it of items) {
    const rowBtns = [];
    const optDefs = [
      ['overflow', 'Move the rest', 'lb-ov-overflow', false],
      ['all', 'Move all', 'lb-ov-all', false],
      ['shrink', it.shrinkTo ? `Shrink (${it.shrinkTo} pt)` : 'Too long to shrink', 'lb-ov-shrink', !it.shrinkTo],
    ];
    for (const [val, label, cls, isDisabled] of optDefs) {
      const b = $('button', {
        type: 'button',
        class: `lb-ov-btn ${cls}` + (picked[it.name] === val ? ' lb-on' : ''),
        'data-field': it.name,
        'data-choice': val,
        'aria-pressed': String(picked[it.name] === val),
        onclick: () => {
          picked[it.name] = val;
          for (const rb of rowBtns) {
            const active = rb.dataset.choice === val;
            rb.classList.toggle('lb-on', active);
            rb.setAttribute('aria-pressed', String(active));
          }
        },
      }, label);
      if (isDisabled) b.disabled = true;
      rowBtns.push(b);
    }
    table.append($('div', { class: 'lb-ov-row' },
      $('div', { class: 'lb-ov-q' },
        $('strong', {}, it.label),
        $('span', {}, it.extra ? `page ${it.page} · ${it.extra} characters too many` : `page ${it.page}`)),
      ...rowBtns));
  }
  return modal('Some answers are too long', [
    $('p', { class: 'lb-modal-text' }, 'Boxes can\'t grow. Choose what to do with each answer. ' +
      'Moved text goes to an extra page at the end, after a full stop or a new line. The box says where it continues.'),
    table],
    [{ text: 'Cancel', value: null },
     { text: 'Export', primary: true, id: 'lbOverflowOk', value: () => ({ ...picked }) }],
    'Answers that do not fit');
}
