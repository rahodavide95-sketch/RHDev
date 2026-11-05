/* Collegamento a Supabase. Le regole vere stanno nel database (supabase/schema.sql):
   qui ci sono solo le chiamate. Nessuna chiave segreta nel browser. */

import { CONFIG } from '../config.js';

let artistClient = null, adminClient = null;

function lib() {
  if (!window.supabase || !window.supabase.createClient) throw new Error('offline');
  if (/service_role/.test(atob((CONFIG.supabaseAnonKey.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/') || 'e30='))) throw new Error('Chiave sbagliata in config.js');
  return window.supabase;
}
function artist() {
  if (!artistClient) artistClient = lib().createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return artistClient;
}
function admin() {
  if (!adminClient) {
    adminClient = lib().createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'consegne-auth' },
    });
  }
  return adminClient;
}

export class ApiError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}
// errori delle email di accesso: limite di invio, registrazioni chiuse, altro
function mailError(error) {
  const m = (error && (error.message || error.code)) || '';
  if (/rate|too many|security purposes|seconds/i.test(m) || (error && /rate_limit/.test(error.code || ''))) return new ApiError('rate', m);
  if (/signups? not allowed|disabled/i.test(m)) return new ApiError('closed', m);
  if (/fetch|network/i.test(m)) return new ApiError('network', 'Connessione non riuscita');
  return new ApiError('server', m);
}
async function rpc(client, fn, args) {
  let res;
  try { res = await client.rpc(fn, args); }
  catch (e) { throw new ApiError('network', 'Connessione non riuscita'); }
  if (res.error) {
    if (/fetch|network|Failed/i.test(res.error.message || '')) throw new ApiError('network', 'Connessione non riuscita');
    throw new ApiError('server', res.error.message);
  }
  return res.data;
}
function check(res) {
  if (res.error) {
    const m = res.error.message || '';
    if (/fetch|network/i.test(m)) throw new ApiError('network', 'Connessione non riuscita');
    if (/JWT|session|aal/i.test(m)) throw new ApiError('auth', 'Accedi di nuovo');
    throw new ApiError('server', m);
  }
  return res.data;
}

/* ─── Artista (senza account) ─── */
export const artistApi = {
  kind: 'supabase',
  open: token => rpc(artist(), 'consegne_open', { p_token: token }),
  unlock: (token, verifier) => rpc(artist(), 'consegne_unlock', { p_token: token, p_verifier: verifier }),
  submit: (token, p) => rpc(artist(), 'consegne_submit', { p_token: token, p }),
  update: (token, verifier, p) => rpc(artist(), 'consegne_update', { p_token: token, p_verifier: verifier, p }),
  async mailPing() {
    try { const { data } = await artist().functions.invoke('consegne-mail', { body: { action: 'ping' } }); return !!(data && data.email); }
    catch { return false; }
  },
  async mailCopy(body) {
    const { data, error } = await artist().functions.invoke('consegne-mail', { body: { action: 'copy', ...body } });
    if (error) {
      let code = 'server';
      try { const j = await error.context.json(); code = j.error || code; } catch { /* */ }
      return { error: code };
    }
    return data || { error: 'server' };
  },
  mailFlush() { artist().functions.invoke('consegne-mail', { body: { action: 'flush' } }).catch(() => {}); },
};

/* ─── Etichetta (account con verifica in due passaggi) ─── */
const INVITE_COLS = 'id, release_id, form_id, artist_name, artist_email, artist_pct, token_enc, expires_at, revoked_at, opened_at, submitted_at, updated_at, created_at, version, filled, contract_signed_at, contract_hash';

export const adminApi = {
  kind: 'supabase',
  auth: {
    async session() { const { data } = await admin().auth.getSession(); return data.session || null; },
    onChange(cb) { return admin().auth.onAuthStateChange((ev, s) => cb(ev, s)); },
    async signIn(email, password) {
      const { error } = await admin().auth.signInWithPassword({ email, password });
      if (error) throw new ApiError(/confirm/i.test(error.message) || error.code === 'email_not_confirmed' ? 'confirm' : /invalid/i.test(error.message) ? 'invalid' : /rate|too many/i.test(error.message) ? 'rate' : 'server', error.message);
    },
    async signUp(email, password, redirect) {
      const { data, error } = await admin().auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
      if (error) throw mailError(error);
      return data;
    },
    async resendSignup(email, redirect) {
      const { error } = await admin().auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirect } });
      if (error) throw mailError(error);
    },
    async reset(email, redirect) {
      const { error } = await admin().auth.resetPasswordForEmail(email, { redirectTo: redirect });
      if (error) throw mailError(error);
    },
    async setPassword(password) {
      const { error } = await admin().auth.updateUser({ password });
      if (error) throw new ApiError('server', error.message);
    },
    async signOut(scope = 'local') { await admin().auth.signOut({ scope }).catch(() => {}); },
    async mfa() {
      const { data, error } = await admin().auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw new ApiError('auth', error.message);
      const f = await admin().auth.mfa.listFactors();
      const verified = ((f.data && f.data.totp) || []).filter(x => x.status === 'verified');
      return { level: data.currentLevel, factors: verified };
    },
    async enroll() {
      const all = await admin().auth.mfa.listFactors();
      for (const f of (all.data && all.data.all) || []) if (f.status !== 'verified') await admin().auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await admin().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Consegne ' + new Date().toISOString().slice(0, 16) });
      if (error) throw new ApiError('server', error.message);
      return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
    },
    async verify(factorId, code) {
      const { error } = await admin().auth.mfa.challengeAndVerify({ factorId, code: String(code).replace(/\s/g, '') });
      if (error) throw new ApiError('code', 'Codice non valido');
    },
    async user() { const { data } = await admin().auth.getUser(); return data.user || null; },
  },
  status: () => rpc(admin(), 'consegne_status', {}),
  claim: code => rpc(admin(), 'consegne_claim', { p_code: code }),

  async getSettings() { return check(await admin().from('consegne_settings').select('*').maybeSingle()); },
  async saveSettings(patch) {
    const cur = await adminApi.getSettings();
    const row = { ...patch, id: true, updated_at: new Date().toISOString() };
    if (cur) return check(await admin().from('consegne_settings').update(row).eq('id', true).select('*').single());
    return check(await admin().from('consegne_settings').insert(row).select('*').single());
  },

  async listForms() { return check(await admin().from('consegne_forms').select('id, title, archived, created_at, updated_at').order('updated_at', { ascending: false })); },
  async getForm(id) { return check(await admin().from('consegne_forms').select('*').eq('id', id).single()); },
  async createForm(title, schema) { return check(await admin().from('consegne_forms').insert({ title, schema }).select('*').single()); },
  async updateForm(id, patch) { return check(await admin().from('consegne_forms').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id, updated_at').single()); },
  async deleteForm(id) {
    const r = await admin().from('consegne_forms').delete().eq('id', id);
    if (r.error && /foreign key|violates/i.test(r.error.message)) throw new ApiError('in_use', 'Il modulo è usato da qualche artista');
    return check(r);
  },

  async listReleases() { return check(await admin().from('consegne_releases').select('*').order('created_at', { ascending: false })); },
  async createRelease(r) { return check(await admin().from('consegne_releases').insert(r).select('*').single()); },
  async updateRelease(id, patch) { return check(await admin().from('consegne_releases').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()); },
  async deleteRelease(id) { return check(await admin().from('consegne_releases').delete().eq('id', id)); },

  async listInvites(releaseId) {
    let q = admin().from('consegne_invites').select(INVITE_COLS).order('created_at', { ascending: true });
    if (releaseId) q = q.eq('release_id', releaseId);
    return check(await q);
  },
  async getInviteData(id) { return check(await admin().from('consegne_invites').select(INVITE_COLS + ', dek_label, main_ct, contract_ct').eq('id', id).single()); },
  async listVersions(inviteId) { return check(await admin().from('consegne_versions').select('version, main_ct, contract_ct, filled, changed, created_at').eq('invite_id', inviteId).order('version', { ascending: false })); },
  async createInvite(row) { return check(await admin().from('consegne_invites').insert(row).select(INVITE_COLS).single()); },
  async updateInvite(id, patch) { return check(await admin().from('consegne_invites').update(patch).eq('id', id).select(INVITE_COLS).single()); },
  async deleteInvite(id) { return check(await admin().from('consegne_invites').delete().eq('id', id)); },

  async listEvents(limit = 200) { return check(await admin().from('consegne_events').select('id, invite_id, kind, changed, created_at, read_at').order('id', { ascending: false }).limit(limit)); },
  async markRead(ids) {
    if (!ids.length) return;
    return check(await admin().from('consegne_events').update({ read_at: new Date().toISOString() }).in('id', ids));
  },
  async mailTest() {
    const { data, error } = await admin().functions.invoke('consegne-mail', { body: { action: 'test' } });
    if (error) { let code = 'server'; try { code = (await error.context.json()).error || code; } catch { /* */ } return { error: code }; }
    return data;
  },
  async mailPing() { return artistApi.mailPing(); },
};
