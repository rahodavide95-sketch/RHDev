/* Cassaforte cifrata. Tutto succede nel browser con Web Crypto: nessun server.

   - I dati sono cifrati con una "chiave dei dati" casuale (AES-256-GCM, IV nuovo a
     ogni salvataggio, compressi prima di cifrarli).
   - La chiave dei dati è chiusa (wrap) due volte: con la password (PBKDF2-SHA256,
     600.000 passaggi, sale casuale) e con il codice di recupero (160 bit casuali).
     Cambiare password non riscrive i dati: si richiude solo la chiave.
   - In memoria la chiave dei dati non è esportabile; la si riapre esportabile solo
     per cambiare password o codice di recupero, e solo dopo aver chiesto la password. */

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITER = 600000;
const RC_ITER = 100000;
const AAD = enc.encode('rh-finance/vault/v1');
const FORMAT = 'rh-finance-vault';

export class WrongSecret extends Error { constructor() { super('Password o codice non corretti'); this.name = 'WrongSecret'; } }
export class BadVault extends Error { constructor(m = 'File non valido') { super(m); this.name = 'BadVault'; } }

export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new BadVault();
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
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

async function kekFrom(secret, salt, iter) {
  const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function wrap(dekX, kek) {
  const iv = randomBytes(12);
  const ct = await subtle().wrapKey('raw', dekX, kek, { name: 'AES-GCM', iv, additionalData: AAD });
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
async function unwrap(w, kek, extractable) {
  try {
    return await subtle().unwrapKey('raw', unb64(w.ct), kek, { name: 'AES-GCM', iv: unb64(w.iv), additionalData: AAD },
      { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  } catch (e) {
    if (e instanceof BadVault) throw e;
    throw new WrongSecret();
  }
}

/* ─── Compressione (se il browser la offre) ─── */
async function pipe(bytes, Stream) {
  const s = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function sealData(dek, obj) {
  let bytes = enc.encode(JSON.stringify(obj));
  let z = 0;
  if (canZip()) { bytes = await pipe(bytes, CompressionStream); z = 1; }
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, dek, bytes);
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)), z };
}
async function openData(dek, data) {
  let bytes;
  try {
    bytes = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(data.iv), additionalData: AAD }, dek, unb64(data.ct)));
  } catch (e) {
    if (e instanceof BadVault) throw e;
    throw new BadVault('I dati non si aprono: file danneggiato o chiave diversa');
  }
  if (data.z) {
    if (!canZip()) throw new BadVault('Questo browser è troppo vecchio per aprire i dati');
    bytes = await pipe(bytes, DecompressionStream);
  }
  return JSON.parse(dec.decode(bytes));
}

/** Controlla la forma di una cassaforte letta da disco o da un file. */
export function checkVault(v) {
  const isStr = x => typeof x === 'string' && x.length > 0 && x.length < 64e6;
  const isW = w => w && isStr(w.iv) && isStr(w.ct);
  if (!v || typeof v !== 'object' || v.format !== FORMAT || v.v !== 1) throw new BadVault();
  if (!v.kdf || !isStr(v.kdf.salt) || !Number.isInteger(v.kdf.iter) || v.kdf.iter < 100000 || v.kdf.iter > 10000000) throw new BadVault();
  if (!v.keys || !isW(v.keys.pw) || !isW(v.data)) throw new BadVault();
  if (v.keys.rc && (!isW(v.keys.rc) || !isStr(v.keys.rc.salt))) throw new BadVault();
  return v;
}

/** Nuova cassaforte: restituisce la cassaforte, la chiave in memoria e il codice di recupero da mostrare una volta. */
export async function createVault(password, state, iter = PBKDF2_ITER) {
  const dekX = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = randomBytes(16), rcSalt = randomBytes(16);
  const recoveryCode = makeRecoveryCode();
  const [pwKek, rcKek] = await Promise.all([kekFrom(normPw(password), salt, iter), kekFrom(normalizeRecoveryCode(recoveryCode), rcSalt, RC_ITER)]);
  const vault = {
    format: FORMAT, v: 1,
    kdf: { alg: 'PBKDF2-SHA256', iter, salt: b64(salt) },
    keys: { pw: await wrap(dekX, pwKek), rc: { ...(await wrap(dekX, rcKek)), salt: b64(rcSalt), iter: RC_ITER } },
    data: await sealData(dekX, state),
    created: Date.now(), updated: Date.now(), rev: 1,
  };
  // in memoria teniamo una copia non esportabile della chiave
  const dek = await unwrap(vault.keys.pw, pwKek, false);
  return { vault, dek, recoveryCode };
}

export async function unlockWithPassword(vault, password, extractable = false) {
  checkVault(vault);
  const kek = await kekFrom(normPw(password), unb64(vault.kdf.salt), vault.kdf.iter);
  return unwrap(vault.keys.pw, kek, extractable);
}

export async function unlockWithRecovery(vault, code, extractable = false) {
  checkVault(vault);
  if (!vault.keys.rc) throw new WrongSecret();
  const kek = await kekFrom(normalizeRecoveryCode(code), unb64(vault.keys.rc.salt), vault.keys.rc.iter || RC_ITER);
  return unwrap(vault.keys.rc, kek, extractable);
}

export async function decryptState(vault, dek) {
  checkVault(vault);
  return openData(dek, vault.data);
}

/** Nuova versione della cassaforte con i dati aggiornati (le chiavi restano le stesse). */
export async function encryptState(vault, dek, state) {
  return { ...vault, data: await sealData(dek, state), updated: Date.now(), rev: (vault.rev || 0) + 1 };
}

/** Cambia la password (serve la chiave esportabile, ottenuta con la password attuale o il codice di recupero). */
export async function rewrapPassword(vault, dekX, newPassword, iter = PBKDF2_ITER) {
  const salt = randomBytes(16);
  const kek = await kekFrom(normPw(newPassword), salt, iter);
  return { ...vault, kdf: { alg: 'PBKDF2-SHA256', iter, salt: b64(salt) }, keys: { ...vault.keys, pw: await wrap(dekX, kek) }, updated: Date.now() };
}

/** Nuovo codice di recupero (il vecchio smette di funzionare). */
export async function rewrapRecovery(vault, dekX) {
  const code = makeRecoveryCode();
  const salt = randomBytes(16);
  const kek = await kekFrom(normalizeRecoveryCode(code), salt, RC_ITER);
  return { vault: { ...vault, keys: { ...vault.keys, rc: { ...(await wrap(dekX, kek)), salt: b64(salt), iter: RC_ITER } }, updated: Date.now() }, code };
}

/** Chiave non esportabile a partire da quella esportabile (dopo un cambio). */
export async function lockKey(dekX) {
  const raw = await subtle().exportKey('raw', dekX);
  const k = await subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  new Uint8Array(raw).fill(0);
  return k;
}

/* ─── Robustezza della password (stima semplice, in bit) ─── */
const COMMON = ['password', 'passw0rd', '123456', '12345678', 'qwerty', 'abc123', 'ciao', 'amore', 'juventus', 'milan', 'inter', 'napoli', 'roma', 'lazio', 'admin', 'letmein', 'iloveyou', 'welcome', 'dragon', 'monkey', 'football', 'banca', 'soldi', 'finanza'];
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
  if (words.length >= 4) bits = Math.max(bits, words.length * 11);   // frase di parole: buona e facile da ricordare
  bits = Math.max(0, Math.round(bits));
  const score = bits < 36 ? 1 : bits < 50 ? 2 : bits < 64 ? 3 : 4;
  return { score, bits, label: ['', 'Debole', 'Discreta', 'Buona', 'Ottima'][score] };
}
