/* ============================================================================
   model.js — forma dei dati e loro validazione (funzioni pure, testate)
   Ogni dato che entra (import di un file, cloud, viaggio condiviso) passa da
   sanitizeTrip/sanitizeProfile: lunghezze limitate, tipi corretti, niente sorprese.
   ============================================================================ */

export const LIMITS = { title: 120, notes: 4000, name: 120, stops: 300, flights: 300, airline: 60, num: 12, marks: 300 };
export const EMOJIS = ['✈️', '🏖️', '🏔️', '🏙️', '🎒', '🚗', '🚆', '⛵', '🎄', '🍜', '🏛️', '🌋', '🏝️', '❄️', '🎡', '🗽', '🕌', '🏯', '🌴', '🍷', '🎿', '🐘', '🌸', '💼'];
// toni gioiello morbidi, in armonia con i colori dei continenti
export const COLORS = ['#7B8CF2', '#5CC4D6', '#5DC48E', '#EFAE5F', '#EE8296', '#A792F0', '#3B8BF6', '#F2C97D'];

const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const cc = v => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : '');
const iata = v => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : '');
const id = v => (typeof v === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(v) ? v : '');
const ll = v => (Array.isArray(v) && num(v[0], -90, 90) !== null && num(v[1], -180, 180) !== null ? [+v[0], +v[1]] : null);
const color = v => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : COLORS[0]);
const isoTime = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date().toISOString());

let seq = 0;
const genId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${(seq++).toString(36)}`);

export function sanitizeStop(s) {
  if (!s || typeof s !== 'object') return null;
  const lat = num(s.lat, -90, 90), lng = num(s.lng, -180, 180);
  if (lat === null || lng === null) return null;
  return {
    id: id(s.id) || genId(),
    name: str(s.name, LIMITS.name) || 'Luogo',
    cc: cc(s.cc),
    region: str(s.region, LIMITS.name),
    regionKey: str(s.regionKey, LIMITS.name + 3),
    lat, lng,
    date: day(s.date),
    nights: num(s.nights, 0, 999) ?? 0,
    kind: s.kind === 'country' || s.kind === 'custom' ? s.kind : 'city',
  };
}

export function sanitizeFlight(f) {
  if (!f || typeof f !== 'object') return null;
  const from = iata(f.from), to = iata(f.to);
  const fromLL = ll(f.fromLL), toLL = ll(f.toLL);
  if (!from || !to || !fromLL || !toLL) return null;
  return {
    id: id(f.id) || genId(),
    from, to, fromLL, toLL,
    fromCity: str(f.fromCity, LIMITS.name), toCity: str(f.toCity, LIMITS.name),
    fromCc: cc(f.fromCc), toCc: cc(f.toCc),
    date: day(f.date),
    airline: str(f.airline, LIMITS.airline),
    num: str(f.num, LIMITS.num).toUpperCase(),
    km: num(f.km, 0, 25000) ?? 0,
  };
}

export function sanitizeTrip(t) {
  if (!t || typeof t !== 'object') return null;
  const tripId = id(t.id);
  if (!tripId) return null;
  let start = day(t.start), end = day(t.end);
  if (start && end && end < start) [start, end] = [end, start];
  return {
    id: tripId,
    title: str(t.title, LIMITS.title).trim() || 'Viaggio senza nome',
    emoji: EMOJIS.includes(t.emoji) ? t.emoji : '✈️',
    color: color(t.color),
    start, end,
    notes: str(t.notes, LIMITS.notes),
    stops: (Array.isArray(t.stops) ? t.stops : []).slice(0, LIMITS.stops).map(sanitizeStop).filter(Boolean),
    flights: (Array.isArray(t.flights) ? t.flights : []).slice(0, LIMITS.flights).map(sanitizeFlight).filter(Boolean),
    createdAt: isoTime(t.createdAt),
    updatedAt: isoTime(t.updatedAt),
    synced: !!t.synced,
    // versione del cloud su cui si basa la copia locale (serve a riconoscere modifiche concorrenti)
    base: typeof t.base === 'string' && !Number.isNaN(Date.parse(t.base)) ? t.base : '',
  };
}

export function sanitizeHome(h) {
  if (!h || typeof h !== 'object') return null;
  const lat = num(h.lat, -90, 90), lng = num(h.lng, -180, 180);
  if (lat === null || lng === null) return null;
  return { name: str(h.name, LIMITS.name), cc: cc(h.cc), region: str(h.region, LIMITS.name), regionKey: str(h.regionKey, LIMITS.name + 3), lat, lng };
}

const codes = v => [...new Set((Array.isArray(v) ? v : []).filter(x => cc(x)))].slice(0, LIMITS.marks);
const ids = v => [...new Set((Array.isArray(v) ? v : []).filter(x => id(x)))].slice(0, 2000);

export function sanitizeProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  return {
    name: str(p.name, 80).trim(),
    home: sanitizeHome(p.home),
    nat: cc(p.nat),
    countHome: p.countHome !== false,
    colorMode: ['continent', 'mono', 'visits', 'year'].includes(p.colorMode) ? p.colorMode : 'continent',
    excludeShared: ids(p.excludeShared),
  };
}

export function sanitizeMarks(m) {
  m = m && typeof m === 'object' ? m : {};
  const visited = codes(m.visited);
  return { visited, wish: codes(m.wish).filter(c => !visited.includes(c)) };
}

// Stato di un viaggio rispetto a oggi: 'upcoming' | 'ongoing' | 'past'
export function tripStatus(t, today) {
  if (!t.start) return 'past';
  if (t.start > today) return 'upcoming';
  const end = t.end || t.start;
  return end >= today ? 'ongoing' : 'past';
}

// Conversione da/verso la riga del database (tabella orb_trips)
export function tripToRow(t) {
  return {
    id: t.id,
    title: t.title,
    start_date: t.start || null,
    end_date: t.end || null,
    data: { v: 1, emoji: t.emoji, color: t.color, notes: t.notes, stops: t.stops, flights: t.flights },
  };
}
export function rowToTrip(r) {
  const d = r && r.data && typeof r.data === 'object' ? r.data : {};
  return sanitizeTrip({
    id: r.id, title: r.title, start: r.start_date || '', end: r.end_date || '',
    emoji: d.emoji, color: d.color, notes: d.notes, stops: d.stops, flights: d.flights,
    createdAt: r.created_at, updatedAt: r.updated_at, synced: true, base: r.updated_at,
  });
}
