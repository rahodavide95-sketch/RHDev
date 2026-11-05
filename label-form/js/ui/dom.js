/* Piccoli strumenti per costruire l'interfaccia senza librerie.
   Tutto il testo passa da textContent: niente HTML iniettato dai dati (contro XSS).
   Gli stili arrivano solo come proprietà CSS impostate da JavaScript (compatibile con la CSP). */

import { ICONS } from './icons.js';

const SVG_TAGS = /^(svg|path|circle|rect|line|polyline|polygon|g)$/;

/** h('div.card#id', { onclick, class, style, dataset, attrs… }, …figli) */
export function h(sel, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props !== undefined && props !== null) kids.unshift(props);
    props = {};
  }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const tag = (m && m[1]) || 'div';
  const el = SVG_TAGS.test(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') { for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c); }
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'open' || k === 'multiple' || k === 'readOnly') el[k] = !!v;
    else if (k === 'ref' && typeof v === 'function') v(el);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

/** Icona SVG dal set interno (costanti del codice, mai dati dell'utente). */
export function icon(name, size = 20, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  for (const d of (ICONS[name] || ICONS.dot)) {
    const [tag, attrs] = d;
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
    svg.append(n);
  }
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function swap(el, ...kids) { clear(el); append(el, kids); return el; }

export const debounce = (fn, ms) => {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
};

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); });
    document.body.append(inp);
    inp.click();
  });
}

/** Immagine scelta dall'utente → data URL ridotto (max lato `max` px) e sotto `maxChars`. */
export function imageToDataUrl(file, { max = 1600, maxChars = 650000, type = 'image/jpeg', keepAlpha = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { reject(new Error('not_image')); return; }
    if (file.size > 25 * 1024 * 1024) { reject(new Error('too_big')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const outType = keepAlpha ? 'image/png' : type;
      for (let i = 0; i < 8; i++) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const x = c.getContext('2d');
        if (!keepAlpha) { x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL(outType, 0.85);
        if (out.length <= maxChars) { resolve(out); return; }
        scale *= 0.75;
      }
      reject(new Error('too_big'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not_image')); };
    img.src = url;
  });
}

export const isMobile = () => matchMedia('(max-width: 759px)').matches;

/* ─── Date ─── */
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00:00' : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'adesso';
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  if (s < 86400 * 7) { const n = Math.floor(s / 86400); return n === 1 ? 'ieri' : `${n} giorni fa`; }
  return fmtDay(iso);
}
export const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Impedisce di mostrare la pagina dentro un'altra (clickjacking), anche dove non si possono mettere intestazioni. */
export function guardFrame() {
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    try { window.top.location = window.self.location.href; } catch { /* bloccato: la pagina resta nascosta */ }
  }
}
