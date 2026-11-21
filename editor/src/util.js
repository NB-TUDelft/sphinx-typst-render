// SPDX-License-Identifier: AGPL-3.0-or-later
// Small DOM helpers used throughout.

export const $ = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
};
export const ansi = s => String(s).replace(/[‒-―]/g, '-').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
export const nowIso = () => new Date().toISOString();
export const toast = (msg, ms = 3500) => {
  document.querySelectorAll('.lb-toast').forEach(old => old.remove());   // one message at a time
  const t = $('div', { class: 'lb-toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
};

export function pickFile(accept = 'image/*', multiple = false) {
  return new Promise(resolve => {
    const input = $('input', { type: 'file', accept, class: 'lb-hidden-input', ...(multiple ? { multiple: '' } : {}) });
    input.addEventListener('change', () => { resolve(multiple ? [...input.files] : input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
