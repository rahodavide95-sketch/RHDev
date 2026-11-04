// Fioritura: notifiche push dei promemoria del calendario, anche ad app chiusa.
//
// - POST (da pg_cron ogni minuto, con l'intestazione x-cron-secret): manda i promemoria scattati negli ultimi
//   10 minuti e non ancora mandati a tutti i telefoni iscritti di quell'account. Ogni promemoria parte una volta
//   sola (tabella fioritura_push_sent); un telefono che non esiste più (risposta 404/410) viene tolto.
// - GET ?key=1: la chiave pubblica VAPID che l'app usa per iscrivere il telefono.
//
// Niente librerie: firma VAPID (ES256, RFC 8292) e cifratura del messaggio (aes128gcm, RFC 8291) con WebCrypto.
// I promemoria stanno negli impegni del calendario (fioritura.data -> events): ogni impegno ha remTs, l'ora del
// promemoria in millisecondi già calcolata dall'app (-1 = nessun promemoria), e tz, il fuso del telefono.
// Promemoria dello studio: se data -> settings ha studyRemind, ogni giorno all'ora studyTime (nel fuso settings.tz) parte
// "È l'ora di studiare" con le giornate di oggi non ancora fatte (data -> exams, data -> done). Nessuna giornata da fare: niente avviso.
// Segreti della funzione (li mette il workflow .github/workflows/fioritura-push.yml): FIORITURA_VAPID_JWK, FIORITURA_CRON_SECRET.

const SUBJECT = 'https://rahodavide95-sketch.github.io/RHDev/fioritura/';
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ---------------- configurazione (dalle variabili della funzione; nei test si passa a mano) ----------------
type Jwk = { kty?: string; crv?: string; d: string; x: string; y: string };
type Config = { url: string; service: string; jwk: Jwk | null; cron: string };
const denoEnv = (k: string): string => {
  const D = (globalThis as any).Deno;
  return D && D.env ? D.env.get(k) || '' : '';
};
function readJwk(raw: string): Jwk | null {
  try { const j = JSON.parse(raw); return j && j.d && j.x && j.y ? j : null; } catch (_e) { return null; }
}
let CFG: Config = {
  url: denoEnv('SUPABASE_URL'),
  service: denoEnv('SUPABASE_SERVICE_ROLE_KEY'),
  jwk: readJwk(denoEnv('FIORITURA_VAPID_JWK')),
  cron: denoEnv('FIORITURA_CRON_SECRET'),
};
export function setConfig(c: Partial<Config>) { CFG = Object.assign({}, CFG, c); }

// ---------------- byte e base64url ----------------
const enc = new TextEncoder();
export function b64u(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// ---------------- cifratura del messaggio: aes128gcm (RFC 8291) ----------------
export async function encryptPayload(plain: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, as.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, Uint8Array.of(1)));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plain, Uint8Array.of(2))));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, Uint8Array.of(asPublic.length), asPublic, ct);
}

// ---------------- firma VAPID (RFC 8292) ----------------
export function publicKeyOf(jwk: Jwk): Uint8Array { return concat(Uint8Array.of(4), unb64u(jwk.x), unb64u(jwk.y)); }
export async function vapidAuthorization(endpoint: string, jwk: Jwk, nowSec?: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const exp = (nowSec || Math.floor(Date.now() / 1000)) + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + b64u(publicKeyOf(jwk));
}
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: unknown, jwk: Jwk): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), unb64u(sub.p256dh), unb64u(sub.auth));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, jwk),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  });
  try { await r.arrayBuffer(); } catch (_e) { /* niente */ }
  return r.status;
}

// ---------------- testo della notifica ----------------
function dayInTz(ms: number, tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
  catch (_e) { return new Date(ms).toISOString().slice(0, 10); }
}
function plusDay(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// giorno (AAAA-MM-GG) e minuti dalla mezzanotte nel fuso dato
export function clockInTz(ms: number, tz: string): { date: string; min: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms));
    const g = (t: string) => (parts.find((p) => p.type === t) || { value: '0' }).value;
    return { date: g('year') + '-' + g('month') + '-' + g('day'), min: (+g('hour') % 24) * 60 + (+g('minute')) };
  } catch (_e) {
    const d = new Date(ms);
    return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
}
// le giornate di oggi non ancora fatte, in tutti gli esami, come le scrive l'app ("Esame: V2 · pp. 91–105")
export function studyTodo(exams: any, done: any, date: string): string[] {
  const out: string[] = [];
  for (const e of (Array.isArray(exams) ? exams : [])) {
    if (!e || !e.id || (done && +done[e.id + '|' + date] > 0)) continue;
    let row: any = null;
    for (const p of (Array.isArray(e.phases) ? e.phases : [])) for (const r of (Array.isArray(p.days) ? p.days : [])) if (r && r[0] === date) row = r;
    if (!row) continue;
    const o = row[2] || {}, books = Array.isArray(e.books) ? e.books : [];
    let label: string;
    if (o.critici) label = 'Solo argomenti critici';
    else {
      const parts = (Array.isArray(row[1]) ? row[1] : []).map((x: any) => ((books[x[0] - 1] && String(books[x[0] - 1]).trim()) || 'V' + x[0]) + ' · pp. ' + x[1] + '–' + x[2]);
      if (o.extra) parts.push(String(o.extra));
      label = parts.join(' + ') || 'Ripasso libero';
    }
    out.push(String(e.name || 'Studio') + ': ' + label);
  }
  return out;
}
// il promemoria dello studio di questo account, se è il momento (finestra di 10 minuti dopo l'ora scelta)
export function studyDue(row: any, nowMs: number): { key: string; date: string; body: string } | null {
  const st = row && row.settings;
  if (!st || !st.studyRemind || !/^\d\d:\d\d$/.test(String(st.studyTime || ''))) return null;
  const at = String(st.studyTime).split(':'), want = (+at[0]) * 60 + (+at[1]);
  const c = clockInTz(nowMs, st.tz || 'Europe/Rome');
  if (c.min < want || c.min >= want + 10) return null;
  const todo = studyTodo(row.exams, row.done, c.date);
  if (!todo.length) return null;
  return { key: 'study@' + c.date, date: c.date, body: todo.join('; ').slice(0, 300) };
}
export function whenText(e: any, nowMs: number): string {
  const today = dayInTz(nowMs, e.tz || 'Europe/Rome');
  let day: string;
  if (e.date === today) day = 'Oggi';
  else if (e.date === plusDay(today, 1)) day = 'Domani';
  else if (e.date === plusDay(today, 2)) day = 'Dopodomani';
  else { const p = String(e.date).split('-'); day = (+p[2]) + ' ' + MONTHS[(+p[1]) - 1]; }
  return day + (e.time ? ' alle ' + e.time : '');
}

// ---------------- il giro di ogni minuto ----------------
async function rest(path: string, opts: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
  const headers: Record<string, string> = { apikey: CFG.service, Authorization: 'Bearer ' + CFG.service, 'Content-Type': 'application/json' };
  if (opts.prefer) headers.Prefer = opts.prefer;
  const r = await fetch(CFG.url + '/rest/v1' + path, { method: opts.method || 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const txt = await r.text();
  if (!r.ok) throw new Error('REST ' + r.status + ' ' + path.split('?')[0] + ': ' + txt.slice(0, 200));
  return txt ? JSON.parse(txt) : null;
}
export async function run(nowMs?: number): Promise<{ due: number; sent: number; gone: number }> {
  const now = nowMs || Date.now(), from = now - 10 * 60000;
  if (!CFG.jwk) throw new Error('mancano le chiavi VAPID');
  const rows: any[] = await rest('/fioritura?select=user_id,events:data->events,settings:data->settings,exams:data->exams,done:data->done') || [];
  const due: any[] = [];
  for (const row of rows) {
    for (const e of (Array.isArray(row.events) ? row.events : [])) {
      const ts = +e.remTs || 0;
      if (e && e.id && ts > from && ts <= now) due.push({ user: row.user_id, key: e.id + '@' + ts, e });
    }
    const sd = studyDue(row, now);
    if (sd) due.push({ user: row.user_id, key: sd.key, study: sd });
  }
  if (!due.length) return { due: 0, sent: 0, gone: 0 };
  // ogni promemoria una volta sola: tornano solo le righe nuove
  const fresh: any[] = await rest('/fioritura_push_sent?on_conflict=user_id,key', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: due.map((d) => ({ user_id: d.user, key: d.key })),
  }) || [];
  const isNew = new Set(fresh.map((r) => r.user_id + '|' + r.key));
  const todo = due.filter((d) => isNew.has(d.user + '|' + d.key));
  if (!todo.length) return { due: due.length, sent: 0, gone: 0 };
  const users = Array.from(new Set(todo.map((d) => d.user)));
  const subs: any[] = await rest('/fioritura_push?select=endpoint,p256dh,auth,user_id&user_id=in.(' + users.join(',') + ')') || [];
  let sent = 0, gone = 0;
  for (const d of todo) {
    let payload: any;
    if (d.study) payload = { title: 'È l’ora di studiare', body: d.study.body, tag: d.key, tab: 'today' };
    else {
      const note = d.e.note ? ' · ' + String(d.e.note).slice(0, 120) : '';
      payload = { title: String(d.e.title || 'Promemoria').slice(0, 120), body: whenText(d.e, now) + note, tag: d.key, date: d.e.date };
    }
    for (const s of subs.filter((x) => x.user_id === d.user)) {
      try {
        const status = await sendPush(s, payload, CFG.jwk);
        if (status === 404 || status === 410) {
          await rest('/fioritura_push?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' });
          gone++;
        } else if (status >= 200 && status < 300) sent++;
        else console.log('push', status, new URL(s.endpoint).host);
      } catch (err) { console.log('push errore', String(err)); }
    }
  }
  // pulizia ogni tanto: i promemoria mandati da più di 3 giorni non servono più
  if (new Date(now).getUTCMinutes() === 0) {
    try { await rest('/fioritura_push_sent?sent_at=lt.' + encodeURIComponent(new Date(now - 3 * 864e5).toISOString()), { method: 'DELETE' }); } catch (_e) { /* niente */ }
  }
  return { due: due.length, sent, gone };
}

// ---------------- la funzione ----------------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}
const D = (globalThis as any).Deno;
if (D && D.serve) {
  D.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.has('key')) {
      if (!CFG.jwk) return json({ error: 'chiavi VAPID mancanti' }, 500);
      return json({ publicKey: b64u(publicKeyOf(CFG.jwk)) });
    }
    if (req.method === 'POST') {
      if (!CFG.cron || req.headers.get('x-cron-secret') !== CFG.cron) return json({ error: 'non autorizzato' }, 403);
      try { return json(await run()); } catch (err) { return json({ error: String(err) }, 500); }
    }
    return json({ ok: true });
  });
}
