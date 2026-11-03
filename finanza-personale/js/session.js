/* La sessione: apre e chiude la cassaforte, tiene i dati in memoria solo mentre
   l'app è sbloccata e li salva cifrati poco dopo ogni modifica. */

import * as store from './store.js';
import * as C from './core/crypto.js';
import * as cloud from './cloud.js';
import { merge3 } from './core/merge.js';
import { applyDedupe } from './core/dedupe.js';
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
  // account online: off | syncing | ok | offline | error | login (sessione scaduta)
  cloud: { linked: false, email: '', status: 'off', at: 0, error: '' },
};

let vault = null;          // ultima cassaforte salvata (cifrata)
let dek = null;            // chiave dei dati, non esportabile, solo in memoria
let dirty = false, saveTimer = 0, saving = null, retry = 0;
// sincronizzazione: base = ultima versione in comune con il cloud ({ version, vault cifrata })
let base = null, baseJson = '', syncing = null, cloudTimer = 0, pollTimer = 0;
let pushKeys = false;      // password o codice cambiati qui: le chiavi nuove vanno online anche se i dati sono uguali
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

/* ─── Chi sei (D: "quando si disconnette momentaneamente il tool deve sapere che sono io, cioè quale account
   era connesso prima"): l'email dell'ultimo account collegato e il nome resta su questo dispositivo (non
   sono i dati: quelli restano cifrati). Allo sblocco, se il collegamento all'account si è perso o è
   scaduto, ci si ricollega da soli con la stessa password. ─── */
const ACC_KEY = 'rhf-account', WHO_KEY = 'rhf-who';
const rememberAccount = email => { try { if (email) localStorage.setItem(ACC_KEY, email); } catch { /* navigazione privata */ } };
const forgetAccount = () => { try { localStorage.removeItem(ACC_KEY); } catch { /* */ } };
export const lastAccount = () => { try { return localStorage.getItem(ACC_KEY) || ''; } catch { return ''; } };
export const lastName = () => { try { return localStorage.getItem(WHO_KEY) || ''; } catch { return ''; } };
async function reconnect(password) {
  const email = S.cloud.email || lastAccount();
  if (!email || !password) return;
  if (S.cloud.linked && cloud.session()) {
    // prima si prova come sempre; solo se la sessione è scaduta si rientra con la password appena scritta
    try { await cloudSync(); } catch { /* lo stato lo dice */ }
    if (S.cloud.status !== 'login') return;
  }
  try {
    await cloud.signIn(email, password);
    S.cloud.linked = true; S.cloud.email = cloud.session()?.email || email; S.cloud.error = '';
    rememberAccount(S.cloud.email);
    emit('cloud');
    await cloudSync();
  } catch { /* resta com'era: dalle Impostazioni (o dall'avviso) si può accedere di nuovo */ }
}

/* ─── Avvio ─── */
export async function boot() {
  try {
    const sess = await cloud.loadSession();
    S.cloud.linked = !!sess; S.cloud.email = sess?.email || '';
    if (sess?.email) rememberAccount(sess.email);
    else if (lastAccount()) S.cloud.email = lastAccount();          // collegamento perso: si sa ancora chi sei
    base = (await store.get('cloud-base')) || null;
  } catch { /* senza account va bene lo stesso */ }
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
  try { const n = (stateObj.settings?.name || '').trim().split(/\s+/)[0]; if (n) localStorage.setItem(WHO_KEY, n.slice(0, 30)); else localStorage.removeItem(WHO_KEY); } catch { /* */ }
  S.rev++;
  S.mode = 'open';
  S.lockReason = '';
  S.saveStatus = 'saved';
  announce();
  emit('mode');
  startSync();
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
  let key;
  try { key = await C.unlockWithPassword(v, password); }
  catch (e) {
    if (!(e instanceof C.WrongSecret) || !S.cloud.linked) throw e;
    // con l'account: forse la password è stata cambiata su un altro dispositivo
    const r = await unlockViaCloud(v, password);
    if (r) return r;
    throw e;
  }
  await openWith(key, v);
  reconnect(password);
}

/** La password non apre la copia di questo dispositivo: si prova con i dati online. */
async function unlockViaCloud(v, password) {
  let row = null;
  try { if (cloud.session()) row = await cloud.fetchRow(); } catch { return null; }
  if (row) {
    let rv = null, key = null;
    try { rv = C.checkVault(JSON.parse(row.data)); key = await C.unlockWithPassword(rv, password); } catch { key = null; }
    if (key) {
      // stessa chiave dei dati, chiusa con la password nuova: si prendono le chiavi aggiornate
      const nv = { ...v, kdf: rv.kdf, keys: rv.keys, keysAt: rv.keysAt || Date.now() };
      await store.saveVault(nv, v, null);
      await openWith(key, nv);
      return true;
    }
  }
  // l'account accetta questa password ma i dati sono ancora chiusi con quella di prima?
  try { await cloud.signIn(S.cloud.email, password); } catch { return null; }
  const err = new Error('La password dell\'account è cambiata: per aprire i dati scrivi quella di prima (o il codice di recupero).');
  err.code = 'needOld';
  throw err;
}

/** Dopo un cambio di password fatto altrove: apre con la password vecchia (o il codice) e richiude con la nuova. */
export async function rekey(oldOrCode, newPassword) {
  const v = await freshVault();
  let dx;
  try { dx = await C.unlockWithPassword(v, oldOrCode, true); }
  catch (e) { if (!(e instanceof C.WrongSecret) || !C.isRecoveryCodeShape(oldOrCode)) throw e; dx = await C.unlockWithRecovery(v, oldOrCode, true); }
  const nv = await C.rewrapPassword(v, dx, newPassword);
  await store.saveVault(nv, v, null);
  pushKeys = true;
  await openWith(await C.lockKey(dx), nv);
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
  pushKeys = true;
  opened(st);
  // con l'account: la password nuova vale anche per accedere online
  if (S.cloud.linked) cloud.setPassword(newPassword).catch(() => { S.cloud.error = 'Cambia la password anche dell\'account: dalle Impostazioni.'; });
}

/** Blocca: salva quello che manca e toglie dati e chiave dalla memoria. */
export async function lock(reason = '') {
  if (S.mode === 'open') await flush();
  stopSync();
  if (S.mode === 'open' && S.cloud.linked) await Promise.race([cloudSync(), new Promise(r => setTimeout(r, 4000))]).catch(() => {});
  // il nome per il "Bentornato" (anche se cambiato dopo l'apertura)
  if (S.mode === 'open') { try { const n = (S.state?.settings?.name || '').trim().split(/\s+/)[0]; if (n) localStorage.setItem(WHO_KEY, n.slice(0, 30)); else localStorage.removeItem(WHO_KEY); } catch { /* */ } }
  if (S.mode === 'demo') { S.mode = S.hasVault ? 'locked' : 'new'; }
  else if (S.mode === 'open') S.mode = 'locked';
  S.state = null; dek = null; S.rev++;
  clearHistory();          // le copie per "Annulla" contengono dati in chiaro: via anche loro
  S.lockReason = reason;
  dcache = { rev: -1 };
  emit('mode');
}

/* ─── Modifiche e salvataggio ─── */
/* Annulla e Ripeti (D: "metti anche undo e avanti"; su Mac Cmd+Z e Cmd+Maiusc+Z): prima di ogni modifica
   fatta da D si tiene una copia dei dati (le ultime 40, al massimo ~60 MB di testo); "Annulla" torna alla
   copia prima e mette quella di adesso in "Ripeti". Una modifica nuova svuota "Ripeti". Le modifiche
   automatiche (prezzi, cambi, scadenze registrate da sole, fotografie del mese) non entrano: sono
   `silent` o `auto`. Le copie contengono dati in chiaro: si buttano quando l'app si blocca. */
const HISTORY_MAX = 40, HISTORY_CHARS = 60e6;
let past = [], future = [];
const histSize = () => past.reduce((a, x) => a + x.json.length, 0) + future.reduce((a, x) => a + x.json.length, 0);
export function clearHistory() { past = []; future = []; }

/** Applica una modifica ai dati. opts.undo = etichetta per l'avviso con "Annulla". */
export function commit(fn, opts = {}) {
  if (!S.state) return;
  const keep = !opts.silent && !opts.auto;
  if (keep) {
    past.push({ label: opts.undo || 'Modifica', json: JSON.stringify(S.state), rev: S.rev + 1 });
    future = [];
    while (past.length > HISTORY_MAX || (past.length > 1 && histSize() > HISTORY_CHARS)) past.shift();
  }
  fn(S.state);
  if (!opts.noCount) S.state.meta.changesSinceBackup = (S.state.meta.changesSinceBackup || 0) + 1;
  S.rev++;
  // una modifica automatica dopo quella di D non deve impedire di annullarla dall'avviso
  if (!keep && past.length && past[past.length - 1].rev === S.rev - 1) past[past.length - 1].rev = S.rev;
  if (S.mode === 'open') scheduleSave(opts.now ? 0 : 500);
  emit(opts.silent ? 'silent' : 'data');
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export const undoLabel = () => past[past.length - 1]?.label || '';
export const redoLabel = () => future[future.length - 1]?.label || '';
/** Segno dell'ultima modifica annullabile: un vecchio "Annulla" (nell'avviso) non deve annullare quella dopo. */
export function undoToken() { const t = past[past.length - 1]; return t && t.rev === S.rev ? t : null; }
function restore(json) {
  S.state = sanitize(JSON.parse(json));
  S.rev++;
  if (S.mode === 'open') scheduleSave(0);
  emit('data');
}
/** Annulla l'ultima modifica (con `token`: solo se è ancora l'ultima). */
export function undo(token) {
  if (!S.state || !past.length) return false;
  const top = past[past.length - 1];
  if (token && (token !== top || top.rev !== S.rev)) return false;
  past.pop();
  future.push({ label: top.label, json: JSON.stringify(S.state) });
  restore(top.json);
  for (const x of past) x.rev = -1;            // gli avvisi vecchi non annullano più niente
  return top.label;
}
/** Rifà l'ultima modifica annullata. */
export function redo() {
  if (!S.state || !future.length) return false;
  const top = future.pop();
  past.push({ label: top.label, json: JSON.stringify(S.state), rev: -1 });
  restore(top.json);
  return top.label;
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
      scheduleCloud(1500);
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
  // con l'account la password è la stessa: prima si cambia online (serve internet), poi qui
  if (S.cloud.linked) await cloud.setPassword(next);
  const nv = await C.rewrapPassword(v, dx, next);
  await store.saveVault(nv, v, null);
  vault = nv;
  pushKeys = true;
  scheduleCloud(0);
}

export async function newRecoveryCode(current) {
  await flush();
  const v = await freshVault();
  const dx = await C.unlockWithPassword(v, current, true);
  const { vault: nv, code } = await C.rewrapRecovery(v, dx);
  await store.saveVault(nv, v, null);
  vault = nv;
  pushKeys = true;
  scheduleCloud(0);
  return code;
}

/* ─── Backup ─── */
/** Il file di backup è la cassaforte stessa: si apre con la password o il codice di recupero di quel momento. */
export async function backupBlob() {
  await flush();
  const v = await freshVault();
  const file = { ...v, exported: Date.now(), app: '[RH] Finance' };
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
    if (S.cloud.linked) await cloud.signOut();
    await store.wipe();
    S.cloud = { linked: false, email: '', status: 'off', at: 0, error: '' }; base = null; baseJson = '';
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
  stopSync();
  // anche se l'uscita dall'account non riesce (rete), il dispositivo si svuota lo stesso
  if (S.cloud.linked) { try { await cloud.signOut(); } catch { /* sessione dimenticata comunque qui sotto */ } }
  S.cloud = { linked: false, email: '', status: 'off', at: 0, error: '' }; base = null; baseJson = '';
  dirty = false;
  await store.wipe();
  try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch { /* */ }
  vault = null; dek = null; S.state = null; S.hasVault = false; S.mode = 'new'; S.rev++;
  clearHistory();
  dcache = { rev: -1 };
  emit('mode');
}

/* ═══ Account e sincronizzazione ═════════════════════════════════════════
   Online va solo la cassaforte cifrata (la stessa del dispositivo). Ogni dispositivo
   tiene la "base", l'ultima versione in comune: così due dispositivi che cambiano
   cose diverse non si cancellano a vicenda (unione a tre vie, core/merge.js). */

export const CLOUD_LABEL = { syncing: 'Sincronizzo…', ok: 'Sincronizzato e cifrato', offline: 'Offline: sincronizzo appena torna la rete', error: 'Sincronizzazione non riuscita', login: 'Accedi di nuovo per sincronizzare' };
/** Una riga per dire a che punto è la sincronizzazione. */
export function cloudLine() {
  const c = S.cloud;
  if (!c.linked) return 'Non collegato';
  if (c.status === 'ok' && c.at) return 'Sincronizzato alle ' + new Date(c.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return (CLOUD_LABEL[c.status] || 'In attesa') + (c.error && c.status === 'error' ? ': ' + c.error : '');
}

/** Contenuto da confrontare (senza l'ora dell'ultimo salvataggio, che cambia sempre). */
const content = st => JSON.stringify({ ...st, meta: { ...st.meta, updated: 0 } });

function setCloud(status, error = '') {
  S.cloud.status = status; S.cloud.error = error;
  if (status === 'ok') S.cloud.at = Date.now();
  emit('cloud');
}

function startSync() {
  stopSync();
  if (!S.cloud.linked || S.mode !== 'open') return;
  cloudSync();
  pollTimer = setInterval(() => { if (document.visibilityState !== 'hidden') cloudSync(); }, 60000);
}
function stopSync() { clearTimeout(cloudTimer); clearInterval(pollTimer); cloudTimer = 0; pollTimer = 0; }
function scheduleCloud(ms) {
  if (!S.cloud.linked || S.mode !== 'open') return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(cloudSync, ms);
}

async function setBase(version, v, stJson) {
  base = { version, vault: v };
  baseJson = stJson;
  await store.put('cloud-base', base);
}

/** Scarica la versione online, la unisce a quella di qui e ricorda la nuova base. */
async function pullMerge() {
  const row = await cloud.fetchRow();
  if (!row) return;
  const rv = C.checkVault(JSON.parse(row.data));
  let remote;
  try { remote = sanitize(await C.decryptState(rv, dek)); }
  catch { const e = new Error('I dati online sono di un\'altra cassaforte: esci dall\'account e accedi di nuovo.'); e.code = 'foreign'; throw e; }
  let baseState = null;
  if (base?.vault) { try { baseState = sanitize(await C.decryptState(base.vault, dek)); } catch { baseState = null; } }
  if (!S.state || !dek) return;
  // chiavi più recenti (es. password cambiata su un altro dispositivo)
  if ((rv.keysAt || 0) > (vault.keysAt || 0)) { vault = { ...vault, kdf: rv.kdf, keys: rv.keys, keysAt: rv.keysAt }; scheduleSave(0); }
  const merged = sanitize(merge3(baseState, S.state, remote));
  // le stesse righe arrivate da tutte e due le parti con codici diversi (stesso Excel importato due volte): una sola
  applyDedupe(merged);
  await setBase(row.version, rv, content(remote));
  if (content(merged) !== content(S.state)) {
    S.state = merged;
    clearHistory();           // arrivano modifiche da un altro dispositivo: "Annulla" non deve toglierle
    S.rev++;
    scheduleSave(0);
    emit('data');
  }
}

/** Invia lo stato attuale; false se nel frattempo un altro dispositivo ha salvato. */
async function pushNow() {
  const snap = content(S.state);
  const nv = await C.encryptState(vault, dek, S.state);   // lo stato è letto subito
  const v = await cloud.pushRow(JSON.stringify(nv), base?.version || 0);
  if (v == null) return false;
  pushKeys = false;
  await setBase(v, nv, snap);
  return true;
}

/** Sincronizza: prima prende le novità, poi invia le proprie. Mai due volte insieme. */
export function cloudSync() {
  if (!S.cloud.linked || S.mode !== 'open' || !dek || !cloud.session()) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    setCloud('syncing', '');
    try {
      let done = false;
      for (let i = 0; i < 4 && !done; i++) {
        const rv = await cloud.remoteVersion();
        if (!rv && base) { base = null; baseJson = ''; }      // niente online: si ricarica tutto
        if (rv && rv !== base?.version) await pullMerge();
        if (!S.state) return;
        if (rv && base?.version === rv && content(S.state) === baseJson && !pushKeys) done = true;   // tutto allineato
        else done = await pushNow();           // false: un altro dispositivo ha appena salvato, si ricomincia
      }
      if (done) setCloud('ok');
      else { setCloud('error', 'Altri dispositivi stanno salvando: riprovo tra poco.'); scheduleCloud(5000); }
    } catch (e) {
      setCloud(e.code === 'offline' ? 'offline' : e.status === 401 ? 'login' : 'error', e.message || String(e));
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Accesso da un dispositivo nuovo (nessun dato qui): scarica i dati o crea la cassaforte. */
export async function loginNewDevice(email, password) {
  await cloud.signIn(email, password);
  S.cloud.linked = true; S.cloud.email = cloud.session().email || email; rememberAccount(S.cloud.email);
  const row = await cloud.fetchRow();
  if (row) {
    const rv = C.checkVault(JSON.parse(row.data));
    let key;
    try { key = await C.unlockWithPassword(rv, password); }
    catch (e) { if (e instanceof C.WrongSecret) return { needOld: true }; throw e; }
    const st = sanitize(await C.decryptState(rv, key));
    await store.clearCopies();
    await store.saveVault(rv, null, null);
    await setBase(row.version, rv, content(st));
    vault = rv; dek = key; S.hasVault = true;
    store.requestPersist();
    opened(st);
    return { ok: true };
  }
  // primo dispositivo con questo account: nuova cassaforte chiusa con la password dell'account
  const st = sanitize(defaults());
  const res = await C.createVault(password, st);
  await store.clearCopies();
  await store.saveVault(res.vault, null, null);
  vault = res.vault; dek = res.dek; S.hasVault = true; base = null; baseJson = '';
  await store.del('cloud-base');
  store.requestPersist();
  return { recoveryCode: res.recoveryCode, finish: () => opened(st) };
}

/** Dispositivo nuovo, ma i dati online sono chiusi con la password di prima dell'account. */
export async function loginWithOld(oldOrCode, newPassword) {
  const row = await cloud.fetchRow();
  const rv = C.checkVault(JSON.parse(row.data));
  let dx;
  try { dx = await C.unlockWithPassword(rv, oldOrCode, true); }
  catch (e) { if (!(e instanceof C.WrongSecret) || !C.isRecoveryCodeShape(oldOrCode)) throw e; dx = await C.unlockWithRecovery(rv, oldOrCode, true); }
  const nv = await C.rewrapPassword(rv, dx, newPassword);
  const key = await C.lockKey(dx);
  const st = sanitize(await C.decryptState(nv, key));
  await store.clearCopies();
  await store.saveVault(nv, null, null);
  await setBase(row.version, rv, content(st));
  vault = nv; dek = key; S.hasVault = true;
  pushKeys = true;
  opened(st);   // la sincronizzazione invia subito le chiavi nuove
}

/** Nuovo account. 'confirm' = bisogna prima confermare l'email. */
export async function signUp(email, password) {
  return cloud.signUp(email, password);
}

/** Collega l'account all'app già in uso su questo dispositivo (dalle Impostazioni). */
export async function linkAccount(email, password, { create = false, localPassword = null } = {}) {
  if (S.mode !== 'open') throw new Error('Prima sblocca l\'app');
  await flush();
  if (!cloud.session() || cloud.session().email !== email.trim()) {
    if (create) { const r = await cloud.signUp(email, password); if (r === 'confirm') return { confirm: true }; }
    else await cloud.signIn(email, password);
  }
  const row = await cloud.fetchRow();
  let adopted = false;
  if (row) {
    // ci sono già dati online (un altro dispositivo): si uniscono a quelli di qui
    const rv = C.checkVault(JSON.parse(row.data));
    let key;
    try { key = await C.unlockWithPassword(rv, password); }
    catch (e) { if (e instanceof C.WrongSecret) return { needOld: true }; throw e; }
    const remote = sanitize(await C.decryptState(rv, key));
    const merged = sanitize(merge3(null, S.state, remote));
    applyDedupe(merged);          // primo collegamento: le righe uguali di qui e di là diventano una
    const nv = await C.encryptState(rv, key, merged);
    await store.clearCopies();
    await store.saveVault(nv, null, null);
    await setBase(row.version, rv, content(remote));
    vault = nv; dek = key;
    S.state = merged; S.rev++;
    adopted = true;
  } else {
    // nessun dato online: si carica questa cassaforte, chiusa con la password dell'account
    let dx;
    try { dx = await C.unlockWithPassword(vault, localPassword || password, true); }
    catch (e) { if (e instanceof C.WrongSecret && !localPassword) return { needLocal: true }; throw e; }
    if (localPassword && localPassword !== password) {
      const nv = await C.rewrapPassword(vault, dx, password);
      await store.saveVault(nv, vault, null);
      vault = nv;
    }
    base = null; baseJson = '';
    await store.del('cloud-base');
  }
  S.cloud.linked = true; S.cloud.email = cloud.session().email || email; rememberAccount(S.cloud.email);
  emit('data');
  startSync();
  await cloudSync();
  // adopted: da ora valgono la password e il codice di recupero dei dati online
  return { ok: true, adopted };
}

/** Di nuovo l'accesso quando la sessione è scaduta (stessa password dell'app). */
export async function relogin(password) {
  await cloud.signIn(S.cloud.email, password);
  await cloudSync();
}

/** Esce dall'account su questo dispositivo: i dati qui restano. */
export async function unlinkAccount() {
  stopSync();
  await cloud.signOut();
  await store.del('cloud-base');
  base = null; baseJson = '';
  S.cloud = { linked: false, email: '', status: 'off', at: 0, error: '' };
  forgetAccount();          // uscita voluta: non si ricollega da solo
  emit('cloud');
}

/** Dal link "password dimenticata" dell'email: nuova password + codice di recupero. */
export async function resetFromLink(access, refresh, code, newPassword) {
  await cloud.adoptLinkSession(access, refresh);
  await cloud.setPassword(newPassword);
  S.cloud.linked = true; S.cloud.email = cloud.session().email; rememberAccount(S.cloud.email);
  const row = await cloud.fetchRow();
  if (row) {
    const rv = C.checkVault(JSON.parse(row.data));
    const dx = await C.unlockWithRecovery(rv, code, true);
    const nv = await C.rewrapPassword(rv, dx, newPassword);
    const key = await C.lockKey(dx);
    const st = sanitize(await C.decryptState(nv, key));
    await store.clearCopies();
    await store.saveVault(nv, null, null);
    await setBase(row.version, rv, content(st));
    vault = nv; dek = key; S.hasVault = true;
    pushKeys = true;
    opened(st);
    return;
  }
  // niente online: si usa la copia di questo dispositivo, se c'è
  await unlockWithRecovery(code, newPassword);
}

/* Salvataggio prima di chiudere o nascondere la pagina */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else if (S.cloud.linked && S.mode === 'open') scheduleCloud(300);
  });
  addEventListener('online', () => scheduleCloud(500));
  addEventListener('pagehide', () => { flush(); });
  addEventListener('beforeunload', e => {
    if (S.mode === 'open' && (dirty || saving)) { flush(); e.preventDefault(); e.returnValue = ''; }
  });
}
