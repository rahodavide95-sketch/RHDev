/* Pezzi comuni alle pagine: schede, righe dei movimenti e dei conti, riquadri con i numeri. */

import { h, icon } from '../ui/dom.js';
import { bankLogo } from '../data/banks.js';
import { money, moneyText } from '../ui/fmt.js';
import { ACCOUNT_TYPES, isLiability } from '../core/model.js';
import { formatDay } from '../core/dates.js';
import { txEditor } from './editors.js';

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
  return src ? h('span.avatar.av-logo', h('img', { src, alt: '', width: 42, height: 42, loading: 'lazy' })) : avatar(a.emoji || ACCOUNT_TYPES[a.type].emoji);
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
    h('span.row-main', h('span.row-title', a.name), h('span.row-sub', [t.label, a.institution].filter(Boolean).join(' · '))),
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
