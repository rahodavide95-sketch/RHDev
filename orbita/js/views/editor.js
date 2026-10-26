/* ============================================================================
   editor.js — crea o modifica un viaggio: tappe, voli, date, note
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import { searchPlaces, searchAirports, loadPlaces, loadAirports, airportCity, countryAt, nearestPlace, countryName } from '../geo.js';
import { EMOJIS, COLORS } from '../model.js';
import { distKm } from '../stats.js';
import { esc, flag, uid, icon, toast, openModal, promptDialog, debounce, fmtInt, haversine } from '../util.js';

// ---------------------------------------------------------------------------
// Autocompletamento accessibile (frecce, Invio, Esc)
// ---------------------------------------------------------------------------
export function attachAC(input, { search, render, onPick, extra }) {
  const wrap = input.closest('.ac');
  const list = document.createElement('div');
  list.className = 'ac-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  let items = [], sel = -1, seq = 0;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; };
  const paint = () => {
    list.innerHTML = items.map((it, i) => `<button type="button" class="ac-item" role="option" data-i="${i}" aria-selected="${i === sel}">${it.__extra ? it.html : render(it)}</button>`).join('');
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { items = []; paint(); return; }
    let res = [];
    try { res = await search(q); } catch { res = []; }
    if (my !== seq) return;
    items = res;
    if (extra) items = [...items, ...extra(q).map(x => ({ ...x, __extra: true }))];
    sel = items.length ? 0 : -1;
    paint();
  }, 120);
  const pick = i => {
    const it = items[i];
    if (!it) return;
    close();
    if (it.__extra) it.run(input.value.trim()); else onPick(it);
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close };
}

export const placeRow = p => `<span class="fl">${flag(p.cc)}</span><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.type === 'country' ? 'Paese intero' : [p.alt && p.alt !== p.name ? p.alt : '', p.region, countryName(p.cc)].filter(Boolean).join(' · '))}</small></span>`;
const airportRow = a => `<span class="ac-iata">${esc(a.i)}</span><span class="grow"><b>${esc(airportCity(a))}</b><small>${esc(a.n)} · ${flag(a.cc)} ${esc(countryName(a.cc))}</small></span>`;

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
export function openEditor(trip, prefill = null) {
  const isNew = !trip;
  const draft = trip ? JSON.parse(JSON.stringify(trip)) : {
    id: uid(), title: '', emoji: '✈️', color: COLORS[Math.floor(Math.random() * COLORS.length)], start: '', end: '', notes: '', stops: [], flights: [],
    ...(prefill || {}),
  };
  loadPlaces().catch(() => {});
  loadAirports().catch(() => {});

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="stack">
      <label class="field"><span>Nome del viaggio</span><input class="input" id="ed-title" maxlength="120" placeholder="Es. Estate in Grecia" value="${esc(draft.title)}"></label>
      <div class="field"><span>Icona</span><div class="emoji-row" id="ed-emoji">${EMOJIS.map(e => `<button type="button" data-emoji="${e}" aria-pressed="${draft.emoji === e}" aria-label="Icona ${e}">${e}</button>`).join('')}</div></div>
      <div class="field"><span>Colore</span><div class="color-row" id="ed-color">${COLORS.map(c => `<button type="button" data-color="${c}" style="--c:${c}" aria-pressed="${draft.color === c}" aria-label="Colore ${c}"></button>`).join('')}</div></div>
      <div class="grid2">
        <label class="field"><span>Partenza</span><input class="input" type="date" id="ed-start" value="${esc(draft.start)}"></label>
        <label class="field"><span>Ritorno</span><input class="input" type="date" id="ed-end" value="${esc(draft.end)}"></label>
      </div>
    </div>

    <div class="ed-section">
      <h3>${icon('pin')} Tappe <span class="pill" id="ed-stops-n"></span></h3>
      <div class="ac"><input class="input" id="ed-place" placeholder="Aggiungi una città o un paese" autocomplete="off" enterkeyhint="search"></div>
      <div class="ed-list" id="ed-stops"></div>
    </div>

    <div class="ed-section">
      <h3>${icon('plane')} Voli <span class="pill" id="ed-flights-n"></span></h3>
      <div class="ed-list" id="ed-flights"></div>
      <button class="btn btn-block" type="button" id="ed-add-flight" style="margin-top:10px">${icon('plus')}Aggiungi un volo</button>
      <div class="flight-form" id="ed-flight-form" hidden>
        <div class="field ac"><span>Da</span><input class="input" id="fl-from" placeholder="Città o codice (FCO)" autocomplete="off"></div>
        <div class="field ac"><span>A</span><input class="input" id="fl-to" placeholder="Città o codice (HEL)" autocomplete="off"></div>
        <label class="field"><span>Data</span><input class="input" type="date" id="fl-date"></label>
        <label class="field"><span>Compagnia</span><input class="input" id="fl-airline" maxlength="60" placeholder="Es. ITA Airways"></label>
        <label class="field"><span>Numero volo</span><input class="input" id="fl-num" maxlength="12" placeholder="Es. AZ784"></label>
        <label class="field" style="justify-content:flex-end"><span class="row" style="gap:10px;margin:0"><span class="switch"><input type="checkbox" id="fl-auto" checked><span></span></span>Aggiungi la città d'arrivo</span></label>
        <div class="full row"><button class="btn" type="button" id="fl-cancel">Annulla</button><button class="btn btn-prominent grow" type="button" id="fl-save">Aggiungi volo</button></div>
      </div>
    </div>

    <div class="ed-section">
      <h3>${icon('edit')} Note</h3>
      <textarea class="textarea" id="ed-notes" maxlength="4000" placeholder="Ricordi, consigli, ristoranti da non perdere…">${esc(draft.notes)}</textarea>
    </div>
    <button class="btn btn-prominent btn-block" type="button" id="ed-save" style="margin-top:22px">${icon('check')}${isNew ? 'Salva viaggio' : 'Salva modifiche'}</button>`;

  const m = openModal({ title: isNew ? 'Nuovo viaggio' : 'Modifica viaggio', body, wide: true, confirm: { label: 'Salva', run: save } });
  const $ = s => body.querySelector(s);

  // --- tappe ---
  function renderStops() {
    $('#ed-stops-n').textContent = draft.stops.length || '';
    $('#ed-stops').innerHTML = draft.stops.map((s, i) => `<div class="ed-item">
        <span class="fl">${s.kind === 'custom' ? '📍' : flag(s.cc)}</span>
        <span class="grow"><b>${esc(s.name)}</b><small>${esc([s.region, countryName(s.cc)].filter(Boolean).join(' · ') || (s.kind === 'country' ? 'Paese' : ''))}</small></span>
        <span class="ed-tools">
          <button type="button" data-up="${i}" aria-label="Sposta su" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" data-down="${i}" aria-label="Sposta giù" ${i === draft.stops.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button type="button" data-rm-stop="${i}" aria-label="Rimuovi ${esc(s.name)}">${icon('trash')}</button>
        </span>
        <span class="mini"><input class="input" type="date" data-stop-date="${i}" value="${esc(s.date)}" aria-label="Data di arrivo a ${esc(s.name)}">
          <input class="input nights" type="number" min="0" max="999" inputmode="numeric" data-stop-nights="${i}" value="${s.nights || ''}" placeholder="notti" aria-label="Notti a ${esc(s.name)}"></span>
      </div>`).join('');
  }
  function addStop(p, kind = p.type === 'country' ? 'country' : 'city') {
    if (draft.stops.length >= 300) { toast('Massimo 300 tappe per viaggio'); return; }
    draft.stops.push({ id: uid(), name: p.name, cc: p.cc, lat: p.lat, lng: p.lng, region: p.region || '', regionKey: p.regionKey || '', date: '', nights: 0, kind });
    if (!draft.title.trim() && !$('#ed-title').value.trim()) { $('#ed-title').value = `Viaggio a ${p.name}`; }
    renderStops();
    if (app.globe) app.globe.flyTo(p.lat, p.lng, undefined, 900);
  }
  attachAC($('#ed-place'), {
    search: q => searchPlaces(q, 7),
    render: placeRow,
    onPick: p => { addStop(p); $('#ed-place').value = ''; $('#ed-place').focus(); },
    extra: () => [{ html: `<span class="fl">📍</span><span class="grow"><b>Scegli un punto sul globo</b><small>Per borghi, spiagge, rifugi e posti senza nome</small></span>`, run: pickOnGlobe }],
  });

  function pickOnGlobe() {
    const prevSheet = document.body.dataset.sheet;
    m.el.style.display = 'none';
    app.setSheet('peek');
    const done = () => { app.pickOnGlobe = null; m.el.style.display = ''; app.setSheet(prevSheet); };
    toast('Tocca un punto sul globo', { ms: 8000, action: { label: 'Annulla', run: done } });
    app.pickOnGlobe = async ({ lat, lng }) => {
      app.pickOnGlobe = null;
      const cc = countryAt(lat, lng);
      if (!cc) { toast('Lì c\'è solo mare 🌊 Riprova sulla terraferma.'); m.el.style.display = 'none'; pickOnGlobe(); return; }
      const near = await nearestPlace(lat, lng, cc).catch(() => null);
      done();
      const name = await promptDialog({ title: 'Come si chiama questo posto?', text: `${flag(cc)} ${countryName(cc)}${near && near.km < 60 ? ` · vicino a ${near.name}` : ''}`, value: near && near.km < 12 ? near.name : '', placeholder: 'Es. Spiaggia dei Conigli', ok: 'Aggiungi' });
      if (name === null) return;
      addStop({ name: name.trim().slice(0, 120) || `Luogo in ${countryName(cc)}`, cc, lat: +lat.toFixed(3), lng: +lng.toFixed(3), region: near && near.km < 60 ? near.region : '', regionKey: near && near.km < 60 ? near.regionKey : '' }, 'custom');
    };
  }

  // --- voli ---
  let flFrom = null, flTo = null;
  function renderFlights() {
    $('#ed-flights-n').textContent = draft.flights.length || '';
    $('#ed-flights').innerHTML = draft.flights.map((f, i) => `<div class="ed-item">
        <span class="fl">✈️</span>
        <span class="grow"><b class="route">${esc(f.from)} → ${esc(f.to)}</b><small>${esc(f.fromCity)} → ${esc(f.toCity)} · ${fmtInt(f.km)} km</small></span>
        <span class="ed-tools"><button type="button" data-rm-flight="${i}" aria-label="Rimuovi volo ${esc(f.from)} ${esc(f.to)}">${icon('trash')}</button></span>
        <span class="mini"><input class="input" type="date" data-fl-date="${i}" value="${esc(f.date)}" aria-label="Data del volo">
          <input class="input" data-fl-airline="${i}" value="${esc(f.airline)}" maxlength="60" placeholder="Compagnia" aria-label="Compagnia aerea"></span>
      </div>`).join('');
  }
  const acFrom = { search: q => searchAirports(q, 7), render: airportRow };
  attachAC($('#fl-from'), { ...acFrom, onPick: a => { flFrom = a; $('#fl-from').value = `${a.i} · ${airportCity(a)}`; $('#fl-to').focus(); } });
  attachAC($('#fl-to'), { ...acFrom, onPick: a => { flTo = a; $('#fl-to').value = `${a.i} · ${airportCity(a)}`; $('#fl-date').focus(); } });
  $('#fl-from').addEventListener('input', () => { flFrom = null; });
  $('#fl-to').addEventListener('input', () => { flTo = null; });
  const showFlightForm = on => {
    $('#ed-flight-form').hidden = !on;
    $('#ed-add-flight').hidden = on;
    if (on) {
      const last = draft.flights[draft.flights.length - 1];
      if (last) { loadAirports().then(map => { const a = map.get(last.to); if (a && !flFrom) { flFrom = a; $('#fl-from').value = `${a.i} · ${airportCity(a)}`; } }); }
      $('#fl-date').value = $('#fl-date').value || $('#ed-start').value || '';
      setTimeout(() => (flFrom ? $('#fl-to') : $('#fl-from')).focus(), 50);
    }
  };
  $('#ed-add-flight').onclick = () => showFlightForm(true);
  $('#fl-cancel').onclick = () => showFlightForm(false);
  $('#fl-save').onclick = () => {
    if (!flFrom || !flTo) { toast('Scegli gli aeroporti dall\'elenco', { type: 'error' }); return; }
    if (flFrom.i === flTo.i) { toast('Partenza e arrivo coincidono', { type: 'error' }); return; }
    const km = Math.round(distKm([flFrom.lat, flFrom.lng], [flTo.lat, flTo.lng]));
    draft.flights.push({
      id: uid(), from: flFrom.i, to: flTo.i, fromLL: [flFrom.lat, flFrom.lng], toLL: [flTo.lat, flTo.lng],
      fromCity: airportCity(flFrom), toCity: airportCity(flTo), fromCc: flFrom.cc, toCc: flTo.cc,
      date: $('#fl-date').value, airline: $('#fl-airline').value.trim(), num: $('#fl-num').value.trim().toUpperCase(), km,
    });
    // città d'arrivo come tappa (non se è casa o già presente)
    if ($('#fl-auto').checked) {
      const home = store.get().profile.home;
      const isHome = home && haversine(home.lat, home.lng, flTo.lat, flTo.lng) < 40;
      const already = draft.stops.some(s => s.cc === flTo.cc && haversine(s.lat, s.lng, flTo.lat, flTo.lng) < 40);
      if (!isHome && !already) {
        searchPlaces(`${airportCity(flTo)}, ${flTo.cc}`, 1).then(([p]) => {
          const near = p && p.type === 'city' && haversine(p.lat, p.lng, flTo.lat, flTo.lng) < 60;
          draft.stops.push({ id: uid(), name: near ? p.name : airportCity(flTo), cc: flTo.cc, lat: near ? p.lat : flTo.lat, lng: near ? p.lng : flTo.lng, region: near ? p.region : '', regionKey: near ? p.regionKey : '', date: $('#fl-date').value || '', nights: 0, kind: 'city' });
          renderStops();
        }).catch(() => {});
      }
    }
    if (app.globe) app.globe.flyTo(flTo.lat, flTo.lng, undefined, 900);
    flFrom = flTo; flTo = null;
    $('#fl-from').value = `${flFrom.i} · ${airportCity(flFrom)}`;
    $('#fl-to').value = ''; $('#fl-num').value = '';
    renderFlights();
    showFlightForm(false);
    toast(`Volo aggiunto · ${fmtInt(km)} km`, { type: 'ok', ms: 1800 });
  };

  // --- interazioni ---
  body.addEventListener('click', e => {
    const em = e.target.closest('[data-emoji]');
    if (em) { draft.emoji = em.dataset.emoji; body.querySelectorAll('[data-emoji]').forEach(b => b.setAttribute('aria-pressed', String(b === em))); return; }
    const co = e.target.closest('[data-color]');
    if (co) { draft.color = co.dataset.color; body.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b === co))); return; }
    const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]');
    if (up || dn) {
      const i = +(up ? up.dataset.up : dn.dataset.down), j = up ? i - 1 : i + 1;
      if (j < 0 || j >= draft.stops.length) return;
      [draft.stops[i], draft.stops[j]] = [draft.stops[j], draft.stops[i]];
      renderStops();
      return;
    }
    const rs = e.target.closest('[data-rm-stop]');
    if (rs) { draft.stops.splice(+rs.dataset.rmStop, 1); renderStops(); return; }
    const rf = e.target.closest('[data-rm-flight]');
    if (rf) { draft.flights.splice(+rf.dataset.rmFlight, 1); renderFlights(); }
  });
  body.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.stopDate !== undefined) draft.stops[+t.dataset.stopDate].date = t.value;
    if (t.dataset.stopNights !== undefined) draft.stops[+t.dataset.stopNights].nights = Math.max(0, Math.min(999, parseInt(t.value, 10) || 0));
    if (t.dataset.flDate !== undefined) draft.flights[+t.dataset.flDate].date = t.value;
    if (t.dataset.flAirline !== undefined) draft.flights[+t.dataset.flAirline].airline = t.value.trim().slice(0, 60);
  });
  $('#ed-save').onclick = save;

  function save() {
    draft.title = $('#ed-title').value.trim() || (draft.stops[0] ? `Viaggio a ${draft.stops[0].name}` : 'Nuovo viaggio');
    draft.start = $('#ed-start').value;
    draft.end = $('#ed-end').value;
    draft.notes = $('#ed-notes').value;
    // date mancanti: le ricaviamo da tappe e voli
    const dates = [...draft.stops.map(s => s.date), ...draft.flights.map(f => f.date)].filter(Boolean).sort();
    if (!draft.start && dates.length) draft.start = dates[0];
    if (!draft.end && dates.length) draft.end = dates[dates.length - 1];
    try {
      const saved = store.saveTrip(draft);
      m.close();
      toast(isNew ? 'Viaggio salvato ✨' : 'Modifiche salvate', { type: 'ok' });
      app.go(`#/viaggio/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  renderStops();
  renderFlights();
}
