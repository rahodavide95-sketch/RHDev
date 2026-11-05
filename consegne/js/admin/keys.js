/* La chiave dell'etichetta nel browser: sbloccata con la password di cifratura (o il codice di
   recupero), tenuta in memoria non esportabile. Se scegli "ricorda su questo dispositivo" la
   chiave (sempre non esportabile) resta in IndexedDB di questo browser, finché non esci. */

import * as C from '../core/crypto.js';

const DB = 'consegne-keys', STORE = 'k';
let priv = null, pub = null, pubB64 = '';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req && req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const isUnlocked = () => !!priv;
export const privateKey = () => priv;
export async function publicKey(b64) {
  if (b64 && b64 !== pubB64) { pub = await C.importLabelPublic(b64); pubB64 = b64; }
  return pub;
}

export async function setUnlocked(key, record, remember) {
  priv = key;
  await publicKey(record.pub);
  if (remember) { try { await idbDo('readwrite', s => s.put({ key, pub: record.pub, at: Date.now() }, 'label')); } catch { /* il browser non lo permette: resta solo in memoria */ } }
}

/** Chiave ricordata su questo dispositivo, se corrisponde alla chiave pubblica attuale. */
export async function restore(record) {
  if (!record) return false;
  try {
    const saved = await idbDo('readonly', s => s.get('label'));
    if (saved && saved.key && saved.pub === record.pub) { priv = saved.key; await publicKey(record.pub); return true; }
  } catch { /* */ }
  return false;
}
export async function remembered() { try { return !!(await idbDo('readonly', s => s.get('label'))); } catch { return false; } }
export async function forget() { try { await idbDo('readwrite', s => s.delete('label')); } catch { /* */ } }
export async function lock() { priv = null; await forget(); }
