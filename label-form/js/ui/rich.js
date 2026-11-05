/* Testo formattato: disegno (dati → DOM, solo createElement/textContent) ed editor
   (contenteditable → dati). L'editor non salva mai HTML: rilegge il DOM e lo traduce nel
   modello di richtext.js, che accetta solo grassetto, corsivo, colori #rrggbb, link https, ecc. */

import { h, icon, clear } from './dom.js';
import { sanitizeRich, safeHref, COLOR_RE } from '../core/richtext.js';

const TAG = { p: 'p', h1: 'h3', h2: 'h4', quote: 'blockquote', ul: 'ul', ol: 'ol' };

function inlineNode(piece, opts) {
  let node;
  if (piece.br) return h('br');
  if (piece.f !== undefined) {
    if (opts.values) {
      const v = String(opts.values[piece.f] ?? '').trim();
      node = document.createTextNode(v || '________');
      if (!v) { const s = h('span.rt-blank'); s.append(node); node = s; }
    } else {
      node = h('span.ph', { contenteditable: 'false', dataset: { f: piece.f } }, opts.phLabel ? opts.phLabel(piece.f) : piece.f);
    }
  } else node = document.createTextNode(piece.x);
  const wrap = (tag, cls) => { const e = h(tag + (cls ? '.' + cls : '')); e.append(node); node = e; };
  if (piece.z) wrap('span', piece.z === 's' ? 'rt-s' : 'rt-l');
  if (piece.k) { wrap('span'); node.style.color = piece.k; }
  if (piece.s) wrap('s');
  if (piece.u) wrap('u');
  if (piece.i) wrap('em');
  if (piece.b) wrap('strong');
  if (piece.h) {
    const a = h('a', { href: piece.h, target: '_blank', rel: 'noopener noreferrer nofollow' });
    a.append(node);
    node = a;
  }
  return node;
}

/** Documento → frammento DOM. opts.values = riempie i segnaposto; opts.phLabel = etichetta dei segnaposto nell'editor. */
export function renderRich(doc, opts = {}) {
  const frag = document.createDocumentFragment();
  for (const b of sanitizeRich(doc)) {
    const el = h(TAG[b.t] + (b.t === 'h1' ? '.rt-h1' : b.t === 'h2' ? '.rt-h2' : ''));
    if (b.a) el.classList.add('rt-' + b.a);
    if (b.li) for (const item of b.li) { const li = h('li'); for (const p of item) li.append(inlineNode(p, opts)); el.append(li); }
    else {
      for (const p of b.c) el.append(inlineNode(p, opts));
      if (!b.c.length) el.append(h('br'));
    }
    frag.append(el);
  }
  return frag;
}
export const richBlock = (doc, opts = {}, cls = '') => { const d = h('div.rt' + (cls ? '.' + cls : '')); d.append(renderRich(doc, opts)); return d; };

/* ─── DOM → documento ─── */
function toHex(c) {
  if (!c) return '';
  c = String(c).trim().toLowerCase();
  if (COLOR_RE.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return '#' + m.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  return '';
}
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'SECTION', 'ARTICLE']);

function marksOf(el, marks) {
  const m = { ...marks };
  const t = el.tagName;
  if (t === 'B' || t === 'STRONG') m.b = 1;
  if (t === 'I' || t === 'EM') m.i = 1;
  if (t === 'U' || t === 'INS') m.u = 1;
  if (t === 'S' || t === 'STRIKE' || t === 'DEL') m.s = 1;
  if (t === 'A') { const href = safeHref(el.getAttribute('href')); if (href) m.h = href; }
  if (t === 'FONT') {
    const k = toHex(el.getAttribute('color'));
    if (k) m.k = k;
    const sz = Number(el.getAttribute('size'));
    if (sz && sz <= 2) m.z = 's'; else if (sz >= 5) m.z = 'l'; else if (sz) delete m.z;
  }
  const st = el.style;
  if (st) {
    if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) m.b = 1;
    if (st.fontStyle === 'italic') m.i = 1;
    if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) m.u = 1;
    if (/line-through/.test(st.textDecoration || st.textDecorationLine || '')) m.s = 1;
    const k = toHex(st.color);
    if (k) m.k = k;
  }
  if (el.classList) {
    if (el.classList.contains('rt-s')) m.z = 's';
    if (el.classList.contains('rt-l')) m.z = 'l';
  }
  return m;
}

function collect(node, marks, out) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { if (n.nodeValue) out.push({ x: n.nodeValue.replace(/ /g, ' '), ...marks }); continue; }
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'BR') { out.push({ br: 1 }); continue; }
    if (n.classList.contains('ph') && n.dataset.f) { out.push({ f: n.dataset.f, ...marks }); continue; }
    if (BLOCK_TAGS.has(n.tagName)) {
      if (out.length && !out[out.length - 1].br) out.push({ br: 1 });
      collect(n, marksOf(n, marks), out);
      continue;
    }
    collect(n, marksOf(n, marks), out);
  }
  return out;
}

function alignOf(el) {
  const a = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
  if (el.classList) for (const k of ['c', 'r', 'j']) if (el.classList.contains('rt-' + k)) return k;
  return { center: 'c', right: 'r', justify: 'j' }[a] || undefined;
}

export function domToRich(root) {
  const blocks = [];
  let loose = null;
  for (const n of root.childNodes) {
    if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) {
      loose = null;
      const t = n.tagName;
      const a = alignOf(n);
      if (t === 'UL' || t === 'OL') {
        const li = [...n.children].filter(x => x.tagName === 'LI').map(x => collect(x, marksOf(x, {}), []));
        blocks.push({ t: t === 'UL' ? 'ul' : 'ol', a, li });
      } else {
        const type = /^H[12]$/.test(t) ? 'h1' : /^H[3-6]$/.test(t) ? (t === 'H3' ? 'h1' : 'h2') : t === 'BLOCKQUOTE' ? 'quote' : 'p';
        blocks.push({ t: type, a, c: collect(n, marksOf(n, {}), []) });
      }
    } else {
      if (!loose) { loose = { t: 'p', c: [] }; blocks.push(loose); }
      if (n.nodeType === 3) loose.c.push({ x: n.nodeValue.replace(/ /g, ' ') });
      else if (n.nodeType === 1 && n.tagName === 'BR') { loose.c.push({ br: 1 }); }
      else if (n.nodeType === 1) collect({ childNodes: [n] }, {}, loose.c);
    }
  }
  return sanitizeRich(blocks);
}

/* ─── Editor ─── */
const exec = (cmd, val = null) => { try { document.execCommand(cmd, false, val); } catch { /* */ } };

/**
 * Editor di testo formattato.
 * opts: { value, onChange(doc), placeholders: () => [{id, label}], phLabel(id), compact, hint }
 */
export function richEditor(opts = {}) {
  let doc = sanitizeRich(opts.value || []);
  const area = h('div.rte-area', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', dataset: { hint: opts.hint || 'Scrivi qui…' } });
  const render = () => { clear(area); area.append(renderRich(doc, { phLabel: opts.phLabel })); area.classList.toggle('empty', !doc.length); };
  let timer = null;
  const read = () => {
    doc = domToRich(area);
    area.classList.toggle('empty', !area.textContent.trim() && !area.querySelector('.ph'));
    if (opts.onChange) opts.onChange(doc);
  };
  area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(read, 250); });
  area.addEventListener('blur', () => { clearTimeout(timer); read(); render(); });
  area.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    exec('insertText', text);
  });
  area.addEventListener('drop', e => e.preventDefault());
  area.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); exec('bold'); }
      if (k === 'i') { e.preventDefault(); exec('italic'); }
      if (k === 'u') { e.preventDefault(); exec('underline'); }
    }
  });

  let saved = null;
  const keep = () => { const s = getSelection(); if (s.rangeCount && area.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
  const restore = () => { area.focus(); if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); } };
  area.addEventListener('keyup', keep);
  area.addEventListener('mouseup', keep);
  area.addEventListener('focusout', keep);

  const btn = (ic, title, fn) => h('button.rte-btn', { type: 'button', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: () => { restore(); fn(); keep(); read(); } }, icon(ic, 17));
  const colorIn = h('input.rte-color', { type: 'color', value: '#a78bfa', title: 'Colore del testo', 'aria-label': 'Colore del testo',
    onchange: e => { restore(); exec('styleWithCSS', false); exec('foreColor', e.target.value); read(); } });
  const sizeSel = h('select.rte-size', { title: 'Dimensione', 'aria-label': 'Dimensione del testo', onchange: e => {
    restore(); exec('fontSize', { s: '2', m: '3', l: '5' }[e.target.value]); e.target.value = ''; read();
  } }, h('option', { value: '' }, 'Aa'), h('option', { value: 's' }, 'Piccolo'), h('option', { value: 'm' }, 'Normale'), h('option', { value: 'l' }, 'Grande'));
  const blockSel = h('select.rte-block', { title: 'Stile del paragrafo', 'aria-label': 'Stile del paragrafo', onchange: e => {
    restore(); exec('formatBlock', e.target.value); e.target.value = ''; read();
  } }, h('option', { value: '' }, 'Paragrafo'), h('option', { value: 'p' }, 'Testo'), h('option', { value: 'h3' }, 'Titolo'), h('option', { value: 'h4' }, 'Sottotitolo'), h('option', { value: 'blockquote' }, 'Citazione'));

  const tools = [
    blockSel,
    btn('bold', 'Grassetto (Ctrl+B)', () => exec('bold')),
    btn('italic', 'Corsivo (Ctrl+I)', () => exec('italic')),
    btn('underline', 'Sottolineato (Ctrl+U)', () => exec('underline')),
    btn('strike', 'Barrato', () => exec('strikeThrough')),
    h('label.rte-colorwrap', { title: 'Colore del testo' }, icon('color', 17), colorIn),
    sizeSel,
    h('span.rte-sep'),
    btn('list', 'Elenco puntato', () => exec('insertUnorderedList')),
    btn('listOl', 'Elenco numerato', () => exec('insertOrderedList')),
    btn('alignL', 'Allinea a sinistra', () => exec('justifyLeft')),
    btn('alignC', 'Centra', () => exec('justifyCenter')),
    btn('alignR', 'Allinea a destra', () => exec('justifyRight')),
    btn('link', 'Link', () => {
      const u = prompt('Indirizzo del link (https://…)', 'https://');
      const href = safeHref(u);
      if (href) exec('createLink', href); else if (u) alert('Il link deve iniziare con https:// o mailto:');
    }),
    btn('clearFmt', 'Togli la formattazione', () => { exec('removeFormat'); exec('unlink'); }),
  ];
  if (opts.placeholders) {
    const sel = h('select.rte-ph', { title: 'Inserisci un dato', 'aria-label': 'Inserisci un dato del modulo', onfocus: () => fillPh(), onmousedown: () => fillPh(), onchange: e => {
      const id = e.target.value; e.target.value = '';
      if (!id) return;
      restore();
      const chip = h('span.ph', { contenteditable: 'false', dataset: { f: id } }, opts.phLabel ? opts.phLabel(id) : id);
      const s = getSelection();
      if (s.rangeCount && area.contains(s.anchorNode)) {
        const r = s.getRangeAt(0); r.deleteContents(); r.insertNode(chip);
        r.setStartAfter(chip); r.collapse(true); s.removeAllRanges(); s.addRange(r);
      } else area.append(chip);
      read(); keep();
    } });
    const fillPh = () => { clear(sel); sel.append(h('option', { value: '' }, '+ Dato'), ...opts.placeholders().map(p => h('option', { value: p.id }, p.label))); };
    fillPh();
    tools.push(h('span.rte-sep'), sel);
  }
  const el = h('div.rte' + (opts.compact ? '.compact' : ''), h('div.rte-bar', tools), area);
  render();
  return { el, get: () => doc, set: d => { doc = sanitizeRich(d); render(); }, focus: () => area.focus() };
}
