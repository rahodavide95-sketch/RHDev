/* Modalità prova: le stesse regole del database (supabase/schema.sql), ma tutto resta in questo
   browser (localStorage). Serve per provare lo strumento prima di attivare il server, e per i test.
   Niente login né verifica in due passaggi: è solo una prova, con dati finti. */

import { sha256hex, unb64 } from '../core/crypto.js';

const KEY = 'labelform-demo';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const fresh = () => ({ settings: null, forms: [], releases: [], invites: [], versions: [], events: [], seq: 1 });
let db = load() || fresh();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { throw new Error('Spazio del browser pieno: elimina qualche release di prova'); } };
window.addEventListener('storage', e => { if (e.key === KEY) db = load() || fresh(); });
const reload = () => { db = load() || fresh(); };

const now = () => new Date().toISOString();
const uuid = () => globalThis.crypto.randomUUID();
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
const tokenHash = t => /^[A-Za-z0-9_-]{43}$/.test(t || '') ? sha256hex(t) : Promise.resolve('');
const verHash = v => sha256hex(unb64(v));
const INVITE_PUBLIC = ['id', 'release_id', 'form_id', 'artist_name', 'artist_email', 'artist_pct', 'token_enc', 'expires_at', 'revoked_at', 'opened_at', 'submitted_at', 'updated_at', 'created_at', 'version', 'filled', 'contract_signed_at', 'contract_hash'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, clone(o[k] ?? null)]));
const event = (invite_id, kind, changed = []) => db.events.push({ id: db.seq++, invite_id, kind, changed, created_at: now(), read_at: null });

async function find(token) {
  reload();
  const hsh = await tokenHash(token);
  return hsh ? db.invites.find(i => i.token_hash === hsh) || null : null;
}
function linkError(i) {
  if (!i) return 'not_found';
  if (i.revoked_at) return 'revoked';
  if (i.expires_at && new Date(i.expires_at) < new Date()) return 'expired';
  return null;
}
const sealedOk = s => s && typeof s === 'object' && /^[A-Za-z0-9+/]{16}$/.test(s.iv || '') && /^[A-Za-z0-9+/]+={0,2}$/.test(s.ct || '');
async function checkPw(i, verifier) {
  if (!i.pw_verifier) return { error: 'no_password' };
  const since = i.fail_since ? new Date(i.fail_since).getTime() : 0;
  if (since > Date.now() - 15 * 60e3 && i.fail_count >= 8) return { error: 'locked', retry_at: new Date(since + 15 * 60e3).toISOString() };
  if (verifier && /^[A-Za-z0-9+/]{43}=$/.test(verifier) && await verHash(verifier) === i.pw_verifier) { i.fail_count = 0; i.fail_since = null; save(); return null; }
  if (!since || since <= Date.now() - 15 * 60e3) { i.fail_count = 1; i.fail_since = now(); } else i.fail_count++;
  save();
  return { error: 'wrong_password', left: Math.max(0, 8 - i.fail_count) };
}
const closed = i => { const r = db.releases.find(x => x.id === i.release_id); return !!(r && r.closed_at); };

export const artistApi = {
  kind: 'demo',
  async open(token) {
    const i = await find(token);
    const e = linkError(i);
    if (e) return { error: e };
    const s = db.settings;
    if (!s || !s.label_key) return { error: 'not_ready' };
    const r = db.releases.find(x => x.id === i.release_id);
    const f = db.forms.find(x => x.id === i.form_id);
    if (!i.opened_at) { i.opened_at = now(); event(i.id, 'opened'); save(); }
    return clone({
      invite: { id: i.id, artist: i.artist_name, artist_pct: i.artist_pct, version: i.version, submitted_at: i.submitted_at, updated_at: i.updated_at,
        has_password: !!i.pw_verifier, pw_salt: i.pw_salt, pw_iter: i.pw_iter, contract_signed_at: i.contract_signed_at, expires_at: i.expires_at },
      release: { title: r.title, catalog: r.catalog, release_date: r.release_date, closed: !!r.closed_at },
      form: f.schema,
      label: { name: s.label_name, logo: s.logo, signature: s.label_signature, signer: s.label_signer, pub: s.label_key.pub, share_with: s.notify_email },
    });
  },
  async unlock(token, verifier) {
    const i = await find(token);
    const e = linkError(i);
    if (e) return { error: e };
    const err = await checkPw(i, verifier);
    if (err) return err;
    return clone({ dek_artist: i.dek_artist, main: i.main_ct, contract: i.contract_ct, contract_hash: i.contract_hash, contract_signed_at: i.contract_signed_at, version: i.version });
  },
  async submit(token, p) {
    const i = await find(token);
    const e = linkError(i);
    if (e) return { error: e };
    if (closed(i)) return { error: 'closed' };
    if (i.version > 0) return { error: 'already_submitted' };
    if (!p || !p.dek_label || !sealedOk(p.main)) return { error: 'invalid' };
    const signing = !!(p.contract && p.contract.sign);
    if (p.contract && !sealedOk(p.contract.ct)) return { error: 'invalid' };
    if (signing && !/^[0-9a-f]{64}$/.test(p.contract.hash || '')) return { error: 'invalid' };
    const t = now();
    Object.assign(i, {
      dek_label: p.dek_label, dek_artist: p.password ? p.password.dek : null, pw_salt: p.password ? p.password.salt : null,
      pw_iter: p.password ? p.password.iter : null, pw_verifier: p.password ? await verHash(p.password.verifier) : null,
      main_ct: p.main, filled: p.filled || [], contract_ct: p.contract ? p.contract.ct : null,
      contract_hash: signing ? p.contract.hash : null, contract_signed_at: signing ? t : null,
      version: 1, submitted_at: t, updated_at: t,
    });
    db.versions.push({ invite_id: i.id, version: 1, main_ct: p.main, contract_ct: i.contract_ct, filled: i.filled, changed: [], created_at: t });
    event(i.id, 'submitted');
    if (signing) event(i.id, 'signed');
    save();
    return { ok: true, version: 1, submitted_at: t, contract_signed_at: signing ? t : null };
  },
  async update(token, verifier, p) {
    const i = await find(token);
    const e = linkError(i);
    if (e) return { error: e };
    if (!i.version) return { error: 'not_submitted' };
    const err = await checkPw(i, verifier);
    if (err) return err;
    if (closed(i)) return { error: 'closed' };
    if (!p || Number(p.base_version) !== i.version) return { error: 'conflict', version: i.version };
    if (!sealedOk(p.main)) return { error: 'invalid' };
    let signing = false;
    if (p.contract) {
      if (i.contract_signed_at) return { error: 'contract_locked' };
      if (!sealedOk(p.contract.ct)) return { error: 'invalid' };
      signing = !!p.contract.sign;
      if (signing && !/^[0-9a-f]{64}$/.test(p.contract.hash || '')) return { error: 'invalid' };
    }
    const t = now();
    i.version += 1;
    i.main_ct = p.main; i.filled = p.filled || []; i.updated_at = t;
    if (p.contract) i.contract_ct = p.contract.ct;
    if (signing) { i.contract_hash = p.contract.hash; i.contract_signed_at = t; }
    if (p.password) { i.dek_artist = p.password.dek; i.pw_salt = p.password.salt; i.pw_iter = p.password.iter; i.pw_verifier = await verHash(p.password.verifier); }
    db.versions.push({ invite_id: i.id, version: i.version, main_ct: p.main, contract_ct: i.contract_ct, filled: i.filled, changed: p.changed || [], created_at: t });
    if ((p.changed || []).length || !signing) event(i.id, 'updated', p.changed || []);
    if (signing) event(i.id, 'signed');
    save();
    return { ok: true, version: i.version, updated_at: t, contract_signed_at: i.contract_signed_at };
  },
  async preview(token, since) {
    const hsh = await tokenHash(token);
    reload();
    const f = hsh ? db.forms.find(x => x.preview_hash === hsh) : null;
    if (!f) return { error: 'not_found' };
    if (since && f.updated_at <= since) return { same: true, updated_at: f.updated_at };
    const s = db.settings || {};
    return clone({ form: f.schema, updated_at: f.updated_at, label: { name: s.label_name, logo: s.logo, signature: s.label_signature, signer: s.label_signer } });
  },
  async mailPing() { return false; },
  async mailCopy() { return { error: 'email_off' }; },
  mailFlush() {},
};

const table = name => db[name];
export const adminApi = {
  kind: 'demo',
  auth: {
    async session() { return { user: { email: 'prova@labelform.local' } }; },
    onChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signIn() {}, async signUp() { return {}; }, async resendSignup() {}, async reset() {}, async setPassword() {},
    async signOut() {},
    async mfa() { return { level: 'aal2', factors: [{ id: 'demo' }] }; },
    async enroll() { return null; }, async verify() {},
    async user() { return { email: 'prova@labelform.local' }; },
  },
  async status() { return { owner: true, claimed: true, aal2: true, email_ok: true, can_claim: false }; },
  async claim() { return 'already'; },
  async getSettings() { reload(); return clone(db.settings); },
  async saveSettings(patch) { reload(); db.settings = { ...(db.settings || { label_name: '', notify_email: '', public_url: '', logo: '', label_signature: '', label_signer: '', label_key: null }), ...clone(patch), updated_at: now() }; save(); return clone(db.settings); },

  async listForms() { reload(); return clone(table('forms').map(({ schema, ...f }) => f).sort((a, b) => b.updated_at.localeCompare(a.updated_at))); },
  async getForm(id) { reload(); const f = db.forms.find(x => x.id === id); if (!f) throw new Error('Modulo non trovato'); return clone(f); },
  async createForm(title, schema) { reload(); const f = { id: uuid(), title, schema: clone(schema), archived: false, created_at: now(), updated_at: now() }; db.forms.push(f); save(); return clone(f); },
  async updateForm(id, patch) { reload(); const f = db.forms.find(x => x.id === id); Object.assign(f, clone(patch), { updated_at: now() }); save(); return { id, updated_at: f.updated_at }; },
  async setPreview(id, patch) {
    reload();
    const f = db.forms.find(x => x.id === id);
    const hsh = patch.preview_hash || null;
    if (hsh && !/^[0-9a-f]{64}$/.test(hsh)) throw new Error('Link di anteprima non valido');
    f.preview_hash = hsh; f.preview_enc = hsh ? patch.preview_enc : null; save();
    return { id, preview_hash: f.preview_hash, preview_enc: f.preview_enc };
  },
  async deleteForm(id) {
    reload();
    if (db.invites.some(i => i.form_id === id)) { const e = new Error('Il modulo è usato da qualche artista'); e.code = 'in_use'; throw e; }
    db.forms = db.forms.filter(f => f.id !== id); save();
  },

  async listReleases() { reload(); return clone([...db.releases].sort((a, b) => b.created_at.localeCompare(a.created_at))); },
  async createRelease(r) { reload(); const x = { id: uuid(), title: r.title, catalog: r.catalog || '', release_date: r.release_date || null, notes: r.notes || '', closed_at: null, created_at: now(), updated_at: now() }; db.releases.push(x); save(); return clone(x); },
  async updateRelease(id, patch) { reload(); const r = db.releases.find(x => x.id === id); Object.assign(r, clone(patch), { updated_at: now() }); save(); return clone(r); },
  async deleteRelease(id) {
    reload();
    const ids = new Set(db.invites.filter(i => i.release_id === id).map(i => i.id));
    db.invites = db.invites.filter(i => !ids.has(i.id));
    db.versions = db.versions.filter(v => !ids.has(v.invite_id));
    db.events = db.events.filter(v => !ids.has(v.invite_id));
    db.releases = db.releases.filter(r => r.id !== id);
    save();
  },

  async listInvites(releaseId) { reload(); return clone(db.invites.filter(i => !releaseId || i.release_id === releaseId).map(i => pick(i, INVITE_PUBLIC))); },
  async getInviteData(id) { reload(); const i = db.invites.find(x => x.id === id); return clone({ ...pick(i, INVITE_PUBLIC), dek_label: i.dek_label, main_ct: i.main_ct, contract_ct: i.contract_ct }); },
  async listVersions(inviteId) { reload(); return clone(db.versions.filter(v => v.invite_id === inviteId).sort((a, b) => b.version - a.version)); },
  async createInvite(row) {
    reload();
    const i = { id: uuid(), artist_email: '', artist_pct: 50, expires_at: null, ...clone(row), revoked_at: null, opened_at: null, submitted_at: null, updated_at: null, created_at: now(),
      version: 0, filled: [], contract_signed_at: null, contract_hash: null, dek_label: null, dek_artist: null, pw_salt: null, pw_iter: null, pw_verifier: null, main_ct: null, contract_ct: null, fail_count: 0, fail_since: null };
    db.invites.push(i); save();
    return pick(i, INVITE_PUBLIC);
  },
  async updateInvite(id, patch) {
    reload();
    const i = db.invites.find(x => x.id === id);
    const allowed = ['artist_name', 'artist_email', 'artist_pct', 'token_hash', 'token_enc', 'expires_at', 'revoked_at'];
    for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new Error('Campo non modificabile: ' + k);
    if (i.contract_signed_at && 'artist_pct' in patch && patch.artist_pct !== i.artist_pct) throw new Error('label form: il contratto è firmato e non si può modificare');
    Object.assign(i, clone(patch)); save();
    return pick(i, INVITE_PUBLIC);
  },
  async deleteInvite(id) { reload(); db.invites = db.invites.filter(i => i.id !== id); db.versions = db.versions.filter(v => v.invite_id !== id); db.events = db.events.filter(v => v.invite_id !== id); save(); },

  async listEvents(limit = 200) { reload(); return clone([...db.events].sort((a, b) => b.id - a.id).slice(0, limit)); },
  async markRead(ids) { reload(); const s = new Set(ids); for (const e of db.events) if (s.has(e.id) && !e.read_at) e.read_at = now(); save(); },
  async mailTest() { return { error: 'email_off' }; },
  async mailPing() { return false; },
};

export function resetDemo() { db = fresh(); save(); }
export const hasDemoData = () => !!load();
