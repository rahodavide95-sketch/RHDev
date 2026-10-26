/* ============================================================================
   globe.js — il globo 3D (globe.gl / three.js)
   Paesi visitati in rilievo e colorati, voli come archi animati, città come
   punti luminosi, casa con un anello pulsante. Trascina per ruotare, rotella o
   pizzico per lo zoom, clic su un paese per i dettagli.
   ============================================================================ */
import { countries, world, CONTINENTS } from './geo.js';
import { esc, flag, haversine, prefersReducedMotion } from './util.js';

const IVORY = '#ECE6DB';
// Tavolozze dei due temi (vedi css/look-*.css)
const LOOKS = {
  // blu notte e terra ardesia; i paesi visitati prendono il colore del continente
  color: {
    land: '#2a3154', landHover: '#3a4373', stroke: 'rgba(200,210,255,0.18)', side: 'rgba(10,14,32,0.6)',
    wish: '#323a64', wishStroke: 'rgba(242,201,125,0.85)', wishPoint: '#F2C97D', home: '#F2C97D',
    visitedStroke: 'rgba(255,255,255,0.45)', visitedSide: 0.35, visitedAlt: 0.022,
    heat: ['#5CC4D6', '#7B8CF2', '#A792F0', '#D88BC4', '#EE8296'], year: ['#5CC4D6', '#EFAE5F'],
    arcs: ['rgba(92,196,214,0.85)', 'rgba(167,146,240,0.9)'], recapArcs: ['rgba(92,196,214,1)', 'rgba(167,146,240,1)'], arcStroke: 0.34,
    ocean: '#0a1022', emissive: '#0e1638', emissiveI: 0.4, shininess: 20, specular: '#3d55b8', atmosphere: '#8ea6ff', atmosphereAlt: 0.15,
    cont: k => CONTINENTS[k]?.color,
  },
  // grafite per la terra, avorio per ciò che hai visitato
  minimal: {
    land: '#23252b', landHover: '#31343c', stroke: 'rgba(255,255,255,0.10)', side: 'rgba(8,9,11,0.6)',
    wish: '#2b2d33', wishStroke: 'rgba(236,230,219,0.75)', wishPoint: '#8a867f', home: '#ffffff',
    visitedStroke: 'rgba(255,255,255,0.35)', visitedSide: 0.28, visitedAlt: 0.018,
    heat: ['#7d7a75', '#a29e97', '#c4bfb6', '#e0dad0', '#ffffff'], year: ['#8FA0B5', '#DCC6A2'],
    arcs: ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.8)'], recapArcs: ['rgba(255,255,255,0.25)', 'rgba(255,255,255,1)'], arcStroke: 0.28,
    ocean: '#08090b', emissive: '#0c0d11', emissiveI: 0.5, shininess: 12, specular: '#2a2d36', atmosphere: '#a9b4c8', atmosphereAlt: 0.13,
    cont: k => CONTINENTS[k]?.muted,
  },
};
export const LOOK_LEGEND = { heat: k => LOOKS[k].heat, year: k => LOOKS[k].year, cont: (look, k) => LOOKS[look].cont(k) };

const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgba = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

export function createGlobe(el, handlers = {}) {
  if (typeof window.Globe !== 'function') throw new Error('globe.gl non caricato');
  const reduced = prefersReducedMotion();
  const g = window.Globe({ rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' }, animateIn: !reduced })(el);

  const st = {
    stats: null, trips: [], home: null, colorMode: 'continent',
    layers: { countries: true, cities: true, flights: true, wish: true },
    hover: null, selected: null,
    recap: null,          // { visited:Set, colors:Map, arcs:[], points:[], rings:[], label }
    look: 'color',
    autoRotate: !reduced, userPaused: false,
  };

  g.renderer().setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  let P = LOOKS.color;
  g.backgroundColor('rgba(0,0,0,0)').showAtmosphere(true).showGraticules(false);
  const mat = g.globeMaterial();
  function paintGlobe() {
    g.atmosphereColor(P.atmosphere).atmosphereAltitude(P.atmosphereAlt);
    mat.color.set(P.ocean);
    mat.emissive.set(P.emissive);
    mat.emissiveIntensity = P.emissiveI;
    mat.shininess = P.shininess;
    if (mat.specular) mat.specular.set(P.specular);
  }
  paintGlobe();

  const controls = g.controls();
  controls.autoRotate = st.autoRotate;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 112;
  controls.maxDistance = 720;
  controls.zoomSpeed = 0.9;
  let resumeT = null;
  controls.addEventListener('start', () => { clearTimeout(resumeT); controls.autoRotate = false; });
  controls.addEventListener('end', () => {
    clearTimeout(resumeT);
    if (st.autoRotate && !st.recap) resumeT = setTimeout(() => { controls.autoRotate = true; }, 7000);
  });

  // ---------------------------------------------------------------------------
  // Colori dei paesi
  // ---------------------------------------------------------------------------
  function visitedColor(cc) {
    if (st.recap) return st.recap.colors.get(cc) || (st.colorMode === 'mono' ? IVORY : P.cont(countries.get(cc)?.k)) || IVORY;
    const s = st.stats;
    const v = s && s.visits.get(cc);
    if (st.colorMode === 'visits') {
      const n = v ? v.trips.size : 0;
      return P.heat[Math.min(P.heat.length - 1, Math.max(0, n - 1))];
    }
    if (st.colorMode === 'year') {
      const years = s.years.map(y => +y.year);
      const y0 = Math.min(...years), y1 = Math.max(...years);
      const y = v && v.first ? +v.first.slice(0, 4) : null;
      if (!y || !years.length) return IVORY;
      return mix(P.year[0], P.year[1], y1 > y0 ? (y - y0) / (y1 - y0) : 1);
    }
    if (st.colorMode === 'mono') return IVORY;
    return P.cont(countries.get(cc)?.k) || IVORY;
  }
  const isVisited = cc => (st.recap ? st.recap.visited.has(cc) : !!(st.stats && st.stats.visited.has(cc)));
  const isWish = cc => !st.recap && st.layers.wish && !!(st.stats && st.stats.wish.has(cc));

  function capColor(f) {
    const cc = f.properties.c;
    const hov = st.hover === f || st.selected === cc;
    if (st.layers.countries && isVisited(cc)) return hov ? mix(visitedColor(cc), '#ffffff', 0.25) : visitedColor(cc);
    if (isWish(cc)) return hov ? P.landHover : P.wish;
    return hov ? P.landHover : P.land;
  }
  function sideColor(f) {
    const cc = f.properties.c;
    if (st.layers.countries && isVisited(cc)) return rgba(visitedColor(cc), P.visitedSide);
    return P.side;
  }
  function strokeColor(f) {
    const cc = f.properties.c;
    if (st.layers.countries && isVisited(cc)) return P.visitedStroke;
    if (isWish(cc)) return P.wishStroke;
    return P.stroke;
  }
  function altitude(f) {
    const cc = f.properties.c;
    let a = st.layers.countries && isVisited(cc) ? P.visitedAlt : 0.005;
    if (st.selected === cc) a += 0.025;
    else if (st.hover === f) a += 0.01;
    return a;
  }
  function label(f) {
    const cc = f.properties.c;
    const c = countries.get(cc);
    if (!c) return '';
    const v = st.stats && st.stats.visits.get(cc);
    let sub = 'Non ancora visitato';
    if (st.stats && st.stats.visited.has(cc)) {
      const n = v ? v.trips.size : 0;
      sub = n ? `Visitato · ${n} ${n === 1 ? 'viaggio' : 'viaggi'}` : 'Visitato';
      if (v && v.cities.size) sub += ` · ${v.cities.size} ${v.cities.size === 1 ? 'città' : 'città'}`;
    } else if (st.stats && st.stats.wish.has(cc)) sub = '⭐ Nella lista dei desideri';
    return `<div class="gtip"><b>${flag(cc)} ${esc(c.n)}</b><span>${esc(sub)}</span></div>`;
  }

  g.polygonsData(world.features)
    .polygonGeoJsonGeometry('geometry')
    .polygonCapCurvatureResolution(4)
    .polygonsTransitionDuration(reduced ? 0 : 700)
    .polygonLabel(label)
    .onPolygonHover(f => { st.hover = f || null; refreshPolygons(); })
    .onPolygonClick((f, ev, coords) => handlers.onCountry && handlers.onCountry(f.properties.c, coords))
    .onGlobeClick(coords => handlers.onGlobe && handlers.onGlobe(coords));

  function refreshPolygons() {
    g.polygonCapColor(f => capColor(f))
      .polygonSideColor(f => sideColor(f))
      .polygonStrokeColor(f => strokeColor(f))
      .polygonAltitude(f => altitude(f));
  }

  // ---------------------------------------------------------------------------
  // Punti (città visitate + piccoli stati senza confine disegnato)
  // ---------------------------------------------------------------------------
  function pointsData() {
    const pts = [];
    if (st.recap) return st.recap.points;
    const s = st.stats;
    if (!s) return pts;
    if (st.layers.cities) for (const c of s.cities) pts.push({ lat: c.lat, lng: c.lng, r: 0.1 + Math.min(0.12, c.count * 0.02), color: '#ffffff', alt: 0.024, tip: `${flag(c.cc)} ${c.name}`, sub: c.count > 1 ? `${c.count} visite` : 'Visitata' });
    for (const c of countries.values()) {
      if (c.g) continue;
      if (st.layers.countries && s.visited.has(c.c)) pts.push({ lat: c.lat, lng: c.lng, r: 0.45, color: visitedColor(c.c), alt: 0.03, tip: `${flag(c.c)} ${c.n}`, sub: 'Visitato', cc: c.c });
      else if (isWish(c.c)) pts.push({ lat: c.lat, lng: c.lng, r: 0.35, color: P.wishPoint, alt: 0.015, tip: `${flag(c.c)} ${c.n}`, sub: '⭐ Desiderio', cc: c.c });
    }
    return pts;
  }
  g.pointLat('lat').pointLng('lng')
    .pointColor('color').pointAltitude('alt').pointRadius('r')
    .pointResolution(12)
    .pointsTransitionDuration(reduced ? 0 : 500)
    .pointLabel(p => `<div class="gtip"><b>${esc(p.tip)}</b><span>${esc(p.sub || '')}</span></div>`)
    .onPointClick(p => { if (p.cc && handlers.onCountry) handlers.onCountry(p.cc); });

  // ---------------------------------------------------------------------------
  // Archi (voli)
  // ---------------------------------------------------------------------------
  function arcsData() {
    if (st.recap) return st.recap.arcs;
    if (!st.layers.flights || !st.stats) return [];
    return st.stats.flights.map(f => ({
      a: f.fromLL, b: f.toLL,
      colors: P.arcs,
      tip: `✈️ ${f.from} → ${f.to}`, sub: `${Math.round(f.km).toLocaleString('it-IT')} km${f.date ? ' · ' + f.date.split('-').reverse().join('/') : ''}`,
    }));
  }
  g.arcStartLat(d => d.a[0]).arcStartLng(d => d.a[1]).arcEndLat(d => d.b[0]).arcEndLng(d => d.b[1])
    .arcColor('colors')
    .arcAltitudeAutoScale(0.34)
    .arcStroke(d => d.stroke || P.arcStroke)
    .arcDashLength(d => d.dash ?? 0.6)
    .arcDashGap(d => d.gap ?? 0.12)
    .arcDashInitialGap(d => d.initGap ?? 0)
    .arcDashAnimateTime(d => (reduced ? 0 : d.anim ?? 6000))
    .arcsTransitionDuration(reduced ? 0 : 900)
    .arcLabel(d => `<div class="gtip"><b>${esc(d.tip)}</b><span>${esc(d.sub || '')}</span></div>`);

  // ---------------------------------------------------------------------------
  // Anelli (casa, tappe del recap) e segnaposto HTML
  // ---------------------------------------------------------------------------
  function ringsData() {
    if (st.recap) return st.recap.rings;
    return st.home ? [{ lat: st.home.lat, lng: st.home.lng, color: P.home, max: 2.6, speed: 1.2, period: 2000 }] : [];
  }
  g.ringLat('lat').ringLng('lng')
    .ringColor(d => t => rgba(d.color, Math.max(0, 1 - t)))
    .ringMaxRadius('max').ringPropagationSpeed('speed').ringRepeatPeriod('period')
    .ringAltitude(0.004);

  function htmlData() {
    if (st.recap) return st.recap.label ? [st.recap.label] : [];
    return st.home ? [{ lat: st.home.lat, lng: st.home.lng, text: '🏠 ' + (st.home.name || 'Casa'), kind: 'home' }] : [];
  }
  g.htmlLat('lat').htmlLng('lng').htmlAltitude(0.04)
    .htmlTransitionDuration(0)
    .htmlElement(d => {
      const e = document.createElement('div');
      e.className = `gpin gpin-${d.kind || 'place'}`;
      e.textContent = d.text;   // testo, mai HTML: niente injection
      return e;
    })
    .htmlElementVisibilityModifier((e, visible) => { e.style.opacity = visible ? 1 : 0; });

  function refreshAll() {
    refreshPolygons();
    g.pointsData(pointsData()).arcsData(arcsData()).ringsData(ringsData()).htmlElementsData(htmlData());
  }

  // ---------------------------------------------------------------------------
  // API pubblica
  // ---------------------------------------------------------------------------
  const api = {
    raw: g,
    setData({ stats, home, colorMode, layers }) {
      st.stats = stats;
      st.home = home && Number.isFinite(home.lat) ? home : null;
      if (colorMode) st.colorMode = colorMode;
      if (layers) st.layers = { ...st.layers, ...layers };
      refreshAll();
    },
    setLayers(layers) { st.layers = { ...st.layers, ...layers }; refreshAll(); },
    layers: () => ({ ...st.layers }),
    setColorMode(m) { st.colorMode = m; refreshPolygons(); g.pointsData(pointsData()); },
    setLook(look) {
      if (!LOOKS[look] || look === st.look) return;
      st.look = look; P = LOOKS[look];
      paintGlobe();
      refreshAll();
    },
    select(cc) { st.selected = cc || null; refreshPolygons(); },
    size(w, h) { g.width(w).height(h); },
    offset(x, y) { g.globeOffset([x, y]); },
    pov: () => g.pointOfView(),
    flyTo(lat, lng, altitude, ms = 1400) {
      const cur = g.pointOfView();
      g.pointOfView({ lat, lng, altitude: altitude ?? cur.altitude }, reduced ? 0 : ms);
    },
    zoom(factor) {
      const cur = g.pointOfView();
      const alt = Math.min(6, Math.max(0.14, cur.altitude * factor));
      g.pointOfView({ ...cur, altitude: alt }, reduced ? 0 : 450);
    },
    setAutoRotate(on) { st.autoRotate = on; controls.autoRotate = on && !st.recap; },
    autoRotating: () => st.autoRotate,
    focusCountry(cc) {
      const c = countries.get(cc);
      if (!c) return;
      const big = c.a > 3e6 ? 2.0 : c.a > 8e5 ? 1.4 : c.a > 1e5 ? 0.9 : 0.6;
      api.flyTo(c.lat, c.lng, big, 1300);
    },
    focusPoints(points, ms = 1400) {
      const pts = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (!pts.length) return;
      // centro sulla sfera (media dei vettori) per non sbagliare a cavallo dell'antimeridiano
      let x = 0, y = 0, z = 0;
      for (const p of pts) {
        const la = p.lat * Math.PI / 180, lo = p.lng * Math.PI / 180;
        x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
      }
      const lat = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
      const lng = Math.atan2(y, x) * 180 / Math.PI;
      const spread = Math.max(...pts.map(p => haversine(lat, lng, p.lat, p.lng)));
      api.flyTo(lat, lng, Math.min(2.6, Math.max(0.55, spread / 2600 + 0.35)), ms);
    },
    resetView(home) {
      const h = home || st.home;
      api.flyTo(h ? h.lat : 30, h ? h.lng : 12, api.fitAltitude(), 1200);
    },
    // distanza a cui il globo intero sta nella larghezza dello schermo (campo visivo verticale 50°)
    fitAltitude() {
      const aspect = window.innerWidth / window.innerHeight;
      return Math.max(2.3, 1.18 / (Math.tan(25 * Math.PI / 180) * aspect) - 1);
    },
    pause() { g.pauseAnimation(); },
    resume() { g.resumeAnimation(); },

    // --- Recap: il globo parte "vuoto" e si accende passo passo ---
    recapBegin() {
      st.recap = { visited: new Set(), colors: new Map(), arcs: [], points: [], rings: [], label: null };
      controls.autoRotate = false;
      refreshAll();
    },
    recapCountry(cc) {
      if (!st.recap || !cc) return;
      st.recap.visited.add(cc);
      const color = visitedColor(cc);
      refreshPolygons();
      const c = countries.get(cc);
      if (c && !c.g) { st.recap.points.push({ lat: c.lat, lng: c.lng, r: 0.35, color: color || IVORY, alt: 0.02, tip: c.n }); g.pointsData([...st.recap.points]); }
    },
    recapArc(a, b, ms = 1600) {
      if (!st.recap) return;
      st.recap.arcs.push({ a, b, colors: P.recapArcs, stroke: 0.5, dash: 1, gap: 1, initGap: 1, anim: ms });
      g.arcsData([...st.recap.arcs]);
      // dopo il "disegno" l'arco resta pieno
      setTimeout(() => {
        if (!st.recap) return;
        const last = st.recap.arcs.find(x => x.a === a && x.b === b);
        if (last) { last.dash = 0.6; last.gap = 0.12; last.initGap = 0; last.anim = 6000; last.stroke = P.arcStroke; g.arcsData([...st.recap.arcs]); }
      }, ms);
    },
    recapPlace(lat, lng, text, color = '#ffffff') {
      if (!st.recap) return;
      st.recap.points.push({ lat, lng, r: 0.14, color: '#ffffff', alt: 0.024, tip: text });
      st.recap.rings = [{ lat, lng, color, max: 3, speed: 1.8, period: 1100 }];
      st.recap.label = { lat, lng, text, kind: 'place' };
      g.pointsData([...st.recap.points]).ringsData(st.recap.rings).htmlElementsData([st.recap.label]);
    },
    recapEnd(keep = false) {
      if (!keep) st.recap = null;
      else if (st.recap) { st.recap.label = null; st.recap.rings = []; }
      controls.autoRotate = st.autoRotate;
      refreshAll();
    },
    recapActive: () => !!st.recap,
  };
  refreshAll();
  return api;
}
