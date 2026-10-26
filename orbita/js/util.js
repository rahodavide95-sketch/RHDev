/* ============================================================================
   util.js — piccoli aiuti condivisi: escape HTML, date, numeri, distanze, toast
   ============================================================================ */

// Tutto ciò che arriva dall'utente (o da un viaggio condiviso) passa da qui
// prima di finire in innerHTML: niente XSS.
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Bandiera emoji dal codice ISO a due lettere
export function flag(cc) {
  if (!/^[A-Z]{2}$/.test(cc || '')) return '🏳️';
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Testo senza accenti e minuscolo, per le ricerche
export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, "'").trim();
}

const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
export const fmtInt = n => nf0.format(Math.round(n || 0));
export const fmt1 = n => nf1.format(n || 0);
export function fmtCompact(n) {
  if (n >= 1e6) return nf1.format(n / 1e6) + ' M';
  if (n >= 1e4) return nf0.format(n / 1e3) + 'k';
  return nf0.format(n);
}

// Date "AAAA-MM-GG" senza slittamenti di fuso orario
export function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  const x = parseDay(a), y = parseDay(b);
  if (!x || !y) return 0;
  return Math.round((y - x) / 86400000);
}
const dfLong = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dfShort = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dfShortY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dfMonthY = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export function fmtDate(s, style = 'long') {
  const d = parseDay(s);
  if (!d) return '';
  return (style === 'short' ? dfShort : style === 'shortY' ? dfShortY : style === 'month' ? dfMonthY : dfLong).format(d);
}
export function fmtRange(a, b) {
  if (!a) return 'Date da definire';
  if (!b || a === b) return fmtDate(a, 'shortY');
  const ya = a.slice(0, 4), yb = b.slice(0, 4);
  return ya === yb ? `${fmtDate(a, 'short')} – ${fmtDate(b, 'shortY')}` : `${fmtDate(a, 'shortY')} – ${fmtDate(b, 'shortY')}`;
}

// Distanza ortodromica (km) tra due punti [lat, lng]
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Hash stabile di una stringa (per colori, rotazioni dei timbri, ecc.)
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Contatore animato (0 → valore) per i numeri delle statistiche
export function countUp(el, to, { ms = 1200, format = fmtInt, from = 0 } = {}) {
  if (!el) return;
  if (prefersReducedMotion() || ms <= 0) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
export function toast(msg, { type = 'info', ms = 3200, action } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); t.remove(); });
    t.appendChild(b);
  }
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------------------------------------------------------------------------
// Modale accessibile (focus intrappolato, Esc per chiudere)
// ---------------------------------------------------------------------------
let modalStack = [];
// Foglio modale in stile iOS: ✕ a sinistra, titolo al centro, ✓ (facoltativo) a destra
export function openModal({ title, body, wide = false, onClose, className = '', confirm = null }) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <button class="glass circle" type="button" data-close aria-label="Chiudi">${icon('x')}</button>
        <h2>${esc(title)}</h2>
        ${confirm ? `<button class="glass circle tinted" type="button" data-confirm aria-label="${esc(confirm.label || 'Fatto')}">${icon('check')}</button>` : '<span></span>'}
      </div>
      <div class="modal-body"></div></div>`;
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  root.appendChild(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('in')));
  const close = () => {
    if (!wrap.isConnected || wrap.dataset.closing) return;
    wrap.dataset.closing = '1';
    wrap.classList.remove('in');
    modalStack = modalStack.filter(m => m !== api);
    setTimeout(() => wrap.remove(), 380);
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose();
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
  };
  const onKey = e => {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = [...wrap.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-close]').addEventListener('click', close);
  if (confirm) wrap.querySelector('[data-confirm]').addEventListener('click', () => confirm.run());
  const api = { el: wrap, body: bodyEl, close };
  modalStack.push(api);
  setTimeout(() => {
    const first = bodyEl.querySelector('[autofocus], input:not([type="file"]), select, textarea');
    (first && window.innerWidth >= 900 ? first : wrap.querySelector('[data-close]')).focus({ preventScroll: true });
  }, 80);
  return api;
}

export function confirmDialog({ title, text, ok = 'Conferma', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title,
      body: `<p class="muted">${esc(text)}</p>
        <div class="modal-actions"><button class="btn" type="button" data-no>Annulla</button>
        <button class="btn ${danger ? 'btn-destructive' : 'btn-prominent'}" type="button" data-yes>${esc(ok)}</button></div>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.body.querySelector('[data-no]').addEventListener('click', () => { done = true; resolve(false); m.close(); });
    m.body.querySelector('[data-yes]').addEventListener('click', () => { done = true; resolve(true); m.close(); });
  });
}

// ---------------------------------------------------------------------------
// Icone (SVG in linea, tratto 2px, stile coerente)
// ---------------------------------------------------------------------------
const P = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  passport: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  plane: '<path d="M10.5 13.5 3 11l1.5-1.5 8 1L17 6a2.1 2.1 0 0 1 3 3l-4.5 4.5 1 8L15 23l-2.5-7.5L9 19v2.5L7.5 23 6 18l-5-1.5L2.5 15H5l3.5-3.5"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m14 6 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8H7z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// Scarica un file generato nel browser (export dati)
export function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Logo di Orbita (pianeta con orbita e luna). id univoco per il gradiente.
export function orbitaMark(id = 'om', cls = 'mark') {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop class="m1" offset="0" stop-color="#5CC4D6"/><stop class="m2" offset=".5" stop-color="#7B8CF2"/><stop class="m3" offset="1" stop-color="#A792F0"/></linearGradient></defs><circle cx="32" cy="32" r="13" fill="url(#${id})"/><ellipse class="m-ring" cx="32" cy="32" rx="27" ry="9.5" fill="none" stroke="url(#${id})" stroke-width="2.6" transform="rotate(-24 32 32)"/><circle class="m-moon" cx="54.5" cy="21.5" r="3.8" fill="#F2C97D"/></svg>`;
}

export function initials(name, email) {
  const src = (name || '').trim() || (email || '').split('@')[0] || '';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase();
}

export function promptDialog({ title, text = '', value = '', placeholder = '', ok = 'OK', maxlength = 120 }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title,
      body: `${text ? `<p class="secondary">${esc(text)}</p>` : ''}<input class="input" data-in maxlength="${maxlength}" placeholder="${esc(placeholder)}" value="${esc(value)}" autofocus>
        <div class="modal-actions"><button class="btn" type="button" data-no>Annulla</button><button class="btn btn-prominent" type="button" data-yes>${esc(ok)}</button></div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const inp = m.body.querySelector('[data-in]');
    const yes = () => { done = true; resolve(inp.value); m.close(); };
    setTimeout(() => { inp.focus(); inp.select(); }, 120);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); yes(); } });
    m.body.querySelector('[data-no]').addEventListener('click', () => { done = true; resolve(null); m.close(); });
    m.body.querySelector('[data-yes]').addEventListener('click', yes);
  });
}
