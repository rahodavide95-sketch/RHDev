/* Conti: elenco per gruppo con i totali, e la pagina di ogni conto con andamento,
   movimenti, punti fermi del saldo e (per mutui e prestiti) il piano d'ammortamento. */

import { h, icon } from '../ui/dom.js';
import { lineChart } from '../ui/charts.js';
import { empty, twoTap } from '../ui/components.js';
import { money, moneyText, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, accountRow, txGroups, avatar, accAvatar, linkBtn } from './common.js';
import { accountEditor, adjustEditor, txEditor, holdingEditor, undoToast } from './editors.js';
import { deleteValuation } from '../actions.js';
import { ACCOUNT_TYPES, GROUPS, isLiability, hasHoldings, hasPlan, paidInstallments, position } from '../core/model.js';
import { formatMonth, formatDate, lastMonths, monthKey, monthEnd, addMonths } from '../core/dates.js';
import { simLoan } from '../core/finance.js';
import { formatPercent } from '../core/money.js';

let showArchived = false;

function list(ctx) {
  const { st, d } = ctx;
  const accs = st.accounts.filter(a => showArchived || !a.archived || (a.inNetWorth && (d.balances.get(a.id) || 0) !== 0));
  if (!st.accounts.length) {
    return h('section.card', empty({ icon: 'wallet', title: 'Nessun conto', text: 'Aggiungi conto corrente, carte, conto deposito, investimenti, casa, auto, mutuo: tutto ciò che possiedi o devi.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => accountEditor(ctx) }, icon('plus', 18), 'Aggiungi un conto') }));
  }
  const groups = Object.entries(GROUPS).sort((a, b) => a[1].order - b[1].order).map(([g, meta]) => {
    const items = accs.filter(a => ACCOUNT_TYPES[a.type].group === g).sort((a, b) => a.order - b.order || a.created - b.created);
    if (!items.length) return null;
    const tot = items.filter(a => a.inNetWorth).reduce((s, a) => s + d.toBase(d.balances.get(a.id) || 0, a.currency), 0);
    return card(meta.label, { action: money(tot, d.base, { tone: tot < 0 ? 'neg' : '', cls: 'card-total' }) }, h('div.rows', items.map(a => {
      const row = accountRow(ctx, a);
      if (a.archived) row.classList.add('archived');
      if (!a.inNetWorth) row.querySelector('.row-sub').append(' · fuori dal patrimonio');
      return row;
    })));
  });
  const archivedN = st.accounts.filter(a => a.archived).length;
  return h('div.stack',
    h('section.card.nw-strip',
      h('div.stat.stat-wide', h('div.stat-label', 'Patrimonio netto'), h('div.stat-value.big', money(d.netWorth))),
      h('div.stat', h('div.stat-label', 'Attività'), h('div.stat-value', money(d.assets))),
      h('div.stat', h('div.stat-label', 'Debiti'), h('div.stat-value', money(d.groupTotals.debt, d.base, { tone: d.groupTotals.debt < 0 ? 'neg' : '' }))),
      h('a.btn.btn-soft.nw-link', { href: '#/patrimonio' }, icon('layers', 18), 'Andamento mese per mese')),
    h('div.acc-grid', groups),
    archivedN ? h('button.btn.btn-ghost', { type: 'button', onclick: () => { showArchived = !showArchived; ctx.rerender(); } }, icon('archive', 18), showArchived ? 'Nascondi archiviati' : `Mostra archiviati (${archivedN})`) : null);
}

function planCard(ctx, a) {
  const p = a.plan;
  const r = simLoan({ principal: p.principal, tan: p.tan, months: p.months, type: p.type });
  const paid = paidInstallments(p, ctx.d.refDate);
  const residual = paid > 0 ? r.rows[Math.min(paid, r.rows.length) - 1].balance : p.principal;
  const next = paid < r.rows.length ? r.rows[paid] : null;
  const interestPaid = r.rows.slice(0, paid).reduce((s, x) => s + x.interest, 0);
  const years = r.years.map(y => y.balance);
  return card('Piano d\'ammortamento', { sub: `${p.type === 'italiano' ? 'Quota capitale costante' : 'Rata costante'} · TAN ${formatPercent(p.tan, 2)} · ${p.months / 12} anni` },
    h('div.stats-3',
      h('div.stat', h('div.stat-label', 'Rate pagate'), h('div.stat-value', `${paid} / ${p.months}`)),
      h('div.stat', h('div.stat-label', 'Prossima rata'), h('div.stat-value', next ? money(Math.round(next.rata * 100), a.currency) : '—'), next ? h('div.stat-extra', formatDate(addMonths(p.start, paid + 1), { year: true })) : null),
      h('div.stat', h('div.stat-label', 'Interessi pagati'), h('div.stat-value', money(Math.round(interestPaid * 100), a.currency)), h('div.stat-extra', `su ${moneyText(Math.round(r.totals.interest * 100), a.currency)} totali`))),
    lineChart({ labels: r.years.map(y => 'Anno ' + y.year), series: [{ name: 'Debito residuo', color: 'var(--c8)', values: years.map(v => Math.round(v * 100)), area: true }], fmt: tipMoney, fmtAxis: axisMoney, height: 170, mask: ui.privacy }),
    h('p.card-foot', 'Debito residuo oggi: ', h('b', moneyText(Math.round(residual * 100), a.currency)), '. Per simulare un\'estinzione anticipata usa ', h('a', { href: '#/simulazioni/mutuo' }, 'Simulazioni › Mutuo'), '.'));
}

function detail(ctx, id) {
  const { st, d } = ctx;
  const a = st.accounts.find(x => x.id === id);
  if (!a) return { title: 'Conto', node: h('section.card', empty({ icon: 'wallet', title: 'Conto non trovato', action: linkBtn('Torna ai conti', '#/conti') })) };
  const t = ACCOUNT_TYPES[a.type];
  const v = d.balances.get(a.id) || 0;
  const months = lastMonths(12, monthKey(d.refDate));
  const hist = months.map(m => (m === monthKey(d.refDate) ? v : d.accountValue(a, monthEnd(m))));
  const txs = st.transactions.filter(x => x.account === a.id || x.toAccount === a.id).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.created - x.created));
  const vals = st.valuations.filter(x => x.account === a.id).sort((x, y) => (x.date < y.date ? 1 : -1));
  const holdings = hasHoldings(a) ? st.holdings.filter(hd => hd.account === a.id) : [];
  const inflow = txs.filter(x => (x.kind === 'income' && x.account === a.id) || (x.kind === 'transfer' && x.toAccount === a.id)).length;
  const node = h('div.stack',
    h('section.card.acc-hero',
      h('div.acc-hero-top', accAvatar(a),
        h('div', h('div.hero-label', [t.label, a.institution, a.currency !== d.base ? a.currency : ''].filter(Boolean).join(' · ')), h('div.hero-value', money(v, a.currency, { tone: v < 0 ? 'neg' : '' })),
          a.currency !== d.base ? h('div.muted', '≈ ', moneyText(d.toBase(v, a.currency))) : null)),
      hasPlan(a) ? null : lineChart({ labels: months.map(m => formatMonth(m, true)), tipLabels: months.map(m => formatMonth(m)), series: [{ name: 'Saldo', color: isLiability(a) ? 'var(--c8)' : 'var(--c1)', values: hist, area: true }], fmt: c => moneyText(Math.round(c), a.currency), fmtAxis: axisMoney, height: 170, zero: false, mask: ui.privacy }),
      h('div.row-btns',
        !hasPlan(a) ? h('button.btn.btn-soft', { type: 'button', onclick: () => adjustEditor(ctx, a) }, icon('check', 18), t.group === 'assets' ? 'Aggiorna valore' : 'Aggiorna saldo') : null,
        h('button.btn.btn-soft', { type: 'button', onclick: () => txEditor(ctx, null, { account: a.id }) }, icon('plus', 18), 'Movimento'),
        hasHoldings(a) ? h('button.btn.btn-soft', { type: 'button', onclick: () => holdingEditor(ctx, null, { account: a.id }) }, icon('trend', 18), 'Titolo') : null,
        h('a.btn.btn-ghost', { href: `#/movimenti?conto=${a.id}&tutto=1` }, icon('list', 18), 'Tutti i movimenti'))),
    hasPlan(a) ? planCard(ctx, a) : null,
    holdings.length ? card('Titoli', { action: linkBtn('Portafoglio', '#/investimenti') }, h('div.rows', holdings.map(hd => {
      const p = position(hd);
      return h('a.row', { href: '#/investimenti/' + hd.id }, avatar(hd.symbol ? hd.symbol.slice(0, 2) : '📈'), h('span.row-main', h('span.row-title', hd.name), h('span.row-sub', `${p.qty.toLocaleString('it-IT', { maximumFractionDigits: 6 })} × ${hd.price.toLocaleString('it-IT', { maximumFractionDigits: 4 })} ${hd.currency}`)), h('span.row-end', money(Math.round(p.value * 100), hd.currency)));
    }))) : null,
    txs.length ? card('Movimenti recenti', { action: linkBtn('Tutti', `#/movimenti?conto=${a.id}&tutto=1`) }, ...txGroups(ctx, txs.slice(0, 30), { showAccount: false })) : (!hasPlan(a) && t.group !== 'assets' ? card('Movimenti', {}, h('p.muted', inflow ? '' : 'Ancora nessun movimento su questo conto.')) : null),
    vals.length ? card(t.group === 'assets' ? 'Valutazioni' : 'Saldi verificati', { sub: 'Punti fermi: da qui si sommano i movimenti successivi' }, h('div.rows', vals.map(x => h('div.row.static',
      h('span.date-chip', h('b', x.date.slice(8)), formatDate(x.date).split(' ')[1]),
      h('span.row-main', h('span.row-title', x.kind === 'open' ? 'Saldo iniziale' : (x.note || 'Saldo aggiornato')), h('span.row-sub', formatDate(x.date, { year: true }))),
      h('span.row-end', money(x.value, a.currency)),
      x.kind !== 'open' ? twoTap('', () => { deleteValuation(x.id); undoToast('Eliminato'); }, { cls: 'icon-btn danger', iconName: 'trash', confirmLabel: '?' }) : null)))) : null,
    a.notes ? card('Note', {}, h('p.pre', a.notes)) : null);
  return {
    title: a.name, sub: t.label, node,
    actions: [h('a.icon-btn', { href: '#/conti', 'aria-label': 'Tutti i conti' }, icon('chevL', 20)), h('button.icon-btn', { type: 'button', 'aria-label': 'Modifica il conto', onclick: () => accountEditor(ctx, a) }, icon('edit', 20))],
  };
}

export default {
  render(ctx) {
    const id = ctx.route.params[0];
    if (id) return detail(ctx, id);
    return { title: 'Conti', sub: `${ctx.st.accounts.filter(a => !a.archived).length} conti`, node: list(ctx), actions: [h('button.btn.btn-soft', { type: 'button', onclick: () => accountEditor(ctx) }, icon('plus', 18), h('span', 'Conto'))] };
  },
};
