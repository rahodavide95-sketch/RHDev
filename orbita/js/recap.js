/* ============================================================================
   recap.js — il Recap animato, in stile "storie"
   Il globo parte spento e si accende viaggio dopo viaggio: la camera vola di
   tappa in tappa, gli archi dei voli si disegnano, i contatori salgono.
   ============================================================================ */
import { app } from './ctx.js';
import * as store from './store.js';
import { countries, CONTINENTS, countryName } from './geo.js';
import { tripStatus } from './model.js';
import { distKm } from './stats.js';
import { $, esc, flag, fmtInt, fmtCompact, fmtRange, icon, toast, openModal, sleep, prefersReducedMotion } from './util.js';

const CANCEL = Symbol('cancel');
let run = null;

function pastTrips() {
  return store.countedTrips().filter(t => tripStatus(t, app.today) !== 'upcoming');
}

export function openRecapPicker() {
  const trips = pastTrips();
  if (!trips.length) { toast('Aggiungi almeno un viaggio per vedere il recap ✈️'); return; }
  const years = [...new Set(trips.map(t => (t.start || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const last = [...trips].sort((a, b) => (b.start || '').localeCompare(a.start || ''))[0];
  const m = openModal({
    title: 'Recap',
    body: `<button class="widget w2 vivid" type="button" data-all style="--c:var(--indigo);width:100%;text-align:left;border:0;color:#fff;cursor:pointer">
        <div class="w-label">${icon('play')}Il tuo mondo</div>
        <div class="headline" style="margin-top:10px;font-size:20px">Tutti i viaggi, dal primo all'ultimo</div>
        <div class="w-sub">${trips.length} ${trips.length === 1 ? 'viaggio' : 'viaggi'} · circa ${Math.max(1, Math.round(trips.length * 0.25))} min</div>
      </button>
      ${years.length ? `<div class="list-header">Un anno</div><div class="chips-scroll" style="flex-wrap:wrap;margin:0">${years.map(y => `<button type="button" data-year="${y}">${y}</button>`).join('')}</div>` : ''}
      <div class="list-header">L'ultimo viaggio</div>
      <button class="list-row has-icon list" type="button" data-trip="${esc(last.id)}"><span class="app-ic" style="--c:${esc(last.color)};font-size:18px">${esc(last.emoji)}</span><span class="grow"><b>${esc(last.title)}</b><small>${esc(fmtRange(last.start, last.end))}</small></span>${icon('play')}</button>`,
  });
  m.body.addEventListener('click', e => {
    if (e.target.closest('[data-all]')) { m.close(); startRecap({}); }
    const y = e.target.closest('[data-year]');
    if (y) { m.close(); startRecap({ year: y.dataset.year }); }
    const t = e.target.closest('[data-trip]');
    if (t) { m.close(); startRecap({ tripId: t.dataset.trip }); }
  });
}

// Attesa che rispetta pausa, velocità e chiusura (misura il tempo reale trascorso)
async function wait(ms) {
  let left = ms;
  let t = performance.now();
  while (left > 0) {
    if (!run || run.cancelled) throw CANCEL;
    await sleep(40);
    const now = performance.now();
    if (run && !run.paused) left -= (now - t) * run.speed;
    t = now;
  }
  if (!run || run.cancelled) throw CANCEL;
}

function legsOf(t) {
  const items = [];
  t.stops.forEach((s, i) => items.push({ kind: 'stop', date: s.date, i, s }));
  t.flights.forEach((f, i) => items.push({ kind: 'flight', date: f.date, i, f }));
  const dated = items.filter(x => x.date && x.date <= app.today).sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.i - b.i : a.kind === 'flight' ? -1 : 1));
  return [...dated, ...items.filter(x => !x.date)];
}

function hud(counts) {
  const items = [['countries', 'Paesi'], ['cities', 'Città'], ['km', 'Km'], ['flights', 'Voli']];
  $('#recap-hud').innerHTML = items.map(([k, l]) => `<div class="glass hud-item" data-h="${k}"><b>${k === 'km' ? fmtCompact(counts[k]) : fmtInt(counts[k])}</b><span>${l}</span></div>`).join('');
}
function bump(counts, key) {
  const el = document.querySelector(`#recap-hud [data-h="${key}"]`);
  if (!el) return;
  el.querySelector('b').textContent = key === 'km' ? fmtCompact(counts[key]) : fmtInt(counts[key]);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function card(html) {
  const c = $('#recap-card');
  c.classList.remove('in');
  setTimeout(() => { c.innerHTML = html; if (html) c.classList.add('in'); }, html ? 180 : 0);
}
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F', '#FF9F0A', '#FFD60A', '#30D158', '#64D2FF'];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', (Math.random() * 40 - 20) + 'vw');
    p.style.animationDuration = 2.4 + Math.random() * 2.2 + 's';
    p.style.animationDelay = Math.random() * 0.6 + 's';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5500);
}

export async function startRecap({ year, tripId } = {}) {
  const g = app.globe;
  if (!g) { toast('Il globo 3D non è disponibile su questo dispositivo'); return; }
  let trips = pastTrips();
  if (tripId) trips = store.countedTrips().filter(t => t.id === tripId);
  else if (year) trips = trips.filter(t => (t.start || '').startsWith(year));
  trips.sort((a, b) => (a.start || '0000').localeCompare(b.start || '0000'));
  if (!trips.length) { toast('Niente da raccontare, per ora'); return; }
  if (run) stop();

  run = { cancelled: false, paused: false, speed: prefersReducedMotion() ? 4 : 1 };
  const counts = { countries: 0, cities: 0, km: 0, flights: 0 };
  const seenC = new Set(), seenCity = new Set();
  const single = trips.length === 1;

  document.body.classList.add('recap-on');
  $('#layers-pop').hidden = true;
  const box = $('#recap');
  box.hidden = false;
  $('#recap-title').innerHTML = `<small>${single ? 'Rivivi il viaggio' : 'Recap'}</small>${esc(single ? trips[0].title : year ? `Il tuo ${year}` : 'Il tuo mondo')}`;
  $('#recap-bars').innerHTML = trips.map(() => '<span><i></i></span>').join('');
  $('#recap-speed').textContent = `${run.speed}×`;
  $('#recap-pause').innerHTML = icon('pause');
  hud(counts);
  card('');
  g.recapBegin();
  const home = store.get().profile.home;

  try {
    const first = trips[0].stops[0] || (trips[0].flights[0] && { lat: trips[0].flights[0].fromLL[0], lng: trips[0].flights[0].fromLL[1] });
    const start = home || first || { lat: 30, lng: 12 };
    g.flyTo(start.lat, start.lng, g.fitAltitude(), 1400);
    await wait(1500);

    for (const [ti, t] of trips.entries()) {
      const bar = document.querySelectorAll('#recap-bars span')[ti];
      bar.classList.remove('done');
      card(`<div class="e">${esc(t.emoji)}</div><h3>${esc(t.title)}</h3><p>${esc(fmtRange(t.start, t.end))}</p>`);
      await wait(1300);
      const legs = legsOf(t);
      for (const [li, leg] of legs.entries()) {
        if (leg.kind === 'flight') {
          const f = leg.f;
          const km = f.km || distKm(f.fromLL, f.toLL);
          const mid = { lat: (f.fromLL[0] + f.toLL[0]) / 2, lng: f.fromLL[1] + (((f.toLL[1] - f.fromLL[1] + 540) % 360) - 180) / 2 };
          g.flyTo(mid.lat, mid.lng, Math.min(3, Math.max(1.1, km / 3800 + 0.7)), 1200 / run.speed);
          await wait(500);
          g.recapArc(f.fromLL, f.toLL, 1500 / run.speed);
          card(`<div class="e">✈️</div><h3 class="route">${esc(f.from)} → ${esc(f.to)}</h3><p>${esc(f.fromCity)} → ${esc(f.toCity)} · ${fmtInt(km)} km</p>`);
          await wait(1500);
          counts.km += km; counts.flights++;
          bump(counts, 'km'); bump(counts, 'flights');
        } else {
          const s = leg.s;
          g.flyTo(s.lat, s.lng, s.kind === 'country' ? 1.5 : 0.95, 1300 / run.speed);
          await wait(1100);
          const newCountry = s.cc && !seenC.has(s.cc);
          g.recapPlace(s.lat, s.lng, `${flag(s.cc)} ${s.name}`, CONTINENTS[countries.get(s.cc)?.k]?.color || '#ffffff');
          if (newCountry) {
            seenC.add(s.cc);
            g.recapCountry(s.cc, CONTINENTS[countries.get(s.cc)?.k]?.color);
            counts.countries++;
            bump(counts, 'countries');
            card(`<div class="e">${flag(s.cc)}</div><h3>${esc(countryName(s.cc))}</h3><p>Nuovo timbro sul passaporto · ${esc(s.name)}</p>`);
          } else {
            card(`<div class="e">📍</div><h3>${esc(s.name)}</h3><p>${esc([s.region, countryName(s.cc)].filter(Boolean).join(', '))}${s.nights ? ` · ${s.nights} ${s.nights === 1 ? 'notte' : 'notti'}` : ''}</p>`);
          }
          const key = s.cc + '|' + s.name.toLowerCase();
          if (s.kind !== 'country' && !seenCity.has(key)) { seenCity.add(key); counts.cities++; bump(counts, 'cities'); }
          await wait(1300);
        }
        bar.querySelector('i').style.width = `${((li + 1) / legs.length) * 100}%`;
      }
      bar.classList.add('done');
      await wait(400);
    }

    // finale
    g.flyTo(home ? home.lat : 25, home ? home.lng : 10, g.fitAltitude() + 0.3, 2200);
    g.recapEnd(true);
    $('#recap-hud').innerHTML = '';
    card(`<div class="recap-final"><div class="big aurora-text">${fmtInt(counts.countries)}</div>
      <h3>${counts.countries === 1 ? 'paese' : 'paesi'} ${single ? 'in questo viaggio' : 'nel tuo mondo'}</h3>
      <p>${fmtInt(counts.cities)} città · ${fmtInt(counts.km)} km · ${fmtInt(counts.flights)} voli</p>
      <p style="margin-top:8px">Il mondo è più piccolo quando lo giri ✨</p>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn btn-sm" type="button" data-again>${icon('rotate')}Rivedi</button><button class="btn btn-sm btn-prominent" type="button" data-end>Chiudi</button></div></div>`);
    confetti();
    setTimeout(() => {
      const c = $('#recap-card');
      c.querySelector('[data-again]')?.addEventListener('click', () => startRecap({ year, tripId }));
      c.querySelector('[data-end]')?.addEventListener('click', stop);
    }, 250);
  } catch (e) {
    if (e !== CANCEL) { console.error(e); stop(); }
  }
}

export function stop() {
  if (run) run.cancelled = true;
  run = null;
  document.body.classList.remove('recap-on');
  $('#recap').hidden = true;
  $('#recap-card').classList.remove('in');
  if (app.globe) app.globe.recapEnd(false);
  app.refresh();
}

// controlli
document.addEventListener('click', e => {
  if (!run && !document.body.classList.contains('recap-on')) return;
  if (e.target.closest('#recap-close')) stop();
  if (e.target.closest('#recap-pause') && run) {
    run.paused = !run.paused;
    $('#recap-pause').innerHTML = icon(run.paused ? 'play' : 'pause');
    $('#recap-pause').setAttribute('aria-label', run.paused ? 'Riprendi' : 'Pausa');
  }
  if (e.target.closest('#recap-speed') && run) {
    run.speed = run.speed === 1 ? 2 : run.speed === 2 ? 4 : 1;
    $('#recap-speed').textContent = `${run.speed}×`;
  }
});
document.addEventListener('keydown', e => {
  if (!document.body.classList.contains('recap-on') || document.querySelector('.modal-wrap')) return;
  if (e.key === 'Escape') stop();
  if (e.key === ' ' && run) { e.preventDefault(); $('#recap-pause').click(); }
});
