/* ============================================================================
   home.js — "Il tuo mondo": anello del mondo, widget, prossimo viaggio
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import { CONTINENTS, CONTINENT_ORDER, countryName } from '../geo.js';
import { esc, flag, fmtInt, fmt1, fmtCompact, fmtRange, daysBetween, icon, toast, confirmDialog, orbitaMark } from '../util.js';
import { tripCard, widget, ring, animateIn } from './common.js';
import { loadDemo, hasDemo, removeDemo } from '../demo.js';
import { tripStatus } from '../model.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

export function render(el) {
  const s = app.stats;
  const st = store.get();
  const name = st.profile.name ? st.profile.name.split(' ')[0] : '';
  const trips = store.ownTrips().concat(store.sharedTrips().map(x => x.trip));
  const empty = !trips.length && !s.visited.size;

  let html = `<div class="nav-row"><div><div class="eyebrow">${esc(greeting())}${name ? ',' : ''}</div>
      <h1 class="large-title">${name ? esc(name) : 'Il tuo mondo'}</h1></div></div>`;

  if (hasDemo()) {
    html += `<div class="list" style="margin-top:8px"><div class="list-row has-icon"><span class="app-ic">${icon('sparkle')}</span>
      <span class="grow"><b>Stai guardando un esempio</b><small>Quando vuoi, toglilo e inizia coi tuoi viaggi.</small></span>
      <button class="btn btn-sm" type="button" data-act="rm-demo">Rimuovi</button></div></div>`;
  }

  if (empty) {
    html += `<div class="empty"><span class="big-emoji">${orbitaMark('emp', 'mark big-mark')}</span>
      <h2 class="title2">Il tuo mondo ti aspetta</h2>
      <p class="secondary" style="margin-top:8px">Aggiungi i viaggi che hai fatto: il globo si accende paese dopo paese e il passaporto si riempie di timbri.</p>
      <div class="stack" style="margin-top:20px">
        <button class="btn btn-prominent btn-block" type="button" data-act="new">${icon('plus')}Aggiungi il primo viaggio</button>
        <button class="btn btn-block" type="button" data-act="mark">${icon('pin')}Segna i paesi già visitati</button>
        <button class="btn btn-plain btn-block" type="button" data-act="demo">${icon('sparkle')}Guarda un esempio</button>
      </div></div>`;
    el.innerHTML = html;
    bind(el);
    return;
  }

  const lvl = s.level;
  html += `<div class="widget w2" style="margin-top:12px;--i:0">
      <div class="hero-ring">
        <div class="ring">${ring(s.worldPct, 'rgHome')}<div class="ring-center"><b>${fmt1(s.worldPct)}%</b><span>del mondo</span></div></div>
        <div class="grow">
          <div class="w-value" style="margin-top:0">${fmtInt(s.sovereignCount)}<small>/ ${s.sovereignTotal}</small></div>
          <div class="w-sub" style="font-size:14px">paesi visitati${s.territoryCount ? ` · +${s.territoryCount} territori` : ''}</div>
          <div style="margin-top:10px"><span class="pill yellow">${lvl.emoji} ${esc(lvl.name)}</span></div>
        </div>
      </div>
    </div>`;

  html += `<div class="cont-strip" style="margin-top:12px">${CONTINENT_ORDER.map(k => { const pc = s.perContinent[k] || { visited: 0 }; return `<div class="cont ${s.continents.has(k) ? 'on' : ''}" title="${esc(CONTINENTS[k].n)}"><span class="e">${esc(CONTINENTS[k].short)}</span><small class="num">${k === 'AN' ? (s.continents.has('AN') ? '✓' : '–') : pc.visited}</small></div>`; }).join('')}</div>`;

  if (s.ongoing) {
    html += `<div class="section"><div class="section-head"><h3>In viaggio ora</h3></div>${tripCard(s.ongoing)}</div>`;
  }
  if (s.next) {
    const d = daysBetween(app.today, s.next.start);
    html += `<div class="section"><div class="section-head"><h3>Prossima partenza</h3></div>
      <a class="widget w2 next-trip" href="#/viaggio/${encodeURIComponent(s.next.id)}" style="display:flex;flex-direction:row;color:inherit">
        <div class="countdown"><b class="num">${fmtInt(d)}</b><span>${d === 1 ? 'giorno' : 'giorni'}</span></div>
        <div class="grow"><div class="headline ellipsis">${esc(s.next.emoji)} ${esc(s.next.title)}</div>
          <div class="w-sub">${esc(fmtRange(s.next.start, s.next.end))}</div>
          <div class="trip-flags">${[...new Set(s.next.stops.map(x => x.cc).filter(Boolean))].map(flag).join(' ')}</div></div>
      </a></div>`;
  }

  html += `<div class="section"><div class="section-head"><h3>In numeri</h3><a href="#/passaporto">Passaporto</a></div><div class="widgets">
    ${widget({ label: 'Continenti', value: s.continents.size, unit: '/7', ic: 'globe', color: 'var(--indigo)', vivid: true, i: 1 })}
    ${widget({ label: 'Città', value: fmtInt(s.cityCount), ic: 'pin', color: 'var(--pink)', i: 2, sub: s.regionCount ? `${fmtInt(s.regionCount)} regioni e stati` : '' })}
    ${widget({ label: 'In volo', value: fmtCompact(s.km), unit: 'km', ic: 'plane', color: 'var(--cyan)', vivid: true, i: 3, sub: s.km ? `${fmt1(s.earthLaps)} giri della Terra` : 'Aggiungi i voli' })}
    ${widget({ label: 'Voli', value: fmtInt(s.flightCount), ic: 'route', color: 'var(--orange)', i: 4, sub: s.airportCount ? `${fmtInt(s.airportCount)} aeroporti` : '' })}
  </div></div>`;

  const recent = trips.filter(t => tripStatus(t, app.today) !== 'upcoming').sort((a, b) => (b.start || '').localeCompare(a.start || '')).slice(0, 3);
  if (recent.length) {
    html += `<div class="section"><div class="section-head"><h3>Ultimi viaggi</h3><a href="#/viaggi">Vedi tutti</a></div>
      <div class="trip-list">${recent.map((t, i) => tripCard(t, i)).join('')}</div></div>`;
  }

  const wish = [...s.wish];
  html += `<div class="section"><div class="section-head"><h3>Sogni nel cassetto</h3></div>`;
  html += wish.length
    ? `<div class="chips-scroll" style="margin:0">${wish.map(cc => `<button type="button" data-cc="${esc(cc)}">${flag(cc)} ${esc(countryName(cc))}</button>`).join('')}</div>`
    : `<p class="footnote secondary" style="margin:0 4px">Tocca un paese sul globo e aggiungilo alla lista dei desideri ⭐</p>`;
  html += `</div>`;

  html += `<p class="footnote tertiary" style="text-align:center;margin-top:28px">Trascina il globo per girarlo · pizzica per lo zoom · tocca un paese</p>`;
  el.innerHTML = html;
  bind(el);
  animateIn(el);
}

function bind(el) {
  el.onclick = async e => {
    const cc = e.target.closest('[data-cc]');
    if (cc) { app.openCountry(cc.dataset.cc); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'new') app.openEditor();
    if (act === 'mark') {
      app.setSheet('peek');
      toast('Tocca un paese sul globo per segnarlo come visitato', { ms: 4500 });
    }
    if (act === 'demo') {
      b.disabled = true;
      try { const n = await loadDemo(); toast(`Ecco ${n} viaggi di esempio ✨`, { type: 'ok' }); }
      catch (err) { toast('Non riesco a caricare l\'esempio: ' + err.message, { type: 'error' }); b.disabled = false; }
    }
    if (act === 'rm-demo') {
      if (await confirmDialog({ title: 'Rimuovere l\'esempio?', text: 'I viaggi di esempio verranno eliminati. I tuoi restano dove sono.', ok: 'Rimuovi', danger: true })) {
        removeDemo();
        toast('Esempio rimosso');
      }
    }
  };
}
