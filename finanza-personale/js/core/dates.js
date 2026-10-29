/* Date come testo "AAAA-MM-GG" nell'ora locale: niente sorprese con i fusi orari
   e il confronto tra date è un semplice confronto tra stringhe. */

const pad = n => String(n).padStart(2, '0');

export const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function today(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) && y >= 1900 && y <= 2200;
}

export function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

export function addDays(iso, n) {
  const { y, m, d } = parts(iso);
  const dt = new Date(y, m - 1, d + n, 12);
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Aggiunge mesi tenendo il giorno "di riferimento" (31 → 30 aprile → 31 maggio). */
export function addMonths(iso, n, anchorDay) {
  const { y, m, d } = parts(iso);
  const day = anchorDay || d;
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total - ny * 12 + 1;
  return toISO(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function diffDays(a, b) {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function diffMonths(a, b) {
  const pa = parts(a), pb = parts(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

export const monthKey = iso => iso.slice(0, 7);
export const monthStart = key => key + '-01';
export function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return toISO(y, m, daysInMonth(y, m));
}
export function addMonthKey(key, n) { return addMonths(key + '-01', n).slice(0, 7); }
export const weekday = iso => { const { y, m, d } = parts(iso); return new Date(y, m - 1, d, 12).getDay(); };

/** Ultimi n mesi fino a quello di `endKey` compreso, dal più vecchio. */
export function lastMonths(n, endKey) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonthKey(endKey, -i));
  return out;
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export const monthName = (m, short = false) => (short ? MESI_BREVI : MESI)[m - 1];

export function formatMonth(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  return short ? `${MESI_BREVI[m - 1]} ${String(y).slice(2)}` : `${MESI[m - 1]} ${y}`;
}

/** "29 ott 2026" · opzioni: {year:false} toglie l'anno se è quello corrente */
export function formatDate(iso, opts = {}) {
  if (!iso) return '';
  const { y, m, d } = parts(iso);
  const long = opts.long;
  const name = long ? MESI[m - 1] : MESI_BREVI[m - 1];
  const showYear = opts.year === true || (opts.year !== false && y !== new Date().getFullYear());
  return `${d} ${name}${showYear ? ' ' + y : ''}`;
}

/** "Oggi", "Ieri", "Domani" o "lunedì 27 ottobre" */
export function formatDay(iso, ref = today()) {
  const dd = diffDays(ref, iso);
  if (dd === 0) return 'Oggi';
  if (dd === -1) return 'Ieri';
  if (dd === 1) return 'Domani';
  const g = GIORNI[weekday(iso)];
  return `${g.charAt(0).toUpperCase() + g.slice(1)} ${formatDate(iso, { long: true })}`;
}

/** Tra quanto: "oggi", "domani", "tra 5 giorni", "3 giorni fa" */
export function relDays(iso, ref = today()) {
  const dd = diffDays(ref, iso);
  if (dd === 0) return 'oggi';
  if (dd === 1) return 'domani';
  if (dd === -1) return 'ieri';
  if (dd > 1) return `tra ${dd} giorni`;
  return `${-dd} giorni fa`;
}

/* ─── Ricorrenze ───────────────────────────────────────────────────────────
   regola = { unit: 'day'|'week'|'month'|'year', every: n, start: ISO, end?: ISO }
   La data k-esima si calcola sempre dall'inizio (mai sommando passo dopo passo),
   così un 31 resta 31 dove esiste e non "scivola" al 28. */
export function nthOccurrence(rule, k) {
  const every = Math.max(1, Math.floor(rule.every || 1));
  switch (rule.unit) {
    case 'day': return addDays(rule.start, k * every);
    case 'week': return addDays(rule.start, k * every * 7);
    case 'year': return addMonths(rule.start, k * every * 12);
    default: return addMonths(rule.start, k * every);
  }
}

/** Indice della prima occorrenza >= iso (ricerca veloce, senza contare tutte le date). */
function firstIndexFrom(rule, iso) {
  if (iso <= rule.start) return 0;
  const every = Math.max(1, Math.floor(rule.every || 1));
  let k;
  if (rule.unit === 'day') k = Math.floor(diffDays(rule.start, iso) / every);
  else if (rule.unit === 'week') k = Math.floor(diffDays(rule.start, iso) / (7 * every));
  else if (rule.unit === 'year') k = Math.floor(diffMonths(rule.start, iso) / (12 * every));
  else k = Math.floor(diffMonths(rule.start, iso) / every);
  k = Math.max(0, k - 1);
  while (nthOccurrence(rule, k) < iso) k++;
  return k;
}

/** Tutte le date della regola tra from e to (compresi), al massimo `limit`. */
export function occurrences(rule, from, to, limit = 500) {
  const out = [];
  if (!isISODate(rule.start)) return out;
  let k = firstIndexFrom(rule, from);
  for (; out.length < limit; k++) {
    const d = nthOccurrence(rule, k);
    if (d > to || (rule.end && d > rule.end)) break;
    out.push(d);
  }
  return out;
}

/** Prima data della regola >= iso (o null se la regola è finita). */
export function nextOccurrence(rule, iso) {
  if (!isISODate(rule.start)) return null;
  const d = nthOccurrence(rule, firstIndexFrom(rule, iso));
  if (rule.end && d > rule.end) return null;
  return d;
}

/** Quante volte all'anno (per stimare il costo mensile/annuale di un abbonamento). */
export function perYear(rule) {
  const every = Math.max(1, rule.every || 1);
  switch (rule.unit) {
    case 'day': return 365 / every;
    case 'week': return 52.1775 / every;
    case 'year': return 1 / every;
    default: return 12 / every;
  }
}

export function describeRule(rule) {
  const e = Math.max(1, rule.every || 1);
  const map = {
    day: ['Ogni giorno', `Ogni ${e} giorni`],
    week: ['Ogni settimana', e === 2 ? 'Ogni 2 settimane' : `Ogni ${e} settimane`],
    month: ['Ogni mese', ({ 2: 'Ogni 2 mesi', 3: 'Ogni 3 mesi', 4: 'Ogni 4 mesi', 6: 'Ogni 6 mesi' })[e] || `Ogni ${e} mesi`],
    year: ['Ogni anno', `Ogni ${e} anni`],
  };
  const r = map[rule.unit] || map.month;
  return e === 1 ? r[0] : r[1];
}

/* ─── Lettura delle date dai file della banca ─── */
export function parseDateFlexible(s, order = 'dmy') {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '').replace(/T.*$/, '');
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) { const iso = toISO(+m[1], +m[2], +m[3]); return isISODate(iso) ? iso : null; }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    const iso = toISO(y, mo, d);
    return isISODate(iso) ? iso : null;
  }
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) { const iso = toISO(+m[1], +m[2], +m[3]); return isISODate(iso) ? iso : null; }
  // "12 ott 2026" / "12 ottobre 2026"
  m = t.toLowerCase().match(/^(\d{1,2})\s+([a-zà]+)\.?\s+(\d{4})$/);
  if (m) {
    const idx = MESI.findIndex(n => n.startsWith(m[2].slice(0, 3)));
    if (idx >= 0) { const iso = toISO(+m[3], idx + 1, +m[1]); return isISODate(iso) ? iso : null; }
  }
  return null;
}
