import { tr } from './i18n.js';
/* Cifratura di Label Form. Tutto succede nel browser con Web Crypto: il server vede solo dati illeggibili.

   Chiave dell'etichetta (una sola, la tua)
   - Coppia RSA-OAEP 3072 / SHA-256 creata nel tuo browser.
   - La parte pubblica sta sul server: gli artisti la usano per chiudere i loro invii.
   - La parte privata è chiusa due volte (AES-256-GCM): con la tua "password di cifratura"
     (PBKDF2-SHA256, 600.000 passaggi) e con il codice di recupero (160 bit casuali).
     Il server conserva solo queste due copie chiuse: senza password o codice non serve a nulla.

   Invio di un artista
   - Una "chiave dei dati" casuale (AES-256-GCM) per ogni invito; i dati sono compressi e cifrati
     con un IV nuovo a ogni salvataggio e legati all'invito (AAD), così non si possono scambiare.
   - La chiave dei dati è chiusa per l'etichetta (RSA-OAEP) e, se l'artista sceglie una password,
     anche per l'artista: dalla sua password (PBKDF2 600.000) nascono 512 bit, metà per chiudere la
     chiave e metà come "prova" che il server confronta (ne tiene solo l'impronta SHA-256).
     La password non lascia mai il browser. */

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITER = 600000;
const RC_ITER = 100000;
const LABEL_AAD = enc.encode('label-form/label-key/v1');
const DEK_AAD = enc.encode('label-form/artist-dek/v1');

export class WrongSecret extends Error { constructor() { super('Password o codice non corretti'); this.name = 'WrongSecret'; } }
export class BadData extends Error { constructor(m = 'Dati non validi') { super(m); this.name = 'BadData'; } }

export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new BadData();
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Codice segreto del link di un artista: 256 bit casuali. */
export const makeToken = () => b64url(randomBytes(32));
export const isTokenShape = t => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

export async function sha256hex(text) {
  const d = new Uint8Array(await subtle().digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** JSON con le chiavi in ordine: stesso oggetto → stessa stringa (per le impronte). */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/* ─── Codice di recupero: 32 caratteri Crockford base32 (160 bit), a gruppi di 4 ─── */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function makeRecoveryCode() {
  const bytes = randomBytes(20);
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-');
}
export function normalizeRecoveryCode(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}
export const isRecoveryCodeShape = s => /^[0-9A-HJKMNP-TV-Z]{32}$/.test(normalizeRecoveryCode(s));

const normPw = pw => String(pw).normalize('NFC');

async function aesFrom(secret, salt, iter) {
  const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealBytes(key, bytes, aad) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes);
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
async function openBytes(key, w, aad) {
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(w.iv), additionalData: aad }, key, unb64(w.ct)));
  } catch (e) {
    throw new WrongSecret();
  }
}

/* ─── Chiave dell'etichetta ─── */
const RSA = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const RSA_IMPORT = { name: 'RSA-OAEP', hash: 'SHA-256' };

export function checkLabelRecord(r) {
  const isStr = (x, max = 20000) => typeof x === 'string' && x.length > 0 && x.length <= max;
  const isW = w => w && isStr(w.iv, 64) && isStr(w.ct) && isStr(w.salt, 64) && Number.isInteger(w.iter) && w.iter >= 100000 && w.iter <= 10000000;
  if (!r || typeof r !== 'object' || r.v !== 1 || !isStr(r.pub, 4000) || !isW(r.pw) || !isW(r.rc)) throw new BadData('Chiave dell\'etichetta non valida');
  return r;
}

async function wrapPkcs8(pkcs8, secret, iter) {
  const salt = randomBytes(16);
  const key = await aesFrom(secret, salt, iter);
  return { ...(await sealBytes(key, pkcs8, LABEL_AAD)), salt: b64(salt), iter };
}
async function importPrivate(pkcs8) {
  return subtle().importKey('pkcs8', pkcs8, RSA_IMPORT, false, ['decrypt']);
}

/** Crea la chiave dell'etichetta. Restituisce ciò che va salvato, la chiave pronta all'uso e il codice di recupero (da mostrare una volta). */
export async function createLabelKey(passphrase, iter = PBKDF2_ITER) {
  const pair = await subtle().generateKey(RSA, true, ['encrypt', 'decrypt']);
  const spki = new Uint8Array(await subtle().exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const recoveryCode = makeRecoveryCode();
  const [pw, rc] = await Promise.all([wrapPkcs8(pkcs8, normPw(passphrase), iter), wrapPkcs8(pkcs8, normalizeRecoveryCode(recoveryCode), RC_ITER)]);
  const record = { v: 1, alg: 'RSA-OAEP-3072-SHA256', pub: b64(spki), pw, rc };
  const privateKey = await importPrivate(pkcs8);
  pkcs8.fill(0);
  return { record, privateKey, recoveryCode };
}

async function openPkcs8(record, secret, which) {
  checkLabelRecord(record);
  const w = record[which];
  const key = await aesFrom(which === 'pw' ? normPw(secret) : normalizeRecoveryCode(secret), unb64(w.salt), w.iter);
  return openBytes(key, w, LABEL_AAD);
}

export async function unlockLabelKey(record, passphrase) {
  const p = await openPkcs8(record, passphrase, 'pw');
  try { return await importPrivate(p); } finally { p.fill(0); }
}
export async function unlockLabelKeyWithRecovery(record, code) {
  const p = await openPkcs8(record, code, 'rc');
  try { return await importPrivate(p); } finally { p.fill(0); }
}

/** Nuova password di cifratura (serve quella attuale oppure il codice di recupero). */
export async function changeLabelPassphrase(record, current, next, { useRecovery = false, iter = PBKDF2_ITER } = {}) {
  const p = await openPkcs8(record, current, useRecovery ? 'rc' : 'pw');
  try { return { ...record, pw: await wrapPkcs8(p, normPw(next), iter) }; } finally { p.fill(0); }
}
/** Nuovo codice di recupero (il vecchio smette di funzionare). */
export async function newLabelRecoveryCode(record, passphrase) {
  const p = await openPkcs8(record, passphrase, 'pw');
  try {
    const code = makeRecoveryCode();
    return { record: { ...record, rc: await wrapPkcs8(p, normalizeRecoveryCode(code), RC_ITER) }, code };
  } finally { p.fill(0); }
}

export async function importLabelPublic(pubB64) {
  return subtle().importKey('spki', unb64(pubB64), RSA_IMPORT, false, ['encrypt']);
}
/** Impronta corta della chiave pubblica (per riconoscerla a colpo d'occhio). */
export async function keyFingerprint(pubB64) {
  const h = (await sha256hex(unb64(pubB64))).toUpperCase().slice(0, 16);
  return h.match(/.{4}/g).join('-');
}

export async function sealForLabel(pub, bytes) {
  return b64(new Uint8Array(await subtle().encrypt({ name: 'RSA-OAEP' }, pub, bytes)));
}
export async function openForLabel(priv, s) {
  try { return new Uint8Array(await subtle().decrypt({ name: 'RSA-OAEP' }, priv, unb64(s))); }
  catch (e) { throw new BadData('Non riesco ad aprire questo dato con la chiave dell\'etichetta'); }
}
export const sealTextForLabel = (pub, text) => sealForLabel(pub, enc.encode(text));
export const openTextForLabel = async (priv, s) => dec.decode(await openForLabel(priv, s));

/* ─── Chiave dei dati di un invito ─── */
export async function newDataKey() {
  const raw = randomBytes(32);
  const key = await subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { raw, key };
}
const importDataKey = raw => subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export const wrapDataKeyForLabel = (pub, raw) => sealForLabel(pub, raw);
export async function unwrapDataKeyForLabel(priv, s) {
  const raw = await openForLabel(priv, s);
  if (raw.length !== 32) throw new BadData();
  try { return await importDataKey(raw); } finally { raw.fill(0); }
}

/* ─── Password dell'artista ─── */
export const newSalt = () => b64(randomBytes(16));

/** Dalla password dell'artista: la chiave che chiude/apre la chiave dei dati e la "prova" per il server. */
export async function artistSecret(password, saltB64, iter = PBKDF2_ITER) {
  const base = await subtle().importKey('raw', enc.encode(normPw(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, 512));
  const kek = await subtle().importKey('raw', bits.slice(0, 32), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const verifier = b64(bits.slice(32));
  bits.fill(0);
  return { kek, verifier };
}
export const wrapDataKeyForArtist = (kek, raw) => sealBytes(kek, raw, DEK_AAD);
export async function unwrapDataKeyForArtist(kek, w) {
  const raw = await openBytes(kek, w, DEK_AAD);
  if (raw.length !== 32) throw new BadData();
  try { return await importDataKey(raw); } finally { raw.fill(0); }
}

/* ─── Dati cifrati (JSON compresso) ─── */
async function pipe(bytes, Stream) {
  const s = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
export const partAad = (part, inviteId) => enc.encode(`label-form/v1|${part}|${inviteId}`);

export async function sealJson(key, obj, aad) {
  let bytes = enc.encode(JSON.stringify(obj));
  let z = 0;
  if (canZip()) { bytes = await pipe(bytes, CompressionStream); z = 1; }
  return { ...(await sealBytes(key, bytes, aad)), z };
}
export async function openJson(key, sealed, aad) {
  if (!sealed || typeof sealed.iv !== 'string' || typeof sealed.ct !== 'string') throw new BadData();
  let bytes;
  try { bytes = await openBytes(key, sealed, aad); }
  catch (e) { throw new BadData('I dati non si aprono: chiave diversa o dati danneggiati'); }
  if (sealed.z) {
    if (!canZip()) throw new BadData('Questo browser è troppo vecchio per aprire i dati');
    bytes = await pipe(bytes, DecompressionStream);
  }
  return JSON.parse(dec.decode(bytes));
}

/* ─── Robustezza della password (stima semplice, in bit) ─── */
const COMMON = ['password', 'passw0rd', '123456', '12345678', 'qwerty', 'abc123', 'ciao', 'amore', 'juventus', 'milan', 'inter', 'napoli', 'roma', 'lazio', 'admin', 'letmein', 'iloveyou', 'welcome', 'dragon', 'monkey', 'football', 'techno', 'music', 'musica', 'house'];
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, bits: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/\d/.test(s)) pool += 10;
  if (/[^A-Za-z0-9]/.test(s)) pool += 33;
  let bits = s.length * Math.log2(Math.max(pool, 1));
  const lower = s.toLowerCase();
  if (COMMON.some(w => lower.includes(w))) bits -= 18;
  if (/(.)\1{2,}/.test(s)) bits -= 10;
  if (/^(?:\d+|[a-z]+|[A-Z]+)$/.test(s)) bits -= 8;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(s)) bits -= 10;
  const words = s.trim().split(/[\s\-_.]+/).filter(w => w.length >= 3);
  if (words.length >= 4) bits = Math.max(bits, words.length * 11);
  bits = Math.max(0, Math.round(bits));
  const score = bits < 36 ? 1 : bits < 50 ? 2 : bits < 64 ? 3 : 4;
  return { score, bits, label: (tr('', '') + ['', tr('Debole', 'Weak'), tr('Discreta', 'Fair'), tr('Buona', 'Good'), tr('Ottima', 'Excellent')][score]) };
}
export const MIN_PASSWORD = 10;
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < MIN_PASSWORD) return tr(`Almeno ${MIN_PASSWORD} caratteri.`, `At least ${MIN_PASSWORD} characters.`);
  if (passwordStrength(s).score < 2) return tr('Troppo facile da indovinare: allungala o aggiungi parole.', 'Too easy to guess: make it longer or add words.');
  return '';
}
