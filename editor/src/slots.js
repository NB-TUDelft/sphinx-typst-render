// SPDX-License-Identifier: AGPL-3.0-or-later
// The Insert / Replace / Remove buttons over each image box.
import { $, toast } from './util.js';
import { app, state } from './state.js';
import { getImageFile, imageRecord } from './images.js';
import { placeInSlot, slotPageIndex } from './document.js';

// Slot buttons sit on top of the page, inside the reserved box.
export function decoratePage(pageNumber) {
  const pv = app().pdfViewer.getPageView(pageNumber - 1);
  if (!pv || !pv.div) return;
  pv.div.querySelectorAll('.lb-slot').forEach(e => { e.remove(); });
  for (const slot of state.slots) {
    if (slotPageIndex(slot) !== pageNumber - 1) continue;
    // pdf.js 6 dropped convertToViewportRectangle; map both corners instead.
    const [x1, y1] = pv.viewport.convertToViewportPoint(slot.rect[0], slot.rect[1]);
    const [x2, y2] = pv.viewport.convertToViewportPoint(slot.rect[2], slot.rect[3]);
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
    const filled = !!state.images['slot:' + slot.name];
    const box = $('div', { class: 'lb-slot' + (filled ? ' lb-filled' : ''), 'data-slot': slot.name });
    Object.assign(box.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
    const insert = async () => {
      const file = await getImageFile();
      if (!file) return;
      try { await placeInSlot(slot, await imageRecord(file)); }
      catch (err) { toast('Could not read that image (' + err.message + '). Try a JPEG or PNG.'); }
    };
    // An empty slot covers its placeholder field: clicking anywhere in it picks an image.
    if (!filled) box.addEventListener('click', e => { if (e.target === box) void insert(); });
    const bar = $('div', { class: 'lb-slot-bar' },
      $('button', { id: 'lbSlotInsert_' + slot.name, type: 'button', class: 'lb-btn lb-primary', 'data-act': 'slot-insert', onclick: insert }, filled ? 'Replace image' : 'Insert image'));
    if (filled) bar.append($('button', { id: 'lbSlotRemove_' + slot.name, type: 'button', class: 'lb-btn', 'data-act': 'slot-remove', onclick: () => placeInSlot(slot, null) }, 'Remove'));
    box.append(bar);
    pv.div.append(box);
  }
}
