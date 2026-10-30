/* Collegamento all'account online (Supabase, lo stesso progetto e lo stesso account di
   [RH] Documents). Qui ci sono solo le chiamate: cosa si invia lo decide session.js, e online
   va SEMPRE e solo la cassaforte già cifrata nel browser.
   Niente librerie: fetch verso /auth/v1 e /rest/v1. */

import * as store from './store.js';

const SB_URL = 'https://ztjlqorvnulgfvbtvavm.supabase.co';
// chiave pubblica "anon" (fatta per stare nelle pagine web: da sola non apre nulla, decidono le regole del database)
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0amxxb3J2bnVsZ2Z2YnR2YXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTgwMDIsImV4cCI6MjA5NzI3NDAwMn0._6gEbzCCnejpyh36Lpqe0_fj27UaonCkn2a7NastDMA';
const TABLE = 'finanza_personale';
export const APP_URL = 'https://rahodavide95-sketch.github.io/RHDev/finanza-personale/';

export class CloudError extends Error {
  constructor(msg, status, code) { super(msg); this.name = 'CloudError'; this.status = status; this.code = code; }
}

let sess = null;   // { email, uid, access, refresh, exp }
export const session = () => sess;

export async function loadSession() {
  try { sess = (await store.get('cloud')) || null; } catch { sess = null; }
  return sess;
}
async function saveSession() { if (sess) await store.put('cloud', sess); else await store.del('cloud'); }

function setSession(d) {
  sess = {
    email: d.user?.email || sess?.email || '', uid: d.user?.id || sess?.uid || '',
    access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000,
  };
  return saveSession();
}

const timeout = ms => (AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});

async function api(path, o = {}) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (o.auth !== false) { await freshToken(); headers.Authorization = 'Bearer ' + (o.token || sess?.access || SB_KEY); }
  if (o.prefer) headers.Prefer = o.prefer;
  let r;
  try {
    r = await fetch(SB_URL + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', ...timeout(o.ms || 20000) });
  } catch {
    throw new CloudError(navigator.onLine === false ? 'Sei offline' : 'Server non raggiungibile', 0, 'offline');
  }
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { /* risposta non JSON */ }
  if (!r.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || ('Errore ' + r.status);
    throw new CloudError(translate(msg), r.status, data && (data.error_code || data.code));
  }
  return data;
}

/** I messaggi di Supabase più comuni, in italiano. */
function translate(m) {
  const s = String(m);
  if (/invalid login credentials/i.test(s)) return 'Email o password non corrette.';
  if (/email not confirmed/i.test(s)) return 'Devi prima confermare l\'email: apri il link che ti è arrivato.';
  if (/already registered|already been registered/i.test(s)) return 'Questa email ha già un account: usa "Accedi".';
  if (/password should be|weak password/i.test(s)) return 'Password troppo debole per il server: usane una più lunga.';
  if (/rate limit|too many/i.test(s)) return 'Troppi tentativi: aspetta qualche minuto e riprova.';
  if (/jwt expired|invalid jwt|refresh token/i.test(s)) return 'Sessione scaduta: accedi di nuovo.';
  return s;
}

async function freshToken() {
  if (!sess?.refresh || sess.exp - Date.now() > 60000) return;
  try {
    await setSession(await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: sess.refresh } }));
  } catch (e) {
    if (e.status === 400 || e.status === 401) { const err = new CloudError('Sessione scaduta: accedi di nuovo.', 401, 'session'); throw err; }
    throw e;
  }
}

const back = () => (/^https?:$/.test(location.protocol) ? '?redirect_to=' + encodeURIComponent(location.origin + location.pathname) : '');

/** C'è già un proprietario? (solo il primo account che accede può usare il cloud dell'app) */
export async function hasOwner() {
  try { return !!(await api('/rest/v1/rpc/finanza_personale_has_owner', { method: 'POST', auth: false, body: {} })); } catch { return true; }
}

export async function signIn(email, password) {
  await setSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: email.trim(), password } }));
  const mine = await api('/rest/v1/rpc/finanza_personale_claim', { method: 'POST', body: {} });
  if (mine !== true) {
    await signOut();
    throw new CloudError('Questa app è già collegata a un altro account. Puoi usarla senza account, solo su questo dispositivo.', 403, 'denied');
  }
  return sess;
}

/** Nuovo account: se Supabase chiede la conferma dell'email restituisce 'confirm'. */
export async function signUp(email, password) {
  const d = await api('/auth/v1/signup' + back(), { method: 'POST', auth: false, body: { email: email.trim(), password } });
  if (!d || !d.access_token) return 'confirm';
  await setSession(d);
  const mine = await api('/rest/v1/rpc/finanza_personale_claim', { method: 'POST', body: {} });
  if (mine !== true) { await signOut(); throw new CloudError('Questa app è già collegata a un altro account.', 403, 'denied'); }
  return 'ok';
}

/** Email per reimpostare la password dell'account. */
export async function requestReset(email) {
  await api('/auth/v1/recover' + back(), { method: 'POST', auth: false, body: { email: email.trim() } });
}

/** Sessione arrivata dal link dell'email (reimpostazione password). */
export async function adoptLinkSession(access, refresh) {
  sess = { email: '', uid: '', access, refresh, exp: Date.now() + 3000 * 1000 };
  const u = await api('/auth/v1/user');
  sess.email = u?.email || ''; sess.uid = u?.id || '';
  await saveSession();
  const mine = await api('/rest/v1/rpc/finanza_personale_claim', { method: 'POST', body: {} });
  if (mine !== true) { await signOut(); throw new CloudError('Questa app è collegata a un altro account.', 403, 'denied'); }
  return sess;
}

export async function setPassword(password) {
  await api('/auth/v1/user', { method: 'PUT', body: { password } });
}

export async function signOut() {
  try { if (sess?.access) await api('/auth/v1/logout', { method: 'POST', ms: 6000 }); } catch { /* si esce comunque */ }
  sess = null;
  await saveSession();
}

/* ─── La riga dei dati (una sola, cifrata) ─── */
export async function remoteVersion() {
  const rows = await api(`/rest/v1/${TABLE}?select=version&user_id=eq.${sess.uid}`);
  return rows && rows[0] ? Number(rows[0].version) : 0;
}
export async function fetchRow() {
  const rows = await api(`/rest/v1/${TABLE}?select=data,version&user_id=eq.${sess.uid}`, { ms: 60000 });
  return rows && rows[0] ? { data: rows[0].data, version: Number(rows[0].version) } : null;
}
/** Salva; restituisce la nuova versione, o null se nel frattempo un altro dispositivo ha salvato. */
export async function pushRow(data, version) {
  try {
    if (!version) {
      const rows = await api(`/rest/v1/${TABLE}`, { method: 'POST', prefer: 'return=representation', body: { user_id: sess.uid, data, version: 1 }, ms: 60000 });
      return rows && rows[0] ? Number(rows[0].version) : 1;
    }
    const rows = await api(`/rest/v1/${TABLE}?user_id=eq.${sess.uid}&version=eq.${version}`, { method: 'PATCH', prefer: 'return=representation', body: { data, version: version + 1, updated_at: new Date().toISOString() }, ms: 60000 });
    return rows && rows.length ? Number(rows[0].version) : null;
  } catch (e) {
    if (e.status === 409) return null;   // la riga c'era già: prima bisogna leggerla
    throw e;
  }
}
