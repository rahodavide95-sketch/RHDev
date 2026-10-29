/* Scadenze: da registrare, calendario del mese, prossime, abbonamenti con il costo annuo. */

import { h, icon } from '../ui/dom.js';
import { openSheet, amountInput, dateInput, field, toast, empty } from '../ui/components.js';
import { money, moneyText } from '../ui/fmt.js';
import { card, avatar, segTabs } from './common.js';
import { recurringEditor } from './editors.js';
import { postRecurring, skipRecurring } from '../actions.js';
import { formatDate, relDays, describeRule, nextOccurrence, perYear, occurrences, monthKey, addMonthKey, formatMonth, toISO, daysInMonth, weekday, today, addDays } from '../core/dates.js';

let tab = 'prossime';
let calMonth = null;

function registerDialog(ctx, rule, date) {
  const cur = ctx.d.accById.get(rule.account)?.currency;
  const amt = amountInput({ value: rule.amount, currency: cur, autofocus: true, big: true });
  const dt = dateInput(date);
  const save = () => { const c = amt.getCents(); if (!c) return; postRecurring(rule.id, dt.value || date, c); toast('Registrato', { kind: 'ok' }); s.close(true); };
  const s = openSheet({
    title: rule.name, subtitle: `Scadenza del ${formatDate(date, { long: true, year: true })}`, size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, h('p.muted', 'Correggi l\'importo se questa volta è diverso (es. la bolletta).'), amt, field('Data del movimento', dt), h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-ghost', { type: 'button', onclick: () => { skipRecurring(rule.id, date); s.close(true); toast('Saltata'); } }, 'Salta questa'), h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Registra')],
  });
}

const ruleEmoji = (ctx, r) => r.emoji || ctx.d.catById.get(r.category)?.emoji || (r.kind === 'transfer' ? '⇄' : '🔁');
const signed = r => (r.kind === 'income' ? r.amount : r.kind === 'expense' ? -r.amount : r.amount);
const amountEl = (r, cur, opts) => (r.amount ? money(signed(r), cur, opts) : h('span.muted', 'variabile'));

function ruleRow(ctx, r, date) {
  const cur = ctx.d.accById.get(r.account)?.currency;
  const nxt = date || nextOccurrence(r, r.lastPosted && addDays(r.lastPosted, 1) > today() ? addDays(r.lastPosted, 1) : addDays(today(), 1));
  return h('button.row', { type: 'button', class: r.active ? '' : 'archived', onclick: () => recurringEditor(ctx, r) },
    avatar(ruleEmoji(ctx, r)),
    h('span.row-main', h('span.row-title', r.name, r.autoPost ? h('span.pill', 'auto') : null, !r.active ? h('span.pill', 'in pausa') : null),
      h('span.row-sub', [describeRule(r), r.active && nxt ? `prossima ${formatDate(nxt)} (${relDays(nxt)})` : !r.active ? '' : 'terminata'].filter(Boolean).join(' · '))),
    h('span.row-end', amountEl(r, cur, { sign: r.kind === 'income', tone: r.kind === 'income' ? 'pos' : r.kind === 'transfer' ? 'mute' : '' })));
}

function calendar(ctx) {
  const { st } = ctx;
  const m = calMonth || monthKey(today());
  const [y, mo] = m.split('-').map(Number);
  const dim = daysInMonth(y, mo);
  const first = (weekday(toISO(y, mo, 1)) + 6) % 7;   // lunedì = 0
  const byDay = new Map();
  for (const r of st.recurring) {
    if (!r.active) continue;
    for (const dd of occurrences(r, toISO(y, mo, 1), toISO(y, mo, dim), 40)) {
      if (!byDay.has(dd)) byDay.set(dd, []);
      byDay.get(dd).push(r);
    }
  }
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(h('span.cal-cell.empty'));
  const t = today();
  for (let dd = 1; dd <= dim; dd++) {
    const iso = toISO(y, mo, dd);
    const items = byDay.get(iso) || [];
    const out = items.filter(r => r.kind === 'expense').length, inc = items.filter(r => r.kind === 'income').length;
    cells.push(h('button.cal-cell', { type: 'button', class: [iso === t ? 'today' : '', items.length ? 'has' : '', iso < t ? 'past' : ''].join(' '), disabled: !items.length, 'aria-label': `${dd}: ${items.map(r => r.name).join(', ') || 'nessuna scadenza'}`,
      onclick: () => {
        const s = openSheet({ title: formatDate(iso, { long: true, year: true }), size: 'sm', body: h('div.rows', items.map(r => ruleRow(ctx, r, iso))), footer: null });
        void s;
      } },
      h('span.cal-n', String(dd)),
      items.length ? h('span.cal-dots', inc ? h('i.dot-in') : null, out ? h('i.dot-out') : null, items.length - (inc ? 1 : 0) - (out ? 1 : 0) > 0 ? h('i.dot-tr') : null) : null));
  }
  const monthTotal = [...byDay.values()].flat().reduce((a, r) => a + (r.kind === 'expense' ? -1 : r.kind === 'income' ? 1 : 0) * ctx.d.toBase(r.amount, ctx.d.accById.get(r.account)?.currency || ctx.d.base), 0);
  return card(null, { cls: 'cal-card' },
    h('div.month-nav',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Mese precedente', onclick: () => { calMonth = addMonthKey(m, -1); ctx.rerender(); } }, icon('chevL', 20)),
      h('span.month-label', formatMonth(m)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Mese successivo', onclick: () => { calMonth = addMonthKey(m, 1); ctx.rerender(); } }, icon('chevR', 20))),
    h('div.cal', ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => h('span.cal-h', x)), cells),
    h('div.cal-foot', h('span.legend-item', h('i.dot-in'), 'entrate'), h('span.legend-item', h('i.dot-out'), 'uscite'), h('span.legend-item', h('i.dot-tr'), 'giroconti'), h('span.cal-sum', 'Saldo del mese: ', money(monthTotal, ctx.d.base, { sign: true, tone: monthTotal >= 0 ? 'pos' : 'neg' }))));
}

export default {
  render(ctx) {
    const { st, d } = ctx;
    if (!st.recurring.length) {
      return {
        title: 'Scadenze', node: h('section.card', empty({ icon: 'calendar', title: 'Nessuna scadenza', text: 'Stipendio, affitto, rata del mutuo, bollette, abbonamenti, PAC: inseriscili una volta, l\'app li ricorda e (se vuoi) li registra da sola.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => recurringEditor(ctx) }, icon('plus', 18), 'Aggiungi una scadenza') })),
        actions: [],
      };
    }
    const due = d.dueList();
    const subs = st.recurring.filter(r => r.subscription && r.kind === 'expense');
    const subYear = subs.filter(r => r.active).reduce((a, r) => a + d.toBase(r.amount, d.accById.get(r.account)?.currency || d.base) * perYear(r), 0);
    const header = h('section.card.nw-strip',
      h('div.stat', h('div.stat-label', 'Spese fisse al mese'), h('div.stat-value', money(Math.round(d.fixedMonthly)))),
      h('div.stat', h('div.stat-label', 'Entrate fisse al mese'), h('div.stat-value', money(Math.round(d.recurringIncomeMonthly), d.base, { tone: 'pos' }))),
      h('div.stat', h('div.stat-label', 'Abbonamenti all\'anno'), h('div.stat-value', money(Math.round(subYear)))));
    const dueCard = due.length ? card(`Da registrare (${due.length})`, { sub: 'Scadenze passate non ancora segnate', cls: 'due-card' }, h('div.rows', due.slice(0, 30).map(x => h('div.row.static',
      avatar(ruleEmoji(ctx, x.rule)),
      h('span.row-main', h('span.row-title', x.rule.name), h('span.row-sub', `${formatDate(x.date, { year: true })} · ${relDays(x.date)}`)),
      h('span.row-end', amountEl(x.rule, d.accById.get(x.rule.account)?.currency)),
      h('div.due-btns', h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: () => registerDialog(ctx, x.rule, x.date) }, 'Registra'), h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => skipRecurring(x.rule.id, x.date) }, 'Salta')))))) : null;
    let body;
    if (tab === 'prossime') {
      const up = d.upcoming(60);
      body = h('div.two-col', calendar(ctx), card('Nei prossimi 60 giorni', {}, up.length ? h('div.rows', up.slice(0, 40).map(x => h('button.row', { type: 'button', onclick: () => recurringEditor(ctx, x.rule) },
        h('span.date-chip', h('b', x.date.slice(8)), formatDate(x.date).split(' ')[1]),
        h('span.row-main', h('span.row-title', x.rule.name), h('span.row-sub', relDays(x.date) + (x.rule.autoPost ? ' · si registra da sola' : ' · te la chiederò'))),
        h('span.row-end', amountEl(x.rule, d.accById.get(x.rule.account)?.currency, { sign: x.rule.kind === 'income', tone: x.rule.kind === 'income' ? 'pos' : x.rule.kind === 'transfer' ? 'mute' : '' }))))) : h('p.muted', 'Niente in arrivo.')));
    } else if (tab === 'tutte') {
      const g = { income: 'Entrate', expense: 'Uscite', transfer: 'Giroconti e risparmi' };
      body = h('div.acc-grid', Object.entries(g).map(([k, label]) => {
        const items = st.recurring.filter(r => r.kind === k).sort((a, b) => b.active - a.active || b.amount - a.amount);
        return items.length ? card(label, {}, h('div.rows', items.map(r => ruleRow(ctx, r)))) : null;
      }));
    } else {
      const rows = subs.map(r => ({ r, y: d.toBase(r.amount, d.accById.get(r.account)?.currency || d.base) * perYear(r) })).sort((a, b) => b.y - a.y);
      body = card('Abbonamenti', { sub: `${subs.filter(r => r.active).length} attivi · ${moneyText(Math.round(subYear / 12))} al mese` },
        rows.length ? h('div.rows', rows.map(({ r, y }) => h('button.row', { type: 'button', class: r.active ? '' : 'archived', onclick: () => recurringEditor(ctx, r) },
          avatar(ruleEmoji(ctx, r)),
          h('span.row-main', h('span.row-title', r.name), h('span.row-sub', describeRule(r) + ' · ' + moneyText(r.amount, d.accById.get(r.account)?.currency))),
          h('span.row-end', h('span.amt', moneyText(Math.round(y))), h('span.row-sub', 'all\'anno'))))) : h('p.muted', 'Segna una scadenza come "abbonamento" per vederla qui.'),
        rows.length ? h('p.card-foot', icon('sparkle', 15), ` In 10 anni gli abbonamenti attivi costano ${moneyText(Math.round(subYear * 10))}. Vedi `, h('a', { href: '#/simulazioni/costo' }, 'quanto varrebbero investiti'), '.') : null);
    }
    return {
      title: 'Scadenze', sub: `${st.recurring.filter(r => r.active).length} attive`,
      node: h('div.stack', header, dueCard, segTabs([{ value: 'prossime', label: 'Calendario' }, { value: 'tutte', label: 'Tutte' }, { value: 'abbonamenti', label: 'Abbonamenti', count: subs.length || null }], tab, v => { tab = v; ctx.rerender(); }), body),
      actions: [h('button.btn.btn-soft', { type: 'button', onclick: () => recurringEditor(ctx) }, icon('plus', 18), h('span', 'Scadenza'))],
    };
  },
};
