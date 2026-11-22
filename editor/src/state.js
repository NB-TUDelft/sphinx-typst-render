// SPDX-License-Identifier: AGPL-3.0-or-later
// State shared by every part of the editor, and the pdf.js viewer it runs in.
import { viewer } from './viewer.js';

export const GENERAL = 'General / other';
export const AUTOSAVE_MS = 3000;
export const KEY = {
  id: 'LogbookId',
  slots: 'LogbookSlots',
  images: 'LogbookImages',
  added: 'LogbookAdded',
  kind: 'LogbookPageKind',
  exercise: 'LogbookExercise',
  pageId: 'LogbookPageId',
};

export const app = () => viewer;
export const state = {
  id: null,
  filename: null,
  reopening: false,
  busy: false,
  onAnalysed: null,
  saveKey: null, // autosave key, see saveKeyOf() in storage.js
  slots: [], // [{name, ordinal, rect:[x1,y1,x2,y2], exercise}]
  pageInfo: [], // per page: {added, kind, exercise}
  exercises: [], // [{title, page}] from bookmarks
  images: {}, // metadata log, mirrors Info /LogbookImages
  lastHash: null,
  opCount: 0,
  doc: null, // the pdfDocument that state.id belongs to
  restorePending: false, // restore bar shown: do not overwrite the stored work
  otherTab: false, // same logbook open in another tab: autosave off here
};

// The toolbar's elements, filled in by buildBar() in toolbar.js.
export const ui = {};
