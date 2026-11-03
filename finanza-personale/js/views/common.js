/* Pezzi comuni alle pagine: schede, righe dei movimenti e dei conti, riquadri con i numeri. */

import { h, icon } from '../ui/dom.js';
import { bankLogo } from '../data/banks.js';
import { coinLogo } from '../data/coins.js';
import { money, moneyText } from '../ui/fmt.js';
import { ACCOUNT_TYPES, ASSET_CLASSES, isLiability } from '../core/model.js';
import { formatDay } from '../core/dates.js';
import { txEditor } from './editors.js';
import { colorChoice } from '../ui/components.js';
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
