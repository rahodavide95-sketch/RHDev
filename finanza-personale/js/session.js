/* La sessione: apre e chiude la cassaforte, tiene i dati in memoria solo mentre
   l'app è sbloccata e li salva cifrati poco dopo ogni modifica. */

import * as store from './store.js';
import * as C from './core/crypto.js';
import { sanitize, defaults, derive, snapshotMonth, uid, hasHoldings } from './core/model.js';
import { today, monthKey } from './core/dates.js';

export const S = {
  mode: 'boot',            // boot | new | locked | open | demo
  state: null,
  rev: 0,
  saveStatus: 'idle',      // idle | pending | saving | saved | error
  saveError: '',
  lastSaved: 0,
  lockReason: '',
  vaultWarning: '',        // es. "usata la copia precedente"
  hasVault: false,
};

let vault = null;          // ultima cassaforte salvata (cifrata)
let dek = null;            // chiave dei dati, non esportabile, solo in memoria
let dirty = false, saveTimer = 0, saving = null, retry = 0;
const listeners = new Set();
const TAB = uid('tab-');
const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('rh-finance') : null;

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

/* Una sola scheda aperta alla volta sui dati veri: così due schede non si sovrascrivono. */
if (bc) bc.onmessage = async e => {
  const m = e.data || {};
  if (m.t === 'active' && m.tab !== TAB && S.mode === 'open') {
    await flush();
    lock('L\'app è stata aperta in un\'altra scheda o finestra.');
  }
};
const announce = () => { try { bc?.postMessage({ t: 'active', tab: TAB }); } catch { /* ignore */ } };

/* ─── Avvio ─── */
export async function boot() {
  try {
    const { vault: v, prev } = await store.loadVault();
    let use = null;
    try { if (v) use = C.checkVault(v); } catch { /* rotta */ }
    if (!use && prev) {
      try { use = C.checkVault(prev); S.vaultWarning = 'L\'ultimo salvataggio era danneggiato: è stata usata la copia precedente.'; } catch { /* rotta anche lei */ }
    }
    vault = use;
    S.hasVault = !!use;
    S.mode = use ? 'locked' : (v ? 'locked' : 'new');
    if (!use && v) S.vaultWarning = 'I dati salvati su questo dispositivo sono danneggiati. Puoi ripristinare un backup o una copia automatica.';
  } catch (e) {
    S.mode = 'new';
    S.vaultWarning = e?.message || String(e);
  }
  emit('mode');
}

function opened(stateObj) {
  S.state = stateObj;
  S.rev++;
  S.mode = 'open';
  S.lockReason = '';
  S.saveStatus = 'saved';
  announce();
  emit('mode');
}

/** Prima volta: crea la cassaforte con la password scelta. Restituisce il codice di recupero. */
export async function create(password, initial) {
  const st = sanitize(initial || defaults());
  const res = await C.createVault(password, st);
  await store.saveVault(res.vault, null, null);
  vault = res.vault; dek = res.dek;
  S.hasVault = true;
  store.requestPersist();
  // l'app si apre solo dopo che il codice di recupero è stato mostrato e salvato
  return { recoveryCode: res.recoveryCode, finish: () => opened(st) };
}

async function freshVault() {
  const { vault: v, prev } = await store.loadVault();
  try { if (v) return C.checkVault(v); } catch { /* */ }
  if (prev) return C.checkVault(prev);
  if (vault) return vault;
  throw new C.BadVault('Nessun dato su questo dispositivo');
}

async function openWith(key, v) {
  let st;
  try {
    st = await C.decryptState(v, key);
  } catch (e) {
    // dati principali illeggibili: prova la copia precedente con la stessa chiave
    const { prev } = await store.loadVault();
    if (!prev) throw e;
    st = await C.decryptState(C.checkVault(prev), key);
    v = prev;
    S.vaultWarning = 'L\'ultimo salvataggio era danneggiato: è stata usata la copia precedente.';
  }
  vault = v; dek = key;
  opened(sanitize(st));
}

export async function unlock(password) {
  const v = await freshVault();
  const key = await C.unlockWithPassword(v, password);
  await openWith(key, v);
}

/** Sblocco con il codice di recupero: poi si deve scegliere una nuova password. */
export async function unlockWithRecovery(code, newPassword) {
  const v = await freshVault();
  const dx = await C.unlockWithRecovery(v, code, true);
  const nv = await C.rewrapPassword(v, dx, newPassword);
  const key = await C.lockKey(dx);
  const st = sanitize(await C.decryptState(nv, key));
  await store.saveVault(nv, v, null);
  vault = nv; dek = key;
  opened(st);
}

/** Blocca: salva quello che manca e toglie dati e chiave dalla memoria. */
export async function lock(reason = '') {
  if (S.mode === 'open') await flush();
  if (S.mode === 'demo') { S.mode = S.hasVault ? 'locked' : 'new'; }
  else if (S.mode === 'open') S.mode = 'locked';
  S.state = null; dek = null; S.rev++;
  undoSnap = null;          // la copia per "Annulla" contiene dati in chiaro: via anche lei
  S.lockReason = reason;
  dcache = { rev: -1 };
  emit('mode');
}

/* ─── Modifiche e salvataggio ─── */
let undoSnap = null;

/** Applica una modifica ai dati. opts.undo = etichetta per poterla annullare. */
export function commit(fn, opts = {}) {
  if (!S.state) return;
  if (opts.undo) undoSnap = { label: opts.undo, json: JSON.stringify(S.state), rev: S.rev + 1 };
  fn(S.state);
  if (!opts.noCount) S.state.meta.changesSinceBackup = (S.state.meta.changesSinceBackup || 0) + 1;
  S.rev++;
  if (S.mode === 'open') scheduleSave(opts.now ? 0 : 500);
  emit(opts.silent ? 'silent' : 'data');
}

export function canUndo() { return !!undoSnap && undoSnap.rev === S.rev; }
/** Segno dell'ultima modifica annullabile: un vecchio "Annulla" non deve annullare quella dopo. */
export function undoToken() { return canUndo() ? undoSnap : null; }
export function undo(token) {
  if (!canUndo() || (token && token !== undoSnap)) return false;
  S.state = sanitize(JSON.parse(undoSnap.json));
  undoSnap = null;
  S.rev++;
  if (S.mode === 'open') scheduleSave(0);
  emit('data');
  return true;
}

function scheduleSave(ms) {
  dirty = true;
  S.saveStatus = 'pending';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, ms);
}

async function save() {
  // un salvataggio alla volta, sempre nell'ordine giusto
  while (saving) await saving;
  if (!dirty || S.mode !== 'open' || !dek || !vault) return;
  dirty = false;
  S.saveStatus = 'saving';
  saving = (async () => {
    try {
      S.state.meta.updated = Date.now();
      const nv = await C.encryptState(vault, dek, S.state);   // i dati sono letti subito, prima di ogni attesa
      await store.saveVault(nv, vault, today());
      vault = nv;
      S.saveStatus = dirty ? 'pending' : 'saved';
      S.saveError = '';
      S.lastSaved = Date.now();
      retry = 0;
    } catch (e) {
      dirty = true;
      S.saveStatus = 'error';
      S.saveError = /quota/i.test(String(e?.name) + String(e?.message)) ? 'Spazio esaurito sul dispositivo' : (e?.message || 'Salvataggio non riuscito');
      retry = Math.min(retry + 1, 6);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 1000 * 2 ** retry);
    } finally {
      saving = null;
      emit('save');
    }
  })();
  await saving;
}

/** Salva subito quello che c'è da salvare (prima di chiudere, bloccare, esportare). */
export async function flush() {
  clearTimeout(saveTimer);
  while (saving) await saving;
  if (dirty) await save();
}

/* ─── Calcoli derivati, rifatti solo quando cambiano i dati o il giorno ─── */
let dcache = { rev: -1 };
export function derived() {
  const day = today();
  if (dcache.rev !== S.rev || dcache.day !== day || dcache.mode !== S.mode) dcache = { rev: S.rev, day, mode: S.mode, d: derive(S.state, day) };
  return dcache.d;
}

/** Aggiorna la fotografia del mese (valore dei titoli) se serve. */
export function snapshot() {
  if (!S.state || !S.state.holdings.length) return;
  const d = derived();
  const m = monthKey(today());
  const prev = S.state.snapshots[m];
  const now = {};
  for (const a of S.state.accounts) if (hasHoldings(a)) now[a.id] = d.holdingsValue(a);
  if (prev && JSON.stringify(prev.byAcc) === JSON.stringify(now)) return;
  commit(st => snapshotMonth(st, d, today()), { silent: true, noCount: true });
}

/* ─── Prova con dati di esempio: tutto in memoria, niente viene salvato ─── */
export function startDemo(stateObj) {
  S.state = sanitize(stateObj);
  S.rev++;
  S.mode = 'demo';
  S.lockReason = '';
  emit('mode');
}

/* ─── Sicurezza ─── */
export async function verifyPassword(pw) {
  try { await C.unlockWithPassword(vault, pw); return true; } catch { return false; }
}

export async function changePassword(current, next) {
  await flush();
  const v = await freshVault();
  const dx = await C.unlockWithPassword(v, current, true);
  const nv = await C.rewrapPassword(v, dx, next);
  await store.saveVault(nv, v, null);
  vault = nv;
}

export async function newRecoveryCode(current) {
  await flush();
  const v = await freshVault();
  const dx = await C.unlockWithPassword(v, current, true);
  const { vault: nv, code } = await C.rewrapRecovery(v, dx);
  await store.saveVault(nv, v, null);
  vault = nv;
  return code;
}

/* ─── Backup ─── */
/** Il file di backup è la cassaforte stessa: si apre con la password o il codice di recupero di quel momento. */
export async function backupBlob() {
  await flush();
  const v = await freshVault();
  const file = { ...v, exported: Date.now(), app: 'Analisi Finanziarie' };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}
export function markBackup() {
  commit(st => { st.meta.lastBackup = Date.now(); st.meta.changesSinceBackup = 0; }, { silent: true, now: true, noCount: true });
}

export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new C.BadVault('Il file non è un backup valido'); }
  if (obj && obj.format === 'rh-finance-plain') return { kind: 'plain', data: obj.data };
  return { kind: 'vault', vault: C.checkVault(obj) };
}

/** Apre il backup con la sua password (o codice) e restituisce i dati, senza ancora sostituire nulla. */
export async function openBackup(bvault, secret) {
  let key;
  try { key = await C.unlockWithPassword(bvault, secret); }
  catch (e) {
    if (!(e instanceof C.WrongSecret) || !C.isRecoveryCodeShape(secret)) throw e;
    key = await C.unlockWithRecovery(bvault, secret);
  }
  return { state: sanitize(await C.decryptState(bvault, key)), key };
}

/** Sostituisce i dati con quelli del backup. Da sbloccata si tiene la password attuale. */
export async function replaceState(st, adopt) {
  const clean = sanitize(st);
  if (S.mode === 'open') {
    commit(s => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, clean); }, { now: true, undo: 'Ripristino' });
    await flush();
    return;
  }
  if (adopt) {
    // si adotta la cassaforte del backup (stessa password). Prima si toglie tutto il vecchio:
    // copie precedenti e automatiche di un'altra cassaforte non si aprirebbero con questa chiave
    await store.wipe();
    const { exported, app, ...clean2 } = adopt.vault;
    void exported; void app;
    await store.saveVault(clean2, null, null);
    vault = clean2; dek = adopt.key;
    S.hasVault = true;
    store.requestPersist();
    opened(clean);
  }
}

export async function autoCopies() {
  const list = await store.autoCopies();
  return list.map(x => ({ day: x.day, updated: x.updated, key: x.key, vault: x.vault }));
}
export async function restoreAutoCopy(copy) {
  const st = sanitize(await C.decryptState(copy.vault, dek));
  await replaceState(st);
}

export async function wipeAll() {
  clearTimeout(saveTimer);
  dirty = false;
  await store.wipe();
  try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch { /* */ }
  vault = null; dek = null; S.state = null; S.hasVault = false; S.mode = 'new'; S.rev++;
  undoSnap = null;
  dcache = { rev: -1 };
  emit('mode');
}

/* Salvataggio prima di chiudere o nascondere la pagina */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', () => { flush(); });
  addEventListener('beforeunload', e => {
    if (S.mode === 'open' && (dirty || saving)) { flush(); e.preventDefault(); e.returnValue = ''; }
  });
}
