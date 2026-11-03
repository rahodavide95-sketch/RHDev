/* Pezzi comuni alle pagine: schede, righe dei movimenti e dei conti, riquadri con i numeri. */

import { h, icon } from '../ui/dom.js';
import { bankLogo } from '../data/banks.js';
import { coinLogo } from '../data/coins.js';
import { money, moneyText } from '../ui/fmt.js';
import { ACCOUNT_TYPES, ASSET_CLASSES, isLiability } from '../core/model.js';
import { formatDay, formatMonth } from '../core/dates.js';
import { cleanPeriod, isCustom } from '../core/period.js';
import { parseAmount, formatNumber } from '../core/money.js';
import { txEditor } from './editors.js';
import { colorChoice, selectInput, toast } from '../ui/components.js';
import { setSetting } from '../actions.js';

export function card(title, opts = {}, ...body) {
  const head = title || opts.action || opts.sub
    ? h('div.card-head',
      h('div.card-titles', title ? h('h2.card-title', title) : null, opts.sub ? h('p.card-sub', opts.sub) : null),
      opts.action || null)
    : null;
  return h('section.card', { class: opts.cls || '' }, head, ...body);
}

export const linkBtn = (label, href) => h('a.link-btn', { href }, label, icon('chevR', 16));

export function stat(label, value, extra) {
  return h('div.stat', h('div.stat-label', label), h('div.stat-value', value), extra ? h('div.stat-extra', extra) : null);
}

export function avatar(emoji, tone) {
  return h('span.avatar', { class: tone ? 'av-' + tone : '' }, emoji || '•');
}
/** Avatar di un conto: il logo della sua banca se lo conosciamo, altrimenti la sua emoji. */
export function accAvatar(a) {
  const src = bankLogo(a.name, a.institution);
  if (src) return h('span.avatar.av-logo', h('img', { src, alt: '', width: 42, height: 42, loading: 'lazy' }));
  return a.cls && !a.emoji ? hdBadge({ cls: a.cls }) : avatar(a.emoji || ACCOUNT_TYPES[a.type].emoji);
}

export function txRow(ctx, t, { showAccount = true, showDate = false, selectable = false, selected = false, onSelect } = {}) {
  const { d } = ctx;
  const acc = d.accById.get(t.account);
  const cat = t.category ? d.catById.get(t.category) : null;
  const to = t.toAccount ? d.accById.get(t.toAccount) : null;
  const title = t.payee || (t.kind === 'transfer' ? 'Giroconto' : cat?.name || 'Movimento');
  const subParts = [];
  if (t.kind === 'transfer') subParts.push(`${acc?.name || '?'} → ${to?.name || '?'}`);
  else {
    if (cat && t.payee) subParts.push(cat.name);
    if (!cat) subParts.push('Senza categoria');
    if (showAccount && acc) subParts.push(acc.name);
  }
  if (showDate) subParts.unshift(formatDay(t.date));
  const sign = t.kind === 'income' ? 1 : t.kind === 'expense' ? -1 : 0;
  const amt = money(sign * t.amount || t.amount, acc?.currency, { sign: sign > 0, tone: sign > 0 ? 'pos' : sign === 0 ? 'mute' : '' });
  const row = h('button.row.tx-row', { type: 'button', class: selected ? 'selected' : '', onclick: e => {
    if (selectable && (e.shiftKey || e.metaKey || e.ctrlKey || ctx.selecting)) { onSelect?.(t.id); return; }
    txEditor(ctx, t);
  } },
    selectable && ctx.selecting ? h('span.sel-box', { class: selected ? 'on' : '' }, selected ? icon('check', 14) : null) : null,
    avatar(t.kind === 'transfer' ? '⇄' : cat?.emoji || (t.kind === 'income' ? '💰' : '•'), t.kind === 'transfer' ? 'mute' : null),
    h('span.row-main', h('span.row-title', title, t.recurring ? icon('repeat', 13, 'row-badge') : null, t.flagged ? icon('flag', 13, 'row-badge warn') : null),
      h('span.row-sub', subParts.join(' · '), t.tags.length ? h('span.row-tags', t.tags.map(x => h('span.tag', '#' + x))) : null)),
    h('span.row-end', amt));
  return row;
}

export function accountRow(ctx, a, { onClick } = {}) {
  const v = ctx.d.balances.get(a.id) || 0;
  const t = ACCOUNT_TYPES[a.type];
  return h('a.row.acc-row', { href: '#/conti/' + a.id, onclick: onClick },
    accAvatar(a),
    h('span.row-main', h('span.row-title', a.name), h('span.row-sub', [a.cls ? `${ASSET_CLASSES[a.cls].label} · nel Net Worth` : t.label, a.institution].filter(Boolean).join(' · '))),
    h('span.row-end', money(v, a.currency, { tone: isLiability(a) || v < 0 ? 'neg' : '' }),
      a.currency !== ctx.d.base ? h('span.row-sub', moneyText(ctx.d.toBase(v, a.currency))) : null));
}

/** Gruppo di movimenti per giorno, con il totale del giorno. */
export function txGroups(ctx, list, opts = {}) {
  const out = [];
  let cur = null, items = [], tot = 0;
  const flush = () => {
    if (!cur) return;
    out.push(h('div.day-group',
      h('div.day-head', h('span', formatDay(cur)), tot ? money(tot, ctx.d.base, { sign: true, tone: tot > 0 ? 'pos' : '' }) : null),
      h('div.rows', items)));
  };
  for (const t of list) {
    if (t.date !== cur) { flush(); cur = t.date; items = []; tot = 0; }
    items.push(txRow(ctx, t, { ...opts, selected: opts.isSelected?.(t.id) }));
    if (t.kind !== 'transfer') tot += (t.kind === 'income' ? 1 : -1) * ctx.d.txBase(t);
  }
  flush();
  return out;
}

export function pageGrid(...cards) { return h('div.page-grid', cards); }

export function segTabs(options, value, onChange) {
  return h('div.tabs', { role: 'tablist' }, options.map(o => h('button.tab-btn', { type: 'button', role: 'tab', 'aria-selected': String(o.value === value), onclick: () => onChange(o.value) }, o.label, o.count != null ? h('span.tab-count', o.count) : null)));
}

/* ─── Periodo a scelta, uguale in ogni pagina ───
   (D: "anche nella panoramica, ovunque, devo avere la possibilità di mettere il range periodo che voglio")
   La scelta resta su questo dispositivo, una per pagina (o per grafico). */
export function loadPeriod(key, def = 12) {
  try { return cleanPeriod(JSON.parse(localStorage.getItem('rhf-period-' + key)), def); } catch { return def; }
}
export function savePeriod(key, v) {
  try { localStorage.setItem('rhf-period-' + key, JSON.stringify(v)); } catch { /* navigazione privata */ }
}
const PERIOD_LABEL = { 6: '6M', 12: '12M', 24: '24M', 36: '36M', ytd: 'Quest\'anno', py: 'Anno scorso', all: 'Tutto' };
/**
 * Le scorciatoie (12M, Quest'anno…) e "Personalizza", che apre Da / A con i mesi.
 * `range` è il periodo già risolto ({from, to}), `months` i mesi che si possono scegliere (dal più vecchio).
 */
export function periodPicker({ value, range, months, onChange, presets = [12, 24, 'ytd', 'py', 'all'] }) {
  const custom = isCustom(value);
  const opts = months.map(k => ({ value: k, label: formatMonth(k) }));
  const from = range?.from || months[0], to = range?.to || months[months.length - 1];
  return h('div.period-pick',
    segTabs([...presets.map(p => ({ value: p, label: PERIOD_LABEL[p] })), { value: 'custom', label: 'Personalizza' }], custom ? 'custom' : value,
      v => onChange(v === 'custom' ? { from, to } : v)),
    custom && opts.length ? h('div.nw-range',
      h('label', h('span', 'Da'), selectInput(opts, from, v => onChange({ from: v, to }))),
      h('label', h('span', 'A'), selectInput(opts, to, v => onChange({ from, to: v })))) : null);
}

/* ─── Scrivere un importo direttamente nella cella (D: "se clicco in una cella devo poter modificare
   da solo l'importo senza passare da altre cose") ───
   Invio salva e scende alla riga sotto, Tab va a destra (Maiusc+Tab a sinistra), Esc annulla, cella
   vuota = valore tolto. Le celle che si scrivono hanno la classe `cell-edit` e data-k (riga) e data-i
   (colonna), così dopo il ridisegno si riprende dalla cella giusta (`resumeEdit`). */
let nextEdit = null;
const findCell = (root, k, i) => [...root.querySelectorAll('td.cell-edit')].find(x => x.dataset.k === k && x.dataset.i === i);
export function editInCell(td, { cur, label, save }) {
  if (td.classList.contains('editing')) return;
  const old = [...td.childNodes];
  const inp = h('input.cell-in', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': label, value: cur == null || cur === 0 ? '' : formatNumber(cur / 100, 2, 2) });
  td.replaceChildren(inp); td.classList.add('editing');
  inp.focus(); inp.select();
  const neighbour = dir => {
    if (dir === 'down') {
      for (let tr = td.parentElement.nextElementSibling; tr; tr = tr.nextElementSibling) {
        const x = tr.querySelector(`td.cell-edit[data-i="${td.dataset.i}"]`);
        if (x) return { k: x.dataset.k, i: x.dataset.i };
      }
      return null;
    }
    const cells = [...td.parentElement.querySelectorAll('td.cell-edit')];
    const x = cells[cells.indexOf(td) + (dir === 'left' ? -1 : 1)];
    return x ? { k: x.dataset.k, i: x.dataset.i } : null;
  };
  let done = false;
  const restore = () => { td.replaceChildren(...old); td.classList.remove('editing'); };
  const finish = (ok, dir) => {
    if (done) return; done = true;
    const go = dir ? neighbour(dir) : null;
    if (!ok) { restore(); td.focus(); return; }
    const txt = inp.value.trim();
    const c = txt === '' ? null : parseAmount(txt);
    if (txt !== '' && c == null) { restore(); toast('Non è un importo: scrivi per esempio 1234,56', { kind: 'err' }); return; }
    const table = td.closest('table');
    restore();
    nextEdit = go;
    // save() ridisegna la pagina se cambia qualcosa; se non cambia niente si passa subito alla cella dopo
    if (save(c) === false && go) { nextEdit = null; findCell(table, go.k, go.i)?.click(); }
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true, 'down'); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? 'left' : 'right'); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('click', e => e.stopPropagation());
}
/** Dopo il ridisegno: riapre la cella dove si era arrivati con Invio o Tab. */
export function resumeEdit(table) {
  if (!nextEdit) return;
  const want = nextEdit; nextEdit = null;
  requestAnimationFrame(() => findCell(table, want.k, want.i)?.click());
}

/** Casella per filtrare una tabella: aggiorna la pagina mentre scrivi e resta selezionata. */
let refocus = null;
export function filterBox(id, value, onChange, placeholder = 'Filtra…') {
  const inp = h('input', { type: 'search', value: value || '', placeholder, 'aria-label': placeholder });
  let tm;
  inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { refocus = id; onChange(inp.value.trim()); }, 220); });
  if (refocus === id) { refocus = null; requestAnimationFrame(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }); }
  return h('label.table-filter', icon('search', 16), inp);
}

/* Distintivo dei titoli: per le crypto il loro logo, per gli altri la sigla del tipo (come chiede D) */
const BADGE = { etf_eq: ['ETF', 1], etf_bd: ['ETF', 1], etf_mm: ['ETF', 1], gold: ['ETC', 4], stock: ['STOCK', 3], gov: ['BOND', 7], bond: ['BOND', 7], fund: ['FONDO', 2], crypto: ['CRYPTO', 5], other: ['•', 0] };
export function hdBadge(hd, small = false) {
  if (hd.cls === 'crypto') {
    const src = coinLogo(hd.symbol);
    if (src) return h(small ? 'img.nw-logo' : 'span.avatar.av-logo.av-coin', small ? { src, alt: '', width: 16, height: 16 } : {}, small ? null : h('img', { src, alt: '', width: 42, height: 42, loading: 'lazy' }));
    return small ? h('span.mini-badge', { style: { '--badge': 'var(--c4)' } }, '₿') : avatar('🪙');
  }
  const [t, c] = BADGE[hd.cls] || BADGE.other;
  return h(small ? 'span.mini-badge' : 'span.avatar.av-badge', { style: { '--badge': c ? `var(--c${c})` : 'var(--ink-3)' } }, t);
}

/** Colore di una categoria o sezione: uno degli 8 della palette (1…8) o uno scelto liberamente (#rrggbb). */
export const colorVar = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : c ? `var(--c${c})` : 'var(--ink-3)');

/* ─── Colore al volo (D: "cambiare il colore delle varie categorie direttamente cliccando sul
   quadratino senza andare nelle impostazioni"): il quadratino è un pulsante che apre la tavolozza
   (gli 8 colori e il cerchio arcobaleno per qualsiasi colore) lì accanto. ─── */
let openPop = null;
function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !e.target.closest?.('.cdot')) closePop(); }, true);
addEventListener('scroll', () => { if (openPop && openPop.anchor && Math.abs(openPop.anchor.getBoundingClientRect().top - openPop.anchorTop) > 60) closePop(); }, { passive: true, capture: true });
/** Colore smorzato (D: "quei colori non farli così vivaci"): per pallini, barre e grafici a blocchi. */
export const softColor = c => `color-mix(in srgb, ${c} 62%, var(--ink-3))`;
/** `value`: 1…8 o "#rrggbb"; `onPick(v)` salva. */
export function colorDot(value, onPick, label = 'Cambia colore') {
  const b = h('button.cdot', { type: 'button', 'aria-label': label, title: label, style: { '--dot': colorVar(value) } });
  b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (openPop?.dataset.for === label) { closePop(); return; }
    closePop();
    const pick = colorChoice(value, null, { onDone: v => { closePop(); onPick(v); } });
    const pop = h('div.color-pop', { role: 'dialog', 'aria-label': label, dataset: { for: label } }, h('div.color-pop-t', label), pick);
    document.body.append(pop);
    const r = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.anchor = b; pop.anchorTop = r.top;
    pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left - 12)) + 'px';
    pop.style.top = (r.bottom + ph + 12 > innerHeight ? Math.max(8, r.top - ph - 8) : r.bottom + 8) + 'px';
    openPop = pop;
    pop.querySelector('button.swatch[aria-pressed="true"], button.swatch')?.focus();
  });
  return b;
}
/** Il colore di una sezione del Net Worth, salvato nell'ordine del foglio come la vede D. */
export function setSectionColor(d, name, color) {
  const G = d.nwGroups();
  const sections = G.sections.map(x => ({ name: x.name, color: x.name === name ? color : x.color, items: x.items })).filter(x => x.items.length);
  setSetting('nwLayout', { sections, labels: { ...G.labels } });
}
