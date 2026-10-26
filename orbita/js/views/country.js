/* ============================================================================
   country.js — scheda di un paese (toccato sul globo)
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import { countries, CONTINENTS } from '../geo.js';
import { esc, flag, fmtDate, fmtInt, icon, openModal, uid, toast } from '../util.js';
import { tripCard } from './common.js';

export function openCountry(cc) {
  const c = countries.get(cc);
  if (!c) return;
  const g = app.globe;
  if (g) { g.select(cc); g.focusCountry(cc); }
  const m = openModal({ title: c.n, body: '<div></div>', onClose: () => g && g.select(null) });
  const render = () => {
    const s = app.stats;
    const st = store.get();
    const v = s.visits.get(cc);
    const viaTrips = v && v.trips.size > 0;
    const isHome = st.profile.home && st.profile.home.cc === cc && st.profile.countHome;
    const marked = st.marks.visited.includes(cc);
    const wished = st.marks.wish.includes(cc);
    const visited = s.visited.has(cc);
    const trips = store.countedTrips().filter(t => t.stops.some(x => x.cc === cc)).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    const cities = s.cities.filter(x => x.cc === cc);
    const k = CONTINENTS[c.k];
    let html = `<div class="country-hero"><span class="fl">${flag(cc)}</span><h2>${esc(c.n)}</h2>
      <div class="row" style="justify-content:center;gap:6px;margin-top:8px">
        <span class="pill">${esc(k.n)}</span>
        ${visited ? '<span class="pill green">✓ Visitato</span>' : wished ? '<span class="pill yellow">⭐ Desiderio</span>' : ''}
        ${!c.s ? '<span class="pill">Territorio</span>' : ''}
      </div></div>`;
    if (viaTrips) {
      html += `<div class="widgets" style="margin-top:16px">
        <div class="widget" style="min-height:0;--i:0"><div class="w-label">${icon('map')}Viaggi</div><div class="w-value">${fmtInt(v.trips.size)}</div></div>
        <div class="widget" style="min-height:0;--i:1"><div class="w-label">${icon('pin')}Città</div><div class="w-value">${fmtInt(v.cities.size)}</div></div>
        ${v.first ? `<div class="widget w2" style="min-height:0;--i:2"><div class="w-label">${icon('calendar')}Prima visita</div><div class="headline" style="margin-top:6px">${esc(fmtDate(v.first))}</div>${v.last && v.last !== v.first ? `<div class="w-sub">Ultima: ${esc(fmtDate(v.last))}</div>` : ''}</div>` : ''}
      </div>`;
    }
    html += `<div class="country-actions">
      ${viaTrips || isHome
        ? `<button class="btn" type="button" disabled>${icon('check')}${isHome && !viaTrips ? 'Paese di casa' : 'Visitato'}</button>`
        : `<button class="btn ${marked ? 'btn-prominent' : ''}" type="button" data-act="visited">${icon('check')}${marked ? 'Visitato' : 'Ci sono stato'}</button>`}
      <button class="btn ${wished ? 'btn-prominent' : ''}" type="button" data-act="wish" ${visited ? 'disabled' : ''}>${icon('heart')}${wished ? 'Nei desideri' : 'Lo sogno'}</button>
    </div>
    <button class="btn btn-block" type="button" data-act="trip" style="margin-top:10px">${icon('plus')}Nuovo viaggio in ${esc(c.n)}</button>`;
    if (trips.length) html += `<div class="list-header">I tuoi viaggi qui</div><div class="trip-list">${trips.map((t, i) => tripCard(t, i)).join('')}</div>`;
    if (cities.length) html += `<div class="list-header">Città visitate</div><div class="chips-scroll" style="flex-wrap:wrap;margin:0">${cities.map(x => `<button type="button" disabled style="opacity:1">${esc(x.name)}${x.count > 1 ? ` ×${x.count}` : ''}</button>`).join('')}</div>`;
    m.body.innerHTML = html;
  };
  render();
  m.body.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const st = store.get();
      if (b.dataset.act === 'visited') { const on = !st.marks.visited.includes(cc); store.setMark(cc, on ? 'visited' : null); toast(on ? `${flag(cc)} Segnato come visitato` : 'Segno tolto', { type: on ? 'ok' : 'info', ms: 1800 }); }
      if (b.dataset.act === 'wish') { const on = !st.marks.wish.includes(cc); store.setMark(cc, on ? 'wish' : null); toast(on ? '⭐ Aggiunto ai desideri' : 'Tolto dai desideri', { ms: 1800 }); }
      if (b.dataset.act === 'trip') {
        m.close();
        const c2 = countries.get(cc);
        app.openEditor(null, { title: `Viaggio in ${c2.n}`, stops: [{ id: uid(), name: c2.n, cc, lat: c2.lat, lng: c2.lng, region: '', regionKey: '', date: '', nights: 0, kind: 'country' }] });
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(render));
      return;
    }
    if (e.target.closest('.trip-card')) m.close();
  });
}
