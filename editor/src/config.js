// SPDX-License-Identifier: AGPL-3.0-or-later
// The site's settings. sphinx-typst-render writes them into config.js next to
// this bundle (window.typstEditorConfig, from `typst_render_editor` in the
// Sphinx config); anything missing falls back to a neutral default.

const given = window.typstEditorConfig || {};
const params = new URLSearchParams(location.search);

const noun = given.noun || 'worksheet';
const labelPrefix = given.labelPrefix || 'FORM';
const tag = labelPrefix.toLowerCase();

// A link back into this site only: never javascript:, never another origin.
function sameSite(url) {
  if (!url) return null;
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin && /^https?:$/.test(u.protocol) ? u.href : null;
  } catch (_) {
    return null;
  }
}

export const config = {
  // One name for the browser storage, the tab channel and the sidebar setting,
  // so two sites on one origin keep their saves apart.
  storage: given.storage || 'typst-render-editor',
  // Turns a document id (the PDF's file stem) into its save key: the first
  // group, or the whole match. Without it the stem itself is the key.
  keyPattern: given.keyPattern ? new RegExp(given.keyPattern) : null,
  // Old key or stem -> new key, for renumbered or merged documents.
  aliases: (given.aliases && given.aliases.keys) || {},
  // Exported PDFs wrap every answer in invisible [[<labelPrefix>:...]] labels,
  // so code can read them back. The same prefix names image stamps
  // (<tag>-slot:) and the PDF keywords, which keeps exports from one site
  // recognisable.
  labelPrefix,
  slotPrefix: `${tag}-slot:`,
  keywords: `${tag}-${noun}`,
  producer: `${tag}-${noun} editor`,
  // What the documents are called in messages: "this worksheet", "all worksheets".
  noun,
  nounPlural: given.nounPlural || `${noun}s`,
  // Optional short mark in front of the title, e.g. a course code.
  brand: given.brand || '',
  exportMessage: given.exportMessage || 'Exported. You can come back to change it and export again.',
  // The page that opened the editor, for the Back item in the menu.
  backUrl: sameSite(params.get('back')),
};
