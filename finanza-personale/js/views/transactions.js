/* Movimenti: ricerca, filtri, raggruppati per giorno, selezione multipla, import ed export. */

import { h, icon, debounce, download } from '../ui/dom.js';
import { selectInput, toast, empty, openSheet, confirmDialog, textInput } from '../ui/components.js';
import { money, moneyText } from '../ui/fmt.js';
import { txGroups } from './common.js';
import { txEditor, accountOptions, pickCategory, undoToast } from './editors.js';
import { openImporter } from './importer.js';
import * as A from '../actions.js';
import { today, monthKey, monthStart, monthEnd, addMonthKey, formatMonth } from '../core/dates.js';
import { parseAmount } from '../core/money.js';
import { toCSV, csvNumber } from '../core/csv.js';

const F = { period: 'month', month: null, year: null, from: '', to: '', account: '', category: '', kind: '', q: '', flagged: false, limit: 150, lastRoute: '' };
const sel = new Set();
let selecting = false;

function applyQuery(ctx) {
  const key = location.hash;
  if (F.lastRoute === key) return;
  F.lastRoute = key;
  const q = ctx.route.query;
  if (!Object.keys(q).length) return;
  // arrivando da un collegamento si parte da filtri puliti
  Object.assign(F, { account: '', category: '', kind: '', q: '', flagged: false, period: 'month', month: null });
  if (q.cat) { F.category = q.cat; F.kind = ''; }
  if (q.conto) F.account = q.conto;
  if (q.mese) { F.period = 'month'; F.month = q.mese; }
  if (q.anno) { F.period = 'year'; F.year = q.anno; }
  if (q.tutto) F.period = 'all';
  if (q.q) F.q = q.q;
  F.limit = 150;
}

function range() {
  const m = F.month || monthKey(today());
  if (F.period === 'month') return [monthStart(m), monthEnd(m)];
  if (F.period === 'year') { const y = F.year || today().slice(0, 4); return [`${y}-01-01`, `${y}-12-31`]; }
  if (F.period === 'range') return [F.from || '1900-01-01', F.to || '2200-12-31'];
  return ['1900-01-01', '2200-12-31'];
}

function filtered(ctx) {
  const { st, d } = ctx;
  const [from, to] = range();
  const q = F.q.trim().toLowerCase();
  const qAmt = q ? parseAmount(q) : null;
  return st.transactions.filter(t => {
    if (t.date < from || t.date > to) return false;
    if (F.account && t.account !== F.account && t.toAccount !== F.account) return false;
    if (F.category === '_none') { if (t.category || t.kind === 'transfer') return false; }
    else if (F.category && t.category !== F.category) return false;
    if (F.kind && t.kind !== F.kind) return false;
    if (F.flagged && !t.flagged) return false;
    if (q) {
      const cat = t.category ? d.catById.get(t.category)?.name.toLowerCase() : '';
      const hay = `${t.payee} ${t.note} ${t.tags.map(x => '#' + x).join(' ')} ${cat}`.toLowerCase();
      if (!hay.includes(q) && !(qAmt && Math.abs(qAmt) === t.amount)) return false;
    }
    return true;
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created - a.created));
}

function periodControl(ctx, redraw) {
  const m = F.month || monthKey(today());
  const y = F.year || today().slice(0, 4);
  const label = F.period === 'month' ? formatMonth(m) : F.period === 'year' ? y : F.period === 'all' ? 'Sempre' : 'Intervallo';
  const step = n => {
    if (F.period === 'month') F.month = addMonthKey(m, n);
    else if (F.period === 'year') F.year = String(Number(y) + n);
    F.limit = 150; redraw();
  };
  const canStep = F.period === 'month' || F.period === 'year';
  const kindSel = selectInput([{ value: 'month', label: 'Mese' }, { value: 'year', label: 'Anno' }, { value: 'all', label: 'Tutto' }, { value: 'range', label: 'Dal… al…' }], F.period, v => { F.period = v; F.limit = 150; ctx.rerender(); });
  const rangeBox = F.period === 'range' ? h('div.range-box',
    h('input.input.input-sm', { type: 'date', value: F.from, onchange: e => { F.from = e.target.value; redraw(); }, 'aria-label': 'Dal' }),
    h('span.muted', '→'),
    h('input.input.input-sm', { type: 'date', value: F.to, onchange: e => { F.to = e.target.value; redraw(); }, 'aria-label': 'Al' })) : null;
  return h('div.period',
    h('div.period-kind', kindSel),
    canStep ? h('div.period-step',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Precedente', onclick: () => step(-1) }, icon('chevL', 18)),
      h('span.period-label', label),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Successivo', onclick: () => step(1) }, icon('chevR', 18))) : null,
    rangeBox);
}

function exportCsv(ctx, list) {
  const { d } = ctx;
  const rows = [['Data', 'Tipo', 'Importo', 'Valuta', 'Conto', 'Verso conto', 'Categoria', 'Gruppo', 'Descrizione', 'Nota', 'Etichette']];
  for (const t of [...list].reverse()) {
    const acc = d.accById.get(t.account), to = t.toAccount ? d.accById.get(t.toAccount) : null, c = t.category ? d.catById.get(t.category) : null;
    const sign = t.kind === 'expense' ? -1 : 1;
    rows.push([t.date, { expense: 'Uscita', income: 'Entrata', transfer: 'Giroconto' }[t.kind], csvNumber(sign * t.amount), acc?.currency || '', acc?.name || '', to?.name || '', c?.name || '', c?.group || '', t.payee, t.note, t.tags.join(', ')]);
  }
  download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `movimenti-${today()}.csv`);
  toast(`${list.length} movimenti esportati`, { kind: 'ok' });
}

function bulkBar(ctx, list) {
  if (!selecting) return null;
  const ids = [...sel];
  const n = ids.length;
  return h('div.bulk-bar',
    h('span.bulk-n', n ? `${n} selezionati` : 'Tocca i movimenti da selezionare'),
    h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { list.slice(0, F.limit).forEach(t => sel.add(t.id)); ctx.rerender(); } }, 'Tutti'),
    n ? h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: () => {
      const kinds = new Set(ctx.st.transactions.filter(t => sel.has(t.id)).map(t => t.kind));
      if (kinds.has('transfer') || kinds.size > 1) { toast('Seleziona solo uscite o solo entrate per cambiare categoria'); return; }
      pickCategory([...kinds][0], null, id => { A.bulkUpdateTx(ids, { category: id }); undoToast(`Categoria cambiata a ${n} movimenti`); });
    } }, icon('tag', 16), 'Categoria') : null,
    n ? h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: async () => {
      const tag = await new Promise(res => {
        const inp = textInput({ placeholder: 'es. vacanze', autofocus: true });
        const s = openSheet({ title: 'Aggiungi etichetta', size: 'sm', body: inp, footer: [h('button.btn.btn-primary', { type: 'button', onclick: () => { res(inp.value.trim().toLowerCase()); s.close(true); } }, 'Aggiungi')], onClose: () => res('') });
      });
      if (tag) { A.bulkUpdateTx(ids, { addTag: tag.replace(/^#/, '') }); undoToast('Etichetta aggiunta'); }
    } }, '#', 'Etichetta') : null,
    n ? h('button.btn.btn-sm.btn-danger-soft', { type: 'button', onclick: async () => {
      if (!(await confirmDialog({ title: `Eliminare ${n} movimenti?`, message: 'Potrai annullare subito dopo.', confirm: 'Elimina', danger: true }))) return;
      A.deleteTx(ids); sel.clear(); undoToast(`${n} movimenti eliminati`);
    } }, icon('trash', 16), 'Elimina') : null,
    h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { selecting = false; sel.clear(); ctx.rerender(); } }, 'Fine'));
}

export default {
  render(ctx) {
    const { st, d } = ctx;
    applyQuery(ctx);
    const listWrap = h('div.tx-list');
    const sumWrap = h('div.tx-summary');
    const draw = () => {
      const list = filtered(ctx);
      const inc = list.filter(t => t.kind === 'income').reduce((a, t) => a + d.txBase(t), 0);
      const exp = list.filter(t => t.kind === 'expense').reduce((a, t) => a + d.txBase(t), 0);
      sumWrap.replaceChildren(
        h('div.sum-item', h('span.sum-l', 'Movimenti'), h('b', String(list.length))),
        h('div.sum-item', h('span.sum-l', 'Entrate'), money(inc, d.base, { tone: 'pos' })),
        h('div.sum-item', h('span.sum-l', 'Uscite'), money(exp)),
        h('div.sum-item', h('span.sum-l', 'Saldo'), money(inc - exp, d.base, { sign: true, tone: inc - exp >= 0 ? 'pos' : 'neg' })));
      const c2 = { ...ctx, selecting };
      const shown = list.slice(0, F.limit);
      listWrap.replaceChildren(
        bulkBar(ctx, list) || '',
        ...(list.length ? txGroups(c2, shown, { selectable: true, isSelected: id => sel.has(id), onSelect: id => { if (sel.has(id)) sel.delete(id); else sel.add(id); draw(); } }) : [empty({
          icon: 'list',
          title: st.transactions.length ? 'Nessun movimento con questi filtri' : 'Ancora nessun movimento',
          text: st.transactions.length ? 'Prova a cambiare periodo o a togliere qualche filtro.' : 'Aggiungi il primo movimento o importa l\'estratto conto della banca.',
          action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => txEditor(ctx) }, icon('plus', 18), 'Nuovo movimento'), h('button.btn.btn-soft', { type: 'button', onclick: () => openImporter(ctx) }, icon('upload', 18), 'Importa CSV')),
        })]),
        list.length > F.limit ? h('button.btn.btn-soft.btn-block', { type: 'button', onclick: () => { F.limit += 300; draw(); } }, `Mostra altri (${list.length - F.limit})`) : '');
      // nella selezione la riga seleziona invece di aprire
      if (selecting) listWrap.querySelectorAll('.tx-row').forEach(r => r.classList.add('selecting'));
    };
    const search = h('input.input.search-input', { type: 'search', placeholder: 'Cerca nome, nota, #etichetta o importo', value: F.q, 'aria-label': 'Cerca nei movimenti' });
    search.addEventListener('input', debounce(() => { F.q = search.value; F.limit = 150; draw(); }, 160));
    const catOpts = [{ value: '', label: 'Tutte le categorie' }, { value: '_none', label: '∅ Senza categoria' },
      ...st.categories.filter(c => !c.archived).sort((a, b) => (a.kind === b.kind ? a.group.localeCompare(b.group) || a.name.localeCompare(b.name) : a.kind === 'expense' ? -1 : 1))
        .map(c => ({ value: c.id, label: `${c.emoji} ${c.name}`, group: (c.kind === 'income' ? 'Entrate · ' : 'Uscite · ') + c.group }))];
    const accSel = selectInput([{ value: '', label: 'Tutti i conti' }, ...accountOptions({ includeArchived: true })], F.account, v => { F.account = v; F.limit = 150; draw(); });
    const catSel = selectInput(catOpts, F.category, v => { F.category = v; F.limit = 150; draw(); });
    const kindSel = selectInput([{ value: '', label: 'Tutti i tipi' }, { value: 'expense', label: 'Uscite' }, { value: 'income', label: 'Entrate' }, { value: 'transfer', label: 'Giroconti' }], F.kind, v => { F.kind = v; F.limit = 150; draw(); });
    const anyFilter = F.account || F.category || F.kind || F.q || F.flagged;
    const node = h('div.stack',
      h('section.card.filters-card',
        h('div.filters-top', h('div.search-wrap', icon('search', 18), search), periodControl(ctx, draw)),
        h('div.filters', accSel, catSel, kindSel,
          h('label.chip-check', h('input', { type: 'checkbox', checked: F.flagged, onchange: e => { F.flagged = e.target.checked; draw(); } }), icon('flag', 14), 'Da verificare'),
          anyFilter ? h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { Object.assign(F, { account: '', category: '', kind: '', q: '', flagged: false }); ctx.rerender(); } }, icon('x', 14), 'Togli filtri') : null),
        sumWrap),
      listWrap);
    draw();
    return {
      title: 'Movimenti',
      sub: F.period === 'month' ? formatMonth(F.month || monthKey(today())) : '',
      node,
      actions: [
        h('button.icon-btn', { type: 'button', title: 'Seleziona più movimenti', 'aria-label': 'Seleziona', onclick: () => { selecting = !selecting; sel.clear(); ctx.rerender(); } }, icon('check', 20)),
        h('button.icon-btn', { type: 'button', title: 'Importa estratto conto (CSV)', 'aria-label': 'Importa CSV', onclick: () => openImporter(ctx) }, icon('upload', 20)),
        h('button.icon-btn', { type: 'button', title: 'Esporta questi movimenti (CSV per Excel)', 'aria-label': 'Esporta CSV', onclick: () => exportCsv(ctx, filtered(ctx)) }, icon('download', 20)),
      ],
    };
  },
};
