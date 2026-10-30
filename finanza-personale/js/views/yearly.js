/* Entrate e uscite dell'anno, come un bilancio: le macro categorie (es. LAVORO, MUSICA,
   INT. BANCA, ALTRO) sono la somma delle loro sottocategorie (STIPENDIO, 13ESIMA, DJ, CC…).
   In alto i numeri dell'anno, poi una scheda per macro categoria, il grafico mese per mese
   e la tabella: riga della macro (somma) e sotto le sue sottocategorie, mesi, totale, media
   e quota. Le note (voci) si vedono a richiesta. Categorie da "Categorie" (crea, rinomina,
   colora, riordina). */

import { h, icon, download } from '../ui/dom.js';
import { toast, empty } from '../ui/components.js';
import { money, moneyText, delta, tipMoney, axisMoney, ui } from '../ui/fmt.js';
import { card, segTabs, filterBox, stat } from './common.js';
import { categoryEditor, txEditor } from './editors.js';
import { categoryManager, groupColor } from './categories.js';
import { openFileImport } from './invimport.js';
import { barChart, sparkline, legend } from '../ui/charts.js';
import { monthName, today } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { toCSV, csvNumber } from '../core/csv.js';

const V = { kind: 'income', year: null, empty: true, notes: false, closed: new Set(), openNotes: new Set(), focus: '', q: '' };
const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const zero = () => ({ total: 0, byMonth: Array(12).fill(0) });
const add = (a, b) => { a.total += b.total; b.byMonth.forEach((v, i) => { a.byMonth[i] += v; }); return a; };

/** Solo le righe che contengono il testo (macro, sottocategoria o nota), con i totali rifatti. */
function filterTable(T, q, focus) {
  const n = norm(q);
  if (!n && !focus) return T;
  const tot = zero();
  const groups = T.groups.filter(g => !focus || g.name === focus).map(g => {
    if (!n || norm(g.name).includes(n)) { add(tot, g); return g; }
    const cats = g.cats.map(c => {
      if (norm(c.name).includes(n)) return c;
      const payees = c.payees.filter(p => norm(p.name).includes(n));
      return payees.length ? { ...c, payees, ...payees.reduce(add, zero()) } : null;
    }).filter(Boolean);
    if (!cats.length) return null;
    const gg = { ...g, cats, ...cats.reduce(add, zero()) };
    add(tot, gg);
    return gg;
  }).filter(Boolean);
  return { ...T, groups, ...tot };
}
/** Macro senza sottocategorie vere (es. ALTRO): una riga sola. */
const single = g => g.cats.length === 1 && norm(g.cats[0].name) === norm(g.name);
/** Note diverse dal nome della sottocategoria (es. "Groover" sotto PRODUZIONE). */
const notesOf = c => c.payees.filter(p => p.name && norm(p.name) !== norm(c.name) && p.name !== 'Senza descrizione');

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
    const full = d.yearTable(V.year, V.kind, { empty: V.empty });
    if (V.focus && !full.groups.some(g => g.name === V.focus)) V.focus = '';
    const T = filterTable(full, V.q, V.focus);
    const label = V.kind === 'income' ? 'Entrate' : 'Uscite';
    const one = V.kind === 'income' ? 'entrata' : 'uscita';
    const curM = V.year === cy ? +today().slice(5, 7) : V.year < cy ? 12 : 0;   // mesi trascorsi
    const months = Array.from({ length: 12 }, (_, i) => i);
    const avg = r => (T.months ? Math.round(r.total / T.months) : 0);
    const share = r => (T.total ? r.total / T.total * 100 : 0);
    const colOf = g => groupColor(st, V.kind, g.name);
    const t2 = v => (v ? moneyText(v, ui.base) : '');
    const goMonth = (m, extra) => ctx.go(`movimenti?mese=${V.year}-${String(m + 1).padStart(2, '0')}${extra}`);

    /* ── numeri dell'anno ── */
    const prev = d.yearTable(V.year - 1, V.kind).total;
    const passed = full.byMonth.slice(0, Math.max(1, curM));
    const best = passed.reduce((b, v, i) => (v > b.v ? { v, i } : b), { v: 0, i: -1 });
    const lastM = curM ? curM - 1 : 0;
    const kpis = h('section.card.fin-kpis', h('div.stats-4',
      stat(`${label} ${V.year}`, money(full.total), prev ? h('span', delta(prev ? (full.total - prev) / prev * 100 : 0, { invert: V.kind === 'expense' }), ` sul ${V.year - 1} (${moneyText(prev)})`) : `${full.months} mesi`),
      stat('Media al mese', money(full.months ? Math.round(full.total / full.months) : 0), `su ${full.months || 0} ${full.months === 1 ? 'mese' : 'mesi'}`),
      stat(V.kind === 'income' ? 'Mese migliore' : 'Mese più caro', best.i >= 0 ? money(best.v) : '—', best.i >= 0 ? monthName(best.i + 1) : ''),
      stat(V.year === cy ? `${monthName(curM)} finora` : `${monthName(lastM + 1)}`, money(full.byMonth[lastM] || 0), full.months && full.total ? h('span', delta(((full.byMonth[lastM] || 0) / (full.total / full.months) - 1) * 100, { invert: V.kind === 'expense' }), ' rispetto alla media') : '')));

    /* ── una scheda per macro categoria ── */
    const cards = full.groups.length ? h('div.fin-cards', full.groups.map(g => {
      const col = colOf(g), p = full.total ? g.total / full.total * 100 : 0;
      const on = V.focus === g.name;
      return h('button.fin-card', { type: 'button', class: on ? 'on' : V.focus ? 'dim' : '', style: { '--chip': col }, 'aria-pressed': String(on), onclick: () => { V.focus = on ? '' : g.name; ctx.rerender(); } },
        h('span.fin-card-top', h('span.fin-card-name', g.name), h('span.fin-card-pct', formatPercent(p, 1))),
        h('span.fin-card-val', money(g.total)),
        h('span.fin-bar', h('i', { style: { width: Math.min(100, p) + '%' } })),
        h('span.fin-card-sub', single(g) ? `media ${moneyText(full.months ? Math.round(g.total / full.months) : 0)} al mese` : `${g.cats.length} ${g.cats.length === 1 ? 'voce' : 'voci'} · media ${moneyText(full.months ? Math.round(g.total / full.months) : 0)} al mese`),
        sparkline(g.byMonth.slice(0, Math.max(2, curM)), { color: col, width: 150, height: 30 }));
    })) : null;

    /* ── grafico: macro categorie impilate mese per mese ── */
    const chartGroups = T.groups;
    const chart = chartGroups.length ? card('Mese per mese', { sub: `${label} di ogni mese, divise per categoria` },
      barChart({
        labels: months.map(m => monthName(m + 1, true)), tipLabels: months.map(m => `${monthName(m + 1)} ${V.year}`),
        series: chartGroups.map(g => ({ name: g.name, color: colOf(g), values: g.byMonth })),
        stacked: true, fmt: tipMoney, fmtAxis: axisMoney, height: 230, mask: ui.privacy,
      }),
      legend(chartGroups.map(g => ({ label: g.name, color: colOf(g) })))) : null;

    /* ── tabella: macro (somma) → sottocategorie → note ── */
    const cells = (r, extra, strong) => months.map(m => h('td.num', {
      class: [m >= curM ? 'future' : '', r.byMonth[m] ? (extra != null ? 'click' : '') : 'muted', strong ? 'b' : ''].join(' '),
      onclick: r.byMonth[m] && extra != null ? e => { e.stopPropagation(); goMonth(m, extra); } : null,
    }, m >= curM && !r.byMonth[m] ? '' : t2(r.byMonth[m]) || '–'));
    const ends = r => [h('td.num.fin-tot', t2(r.total) || '–'), h('td.num', T.months && r.total ? moneyText(avg(r), ui.base) : '–'), h('td.num.fin-pct', r.total && T.total ? formatPercent(share(r), 1) : '–')];
    const body = [];
    for (const g of T.groups) {
      const col = colOf(g);
      const isSingle = single(g);
      const closed = V.closed.has(g.name);
      const catId = isSingle ? g.cats[0].id : null;
      body.push(h('tr.fin-macro', { style: { '--chip': col }, class: isSingle ? '' : 'click', onclick: isSingle ? null : () => { if (closed) V.closed.delete(g.name); else V.closed.add(g.name); ctx.rerender(); } },
        h('td.sticky', h('span.fin-macro-name', isSingle ? h('span.fin-caret') : h('span.fin-caret', icon(closed ? 'chevR' : 'chevD', 14)), g.name)),
        cells(g, catId ? `&cat=${catId}` : null, true), ends(g)));
      const showNotes = c => V.notes || V.openNotes.has(c.id || c.name);
      if (isSingle) {
        const c = g.cats[0];
        if (showNotes(c)) for (const p of notesOf(c)) body.push(h('tr.fin-note', h('td.sticky', h('span', p.name)), cells(p, `${c.id ? `&cat=${c.id}` : ''}&q=${encodeURIComponent(p.name)}`), ends(p)));
        continue;
      }
      if (closed) continue;
      for (const c of g.cats) {
        const ns = notesOf(c);
        const key = c.id || c.name;
        body.push(h('tr.fin-sub', { style: { '--chip': col } },
          h('td.sticky', h('span.fin-sub-name', c.name),
            ns.length && !V.notes ? h('button.fin-notes-btn', { type: 'button', 'aria-label': 'Mostra le note', onclick: e => { e.stopPropagation(); if (V.openNotes.has(key)) V.openNotes.delete(key); else V.openNotes.add(key); ctx.rerender(); } }, `${ns.length} ${ns.length === 1 ? 'nota' : 'note'}`, icon(V.openNotes.has(key) ? 'chevD' : 'chevR', 12)) : null),
          cells(c, c.id ? `&cat=${c.id}` : ''), ends(c)));
        if (showNotes(c)) for (const p of ns) body.push(h('tr.fin-note', h('td.sticky', h('span', p.name)), cells(p, `${c.id ? `&cat=${c.id}` : ''}&q=${encodeURIComponent(p.name)}`), ends(p)));
      }
    }
    const tableWrap = h('div.table-wrap.nw-scroll', h('table.table.nw-table.nw-months.fin-table', { 'data-tid': `fin-${V.kind}` },
      h('thead', h('tr', h('th.sticky', 'Categoria'), months.map(m => h('th.num', { class: m >= curM ? 'future' : '' }, monthName(m + 1, true).toUpperCase())), h('th.num.fin-tot', 'Totale'), h('th.num', 'Media'), h('th.num', '%'))),
      h('tbody', body),
      h('tfoot', h('tr.fin-grand', h('td.sticky', V.focus || V.q ? `Totale (filtrato)` : `Totale ${label.toLowerCase()}`), cells(T, null, true), ends(T)))));
    // su schermi stretti si apre sui mesi più recenti
    if (curM > 6) requestAnimationFrame(() => requestAnimationFrame(() => {
      if (tableWrap.scrollWidth <= tableWrap.clientWidth + 20) return;
      const th = tableWrap.querySelectorAll('thead th')[Math.max(1, curM - 3)];
      if (th) tableWrap.scrollLeft = th.offsetLeft - 190;
    }));

    const exportCsv = () => {
      const rows = [['Categoria', 'Sottocategoria', 'Nota', ...months.map(m => monthName(m + 1, true)), 'Totale', 'Media mensile', '%']];
      const line = (a, b, c, r) => [a, b, c, ...r.byMonth.map(v => (v ? csvNumber(v) : '')), csvNumber(r.total), T.months ? csvNumber(avg(r)) : '', T.total ? share(r).toFixed(1).replace('.', ',') : ''];
      for (const g of T.groups) {
        rows.push(line(g.name, '', '', g));
        if (!single(g)) for (const c of g.cats) { rows.push(line(g.name, c.name, '', c)); for (const p of notesOf(c)) rows.push(line(g.name, c.name, p.name, p)); }
      }
      rows.push(line('Totale', '', '', T));
      download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `${label.toLowerCase()}-${V.year}.csv`);
      toast('Tabella esportata', { kind: 'ok' });
    };

    const kinds = segTabs([{ value: 'income', label: 'Entrate' }, { value: 'expense', label: 'Uscite' }], V.kind, v => { V.kind = v; V.closed.clear(); V.focus = ''; ctx.go('entrate-uscite?tipo=' + (v === 'income' ? 'entrate' : 'uscite')); });
    const yearTabs = segTabs(years.map(y => ({ value: y, label: String(y) })), V.year, v => { V.year = v; ctx.rerender(); });
    const anyClosed = T.groups.some(g => V.closed.has(g.name));
    const hasData = full.groups.length > 0;
    const invCosts = V.kind === 'expense' ? st.transactions.filter(t => t.kind === 'expense' && t.tags?.includes('investimenti') && t.date.startsWith(String(V.year))).reduce((a, t) => a + d.txBase(t), 0) : 0;

    const tableCard = card(V.focus ? `${label} ${V.year} · ${V.focus}` : `${label} ${V.year} per categoria`, {
      sub: 'La riga colorata è la somma della categoria; sotto, le sue voci. Tocca un importo per vedere i movimenti.',
      action: h('div.card-acts',
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { if (anyClosed) V.closed.clear(); else T.groups.forEach(g => V.closed.add(g.name)); ctx.rerender(); } }, icon(anyClosed ? 'chevD' : 'chevR', 16), anyClosed ? 'Apri tutto' : 'Chiudi tutto'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportCsv }, icon('download', 16), 'CSV')),
    },
    h('div.inv-filters',
      filterBox('ent', V.q, v => { V.q = v; ctx.rerender(); }, 'Filtra: categoria, voce o nota'),
      V.focus ? h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: () => { V.focus = ''; ctx.rerender(); } }, icon('x', 14), `Solo ${V.focus}`) : null,
      h('label.chk', h('input', { type: 'checkbox', checked: V.notes, onchange: e => { V.notes = e.target.checked; ctx.rerender(); } }), 'Mostra tutte le note'),
      h('label.chk', h('input', { type: 'checkbox', checked: V.empty, onchange: e => { V.empty = e.target.checked; ctx.rerender(); } }), 'Anche le voci senza importi')),
    T.groups.length ? tableWrap : h('p.muted', 'Nessuna riga con questo filtro.'));

    return {
      title: 'Entrate e uscite', sub: `${label} ${V.year}`,
      actions: [
        h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), h('span', 'Importa')),
        h('button.btn.btn-soft', { type: 'button', onclick: () => categoryManager(ctx, V.kind) }, icon('edit', 18), h('span', 'Categorie')),
        h('button.btn.btn-soft', { type: 'button', onclick: () => txEditor(ctx, null, { kind: V.kind }) }, icon('plus', 18), h('span', V.kind === 'income' ? 'Entrata' : 'Uscita')),
      ],
      node: h('div.stack',
        h('div.year-bar', kinds, yearTabs),
        hasData ? [kpis, cards, chart, tableCard] : h('section.card', empty({ icon: 'list', title: `Nessuna ${one} nel ${V.year}`, text: 'Registra i movimenti con la loro categoria, o importa il tuo foglio Excel con le colonne GEN…DIC: qui li vedi per categoria e mese per mese.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => txEditor(ctx, null, { kind: V.kind }) }, icon('plus', 18), V.kind === 'income' ? 'Nuova entrata' : 'Nuova uscita'), h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), 'Importa da Excel')) })),
        invCosts ? h('p.fine', icon('info', 14), h('span', `L'imposta di bollo e le altre spese degli investimenti (${moneyText(invCosts)} nel ${V.year}) non sono qui, come nel tuo foglio: le trovi in Investimenti › Anno per anno.`)) : null,
        h('p.fine', icon('info', 14), h('span', 'Tocca una scheda per vedere solo quella categoria. Con "Categorie" le crei, rinomini, colori e riordini come vuoi.'))),
    };
  },
};

export { categoryEditor };
