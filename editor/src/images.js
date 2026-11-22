// SPDX-License-Identifier: AGPL-3.0-or-later
// Pictures students add: picking files, decoding any format, re-encoding as JPEG.
import { getDocument } from 'pdfjs-dist';
import { $, nowIso, pickFile } from './util.js';
import { documentOptions } from './viewer.js';

// Exposed so automated tests can feed a file without an OS dialog.
let testFileHook = null;
const IMAGE_TYPES = 'image/*,application/pdf,.pdf';
export const getImageFile = () => testFileHook ? Promise.resolve(testFileHook(false)) : pickFile(IMAGE_TYPES);
export const getImageFiles = () => testFileHook ? Promise.resolve(testFileHook(true)) : pickFile(IMAGE_TYPES, true);
export function setTestFileHook(fn) { testFileHook = fn; }

// A picture from the file: a bitmap for anything the browser decodes (JPEG,
// PNG, GIF, WebP, AVIF, BMP; HEIC in Safari), an <img> for SVG, and page 1
// rendered by pdf.js for a PDF (a plot exported as PDF, say).
export async function decodeImage(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const task = getDocument({ ...documentOptions, data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(6, 2400 / Math.max(base.width, base.height)) });
      const c = $('canvas', { width: Math.round(vp.width), height: Math.round(vp.height) });
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
      return c;
    } finally { void task.destroy(); }
  }
  try { return await createImageBitmap(file); } catch (err) {
    // Only SVG needs an <img>: an <img> also "decodes" a broken JPEG or PNG
    // (cut off halfway, say) without an error, and would put half a picture in.
    if (!(file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name))) throw err;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw err;
      return img;
    } catch (_) { throw err; } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
}

// Any picture becomes a JPEG (with EXIF rotation applied), at most 2400 px
// on the long side.
export async function imageRecord(file) {
  const src = await decodeImage(file);
  const bmp = { width: src.naturalWidth || src.width, height: src.naturalHeight || src.height };
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = $('canvas', { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
  // Hashes of the file as the student picked it, before resizing and JPEG
  // re-encoding, so the same photo gives the same hash in every logbook.
  let sha256 = null, sha512 = null;
  try {
    const raw = await file.arrayBuffer();
    const hex = async alg => [...new Uint8Array(await crypto.subtle.digest(alg, raw))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    sha256 = await hex('SHA-256'); sha512 = await hex('SHA-512');
  } catch (_) { /* optional */ }
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()), w, h,
    meta: { original_filename: file.name, original_width: bmp.width, original_height: bmp.height, sha256, sha512, inserted: nowIso() },
  };
}
export const contain = (w, h, bw, bh) => { const s = Math.min(bw / w, bh / h); return { w: w * s, h: h * s }; };
