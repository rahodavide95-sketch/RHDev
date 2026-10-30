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

const V = { kind: 'income', year: null, level: 'payee', empty: false, open: new Set(), layout: 'sheet', subtot: true };
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

    /* come il foglio di D: CATEGORIA | SUB CATEGORIA | NOTE | mesi | TOTALI | MEDIA MENS., celle unite e colorate */
    const sheetRows = [];
    for (const g of T.groups) {
      const col = groupColor(st, V.kind, g.name);
      const lines = g.cats.flatMap(c => {
        const ps = c.payees.length ? c.payees : [{ name: '', total: c.total, byMonth: c.byMonth }];
        return ps.map((p, pi) => ({ c, p, first: pi === 0, n: ps.length, note: p.name && p.name.toLowerCase() !== c.name.toLowerCase() ? p.name : '' }));
      });
      lines.forEach((l, li) => {
        const extra = `${l.c.id ? `&cat=${l.c.id}` : ''}${l.note ? `&q=${encodeURIComponent(l.note)}` : ''}`;
        sheetRows.push(h('tr.sh-row', { style: { '--chip': col } },
          li === 0 ? h('td.sticky.sh-grp', { rowSpan: lines.length }, h('span', g.name)) : null,
          l.first ? h('td.sh-sub', { rowSpan: l.n }, h('span.sub-chip', { style: { '--chip': col } }, l.c.emoji && l.c.emoji !== '•' ? l.c.emoji + ' ' : '', l.c.name)) : null,
          h('td.sh-note', l.note),
          cells(l.p, extra), ends(l.p)));
      });
      if (V.subtot) sheetRows.push(h('tr.sh-tot', { style: { '--chip': col } }, h('td.sticky', `Totale ${g.name}`), h('td.sh-sub2'), h('td'), cells(g, null), ends(g)));
    }
    const sheetTable = h('div.table-wrap.nw-scroll', h('table.table.nw-table.nw-months.year-table.sheet-table',
      h('thead', h('tr', h('th.sticky', 'CATEGORIA'), h('th.sh-sub2', 'SUB CATEGORIA'), h('th', 'NOTE'), months.map(m => h('th.num', { class: m >= curM ? 'future' : '' }, monthName(m + 1, true).toUpperCase())), h('th.num.diff', 'TOTALI'), h('th.num', 'MEDIA MENS.'))),
      h('tbody', sheetRows),
      h('tfoot', h('tr.total', h('td.sticky', 'TOTALE'), h('td.sh-sub2'), h('td'), months.map(m => h('td.num', { class: m >= curM ? 'future' : '' }, m >= curM && !T.byMonth[m] ? '' : t2(T.byMonth[m]) || '—')), ends(T)))));

    if (curM > 6) requestAnimationFrame(() => requestAnimationFrame(() => {
      const th = table.querySelectorAll('thead th')[Math.max(1, curM - 4)]; if (th) table.scrollLeft = th.offsetLeft - 150;
      const th2 = sheetTable.querySelectorAll('thead th')[Math.max(3, curM - 2)]; if (th2 && sheetTable.scrollWidth > sheetTable.clientWidth + 40) sheetTable.scrollLeft = th2.offsetLeft - 160;
    }));
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

    const kinds = segTabs([{ value: 'income', label: 'Entrate' }, { value: 'expense', label: 'Uscite' }], V.kind, v => { V.kind = v; V.open.clear(); ctx.go('entrate-uscite?tipo=' + (v === 'income' ? 'entrate' : 'uscite')); });
    const yearTabs = segTabs(years.map(y => ({ value: y, label: String(y) })), V.year, v => { V.year = v; ctx.rerender(); });
    const levels = segTabs([{ value: 'group', label: 'Categorie' }, { value: 'cat', label: '+ Sottocategorie' }, { value: 'payee', label: '+ Voci' }], V.level, v => { V.level = v; ctx.rerender(); });
    const layouts = segTabs([{ value: 'sheet', label: 'Come il foglio' }, { value: 'tree', label: 'A gruppi' }], V.layout, v => { V.layout = v; ctx.rerender(); });

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
        h('div.inv-filters', layouts, V.layout === 'tree' ? levels : h('label.chk', h('input', { type: 'checkbox', checked: V.subtot, onchange: e => { V.subtot = e.target.checked; ctx.rerender(); } }), 'Totale di ogni categoria'), h('label.chk', h('input', { type: 'checkbox', checked: V.empty, onchange: e => { V.empty = e.target.checked; ctx.rerender(); } }), 'Anche le categorie vuote')),
        hasData ? (V.layout === 'sheet' ? sheetTable : table) : empty({ icon: 'list', title: `Nessuna ${V.kind === 'income' ? 'entrata' : 'uscita'} nel ${V.year}`, text: 'Registra i movimenti con la loro categoria, o importa il tuo foglio Excel con le colonne GEN…DIC: qui li vedi mese per mese, come in un foglio.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => txEditor(ctx, null, { kind: V.kind }) }, icon('plus', 18), V.kind === 'income' ? 'Nuova entrata' : 'Nuova uscita'), h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), 'Importa da Excel')) })),
        (() => {
          const inv = V.kind === 'expense' ? st.transactions.filter(t => t.kind === 'expense' && t.tags?.includes('investimenti') && t.date.startsWith(String(V.year))).reduce((a, t) => a + d.txBase(t), 0) : 0;
          return inv ? h('p.fine', icon('info', 14), h('span', `L'imposta di bollo e le altre spese degli investimenti (${moneyText(inv)} nel ${V.year}) non sono qui, come nel tuo foglio: le trovi in Investimenti › Anno per anno.`)) : null;
        })(),
        h('p.fine', icon('info', 14), h('span', 'Categoria = gruppo, sottocategoria = categoria del movimento, voce = descrizione (es. "Groover", "SIAE"). Tocca un importo per vedere i movimenti, una sottocategoria per aprire le voci. Con "Categorie" le crei, rinomini, colori e riordini come vuoi.'))),
    };
  },
};

export { categoryEditor };
