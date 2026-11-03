/* Entrate e uscite dell'anno, come un bilancio: le macro categorie (es. LAVORO, MUSICA,
   INT. BANCA, ALTRO) sono la somma delle loro sottocategorie (STIPENDIO, 13ESIMA, DJ, CC…).
   In alto i numeri dell'anno, poi una scheda per macro categoria, il grafico mese per mese
   e la tabella: riga della macro (somma) e sotto le sue sottocategorie, mesi, totale, media
   e quota. Le note (voci) si vedono a richiesta. Categorie da "Categorie" (crea, rinomina,
   colora, riordina). */

import { h, icon, download } from '../ui/dom.js';
import { toast, empty } from '../ui/components.js';
import { money, moneyText, delta, tipMoney, axisMoney, ui } from '../ui/fmt.js';
import { card, segTabs, filterBox, stat, colorDot, softColor } from './common.js';
import { setGroupColor } from '../actions.js';
import { fitTable, watchFit, fitMoney } from '../ui/fit.js';
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
/** "var(--c3)" → 3, "#aabbcc" resta: il valore che salva il quadratino del colore. */
const cval = c => { const m = /^var\(--c(\d)\)$/.exec(c); return m ? +m[1] : c; };

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
    // la tabella entra tutta nello schermo, come il Net Worth (D: "cerca di far entrare tutto anche nelle entrate/uscite")
    const maxAbs = Math.max(0, T.total, ...T.groups.flatMap(g => [g.total, ...g.byMonth.map(Math.abs)]));
    // la % più lunga delle righe (il totale è sempre "100%", senza decimali)
    const maxPct = T.total ? Math.max(0, ...T.groups.map(g => g.total / T.total * 100)) : 0;
    const fit = fitTable({ maxAbs, maxPct });
    watchFit('#/entrate-uscite', fit, () => fitTable({ maxAbs, maxPct }));
    const fm = fitMoney(fit, moneyText, ui.base, ui.privacy);
    // celle vuote vuote, come in Excel (prima c'era un trattino in ogni mese senza importi)
    const t2 = v => (v ? fm(v) : '');
    const goMonth = (m, extra) => ctx.go(`movimenti?mese=${V.year}-${String(m + 1).padStart(2, '0')}${extra}`);

    /* ── numeri dell'anno ── */
    const prev = d.yearTable(V.year - 1, V.kind).total;
    const passed = full.byMonth.slice(0, Math.max(1, curM));
    const best = passed.reduce((b, v, i) => (v > b.v ? { v, i } : b), { v: 0, i: -1 });
    // l'ultimo mese da mostrare: quello in corso se ha già importi, altrimenti l'ultimo completo
    const lastM = V.year === cy && curM > 1 && !full.byMonth[curM - 1] ? curM - 2 : curM ? curM - 1 : 0;
    const lastIsNow = V.year === cy && lastM === curM - 1;
    /* ── una card sola (D: le schede non gli piacciono): il totale dell'anno, i numeri chiave,
       il mese per mese diviso per macro categoria e accanto le macro con quota, totale e media ── */
    const kpi = (l, v, x) => h('div.dk', h('span.dk-l', l), h('span.dk-v', v), x ? h('span.dk-x', x) : null);
    const inv = V.kind === 'expense';
    const pos = full.groups.reduce((a2, g) => a2 + Math.max(0, g.total), 0) || 1;
    const summary = h('section.card.dash-card.fin-summary',
      h('div.dash-head',
        h('div', h('span.dash-label', `${label} ${V.year}`), h('div.dash-big', money(full.total))),
        prev ? h('div.fin-vs', delta((full.total - prev) / prev * 100, { invert: inv }), h('span', ` sul ${V.year - 1}`), h('small', moneyText(prev))) : null),
      h('div.dash-kpis',
        kpi('Media al mese', money(full.months ? Math.round(full.total / full.months) : 0), `su ${full.months || 0} ${full.months === 1 ? 'mese' : 'mesi'}`),
        kpi(V.kind === 'income' ? 'Mese migliore' : 'Mese più caro', best.i >= 0 ? money(best.v) : '—', best.i >= 0 ? monthName(best.i + 1) : ''),
        kpi(lastIsNow ? `${monthName(curM)} finora` : `${monthName(lastM + 1)}`, money(full.byMonth[lastM] || 0), full.months && full.total ? h('span', delta(((full.byMonth[lastM] || 0) / (full.total / full.months) - 1) * 100, { invert: inv }), ' rispetto alla media') : '')),
      h('div.dash-nw-body',
        h('div.dash-chart', barChart({
          labels: months.map(m => monthName(m + 1, true)), tipLabels: months.map(m => `${monthName(m + 1)} ${V.year}`),
          series: T.groups.map(g => ({ name: g.name, color: softColor(colOf(g)), values: g.byMonth })),
          stacked: true, fmt: tipMoney, fmtAxis: axisMoney, height: 250, mask: ui.privacy, title: `${label} di ogni mese, divise per categoria`,
        })),
        h('div.dash-secs',
          h('div.alloc-bar.dash-alloc', full.groups.filter(g => g.total > 0).map(g => h('span', { style: { width: (g.total / pos * 100) + '%', background: softColor(colOf(g)) }, title: g.name }))),
          h('div.dash-list', full.groups.map(g => {
            const on = V.focus === g.name;
            return h('div.dash-row.fin-sum-row', { class: on ? 'on' : V.focus ? 'dim' : '' },
              colorDot(cval(colOf(g)), v => setGroupColor(V.kind, g.name, v), `Colore di ${g.name}`),
              h('button.dash-n.dash-pick', { type: 'button', 'aria-pressed': String(on), title: on ? 'Mostra tutte' : 'Solo questa nella tabella', onclick: () => { V.focus = on ? '' : g.name; ctx.rerender(); } }, g.name),
              h('span.dash-p', full.total ? formatPercent(g.total / full.total * 100, 1) : ''),
              h('span.dash-v', money(g.total)),
              h('span.dash-g', full.months ? `${moneyText(Math.round(g.total / full.months))} al mese` : ''));
          })),
          h('p.dash-cap', 'Tocca un nome per vedere solo quella categoria nella tabella, il quadratino per cambiarne il colore.'))));

    /* ── tabella: macro (somma) → sottocategorie → note ── */
    const cells = (r, extra, strong) => months.map(m => h('td.num', {
      class: [m >= curM ? 'future' : '', r.byMonth[m] ? (extra != null ? 'click' : '') : 'muted', strong ? 'b' : ''].join(' '),
      onclick: r.byMonth[m] && extra != null ? e => { e.stopPropagation(); goMonth(m, extra); } : null,
    }, t2(r.byMonth[m])));
    const ends = r => [h('td.num.fin-tot', t2(r.total)), h('td.num', T.months && r.total ? fm(avg(r)) : ''), h('td.num.fin-pct', !r.total || !T.total ? '' : r === T ? '100%' : formatPercent(share(r), fit ? Math.min(1, fit.pdec) : 1))];
    const body = [];
    for (const g of T.groups) {
      const col = colOf(g);
      const isSingle = single(g);
      const closed = V.closed.has(g.name);
      const catId = isSingle ? g.cats[0].id : null;
      body.push(h('tr.fin-macro', { style: { '--chip': col }, class: isSingle ? '' : 'click', onclick: isSingle ? null : () => { if (closed) V.closed.delete(g.name); else V.closed.add(g.name); ctx.rerender(); } },
        h('td.sticky', h('span.fin-macro-name', isSingle ? h('span.fin-caret') : h('span.fin-caret', icon(closed ? 'chevR' : 'chevD', 14)), colorDot(cval(col), v => setGroupColor(V.kind, g.name, v), `Colore di ${g.name}`), h('span.fin-macro-t', g.name))),
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
    const table = h('table.table.nw-table.nw-months.fin-table', { 'data-tid': fit ? `fin-${V.kind}-fit` : `fin-${V.kind}`, class: fit ? 'fit' : '' },
      h('thead', h('tr', h('th.sticky', fit && !fit.euro ? 'Categoria (€)' : 'Categoria'), months.map(m => h('th.num', { class: m >= curM ? 'future' : '' }, monthName(m + 1, true).toUpperCase())), h('th.num.fin-tot', 'Totale'), h('th.num', 'Media'), h('th.num', '%'))),
      h('tbody', body),
      h('tfoot', h('tr.fin-grand', h('td.sticky', V.focus || V.q ? `Totale (filtrato)` : `Totale ${label.toLowerCase()}`), cells(T, null, true), ends(T))));
    if (fit) { table.style.setProperty('--nw-first', fit.first + 'px'); table.style.fontSize = fit.font + 'px'; }
    const tableWrap = h('div.table-wrap.nw-scroll', table);
    // su telefono (la tabella scorre) si apre sui mesi più recenti
    if (!fit && curM > 6) requestAnimationFrame(() => requestAnimationFrame(() => {
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
      sub: 'La riga della categoria è la somma delle sue voci, sotto. Tocca un importo per vedere i movimenti.',
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
        hasData ? [summary, tableCard] : h('section.card', empty({ icon: 'list', title: `Nessuna ${one} nel ${V.year}`, text: 'Registra i movimenti con la loro categoria, o importa il tuo foglio Excel con le colonne GEN…DIC: qui li vedi per categoria e mese per mese.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => txEditor(ctx, null, { kind: V.kind }) }, icon('plus', 18), V.kind === 'income' ? 'Nuova entrata' : 'Nuova uscita'), h('button.btn.btn-soft', { type: 'button', onclick: () => openFileImport(ctx) }, icon('upload', 18), 'Importa da Excel')) })),
        invCosts ? h('p.fine', icon('info', 14), h('span', `L'imposta di bollo e le altre spese degli investimenti (${moneyText(invCosts)} nel ${V.year}) non sono qui, come nel tuo foglio: le trovi in Investimenti › Anno per anno.`)) : null,
        h('p.fine', icon('info', 14), h('span', 'Con "Categorie" le crei, rinomini, colori e riordini come vuoi; il colore lo cambi anche toccando il quadratino.'))),
    };
  },
};

export { categoryEditor };
