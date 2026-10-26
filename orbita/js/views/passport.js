/* ============================================================================
   passport.js — il passaporto del viaggiatore
   Carta olografica in stile Wallet (si inclina col puntatore, tocca per girarla),
   widget con tutti i numeri, timbri per ogni paese, traguardi e record.
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import { countries, countryName, CONTINENTS, CONTINENT_ORDER } from '../geo.js';
import { esc, flag, fmtInt, fmt1, fmtCompact, fmtDate, hash, orbitaMark, norm } from '../util.js';
import { widget, animateIn } from './common.js';
import { LEVELS } from '../stats.js';

const MONTHS = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const stampDate = d => (d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');
const mrzText = s => norm(s).toUpperCase().replace(/[^A-Z0-9]+/g, '<');
const pad = (s, n) => (s + '<'.repeat(n)).slice(0, n);

function passportNo() {
  const user = cloud.getUser();
  const seed = user ? user.id : store.get().createdAt;
  return 'OR' + (hash(seed) % 1e7).toString().padStart(7, '0');
}

export function render(el) {
  const s = app.stats;
  const st = store.get();
  const p = st.profile;
  const user = cloud.getUser();
  const name = p.name || 'Viaggiatore';
  const visitedList = [...s.visited].filter(c => countries.has(c))
    .sort((a, b) => (s.visits.get(a).first || '9999').localeCompare(s.visits.get(b).first || '9999') || countryName(a).localeCompare(countryName(b), 'it'));
  const no = passportNo();
  const parts = name.trim().split(/\s+/);
  const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const nat3 = p.nat ? p.nat + '<' : 'XXX';
  const mrz1 = pad(`P<${nat3}${mrzText(surname)}<<${mrzText(given)}`, 44);
  const mrz2 = pad(`${no}<${hash(no) % 10}${nat3}${String(s.sovereignCount).padStart(3, '0')}PAESI<${s.continents.size}CONT<${String(s.cityCount).padStart(4, '0')}CITTA`, 44);
  const since = (user && user.created_at) || st.createdAt;
  const lvl = s.level;

  let html = `<div class="nav-row"><h1 class="large-title">Passaporto</h1></div>
  <div class="pass-stage" id="pass-stage">
    <div class="pass" id="pass" role="button" tabindex="0" aria-label="Passaporto: tocca per girarlo">
      <div class="pass-face pass-front">
        <div class="holo"></div><div class="glare"></div>
        <div class="pass-top"><span class="pass-brand">${orbitaMark('pp')} ORBITA</span><span class="pass-kind">Passaporto del viaggiatore</span></div>
        <div class="pass-flags">${visitedList.length ? visitedList.map(flag).join('') : '🌍'}</div>
        <div class="pass-main">
          <div class="pass-name"><small>Titolare</small><b>${esc(name)}</b><span>${lvl.emoji} ${esc(lvl.name)}</span></div>
          <div class="pass-big"><small>Paesi</small><b>${fmtInt(s.sovereignCount)}</b></div>
        </div>
      </div>
      <div class="pass-face pass-back">
        <div class="f"><small>Nazionalità</small><b>${p.nat ? `${flag(p.nat)} ${esc(countryName(p.nat))}` : '—'}</b></div>
        <div class="f"><small>Casa</small><b>${p.home ? esc(p.home.name) : '—'}</b></div>
        <div class="f"><small>N. passaporto</small><b>${esc(no)}</b></div>
        <div class="f"><small>Membro dal</small><b>${esc(fmtDate(String(since).slice(0, 10), 'month'))}</b></div>
        <div class="f"><small>Continenti</small><b>${s.continents.size} / 7</b></div>
        <div class="f"><small>Mondo</small><b>${fmt1(s.worldPct)}%</b></div>
        <div class="mrz">${esc(mrz1)}\n${esc(mrz2)}</div>
      </div>
    </div>
  </div>
  <div class="pass-hint">Tocca la carta per girarla</div>`;

  // livello
  const next = lvl.next;
  html += `<div class="widget w2" style="margin-top:16px;min-height:0;--i:0"><div class="level-card"><span class="e">${lvl.emoji}</span>
      <div class="grow"><div class="headline">${esc(lvl.name)}</div>
      <div class="w-sub">${next ? `Ancora ${next.min - s.sovereignCount} ${next.min - s.sovereignCount === 1 ? 'paese' : 'paesi'} per diventare ${next.emoji} ${esc(next.name)}` : 'Hai raggiunto il livello più alto. Leggendario.'}</div>
      <div class="level-bar"><i data-w="${Math.round(lvl.progress * 100)}%"></i></div></div></div></div>`;

  // numeri
  html += `<div class="section"><div class="section-head"><h3>I numeri</h3></div><div class="widgets">
    ${widget({ label: 'Paesi', value: fmtInt(s.sovereignCount), unit: `/${s.sovereignTotal}`, ic: 'globe', color: 'var(--blue)', vivid: true, i: 1, sub: `${fmt1(s.worldPct)}% del mondo` })}
    ${widget({ label: 'Continenti', value: s.continents.size, unit: '/7', ic: 'map', color: 'var(--indigo)', i: 2, sub: [...s.continents].map(k => CONTINENTS[k].emoji).join(' ') })}
    ${widget({ label: 'Regioni e stati', value: fmtInt(s.regionCount), ic: 'pin', color: 'var(--orange)', i: 3, sub: [s.itRegions ? `${s.itRegions}/20 regioni italiane` : '', s.usStates ? `${s.usStates} stati USA` : ''].filter(Boolean).join(' · ') })}
    ${widget({ label: 'Città', value: fmtInt(s.cityCount), ic: 'home', color: 'var(--pink)', i: 4, sub: s.territoryCount ? `+ ${s.territoryCount} territori` : '' })}
    ${widget({ label: 'Km in volo', value: fmtCompact(s.km), ic: 'plane', color: 'var(--cyan)', vivid: true, wide: true, i: 5, sub: `${fmt1(s.earthLaps)} giri della Terra · ${fmt1(s.moonPct)}% della strada per la Luna` })}
    ${widget({ label: 'Voli', value: fmtInt(s.flightCount), ic: 'route', color: 'var(--purple)', i: 6, sub: `${fmtInt(s.hours)} ore circa in aria` })}
    ${widget({ label: 'Aeroporti', value: fmtInt(s.airportCount), ic: 'plane', color: 'var(--teal)', i: 7, sub: s.topAirport ? `Il più usato: ${esc(s.topAirport[0])}` : '' })}
    ${widget({ label: 'Viaggi', value: fmtInt(s.tripCount), ic: 'calendar', color: 'var(--green)', i: 8, sub: s.upcoming.length ? `+ ${s.upcoming.length} in programma` : '' })}
    ${widget({ label: 'Giorni via', value: fmtInt(s.days), ic: 'sun', color: 'var(--yellow)', i: 9, sub: `${fmtInt(s.nights)} notti fuori casa` })}
  </div></div>`;

  // continenti
  html += `<div class="section"><div class="section-head"><h3>Continenti</h3></div><div class="list cont-bars">
    ${CONTINENT_ORDER.filter(k => k !== 'AN').map(k => { const c = s.perContinent[k] || { visited: 0, total: 0 }; return `<div class="cont-bar" style="--c:${CONTINENTS[k].color}"><div class="row between"><span>${CONTINENTS[k].emoji} ${esc(CONTINENTS[k].n)}</span><span class="secondary num">${c.visited} / ${c.total}</span></div><div class="track"><i data-w="${c.total ? Math.max(c.visited ? 3 : 0, c.visited / c.total * 100) : 0}%"></i></div></div>`; }).join('')}
    <div class="cont-bar" style="--c:${CONTINENTS.AN.color}"><div class="row between"><span>${CONTINENTS.AN.emoji} Antartide</span><span class="secondary">${s.continents.has('AN') ? 'Conquistata!' : 'Ancora da raggiungere'}</span></div><div class="track"><i data-w="${s.continents.has('AN') ? 100 : 0}%"></i></div></div>
  </div></div>`;

  // timbri
  html += `<div class="section"><div class="section-head"><h3>Timbri</h3><span class="secondary footnote">${visitedList.length}</span></div>`;
  html += visitedList.length ? `<div class="stamps">${visitedList.map((cc, i) => {
    const h = hash(cc + 'stamp');
    const v = s.visits.get(cc);
    const shape = ['', 'sq', 'tk'][h % 3];
    const rot = ((h >> 3) % 25) - 12;
    const col = CONTINENTS[countries.get(cc).k].color;
    const ink = col === '#E5E5EA' ? '#5a6a8a' : col === '#64D2FF' ? '#1689b8' : col === '#FFD60A' ? '#b38f00' : col;
    return `<div class="stamp ${shape}" style="--ink:${ink};--rot:${rot}deg;--i:${i}" title="${esc(countryName(cc))}"><span class="fl">${flag(cc)}</span><b>${esc(countryName(cc))}</b><small>${esc(stampDate(v.first) || (v.trips.size ? '' : 'VISITATO'))}</small></div>`;
  }).join('')}</div>` : `<p class="secondary" style="margin:0 4px">Il primo timbro arriva con il primo viaggio ✈️</p>`;
  html += `</div>`;

  // traguardi
  const done = s.badges.filter(b => b.done).length;
  html += `<div class="section"><div class="section-head"><h3>Traguardi</h3><span class="secondary footnote">${done} di ${s.badges.length}</span></div><div class="badges">
    ${[...s.badges].sort((a, b) => (b.done - a.done) || (b.progress - a.progress)).map(b => `<div class="badge ${b.done ? 'done' : ''}" title="${esc(b.desc)}"><span class="e">${b.emoji}</span><b>${esc(b.title)}</b><small>${esc(b.desc)}</small>${b.done ? '' : `<div class="bar"><i style="width:${Math.round(b.progress * 100)}%"></i></div>`}</div>`).join('')}
  </div></div>`;

  // anno per anno
  if (s.years.length) {
    const max = Math.max(1, ...s.years.map(y => y.countries));
    const years = s.years.slice(-10);
    html += `<div class="section"><div class="section-head"><h3>Anno per anno</h3><span class="secondary footnote">paesi visitati</span></div>
      <div class="list"><div class="years">${years.map((y, i) => `<div class="yb"><i data-v="${y.countries}" style="height:${Math.max(4, y.countries / max * 100)}%;animation-delay:${i * 60}ms"></i><span>${esc(y.year)}</span></div>`).join('')}</div></div></div>`;
  }

  // record
  const rec = [];
  if (s.longest) rec.push(['🛫', 'Volo più lungo', `${s.longest.from} → ${s.longest.to} · ${fmtInt(s.longest.km)} km`]);
  if (s.shortest && s.flightCount > 1) rec.push(['🛬', 'Volo più corto', `${s.shortest.from} → ${s.shortest.to} · ${fmtInt(s.shortest.km)} km`]);
  if (s.ext.farthest) rec.push(['📏', 'Il più lontano da casa', `${s.ext.farthest.name} · ${fmtInt(s.ext.farthest.km)} km`]);
  if (s.ext.north) rec.push(['🧭', 'Punto più a nord', `${flag(s.ext.north.cc)} ${s.ext.north.name} · ${fmt1(s.ext.north.lat)}°`]);
  if (s.ext.south) rec.push(['🐧', 'Punto più a sud', `${flag(s.ext.south.cc)} ${s.ext.south.name} · ${fmt1(s.ext.south.lat)}°`]);
  if (s.ext.east) rec.push(['🌅', 'Punto più a est', `${flag(s.ext.east.cc)} ${s.ext.east.name}`]);
  if (s.ext.west) rec.push(['🌇', 'Punto più a ovest', `${flag(s.ext.west.cc)} ${s.ext.west.name}`]);
  if (s.topCountry && s.topCountry.trips > 1) rec.push(['❤️', 'Il paese del cuore', `${flag(s.topCountry.cc)} ${countryName(s.topCountry.cc)} · ${s.topCountry.trips} viaggi`]);
  if (s.topAirline) rec.push(['✈️', 'Compagnia preferita', `${s.topAirline[0]} · ${s.topAirline[1]} voli`]);
  if (s.bestYear && s.bestYear.countries) rec.push(['🔥', 'Anno migliore', `${s.bestYear.year} · ${s.bestYear.countries} paesi`]);
  if (rec.length) {
    html += `<div class="section"><div class="section-head"><h3>Record</h3></div><div class="list">
      ${rec.map(([e, t, v]) => `<div class="list-row has-icon"><span class="app-ic" style="--c:var(--fill2);font-size:18px">${e}</span><span class="grow"><small style="margin:0">${esc(t)}</small><b style="font-weight:600">${esc(v)}</b></span></div>`).join('')}
    </div></div>`;
  }

  html += `<p class="footnote tertiary" style="text-align:center;margin-top:24px">I livelli: ${LEVELS.map(l => `${l.emoji} ${l.name} (${l.min}+)`).join(' · ')}</p>`;
  el.innerHTML = html;
  animateIn(el);
  bindPass(el);
}

function bindPass(el) {
  const stage = el.querySelector('#pass-stage');
  const pass = el.querySelector('#pass');
  if (!pass) return;
  const flip = () => pass.classList.toggle('flipped');
  pass.addEventListener('click', flip);
  pass.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  stage.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const r = pass.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    pass.classList.add('tracking');
    pass.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
    pass.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
    pass.style.setProperty('--mx', `${x * 100}%`);
    pass.style.setProperty('--my', `${y * 100}%`);
  });
  stage.addEventListener('pointerleave', () => {
    pass.classList.remove('tracking');
    ['--rx', '--ry'].forEach(k => pass.style.setProperty(k, '0deg'));
    pass.style.setProperty('--mx', '50%'); pass.style.setProperty('--my', '30%');
  });
}
