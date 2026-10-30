/* Importa un file Excel (.xlsx) o CSV, anche con più fogli. Ogni foglio si riconosce dalla sua
   intestazione, non dal nome:
   - operazioni (una riga per acquisto o vendita, anche di crypto) → investimenti;
   - mese per mese (CATEGORIA / SUB CATEGORIA / NOTE e GEN…DIC) → entrate o uscite;
   - patrimonio (una fila di date di fine mese) → il valore dei conti a quelle date.
   Anteprima foglio per foglio, righe non capite elencate, controlli con i totali del file,
   doppioni esclusi, un solo "Annulla". Il file si legge solo sul dispositivo. */

import { h, icon, pickFile, readText } from '../ui/dom.js';
import { openSheet, field, selectInput, toggle, toast } from '../ui/components.js';
import { undo, undoToken, S } from '../session.js';
import { moneyText } from '../ui/fmt.js';
import { parseCSV } from '../core/csv.js';
import { readXlsx, isZip } from '../core/xlsx.js';
import { FIELDS, readOperations, checkTotals, planImport, opNet } from '../core/invimport.js';
import { detectSheet, sheetHints, readMonths, planMonths, readNetWorth, planNetWorth, catKey } from '../core/sheets.js';
import { ASSET_CLASSES, ACCOUNT_TYPES, hasHoldings, hasPlan } from '../core/model.js';
import { CURRENCIES } from '../core/money.js';
import { formatDate, today } from '../core/dates.js';
import { importWorkbook } from '../actions.js';

const KIND = { buy: ['acquisto', 'acquisti'], sell: ['vendita', 'vendite'], div: ['cedola', 'cedole'], fee: ['costo', 'costi'] };
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const cents = x => Math.round(x * 100);
const LABEL = { ops: 'Operazioni sugli investimenti', crypto: 'Operazioni sulle crypto', months: 'Mese per mese', networth: 'Patrimonio mese per mese' };

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

const banner = (kind, ...content) => h('div.banner', { class: kind ? 'banner-' + kind : '' }, icon(kind === 'ok' ? 'check' : kind === 'warn' ? 'alert' : 'info', 18), h('span', ...content));
const check = (label, on, onChange) => h('label.chk', h('input', { type: 'checkbox', checked: on, onchange: e => onChange(e.target.checked) }), label);

export async function openFileImport(ctx) {
  const f = await pickFile('.xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { toast('File troppo grande (massimo 20 MB)', { kind: 'err' }); return; }
  let book;
  try { book = await loadFile(f); } catch (e) { toast(e?.message || 'Non riesco a leggere il file', { kind: 'err' }); return; }

  const refDate = today();
  const cy = +refDate.slice(0, 4);
  // cosa contiene ogni foglio, e le scelte fatte nell'anteprima
  const sheets = book.sheets.map((sh, i) => {
    const det = detectSheet(sh);
    const x = { i, sh, det, kind: det?.kind || null, on: !!det };
    if (x.kind === 'ops') { x.header = { ...det.header, map: { ...det.header.map } }; x.crypto = !!det.header.crypto; }
    if (x.kind === 'months') { const hi = sheetHints(sh, det); x.mkind = hi.kind || 'income'; x.kindKnown = !!hi.kind; x.year = hi.year || cy; x.target = 'new'; x.onlyFile = true; }
    if (x.kind === 'networth') { x.includeOdd = false; x.rows = new Map(); }
    return x;
  });
  const v = { account: null, cash: false };
  const invAccs = () => S.state.accounts.filter(a => hasHoldings(a) && !a.archived);
  if (invAccs().length) v.account = invAccs()[0].id;

  const body = h('div.stack');
  const btn = h('button.btn.btn-primary', { type: 'button' }, 'Importa');
  let job = null;

  function draw() {
    const st = S.state;
    const parts = [h('p.muted', 'Il file resta sul tuo dispositivo: viene letto qui, non viene inviato da nessuna parte.')];
    const found = sheets.filter(x => x.kind), other = sheets.filter(x => !x.kind);
    if (!found.length) {
      job = null;
      btn.disabled = true; btn.textContent = 'Niente da importare';
      parts.push(banner('warn', 'Non riconosco nessun foglio. So leggere: un elenco di operazioni (data, quote o importo, con una riga d\'intestazione), una tabella mese per mese (categoria e le colonne GEN…DIC) e un foglio del patrimonio (una riga con le date di fine mese).'));
      body.replaceChildren(...parts);
      return;
    }
    if (book.sheets.length > 1) {
      parts.push(h('p', `Ho trovato ${plural(found.length, ['foglio da importare', 'fogli da importare'])}: `,
        found.map((x, k) => [k ? ', ' : '', h('b', x.sh.name), ` (${(x.crypto ? LABEL.crypto : LABEL[x.kind]).toLowerCase()})`]), '.',
        other.length ? h('span.muted', ` Non ${other.length === 1 ? 'riconosco' : 'riconosco'}: ${other.map(x => x.sh.name).join(', ')}.`) : null));
    }

    /* ── investimenti: tutti i fogli di operazioni insieme (stessi conti, nessun doppione) ── */
    const opsSheets = sheets.filter(x => x.kind === 'ops');
    const merged = { ops: [], costs: [], skipped: [], problems: [] };
    const opsParts = [];
    for (const x of opsSheets) {
      const head = x.sh.rows[x.header.index] || [];
      const cols = [{ value: '-1', label: '—' }, ...head.map((c, i) => ({ value: String(i), label: `${colName(i)} · ${c == null || c === '' ? 'senza nome' : String(c).slice(0, 40)}` }))];
      const mapGrid = h('div.grid-3.imp-map', FIELDS.map(fd => field(fd.label, selectInput(cols, String(x.header.map[fd.key] ?? -1), val => {
        if (val === '-1') delete x.header.map[fd.key]; else x.header.map[fd.key] = +val;
        draw();
      }))));
      const sec = [h('div.imp-sheet-head', check(h('b', x.sh.name), x.on, on => { x.on = on; draw(); }), h('span.pill', x.crypto ? LABEL.crypto : LABEL.ops))];
      if (x.on) {
        const read = readOperations(x.sh.rows, x.header, { nums: x.sh.nums, date1904: book.date1904 });
        const ck = checkTotals(read);
        const tag = opsSheets.length > 1 ? `«${x.sh.name}» ` : '';
        merged.ops.push(...read.ops); merged.costs.push(...read.costs);
        merged.skipped.push(...read.skipped.map(r => tag + r));
        merged.problems.push(...read.problems.map(p => ({ ...p, row: tag + p.row })));
        sec.push(h('details.imp-cols', { open: x.header.map.date == null || (x.header.map.qty == null && x.header.map.amount == null) },
          h('summary', `Colonne riconosciute: ${Object.keys(x.header.map).length} · intestazione alla riga ${x.sh.nums[x.header.index]}`),
          h('p.field-hint', 'Se una colonna è sbagliata, cambiala qui: l\'anteprima si aggiorna.'), mapGrid));
        const colTitle = i => String(head[i] ?? 'Totale').trim();
        if (ck?.ok) sec.push(banner('ok', h('b', 'Controllo superato. '), `Tutte le ${ck.checked} righe coincidono al centesimo con la colonna «${colTitle(x.header.map.total)}» del file.`));
        else if (ck) sec.push(banner('warn', h('b', 'Da controllare. '), ck.bad.length
          ? `${plural(ck.bad.length, ['riga ha', 'righe hanno'])} un totale diverso dal file: ${ck.bad.slice(0, 12).map(b => 'riga ' + b.row).join(', ')}${ck.bad.length > 12 ? '…' : ''}.`
          : `La somma del file (${moneyText(cents(ck.fileSum))}) è diversa da quella importata (${moneyText(cents(ck.ourSum))}).`));
        else sec.push(banner('', 'Nel foglio non c\'è una colonna "Totale" da confrontare: controlla l\'elenco qui sotto.'));
      }
      opsParts.push(h('section.imp-sheet', sec));
    }
    const opsOn = opsSheets.some(x => x.on);
    const noBroker = opsOn && (opsSheets.some(x => x.on && x.header.map.broker == null) || merged.ops.some(o => !o.broker) || merged.costs.some(c => !c.broker));
    const invest = opsOn ? planImport(merged, st, { account: noBroker ? v.account : null }) : null;
    if (invest) {
      const inv = [];
      if (noBroker) {
        const opts = [...invAccs().map(a => ({ value: a.id, label: a.name })), { value: '', label: '+ Nuovo conto investimenti' }];
        inv.push(field('Conto per le righe senza broker', selectInput(opts, v.account || '', val => { v.account = val || null; draw(); }), { hint: 'Le righe con il broker o la piattaforma vanno nel conto con quel nome (nuovo, se non c\'è)' }));
      }
      const kinds = Object.entries(invest.byKind).map(([k, n]) => plural(n, KIND[k]));
      if (invest.costs.length) kinds.push(plural(invest.costs.length, ['imposta', 'imposte']));
      const allOps = invest.holdings.flatMap(x => x.ops);
      const net = allOps.filter(o => o.kind === 'buy' || o.kind === 'sell').reduce((a, o) => a + opNet(o), 0);
      const feeTax = allOps.reduce((a, o) => a + o.fee + o.tax, 0) + invest.costs.reduce((a, c) => a + c.amount, 0);
      inv.push(h('div.imp-summary',
        h('div.imp-big', invest.count ? `Investimenti: ${plural(invest.count, ['riga', 'righe'])}` : 'Investimenti: niente di nuovo'),
        kinds.length ? h('p', kinds.join(' · ')) : null,
        invest.count ? h('p.muted', `Investito netto ${moneyText(cents(net))} · commissioni e imposte ${moneyText(cents(feeTax))}`) : null,
        h('p.muted', 'Conti: ', invest.accounts.map(a => `${a.name}${a.existingId ? '' : a.type === 'crypto' ? ' (nuovo wallet crypto)' : ' (nuovo)'}`).join(', ') || '—')));
      if (merged.problems.length) inv.push(banner('warn', h('b', `${plural(merged.problems.length, ['riga non importata', 'righe non importate'])}: `),
        merged.problems.slice(0, 15).map(p => `riga ${p.row} (${p.msg})`).join('; ') + (merged.problems.length > 15 ? '…' : '.')));
      if (invest.dups) inv.push(h('p.field-hint', `${plural(invest.dups, ['operazione era', 'operazioni erano'])} già nell'app: non le importo di nuovo.`));
      if (merged.skipped.length) inv.push(h('p.field-hint', `${plural(merged.skipped.length, ['riga senza numeri saltata', 'righe senza numeri saltate'])} (separatori come "2026", righe vuote o promemoria).`));
      if (invest.holdings.length) {
        inv.push(h('details.imp-cols', h('summary', `${plural(invest.holdings.length, ['titolo', 'titoli'])}: vedi l'elenco`),
          h('div.import-preview', h('div.rows', invest.holdings.map(x => {
            const n = x.ops.filter(o => o.kind === 'buy' || o.kind === 'sell').reduce((a, o) => a + opNet(o), 0);
            return h('div.row',
              h('span.row-main', h('span.row-title', x.name, x.existing ? h('span.pill', 'già presente') : null),
                h('span.row-sub', [ASSET_CLASSES[x.cls]?.label, x.group, x.isin || x.symbol, x.acc.name, plural(x.ops.length, ['operazione', 'operazioni'])].filter(Boolean).join(' · '))),
              h('span.row-end', moneyText(cents(n), x.currency)));
          })))));
        inv.push(toggle('Le operazioni muovono la liquidità del conto', v.cash, val => { v.cash = val; }, { hint: 'Lascia spento se nel file non ci sono i versamenti sul conto: il conto varrà quanto i titoli (meno l\'imposta di bollo, che si paga dalla liquidità). Il prezzo di ogni titolo sarà quello dell\'ultima operazione finché non lo aggiorni.' }));
      }
      opsParts.push(...inv);
    }

    /* ── patrimonio: conti e valori di fine mese ── */
    const newHoldings = invest ? invest.holdings.filter(x => !x.existing) : [];
    const nwRows = [];
    const nwParts = [];
    for (const x of sheets.filter(s => s.kind === 'networth')) {
      const sec = [h('div.imp-sheet-head', check(h('b', x.sh.name), x.on, on => { x.on = on; draw(); }), h('span.pill', LABEL.networth))];
      if (x.on) {
        const read = readNetWorth(x.sh.rows, x.det, { nums: x.sh.nums });
        const investNames = [...st.accounts.filter(a => st.holdings.some(hd => hd.account === a.id)).map(a => a.name), ...(invest ? invest.accounts.map(a => a.name) : [])];
        const plan = planNetWorth(read, st, { includeOdd: x.includeOdd, holdings: [...st.holdings, ...newHoldings], investNames, refDate });
        const rows = plan.rows.map(r => {
          const key = `${x.i}:${r.row}`;
          const o = x.rows.get(key) || {};
          return { ...r, key, on: o.on ?? r.on, type: o.type || r.type, currency: o.currency || r.currency };
        });
        const on = rows.filter(r => r.on && r.values.length);
        nwRows.push(...on);
        const dates = read.dates.filter(d => d <= refDate);
        const nVals = on.reduce((a, r) => a + r.values.length, 0);
        sec.push(h('div.imp-summary',
          h('div.imp-big', on.length ? [on.filter(r => !r.holding).length ? plural(on.filter(r => !r.holding).length, ['conto', 'conti']) : '', on.filter(r => r.holding).length ? plural(on.filter(r => r.holding).length, ['titolo', 'titoli']) : '', plural(nVals, ['valore', 'valori'])].filter(Boolean).join(', ') : 'Niente di nuovo'),
          dates.length ? h('p.muted', `Valori dal ${formatDate(dates[0], { year: true })} al ${formatDate(dates[dates.length - 1], { year: true })}: ognuno diventa il saldo del conto a quella data.`) : null,
          h('p.muted', 'Le righe di totale, guadagno, percentuale e l\'Asset Allocation sono calcoli del foglio: non le importo, le uso per il controllo.')));
        const bad = read.checks.filter(c => !c.ok);
        if (read.checks.length && !bad.length) sec.push(banner('ok', h('b', 'Controllo superato. '), `Le righe "Total" di ${plural(read.checks.length, ['sezione coincidono', 'sezioni coincidono'])} con la somma dei conti.`));
        else if (bad.length) sec.push(banner('warn', h('b', 'Da controllare. '), `La riga del totale non coincide con la somma dei conti in: ${bad.map(c => `${c.section || 'riga ' + c.row}${c.bad.length ? ` (${c.bad.slice(0, 3).map(d => formatDate(d, { year: true })).join(', ')}${c.bad.length > 3 ? '…' : ''})` : ''}`).join('; ')}. Forse c'è una riga in più o in meno nel foglio.`));
        const odd = plan.rows.filter(r => r.odd.length);
        if (odd.length) {
          const ob = banner('warn', h('b', 'Valori strani. '), `${odd.map(r => `${r.name}: ${r.odd.map(o => `${moneyText(cents(o.value), r.currency)} il ${formatDate(o.date, { year: true })}`).join(', ')}`).join('; ')}. Sono molto più grandi degli altri valori della riga: forse un errore di battitura. ${x.includeOdd ? 'Li importo.' : 'Non li importo.'}`);
          ob.append(h('button.btn.btn-sm', { type: 'button', onclick: () => { x.includeOdd = !x.includeOdd; draw(); } }, x.includeOdd ? 'Escludili' : 'Importali lo stesso'));
          sec.push(ob);
        }
        const future = rows.filter(r => r.on).reduce((a, r) => a + r.future, 0);
        if (future) sec.push(h('p.field-hint', `${plural(future, ['valore con data futura non importato', 'valori con data futura non importati'])}.`));
        const known = rows.filter(r => r.existing).reduce((a, r) => a + r.known, 0);
        if (known) sec.push(h('p.field-hint', `${plural(known, ['valore era', 'valori erano'])} già nell'app: non li importo di nuovo.`));
        const typeOpts = Object.entries(ACCOUNT_TYPES).filter(([k]) => !ACCOUNT_TYPES[k].plan).map(([k, t]) => ({ value: k, label: t.label }));
        const curOpts = Object.keys(CURRENCIES).map(c => ({ value: c, label: c }));
        const set = (key, patch) => { x.rows.set(key, { ...(x.rows.get(key) || {}), ...patch }); draw(); };
        let lastSection = null;
        const list = [];
        for (const r of rows) {
          if (r.section !== lastSection) { lastSection = r.section; if (r.section) list.push(h('div.imp-section', r.section)); }
          const last = r.values[r.values.length - 1];
          list.push(h('div.imp-nw-row', { class: r.on ? '' : 'off' },
            h('label.row.imp-line',
              h('input', { type: 'checkbox', checked: r.on, disabled: !r.values.length, onchange: e => set(r.key, { on: e.target.checked }) }),
              h('span.row-main', h('span.row-title', r.name, r.existing ? h('span.pill', 'conto già presente') : null, r.holding ? h('span.pill', 'titolo') : null),
                h('span.row-sub', (r.holding
                  ? [`valori di fine mese di «${r.holding.name}»`, plural(r.values.length, ['valore', 'valori'])]
                  : [ACCOUNT_TYPES[r.type]?.label, r.currency !== st.settings.currency ? r.currency : '', plural(r.values.length, ['valore', 'valori']), r.reason]).filter(Boolean).join(' · '))),
              h('span.row-end', last ? moneyText(cents(last.value), r.currency) : '—')),
            r.on && !r.existing && !r.holding ? h('div.imp-row-opts',
              selectInput(typeOpts, r.type, val => set(r.key, { type: val })),
              selectInput(curOpts, r.currency, val => set(r.key, { currency: val }))) : null));
        }
        sec.push(h('details.imp-cols', { open: true }, h('summary', `Righe del foglio: ${rows.length}`),
          h('p.field-hint', 'Togli la spunta a quello che non vuoi importare; per i conti nuovi puoi cambiare il tipo e la valuta. Le righe dei titoli (ETF, azioni, crypto…) non diventano conti: i loro valori diventano il valore di fine mese di quel titolo, così nulla si conta due volte. Il TFR lordo resta fuori: conta il netto.'),
          h('div.import-preview.imp-nw', list)));
      }
      nwParts.push(h('section.imp-sheet', sec));
    }

    /* ── fogli mese per mese: entrate o uscite ── */
    const monthJobs = [];
    const mParts = [];
    // il conto apposta, se c'è già da un'importazione precedente
    const fileAcc = st.accounts.find(a => !a.archived && !a.inNetWorth && a.name === 'Entrate e uscite dal file');
    const targetOpts = [
      { value: 'new', label: fileAcc ? 'Entrate e uscite dal file (fuori dal patrimonio)' : 'Un conto apposta, fuori dal patrimonio' },
      ...nwRows.filter(r => !r.existing && !hasHoldings({ type: r.type })).map(r => ({ value: 'nw:' + r.key, label: `${r.name} (nuovo, dal patrimonio)`, group: 'Dal foglio del patrimonio' })),
      ...st.accounts.filter(a => a !== fileAcc && !a.archived && !hasHoldings(a) && !hasPlan(a)).map(a => ({ value: a.id, label: a.name, group: 'I tuoi conti' })),
    ];
    for (const x of sheets.filter(s => s.kind === 'months')) {
      if (!targetOpts.some(o => o.value === x.target)) x.target = 'new';
      const sec = [h('div.imp-sheet-head', check(h('b', x.sh.name), x.on, on => { x.on = on; draw(); }), h('span.pill', `${x.mkind === 'income' ? 'Entrate' : 'Uscite'} mese per mese`))];
      if (x.on) {
        const read = readMonths(x.sh.rows, x.det, { nums: x.sh.nums });
        const plan = planMonths(read, st, { year: x.year, kind: x.mkind, refDate });
        monthJobs.push({ plan, kind: x.mkind, target: x.target, year: x.year, onlyFile: x.onlyFile });
        const years = []; for (let y = Math.max(cy + 1, x.year); y >= Math.min(cy - 15, x.year); y--) years.push({ value: String(y), label: String(y) });
        sec.push(h('div.grid-3',
          field('Sono', selectInput([{ value: 'income', label: 'Entrate' }, { value: 'expense', label: 'Uscite' }], x.mkind, val => { x.mkind = val; x.kindKnown = true; draw(); })),
          field('Anno', selectInput(years, String(x.year), val => { x.year = +val; draw(); })),
          field('Nel conto', selectInput(targetOpts, x.target, val => { x.target = val; draw(); }), { wide: true })));
        if (!x.kindKnown) sec.push(banner('warn', 'Dal nome del foglio non capisco se sono entrate o uscite: scegli qui sopra.'));
        sec.push(toggle('Solo le categorie del file', x.onlyFile, v => { x.onlyFile = v; }, { hint: `Le categorie di ${x.mkind === 'income' ? 'entrata' : 'uscita'} dell'app che il foglio non usa (e senza movimenti) si nascondono: la tabella resta uguale al tuo Excel. Le ritrovi in "Categorie".` }));
        sec.push(h('p.field-hint', x.target === 'new'
          ? 'Così i saldi dei tuoi conti non cambiano: entrate e uscite servono a vedere quanto, per cosa e quando, mese per mese.'
          : x.target.startsWith('nw:') ? 'A ogni fine mese il conto vale comunque quanto scritto nel foglio del patrimonio.' : 'Attenzione: entrate e uscite cambiano il saldo di questo conto.'));
        const cats = plan.newCats.map(c => (c.group === c.name ? c.name : `${c.group} › ${c.name}`));
        sec.push(h('div.imp-summary',
          h('div.imp-big', plan.txs.length ? `${plural(plan.txs.length, ['movimento', 'movimenti'])} · ${moneyText(plan.total)}` : 'Niente di nuovo da importare'),
          h('p.muted', `${plural(read.lines.length, ['riga', 'righe'])}, un movimento per ogni mese con un importo, datato all'ultimo giorno del mese. La descrizione è la nota della riga, se c'è, altrimenti la sottocategoria.`),
          cats.length ? h('p.muted', `Categorie nuove (${cats.length}): ${cats.slice(0, 12).join(', ')}${cats.length > 12 ? '…' : ''}`) : h('p.muted', 'Tutte le categorie ci sono già.')));
        const bad = read.checks.filter(c => !c.ok), good = read.checks.filter(c => c.ok);
        if (good.length && !bad.length) sec.push(banner('ok', h('b', 'Controllo superato. '), `I totali di ${plural(good.length, ['categoria coincidono', 'categorie coincidono'])} con la somma delle sottocategorie.`));
        if (bad.length) sec.push(banner('warn', h('b', 'Da controllare. '), bad.map(c => c.file != null ? `riga ${c.row} (${c.group}): il totale del file è ${moneyText(cents(c.file))}, la somma dei mesi ${moneyText(cents(c.ours))}` : `riga ${c.row} (${c.group}): il totale non coincide con le sottocategorie`).slice(0, 8).join('; ') + '.'));
        if (plan.future) sec.push(h('p.field-hint', `${plural(plan.future, ['importo nei mesi futuri non importato', 'importi nei mesi futuri non importati'])} (previsioni).`));
        if (plan.dups) sec.push(h('p.field-hint', `${plural(plan.dups, ['movimento era', 'movimenti erano'])} già nell'app (stessa data, importo e descrizione): non li importo di nuovo.`));
        if (read.lines.length) {
          sec.push(h('details.imp-cols', h('summary', 'Vedi le righe'),
            h('div.import-preview', h('div.rows', read.lines.map(l => h('div.row',
              h('span.row-main', h('span.row-title', [l.group, l.sub].filter(Boolean).join(' › ')), h('span.row-sub', [l.note, `riga ${l.row}`].filter(Boolean).join(' · '))),
              h('span.row-end', moneyText(cents(l.total)))))))));
        }
      }
      mParts.push(h('section.imp-sheet', sec));
    }

    // nell'ordine dei fogli del file
    const first = k => Math.min(...sheets.filter(x => x.kind === k).map(x => x.i));
    parts.push(...[[first('networth'), nwParts], [first('ops'), opsParts], [first('months'), mParts]].sort((a, b) => a[0] - b[0]).flatMap(x => x[1]));

    const nTx = monthJobs.reduce((a, m) => a + m.plan.txs.length, 0);
    const nVals = nwRows.reduce((a, r) => a + r.values.length, 0);
    const pieces = [];
    const nwAcc = nwRows.filter(r => !r.holding).length, nwHd = nwRows.length - nwAcc;
    if (nwAcc) pieces.push(plural(nwAcc, ['conto', 'conti']));
    if (nwHd) pieces.push(plural(nwHd, ['titolo nel Net Worth', 'titoli nel Net Worth']));
    if (invest?.count) pieces.push(plural(invest.count, ['operazione', 'operazioni']));
    if (nTx) pieces.push(plural(nTx, ['movimento', 'movimenti']));
    // anche solo categorie nuove (es. 13ESIMA ancora a zero) o nomi da riallineare al file
    const catWork = m => m.plan.newCats.length + (m.onlyFile ? st.categories.filter(c => { const n = c.kind === m.kind && m.plan.names?.[catKey(c.group, c.name)]; return n && (c.name !== n.name || c.group !== n.group); }).length : 0);
    const nCat = monthJobs.reduce((a, m) => a + catWork(m), 0);
    if (nCat && !nTx) pieces.push(plural(nCat, ['categoria', 'categorie']));
    job = pieces.length ? { nw: nwRows, invest: invest?.count ? invest : null, months: monthJobs.filter(m => m.plan.txs.length || catWork(m)), text: pieces.join(', '), nVals, nTx } : null;
    btn.disabled = !job;
    btn.textContent = job ? `Importa: ${job.text}` : 'Niente da importare';
    body.replaceChildren(...parts);
  }

  btn.addEventListener('click', () => {
    if (!job) return;
    importWorkbook({ nw: job.nw, invest: job.invest, cash: v.cash, months: job.months });
    const tk = undoToken();
    toast(`Importato: ${job.text}`, { kind: 'ok', action: { label: 'Annulla', fn: () => { if (undo(tk)) toast('Importazione annullata'); else toast('Non si può più annullare: nel frattempo hai fatto altre modifiche'); } } });
    s.close(true);
    if (job.nw.length) ctx.go('patrimonio');
    else if (job.months.length) ctx.go('entrate-uscite?tipo=' + (job.months[0].kind === 'income' ? 'entrate' : 'uscite'));
    else ctx.go('investimenti?vista=anni');
  });
  draw();
  const s = openSheet({ title: 'Importa da Excel', subtitle: f.name, size: 'lg', body, footer: [btn] });
}
