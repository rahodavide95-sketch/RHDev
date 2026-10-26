/* ============================================================================
   trips.js — elenco dei viaggi e dettaglio con itinerario
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import { countryName } from '../geo.js';
import { esc, flag, fmtInt, fmtDate, fmtRange, daysBetween, icon, toast, norm, confirmDialog } from '../util.js';
import { tripStatus } from '../model.js';
import { tripCard, tripCountries, tripKm, statusPill, widget } from './common.js';

let filter = 'all';
let query = '';
let lastFocus = '';

export function render(el, params) {
  if (params[0]) return renderDetail(el, params[0]);
  lastFocus = '';
  renderList(el);
}

// ---------------------------------------------------------------------------
// Elenco
// ---------------------------------------------------------------------------
function renderList(el) {
  const own = store.ownTrips();
  const shared = store.sharedTrips();
  const all = [...own, ...shared.map(s => s.trip)];
  const years = [...new Set(all.map(t => (t.start || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const upcoming = all.filter(t => tripStatus(t, app.today) === 'upcoming');
  const chips = [['all', 'Tutti']];
  if (upcoming.length) chips.push(['up', 'In programma']);
  if (shared.length) chips.push(['shared', 'Condivisi']);
  for (const y of years) chips.push([y, y]);
  if (!chips.some(c => c[0] === filter)) filter = 'all';

  const q = norm(query);
  const match = t => !q || norm(t.title).includes(q) || t.stops.some(s => norm(s.name).includes(q) || norm(countryName(s.cc)).includes(q));
  let list = all.filter(match);
  if (filter === 'up') list = list.filter(t => tripStatus(t, app.today) === 'upcoming');
  else if (filter === 'shared') list = list.filter(t => store.findTrip(t.id).role !== 'owner');
  else if (/^\d{4}$/.test(filter)) list = list.filter(t => (t.start || '').startsWith(filter));

  let html = `<div class="nav-row"><h1 class="large-title">Viaggi</h1>
      <button class="glass circle" type="button" data-act="new" aria-label="Nuovo viaggio">${icon('plus')}</button></div>`;
  if (!all.length) {
    html += `<div class="empty"><span class="big-emoji">🧳</span><h2 class="title2">Nessun viaggio, per ora</h2>
      <p class="secondary" style="margin-top:8px">Registra un viaggio con tappe e voli: lo vedrai prendere forma sul globo.</p>
      <button class="btn btn-prominent" type="button" data-act="new" style="margin-top:16px">${icon('plus')}Nuovo viaggio</button></div>`;
    el.innerHTML = html;
    bind(el);
    return;
  }
  html += `<div class="search-field" style="margin-top:8px">${icon('search')}<input class="input" id="trip-q" type="search" placeholder="Cerca viaggi, città, paesi" value="${esc(query)}" autocomplete="off" enterkeyhint="search"></div>
    <div class="chips-scroll" role="group" aria-label="Filtra">${chips.map(([k, l]) => `<button type="button" data-filter="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join('')}</div>`;

  const up = list.filter(t => tripStatus(t, app.today) === 'upcoming').sort((a, b) => a.start.localeCompare(b.start));
  const past = list.filter(t => tripStatus(t, app.today) !== 'upcoming').sort((a, b) => (b.start || '0').localeCompare(a.start || '0'));
  let i = 0;
  if (up.length) html += `<div class="list-header">In programma</div><div class="trip-list">${up.map(t => tripCard(t, i++, sharedLine(t))).join('')}</div>`;
  const groups = new Map();
  for (const t of past) { const y = (t.start || '').slice(0, 4) || 'Senza data'; if (!groups.has(y)) groups.set(y, []); groups.get(y).push(t); }
  for (const [y, ts] of groups) {
    html += `<div class="list-header">${esc(y)} · ${ts.length} ${ts.length === 1 ? 'viaggio' : 'viaggi'}</div><div class="trip-list">${ts.map(t => tripCard(t, i++, sharedLine(t))).join('')}</div>`;
  }
  if (!list.length) html += `<p class="secondary" style="text-align:center;margin-top:30px">Nessun viaggio trovato.</p>`;
  el.innerHTML = html;
  bind(el);
}

function sharedLine(t) {
  const f = store.findTrip(t.id);
  if (!f || f.role === 'owner') return '';
  return `<div class="trip-meta">${icon('share', 'ic-xs')} da ${esc(f.owner || 'un amico')}</div>`;
}

// ---------------------------------------------------------------------------
// Dettaglio
// ---------------------------------------------------------------------------
function timeline(t) {
  const items = [];
  t.stops.forEach((s, i) => items.push({ kind: 'stop', date: s.date, i, s }));
  t.flights.forEach((f, i) => items.push({ kind: 'flight', date: f.date, i, f }));
  const dated = items.filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.i - b.i : a.kind === 'flight' ? -1 : 1));
  const undated = items.filter(x => !x.date);
  return [...dated, ...undated];
}

function renderDetail(el, id) {
  const found = store.findTrip(id);
  if (!found) {
    el.innerHTML = `<div class="nav-row"><a class="glass circle" href="#/viaggi" aria-label="Indietro">${icon('back')}</a><span></span></div>
      <div class="empty"><span class="big-emoji">🔍</span><h2 class="title2">Viaggio non trovato</h2>
      <p class="secondary">Forse è stato eliminato, oppure non è condiviso con questo account.</p></div>`;
    return;
  }
  const { trip: t, role } = found;
  const owner = role === 'owner';
  const canEdit = owner || role === 'editor';
  const cs = tripCountries(t);
  const km = tripKm(t);
  const days = t.start ? daysBetween(t.start, t.end || t.start) + 1 : 0;
  const excluded = store.get().profile.excludeShared.includes(t.id);

  if (lastFocus !== id && app.globe) {
    lastFocus = id;
    const pts = [...t.stops.map(s => ({ lat: s.lat, lng: s.lng })), ...t.flights.flatMap(f => [{ lat: f.fromLL[0], lng: f.fromLL[1] }, { lat: f.toLL[0], lng: f.toLL[1] }])];
    app.globe.focusPoints(pts);
  }

  let html = `<div class="trip-hero" style="--tc:${esc(t.color)}">
    <div class="nav-row">
      <a class="glass circle" href="#/viaggi" aria-label="Torna ai viaggi">${icon('back')}</a>
      <div class="row">
        ${owner && cloud.isConfigured() ? `<button class="glass circle" type="button" data-act="share" aria-label="Condividi">${icon('share')}</button>` : ''}
        ${canEdit ? `<button class="glass circle" type="button" data-act="edit" aria-label="Modifica">${icon('edit')}</button>` : ''}
      </div>
    </div>
    <span class="big">${esc(t.emoji)}</span>
    <h1 class="large-title">${esc(t.title)}</h1>
    <div class="row row-wrap" style="margin-top:8px;gap:6px">
      <span class="pill">${icon('calendar', 'ic-xs')} ${esc(fmtRange(t.start, t.end))}</span>
      ${statusPill(t)}
      ${!owner ? `<span class="pill purple">${role === 'editor' ? 'Puoi modificare' : 'Solo lettura'}</span>` : ''}
    </div>
    <div class="trip-actions">
      <button class="btn btn-aurora" type="button" data-act="replay">${icon('play')}Rivivi il viaggio</button>
    </div>
  </div>`;

  html += `<div class="widgets" style="margin-top:6px">
    ${widget({ label: cs.length === 1 ? 'Paese' : 'Paesi', value: cs.length, ic: 'globe', color: t.color, i: 0, sub: cs.map(flag).join(' ') })}
    ${widget({ label: 'Tappe', value: t.stops.length, ic: 'pin', color: t.color, i: 1, sub: days ? `${days} ${days === 1 ? 'giorno' : 'giorni'}` : '' })}
    ${km ? widget({ label: 'In volo', value: fmtInt(km), unit: 'km', ic: 'plane', color: t.color, vivid: true, wide: true, i: 2, sub: `${t.flights.length} ${t.flights.length === 1 ? 'volo' : 'voli'} · ${fmtInt(km / 800 + t.flights.length * 0.5)} ore circa` }) : ''}
  </div>`;

  const tl = timeline(t);
  html += `<div class="section"><div class="section-head"><h3>Itinerario</h3></div>`;
  if (!tl.length) html += `<p class="secondary" style="margin:0 4px">Nessuna tappa ancora.${canEdit ? ' Tocca la matita per aggiungerne.' : ''}</p>`;
  else {
    html += `<div class="list" style="padding:6px 16px"><div class="timeline" style="--tc:${esc(t.color)}">`;
    for (const x of tl) {
      if (x.kind === 'stop') {
        const s = x.s;
        const sub = [s.region, countryName(s.cc)].filter(Boolean).join(', ');
        html += `<div class="tl-item"><b>${flag(s.cc)} ${esc(s.name)}</b>
          <div class="footnote">${esc(sub)}${s.date ? ' · ' + esc(fmtDate(s.date, 'short')) : ''}${s.nights ? ` · ${s.nights} ${s.nights === 1 ? 'notte' : 'notti'}` : ''}</div></div>`;
      } else {
        const f = x.f;
        html += `<div class="tl-item fl"><b class="route">✈️ ${esc(f.from)} → ${esc(f.to)}</b>
          <div class="footnote">${esc(f.fromCity)} → ${esc(f.toCity)} · ${fmtInt(f.km)} km${f.date ? ' · ' + esc(fmtDate(f.date, 'short')) : ''}${f.airline ? ' · ' + esc(f.airline) : ''}${f.num ? ' ' + esc(f.num) : ''}</div></div>`;
      }
    }
    html += `</div></div>`;
  }
  html += `</div>`;

  if (t.notes) html += `<div class="section"><div class="section-head"><h3>Note</h3></div><div class="list" style="padding:14px 16px"><div class="notes">${esc(t.notes)}</div></div></div>`;

  if (!owner) {
    html += `<div class="list-header">Condivisione</div><div class="list">
      <div class="list-row has-icon"><span class="app-ic" style="--c:var(--purple)">${icon('share')}</span><span class="grow"><b>Condiviso da ${esc(found.owner || 'un amico')}</b><small>${role === 'editor' ? 'Puoi modificare il viaggio' : 'Puoi vederlo, non modificarlo'}</small></span></div>
      <label class="list-row has-icon"><span class="app-ic" style="--c:var(--green)">${icon('passport')}</span><span class="grow"><b>Conta nel mio passaporto</b><small>C'eri anche tu? Allora i paesi valgono anche per te.</small></span>
        <span class="switch"><input type="checkbox" data-act="count" ${excluded ? '' : 'checked'}><span></span></span></label>
      <button class="list-row danger" type="button" data-act="leave">Esci da questo viaggio</button>
    </div>`;
  } else {
    html += `<div class="list" style="margin-top:26px">
      ${cloud.isConfigured() ? `<button class="list-row has-icon" type="button" data-act="share"><span class="app-ic" style="--c:var(--blue)">${icon('mail')}</span><span class="grow"><b>Invita compagni di viaggio</b><small>Via email, con accesso in sola lettura o in modifica</small></span>${icon('down', 'chev')}</button>` : ''}
      <button class="list-row danger" type="button" data-act="delete">Elimina viaggio</button></div>`;
  }
  el.innerHTML = html;
  bind(el, t);
}

function bind(el, t) {
  el.onclick = async e => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; app.render(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    const act = b.dataset.act;
    if (act === 'new') app.openEditor();
    if (act === 'edit') app.openEditor(t);
    if (act === 'share') app.openShare(t);
    if (act === 'replay') app.startRecap({ tripId: t.id });
    if (act === 'delete') {
      const ok = await confirmDialog({ title: `Eliminare "${t.title}"?`, text: 'Il viaggio sparirà dal globo e dal passaporto' + (cloud.getUser() ? ', su tutti i tuoi dispositivi.' : '.'), ok: 'Elimina', danger: true });
      if (!ok) return;
      const removed = store.removeTrip(t.id);
      app.go('#/viaggi');
      toast('Viaggio eliminato', { action: { label: 'Annulla', run: () => store.restoreTrip(removed) }, ms: 6000 });
    }
    if (act === 'leave') {
      const ok = await confirmDialog({ title: 'Uscire dal viaggio?', text: 'Non lo vedrai più. Potrà invitarti di nuovo chi l\'ha creato.', ok: 'Esci', danger: true });
      if (!ok) return;
      try { await cloud.leaveShared(t.id); app.go('#/viaggi'); toast('Sei uscito dal viaggio'); }
      catch (err) { toast(cloud.friendlyError(err), { type: 'error' }); }
    }
  };
  el.onchange = e => {
    const c = e.target.closest('[data-act="count"]');
    if (c && t) { store.toggleExcludeShared(t.id, !c.checked); toast(c.checked ? 'Conta nel tuo passaporto' : 'Escluso dal tuo passaporto', { ms: 1800 }); }
  };
  const q = el.querySelector('#trip-q');
  if (q) q.oninput = () => {
    query = q.value;
    const pos = q.selectionStart;
    renderList(el);
    const nq = el.querySelector('#trip-q');
    nq.focus(); nq.setSelectionRange(pos, pos);
  };
}
