/* ============================================================================
   store.js — stato dell'app sul dispositivo (local-first)
   Ogni account ha il suo spazio separato ("guest" senza account). All'uscita
   dall'account lo spazio viene cancellato dal dispositivo: i dati restano nel cloud.
   ============================================================================ */
import { sanitizeTrip, sanitizeProfile, sanitizeMarks } from './model.js';
import { toast } from './util.js';

const KEY = ns => `orbita:v1:${ns}`;
let ns = 'guest';
let state = blank();
const listeners = new Set();

function blank() {
  return {
    v: 2,
    profile: sanitizeProfile({}),
    marks: { visited: [], wish: [] },
    trips: {},
    shared: {},            // viaggi condivisi con me: id → { trip, role, owner }
    sync: { dirty: [], deleted: [], profileDirty: false, last: null },
    createdAt: new Date().toISOString(),
  };
}

function hydrate(raw) {
  const s = blank();
  if (!raw || typeof raw !== 'object') return s;
  s.profile = sanitizeProfile(raw.profile);
  s.marks = sanitizeMarks(raw.marks);
  for (const t of Object.values(raw.trips || {})) { const x = sanitizeTrip(t); if (x) s.trips[x.id] = x; }
  for (const [id, sh] of Object.entries(raw.shared || {})) {
    const x = sanitizeTrip(sh && sh.trip);
    if (x && x.id === id) s.shared[id] = { trip: x, role: sh.role === 'editor' ? 'editor' : 'viewer', owner: String(sh.owner || '').slice(0, 120) };
  }
  const sy = raw.sync || {};
  s.sync = {
    dirty: Array.isArray(sy.dirty) ? sy.dirty.filter(id => s.trips[id] || s.shared[id]) : [],
    deleted: Array.isArray(sy.deleted) ? sy.deleted.slice(0, 5000) : [],
    profileDirty: !!sy.profileDirty,
    last: sy.last || null,
  };
  if (typeof raw.createdAt === 'string') s.createdAt = raw.createdAt;
  // v2: lo stile sobrio usa la "tinta unica"; chi aveva il vecchio predefinito passa al nuovo
  if ((raw.v || 1) < 2 && s.profile.colorMode === 'continent') s.profile.colorMode = 'mono';
  return s;
}

export function load(namespace = 'guest') {
  ns = namespace;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY(ns)) || 'null'); } catch { raw = null; }
  state = hydrate(raw);
  emit('load');
  return state;
}

let saveWarned = false;
function persist() {
  try { localStorage.setItem(KEY(ns), JSON.stringify(state)); saveWarned = false; }
  catch {
    if (!saveWarned) toast('Spazio del browser pieno: i dati non sono stati salvati su questo dispositivo.', { type: 'error', ms: 6000 });
    saveWarned = true;
  }
}

function emit(reason, extra) { for (const fn of listeners) { try { fn(reason, extra); } catch (e) { console.error(e); } } }
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const get = () => state;
export const namespace = () => ns;

// Un'altra scheda ha cambiato i dati: ricarica per non sovrascriverli
window.addEventListener('storage', e => { if (e.key === KEY(ns)) { load(ns); } });

// ---------------------------------------------------------------------------
// Viaggi
// ---------------------------------------------------------------------------
export function ownTrips() { return Object.values(state.trips); }
export function sharedTrips() { return Object.values(state.shared); }
export function findTrip(id) {
  if (state.trips[id]) return { trip: state.trips[id], role: 'owner' };
  if (state.shared[id]) return state.shared[id];
  return null;
}
// Viaggi che entrano nelle statistiche: i miei + quelli condivisi che non ho escluso
export function countedTrips() {
  const ex = new Set(state.profile.excludeShared);
  return [...ownTrips(), ...sharedTrips().filter(s => !ex.has(s.trip.id)).map(s => s.trip)];
}

const markDirty = id => { if (!state.sync.dirty.includes(id)) state.sync.dirty.push(id); };

export function saveTrip(trip) {
  const clean = sanitizeTrip({ ...trip, updatedAt: new Date().toISOString() });
  if (!clean) throw new Error('Viaggio non valido');
  if (state.shared[clean.id]) {
    if (state.shared[clean.id].role !== 'editor') throw new Error('Non hai i permessi per modificare questo viaggio');
    clean.synced = true;
    clean.base = state.shared[clean.id].trip.base;
    state.shared[clean.id].trip = clean;
  } else {
    const prev = state.trips[clean.id];
    clean.synced = !!(prev && prev.synced);
    clean.base = prev ? prev.base : '';
    clean.createdAt = prev ? prev.createdAt : clean.createdAt;
    state.trips[clean.id] = clean;
  }
  markDirty(clean.id);
  persist();
  emit('trips', clean.id);
  return clean;
}

export function removeTrip(id) {
  const t = state.trips[id];
  if (!t) return;
  delete state.trips[id];
  state.sync.dirty = state.sync.dirty.filter(x => x !== id);
  if (t.synced) state.sync.deleted.push(id);
  persist();
  emit('trips', id);
  return t;
}

// Ripristina un viaggio appena eliminato (tasto "Annulla")
export function restoreTrip(t) {
  state.sync.deleted = state.sync.deleted.filter(x => x !== t.id);
  state.trips[t.id] = t;
  markDirty(t.id);
  persist();
  emit('trips', t.id);
}

// ---------------------------------------------------------------------------
// Profilo e paesi segnati
// ---------------------------------------------------------------------------
export function updateProfile(patch) {
  state.profile = sanitizeProfile({ ...state.profile, ...patch });
  state.sync.profileDirty = true;
  persist();
  emit('profile');
}

export function setMark(cc, kind) {   // kind: 'visited' | 'wish' | null
  const m = state.marks;
  m.visited = m.visited.filter(c => c !== cc);
  m.wish = m.wish.filter(c => c !== cc);
  if (kind === 'visited') m.visited.push(cc);
  if (kind === 'wish') m.wish.push(cc);
  state.marks = sanitizeMarks(m);
  state.sync.profileDirty = true;
  persist();
  emit('marks', cc);
}

export function toggleExcludeShared(id, exclude) {
  const set = new Set(state.profile.excludeShared);
  if (exclude) set.add(id); else set.delete(id);
  updateProfile({ excludeShared: [...set] });
}

// ---------------------------------------------------------------------------
// Usate dalla sincronizzazione cloud (cloud.js)
// ---------------------------------------------------------------------------
export function syncSnapshot() {
  return { dirty: [...state.sync.dirty], deleted: [...state.sync.deleted], profileDirty: state.sync.profileDirty };
}
export function applySync({ pushed = [], discarded = [], deletedDone = [], profilePushed = false, remoteTrips = null, remoteShared = null, remoteProfile }) {
  const stillDirty = new Set(state.sync.dirty);
  for (const id of [...pushed, ...discarded]) {
    if (editedSince.has(id)) continue;   // modificato di nuovo durante la sincronizzazione: resta da inviare
    if (state.trips[id] && pushed.includes(id)) state.trips[id].synced = true;
    stillDirty.delete(id);
  }
  state.sync.deleted = state.sync.deleted.filter(id => !deletedDone.includes(id));
  if (profilePushed && !profileEditedSince) state.sync.profileDirty = false;

  if (remoteTrips) {
    const remoteIds = new Set(remoteTrips.map(t => t.id));
    for (const t of remoteTrips) {
      if (stillDirty.has(t.id) || state.sync.deleted.includes(t.id)) continue;
      state.trips[t.id] = t;
    }
    for (const t of Object.values(state.trips)) {
      // era nel cloud ma ora non c'è più: eliminato da un altro dispositivo
      if (t.synced && !remoteIds.has(t.id) && !stillDirty.has(t.id)) delete state.trips[t.id];
    }
  }
  if (remoteShared) {
    const next = {};
    for (const sh of remoteShared) {
      const local = state.shared[sh.trip.id];
      next[sh.trip.id] = stillDirty.has(sh.trip.id) && local ? { ...sh, trip: local.trip } : sh;
    }
    state.shared = next;
  }
  if (remoteProfile !== undefined && remoteProfile && !state.sync.profileDirty) {
    state.profile = sanitizeProfile(remoteProfile.profile);
    state.marks = sanitizeMarks(remoteProfile.marks);
  }
  state.sync.dirty = [...stillDirty].filter(id => state.trips[id] || state.shared[id]);
  state.sync.last = new Date().toISOString();
  editedSince.clear();
  profileEditedSince = false;
  persist();
  emit('sync');
}

// Traccia le modifiche fatte mentre una sincronizzazione è in corso
const editedSince = new Set();
let profileEditedSince = false;
export function beginSync() { editedSince.clear(); profileEditedSince = false; }
on((reason, id) => {
  if (reason === 'trips' && id) editedSince.add(id);
  if (reason === 'profile' || reason === 'marks') profileEditedSince = true;
});

// Sposta i viaggi dello spazio "ospite" nell'account appena collegato
export function guestData() {
  try { return hydrate(JSON.parse(localStorage.getItem(KEY('guest')) || 'null')); } catch { return blank(); }
}
export function adoptGuestData() {
  const g = guestData();
  for (const t of Object.values(g.trips)) {
    if (state.trips[t.id]) continue;
    state.trips[t.id] = { ...t, synced: false };
    markDirty(t.id);
  }
  const m = state.marks;
  state.marks = sanitizeMarks({ visited: [...m.visited, ...g.marks.visited], wish: [...m.wish, ...g.marks.wish] });
  if (!state.profile.name && g.profile.name) state.profile.name = g.profile.name;
  if (!state.profile.home && g.profile.home) state.profile.home = g.profile.home;
  if (!state.profile.nat && g.profile.nat) state.profile.nat = g.profile.nat;
  state.sync.profileDirty = true;
  persist();
  try { localStorage.removeItem(KEY('guest')); } catch { /* niente */ }
  emit('trips');
}

export function wipe(namespaceToWipe = ns) {
  try { localStorage.removeItem(KEY(namespaceToWipe)); } catch { /* niente */ }
  if (namespaceToWipe === ns) { state = blank(); emit('load'); }
}

// ---------------------------------------------------------------------------
// Export / import (portabilità dei dati)
// ---------------------------------------------------------------------------
export function exportData() {
  return {
    app: 'Orbita', format: 1, exportedAt: new Date().toISOString(),
    profile: state.profile, marks: state.marks,
    trips: Object.values(state.trips).map(({ synced, base, ...t }) => t),
  };
}
export function importData(obj) {
  if (!obj || obj.app !== 'Orbita' || !Array.isArray(obj.trips)) throw new Error('File non riconosciuto: serve un export di Orbita.');
  let n = 0;
  for (const raw of obj.trips.slice(0, 2000)) {
    const t = sanitizeTrip({ ...raw, synced: false, base: '' });
    if (!t) continue;
    if (state.trips[t.id] && state.trips[t.id].updatedAt >= t.updatedAt) continue;
    state.trips[t.id] = { ...t, synced: state.trips[t.id]?.synced || false, base: state.trips[t.id]?.base || '' };
    markDirty(t.id);
    n++;
  }
  const m = sanitizeMarks(obj.marks);
  state.marks = sanitizeMarks({ visited: [...state.marks.visited, ...m.visited], wish: [...state.marks.wish, ...m.wish] });
  if (obj.profile) {
    const p = sanitizeProfile(obj.profile);
    state.profile = sanitizeProfile({ ...p, ...Object.fromEntries(Object.entries(state.profile).filter(([, v]) => v && (!Array.isArray(v) || v.length))) });
  }
  state.sync.profileDirty = true;
  persist();
  emit('trips');
  return n;
}
