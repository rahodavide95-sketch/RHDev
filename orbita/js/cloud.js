/* ============================================================================
   cloud.js — account, sincronizzazione e condivisione (Supabase)
   La sicurezza vera sta nel database (RLS in supabase/schema.sql): qui il
   browser può chiedere solo ciò che quelle regole gli permettono.
   ============================================================================ */
import { CONFIG } from './config.js';
import * as store from './store.js';
import { tripToRow, rowToTrip } from './model.js';
import { debounce, toast } from './util.js';

let sb = null;
let user = null;
let status = 'off';            // off | signed-out | syncing | ok | error | offline
let lastError = '';
const listeners = new Set();
const TRIP_COLS = 'id, owner_id, title, start_date, end_date, data, created_at, updated_at';

export const on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (ev, extra) => listeners.forEach(fn => { try { fn(ev, extra); } catch (e) { console.error(e); } });
const setStatus = s => { status = s; emit('status', s); };

export const isConfigured = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) && !isServiceKey(CONFIG.supabaseAnonKey);
export const getUser = () => user;
export const getStatus = () => ({ status, lastError });
export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

// La chiave service_role scavalca tutte le regole: se qualcuno la incolla per
// errore in config.js, l'app si rifiuta di usarla.
function isServiceKey(k) {
  try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
  catch { return /^sb_secret_/.test(k); }
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.supabase) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Libreria cloud non caricata'));
    document.head.appendChild(s);
  });
}

export async function init() {
  if (!isConfigured()) {
    if (CONFIG.supabaseAnonKey && isServiceKey(CONFIG.supabaseAnonKey)) console.error('Orbita: in config.js c\'è la chiave service_role. Usa la chiave anon/publishable.');
    setStatus('off');
    return null;
  }
  try {
    await loadScript(new URL('../vendor/supabase.min.js', import.meta.url).href);
    sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'orbita-auth' },
    });
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((event, session) => {
      const prev = user;
      user = session ? session.user : null;
      // mai chiamare Supabase dentro questo callback: si rimanda al giro successivo
      setTimeout(() => emit('auth', { event, prev, user }), 0);
    });
    setStatus(user ? 'ok' : 'signed-out');
    return user;
  } catch (e) {
    console.error(e);
    lastError = e.message;
    setStatus('error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Autenticazione
// ---------------------------------------------------------------------------
const ERR = {
  'Invalid login credentials': 'Email o password non corretti.',
  'Email not confirmed': 'Devi prima confermare l\'email: controlla la posta (anche lo spam).',
  'User already registered': 'Esiste già un account con questa email. Prova ad accedere.',
  'Password should be at least': 'La password è troppo corta.',
  'For security purposes': 'Troppi tentativi ravvicinati: riprova tra un minuto.',
  'rate limit': 'Troppi tentativi: riprova tra qualche minuto.',
  'Invalid TOTP code': 'Codice non valido o scaduto.',
  'Failed to fetch': 'Connessione assente: riprova quando sei online.',
  'weak': 'Password troppo debole o già comparsa in furti di dati: scegline un\'altra.',
};
export function friendlyError(e) {
  const msg = (e && (e.message || e.error_description || e.msg)) || String(e || 'Errore sconosciuto');
  for (const [k, v] of Object.entries(ERR)) if (msg.toLowerCase().includes(k.toLowerCase())) return v;
  return msg;
}
const need = () => { if (!sb) throw new Error('Cloud non configurato'); };

export async function signUp(email, password, name) {
  need();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl(), data: { name } } });
  if (error) throw error;
  // Supabase non rivela se l'email esiste già: identities vuote = già registrata
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('User already registered');
  return { needsConfirm: !data.session };
}

export async function signIn(email, password) {
  need();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { mfa: await needsMfa() };
}

export async function magicLink(email) {
  need();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl(), shouldCreateUser: false } });
  if (error) throw error;
}

export async function resetPassword(email) {
  need();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) throw error;
}

export async function updatePassword(password) {
  need();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut(scope = 'local') {
  if (!sb) return;
  await sb.auth.signOut({ scope });
}

// --- Verifica in due passaggi (TOTP: Google Authenticator, 1Password, ecc.) ---
export async function needsMfa() {
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}
export async function mfaFactors() {
  need();
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp || []).filter(f => f.status === 'verified');
}
export async function mfaEnroll() {
  need();
  // elimina eventuali tentativi lasciati a metà
  const { data: all } = await sb.auth.mfa.listFactors();
  for (const f of (all && all.all) || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Orbita ' + new Date().toISOString().slice(0, 10) });
  if (error) throw error;
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
export async function mfaVerify(factorId, code) {
  need();
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}
export async function mfaChallenge(code) {
  const f = (await mfaFactors())[0];
  if (!f) throw new Error('Nessun dispositivo di verifica configurato');
  await mfaVerify(f.id, code);
}
export async function mfaRemove(factorId) {
  need();
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function deleteAccount() {
  need();
  const { error } = await sb.rpc('orb_delete_account');
  if (error) throw error;
  await sb.auth.signOut({ scope: 'local' });
}

// ---------------------------------------------------------------------------
// Sincronizzazione
// ---------------------------------------------------------------------------
let running = null;
let again = false;

export function sync() {
  if (!sb || !user) return Promise.resolve(false);
  if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  running = doSync()
    .then(() => { lastError = ''; setStatus('ok'); return true; })
    .catch(e => { console.error(e); lastError = friendlyError(e); setStatus(navigator.onLine ? 'error' : 'offline'); return false; })
    .finally(() => { running = null; if (again) { again = false; sync(); } });
  return running;
}

async function doSync() {
  setStatus('syncing');
  store.beginSync();
  const snap = store.syncSnapshot();
  const uid = user.id;
  const myEmail = (user.email || '').toLowerCase();

  const { data: rows, error } = await sb.from('orb_trips').select(TRIP_COLS).order('start_date', { ascending: false }).limit(5000);
  if (error) throw error;
  const remote = new Map(rows.map(r => [r.id, r]));

  const deletedDone = [];
  if (snap.deleted.length) {
    const { error: e } = await sb.from('orb_trips').delete().in('id', snap.deleted);
    if (e) throw e;
    deletedDone.push(...snap.deleted);
    snap.deleted.forEach(id => remote.delete(id));
  }

  const pushed = [], discarded = [];
  for (const id of snap.dirty) {
    const found = store.findTrip(id);
    if (!found) continue;
    const t = found.trip;
    const r = remote.get(id);
    // modifica concorrente (altro dispositivo o altro viaggiatore): vince la più recente
    if (r && t.base && r.updated_at !== t.base && Date.parse(r.updated_at) > Date.parse(t.updatedAt)) {
      discarded.push(id);
      toast(`"${t.title}" era stato modificato altrove: tenuta la versione più recente.`, { ms: 5000 });
      continue;
    }
    const row = tripToRow(t);
    let res;
    if (found.role === 'owner') {
      res = await sb.from('orb_trips').upsert({ ...row, owner_id: uid }).select(TRIP_COLS).single();
    } else if (found.role === 'editor') {
      const { id: _id, ...patch } = row;
      res = await sb.from('orb_trips').update(patch).eq('id', id).select(TRIP_COLS).maybeSingle();
    } else continue;
    if (res.error) throw res.error;
    if (res.data) remote.set(id, res.data);
    pushed.push(id);
  }

  // Profilo, paesi segnati e preferenze
  let remoteProfile;
  let profilePushed = false;
  const { data: prof, error: pe } = await sb.from('orb_profiles').select('display_name, data, updated_at').eq('id', uid).maybeSingle();
  if (pe) throw pe;
  if (snap.profileDirty || !prof) {
    const st = store.get();
    const name = st.profile.name || (user.user_metadata && user.user_metadata.name) || '';
    const { error: ue } = await sb.from('orb_profiles').upsert({ id: uid, display_name: name.slice(0, 80), data: { profile: { ...st.profile, name }, marks: st.marks } });
    if (ue) throw ue;
    profilePushed = true;
  } else {
    remoteProfile = prof.data && typeof prof.data === 'object' ? prof.data : null;
  }

  // Viaggi condivisi con me (solo con email verificata: lo impone il database)
  const { data: shares, error: se } = await sb.from('orb_trip_shares').select('trip_id, email, role, inviter_name').eq('email', myEmail);
  if (se) throw se;
  const shareBy = new Map((shares || []).map(s => [s.trip_id, s]));

  const remoteTrips = [], remoteShared = [];
  for (const r of remote.values()) {
    const t = rowToTrip(r);
    if (!t) continue;
    if (r.owner_id === uid) remoteTrips.push(t);
    else if (shareBy.has(r.id)) remoteShared.push({ trip: t, role: shareBy.get(r.id).role, owner: shareBy.get(r.id).inviter_name || '' });
  }
  store.applySync({ pushed, discarded, deletedDone, profilePushed, remoteTrips, remoteShared, remoteProfile });
}

const soon = debounce(() => sync(), 1500);
store.on(reason => { if (user && ['trips', 'profile', 'marks'].includes(reason)) soon(); });
window.addEventListener('online', () => { if (user) sync(); });
window.addEventListener('offline', () => { if (user) setStatus('offline'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && user) {
    const last = Date.parse(store.get().sync.last || 0);
    if (!last || Date.now() - last > 30000) sync();
  }
});
setInterval(() => { if (user && document.visibilityState === 'visible') sync(); }, 120000);

// ---------------------------------------------------------------------------
// Condivisione dei viaggi
// ---------------------------------------------------------------------------
export const inviteLink = tripId => `${appUrl()}#/invito/${encodeURIComponent(tripId)}`;

export async function listShares(tripId) {
  need();
  const { data, error } = await sb.from('orb_trip_shares').select('email, role, created_at').eq('trip_id', tripId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function invite(tripId, email, role) {
  need();
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 254) return { ok: false, error: 'Indirizzo email non valido.' };
  if (email === (user.email || '').toLowerCase()) return { ok: false, error: 'Non puoi invitare te stesso.' };
  await sync();   // il viaggio deve esistere nel cloud prima di essere condiviso
  const found = store.findTrip(tripId);
  if (!found || found.role !== 'owner' || !found.trip.synced) return { ok: false, error: 'Il viaggio non è ancora salvato nel cloud: riprova tra poco.' };

  // 1) Funzione del server: salva l'invito e manda l'email (se configurata)
  try {
    const { data, error } = await sb.functions.invoke('trip-invite', { body: { trip_id: tripId, email, role, app_url: appUrl() } });
    if (!error && data && data.ok) return { ok: true, emailed: !!data.emailed };
    if (error && error.context && typeof error.context.json === 'function' && error.context.status !== 404) {
      let body = {};
      try { body = await error.context.json(); } catch { /* niente */ }
      return { ok: false, error: body.error || friendlyError(error) };
    }
  } catch { /* funzione non pubblicata: si passa al piano B */ }

  // 2) Piano B: salva l'invito direttamente (le regole RLS lo permettono solo al titolare)
  const name = store.get().profile.name || (user.user_metadata && user.user_metadata.name) || user.email;
  const { error } = await sb.from('orb_trip_shares').upsert({ trip_id: tripId, email, role, inviter_name: String(name).slice(0, 80) }, { onConflict: 'trip_id,email' });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, emailed: false };
}

export async function setShareRole(tripId, email, role) {
  need();
  const { error } = await sb.from('orb_trip_shares').update({ role }).eq('trip_id', tripId).eq('email', email);
  if (error) throw error;
}
export async function removeShare(tripId, email) {
  need();
  const { error } = await sb.from('orb_trip_shares').delete().eq('trip_id', tripId).eq('email', email);
  if (error) throw error;
}
export async function leaveShared(tripId) {
  need();
  const { error } = await sb.from('orb_trip_shares').delete().eq('trip_id', tripId).eq('email', (user.email || '').toLowerCase());
  if (error) throw error;
  await sync();
}
