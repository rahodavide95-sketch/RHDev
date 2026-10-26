/* ============================================================================
   common.js — pezzi di interfaccia riusati da più schermate
   ============================================================================ */
import { esc, flag, fmtRange, fmtInt, daysBetween, icon } from '../util.js';
import { tripStatus } from '../model.js';
import { distKm } from '../stats.js';
import { app } from '../ctx.js';

export function tripCountries(t) {
  const out = [];
  for (const s of t.stops) if (s.cc && !out.includes(s.cc)) out.push(s.cc);
  return out;
}
export const tripKm = t => t.flights.reduce((a, f) => a + (f.km || distKm(f.fromLL, f.toLL)), 0);

export function statusPill(t) {
  const st = tripStatus(t, app.today);
  if (st === 'upcoming') {
    const d = daysBetween(app.today, t.start);
    return `<span class="pill yellow">${d === 1 ? 'Domani' : `Tra ${fmtInt(d)} giorni`}</span>`;
  }
  if (st === 'ongoing') return '<span class="pill green">In viaggio</span>';
  return '';
}

export function tripCard(t, i = 0, extra = '') {
  const cs = tripCountries(t);
  const km = tripKm(t);
  const meta = [fmtRange(t.start, t.end)];
  if (t.stops.length) meta.push(`${t.stops.length} ${t.stops.length === 1 ? 'tappa' : 'tappe'}`);
  if (km) meta.push(`${fmtInt(km)} km`);
  return `<a class="trip-card" href="#/viaggio/${encodeURIComponent(t.id)}" style="--tc:${esc(t.color)};--i:${i}">
    <span class="trip-emoji">${esc(t.emoji)}</span>
    <span class="grow">
      <h4 class="ellipsis">${esc(t.title)}</h4>
      <div class="trip-meta">${esc(meta.join(' · '))}</div>
      ${cs.length ? `<div class="trip-flags">${cs.map(flag).join(' ')}</div>` : ''}
      ${extra}
    </span>
    ${statusPill(t)}
  </a>`;
}

export function widget({ label, value, unit = '', sub = '', ic = '', color = '', vivid = false, wide = false, i = 0, emoji = '', attrs = '' }) {
  return `<div class="widget ${vivid ? 'vivid' : ''} ${wide ? 'w2' : ''}" style="${color ? `--c:${color};` : ''}--i:${i}" ${attrs}>
    <div class="w-label">${ic ? icon(ic) : ''}${esc(label)}</div>
    ${emoji ? `<span class="w-emoji">${emoji}</span>` : ''}
    <div><div class="w-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    ${sub ? `<div class="w-sub">${sub}</div>` : ''}</div>
  </div>`;
}

export function ring(pct, id = 'rg') {
  const r = 52, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5CC4D6"/><stop offset=".5" stop-color="#7B8CF2"/><stop offset="1" stop-color="#A792F0"/></linearGradient></defs>
    <circle class="bg" cx="60" cy="60" r="${r}"/>
    <circle class="fg" cx="60" cy="60" r="${r}" stroke="url(#${id})" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-off="${off.toFixed(1)}"/>
  </svg>`;
}
// Anima gli anelli e le barre appena entrano nella pagina
export function animateIn(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.ring .fg[data-off]').forEach(c => { c.style.strokeDashoffset = c.dataset.off; });
    root.querySelectorAll('[data-w]').forEach(i => { i.style.width = i.dataset.w; });
  }));
}
