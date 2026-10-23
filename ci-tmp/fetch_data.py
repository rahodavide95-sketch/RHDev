"""Raccolta dati temporanea per finlandia/: geocodifica, percorsi a piedi, fermate bus,
orari linea 8, clima storico FMI. Gira su GitHub Actions e scrive in ci-out/."""
import json, re, time, urllib.request, urllib.parse, os, subprocess
OUT = 'ci-out'; os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'RHDev-finlandia-itinerary/1.0 (github.com/rahodavide95-sketch/RHDev)'}
log = open(f'{OUT}/log.txt', 'w')
def get(url, timeout=60, raw=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
    return b if raw else b.decode('utf-8', 'replace')
def say(*a):
    s = ' '.join(str(x) for x in a); print(s); log.write(s + '\n'); log.flush()

# ── 1. geocodifica ──
PLACES = {
  'apt': 'Viirinkankaantie 21, 96300 Rovaniemi',
  'roi_station': 'Rovaniemen rautatieasema, Rovaniemi',
  'lordi': 'Lordin aukio, Rovaniemi',
  'arktikum': 'Arktikum, Rovaniemi',
  'jatkankynttila': 'Jätkänkynttilä, Rovaniemi',
  'nili': 'Valtakatu 20, Rovaniemi',
  'korundi': 'Korundi, Rovaniemi',
  'santa_village': 'Santa Claus Village, Rovaniemi',
  'santapark': 'SantaPark, Rovaniemi',
  'ounasvaara': 'Ounasvaara, Rovaniemi',
  'pilke': 'Pilke, Rovaniemi',
  'univ_lapland': 'Lapin yliopisto, Rovaniemi',
  'k_market_viirinkangas': 'K-Market Viirinkangas, Rovaniemi',
  'sampokeskus': 'Sampokeskus, Rovaniemi',
  'rovaniemi_bus_station': 'Rovaniemen linja-autoasema',
  'citybox': 'Siltasaarenkatu 13, Helsinki',
  'hki_station': 'Helsingin päärautatieasema',
  'senaatintori': 'Senaatintori, Helsinki',
  'uspenski': 'Uspenskin katedraali, Helsinki',
  'kauppatori': 'Kauppatori, Helsinki',
  'vanha_kauppahalli': 'Vanha kauppahalli, Helsinki',
  'loyly': 'Hernesaarenranta 4, Helsinki',
  'temppeliaukio': 'Temppeliaukion kirkko, Helsinki',
  'oodi': 'Oodi, Helsinki',
  'suomenlinna_quay': 'Suomenlinna päälaituri',
  'kuninkaanportti': 'Kuninkaanportti, Suomenlinna',
  'ekberg': 'Bulevardi 9, Helsinki',
  'savotta': 'Aleksanterinkatu 22, Helsinki',
  'pitkasilta': 'Pitkäsilta, Helsinki',
  'torni': 'Yrjönkatu 26, Helsinki',
  'kappeli': 'Eteläesplanadi 1, Helsinki',
  'stockmann': 'Stockmann Helsinki keskusta',
  'kotiharju': 'Harjutorinkatu 1, Helsinki',
  'allas': 'Allas Sea Pool, Helsinki',
}
geo = {}
for k, q in PLACES.items():
    try:
        r = json.loads(get('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fi&q=' + urllib.parse.quote(q)))
        geo[k] = {'q': q, 'lat': float(r[0]['lat']), 'lon': float(r[0]['lon']), 'name': r[0].get('display_name', '')} if r else {'q': q, 'err': 'not found'}
    except Exception as e:
        geo[k] = {'q': q, 'err': str(e)}
    say('geo', k, geo[k])
    time.sleep(1.2)
json.dump(geo, open(f'{OUT}/geo.json', 'w'), ensure_ascii=False, indent=1)

# ── 2. percorsi a piedi / in auto dall'appartamento ──
routes = {}
if 'lat' in geo.get('apt', {}):
    a = geo['apt']
    for k in ['roi_station', 'lordi', 'arktikum', 'nili', 'korundi', 'jatkankynttila', 'univ_lapland', 'k_market_viirinkangas', 'sampokeskus', 'santa_village', 'santapark', 'ounasvaara', 'rovaniemi_bus_station']:
        b = geo.get(k, {})
        if 'lat' not in b: continue
        for prof, host in [('foot', 'routed-foot'), ('car', 'routed-car')]:
            try:
                u = f'https://routing.openstreetmap.de/{host}/route/v1/driving/{a["lon"]},{a["lat"]};{b["lon"]},{b["lat"]}?overview=false'
                j = json.loads(get(u))
                rt = j['routes'][0]
                routes[f'{k}:{prof}'] = {'km': round(rt['distance'] / 1000, 2), 'min': round(rt['duration'] / 60, 1)}
            except Exception as e:
                routes[f'{k}:{prof}'] = {'err': str(e)}
            say('route', k, prof, routes[f'{k}:{prof}'])
            time.sleep(1)
json.dump(routes, open(f'{OUT}/routes.json', 'w'), ensure_ascii=False, indent=1)

# ── 3. fermate bus vicine (OpenStreetMap / Overpass) ──
if 'lat' in geo.get('apt', {}):
    a = geo['apt']
    q = f'[out:json][timeout:60];node(around:700,{a["lat"]},{a["lon"]})[highway=bus_stop]->.s;.s out body;rel(bn.s)[route=bus];out tags;'
    try:
        j = json.loads(get('https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q), timeout=90))
        json.dump(j, open(f'{OUT}/busstops.json', 'w'), ensure_ascii=False, indent=1)
        for el in j.get('elements', []):
            say('osm', el['type'], el.get('lat'), el.get('lon'), json.dumps(el.get('tags', {}), ensure_ascii=False)[:200])
    except Exception as e:
        say('overpass err', e)

# ── 4. orari bus linea 8 (PDF Visit Rovaniemi) e orari Linkkari ──
for name, url in [('bus8', 'https://www.visitrovaniemi.fi/wp-content/uploads/BUS-8-2026-2027-WINTER-8-C.pdf')]:
    try:
        open(f'{OUT}/{name}.pdf', 'wb').write(get(url, raw=True))
        subprocess.run(['pdftotext', '-layout', f'{OUT}/{name}.pdf', f'{OUT}/{name}.txt'], check=False)
        say('pdf ok', name, os.path.getsize(f'{OUT}/{name}.pdf'))
    except Exception as e:
        say('pdf err', name, e)

# ── 5. clima storico FMI (stazioni) ──
WFS = 'https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id='
def parse_simple(xml):
    out = []
    for m in re.finditer(r'<BsWfs:Location>.*?<gml:pos>([^<]+)</gml:pos>.*?<BsWfs:Time>([^<]+)</BsWfs:Time>\s*<BsWfs:ParameterName>([^<]+)</BsWfs:ParameterName>\s*<BsWfs:ParameterValue>([^<]+)</BsWfs:ParameterValue>', xml, re.S):
        out.append((m.group(1).strip(), m.group(2), m.group(3), m.group(4)))
    return out
STATIONS = {'rov_airport': 101920, 'rov_station': 101928, 'hel_kaisaniemi': 100971}
clim = {'daily': {}, 'hourly': {}, 'pos': {}}
for sk, fid in STATIONS.items():
    clim['daily'][sk] = {}; clim['hourly'][sk] = {}
    for y in range(1991, 2026):
        try:
            u = WFS + 'fmi::observations::weather::daily::simple&fmisid=%d&starttime=%d-12-20T00:00:00Z&endtime=%d-01-03T00:00:00Z&parameters=tday,tmin,tmax,snow,rrday' % (fid, y, y + 1)
            rows = parse_simple(get(u))
            for pos, t, p, v in rows:
                clim['pos'][sk] = pos
                clim['daily'][sk].setdefault(t[:10], {})[p] = None if v == 'NaN' else float(v)
        except Exception as e:
            say('fmi daily err', sk, y, e)
        for params in ('t2m,ws_10min', 'n_man'):
            try:
                u = WFS + 'fmi::observations::weather::simple&fmisid=%d&starttime=%d-12-25T22:00:00Z&endtime=%d-12-31T22:00:00Z&timestep=60&parameters=%s' % (fid, y, y, params)
                rows = parse_simple(get(u))
                for pos, t, p, v in rows:
                    clim['hourly'][sk].setdefault(t[:16], {})[p] = None if v == 'NaN' else float(v)
            except Exception as e:
                say('fmi hourly err', sk, y, params, e)
        time.sleep(0.3)
    nd = sum(1 for d in clim['daily'][sk].values() if d.get('tmin') is not None)
    nh = sum(1 for d in clim['hourly'][sk].values() if d.get('t2m') is not None)
    say('fmi', sk, 'pos', clim['pos'].get(sk), 'daily', nd, 'hourly', nh)
json.dump(clim, open(f'{OUT}/clima_fmi.json', 'w'), separators=(',', ':'))

# ── 6. clima Open-Meteo (ERA5) sui punti esatti, per confronto ──
for k, (la, lo) in {'apt': (geo.get('apt', {}).get('lat', 66.49), geo.get('apt', {}).get('lon', 25.69)), 'citybox': (60.1786, 24.9495)}.items():
    try:
        u = ('https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=1991-12-20&end_date=2026-01-02'
             '&hourly=temperature_2m,apparent_temperature,cloud_cover,wind_speed_10m&timezone=Europe%%2FHelsinki') % (la, lo)
        j = json.loads(get(u, timeout=180))
        h = j['hourly']; keep = {kk: [] for kk in h}
        for i, t in enumerate(h['time']):
            md = t[5:10]
            if md >= '12-25' or md <= '01-01':
                for kk in h: keep[kk].append(h[kk][i])
        json.dump(keep, open(f'{OUT}/era5_{k}.json', 'w'), separators=(',', ':'))
        say('era5', k, len(keep['time']))
    except Exception as e:
        say('era5 err', k, e)
log.close()
