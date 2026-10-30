/* Analisi: flussi mese per mese, tasso di risparmio, spese per categoria con il confronto,
   andamento di una categoria, beneficiari, giorni della settimana, patrimonio nel tempo. */

import { h, icon, download } from '../ui/dom.js';
import { barChart, lineChart, donut, SERIES, legend } from '../ui/charts.js';
import { selectInput, toast } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, segTabs } from './common.js';
import { lastMonths, monthKey, monthStart, monthEnd, formatMonth, weekday, addMonthKey } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { toCSV, csvNumber } from '../core/csv.js';

let span = 12;
let trendCat = '';
let catView = 'cat';

export default {
  render(ctx) {
    const { st, d } = ctx;
    const end = monthKey(d.refDate);
    const months = span === 'ytd' ? lastMonths(Number(end.slice(5)), end) : span === 'py' ? lastMonths(12, `${Number(end.slice(0, 4)) - 1}-12`) : lastMonths(span, end);
    const from = monthStart(months[0]), to = monthEnd(months[months.length - 1]);
    const prevMonths = months.map(m => addMonthKey(m, -months.length));
    const flows = months.map(m => ({ month: m, ...d.flows(monthStart(m), monthEnd(m)) }));
    const tot = d.flows(from, to);
    const prev = d.flows(monthStart(prevMonths[0]), monthEnd(prevMonths[prevMonths.length - 1]));
    const rate = tot.income > 0 ? (tot.income - tot.expense) / tot.income * 100 : null;
    const labels = months.map(m => formatMonth(m, true));
    const tips = months.map(m => formatMonth(m));

    const periodSel = segTabs([{ value: 6, label: '6 mesi' }, { value: 12, label: '12 mesi' }, { value: 24, label: '24 mesi' }, { value: 'ytd', label: 'Quest\'anno' }, { value: 'py', label: 'Anno scorso' }], span, v => { span = v; ctx.rerender(); });

    const kpis = h('section.card.nw-strip',
      h('div.stat', h('div.stat-label', 'Entrate'), h('div.stat-value', money(tot.income, d.base, { tone: 'pos' })), h('div.stat-extra', delta(prev.income ? (tot.income - prev.income) / prev.income * 100 : null), h('span.muted', ' vs periodo prima'))),
      h('div.stat', h('div.stat-label', 'Uscite'), h('div.stat-value', money(tot.expense)), h('div.stat-extra', delta(prev.expense ? (tot.expense - prev.expense) / prev.expense * 100 : null, { invert: true }), h('span.muted', ' vs periodo prima'))),
      h('div.stat', h('div.stat-label', 'Risparmiato'), h('div.stat-value', money(tot.net, d.base, { sign: true, tone: tot.net >= 0 ? 'pos' : 'neg' })), rate != null ? h('div.stat-extra', formatPercent(rate, 0), ' delle entrate') : null),
      h('div.stat', h('div.stat-label', 'Spesa media al mese'), h('div.stat-value', money(Math.round(tot.expense / months.length)))));

    const flowChart = card('Entrate e uscite', { sub: 'La linea è quanto hai risparmiato ogni mese' },
      barChart({ labels, tipLabels: tips, series: [{ name: 'Entrate', color: 'var(--c3)', values: flows.map(f => f.income) }, { name: 'Uscite', color: 'var(--c2)', values: flows.map(f => f.expense) }], line: { name: 'Risparmio', color: 'var(--ink)', values: flows.map(f => f.net) }, fmt: tipMoney, fmtAxis: axisMoney, height: 240, mask: ui.privacy, onPick: i => ctx.go(`movimenti?mese=${months[i]}`) }),
      legend([{ label: 'Entrate', color: 'var(--c3)' }, { label: 'Uscite', color: 'var(--c2)' }, { label: 'Risparmio', color: 'var(--ink)', line: true }]));

    const rates = flows.map(f => (f.income > 0 ? (f.income - f.expense) / f.income * 100 : null));
    const rateChart = card('Tasso di risparmio', { sub: rate != null ? `Media del periodo ${formatPercent(rate, 0)}` : '' },
      lineChart({ labels, tipLabels: tips, series: [{ name: 'Tasso di risparmio', color: 'var(--c1)', values: rates, area: true }], fmt: v => formatPercent(v, 1), fmtAxis: v => formatPercent(v, 0), height: 170, target: { value: 20, label: 'obiettivo 20%' } }));

    // categorie (o gruppi) del periodo con confronto
    const groupKey = id => {
      const c = d.catById.get(id);
      if (catView === 'grp') return c ? c.group : 'Senza categoria';
      return id;
    };
    const agg = (f) => {
      const m = new Map();
      for (const [id, v] of f.byCat) {
        const c = d.catById.get(id);
        if (!(c?.kind === 'expense' || id === '_exp')) continue;
        const k = groupKey(id);
        m.set(k, (m.get(k) || 0) + v);
      }
      return m;
    };
    const cur = agg(tot), old = agg(prev);
    const catRows = [...cur.entries()].sort((a, b) => b[1] - a[1]);
    const nameOf = k => (catView === 'grp' ? k : d.catById.get(k) ? `${d.catById.get(k).emoji} ${d.catById.get(k).name}` : '∅ Senza categoria');
    const items = catRows.slice(0, 7).map(([k, v], i) => ({ label: nameOf(k), value: v, color: SERIES[i], k }));
    const rest = catRows.slice(7).reduce((a, x) => a + x[1], 0);
    if (rest) items.push({ label: 'Altre', value: rest, color: 'var(--c-other)' });
    const catCard = card('Dove vanno i soldi', { action: segTabs([{ value: 'cat', label: 'Categorie' }, { value: 'grp', label: 'Gruppi' }], catView, v => { catView = v; ctx.rerender(); }) },
      catRows.length ? h('div.donut-row', donut({ items, size: 180, thickness: 22, center: { value: moneyText(tot.expense), label: 'uscite' }, fmt: tipMoney, mask: ui.privacy }),
        h('div.table-wrap', h('table.table.compact.cat-table', { 'data-tid': 'cat' }, h('thead', h('tr', h('th', catView === 'grp' ? 'Gruppo' : 'Categoria'), h('th.num', 'Totale'), h('th.num', 'Al mese'), h('th.num', 'Quota'), h('th.num', 'Vs prima'))),
          h('tbody', catRows.map(([k, v], i) => {
            const o = old.get(k) || 0;
            return h('tr', { class: catView === 'cat' && k !== '_exp' ? 'click' : '', onclick: catView === 'cat' && k !== '_exp' ? () => { trendCat = k; ctx.rerender(); } : null },
              h('td', h('span.dl-key', { style: { background: i < 7 ? SERIES[i] : 'var(--c-other)' } }), nameOf(k)),
              h('td.num', moneyText(v)), h('td.num', moneyText(Math.round(v / months.length))), h('td.num', formatPercent(v / (tot.expense || 1) * 100, 1)),
              h('td.num', o ? delta((v - o) / o * 100, { invert: true }) : h('span.muted', 'nuovo')));
          }))))) : h('p.muted', 'Nessuna spesa nel periodo.'));

    // andamento di una categoria
    const expCats = st.categories.filter(c => c.kind === 'expense');
    if (!trendCat || !d.catById.get(trendCat)) trendCat = catRows.find(([k]) => d.catById.get(k))?.[0] || expCats[0]?.id || '';
    const tc = d.catById.get(trendCat);
    const tVals = flows.map(f => f.byCat.get(trendCat) || 0);
    const tAvg = tVals.reduce((a, b) => a + b, 0) / (tVals.length || 1);
    const trendCard = tc ? card('Andamento di una categoria', { action: selectInput(expCats.map(c => ({ value: c.id, label: `${c.emoji} ${c.name}`, group: c.group })), trendCat, v => { trendCat = v; ctx.rerender(); }) },
      barChart({ labels, tipLabels: tips, series: [{ name: tc.name, color: 'var(--c1)', values: tVals }], fmt: tipMoney, fmtAxis: axisMoney, height: 180, mask: ui.privacy, onPick: i => ctx.go(`movimenti?cat=${trendCat}&mese=${months[i]}`) }),
      h('p.card-foot', 'Media ', h('b', moneyText(Math.round(tAvg))), ' al mese', st.budgets[trendCat] ? [' · budget ', h('b', moneyText(st.budgets[trendCat]))] : '')) : null;

    // beneficiari e giorni della settimana
    const payees = new Map(), wd = [0, 0, 0, 0, 0, 0, 0];
    for (const t of st.transactions) {
      if (t.kind !== 'expense' || t.date < from || t.date > to) continue;
      const v = d.txBase(t);
      const k = (t.payee || '—').trim();
      const p = payees.get(k.toLowerCase()) || { name: k, v: 0, n: 0 };
      p.v += v; p.n++;
      payees.set(k.toLowerCase(), p);
      wd[(weekday(t.date) + 6) % 7] += v;
    }
    const topPayees = [...payees.values()].sort((a, b) => b.v - a.v).slice(0, 10);
    const payeeCard = card('Dove spendi di più', { sub: 'Per descrizione del movimento' }, topPayees.length ? h('div.mini-list', topPayees.map(p => h('a.mini-row', { href: `#/movimenti?q=${encodeURIComponent(p.name)}&tutto=1` }, h('span.mini-l', p.name), h('span.mini-r', moneyText(p.v), h('span.muted', ` · ${p.n}×`))))) : h('p.muted', 'Nessuna spesa.'));
    const wdCard = card('Giorni della settimana', { sub: 'Quanto spendi in ogni giorno' }, barChart({ labels: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'], series: [{ name: 'Spese', color: 'var(--c7)', values: wd }], fmt: tipMoney, fmtAxis: axisMoney, height: 170, mask: ui.privacy }));

    // patrimonio
    const nw = d.netWorthHistory(Math.max(months.length, 12));
    const nwCard = card('Patrimonio nel tempo', { sub: 'Fine di ogni mese' },
      lineChart({ labels: nw.map(x => formatMonth(x.month, true)), tipLabels: nw.map(x => formatMonth(x.month)), series: [
        { name: 'Patrimonio netto', color: 'var(--c1)', values: nw.map(x => x.total) },
        { name: 'Liquidità', color: 'var(--c3)', values: nw.map(x => x.liq) },
        { name: 'Investimenti', color: 'var(--c7)', values: nw.map(x => x.inv) },
        { name: 'Debiti', color: 'var(--c8)', values: nw.map(x => x.debt), dashed: true },
      ], fmt: tipMoney, fmtAxis: axisMoney, height: 240, mask: ui.privacy }),
      legend([{ label: 'Patrimonio netto', color: 'var(--c1)', line: true }, { label: 'Liquidità', color: 'var(--c3)', line: true }, { label: 'Investimenti', color: 'var(--c7)', line: true }, { label: 'Debiti', color: 'var(--c8)', dashed: true }]));

    // tabella mese per mese
    const tableCard = card('Mese per mese', { action: h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => {
      const rows = [['Mese', 'Entrate', 'Uscite', 'Risparmio', 'Tasso di risparmio %']];
      flows.forEach(f => rows.push([f.month, csvNumber(f.income), csvNumber(f.expense), csvNumber(f.net), f.income ? ((f.net / f.income) * 100).toFixed(1).replace('.', ',') : '']));
      download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `riepilogo-mensile-${months[0]}-${months[months.length - 1]}.csv`);
      toast('Riepilogo esportato', { kind: 'ok' });
    } }, icon('download', 16), 'CSV') },
      h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Mese'), h('th.num', 'Entrate'), h('th.num', 'Uscite'), h('th.num', 'Risparmio'), h('th.num', 'Tasso'))),
        h('tbody', [...flows].reverse().map(f => h('tr.click', { onclick: () => ctx.go(`movimenti?mese=${f.month}`) }, h('td', formatMonth(f.month)), h('td.num.pos', moneyText(f.income)), h('td.num', moneyText(f.expense)), h('td.num', { class: f.net >= 0 ? 'pos' : 'neg' }, moneyText(f.net, d.base, { sign: true })), h('td.num', f.income ? formatPercent(f.net / f.income * 100, 0) : '—')))),
        h('tfoot', h('tr', h('td', 'Totale'), h('td.num', moneyText(tot.income)), h('td.num', moneyText(tot.expense)), h('td.num', moneyText(tot.net, d.base, { sign: true })), h('td.num', rate != null ? formatPercent(rate, 0) : '—'))))));

    return {
      title: 'Analisi', sub: `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`,
      node: h('div.stack', periodSel, kpis, h('div.two-col', flowChart, rateChart), catCard, h('div.two-col', trendCard, payeeCard), h('div.two-col', nwCard, wdCard), tableCard),
    };
  },
};
