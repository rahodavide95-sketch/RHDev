import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeStats, distKm, levelFor } from '../js/stats.js';
import { sanitizeTrip, sanitizeProfile, sanitizeMarks, tripStatus, tripToRow, rowToTrip } from '../js/model.js';

const list = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8'));
const countries = new Map(list.map(c => [c.c, c]));

const FCO = [41.8, 12.25], HEL = [60.32, 24.96], JFK = [40.64, -73.78];
const trip = (id, start, end, stops = [], flights = []) => sanitizeTrip({ id, title: id, start, end, stops, flights });
const stop = (name, cc, lat, lng, extra = {}) => ({ name, cc, lat, lng, ...extra });
const flight = (from, to, fromLL, toLL, extra = {}) => ({ from, to, fromLL, toLL, ...extra });

test('dati: 195 paesi sovrani e continenti validi', () => {
  assert.equal(list.filter(c => c.s).length, 195);
  for (const c of list) assert.match(c.k, /^(EU|AS|AF|NA|SA|OC|AN)$/);
  assert.equal(countries.get('IT').n, 'Italia');
  assert.equal(countries.get('FI').k, 'EU');
});

test('distanza ortodromica plausibile', () => {
  const d = distKm(FCO, HEL);
  assert.ok(d > 2150 && d < 2250, `FCO-HEL ${d}`);
  assert.ok(distKm(FCO, JFK) > 6800 && distKm(FCO, JFK) < 7000);
});

test('stato del viaggio rispetto a oggi', () => {
  assert.equal(tripStatus({ start: '2026-12-26', end: '2026-12-31' }, '2026-10-25'), 'upcoming');
  assert.equal(tripStatus({ start: '2026-10-20', end: '2026-10-30' }, '2026-10-25'), 'ongoing');
  assert.equal(tripStatus({ start: '2025-01-01', end: '2025-01-05' }, '2026-10-25'), 'past');
  assert.equal(tripStatus({ start: '' }, '2026-10-25'), 'past');
});

test('statistiche: paesi, città, regioni, voli, futuri esclusi', () => {
  const trips = [
    trip('helsinki-2025', '2025-12-26', '2025-12-31', [
      stop('Helsinki', 'FI', 60.17, 24.94, { regionKey: 'FI|Uusimaa', region: 'Uusimaa', nights: 2 }),
      stop('Rovaniemi', 'FI', 66.5, 25.72, { regionKey: 'FI|Lapponia', region: 'Lapponia', nights: 3 }),
    ], [flight('FCO', 'HEL', FCO, HEL, { airline: 'Finnair' }), flight('HEL', 'FCO', HEL, FCO, { airline: 'Finnair' })]),
    trip('ny-2024', '2024-05-01', '2024-05-08', [stop('New York', 'US', 40.71, -74.0, { regionKey: 'US|New York' })],
      [flight('FCO', 'JFK', FCO, JFK)]),
    trip('futuro', '2027-03-01', '2027-03-05', [stop('Tokyo', 'JP', 35.68, 139.69)], [flight('FCO', 'HND', FCO, [35.55, 139.78])]),
  ];
  const s = computeStats({
    trips, marks: { visited: ['FR'], wish: ['JP', 'FR'] },
    profile: { home: { name: 'Roma', cc: 'IT', lat: 41.9, lng: 12.5 } }, countries, today: '2026-10-25',
  });
  assert.deepEqual([...s.visited].sort(), ['FI', 'FR', 'IT', 'US']);
  assert.equal(s.sovereignCount, 4);
  assert.equal(s.continents.size, 2);
  assert.equal(s.cityCount, 3);
  assert.equal(s.regionCount, 3);
  assert.equal(s.flightCount, 3);
  assert.equal(s.airportCount, 3);
  assert.equal(s.tripCount, 2);
  assert.equal(s.next.id, 'futuro');
  assert.ok(!s.visited.has('JP'));
  assert.deepEqual([...s.wish], ['JP']);       // FR è già visitato
  assert.equal(s.topAirline[0], 'Finnair');
  assert.equal(s.topCountry.cc, 'FI');
  assert.equal(s.ext.north.name, 'Rovaniemi');
  assert.ok(!s.badges.find(b => b.id === 'arctic').done);   // Rovaniemi è appena sotto il Circolo polare (66,56°)
  assert.ok(s.km > 11000 && s.km < 11700, `km ${s.km}`);
  assert.equal(s.days, 6 + 8);
  assert.equal(s.nights, 5 + 7);
});

test('livelli del viaggiatore', () => {
  assert.equal(levelFor(0).name, 'Sognatore');
  assert.equal(levelFor(7).name, 'Esploratore');
  assert.equal(levelFor(120).name, 'Leggenda');
  assert.equal(levelFor(120).progress, 1);
});

test('validazione: input malevolo o rotto viene ripulito', () => {
  const t = sanitizeTrip({
    id: 'abc123', title: '<img src=x onerror=alert(1)>'.repeat(20), emoji: '<script>', color: 'red;}',
    start: '2025-05-10', end: '2025-05-01',
    stops: [{ name: 'Ok', cc: 'IT', lat: 41, lng: 12 }, { name: 'Fuori', lat: 200, lng: 0 }, 'boh'],
    flights: [{ from: 'FCO', to: 'xx', fromLL: [1, 1], toLL: [2, 2] }],
  });
  assert.equal(t.title.length, 120);
  assert.equal(t.emoji, '✈️');
  assert.match(t.color, /^#[0-9a-f]{6}$/i);
  assert.equal(t.start, '2025-05-01');           // date invertite corrette
  assert.equal(t.stops.length, 1);
  assert.equal(t.flights.length, 0);
  assert.equal(sanitizeTrip({ id: '../../etc' }), null);
  const p = sanitizeProfile({ name: 'x'.repeat(500), nat: 'ita', colorMode: 'hack' });
  assert.equal(p.name.length, 80);
  assert.equal(p.nat, '');
  assert.equal(p.colorMode, 'continent');
  assert.deepEqual(sanitizeMarks({ visited: ['IT', 'IT', 'zz'], wish: ['IT', 'JP'] }), { visited: ['IT'], wish: ['JP'] });
});

test('andata e ritorno dal formato del database', () => {
  const t = trip('roundtrip-1', '2025-01-01', '2025-01-03', [stop('Parigi', 'FR', 48.85, 2.35)]);
  const back = rowToTrip({ ...tripToRow(t), created_at: t.createdAt, updated_at: '2025-02-01T10:00:00Z' });
  assert.equal(back.title, t.title);
  assert.equal(back.stops[0].name, 'Parigi');
  assert.equal(back.base, '2025-02-01T10:00:00Z');
  assert.equal(back.synced, true);
});

test('ricerca luoghi: filtro per codice paese e nomi italiani', async () => {
  const { loadBase, searchPlaces, searchAirports } = await import('../js/geo.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { const t = readFileSync(new URL(url)); return { ok: true, json: async () => JSON.parse(t), text: async () => t.toString('utf8') }; };
  try {
    await loadBase();
    assert.equal((await searchPlaces('Marrakech, MA', 1))[0].cc, 'MA');
    assert.equal((await searchPlaces('Reykjavik, IS', 1))[0].cc, 'IS');
    assert.equal((await searchPlaces('Londra', 1))[0].alt, 'London');
    const roma = (await searchPlaces('roma', 3)).find(r => r.type === 'city');
    assert.equal(roma.cc, 'IT');
    assert.equal(roma.region, 'Lazio');
    assert.equal((await searchPlaces('Monaco di Baviera', 1))[0].cc, 'DE');
    assert.equal((await searchPlaces('giappone', 1))[0].type, 'country');
    assert.equal((await searchAirports('FCO', 1))[0].i, 'FCO');
    assert.equal((await searchAirports('helsinki', 1))[0].i, 'HEL');
  } finally { globalThis.fetch = realFetch; }
});
