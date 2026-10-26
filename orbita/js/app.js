/* ============================================================================
   app.js — avvio, navigazione, foglio a scatti, barra delle schede, globo
   ============================================================================ */
import { app } from './ctx.js';
import * as store from './store.js';
import * as cloud from './cloud.js';
import { loadBase, countries, CONTINENTS, CONTINENT_ORDER } from './geo.js';
import { computeStats } from './stats.js';
import { createGlobe } from './globe.js';
import { $, $$, icon, esc, todayStr, toast, fmtInt, fmt1, orbitaMark, initials } from './util.js';
import * as home from './views/home.js';
import * as trips from './views/trips.js';
import * as passport from './views/passport.js';
import * as account from './views/account.js';
import { openEditor } from './views/editor.js';
import { openCountry } from './views/country.js';
import { openShare } from './views/share.js';
import { openAuth, onAuthEvent, checkMfaOnBoot, offerGuestAdoption } from './views/auth.js';
import { openRecapPicker, startRecap } from './recap.js';

const VIEWS = { home, trips, passport, account };
const TAB_OF = { home: 'home', trips: 'trips', passport: 'passport', account: 'account' };
const isWide = () => window.innerWidth >= 900;

app.openEditor = openEditor;
app.openCountry = openCountry;
app.openShare = openShare;
app.openAuth = openAuth;
app.startRecap = startRecap;

// ---------------------------------------------------------------------------
// Statistiche + globo
// ---------------------------------------------------------------------------
function recompute() {
  app.today = todayStr();
  const st = store.get();
  app.stats = computeStats({ trips: store.countedTrips(), marks: st.marks, profile: st.profile, countries, today: app.today });
  if (app.globe && !app.globe.recapActive()) app.globe.setData({ stats: app.stats, home: st.profile.home, colorMode: st.profile.colorMode });
  renderChrome();
}
let refreshQueued = false;
app.refresh = () => {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; recompute(); app.render(); });
};

// ---------------------------------------------------------------------------
// Navigazione (hash): #/  #/viaggi  #/viaggio/<id>  #/passaporto  #/account  #/invito/<id>
// ---------------------------------------------------------------------------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [first = '', ...rest] = h.split('/').map(s => { try { return decodeURIComponent(s); } catch { return ''; } });
  if (first === 'viaggi') return { name: 'trips', params: [] };
  if (first === 'viaggio' && rest[0]) return { name: 'trips', params: [rest[0]] };
  if (first === 'passaporto') return { name: 'passport', params: [] };
  if (first === 'account') return { name: 'account', params: [] };
  if (first === 'invito' && rest[0]) return { name: 'account', params: ['invite', rest[0]] };
  return { name: 'home', params: [] };
}
app.go = hash => { if (location.hash === hash) app.render(); else location.hash = hash; };

let lastRouteKey = '';
app.render = () => {
  const view = $('#view');
  const r = parseRoute();
  const key = r.name + '/' + r.params.join('/');
  const changed = key !== lastRouteKey;
  app.route = r;
  const keepScroll = !changed ? view.scrollTop : 0;
  try {
    VIEWS[r.name].render(view, r.params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="fatal"><h2>Ops</h2><p class="secondary">Qualcosa è andato storto in questa schermata.</p><a class="btn" href="#/">Torna al globo</a></div>`;
  }
  view.scrollTop = keepScroll;
  if (changed) {
    view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter');
    lastRouteKey = key;
    setActiveTab(TAB_OF[r.name]);
    if (!isWide()) app.setSheet(r.name === 'home' ? 'half' : 'full');
    document.title = { home: 'Orbita', trips: 'Viaggi · Orbita', passport: 'Passaporto · Orbita', account: 'Profilo · Orbita' }[r.name] || 'Orbita';
  }
};
window.addEventListener('hashchange', () => app.render());

// ---------------------------------------------------------------------------
// Barra delle schede con lente che scivola
// ---------------------------------------------------------------------------
function setActiveTab(tab) {
  const bar = $('#tabbar');
  let active = null;
  $$('a[data-tab]', bar).forEach(a => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('active', on);
    if (on) { a.setAttribute('aria-current', 'page'); active = a; } else a.removeAttribute('aria-current');
  });
  moveLens(active);
}
function moveLens(a) {
  const lens = $('#tab-lens');
  if (!a) { lens.style.opacity = '0'; return; }
  lens.style.opacity = '1';
  lens.style.width = a.offsetWidth + 'px';
  lens.style.transform = `translateX(${a.offsetLeft - 4}px)`;
}

// ---------------------------------------------------------------------------
// Foglio a scatti (telefono): peek / half / full, trascinabile dalla maniglia
// ---------------------------------------------------------------------------
const DETENTS = ['peek', 'half', 'full'];
app.setSheet = d => {
  if (!DETENTS.includes(d)) return;
  document.body.dataset.sheet = d;
  $('#panel').style.height = '';
  updateGlobeLayout();
};
function initSheetDrag() {
  const grip = $('#panel-grip'), panel = $('#panel');
  let startY = 0, startH = 0, dragging = false, moved = false;
  grip.addEventListener('pointerdown', e => {
    if (isWide()) return;
    dragging = true; moved = false; startY = e.clientY; startH = panel.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    panel.style.height = Math.max(120, Math.min(window.innerHeight - 60, startH - dy)) + 'px';
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    if (!moved) {   // tocco: passa allo scatto successivo
      const i = DETENTS.indexOf(document.body.dataset.sheet);
      app.setSheet(DETENTS[(i + 1) % DETENTS.length]);
      return;
    }
    const h = panel.getBoundingClientRect().height;
    const vh = window.innerHeight;
    const targets = { peek: 200, half: vh * 0.48, full: vh - 64 };
    const best = Object.entries(targets).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
    app.setSheet(best);
    void e;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// Il globo sta al centro dello spazio libero (a destra del pannello o sopra il foglio)
let offAnim = null, curOff = [0, 0];
function updateGlobeLayout() {
  if (!app.globe) return;
  app.globe.size(window.innerWidth, window.innerHeight);
  let target;
  if (isWide()) target = [(410 + 28) / 2, 0];
  else {
    const d = document.body.dataset.sheet;
    const sheetH = d === 'peek' ? 200 : d === 'half' ? window.innerHeight * 0.48 : window.innerHeight * 0.48;
    target = [0, -Math.round(sheetH / 2) + 20];
  }
  cancelAnimationFrame(offAnim);
  const from = [...curOff], t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - p, 3);
    curOff = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e];
    app.globe.offset(curOff[0], curOff[1]);
    if (p < 1) offAnim = requestAnimationFrame(step);
  };
  offAnim = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Elementi fissi: pillola del mondo, avatar, controlli del globo, livelli
// ---------------------------------------------------------------------------
function renderChrome() {
  const s = app.stats;
  if (!s) return;
  $('#top-chips').innerHTML = `${orbitaMark('wm')}<b>${fmtInt(s.sovereignCount)}</b> ${s.sovereignCount === 1 ? 'paese' : 'paesi'}<span>· ${fmt1(s.worldPct)}%</span>`;
  const user = cloud.getUser();
  const st = store.get();
  const ini = initials(st.profile.name, user && user.email);
  const sync = cloud.getStatus().status;
  $('#avatar-btn').innerHTML = (ini ? `<span class="av-ring">${esc(ini)}</span>` : icon('user'))
    + (user ? `<span class="sync" data-s="${esc(sync)}" title="Sincronizzazione"></span>` : '');
}

function initControls() {
  $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const ICONS = { in: 'plus', out: 'minus', rotate: 'rotate', home: 'home', layers: 'layers' };
  $$('#globe-ctrls [data-g]').forEach(b => { b.innerHTML = icon(ICONS[b.dataset.g]); });
  $('.recap-ic').innerHTML = icon('play');
  $('#recap-pause').innerHTML = icon('pause');
  $('#recap-close').innerHTML = icon('x');

  $('#globe-ctrls').addEventListener('click', e => {
    const b = e.target.closest('[data-g]');
    if (!b || !app.globe) return;
    const g = b.dataset.g;
    if (g === 'in') app.globe.zoom(0.62);
    if (g === 'out') app.globe.zoom(1.6);
    if (g === 'home') app.globe.resetView(store.get().profile.home);
    if (g === 'rotate') { const on = !app.globe.autoRotating(); app.globe.setAutoRotate(on); b.setAttribute('aria-pressed', String(on)); toast(on ? 'Rotazione automatica attiva' : 'Rotazione in pausa', { ms: 1600 }); }
    if (g === 'layers') toggleLayers();
  });
  $('#avatar-btn').addEventListener('click', () => app.go('#/account'));
  $('#tab-add').addEventListener('click', () => openEditor());
  $('#recap-fab').addEventListener('click', () => openRecapPicker());
  document.addEventListener('click', e => {
    const pop = $('#layers-pop');
    if (!pop.hidden && !e.target.closest('#layers-pop') && !e.target.closest('[data-g="layers"]')) pop.hidden = true;
  });
}

function toggleLayers() {
  const pop = $('#layers-pop');
  if (!pop.hidden) { pop.hidden = true; return; }
  const L = app.globe.layers();
  const mode = store.get().profile.colorMode;
  const sw = (k, label) => `<label class="list-row" style="min-height:46px;padding:6px 12px"><span class="grow">${label}</span><span class="switch"><input type="checkbox" data-layer="${k}" ${L[k] ? 'checked' : ''}><span></span></span></label>`;
  pop.innerHTML = `<h4>Mostra sul globo</h4>
    <div class="list">${sw('countries', 'Paesi visitati')}${sw('cities', 'Città')}${sw('flights', 'Voli')}${sw('wish', 'Lista dei desideri')}</div>
    <h4>Colora i paesi per</h4>
    <div class="seg" role="group" aria-label="Colori">
      ${[['continent', 'Continente'], ['visits', 'Visite'], ['year', 'Anno']].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}
    </div>
    <div class="legend" id="legend"></div>`;
  renderLegend(mode);
  pop.hidden = false;
  pop.onchange = e => { const i = e.target.closest('[data-layer]'); if (i) app.globe.setLayers({ [i.dataset.layer]: i.checked }); };
  pop.onclick = e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    $$('[data-mode]', pop).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    store.updateProfile({ colorMode: b.dataset.mode });
    app.globe.setColorMode(b.dataset.mode);
    renderLegend(b.dataset.mode);
  };
}
function renderLegend(mode) {
  const el = $('#legend');
  if (!el) return;
  if (mode === 'continent') el.innerHTML = CONTINENT_ORDER.map(k => `<span><i style="background:${CONTINENTS[k].color}"></i>${CONTINENTS[k].n}</span>`).join('');
  else if (mode === 'visits') el.innerHTML = ['1', '2', '3', '4', '5+'].map((n, i) => `<span><i style="background:${['#64D2FF', '#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F'][i]}"></i>${n}</span>`).join('');
  else el.innerHTML = '<span><i style="background:#64D2FF"></i>Prima visita più lontana</span><span><i style="background:#FF9F0A"></i>Più recente</span>';
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
async function boot() {
  initControls();
  initSheetDrag();
  try {
    await loadBase();
  } catch (e) {
    $('#boot').innerHTML = `<div class="fatal"><h2>Connessione assente</h2><p class="secondary">Non riesco a caricare i dati del globo. Controlla la connessione e ricarica la pagina.</p></div>`;
    return;
  }
  const user = await cloud.init();
  store.load(user ? user.id : 'guest');
  // token o errori di Supabase arrivati nell'indirizzo: puliamo
  if (location.hash && !location.hash.startsWith('#/')) {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('error_description')) toast(p.get('error_description').replace(/\+/g, ' '), { type: 'error', ms: 6000 });
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }

  try {
    app.globe = createGlobe($('#globe'), {
      onCountry: (cc, coords) => {
        if (app.pickOnGlobe && coords) { app.pickOnGlobe(coords); return; }
        openCountry(cc);
      },
      onGlobe: coords => { if (app.pickOnGlobe) app.pickOnGlobe(coords); else app.globe.select(null); },
    });
  } catch (e) {
    console.error(e);
    $('#globe').innerHTML = '<div class="fatal" style="padding-top:20vh"><h2>Globo non disponibile</h2><p class="secondary">Il tuo browser non supporta la grafica 3D (WebGL). Tutto il resto funziona.</p></div>';
  }

  store.on(() => app.refresh());
  cloud.on((ev, extra) => {
    if (ev === 'status') renderChrome();
    if (ev === 'auth') onAuthEvent(extra);
  });

  recompute();
  updateGlobeLayout();
  app.render();
  if (app.globe) app.globe.resetView(store.get().profile.home);
  setTimeout(() => $('#boot').classList.add('out'), 250);
  window.addEventListener('resize', () => { updateGlobeLayout(); setActiveTab(TAB_OF[app.route.name]); });

  if (user) {
    if (!(await checkMfaOnBoot())) {
      await offerGuestAdoption();
      cloud.sync();
    }
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
