/* Piccoli strumenti per costruire l'interfaccia senza librerie.
   Tutto il testo passa da textContent: niente HTML iniettato dai dati (contro XSS). */

import { ICONS } from './icons.js';

/**
 * h('div.card#id', { onclick, class, style, dataset, attrs... }, ...figli)
 * I figli possono essere nodi, testo, numeri, array, null/false (ignorati).
 */
export function h(sel, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props !== undefined && props !== null) kids.unshift(props);
    props = {};
  }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const tag = (m && m[1]) || 'div';
  const el = /^(svg|path|circle|rect|line|polyline|polygon|g|text|defs|linearGradient|stop|clipPath|mask|tspan)$/.test(tag)
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') { for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c); }
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'open') el[k] = !!v;
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

/** Icona SVG dal set interno (le icone sono costanti del codice, mai dati dell'utente). */
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
  svg.innerHTML = ICONS[name] || ICONS.dot;
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Sostituisce il contenuto tenendo la posizione di scorrimento. */
export function swap(el, ...kids) {
  const y = el.scrollTop;
  clear(el);
  append(el, kids);
  el.scrollTop = y;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Fa scaricare un file generato nel browser. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/** Legge un file scelto dall'utente come testo. */
export function pickFile(accept) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      inp.remove();
      resolve(f || null);
    });
    document.body.append(inp);
    inp.click();
  });
}

export function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      let t = r.result;
      // estratti conto vecchi in Windows-1252: se ci sono caratteri rovinati riprova
      if (typeof t === 'string' && t.includes('�')) {
        const r2 = new FileReader();
        r2.onload = () => res(r2.result);
        r2.onerror = () => res(t);
        r2.readAsText(file, 'windows-1252');
      } else res(t);
    };
    r.onerror = () => rej(r.error);
    r.readAsText(file, 'utf-8');
  });
}

export const isMobile = () => matchMedia('(max-width: 759px)').matches;
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
