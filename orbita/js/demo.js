/* ============================================================================
   demo.js — viaggi di esempio per vedere subito il globo "acceso"
   Città e aeroporti vengono presi dagli stessi dataset dell'app, così regioni,
   coordinate e distanze sono vere. Gli id iniziano con "demo-": si tolgono in un tocco.
   ============================================================================ */
import { searchPlaces, loadAirports, airports, airportCity } from './geo.js';
import { distKm } from './stats.js';
import * as store from './store.js';
import { uid } from './util.js';

const DEMO = [
  { title: 'Natale in Lapponia', emoji: '🎄', color: '#5CC4D6', start: '2025-12-26', end: '2025-12-31',
    stops: [['Helsinki, FI', 2], ['Rovaniemi, FI', 3]], flights: [['FCO', 'HEL', 'Finnair', 'AY1762'], ['HEL', 'RVN', 'Finnair', 'AY531'], ['RVN', 'HEL', 'Finnair', 'AY534'], ['HEL', 'FCO', 'Finnair', 'AY1761']] },
  { title: 'Coast to coast USA', emoji: '🗽', color: '#EFAE5F', start: '2025-06-10', end: '2025-06-24',
    stops: [['New York, US', 5], ['San Francisco, US', 4], ['Los Angeles, US', 4]], flights: [['FCO', 'JFK', 'ITA Airways', 'AZ608'], ['JFK', 'SFO', 'Delta', 'DL420'], ['LAX', 'FCO', 'ITA Airways', 'AZ621']] },
  { title: 'Ciliegi in Giappone', emoji: '🌸', color: '#EE8296', start: '2024-04-02', end: '2024-04-14',
    stops: [['Tokyo, JP', 5], ['Kyoto, JP', 4], ['Osaka, JP', 3]], flights: [['FCO', 'HND', 'ITA Airways', 'AZ792'], ['KIX', 'FCO', 'ITA Airways', 'AZ795']] },
  { title: 'Weekend a Londra', emoji: '🏙️', color: '#7B8CF2', start: '2024-11-08', end: '2024-11-10',
    stops: [['Londra, GB', 2]], flights: [['FCO', 'LHR', 'British Airways', 'BA555'], ['LHR', 'FCO', 'British Airways', 'BA554']] },
  { title: 'Lisbona e Porto', emoji: '🍷', color: '#A792F0', start: '2023-09-15', end: '2023-09-21',
    stops: [['Lisbona, PT', 3], ['Porto, PT', 3]], flights: [['FCO', 'LIS', 'TAP', 'TP839'], ['OPO', 'FCO', 'Ryanair', 'FR8357']] },
  { title: 'Islanda on the road', emoji: '🌋', color: '#5DC48E', start: '2023-07-20', end: '2023-07-28',
    stops: [['Reykjavik, IS', 3], ['Vik, IS', 2], ['Akureyri, IS', 3]], flights: [['FCO', 'KEF', 'Icelandair', 'FI593'], ['KEF', 'FCO', 'Icelandair', 'FI592']] },
  { title: 'Profumi del Marocco', emoji: '🕌', color: '#F2C97D', start: '2022-03-10', end: '2022-03-16',
    stops: [['Marrakech, MA', 4], ['Fes, MA', 2]], flights: [['FCO', 'RAK', 'Ryanair', 'FR4502'], ['FEZ', 'FCO', 'Ryanair', 'FR2851']] },
  { title: 'Costiera amalfitana', emoji: '🏖️', color: '#3B8BF6', start: '2022-08-05', end: '2022-08-10',
    stops: [['Napoli, IT', 1], ['Positano, IT', 2], ['Amalfi, IT', 2]], flights: [] },
  { title: 'Patagonia', emoji: '🏔️', color: '#5CC4D6', start: '2027-02-01', end: '2027-02-18',
    stops: [['Buenos Aires, AR', 4], ['El Calafate, AR', 5], ['Ushuaia, AR', 4]], flights: [['FCO', 'EZE', 'Aerolineas Argentinas', 'AR1141']] },
];

export const isDemoId = id => String(id).startsWith('demo-');
export const hasDemo = () => store.ownTrips().some(t => isDemoId(t.id));

export async function loadDemo() {
  await loadAirports();
  let n = 0;
  for (const d of DEMO) {
    const stops = [];
    let day = d.start;
    for (const [q, nights] of d.stops) {
      const [hit] = await searchPlaces(q, 1);
      if (!hit) continue;
      stops.push({ name: hit.name, cc: hit.cc, lat: hit.lat, lng: hit.lng, region: hit.region, regionKey: hit.regionKey, nights, date: day, kind: 'city' });
      const dt = new Date(day + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + nights); day = dt.toISOString().slice(0, 10);
    }
    const flights = d.flights.map(([a, b, airline, num], k) => {
      const A = airports.get(a), B = airports.get(b);
      if (!A || !B) return null;
      const date = k === 0 ? d.start : k === d.flights.length - 1 ? d.end : stops[Math.min(k, stops.length - 1)]?.date || d.start;
      return { from: a, to: b, fromLL: [A.lat, A.lng], toLL: [B.lat, B.lng], fromCity: airportCity(A), toCity: airportCity(B), fromCc: A.cc, toCc: B.cc, airline, num, date, km: Math.round(distKm([A.lat, A.lng], [B.lat, B.lng])) };
    }).filter(Boolean);
    // id unico per persona: due utenti che caricano l'esempio non devono "scontrarsi" nel cloud
    store.saveTrip({ id: `demo-${uid()}`, title: d.title, emoji: d.emoji, color: d.color, start: d.start, end: d.end, notes: 'Viaggio di esempio: modificalo o eliminalo quando vuoi.', stops, flights });
    n++;
  }
  const st = store.get();
  if (!st.profile.home) {
    const [roma] = await searchPlaces('Roma, IT', 1);
    if (roma) store.updateProfile({ home: { name: roma.name, cc: roma.cc, lat: roma.lat, lng: roma.lng, region: roma.region, regionKey: roma.regionKey } });
  }
  for (const cc of ['NZ', 'PE', 'NO']) if (!st.marks.wish.includes(cc) && !st.marks.visited.includes(cc)) store.setMark(cc, 'wish');
  return n;
}

export function removeDemo() {
  for (const t of store.ownTrips()) if (isDemoId(t.id)) store.removeTrip(t.id);
}
