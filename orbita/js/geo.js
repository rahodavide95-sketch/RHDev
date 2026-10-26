/* ============================================================================
   geo.js — dati geografici (tutti locali: nessuna ricerca inviata a terzi)
   countries.json + world.json all'avvio; città e aeroporti solo al primo uso.
   ============================================================================ */
import { norm, haversine } from './util.js';

export const CONTINENTS = {
  // toni "gioiello": pieni ma morbidi, leggibili sul blu notte del globo
  EU: { n: 'Europa', short: 'Eur', color: '#7B8CF2', emoji: '🏰' },
  AS: { n: 'Asia', short: 'Asia', color: '#EE8296', emoji: '🏯' },
  AF: { n: 'Africa', short: 'Afr', color: '#EFAE5F', emoji: '🦁' },
  NA: { n: 'Nord America', short: 'N.Am', color: '#5CC4D6', emoji: '🗽' },
  SA: { n: 'Sud America', short: 'S.Am', color: '#5DC48E', emoji: '🦜' },
  OC: { n: 'Oceania', short: 'Oce', color: '#A792F0', emoji: '🦘' },
  AN: { n: 'Antartide', short: 'Ant', color: '#D9E3EE', emoji: '🐧' },
};
export const CONTINENT_ORDER = ['EU', 'AS', 'AF', 'NA', 'SA', 'OC', 'AN'];

const base = new URL('../data/', import.meta.url);
const fetchData = async (f, kind = 'json') => {
  const r = await fetch(new URL(f, base));
  if (!r.ok) throw new Error(`Impossibile caricare ${f}`);
  return kind === 'json' ? r.json() : r.text();
};

// ---------------------------------------------------------------------------
// Paesi e confini
// ---------------------------------------------------------------------------
export const countries = new Map();   // cc → { c, n, en, k, lat, lng, s, a, g }
export let world = null;               // GeoJSON FeatureCollection
let worldIndex = [];                   // [{ c, polys: [{ pl, bb }] }]

export async function loadBase() {
  const [list, w] = await Promise.all([fetchData('countries.json'), fetchData('world.json')]);
  for (const c of list) { c.nn = norm(c.n); c.ne = norm(c.en); countries.set(c.c, c); }
  world = w;
  worldIndex = w.features.map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return { c: f.properties.c, polys: polys.map(pl => ({ pl, bb: bbox(pl[0]) })) };
  });
  return { countries, world };
}
export const countryName = cc => countries.get(cc)?.n || cc || '';
export const sovereignTotal = () => [...countries.values()].filter(c => c.s).length;
export function sovereignByContinent() {
  const out = {};
  for (const c of countries.values()) if (c.s) out[c.k] = (out[c.k] || 0) + 1;
  return out;
}

function bbox(ring) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Paese che contiene il punto (per i luoghi scelti a mano sul globo)
export function countryAt(lat, lng) {
  for (const e of worldIndex) for (const { pl, bb } of e.polys) {
    if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    if (inRing(lng, lat, pl[0]) && !pl.slice(1).some(h => inRing(lng, lat, h))) return e.c;
  }
  // piccoli stati senza confine disegnato: il centro più vicino entro ~60 km
  let best = null, bd = 60;
  for (const c of countries.values()) {
    if (c.g) continue;
    const d = haversine(lat, lng, c.lat, c.lng);
    if (d < bd) { bd = d; best = c.c; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Città (GeoNames) — caricate al primo bisogno
// ---------------------------------------------------------------------------
let placesP = null;
let regions = [];   // [[cc, nome]]
let places = [];    // [{ n, alt, cc, r, lat, lng, pop, nn, na }]

export function loadPlaces() {
  if (!placesP) placesP = fetchData('places.txt', 'text').then(txt => {
    const lines = txt.split('\n');
    let mode = '';
    for (const line of lines) {
      if (!line) continue;
      if (line === '#R' || line === '#C') { mode = line; continue; }
      const p = line.split('|');
      if (mode === '#R') regions.push([p[0], p[1]]);
      else places.push({ n: p[0], alt: p[1], cc: p[2], r: p[3] === '' ? -1 : +p[3], lat: +p[4], lng: +p[5], pop: +p[6], nn: norm(p[0]), na: norm(p[1]) });
    }
    return places;
  }).catch(e => { placesP = null; throw e; });
  return placesP;
}
export const regionName = r => (r >= 0 && regions[r] ? regions[r][1] : '');
export const regionKey = r => (r >= 0 && regions[r] ? regions[r].join('|') : '');

function matchScore(q, s) {
  if (!s) return 0;
  if (s === q) return 4;
  if (s.startsWith(q)) return 3;
  if (s.includes(' ' + q) || s.includes('-' + q)) return 2;
  return 0;
}

// Ricerca luoghi: paesi + città. "Roma, IT" o "paris francia" filtrano per paese.
export async function searchPlaces(query, limit = 8) {
  await loadPlaces();
  let q = norm(query);
  if (q.length < 2) return [];
  let ccFilter = null;
  const parts = q.split(/\s*,\s*/);
  if (parts.length > 1 && parts[1]) {
    q = parts[0];
    const cq = parts[1];
    const all = [...countries.values()];
    const hit = all.find(c => c.c.toLowerCase() === cq) || all.find(c => c.nn === cq || c.ne === cq) || all.find(c => c.nn.startsWith(cq) || c.ne.startsWith(cq));
    if (hit) ccFilter = hit.c;
  }
  const out = [];
  if (!ccFilter) {
    for (const c of countries.values()) {
      const s = Math.max(matchScore(q, c.nn), matchScore(q, c.ne));
      if (s >= 3) out.push({ type: 'country', score: s * 1e9 + 5e8, cc: c.c, n: c.n, lat: c.lat, lng: c.lng });
    }
  }
  for (const p of places) {
    if (ccFilter && p.cc !== ccFilter) continue;
    const s = Math.max(matchScore(q, p.nn), matchScore(q, p.na));
    if (!s) continue;
    out.push({ type: 'city', score: s * 1e9 + p.pop, place: p });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map(o => o.type === 'country'
    ? { type: 'country', name: o.n, cc: o.cc, lat: o.lat, lng: o.lng, region: '' }
    : { type: 'city', name: o.place.n, alt: o.place.alt, cc: o.place.cc, lat: o.place.lat, lng: o.place.lng, region: regionName(o.place.r), regionKey: regionKey(o.place.r), pop: o.place.pop });
}

// Città più vicina a un punto (per dare una regione ai luoghi scelti a mano)
export async function nearestPlace(lat, lng, cc) {
  await loadPlaces();
  let best = null, bd = Infinity;
  for (const p of places) {
    if (cc && p.cc !== cc) continue;
    if (Math.abs(p.lat - lat) > 3 || Math.abs(p.lng - lng) > 4) continue;
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { name: best.n, cc: best.cc, region: regionName(best.r), regionKey: regionKey(best.r), km: bd } : null;
}

// ---------------------------------------------------------------------------
// Aeroporti (OurAirports) — caricati al primo bisogno
// ---------------------------------------------------------------------------
let airportsP = null;
export const airports = new Map();   // IATA → { i, n, city, cityIt, cc, lat, lng, rank }

export function loadAirports() {
  if (!airportsP) airportsP = fetchData('airports.txt', 'text').then(txt => {
    for (const line of txt.split('\n')) {
      if (!line) continue;
      const p = line.split('|');
      airports.set(p[0], { i: p[0], n: p[1], city: p[2], cityIt: p[3], cc: p[4], lat: +p[5], lng: +p[6], rank: p[7],
        nn: norm(p[1]), nc: norm(p[2]), ni: norm(p[3]) });
    }
    return airports;
  }).catch(e => { airportsP = null; throw e; });
  return airportsP;
}

export async function searchAirports(query, limit = 8) {
  await loadAirports();
  const q = norm(query);
  if (!q) return [];
  const Q = q.toUpperCase();
  const out = [];
  const rankBonus = { L: 3e6, M: 2e6, S: 1e6 };
  for (const a of airports.values()) {
    let s = 0;
    if (a.i === Q) s = 9;
    else if (q.length <= 3 && a.i.startsWith(Q)) s = 5;
    else s = Math.max(matchScore(q, a.nc), matchScore(q, a.ni), matchScore(q, a.nn) - 1);
    if (s > 0) out.push({ a, score: s * 1e7 + rankBonus[a.rank] });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit).map(o => o.a);
}
export const airportCity = a => (a ? a.cityIt || a.city || a.n : '');
