/* Testo formattato (descrizioni, contratto, messaggi) come DATI, non come HTML.

   Un documento è una lista di blocchi:
     { t: 'p' | 'h1' | 'h2' | 'quote', a?: 'c'|'r'|'j', c: [pezzi] }
     { t: 'ul' | 'ol', a?, li: [[pezzi], [pezzi], …] }
   Un pezzo è testo con stile, un a-capo o un segnaposto (nel contratto):
     { x: 'testo', b?:1, i?:1, u?:1, s?:1, k?: '#rrggbb', z?: 's'|'l', h?: 'https://…' }
     { br: 1 }
     { f: 'id del campo' | '$label' | … }
   Viene sempre ridisegnato con createElement/textContent: nessun HTML arriva mai dai dati. */

const BLOCKS = new Set(['p', 'h1', 'h2', 'quote', 'ul', 'ol']);
const ALIGN = new Set(['c', 'r', 'j']);
export const COLOR_RE = /^#[0-9a-f]{6}$/i;
const PH_RE = /^(\$[a-zA-Z]{1,20}|[a-z][a-z0-9_]{1,39})$/;
const MAX_BLOCKS = 400, MAX_INLINE = 400, MAX_TEXT = 20000, MAX_LI = 200;

/** Solo link http(s) e mailto; restituisce l'indirizzo pulito oppure ''. */
export function safeHref(u) {
  const s = String(u || '').trim();
  if (!s || s.length > 2000) return '';
  if (/^mailto:[^@\s<>"]+@[^@\s<>"]+$/i.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

function cleanInline(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.br) return { br: 1 };
  let o;
  if (typeof p.f === 'string') {
    if (!PH_RE.test(p.f)) return null;
    o = { f: p.f };
  } else {
    if (typeof p.x !== 'string' || !p.x) return null;
    o = { x: p.x.slice(0, MAX_TEXT) };
  }
  for (const k of ['b', 'i', 'u', 's']) if (p[k]) o[k] = 1;
  if (typeof p.k === 'string' && COLOR_RE.test(p.k)) o.k = p.k.toLowerCase();
  if (p.z === 's' || p.z === 'l') o.z = p.z;
  const h = safeHref(p.h);
  if (h) o.h = h;
  return o;
}
const sameStyle = (a, b) => !a.br && !b.br && a.f === undefined && b.f === undefined &&
  ['b', 'i', 'u', 's', 'k', 'z', 'h'].every(k => (a[k] || '') === (b[k] || ''));

function cleanInlines(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list.slice(0, MAX_INLINE * 2) : []) {
    const p = cleanInline(raw);
    if (!p) continue;
    const last = out[out.length - 1];
    if (last && p.x !== undefined && last.x !== undefined && sameStyle(last, p) && last.x.length + p.x.length <= MAX_TEXT) last.x += p.x;
    else out.push(p);
    if (out.length >= MAX_INLINE) break;
  }
  while (out.length && out[out.length - 1].br) out.pop();
  return out;
}

/** Pulisce un documento (accetta anche una stringa semplice). Non lancia mai errori. */
export function sanitizeRich(doc) {
  if (typeof doc === 'string') return fromPlain(doc);
  if (!Array.isArray(doc)) return [];
  const out = [];
  for (const b of doc.slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== 'object' || !BLOCKS.has(b.t)) continue;
    const o = { t: b.t };
    if (ALIGN.has(b.a)) o.a = b.a;
    if (b.t === 'ul' || b.t === 'ol') {
      o.li = (Array.isArray(b.li) ? b.li.slice(0, MAX_LI) : []).map(cleanInlines).filter(x => x.length);
      if (!o.li.length) continue;
    } else {
      o.c = cleanInlines(b.c);
      if (!o.c.length && b.t !== 'p') continue;
    }
    out.push(o);
  }
  // via i paragrafi vuoti in fondo
  while (out.length && out[out.length - 1].t === 'p' && !out[out.length - 1].c.length) out.pop();
  return out;
}

/** Da testo semplice: righe vuote = nuovo paragrafo, a-capo = a-capo. */
export function fromPlain(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!s) return [];
  return s.split(/\n{2,}/).map(par => {
    const c = [];
    par.split('\n').forEach((line, i) => { if (i) c.push({ br: 1 }); if (line) c.push({ x: line }); });
    return { t: 'p', c };
  });
}

export const isEmptyRich = doc => !sanitizeRich(doc).some(b => (b.c && b.c.some(p => p.f || (p.x && p.x.trim()))) || (b.li && b.li.length));

/** Testo semplice (per email, impronte, ricerca). `values` riempie i segnaposto. */
export function richToText(doc, values = {}) {
  const line = list => list.map(p => p.br ? '\n' : p.f !== undefined ? String(values[p.f] ?? '') : p.x).join('');
  return sanitizeRich(doc).map(b => {
    if (b.li) return b.li.map((it, i) => (b.t === 'ol' ? `${i + 1}. ` : '• ') + line(it)).join('\n');
    return line(b.c);
  }).join('\n\n');
}

/** Segnaposto usati in un documento. */
export function placeholdersIn(doc) {
  const out = new Set();
  for (const b of sanitizeRich(doc)) for (const list of b.li || [b.c]) for (const p of list) if (p.f) out.add(p.f);
  return [...out];
}
