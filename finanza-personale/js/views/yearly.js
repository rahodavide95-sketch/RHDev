/* Entrate e uscite dell'anno, come un bilancio: le macro categorie (es. LAVORO, MUSICA,
   INT. BANCA, ALTRO) sono la somma delle loro sottocategorie (STIPENDIO, 13ESIMA, DJ, CC…).
   In alto i numeri dell'anno, poi una scheda per macro categoria, il grafico mese per mese
   e la tabella: riga della macro (somma) e sotto le sue sottocategorie, mesi, totale, media
   e quota. Le note (voci) si vedono a richiesta. Categorie da "Categorie" (crea, rinomina,
   colora, riordina). */

import { h, icon, download } from '../ui/dom.js';
import { toast, empty } from '../ui/components.js';
import { money, moneyText, delta, tipMoney, axisMoney, ui } from '../ui/fmt.js';
import { card, segTabs, filterBox, colorDot, softColor, editInCell, resumeEdit, renameBtn } from './common.js';
import { setGroupColor, setFlowCell, placeCategory, renameGroup, renameCategory } from '../actions.js';
import { fitTable, watchFit, fitMoney } from '../ui/fit.js';
import { categoryEditor, txEditor, undoToast } from './editors.js';
import { categoryManager, groupColor } from './categories.js';
import { openFileImport } from './invimport.js';
import { barChart } from '../ui/charts.js';
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
let dragEnded = 0;
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
    // arrivo da una categoria della Panoramica: solo quella, nell'anno giusto (poi l'indirizzo torna pulito)
    if (q.cat) {
      if (years.includes(+q.anno)) V.year = +q.anno;
      V.focus = q.cat;
      history.replaceState(null, '', '#/entrate-uscite?tipo=' + (V.kind === 'income' ? 'entrate' : 'uscite'));
    }
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
    // i movimenti di ogni cella (sottocategoria o nota, mese), per scrivere l'importo direttamente
    // (D: "se clicco in una cella devo poter modificare da solo l'importo… ce ne sono diversi sbagliati")
    const byCell = new Map();
    const push = (k, t) => { const a = byCell.get(k); if (a) a.push(t); else byCell.set(k, [t]); };
    for (const t of st.transactions) {
      if (t.kind === 'transfer' || !t.date.startsWith(String(V.year)) || (t.kind === 'expense' && t.tags?.includes('investimenti'))) continue;
      const c = t.category ? d.catById.get(t.category) : null;
      if (c ? c.kind !== V.kind : t.kind !== V.kind) continue;
      const m = +t.date.slice(5, 7) - 1, ck = t.category || '';
      push(`${ck}|${m}`, t); push(`${ck}|${m}|${((t.payee || '').trim() || 'Senza descrizione').toLowerCase()}`, t);
    }
    // il conto per un movimento nuovo: quello usato di solito per quella sottocategoria; se no il conto apposta
    // "Entrate e uscite dal file" (fuori dal patrimonio: scrivere un'entrata non cambia il Net Worth)
    const accFor = catId => {
      const last = st.transactions.filter(t => t.category && t.category === catId && t.kind === V.kind).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return last?.account || null;
    };
    const monthDate = m => { const ym = `${V.year}-${String(m + 1).padStart(2, '0')}`; const end = new Date(V.year, m + 1, 0).getDate(); const dt = `${ym}-${String(end).padStart(2, '0')}`; return dt > today() ? today() : dt; };
    // una cella si scrive se dietro c'è al massimo un movimento, nella valuta principale e del verso giusto;
    // con più movimenti si apre Movimenti di quel mese, per correggerli uno per uno
    const editable = (cat, m, payee) => {
      if (m >= curM && !(V.year === cy && m === curM - 1)) return null;
      const list = byCell.get(payee == null ? `${cat?.id || ''}|${m}` : `${cat?.id || ''}|${m}|${payee.toLowerCase()}`) || [];
      if (list.length > 1) return null;
      const t = list[0];
      if (t && (t.kind !== V.kind || (d.accById.get(t.account)?.currency || ui.base) !== ui.base)) return null;
      return { t, cat, payee };
    };
    const cells = (r, extra, strong, ed) => months.map(m => {
      const e = ed ? editable(ed.cat, m, ed.payee) : null;
      const attrs = { class: [m >= curM ? 'future' : '', r.byMonth[m] ? (extra != null && !e ? 'click' : '') : 'muted', strong ? 'b' : '', e ? 'cell-edit' : ''].join(' ') };
      if (e) {
        Object.assign(attrs, { tabindex: '0', dataset: { k: ed.key, i: String(m) }, title: 'Tocca per scrivere l\'importo' });
        const open = ev => { ev.stopPropagation(); editFlow(ev.currentTarget, e, m, r.byMonth[m] || 0, ed.label); };
        attrs.onclick = open;
        attrs.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); open(ev); } };
      } else if (r.byMonth[m] && extra != null) attrs.onclick = ev => { ev.stopPropagation(); goMonth(m, extra); };
      return h('td.num', attrs, t2(r.byMonth[m]));
    });
    const editFlow = (td, e, m, cur, what) => editInCell(td, {
      cur, label: `${what}, ${monthName(m + 1)} ${V.year}`,
      save: c => {
        if (c != null && c < 0) { toast('Scrivi l\'importo senza il meno', { kind: 'err' }); return false; }
        if ((c || 0) === cur) return false;
        const account = e.t ? e.t.account : accFor(e.cat?.id || null);
        setFlowCell({ txId: e.t?.id || null, kind: V.kind, category: e.cat?.id || null, payee: e.payee ?? e.cat?.name ?? '', date: monthDate(m), account }, c || 0);
        undoToast(`${what}, ${monthName(m + 1)}: ${c ? moneyText(c) : 'tolto'}`);
        return true;
      },
    });
    // trascinare una sottocategoria: sopra o sotto un'altra, o sulla riga di una categoria (va in fondo a quella)
    const startDrag = (ev, c) => {
      if (ev.button !== 0 || !c.id) return;
      if (ev.pointerType === 'touch' && !ev.target.closest('.nw-grip')) return;
      const src = ev.currentTarget.closest('tr');
      const x0 = ev.clientX, y0 = ev.clientY;
      let on = false, mark = null, where = null;
      const clear = () => { mark?.classList.remove('drop-before', 'drop-after'); mark = null; };
      const move = e2 => {
        if (!on) { if (Math.hypot(e2.clientX - x0, e2.clientY - y0) < 6) return; on = true; src.classList.add('nw-dragging'); document.body.classList.add('nw-drag-on'); }
        e2.preventDefault();
        if (e2.clientY < 70) scrollBy(0, -14); else if (e2.clientY > innerHeight - 50) scrollBy(0, 14);
        const tr = document.elementFromPoint(e2.clientX, e2.clientY)?.closest('table.fin-table tbody tr');
        clear(); where = null;
        if (!tr || tr === src || !tr.dataset.group) return;
        const rc = tr.getBoundingClientRect();
        if (tr.classList.contains('fin-sub') && tr.dataset.cat) {
          const up = e2.clientY < rc.top + rc.height / 2;
          where = { group: tr.dataset.group, ...(up ? { before: tr.dataset.cat } : { after: tr.dataset.cat }) };
          mark = tr; tr.classList.add(up ? 'drop-before' : 'drop-after');
        } else if (tr.classList.contains('fin-macro')) { where = { group: tr.dataset.group }; mark = tr; tr.classList.add('drop-after'); }
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!on) return;
        dragEnded = Date.now();
        src.classList.remove('nw-dragging'); document.body.classList.remove('nw-drag-on'); clear();
        if (!where) return;
        placeCategory(c.id, where.group, where);
        undoToast(src.dataset.group === where.group ? 'Sottocategoria spostata' : `${c.name} spostata in ${where.group}`);
      };
      addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    };
    const ends = r => [h('td.num.fin-tot', t2(r.total)), h('td.num', T.months && r.total ? fm(avg(r)) : ''), h('td.num.fin-pct', !r.total || !T.total ? '' : r === T ? '100%' : formatPercent(share(r), fit ? Math.min(1, fit.pdec) : 1))];
    const body = [];
    for (const g of T.groups) {
      const col = colOf(g);
      const isSingle = single(g);
      const closed = V.closed.has(g.name);
      const catId = isSingle ? g.cats[0].id : null;
      const singleCat = isSingle ? d.catById.get(g.cats[0].id) || null : null;
      body.push(h('tr.fin-macro', { style: { '--chip': col }, class: isSingle ? '' : 'click', dataset: { group: g.name }, onclick: isSingle ? null : () => { if (Date.now() - dragEnded < 300) return; if (closed) V.closed.delete(g.name); else V.closed.add(g.name); ctx.rerender(); } },
        h('td.sticky', h('span.fin-macro-name', isSingle ? h('span.fin-caret') : h('span.fin-caret', icon(closed ? 'chevR' : 'chevD', 14)), colorDot(cval(col), v => setGroupColor(V.kind, g.name, v), `Colore di ${g.name}`), h('span.fin-macro-t', g.name)),
          renameBtn('Nome della categoria', g.name, v => { renameGroup(V.kind, g.name, v, { single: isSingle ? catId : null }); if (V.focus === g.name) V.focus = v; if (V.closed.delete(g.name)) V.closed.add(v); undoToast(`Categoria rinominata: ${v}`); }, { max: 40 })),
        cells(g, catId ? `&cat=${catId}` : null, true, isSingle && (singleCat || !g.cats[0].id) ? { cat: singleCat, payee: null, key: 'c:' + (g.cats[0].id || '-'), label: g.name } : null), ends(g)));
      const showNotes = c => V.notes || V.openNotes.has(c.id || c.name);
      if (isSingle) {
        const c = g.cats[0];
        if (showNotes(c)) for (const p of notesOf(c)) body.push(h('tr.fin-note', h('td.sticky', h('span', p.name)), cells(p, `${c.id ? `&cat=${c.id}` : ''}&q=${encodeURIComponent(p.name)}`, false, { cat: singleCat, payee: p.name, key: `n:${c.id || '-'}:${p.name}`, label: p.name }), ends(p)));
        continue;
      }
      if (closed) continue;
      for (const c of g.cats) {
        const ns = notesOf(c);
        const key = c.id || c.name;
        const cat = c.id ? d.catById.get(c.id) || null : null;
        body.push(h('tr.fin-sub', { style: { '--chip': col }, dataset: { group: g.name, cat: c.id || '' } },
          h('td.sticky', { class: c.id ? 'fin-drag-h' : '', title: c.id ? 'Trascina per spostarla in un\'altra categoria' : null, onpointerdown: c.id ? e => startDrag(e, c) : null },
            c.id ? icon('grip', 14, 'nw-grip') : null, h('span.fin-sub-name', c.name),
            c.id ? renameBtn('Nome della sottocategoria', c.name, v => { renameCategory(c.id, v); undoToast(`Sottocategoria rinominata: ${v}`); }, { max: 50 }) : null,
            ns.length && !V.notes ? h('button.fin-notes-btn', { type: 'button', 'aria-label': 'Mostra le note', onclick: e => { e.stopPropagation(); if (V.openNotes.has(key)) V.openNotes.delete(key); else V.openNotes.add(key); ctx.rerender(); } }, `${ns.length} ${ns.length === 1 ? 'nota' : 'note'}`, icon(V.openNotes.has(key) ? 'chevD' : 'chevR', 12)) : null),
          cells(c, c.id ? `&cat=${c.id}` : '', false, { cat, payee: null, key: 'c:' + (c.id || '-'), label: c.name }), ends(c)));
        if (showNotes(c)) for (const p of ns) body.push(h('tr.fin-note', h('td.sticky', h('span', p.name)), cells(p, `${c.id ? `&cat=${c.id}` : ''}&q=${encodeURIComponent(p.name)}`, false, { cat, payee: p.name, key: `n:${c.id || '-'}:${p.name}`, label: p.name }), ends(p)));
      }
    }
    const table = h('table.table.nw-table.nw-months.fin-table', { 'data-tid': fit ? `fin-${V.kind}-fit` : `fin-${V.kind}`, class: fit ? 'fit' : '' },
      h('thead', h('tr', h('th.sticky', { dataset: { col: 'name' } }, fit && !fit.euro ? 'Categoria (€)' : 'Categoria'), months.map(m => h('th.num', { dataset: { col: 'm' + m }, class: m >= curM ? 'future' : '' }, monthName(m + 1, true).toUpperCase())), h('th.num.fin-tot', { dataset: { col: 'tot' } }, 'Totale'), h('th.num', { dataset: { col: 'avg' } }, 'Media'), h('th.num', { dataset: { col: 'pct' } }, '%'))),
      h('tbody', body),
      h('tfoot', h('tr.fin-grand', h('td.sticky', V.focus || V.q ? `Totale (filtrato)` : `Totale ${label.toLowerCase()}`), cells(T, null, true), ends(T))));
    if (fit) { table.style.setProperty('--nw-first', fit.first + 'px'); table.style.fontSize = fit.font + 'px'; }
    resumeEdit(table);
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
