/* Entrate e uscite dell'anno come il foglio di D: categoria → sottocategoria → voce,
   una colonna per mese, totale e media mensile. Tutto si sceglie e si organizza liberamente:
   categorie e sottocategorie si creano, rinominano, colorano e spostano da qui. */

import { h, icon, download } from '../ui/dom.js';
import { toast, empty } from '../ui/components.js';
import { moneyText, ui } from '../ui/fmt.js';
import { card, segTabs } from './common.js';
import { categoryEditor, txEditor } from './editors.js';
import { categoryManager, groupColor } from './categories.js';
import { openFileImport } from './invimport.js';
import { monthName, today } from '../core/dates.js';
import { toCSV, csvNumber } from '../core/csv.js';

const V = { kind: 'income', year: null, level: 'payee', empty: false, open: new Set() };
const t2 = v => (v ? moneyText(v, ui.base) : '');

export default {
  render(ctx) {
    const { st, d } = ctx;
    const q = ctx.route.query;
    if (q.tipo === 'uscite') V.kind = 'expense';
    else if (q.tipo === 'entrate') V.kind = 'income';
    const years = [...new Set(st.transactions.filter(t => t.kind !== 'transfer').map(t => +t.date.slice(0, 4)))].sort((a, b) => a - b);
    const cy = +today().slice(0, 4);
    if (!years.includes(cy)) years.push(cy);
    if (!V.year || !years.includes(V.year)) V.year = cy;
    const T = d.yearTable(V.year, V.kind, { empty: V.empty });
    const label = V.kind === 'income' ? 'Entrate' : 'Uscite';
    const avg = r => (T.months ? Math.round(r.total / T.months) : 0);
    const curM = V.year === cy ? +today().slice(5, 7) : V.year < cy ? 12 : 0;
    const months = Array.from({ length: 12 }, (_, i) => i);

    const goMonth = (m, extra = '') => ctx.go(`movimenti?mese=${V.year}-${String(m + 1).padStart(2, '0')}${extra}`);
    const cells = (r, extra) => months.map(m => h('td.num', {
      class: [m >= curM ? 'future' : '', r.byMonth[m] ? 'click' : 'muted'].join(' '),
      onclick: r.byMonth[m] && extra != null ? e => { e.stopPropagation(); goMonth(m, extra); } : null,
    }, m >= curM && !r.byMonth[m] ? '' : t2(r.byMonth[m]) || '—'));
    const ends = r => [h('td.num.diff', t2(r.total) || '—'), h('td.num', T.months && r.total ? moneyText(avg(r), ui.base) : '—')];

    const body = [];
    for (const g of T.groups) {
      const col = groupColor(st, V.kind, g.name);
      body.push(h('tr.grp', h('td.sticky', h('span.grp-chip', { style: { '--chip': col } }, g.name)), cells(g, null), ends(g)));
      if (V.level === 'group') continue;
      for (const c of g.cats) {
        const key = g.name + '|' + c.id;
        const hasP = V.level === 'payee' && c.payees.length > 0;
        const isOpen = V.level === 'payee' && (V.open.has(key) || c.payees.length === 1);
        body.push(h('tr.cat', { class: hasP ? 'click' : '', onclick: hasP && c.payees.length > 1 ? () => { if (V.open.has(key)) V.open.delete(key); else V.open.add(key); ctx.rerender(); } : null },
          h('td.sticky', h('span.sub-chip', { style: { '--chip': col } }, c.emoji && c.emoji !== '•' ? c.emoji + ' ' : '', c.name), hasP && c.payees.length > 1 ? h('span.exp', icon(isOpen ? 'chevD' : 'chevR', 14)) : null),
          cells(c, c.id ? `&cat=${c.id}` : ''), ends(c)));
        if (isOpen) for (const p of c.payees) body.push(h('tr.pay', h('td.sticky', h('span.pay-name', p.name)), cells(p, `${c.id ? `&cat=${c.id}` : ''}&q=${encodeURIComponent(p.name)}`), ends(p)));
      }
    }

    const exportCsv = () => {
      const rows = [['Categoria', 'Sottocategoria', 'Voce', ...months.map(m => monthName(m + 1, true)), 'Totale', 'Media mensile']];
      const line = (a, b, c, r) => [a, b, c, ...r.byMonth.map(v => (v ? csvNumber(v) : '')), csvNumber(r.total), T.months ? csvNumber(avg(r)) : ''];
      for (const g of T.groups) {
        rows.push(line(g.name, '', '', g));
        for (const c of g.cats) { rows.push(line(g.name, c.name, '', c)); for (const p of c.payees) rows.push(line(g.name, c.name, p.name, p)); }
      }
      rows.push(line('Totale', '', '', T));
      download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `${label.toLowerCase()}-${V.year}.csv`);
      toast('Tabella esportata', { kind: 'ok' });
    };

    const table = h('div.table-wrap.nw-scroll', h('table.table.nw-table.nw-months.year-table',
      h('thead', h('tr', h('th.sticky', label), months.map(m => h('th.num', { class: m >= curM ? 'future' : '' }, monthName(m + 1, true).toUpperCase())), h('th.num.diff', 'Totale'), h('th.num', 'Media mese'))),
      h('tbody', body),
      h('tfoot', h('tr.total', h('td.sticky', 'Totale'), months.map(m => h('td.num', { class: m >= curM ? 'future' : '' }, m >= curM && !T.byMonth[m] ? '' : t2(T.byMonth[m]) || '—')), ends(T)))));
    // si apre sui mesi più recenti
    if (curM > 6) requestAnimationFrame(() => requestAnimationFrame(() => { const th = table.querySelectorAll('thead th')[Math.max(1, curM - 4)]; if (th) table.scrollLeft = th.offsetLeft - 150; }));

    const kinds = segTabs([{ value: 'income', label: 'Entrate' }, { value: 'expense', label: 'Uscite' }], V.kind, v => { V.kind = v; V.open.clear(); ctx.go('entrate-uscite?tipo=' + (v === 'income' ? 'entrate' : 'uscite')); });
    const yearTabs = segTabs(years.map(y => ({ value: y, label: String(y) })), V.year, v => { V.year = v; ctx.rerender(); });
    const levels = segTabs([{ value: 'group', label: 'Categorie' }, { value: 'cat', label: '+ Sottocategorie' }, { value: 'payee', label: '+ Voci' }], V.level, v => { V.level = v; ctx.rerender(); });

    const hasData = T.groups.length > 0;
    return {
      title: 'Entrate e uscite', sub: `${label} ${V.year}, mese per mese`,
      actions: [
        h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), h('span', 'Importa')),
        h('button.btn.btn-soft', { type: 'button', onclick: () => categoryManager(ctx, V.kind) }, icon('edit', 18), h('span', 'Categorie')),
        h('button.btn.btn-soft', { type: 'button', onclick: () => txEditor(ctx, null, { kind: V.kind }) }, icon('plus', 18), h('span', V.kind === 'income' ? 'Entrata' : 'Uscita')),
      ],
      node: h('div.stack',
        h('div.year-bar', kinds, yearTabs),
        card(`${label} ${V.year}`, {
          sub: hasData ? `In totale ${moneyText(T.total)}${T.months ? `, in media ${moneyText(Math.round(T.total / T.months))} al mese` : ''}` : null,
          action: h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportCsv, disabled: !hasData }, icon('download', 16), 'CSV'),
        },
        h('div.inv-filters', levels, h('label.chk', h('input', { type: 'checkbox', checked: V.empty, onchange: e => { V.empty = e.target.checked; ctx.rerender(); } }), 'Anche le categorie vuote')),
        hasData ? table : empty({ icon: 'list', title: `Nessuna ${V.kind === 'income' ? 'entrata' : 'uscita'} nel ${V.year}`, text: 'Registra i movimenti con la loro categoria, o importa il tuo foglio Excel con le colonne GEN…DIC: qui li vedi mese per mese, come in un foglio.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => txEditor(ctx, null, { kind: V.kind }) }, icon('plus', 18), V.kind === 'income' ? 'Nuova entrata' : 'Nuova uscita'), h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), 'Importa da Excel')) })),
        h('p.fine', icon('info', 14), h('span', 'Categoria = gruppo, sottocategoria = categoria del movimento, voce = descrizione (es. "Groover", "SIAE"). Tocca un importo per vedere i movimenti, una sottocategoria per aprire le voci. Con "Categorie" le crei, rinomini, colori e riordini come vuoi.'))),
    };
  },
};

export { categoryEditor };
