// SPDX-License-Identifier: AGPL-3.0-or-later
// Autosave storage in the browser (IndexedDB), save keys, and moving old saves.
import { config } from './config.js';
import { inSequence } from './util.js';

export const idb = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(config.storage, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('autosave');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('autosave', mode);
      const req = fn(t.objectStore('autosave'));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('storage transaction aborted')); // e.g. quota
    });
  };
  return {
    get: k => tx('readonly', s => s.get(k)).catch(() => null),
    keys: () => tx('readonly', s => s.getAllKeys()).catch(() => []),
    put: (k, v) => tx('readwrite', s => s.put(v, k)), // throws, so autosave can say it failed
    del: k => tx('readwrite', s => s.delete(k)).catch(() => null),
    // Privacy: remove saved work. If deleting fails, overwrite it with nothing first.
    async wipe(k) {
      try { await tx('readwrite', s => s.delete(k)); } catch (_) {
        await tx('readwrite', s => s.put({ bytes: new Uint8Array(0), time: null, wiped: true }, k)).catch(() => {});
        await tx('readwrite', s => s.delete(k)).catch(() => {});
      }
      return !(await tx('readonly', s => s.get(k)).catch(() => null))?.bytes?.length;
    },
    async wipeAll() {
      let keys = [];
      try { keys = await tx('readonly', s => s.getAllKeys()); } catch (_) {}
      try { await tx('readwrite', s => s.clear()); } catch (_) {
        await Promise.all(keys.map(k => this.wipe(k)));
      }
      let left = [];
      try { left = await tx('readonly', s => s.getAllKeys()); } catch (_) {}
      await Promise.all(left.map(k => this.wipe(k)));
      return true;
    },
  };
})();

// ------------------------------------------------------ save keys and aliases
// With config.keyPattern, saves are keyed by part of the file name rather than
// all of it: for "^(\d+\.\d+)(?=[_ ]|$)" two files for logbook 2.3 share one
// save, and a renamed file keeps its students' work. config.aliases maps old
// keys or file stems to a new key. Saves made under another key are moved to
// theirs once, by migrateSaves().
export function saveKeyOf(id) {
  let k = String(id || '');
  k = config.aliases[k] || k;
  const m = config.keyPattern?.exec(k);
  if (m) k = m[1] ?? m[0];
  return config.aliases[k] || k;
}
export const PREV = 'prev:';   // prev:<number>:<time> holds an older save of that logbook
export const hasBytes = r => !!r?.bytes?.length;

// Move every save to its logbook number. Nothing is deleted until the copy is
// read back. When two saves meet, the newest becomes the save and the other is
// kept as an older save the student can switch to. One save at a time: two
// saves for the same logbook must not both read its save before either writes.
let migration;
export const migrateSaves = () => migration ||= (async () => {
  await inSequence(await idb.keys(), moveSave);
})().catch(err => console.warn('[typst-editor] save migration', err));

async function moveSave(k) {
  if (typeof k !== 'string' || k.startsWith(PREV)) return;
  const target = saveKeyOf(k);
  if (target === k) return;
  const rec = await idb.get(k);
  if (!hasBytes(rec)) return;
  const cur = await idb.get(target);
  let checks;
  if (hasBytes(cur)) {
    const recNewer = String(rec.time) > String(cur.time);
    const older = recNewer ? cur : rec, prevKey = `${PREV}${target}:${older.time}`;
    await idb.put(prevKey, older);
    checks = [[prevKey, older]];
    if (recNewer) {
      await idb.put(target, rec);
      checks.push([target, rec]);
    }
  } else {
    await idb.put(target, rec);
    checks = [[target, rec]];
  }
  const copies = await Promise.all(checks.map(([ck]) => idb.get(ck)));
  const same = (got, want) => hasBytes(got) && got.bytes.length === want.bytes.length && got.time === want.time;
  if (checks.every(([, want], i) => same(copies[i], want))) await idb.del(k);
  else console.warn('[typst-editor] could not move save', k, '→', target);
}

export async function olderSaves(key) {
  const keys = (await idb.keys()).filter(k => typeof k === 'string' && k.startsWith(`${PREV}${key}:`));
  const recs = await Promise.all(keys.map(k => idb.get(k)));
  return keys.map((k, i) => ({ key: k, rec: recs[i] })).filter(o => hasBytes(o.rec))
    .sort((x, y) => String(y.rec.time).localeCompare(String(x.rec.time)));
}
