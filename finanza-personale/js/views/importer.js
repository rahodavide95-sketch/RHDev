/* Import dell'estratto conto (CSV): si sceglie il file, si controllano le colonne,
   si vede l'anteprima con le categorie suggerite e i doppioni già esclusi. */

import { h, icon, pickFile, readText } from '../ui/dom.js';
import { openSheet, field, selectInput, toggle, toast } from '../ui/components.js';
import { undo, undoToken } from '../session.js';
import { moneyText } from '../ui/fmt.js';
import { accountOptions, accountEditor } from './editors.js';
import { parseCSV, guessMapping, hasHeader, rowsToTransactions } from '../core/csv.js';
import { importHash, suggestCategory } from '../core/model.js';
import { formatDate } from '../core/dates.js';
import { importTransactions } from '../actions.js';

export async function openImporter(ctx) {
  const { st } = ctx;
  if (!st.accounts.some(a => !a.archived)) { toast('Prima crea il conto in cui importare i movimenti.'); accountEditor(ctx); return; }
  const f = await pickFile('.csv,.txt,text/csv');
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { toast('File troppo grande (massimo 20 MB)', { kind: 'err' }); return; }
  let text;
  try { text = await readText(f); } catch { toast('Non riesco a leggere il file', { kind: 'err' }); return; }
  const parsed = parseCSV(text);
  if (parsed.rows.length < 1) { toast('Il file è vuoto o non è un CSV', { kind: 'err' }); return; }
  // alcune banche mettono righe di intestazione prima della tabella: si parte dalla prima riga "larga"
  const widths = parsed.rows.map(r => r.length);
  const mainW = Math.max(...widths.slice(0, 40));
  let startRow = parsed.rows.findIndex(r => r.length === mainW);
  if (startRow < 0) startRow = 0;
  const rows = parsed.rows.slice(startRow);
  const header = hasHeader(rows);
  const head = header ? rows[0] : rows[0].map((_, i) => `Colonna ${i + 1}`);
  const data = header ? rows.slice(1) : rows;
  const m = guessMapping(head, data.slice(0, 20));
  const v = { account: ctx.route.query.conto || st.accounts.find(a => !a.archived).id, invert: false, include: new Map() };

  const colOpts = (none = true) => [...(none ? [{ value: '-1', label: '—' }] : []), ...head.map((hd, i) => ({ value: String(i), label: hd || `Colonna ${i + 1}` }))];
  const mode = m.amount >= 0 || m.income < 0 ? 'single' : 'split';
  const st2 = { mode };
  const preview = h('div.import-preview');
  const info = h('p.field-hint');
  const btn = h('button.btn.btn-primary', { type: 'button' }, 'Importa');

  const sDate = selectInput(colOpts(false), String(Math.max(0, m.date)), x => { m.date = +x; draw(); });
  const sDesc = selectInput(colOpts(), String(m.description), x => { m.description = +x; draw(); });
  const sAmt = selectInput(colOpts(), String(m.amount), x => { m.amount = +x; draw(); });
  const sIn = selectInput(colOpts(), String(m.income), x => { m.income = +x; draw(); });
  const sOut = selectInput(colOpts(), String(m.expense), x => { m.expense = +x; draw(); });
  const sOrder = selectInput([{ value: 'dmy', label: 'giorno/mese/anno' }, { value: 'mdy', label: 'mese/giorno/anno' }], m.dateOrder, x => { m.dateOrder = x; draw(); });
  const sAcc = selectInput(accountOptions(), v.account, x => { v.account = x; draw(); });
  const modeSel = selectInput([{ value: 'single', label: 'Una colonna con il segno (−/+)' }, { value: 'split', label: 'Due colonne: entrate e uscite' }], mode, x => { st2.mode = x; syncMode(); draw(); });
  const inv = toggle('Inverti i segni', false, x => { v.invert = x; draw(); }, { hint: 'Per le carte di credito che mostrano le spese come positive' });
  const amtF = field('Importo', sAmt), inF = field('Entrate', sIn), outF = field('Uscite', sOut);
  const syncMode = () => { amtF.hidden = st2.mode !== 'single'; inF.hidden = outF.hidden = st2.mode !== 'split'; };
  syncMode();

  let prepared = [];
  function draw(reset = true) {
    if (reset) v.include.clear();
    const map = { ...m, amount: st2.mode === 'single' ? m.amount : -1, income: st2.mode === 'split' ? m.income : -1, expense: st2.mode === 'split' ? m.expense : -1 };
    const { items, errors } = rowsToTransactions(data, map, { invert: v.invert });
    const existing = new Set(st.transactions.filter(t => t.account === v.account).map(t => t.importHash || importHash(t)));
    const seen = new Set();
    prepared = items.map(it => {
      const kind = it.amount < 0 ? 'expense' : 'income';
      const t = { account: v.account, date: it.date, kind, amount: Math.abs(it.amount), payee: it.description };
      const hash = importHash(t);
      const dup = existing.has(hash) || seen.has(hash);
      seen.add(hash);
      const sug = suggestCategory(st, it.description, kind);
      return { ...t, importHash: hash, dup, category: sug?.category || null, payee: sug?.payee || it.description, key: it.row };
    });
    for (const p of prepared) if (!v.include.has(p.key)) v.include.set(p.key, !p.dup);
    const n = prepared.filter(p => v.include.get(p.key)).length;
    const dups = prepared.filter(p => p.dup).length;
    info.textContent = `${prepared.length} righe lette` + (dups ? ` · ${dups} già presenti (escluse)` : '') + (errors.length ? ` · ${errors.length} righe saltate (senza data o importo)` : '');
    btn.textContent = n ? `Importa ${n} movimenti` : 'Niente da importare';
    btn.disabled = !n;
    preview.replaceChildren(h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', ''), h('th', 'Data'), h('th', 'Descrizione'), h('th', 'Categoria'), h('th.num', 'Importo'))),
      h('tbody', prepared.slice(0, 200).map(p => {
        const cb = h('input', { type: 'checkbox', checked: v.include.get(p.key), 'aria-label': 'Importa questa riga' });
        cb.addEventListener('change', () => { v.include.set(p.key, cb.checked); draw(false); });
        const c = p.category ? ctx.d.catById.get(p.category) : null;
        return h('tr', { class: p.dup ? 'dup' : '' }, h('td', cb), h('td.nowrap', formatDate(p.date, { year: true })), h('td.desc', p.payee, p.dup ? h('span.pill.pill-warn', 'già presente') : null), h('td', c ? `${c.emoji} ${c.name}` : h('span.muted', '—')), h('td.num', { class: p.kind === 'income' ? 'pos' : '' }, (p.kind === 'income' ? '+' : '−') + moneyText(p.amount)));
      })))), prepared.length > 200 ? h('p.field-hint', `…e altre ${prepared.length - 200} righe`) : null);
  }
  btn.addEventListener('click', () => {
    const list = prepared.filter(p => v.include.get(p.key)).map(p => ({ date: p.date, kind: p.kind, amount: p.amount, account: p.account, category: p.category, payee: p.payee, importHash: p.importHash }));
    if (!list.length) return;
    importTransactions(list);
    const tk = undoToken();
    toast(`${list.length} movimenti importati`, { kind: 'ok', action: { label: 'Annulla', fn: () => { if (undo(tk)) toast('Import annullato'); else toast('Non si può più annullare: nel frattempo hai fatto altre modifiche'); } } });
    s.close(true);
    ctx.go('movimenti?tutto=1');
  });
  draw();
  const s = openSheet({
    title: 'Importa estratto conto', subtitle: f.name, size: 'lg',
    body: h('div.stack',
      h('p.muted', 'Il file resta sul tuo dispositivo: viene letto qui, non viene inviato da nessuna parte.'),
      h('div.grid-2', field('Nel conto', sAcc), field('Come sono gli importi', modeSel)),
      h('div.grid-3', field('Data', sDate), field('Descrizione', sDesc), amtF, inF, outF),
      h('div.grid-2', field('Formato della data', sOrder), inv),
      info, preview),
    footer: [btn],
  });
}
