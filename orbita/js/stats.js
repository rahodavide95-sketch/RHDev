/* ============================================================================
   stats.js — tutte le statistiche del passaporto (funzioni pure, testate)
   Conta solo ciò che è già successo: viaggi futuri e tappe con data futura
   restano "in programma" e non entrano nei numeri.
   ============================================================================ */
import { tripStatus } from './model.js';

const EARTH_KM = 40075;
const MOON_KM = 384400;
const R = 6371.0088;
export function distKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const LEVELS = [
  { min: 0, name: 'Sognatore', emoji: '💭' },
  { min: 1, name: 'Turista', emoji: '🎒' },
  { min: 5, name: 'Esploratore', emoji: '🧭' },
  { min: 10, name: 'Viaggiatore', emoji: '✈️' },
  { min: 25, name: 'Globetrotter', emoji: '🌍' },
  { min: 50, name: 'Giramondo', emoji: '🚀' },
  { min: 100, name: 'Leggenda', emoji: '👑' },
];
export function levelFor(n) {
  let i = 0;
  while (i + 1 < LEVELS.length && n >= LEVELS[i + 1].min) i++;
  const next = LEVELS[i + 1] || null;
  const cur = LEVELS[i];
  return { ...cur, index: i, next, progress: next ? (n - cur.min) / (next.min - cur.min) : 1 };
}

const flightKm = f => (f.km > 0 ? f.km : distKm(f.fromLL, f.toLL));

/**
 * @param {object} p
 * @param {Array}  p.trips      viaggi (propri + condivisi che contano)
 * @param {object} p.marks      { visited: [cc], wish: [cc] }
 * @param {object} p.profile    { home, countHome }
 * @param {Map}    p.countries  cc → { c, n, k, s }
 * @param {string} p.today      'AAAA-MM-GG'
 */
export function computeStats({ trips = [], marks = { visited: [], wish: [] }, profile = {}, countries = new Map(), today }) {
  const visits = new Map();     // cc → { trips:Set, first, last, cities:Set }
  const cities = new Map();     // chiave → { name, cc, lat, lng, count }
  const regions = new Map();    // "IT|Lazio" → { cc, name }
  const airports = new Map();   // IATA → conteggio
  const airlines = new Map();
  const perYear = new Map();    // anno → { trips, countries:Set, km, flights }
  const flights = [];
  const stops = [];
  let km = 0, days = 0, nights = 0, pastTrips = 0;
  const upcoming = [];
  let ongoing = null;

  const touchCountry = (code, tripId, date) => {
    if (!code) return;
    if (!visits.has(code)) visits.set(code, { trips: new Set(), first: '', last: '', cities: new Set() });
    const v = visits.get(code);
    if (tripId) v.trips.add(tripId);
    if (date) { if (!v.first || date < v.first) v.first = date; if (!v.last || date > v.last) v.last = date; }
    return v;
  };
  const yearOf = (t, d) => (d || t.start || '').slice(0, 4) || null;
  const yearRec = y => { if (!perYear.has(y)) perYear.set(y, { trips: 0, countries: new Set(), km: 0, flights: 0 }); return perYear.get(y); };

  for (const t of trips) {
    const status = tripStatus(t, today);
    if (status === 'upcoming') { upcoming.push(t); continue; }
    if (status === 'ongoing' && (!ongoing || t.start > ongoing.start)) ongoing = t;
    pastTrips++;
    const y = yearOf(t);
    if (y) yearRec(y).trips++;
    if (t.start) {
      const end = t.end && t.end < today ? t.end : (t.end ? today : t.start);
      const d = Math.max(1, dayNum(end) - dayNum(t.start) + 1);
      days += d;
      const n = t.stops.reduce((a, s) => a + (s.nights || 0), 0);
      nights += n || Math.max(0, d - 1);
    } else {
      nights += t.stops.reduce((a, s) => a + (s.nights || 0), 0);
    }
    for (const s of t.stops) {
      if (s.date && s.date > today) continue;
      const date = s.date || t.start || '';
      const v = touchCountry(s.cc, t.id, date);
      const sy = yearOf(t, s.date);
      if (sy && s.cc) yearRec(sy).countries.add(s.cc);
      stops.push({ ...s, tripId: t.id, date });
      if (s.kind !== 'country') {
        const key = (s.cc || '') + '|' + normName(s.name);
        const c = cities.get(key);
        if (c) c.count++; else cities.set(key, { name: s.name, cc: s.cc, lat: s.lat, lng: s.lng, count: 1, first: date });
        if (v) v.cities.add(key);
      }
      if (s.regionKey) regions.set(s.regionKey, { cc: s.cc, name: s.region || s.regionKey.split('|')[1] });
    }
    for (const f of t.flights) {
      if (f.date && f.date > today) continue;
      const d = flightKm(f);
      km += d;
      flights.push({ ...f, km: d, tripId: t.id, date: f.date || t.start || '' });
      airports.set(f.from, (airports.get(f.from) || 0) + 1);
      airports.set(f.to, (airports.get(f.to) || 0) + 1);
      if (f.airline) airlines.set(f.airline, (airlines.get(f.airline) || 0) + 1);
      const fy = yearOf(t, f.date);
      if (fy) { const r = yearRec(fy); r.km += d; r.flights++; }
    }
  }

  // Paesi segnati a mano e paese di casa
  const marked = new Set(marks.visited || []);
  for (const code of marked) touchCountry(code, null, '');
  if (profile.countHome !== false && profile.home && profile.home.cc) touchCountry(profile.home.cc, null, '');

  const visited = new Set(visits.keys());
  const sovereign = [...visited].filter(c => countries.get(c)?.s);
  const territories = [...visited].filter(c => countries.has(c) && !countries.get(c).s);
  const continents = new Set([...visited].map(c => countries.get(c)?.k).filter(Boolean));

  const perContinent = {};
  for (const c of countries.values()) {
    if (!perContinent[c.k]) perContinent[c.k] = { visited: 0, total: 0, list: [] };
    if (c.s) perContinent[c.k].total++;
    if (visited.has(c.c)) { if (c.s) perContinent[c.k].visited++; perContinent[c.k].list.push(c.c); }
  }

  // Record
  let longest = null, shortest = null;
  for (const f of flights) {
    if (!longest || f.km > longest.km) longest = f;
    if (!shortest || f.km < shortest.km) shortest = f;
  }
  const ext = { north: null, south: null, east: null, west: null, farthest: null };
  for (const s of stops) {
    if (!ext.north || s.lat > ext.north.lat) ext.north = s;
    if (!ext.south || s.lat < ext.south.lat) ext.south = s;
    if (!ext.east || s.lng > ext.east.lng) ext.east = s;
    if (!ext.west || s.lng < ext.west.lng) ext.west = s;
    if (profile.home) {
      const d = distKm([profile.home.lat, profile.home.lng], [s.lat, s.lng]);
      if (!ext.farthest || d > ext.farthest.km) ext.farthest = { ...s, km: d };
    }
  }
  const top = m => { let best = null; for (const [k, v] of m) if (!best || v > best[1]) best = [k, v]; return best; };
  const topCountry = [...visits].filter(([, v]) => v.trips.size).sort((a, b) => b[1].trips.size - a[1].trips.size)[0] || null;

  upcoming.sort((a, b) => a.start.localeCompare(b.start));
  const next = upcoming[0] || null;

  const years = [...perYear].map(([y, r]) => ({ year: y, trips: r.trips, countries: r.countries.size, km: r.km, flights: r.flights })).sort((a, b) => a.year.localeCompare(b.year));
  const bestYear = years.reduce((b, y) => (!b || y.countries > b.countries ? y : b), null);

  const itRegions = [...regions.keys()].filter(k => k.startsWith('IT|')).length;
  const usStates = [...regions.keys()].filter(k => k.startsWith('US|')).length;
  const hemis = { n: stops.some(s => s.lat > 0), s: stops.some(s => s.lat < 0), e: stops.some(s => s.lng > 0), w: stops.some(s => s.lng < 0) };
  const euTotal = perContinent.EU ? perContinent.EU.total : 44;

  const out = {
    visited, sovereignCount: sovereign.length, territoryCount: territories.length,
    sovereignTotal: [...countries.values()].filter(c => c.s).length || 195,
    continents, perContinent, visits,
    cities: [...cities.values()], cityCount: cities.size,
    regions: [...regions.values()], regionCount: regions.size, itRegions, usStates,
    airports: [...airports].sort((a, b) => b[1] - a[1]), airportCount: airports.size,
    flights, flightCount: flights.length, km, hours: flights.reduce((a, f) => a + f.km / 800 + 0.5, 0),
    earthLaps: km / EARTH_KM, moonPct: km / MOON_KM * 100,
    tripCount: pastTrips, upcoming, next, ongoing, days, nights,
    years, bestYear, longest, shortest, ext,
    topAirport: top(airports), topAirline: top(airlines),
    topCountry: topCountry ? { cc: topCountry[0], trips: topCountry[1].trips.size } : null,
    wish: new Set((marks.wish || []).filter(c => !visited.has(c))),
    stops, hemis,
  };
  out.level = levelFor(out.sovereignCount);
  out.worldPct = out.sovereignTotal ? out.sovereignCount / out.sovereignTotal * 100 : 0;
  out.badges = badges(out, euTotal);
  return out;
}

function badges(s, euTotal) {
  const B = (id, emoji, title, desc, value, goal) => ({ id, emoji, title, desc, value: Math.min(value, goal), goal, done: value >= goal, progress: Math.min(1, goal ? value / goal : 0) });
  const longHaul = s.flights.filter(f => f.km >= 8000).length;
  const arctic = s.stops.some(x => x.lat >= 66.56) ? 1 : 0;
  const south = s.stops.some(x => x.lat <= -66.56) || s.continents.has('AN') ? 1 : 0;
  const quadrants = ['n', 's', 'e', 'w'].filter(k => s.hemis[k]).length;
  const euVisited = s.perContinent.EU ? s.perContinent.EU.visited : 0;
  return [
    B('first', '🎫', 'Primo timbro', 'Registra il tuo primo viaggio', s.tripCount, 1),
    B('c5', '🧭', 'Esploratore', 'Visita 5 paesi', s.sovereignCount, 5),
    B('c10', '✈️', 'Viaggiatore', 'Visita 10 paesi', s.sovereignCount, 10),
    B('c25', '🌍', 'Globetrotter', 'Visita 25 paesi', s.sovereignCount, 25),
    B('c50', '🚀', 'Giramondo', 'Visita 50 paesi', s.sovereignCount, 50),
    B('c100', '👑', 'Leggenda', 'Visita 100 paesi', s.sovereignCount, 100),
    B('k3', '🗺️', 'Tre continenti', 'Metti piede in 3 continenti', s.continents.size, 3),
    B('k6', '🌐', 'Sei continenti', 'Tutti i continenti abitati', [...s.continents].filter(k => k !== 'AN').length, 6),
    B('k7', '🐧', 'Fino in fondo', 'Tutti e 7 i continenti, Antartide compresa', s.continents.size, 7),
    B('f10', '🛫', 'Frequent flyer', 'Fai 10 voli', s.flightCount, 10),
    B('f50', '🛩️', 'Signore dei cieli', 'Fai 50 voli', s.flightCount, 50),
    B('lh', '🌙', 'Lungo raggio', 'Un volo di oltre 8.000 km', longHaul, 1),
    B('earth', '🌎', 'Giro del mondo', 'Vola quanto la circonferenza terrestre (40.075 km)', Math.round(s.km), 40075),
    B('moon', '🌕', 'Fino alla Luna', 'Vola 384.400 km', Math.round(s.km), 384400),
    B('ap25', '🛬', 'Collezionista di aeroporti', 'Passa da 25 aeroporti', s.airportCount, 25),
    B('city50', '🏙️', 'Cittadino del mondo', 'Visita 50 città', s.cityCount, 50),
    B('reg10', '📍', 'Cacciatore di regioni', 'Visita 10 regioni o stati', s.regionCount, 10),
    B('italia', '🇮🇹', "Giro d'Italia", 'Tutte le 20 regioni italiane', s.itRegions, 20),
    B('usa', '🇺🇸', 'American dream', 'Tutti i 50 stati USA (+ DC)', s.usStates, 51),
    B('europa', '🇪🇺', 'Europa completa', 'Tutti i paesi europei', euVisited, euTotal),
    B('arctic', '❄️', 'Circolo polare', 'Una tappa oltre il Circolo polare artico', arctic, 1),
    B('south', '🧊', 'Profondo sud', 'Oltre il Circolo polare antartico', south, 1),
    B('quad', '🧿', 'Quattro emisferi', 'Tappe a nord, sud, est e ovest', quadrants, 4),
    B('year5', '🔥', 'Anno da record', '5 paesi nello stesso anno', s.bestYear ? s.bestYear.countries : 0, 5),
  ];
}
