/* Importa investimenti da un file Excel (.xlsx) o CSV con una riga per operazione
   (come i fogli "wallet" dei PAC): colonne riconosciute da sole e modificabili, anteprima,
   righe non capite elencate, controllo al centesimo con la colonna "Totale" del file,
   doppioni esclusi, un solo "Annulla". Il file si legge solo sul dispositivo. */

import { h, icon, pickFile, readText } from '../ui/dom.js';
import { openSheet, field, selectInput, toggle, toast } from '../ui/components.js';
import { undo, undoToken, S } from '../session.js';
import { moneyText } from '../ui/fmt.js';
import { parseCSV } from '../core/csv.js';
import { readXlsx, isZip } from '../core/xlsx.js';
import { FIELDS, findHeader, readOperations, checkTotals, planImport, opNet } from '../core/invimport.js';
import { ASSET_CLASSES, hasHoldings } from '../core/model.js';
import { importInvestments } from '../actions.js';

const KIND = { buy: ['acquisto', 'acquisti'], sell: ['vendita', 'vendite'], div: ['cedola', 'cedole'], fee: ['costo', 'costi'] };
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const cents = x => Math.round(x * 100);

async function loadFile(f) {
  const buf = await f.arrayBuffer();
  if (isZip(buf)) {
    if (/\.ods$/i.test(f.name)) throw new Error('I file .ods non si leggono: salvalo come .xlsx o .csv.');
    return readXlsx(buf);
  }
  if (/\.xls$/i.test(f.name)) throw new Error('Il vecchio formato .xls non si legge: da Excel fai "Salva con nome" → .xlsx.');
  const text = await readText(f);
  const { rows } = parseCSV(text);
  return { sheets: [{ name: f.name, rows, nums: rows.map((_, i) => i + 1) }], date1904: false };
}

export async function openInvestImport(ctx) {
  const f = await pickFile('.xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { toast('File troppo grande (massimo 20 MB)', { kind: 'err' }); return; }
  let book;
  try { book = await loadFile(f); } catch (e) { toast(e?.message || 'Non riesco a leggere il file', { kind: 'err' }); return; }

  // il foglio giusto è quello con l'intestazione più completa
  const found = book.sheets.map(sh => findHeader(sh.rows));
  let si = found.reduce((best, x, i) => (x && (!found[best] || x.score > found[best].score) ? i : best), 0);
  const v = { si, header: found[si] ? { ...found[si], map: { ...found[si].map } } : null, account: null, cash: false };
  const invAccs = () => S.state.accounts.filter(a => hasHoldings(a) && !a.archived);
  if (invAccs().length) v.account = invAccs()[0].id;

  const body = h('div.stack');
  const btn = h('button.btn.btn-primary', { type: 'button' }, 'Importa');
  let plan = null;

  function draw() {
    const sh = book.sheets[v.si];
    const parts = [h('p.muted', 'Il file resta sul tuo dispositivo: viene letto qui, non viene inviato da nessuna parte.')];
    if (book.sheets.length > 1) {
      parts.push(field('Foglio', selectInput(book.sheets.map((x, i) => ({ value: String(i), label: x.name + (found[i] ? '' : ' (non riconosciuto)') })), String(v.si), x => {
        v.si = +x; v.header = found[v.si] ? { ...found[v.si], map: { ...found[v.si].map } } : null; draw();
      })));
    }
    if (!v.header) {
      plan = null;
      btn.disabled = true; btn.textContent = 'Niente da importare';
      parts.push(h('div.banner.banner-warn', icon('alert', 18), h('span', 'In questo foglio non trovo le colonne di un elenco di operazioni. Servono almeno la data e le quote (o l\'importo), con una riga d\'intestazione sopra.')));
      body.replaceChildren(...parts);
      return;
    }
    const head = sh.rows[v.header.index] || [];
    const cols = [{ value: '-1', label: '—' }, ...head.map((x, i) => ({ value: String(i), label: `${colName(i)} · ${x == null || x === '' ? 'senza nome' : String(x).slice(0, 40)}` }))];
    const mapGrid = h('div.grid-3.imp-map', FIELDS.map(fd => field(fd.label, selectInput(cols, String(v.header.map[fd.key] ?? -1), x => {
      if (x === '-1') delete v.header.map[fd.key]; else v.header.map[fd.key] = +x;
      draw();
    }))));
    const nMapped = Object.keys(v.header.map).length;
    const colTitle = i => String(head[i] ?? 'Totale').trim();
    parts.push(h('details.imp-cols', { open: v.header.map.date == null || (v.header.map.qty == null && v.header.map.amount == null) },
      h('summary', `Colonne riconosciute: ${nMapped} · intestazione alla riga ${sh.nums[v.header.index]}`),
      h('p.field-hint', 'Se una colonna è sbagliata, cambiala qui: l\'anteprima si aggiorna.'), mapGrid));

    const read = readOperations(sh.rows, v.header, { nums: sh.nums, date1904: book.date1904 });
    const check = checkTotals(read);
    const noBroker = v.header.map.broker == null || read.ops.some(o => !o.broker) || read.costs.some(c => !c.broker);
    plan = planImport(read, S.state, { account: noBroker ? v.account : null });

    // conto per le righe senza broker
    if (noBroker) {
      const opts = [...invAccs().map(a => ({ value: a.id, label: a.name })), { value: '', label: '+ Nuovo conto investimenti' }];
      parts.push(field('Conto in cui importare', selectInput(opts, v.account || '', x => { v.account = x || null; draw(); }), { hint: v.header.map.broker == null ? 'Nel file non c\'è la colonna del broker' : 'Per le righe senza broker' }));
    }

    // riepilogo
    const kinds = Object.entries(plan.byKind).map(([k, n]) => plural(n, KIND[k]));
    if (plan.costs.length) kinds.push(plural(plan.costs.length, ['imposta', 'imposte']));
    const allOps = plan.holdings.flatMap(x => x.ops);
    const net = allOps.filter(o => o.kind === 'buy' || o.kind === 'sell').reduce((a, o) => a + opNet(o), 0);
    const feeTax = allOps.reduce((a, o) => a + o.fee + o.tax, 0) + plan.costs.reduce((a, c) => a + c.amount, 0);
    parts.push(h('div.imp-summary',
      h('div.imp-big', plan.count ? `Pronte da importare: ${plural(plan.count, ['riga', 'righe'])}` : 'Niente di nuovo da importare'),
      kinds.length ? h('p', kinds.join(' · ')) : null,
      plan.count ? h('p.muted', `Investito netto ${moneyText(cents(net))} · commissioni e imposte ${moneyText(cents(feeTax))}`) : null,
      h('p.muted', 'Conti: ', plan.accounts.map(a => `${a.name}${a.existingId ? '' : ' (nuovo)'}`).join(', ') || '—')));

    // controllo con la colonna Totale del file
    if (check?.ok) parts.push(h('div.banner.banner-ok', icon('check', 18), h('span', h('b', 'Controllo superato. '), `Tutte le ${check.checked} righe coincidono al centesimo con la colonna «${colTitle(v.header.map.total)}» del file.`)));
    else if (check) parts.push(h('div.banner.banner-warn', icon('alert', 18), h('span', h('b', 'Da controllare. '), check.bad.length
      ? `${plural(check.bad.length, ['riga ha', 'righe hanno'])} un totale diverso dal file: ${check.bad.slice(0, 12).map(x => 'riga ' + x.row).join(', ')}${check.bad.length > 12 ? '…' : ''}.`
      : `La somma del file (${moneyText(cents(check.fileSum))}) è diversa da quella importata (${moneyText(cents(check.ourSum))}).`)));
    else parts.push(h('div.banner', icon('info', 18), h('span', 'Nel file non c\'è una colonna "Totale" da confrontare: controlla l\'elenco qui sotto.')));

    if (read.problems.length) parts.push(h('div.banner.banner-warn', icon('alert', 18), h('span', h('b', `${plural(read.problems.length, ['riga non importata', 'righe non importate'])}: `),
      read.problems.slice(0, 15).map(p => `riga ${p.row} (${p.msg})`).join('; ') + (read.problems.length > 15 ? '…' : '.'))));
    if (plan.dups) parts.push(h('p.field-hint', `${plural(plan.dups, ['operazione era', 'operazioni erano'])} già nell'app: non le importo di nuovo.`));
    if (read.skipped.length) parts.push(h('p.field-hint', `${plural(read.skipped.length, ['riga senza numeri saltata', 'righe senza numeri saltate'])} (separatori come "2026", righe vuote o promemoria).`));

    // titoli
    if (plan.holdings.length) {
      parts.push(h('div.import-preview', h('div.rows', plan.holdings.map(x => {
        const n = x.ops.filter(o => o.kind === 'buy' || o.kind === 'sell').reduce((a, o) => a + opNet(o), 0);
        return h('div.row',
          h('span.row-main', h('span.row-title', x.name, x.existing ? h('span.pill', 'già presente') : null),
            h('span.row-sub', [ASSET_CLASSES[x.cls]?.label, x.group, x.isin, plural(x.ops.length, ['operazione', 'operazioni'])].filter(Boolean).join(' · '))),
          h('span.row-end', moneyText(cents(n), x.currency)));
      }))));
      parts.push(toggle('Le operazioni muovono la liquidità del conto', v.cash, x => { v.cash = x; }, { hint: 'Lascia spento se nel file non ci sono i versamenti sul conto: il conto varrà quanto i titoli (meno l\'imposta di bollo, che si paga dalla liquidità). Il prezzo di ogni titolo sarà quello dell\'ultima operazione finché non lo aggiorni.' }));
    }
    btn.disabled = !plan.count;
    btn.textContent = plan.count ? `Importa ${plural(plan.count, ['riga', 'righe'])}` : 'Niente da importare';
    body.replaceChildren(...parts);
  }

  btn.addEventListener('click', () => {
    if (!plan?.count) return;
    importInvestments(plan, { cash: v.cash });
    const tk = undoToken();
    toast(`${plural(plan.count, ['riga importata', 'righe importate'])}`, { kind: 'ok', action: { label: 'Annulla', fn: () => { if (undo(tk)) toast('Importazione annullata'); else toast('Non si può più annullare: nel frattempo hai fatto altre modifiche'); } } });
    s.close(true);
    ctx.go('investimenti?vista=anni');
  });
  draw();
  const s = openSheet({ title: 'Importa investimenti', subtitle: f.name, size: 'lg', body, footer: [btn] });
}
