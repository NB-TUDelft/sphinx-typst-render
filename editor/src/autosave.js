// SPDX-License-Identifier: AGPL-3.0-or-later
// Autosave of the open document, and the offer to restore saved work.

import { config } from './config.js';
import { askConfirm, modal } from './dialogs.js';
import { documentBytes, reopen } from './document.js';
import { app, state } from './state.js';
import { setSaveBadge } from './status.js';
import { hasBytes, idb, migrateSaves, olderSaves, PREV } from './storage.js';
import { $, nowIso, toast } from './util.js';

export async function autosaveNow(fromTransform = false) {
  const a = app(),
    doc = a?.pdfDocument;
  if (!doc || !state.saveKey || doc !== state.doc) return; // id not (yet) for this document
  if ((state.busy && !fromTransform) || state.restorePending || state.otherTab || state.wiped) return;
  if (state.opCount === 0 && doc.annotationStorage.size === 0) return; // nothing changed yet
  const hash = doc.annotationStorage.serializable.hash + ':' + state.opCount;
  if (hash === state.lastHash) return;
  const id = state.saveKey;
  if (!fromTransform) state.busy = true;
  try {
    const bytes = await documentBytes(doc);
    if (a.pdfDocument !== doc || state.saveKey !== id) return;
    await idb.put(id, { bytes, time: nowIso(), filename: state.filename });
    state.lastHash = hash;
    setSaveBadge('Saved in this browser ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
  } catch (err) {
    console.warn('[typst-editor] autosave failed', err);
    setSaveBadge('Not saved. Export to keep your work.', 'warn');
  } finally {
    if (!fromTransform) state.busy = false;
  }
}

export async function offerRestore() {
  document.querySelectorAll('.lb-restore').forEach((b) => {
    b.remove();
  });
  state.restorePending = false;
  const id = state.saveKey,
    doc = state.doc;
  await migrateSaves();
  const rec = await idb.get(id);
  if (state.doc !== doc) return;
  if (!hasBytes(rec)) {
    if (id) await welcome(doc);
    return;
  }
  const older = (await olderSaves(id))[0]; // the newest older save, if any
  const fmt = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const label = fmt(rec.time);
  // Until the student chooses, autosave must not overwrite the stored work.
  state.restorePending = true;
  const done = () => {
    bar.remove();
    state.restorePending = false;
  };
  const open = async (bytes) => {
    if (state.doc !== doc) return;
    try {
      await reopen(bytes);
      toast('Work restored.');
    } catch (err) {
      toast('Could not restore: ' + err.message);
    }
  };
  const bar = $(
    'div',
    { class: 'lb-restore', role: 'alert' },
    $('div', { class: 'lb-restore-text' }, $('strong', {}, 'Continue where you left off?'), $('span', {}, `This browser has your work on this ${config.noun} from ${label}.`)),
    $(
      'button',
      {
        id: 'lbRestoreYes',
        type: 'button',
        class: 'lb-btn lb-primary',
        onclick: async () => {
          done();
          await open(rec.bytes);
        },
      },
      'Restore my work',
    ),
    older &&
      $(
        'button',
        {
          id: 'lbRestoreOlder',
          type: 'button',
          class: 'lb-btn',
          onclick: async () => {
            // Swap: the current save becomes an older save, so nothing is lost.
            done();
            try {
              await idb.put(`${PREV}${id}:${rec.time}`, rec);
              await idb.put(id, older.rec);
              await idb.del(older.key);
            } catch (err) {
              toast('Could not switch saves: ' + err.message);
              return;
            }
            await open(older.rec.bytes);
          },
        },
        `Use older save (${fmt(older.rec.time)})`,
      ),
    $(
      'button',
      {
        id: 'lbRestoreNo',
        type: 'button',
        class: 'lb-btn',
        onclick: async () => {
          if (!(await askConfirm('Start fresh?', `Your saved work from ${label} will be deleted from this browser and cannot be recovered.`, 'Start fresh'))) return;
          done();
          await idb.del(id);
        },
      },
      'Start fresh',
    ),
  );
  document.body.append(bar);
}

// Nothing saved for this document in this browser: a new start, or work from
// another browser, or cookies were cleared. Offer to import a PDF.
let welcomed = false; // once per visit: an imported PDF must not ask again
async function welcome(doc) {
  if (welcomed) return;
  welcomed = true;
  state.restorePending = true; // nothing to overwrite, but wait for the choice
  const choice = await modal(
    `New ${config.noun}`,
    [
      $('p', { class: 'lb-modal-text' }, 'Your work is saved in this browser as you go.'),
      $('p', { class: 'lb-modal-text' }, `Started this ${config.noun} in another browser, or cleared your cookies? Import the PDF you downloaded or exported, and carry on from there.`),
    ],
    [
      { text: 'Import a PDF…', id: 'lbWelcomeImport', value: 'import' },
      { text: 'Start', primary: true, id: 'lbWelcomeStart', value: 'start' },
    ],
  );
  state.restorePending = false;
  if (choice === 'import' && state.doc === doc) app().openFile();
}
