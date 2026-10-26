/* ============================================================================
   build-data.cjs — prepara i dataset compatti in orbita/data/
   Gira una tantum in locale (non nel browser, non nel deploy). Vedi tools/README.md.

   Uso:
     NODE_PATH=<cartella>/node_modules node tools/build-data.cjs <cartella-raw>

   <cartella-raw> deve contenere (scaricati da GitHub):
     ne_50m_admin_0_countries.geojson          Natural Earth (pubblico dominio)
     ne_10m_admin_1_states_provinces.geojson   Natural Earth
     ne_10m_populated_places.geojson           Natural Earth (nomi italiani)
     airports.csv                              OurAirports (pubblico dominio)
   e in node_modules: world-countries, all-the-cities, mapshaper.

   Produce:
     data/countries.json   paesi e territori: codice, nome italiano, continente, centro
     data/world.json       confini semplificati (GeoJSON, proprietà {c: codice ISO2})
     data/places.txt       città (GeoNames) con nome italiano e regione/stato
     data/airports.txt     aeroporti con voli di linea e codice IATA
   ============================================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAW = process.argv[2];
if (!RAW) { console.error('Manca la cartella dei dati grezzi'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'data');
const readJSON = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const r2 = n => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Paesi
// ---------------------------------------------------------------------------
const wc = require('world-countries');
function continentOf(c) {
  if (c.region === 'Africa') return 'AF';
  if (c.region === 'Asia') return 'AS';
  if (c.region === 'Europe') return 'EU';
  if (c.region === 'Oceania') return 'OC';
  if (c.region === 'Antarctic') return 'AN';
  if (c.region === 'Americas') return c.subregion === 'South America' ? 'SA' : 'NA';
  return 'AN';
}
const countries = wc.map(c => ({
  c: c.cca2,
  n: (c.translations.ita && c.translations.ita.common) || c.name.common,
  en: c.name.common,
  k: continentOf(c),
  lat: r2(c.latlng[0]),
  lng: r2(c.latlng[1]),
  // 195 paesi "classici": i 193 membri ONU + Vaticano (già membro qui) + Palestina
  s: c.unMember || c.cca2 === 'PS' ? 1 : 0,
  a: Math.round(c.area || 0),
})).sort((a, b) => a.n.localeCompare(b.n, 'it'));
const known = new Set(countries.map(c => c.c));
console.log('paesi:', countries.length, 'sovrani:', countries.filter(c => c.s).length);

// ---------------------------------------------------------------------------
// 2. Confini (Natural Earth 1:50m semplificato con mapshaper)
// ---------------------------------------------------------------------------
const tmp = path.join(RAW, '_world_tmp.json');
execFileSync(process.execPath, [require.resolve('mapshaper/bin/mapshaper'),
  path.join(RAW, 'ne_50m_admin_0_countries.geojson'),
  '-filter-fields', 'ISO_A2_EH,ADM0_A3',
  '-simplify', '20%', 'keep-shapes',
  '-o', tmp, 'precision=0.01', 'format=geojson'], { stdio: 'inherit' });
const world = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);
// Codici mancanti in Natural Earth (-99) → codice più sensato o scarto
const FIX = { SOL: 'SO', CYN: 'CY', KAS: 'IN' };
const feats = [];
for (const f of world.features) {
  let c = f.properties.ISO_A2_EH;
  if (c === '-99') c = FIX[f.properties.ADM0_A3];
  if (!c || !known.has(c)) { console.log('  confine scartato:', f.properties.ADM0_A3); continue; }
  feats.push({ type: 'Feature', properties: { c }, geometry: f.geometry });
}
// mapshaper scrive gli anelli in senso antiorario (RFC 7946); il globo segue la
// convenzione di d3-geo (esterno in senso orario, buchi antiorari): senza questa
// correzione ogni paese "avvolge" il resto della sfera.
const shoelace = ring => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a; };
const rewind = poly => poly.map((ring, k) => ((k === 0) === (shoelace(ring) > 0) ? ring.slice().reverse() : ring));   // shoelace > 0 = antiorario
// Unisce le parti con lo stesso codice (es. Somaliland → Somalia) in un'unica MultiPolygon
const byCode = new Map();
for (const f of feats) {
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(rewind);
  if (!byCode.has(f.properties.c)) byCode.set(f.properties.c, []);
  byCode.get(f.properties.c).push(...polys);
}
const worldOut = { type: 'FeatureCollection', features: [...byCode].map(([c, polys]) => ({
  type: 'Feature', properties: { c },
  geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
})) };
const withShape = new Set(byCode.keys());
for (const c of countries) c.g = withShape.has(c.c) ? 1 : 0;   // g=0: troppo piccolo, disegnato come punto
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify(worldOut));
fs.writeFileSync(path.join(OUT, 'countries.json'), JSON.stringify(countries));
console.log('confini:', worldOut.features.length, 'senza confine (punti):', countries.filter(c => !c.g).length);

// ---------------------------------------------------------------------------
// 3. Regioni / stati (Natural Earth admin-1) — servono per contare "stati e regioni"
// ---------------------------------------------------------------------------
const a1 = readJSON('ne_10m_admin_1_states_provinces.geojson');
// Paesi dove Natural Earth scende sotto il primo livello (province, comuni):
// raggruppiamo per il campo "region", che corrisponde alla regione/comunità.
const USE_REGION = new Set(['IT', 'FR', 'ES', 'LV', 'SI', 'MK', 'MT', 'PH']);
const GB_IT = { England: 'Inghilterra', Scotland: 'Scozia', Wales: 'Galles', 'Northern Ireland': 'Irlanda del Nord' };
const REGION_IT = { 'IT|Apulia': 'Puglia', 'IT|Sicily': 'Sicilia' };
function regionLabel(p) {
  if (p.iso_a2 === 'GB') return GB_IT[p.geonunit] || p.geonunit;
  const label = USE_REGION.has(p.iso_a2) && p.region ? p.region : (p.name_it || p.name || p.name_en);
  return REGION_IT[p.iso_a2 + '|' + label] || label;
}
function bboxOf(rings) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const ring of rings) for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
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
function inPoly(x, y, poly) { if (!inRing(x, y, poly[0])) return false; for (let k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) return false; return true; }
const regionIdx = new Map();   // "IT|Lombardia" → indice
const regions = [];
const a1ByCountry = new Map();
for (const f of a1.features) {
  const p = f.properties;
  const cc = p.iso_a2;
  if (!cc || cc === '-1' || cc === '-99' || !known.has(cc) || !f.geometry) continue;
  const label = regionLabel(p);
  if (!label) continue;
  const key = cc + '|' + label;
  if (!regionIdx.has(key)) { regionIdx.set(key, regions.length); regions.push([cc, label]); }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const entry = { r: regionIdx.get(key), polys: polys.map(pl => ({ pl, bb: bboxOf(pl) })), lat: p.latitude, lng: p.longitude };
  if (!a1ByCountry.has(cc)) a1ByCountry.set(cc, []);
  a1ByCountry.get(cc).push(entry);
}
function regionFor(cc, lng, lat) {
  const list = a1ByCountry.get(cc);
  if (!list) return -1;
  for (const e of list) for (const { pl, bb } of e.polys) {
    if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    if (inPoly(lng, lat, pl)) return e.r;
  }
  // fuori da ogni poligono (coste, isolette): la regione col centro più vicino
  let best = -1, bd = Infinity;
  for (const e of list) { const d = (e.lat - lat) ** 2 + (e.lng - lng) ** 2; if (d < bd) { bd = d; best = e.r; } }
  return best;
}

// ---------------------------------------------------------------------------
// 4. Città (GeoNames via all-the-cities) + nomi italiani (Natural Earth)
// ---------------------------------------------------------------------------
const cities = require('all-the-cities');
const pp = readJSON('ne_10m_populated_places.geojson').features.map(f => f.properties);
const itByGeo = new Map();
const itByName = new Map();   // "IT|rome" → "Roma" (serve per gli aeroporti)
for (const p of pp) {
  if (!p.NAME_IT) continue;
  if (p.GEONAMESID > 0) itByGeo.set(p.GEONAMESID, p.NAME_IT);
  itByName.set(p.ISO_A2 + '|' + String(p.NAME).toLowerCase(), p.NAME_IT);
}
// Nomi italiani d'uso comune che Natural Earth non copre
const EXTRA_IT = {
  'IT|Florence': 'Firenze', 'IT|Venice': 'Venezia', 'IT|Genoa': 'Genova', 'IT|Turin': 'Torino', 'IT|Milan': 'Milano',
  'IT|Naples': 'Napoli', 'IT|Rome': 'Roma', 'IT|Padua': 'Padova', 'IT|Syracuse': 'Siracusa', 'IT|Leghorn': 'Livorno',
  'IT|Mantua': 'Mantova', 'IT|Sienna': 'Siena', 'BE|Brussels': 'Bruxelles', 'BE|Antwerpen': 'Anversa', 'BE|Ghent': 'Gand',
  'BE|Bruges': 'Bruges', 'DE|Cologne': 'Colonia', 'DE|Munich': 'Monaco di Baviera', 'DE|Nuremberg': 'Norimberga',
  'DE|Frankfurt am Main': 'Francoforte', 'DE|Hamburg': 'Amburgo', 'DE|Berlin': 'Berlino', 'DE|Dresden': 'Dresda',
  'AT|Vienna': 'Vienna', 'AT|Salzburg': 'Salisburgo', 'AT|Innsbruck': 'Innsbruck', 'CH|Geneva': 'Ginevra', 'CH|Zurich': 'Zurigo',
  'CH|Basel': 'Basilea', 'CH|Lucerne': 'Lucerna', 'CH|Bern': 'Berna', 'FR|Nice': 'Nizza', 'FR|Marseille': 'Marsiglia',
  'FR|Toulouse': 'Tolosa', 'FR|Lyon': 'Lione', 'FR|Paris': 'Parigi', 'FR|Strasbourg': 'Strasburgo', 'FR|Avignon': 'Avignone',
  'ES|Seville': 'Siviglia', 'ES|Barcelona': 'Barcellona', 'ES|Saragossa': 'Saragozza', 'ES|Zaragoza': 'Saragozza',
  'ES|Cordova': 'Cordova', 'ES|Córdoba': 'Cordova', 'ES|Cadiz': 'Cadice', 'ES|Cádiz': 'Cadice', 'ES|Granada': 'Granada',
  'PT|Lisbon': 'Lisbona', 'PT|Porto': 'Porto', 'GB|London': 'Londra', 'GB|Edinburgh': 'Edimburgo', 'GR|Athens': 'Atene',
  'GR|Thessaloniki': 'Salonicco', 'PL|Warsaw': 'Varsavia', 'PL|Krakow': 'Cracovia', 'PL|Kraków': 'Cracovia',
  'CZ|Prague': 'Praga', 'DK|Copenhagen': 'Copenaghen', 'SE|Stockholm': 'Stoccolma', 'SE|Gothenburg': 'Göteborg',
  'RU|Moscow': 'Mosca', 'RU|Saint Petersburg': 'San Pietroburgo', 'TR|Istanbul': 'Istanbul', 'EG|Cairo': 'Il Cairo',
  'EG|Alexandria': 'Alessandria d\'Egitto', 'IL|Jerusalem': 'Gerusalemme', 'CN|Beijing': 'Pechino', 'MX|Mexico City': 'Città del Messico',
  'HR|Split': 'Spalato', 'HR|Dubrovnik': 'Ragusa di Dalmazia', 'HR|Rijeka': 'Fiume', 'HR|Zadar': 'Zara', 'SI|Ljubljana': 'Lubiana',
  'SI|Koper': 'Capodistria', 'SI|Piran': 'Pirano', 'MT|Valletta': 'La Valletta', 'BE|Liège': 'Liegi', 'NL|The Hague': "L'Aia",
  'LU|Luxembourg': 'Lussemburgo', 'IE|Dublin': 'Dublino', 'RO|Bucharest': 'Bucarest', 'HU|Budapest': 'Budapest',
  'RS|Belgrade': 'Belgrado', 'BG|Sofia': 'Sofia', 'CY|Nicosia': 'Nicosia', 'LT|Vilnius': 'Vilnius', 'TN|Tunis': 'Tunisi',
  'MA|Marrakesh': 'Marrakech', 'MA|Casablanca': 'Casablanca', 'US|New York City': 'New York', 'US|Philadelphia': 'Filadelfia',
  'US|New Orleans': 'New Orleans', 'BR|Rio de Janeiro': 'Rio de Janeiro', 'BR|São Paulo': 'San Paolo', 'JP|Tokyo': 'Tokyo',
  'JP|Kyoto': 'Kyoto', 'TH|Bangkok': 'Bangkok', 'SG|Singapore': 'Singapore', 'IN|New Delhi': 'Nuova Delhi',
};
const NOTABLE_GEO = new Set(pp.filter(p => p.GEONAMESID > 0).map(p => p.GEONAMESID));
const keep = cities.filter(x => known.has(x.country) && (
  x.population >= 5000 || x.featureCode === 'PPLC' || x.featureCode === 'PPLA' || NOTABLE_GEO.has(x.cityId)
  || (x.country === 'IT' && x.population >= 800)   // borghi italiani: Positano, Cinque Terre, ecc.
));
const clean = s => String(s).replace(/[|\n\r]/g, ' ').trim();
const lines = [];
const seen = new Set();
for (const x of keep.sort((a, b) => b.population - a.population)) {
  const [lng, lat] = x.loc.coordinates;
  const it = itByGeo.get(x.cityId) || EXTRA_IT[x.country + '|' + x.name];
  const display = clean(it || x.name);
  const alt = it && it !== x.name ? clean(x.name) : '';
  const k = x.country + '|' + display + '|' + r2(lat) + '|' + r2(lng);
  if (seen.has(k)) continue;
  seen.add(k);
  const reg = regionFor(x.country, lng, lat);
  lines.push([display, alt, x.country, reg < 0 ? '' : reg, r2(lat), r2(lng), Math.round(x.population / 1000)].join('|'));
}
const placesTxt = '#R\n' + regions.map(r => r.join('|')).join('\n') + '\n#C\n' + lines.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'places.txt'), placesTxt);
console.log('regioni:', regions.length, 'città:', lines.length, 'KB:', Math.round(placesTxt.length / 1024));

// ---------------------------------------------------------------------------
// 5. Aeroporti (OurAirports): solo con codice IATA e voli di linea
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const csv = parseCSV(fs.readFileSync(path.join(RAW, 'airports.csv'), 'utf8'));
const H = csv[0]; const col = n => H.indexOf(n);
const RANK = { large_airport: 'L', medium_airport: 'M', small_airport: 'S' };
const aLines = [];
const seenIata = new Set();
for (const r of csv.slice(1)) {
  const iata = (r[col('iata_code')] || '').trim().toUpperCase();
  const type = r[col('type')];
  if (!/^[A-Z]{3}$/.test(iata) || !RANK[type] || r[col('scheduled_service')] !== 'yes' || seenIata.has(iata)) continue;
  const cc = r[col('iso_country')];
  if (!known.has(cc)) continue;
  seenIata.add(iata);
  const city = clean(r[col('municipality')] || '');
  const cityIt = itByName.get(cc + '|' + city.toLowerCase()) || EXTRA_IT[cc + '|' + city] || '';
  aLines.push([iata, clean(r[col('name')]), city, cityIt && cityIt !== city ? clean(cityIt) : '', cc,
    r2(+r[col('latitude_deg')]), r2(+r[col('longitude_deg')]), RANK[type]].join('|'));
}
aLines.sort((a, b) => 'LMS'.indexOf(a.split('|')[7]) - 'LMS'.indexOf(b.split('|')[7]));
fs.writeFileSync(path.join(OUT, 'airports.txt'), aLines.join('\n') + '\n');
console.log('aeroporti:', aLines.length);
