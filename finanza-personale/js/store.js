/* Archivio sul dispositivo (IndexedDB). Contiene solo la cassaforte cifrata,
   la sua versione precedente e una copia automatica al giorno (ultime 7). */

const DB_NAME = 'rh-finance';
const OS = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('Questo browser non può salvare i dati (IndexedDB assente).')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(OS)) req.result.createObjectStore(OS); };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error || new Error('Archivio non disponibile')); };
    req.onblocked = () => { dbp = null; reject(new Error('Archivio bloccato da un\'altra scheda: chiudila e riprova.')); };
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(OS, mode);
    const os = t.objectStore(OS);
    let out;
    Promise.resolve(fn(os, v => { out = v; })).catch(reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error || new Error('Salvataggio non riuscito'));
    t.onabort = () => reject(t.error || new Error('Salvataggio interrotto'));
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const get = key => tx('readonly', (os, done) => reqP(os.get(key)).then(done));
export const keys = () => tx('readonly', (os, done) => reqP(os.getAllKeys()).then(done));
export const del = key => tx('readwrite', os => { os.delete(key); });
export const put = (key, value) => tx('readwrite', os => { os.put(value, key); });

/** Salva la nuova cassaforte tenendo la precedente, tutto in un'unica transazione (o tutto o niente). */
export function saveVault(vault, prev, dayKey) {
  return tx('readwrite', os => {
    if (prev) os.put(prev, 'vault-prev');
    os.put(vault, 'vault');
    if (dayKey) {
      // copia automatica del giorno: com'erano i dati prima della prima modifica di oggi
      return reqP(os.getAllKeys()).then(all => {
        const k = 'auto-' + dayKey;
        if (!all.includes(k)) { os.put(prev || vault, k); all = [...all, k]; }
        const autos = all.filter(x => typeof x === 'string' && x.startsWith('auto-')).sort();
        autos.slice(0, Math.max(0, autos.length - 7)).forEach(x => os.delete(x));
      });
    }
  });
}

export async function loadVault() {
  const [vault, prev] = await Promise.all([get('vault'), get('vault-prev')]);
  return { vault: vault || null, prev: prev || null };
}

export async function autoCopies() {
  const all = (await keys()).filter(k => typeof k === 'string' && k.startsWith('auto-')).sort().reverse();
  const out = [];
  for (const k of all) {
    const v = await get(k);
    if (v) out.push({ key: k, day: k.slice(5), updated: v.updated, rev: v.rev, vault: v });
  }
  return out;
}

/** Toglie copia precedente e copie automatiche (servono quando cambia la chiave dei dati). */
export async function clearCopies() {
  const all = await keys();
  await tx('readwrite', os => { for (const k of all) if (k === 'vault-prev' || (typeof k === 'string' && k.startsWith('auto-'))) os.delete(k); });
}

/** Cancella tutto ciò che questa app ha salvato su questo dispositivo. */
export async function wipe() {
  await tx('readwrite', os => { os.clear(); });
  try { localStorage.removeItem('rhf-theme'); localStorage.removeItem('rhf-hint'); } catch { /* ignore */ }
}

export async function persistStatus() {
  try {
    if (!navigator.storage?.persisted) return 'unknown';
    if (await navigator.storage.persisted()) return 'persisted';
    return 'best-effort';
  } catch { return 'unknown'; }
}
export async function requestPersist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function usage() {
  try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage || 0, quota: e.quota || 0 } : null; } catch { return null; }
}
