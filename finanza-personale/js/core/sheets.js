/* Fogli "mese per mese" e "Net Worth" di un file Excel (oltre a quello delle operazioni,
   in invimport.js). Ogni foglio si riconosce dalla sua intestazione, non dal nome:
   - mesi: CATEGORIA / SUB CATEGORIA / NOTE e le colonne GEN…DIC → un movimento per cella;
   - patrimonio: una fila di date di fine mese → il valore di ogni conto a quelle date.
   Le righe di totale, guadagno e percentuale sono calcoli del foglio: si saltano e servono
   solo da controllo. Nulla si salva qui: si prepara cosa importare. */

import { normHead, cellNumber, findHeader } from './invimport.js';
import { excelDate } from './xlsx.js';
import { parseDateFlexible } from './dates.js';

const MONTHS = [['gen', 'jan'], ['feb'], ['mar'], ['apr'], ['mag', 'may'], ['giu', 'jun'], ['lug', 'jul'], ['ago', 'aug'], ['set', 'sep'], ['ott', 'oct'], ['nov'], ['dic', 'dec']];
const monthOf = cell => {
  if (typeof cell !== 'string') return -1;
  const n = normHead(cell);
  if (!/^[a-z]{3,9}$/.test(n)) return -1;
  return MONTHS.findIndex(alts => alts.some(a => n.startsWith(a)) && (n.length === 3 || n.length > 3));
};
const text = v => (v == null ? '' : String(v).trim());
const TOTAL_RE = /^(?:(?:totale?|totali|totals?|gain|loss|guadagno|perdita|var|variazione|differenza|delta)\b|%)/i;

/** I nomi restano scritti come nel foglio (D vuole l'app "uguale all'Excel": LAVORO, INT. BANCA,
    CC, CD…); si tolgono solo gli spazi di troppo. */
export function niceName(s) {
  return text(s).replace(/\s+/g, ' ');
}

/* ─── Riconoscimento ─── */

export function detectMonths(rows) {
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const r = rows[i] || [];
    const cols = Array(12).fill(-1);
    r.forEach((c, j) => { const m = monthOf(c); if (m >= 0 && cols[m] < 0) cols[m] = j; });
    if (cols.filter(c => c >= 0).length < 10) continue;
    const map = {};
    r.forEach((c, j) => {
      const n = normHead(c);
      if (map.group == null && /^(categoria|category|gruppo|macro ?categoria)$/.test(n)) map.group = j;
      else if (map.sub == null && /^(sub ?categoria|sottocategoria|sub ?category|subcategory|voce)$/.test(n)) map.sub = j;
      else if (map.note == null && /^(note|nota|descrizione|dettaglio|fonte)$/.test(n)) map.note = j;
      else if (map.total == null && /^(totale|totali|total)$/.test(n)) map.total = j;
    });
    const first = Math.min(...cols.filter(c => c >= 0));
    if (map.group == null) map.group = 0;
    if (map.group >= first) return null;
    return { kind: 'months', index: i, cols, map };
  }
  return null;
}

function cellDate(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelDate(v) : null;
  if (typeof v === 'string' && /\d/.test(v)) return parseDateFlexible(v.trim());
  return null;
}

export function detectNetWorth(rows) {
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const r = rows[i] || [];
    const dates = [];
    r.forEach((c, j) => { const d = cellDate(c); if (d) dates.push({ col: j, date: d }); });
    if (dates.length < 3) continue;
    const ok = dates.every((d, k) => k === 0 || d.date > dates[k - 1].date);
    if (!ok) continue;
    const typeCol = r.findIndex((c, j) => j < dates[0].col && /^(type|tipo|tipologia)$/.test(normHead(c)));
    return { kind: 'networth', index: i, dates, typeCol, nameCol: 0 };
  }
  return null;
}

/** Che foglio è: operazioni, mesi, patrimonio, o nessuno dei tre. */
export function detectSheet(sheet) {
  const ops = findHeader(sheet.rows);
  if (ops && ops.score >= 4) return { kind: 'ops', header: ops };
  return detectMonths(sheet.rows) || detectNetWorth(sheet.rows) || (ops ? { kind: 'ops', header: ops } : null);
}

/** Entrate o uscite dal nome del foglio. */
export function kindFromName(name) {
  const n = normHead(name);
  if (/uscit|spes|expens|costi|cost/.test(n)) return 'expense';
  if (/entrat|income|ricav|guadagn/.test(n)) return 'income';
  return null;
}
export function yearFromName(name) {
  const m = /\b(19|20)\d{2}\b/.exec(String(name || ''));
  return m ? +m[0] : null;
}

/* ─── Foglio mese per mese ─── */

/** Riga di statistica, non un'entrata o un'uscita: "Liquidità a fine 2025", "Saldo iniziale"… */
export const isStatLabel = s => /liquidit|saldo|giacenz|patrimon|disponibilit|riporto|net ?worth|risparmi(o|ato) (totale|anno)/i.test(s || '') && /fine|inizi|iniziale|al |anno|precedente|\b(19|20)\d\d\b/i.test(s || '');

export function readMonths(rows, info, { nums } = {}) {
  const { cols, map } = info;
  const lines = [], skipped = [], checks = [], stats = [];
  let lastGroup = '', ended = false;
  const raw = [];
  for (let i = info.index + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const row = nums ? nums[i] : i + 1;
    let group = text(r[map.group]);
    const sub = map.sub != null ? text(r[map.sub]) : '';
    const note = map.note != null ? text(r[map.note]) : '';
    const label = [group, sub, note].filter(Boolean).join(' ');
    // la tabella finisce alla riga TOTALE: sotto ci sono riepiloghi e statistiche
    if (/^(totale?|totali|totals?)$/i.test(group.replace(/[^a-z]/gi, ''))) { ended = true; continue; }
    if (TOTAL_RE.test(group)) continue;                          // altre righe di totale
    if (ended || isStatLabel(label)) { if (label && cols.some(c => c >= 0 && cellNumber(r[c], { money: true }))) stats.push({ row, label }); continue; }
    if (!group && (sub || note)) group = lastGroup;              // categoria scritta solo nella prima riga
    if (group) lastGroup = group;
    const values = cols.map(c => (c < 0 ? 0 : cellNumber(r[c], { money: true }) || 0));
    // una voce ancora a zero (es. 13ESIMA prima di dicembre) resta: la categoria va creata lo stesso
    if (!group || (!values.some(v => v) && !sub)) { if (group || sub || note) skipped.push(row); continue; }
    raw.push({ row, group, sub, note, values, fileTotal: map.total != null ? cellNumber(r[map.total], { money: true }) : null });
  }
  // una riga con la sola categoria, quando la categoria ha anche sottocategorie, è il suo totale
  const withSub = new Set(raw.filter(x => x.sub).map(x => normHead(x.group)));
  for (const x of raw) {
    if (!x.sub && withSub.has(normHead(x.group))) {
      const parts = raw.filter(y => y.sub && normHead(y.group) === normHead(x.group));
      const same = x.values.every((v, m) => Math.abs(v - parts.reduce((a, y) => a + y.values[m], 0)) < 0.01);
      checks.push({ row: x.row, group: x.group, ok: same });
      continue;
    }
    const total = x.values.reduce((a, v) => a + v, 0);
    if (x.fileTotal != null && Math.abs(x.fileTotal - total) >= 0.01) checks.push({ row: x.row, group: x.group, ok: false, file: x.fileTotal, ours: total });
    lines.push({ ...x, total });
  }
  return { lines, skipped, checks, stats };
}

/* ─── Foglio Net Worth ─── */

/** Tipo di conto dalla sezione, dal tipo scritto e dal nome. */
export function accountTypeFor(section, type, name) {
  const s = normHead(section), t = normHead(type), n = normHead(name);
  if (/contant|cash money|^cash$/.test(n) || /^contanti$/.test(t)) return 'cash';     // "Euro", "Dollari" nel tipo sono la valuta
  if (/pension|previd|fondo pens/.test(n + ' ' + s)) return 'pension';
  if (/\btfr\b|liquidazion/.test(n + ' ' + s)) return 'receivable';          // il TFR lo deve il datore di lavoro
  if (/crypto|cripto|bitcoin|btc/.test(s + ' ' + t + ' ' + n)) return 'crypto';
  if (/deposit|risparm|\bcd\b|vincolat/.test(n + ' ' + t)) return 'savings';
  if (/etf|stock|azion|fond|invest|materie|gold|oro|commod|etc|obblig|bond/.test(s + ' ' + t)) return 'broker';
  if (/debit|mutu|prestit|finanziam|carta di credito/.test(s + ' ' + n)) return 'debt';   // prima della casa: "Mutuo casa" è un debito
  if (/immobil|casa|appartament/.test(s + ' ' + n)) return 'property';
  if (/auto|moto|veicol/.test(s + ' ' + n)) return 'vehicle';
  if (/work|lavoro/.test(s)) return 'asset';
  return 'checking';
}
/** La valuta di una riga: dalla colonna Type ("Dollari", "USD", "$") o, se lì non c'è, dal nome
    ("Contanti $", "Contanti (USD)", "Cash dollari"). Il testo grezzo: normHead toglierebbe "$" e le parentesi. */
export function currencyFor(type, name = '') {
  const of = x => {
    const t = String(x ?? '').toLowerCase();
    if (/dollar|\busd\b|us\$|\$/.test(t)) return 'USD';
    if (/sterlin|\bgbp\b|£/.test(t)) return 'GBP';
    if (/franch[io] svizzer|\bchf\b/.test(t) || /^\s*franchi\s*$/.test(t)) return 'CHF';
    return null;
  };
  // dal nome solo per contanti e conti (un ETF "$ Treasury" vale comunque in euro nel foglio)
  return of(type) || (/contant|cash|liquid|dollar|banconot|conto|wallet/i.test(String(name ?? '')) ? of(name) : null);
}

export function readNetWorth(rows, info, { nums } = {}) {
  const { dates, typeCol, nameCol } = info;
  const accounts = [], totals = [], skipped = [], alloc = [];
  let section = '', skipSection = false, grand = null;
  for (let i = info.index + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const row = nums ? nums[i] : i + 1;
    const name = text(r[nameCol]);
    const type = typeCol >= 0 ? text(r[typeCol]) : '';
    const vals = dates.map(d => ({ date: d.date, value: cellNumber(r[d.col], { money: true }) }));
    const has = vals.some(v => v.value != null);
    // intestazione di sezione: un testo senza numeri ("Cash - Liquidity", "ETF", "Crypto")
    if (name && !has && !TOTAL_RE.test(name)) {
      section = name;
      skipSection = /allocation|allocazion|riepilog|summary|sintesi/i.test(name);
      continue;
    }
    if (skipSection) {
      // nell'Asset Allocation: il totale è il Net Worth del foglio, le righe i totali per tipo (per il controllo)
      if (/^tot/i.test(name || type) && has && !grand) grand = vals;
      else if (name && has && !TOTAL_RE.test(name || type)) alloc.push({ row, name, values: vals });
      continue;
    }
    const label = name || type;
    if (TOTAL_RE.test(label)) {
      if (/^tot/i.test(label) && has) totals.push({ row, section, values: vals });
      continue;
    }
    if (!name) continue;
    if (!has) { skipped.push(row); continue; }
    accounts.push({ row, section, name, type, values: vals.filter(v => v.value != null) });
  }
  // valori che sembrano errori di battitura: molto più grandi del resto della riga
  for (const a of accounts) {
    const nz = a.values.map(v => Math.abs(v.value)).filter(v => v > 0).sort((x, y) => x - y);
    const med = nz.length ? nz[Math.floor(nz.length / 2)] : 0;
    for (const v of a.values) v.odd = med > 0 && Math.abs(v.value) > Math.max(100000, med * 50);
  }
  // controllo con le righe "Total" della sezione
  const checks = totals.map(t => {
    const own = accounts.filter(a => a.section === t.section);
    const net = own.filter(a => !isGross(a, accounts));      // il totale del foglio può contare solo il netto
    const sumOf = (list, date) => list.reduce((s, a) => s + (a.values.find(x => x.date === date)?.value || 0), 0);
    const bad = t.values.filter(v => v.value != null && Math.abs(v.value - sumOf(own, v.date)) >= 0.01 && Math.abs(v.value - sumOf(net, v.date)) >= 0.01);
    return { row: t.row, section: t.section, ok: !bad.length, bad: bad.map(v => v.date) };
  });
  return { accounts, checks, skipped, dates: dates.map(d => d.date), grand, alloc, sectionTotals: totals };
}

/** Riga del patrimonio che corrisponde a un titolo già negli investimenti (per non contarlo due volte). */
export function matchHolding(name, holdings) {
  const words = s => normHead(s).split(/[^a-z0-9]+/).filter(w => w && !['etf', 'ucits', 'a', 'acc', 'dis'].includes(w));
  const w = words(name);
  if (!w.length) return null;
  return holdings.find(hd => {
    const pool = new Set([...words(hd.name), ...words(hd.group), ...words(hd.symbol)]);
    return w.every(x => pool.has(x));
  }) || null;
}

/* ─── Cosa aggiungere ai dati (senza toccarli) ─── */

/** Stessa categoria se gruppo e nome coincidono, a parte maiuscole e accenti. */
export const catKey = (group, name) => normHead(group) + '|' + normHead(name);

/** Entrate o uscite e anno: dal nome del foglio o dal titolo sopra l'intestazione ("ENTRATE 2026"). */
export function sheetHints(sheet, info) {
  const above = (sheet.rows.slice(0, info.index + 1)).flat().filter(v => typeof v === 'string').join(' ');
  const yNum = sheet.rows.slice(0, info.index).flat().find(v => typeof v === 'number' && v >= 1990 && v <= 2100 && Number.isInteger(v));
  return { kind: kindFromName(sheet.name) || kindFromName(above), year: yearFromName(sheet.name) || yearFromName(above) || yNum || null };
}

const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

/** Movimenti dal foglio mese per mese: uno per cella, all'ultimo giorno del mese
    (o a oggi per il mese in corso); i mesi futuri si saltano. */
/** Nome di un conto per riconoscerlo: come normHead ma tiene quello tra parentesi
    ("Contanti (Euro)" e "Contanti (Dollari)" sono due conti, "Oro (Piattaforma)" non è "Oro"). */
export const nameKey = x => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[()€$%:.*#_'’`]/g, ' ').replace(/\s+/g, ' ').trim();

/* Ogni cella del foglio (mese, categoria, voce) ha un'impronta salvata nel movimento (`importHash`):
   reimportando lo stesso file aggiornato si riconosce la stessa cella anche se l'importo è cambiato. */
const fnv = str => { let x = 0x811c9dc5; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16).padStart(8, '0'); };
export const cellHash = (kind, ym, key, payee) => { const id = `${kind}|${ym}|${key}|${normHead(payee)}`; return 'xl:' + fnv(id) + fnv(id.split('').reverse().join('')); };

export function planMonths(read, state, { year, kind, refDate }) {
  const cats = state.categories.filter(c => c.kind === kind);
  // stessa categoria solo se coincidono categoria e sottocategoria: "MUSICA › ROYALTIES" non è "Lavoro › Royalties"
  // (o una spostata a mano in un'altra categoria: si ricorda da dove veniva)
  const find = (g, n) => cats.find(c => catKey(c.group, c.name) === catKey(g, n)) || cats.find(c => (c.was || []).includes(catKey(g, n)));
  const other = kind === 'income' ? 'expense' : 'income';
  const newCats = new Map();
  const cells = new Map();
  let future = 0;
  for (const l of read.lines) {
    const group = niceName(l.group), name = niceName(l.sub || l.group);
    const cat = find(group, name);
    const k = catKey(group, name);
    if (!cat && !newCats.has(k)) newCats.set(k, { key: k, group, name });
    const payee = l.note || name;
    for (let m = 0; m < 12; m++) {
      const v = l.values[m] || 0;
      let date = `${year}-${pad(m + 1)}-${pad(lastDay(year, m))}`;
      if (date.slice(0, 7) === refDate.slice(0, 7) && date > refDate) date = refDate;
      if (date > refDate) { if (v) future++; continue; }
      const ym = date.slice(0, 7), hash = cellHash(kind, ym, k, payee);
      const c = cells.get(hash) || { hash, ym, date, value: 0, row: l.row, catKey: k, cat, payee, group, name };
      c.value += v;          // due righe uguali nel foglio = una cella sola (la somma)
      cells.set(hash, c);
    }
  }
  const txs = [], updates = [], removes = [], kept = [];
  let dups = 0;
  for (const c of cells.values()) {
    const want = Math.round(c.value * 100);
    const amount = Math.abs(want), tk = want < 0 ? other : kind;     // un importo negativo è il contrario (es. un rimborso)
    let mine = state.transactions.filter(t => t.importHash === c.hash);
    // importati prima delle impronte: stesso mese, categoria e descrizione
    if (!mine.length && c.cat) mine = state.transactions.filter(t => !t.importHash && t.category === c.cat.id && t.date.slice(0, 7) === c.ym && (t.payee || '') === c.payee && (t.kind === kind || t.kind === other));
    const net = mine.reduce((a, t) => a + (t.kind === kind ? t.amount : -t.amount), 0);
    if (!mine.length) {
      if (!want) continue;
      // già nell'app (in qualunque conto: anche se l'altra volta è finito in un altro conto non va contato due volte)
      if (state.transactions.some(t => t.date === c.date && t.amount === amount && t.kind === tk && (t.payee || '') === c.payee)) { dups++; continue; }
      txs.push({ row: c.row, date: c.date, kind: tk, amount, catKey: c.catKey, catId: c.cat?.id || null, payee: c.payee, group: c.group, name: c.name, hash: c.hash });
    } else if (net === want) {
      if (want) dups++;
      // si segna l'impronta anche su quelli importati prima, per le volte dopo
      for (const t of mine) if (t.importHash !== c.hash) updates.push({ id: t.id, same: true, hash: c.hash });
    } else if (mine.some(t => t.manual)) {
      // corretto (o tolto) da D nell'app: resta il suo, il file non lo cambia
      kept.push({ ym: c.ym, payee: c.payee, mine: net, file: want });
    } else if (!want) {
      // cella svuotata nel file: si tolgono solo i movimenti nati da quella cella
      for (const t of mine) if (t.importHash === c.hash) removes.push({ id: t.id, ym: c.ym, payee: c.payee, was: t.amount });
    } else {
      updates.push({ id: mine[0].id, date: c.date, kind: tk, amount, hash: c.hash, ym: c.ym, payee: c.payee, was: net, now: want });
      for (const t of mine.slice(1)) removes.push({ id: t.id, ym: c.ym, payee: c.payee, was: t.amount, merged: true });
    }
  }
  const keys = [...new Set(read.lines.map(l => catKey(niceName(l.group), niceName(l.sub || l.group))))];
  // i nomi come scritti nel file, per ogni categoria (anche quelle che ci sono già)
  const names = Object.fromEntries(read.lines.map(l => [catKey(niceName(l.group), niceName(l.sub || l.group)), { group: niceName(l.group), name: niceName(l.sub || l.group) }]));
  const changed = updates.filter(u => !u.same);
  return { txs, updates, removes, changed, kept, newCats: [...newCats.values()], keys, names, dups, future, total: txs.reduce((a, t) => a + (t.kind === kind ? t.amount : -t.amount), 0) };
}

/** TFR e simili: conta solo il netto. Lordo = "lordo" nel nome, o la stessa voce senza "netto"
    ("TFR" accanto a "TFR netto") nella stessa sezione. */
export function isGross(a, all) {
  if (/nett/i.test(a.name)) return false;
  const words = x => normHead(x).split(/[^a-z0-9]+/).filter(w => w && !/^(nett|lord)/.test(w));
  const netRow = all.find(b => b !== a && b.section === a.section && /nett/i.test(b.name));
  return !!netRow && (/lord/i.test(a.name) || (words(a.name).length > 0 && words(a.name).every(w => words(netRow.name).includes(w))));
}

/** Controllo dopo l'import: il Net Worth dell'app mese per mese accanto a quello del foglio, e il
    perché delle differenze. `app` = { grand(date), section(nome, date), row(nome, date) } in centesimi.
    Cause, raggruppate sui mesi: una sezione che nell'app vale diverso (riga in un'altra valuta,
    ultimo valore che resta nei mesi vuoti del foglio) o un totale del foglio che non è la somma delle
    sue sezioni (una riga dell'Asset Allocation vuota o diversa dalla sezione). */
export function reconcileNetWorth(read, app, { refDate } = {}) {
  const c = v => (v == null ? null : Math.round(v * 100));
  const at = (vals, date) => c(vals?.find(v => v.date === date)?.value);
  // senza totali nel foglio (né Total delle sezioni né quello del Net Worth) non c'è niente da confrontare
  if (!read.grand && !read.sectionTotals?.length) return { months: [], ok: 0, causes: [] };
  const dates = read.dates.filter(d => !refDate || d <= refDate);
  const secOf = name => {
    const k = nameKey(name), w = normHead(name).split(' ')[0];
    return read.sectionTotals.find(t => nameKey(t.section) === k)
      || read.sectionTotals.find(t => read.accounts.some(a => a.section === t.section && nameKey(a.name) === k))
      || read.sectionTotals.find(t => w && normHead(t.section).split(/[^a-z0-9]+/).includes(w));
  };
  const causes = new Map();
  const add = (key, base, date) => { const x = causes.get(key) || { ...base, dates: [] }; x.dates.push(date); causes.set(key, x); };
  const months = [];
  for (const date of dates) {
    const secs = read.sectionTotals.map(t => ({ section: t.section, file: at(t.values, date), app: app.section(t.section, date) }));
    const sum = secs.reduce((a, x) => a + (x.file || 0), 0);
    const file = read.grand ? at(read.grand, date) ?? sum : sum;
    const mine = app.grand(date) || 0;
    if (Math.abs(mine - file) < 1 && secs.every(x => Math.abs((x.app || 0) - (x.file || 0)) < 1)) { months.push({ date, file, app: mine, diff: 0 }); continue; }
    for (const x of secs) {
      if (Math.abs((x.app || 0) - (x.file || 0)) < 1) continue;
      // il perché, riga per riga
      let why = false;
      for (const a of read.accounts.filter(y => y.section === x.section)) {
        const f = at(a.values, date), m = app.row(a, date);
        if (m == null || Math.abs((m || 0) - (f || 0)) < 1) continue;
        why = true;
        if (f == null) add(`carry|${a.row}`, { kind: 'carry', name: a.name, section: x.section, app: m }, date);
        else if (currencyFor(a.type, a.name)) add(`fx|${a.row}`, { kind: 'fx', name: a.name, section: x.section, currency: currencyFor(a.type, a.name) }, date);
        else add(`row|${a.row}`, { kind: 'row', name: a.name, section: x.section }, date);
      }
      if (!why) add(`sec|${x.section}`, { kind: 'section', section: x.section }, date);
    }
    if (read.grand && at(read.grand, date) != null && Math.abs(at(read.grand, date) - sum) >= 1) {
      // il totale del foglio non è la somma delle sue sezioni: quale riga dell'Asset Allocation non torna
      let why = false;
      for (const a of read.alloc) {
        const t = secOf(a.name);
        if (!t) continue;
        const v = at(a.values, date), s2 = at(t.values, date);
        if (Math.abs((v || 0) - (s2 || 0)) < 1) continue;
        why = true;
        add(`alloc|${a.row}`, { kind: v == null ? 'allocEmpty' : 'alloc', name: a.name, section: t.section }, date);
      }
      if (!why) add('grand', { kind: 'grand' }, date);
    }
    months.push({ date, file, app: mine, diff: mine - file });
  }
  return { months, ok: months.filter(m => !m.diff).length, causes: [...causes.values()] };
}

/** Che cosa è una riga del Net Worth fuori dalla liquidità, dalla colonna Type e dalla sezione:
    "ETF:S" → ETF azionario, "ETF:M" → ETF monetario, "ETC"/"XAU" → oro e materie prime,
    "BTC+ALT" o sezione Crypto → crypto, un simbolo come "RKLB" o sezione Stock → azione.
    '' = non è un titolo (conto, credito, bene…). */
export function positionClass(section, type, name = '') {
  const s = normHead(section), raw = String(type || '').trim(), t = raw.toLowerCase(), n = normHead(name);
  if (/^etf/.test(t)) return /:\s*m\b|monet|money|overnight|\bmm\b/.test(t + ' ' + n) ? 'etf_mm' : /:\s*b\b|bond|obblig/.test(t) ? 'etf_bd' : 'etf_eq';
  if (/^etc$|\bxau\b|\bxag\b|gold|\boro\b|silver|argento|commod/.test(t) || /materie|commod|metall/.test(s)) return 'gold';
  if (/crypto|cripto/.test(s) || /\bbtc\b|\beth\b|crypto|cripto|\balt\b/.test(t)) return 'crypto';
  if (/obblig|bond|titoli di stato|btp/.test(s + ' ' + t)) return /btp|stato|\bbot\b/.test(s + ' ' + t + ' ' + n) ? 'gov' : 'bond';
  if (/\bfond/.test(s + ' ' + t) && !/pension/.test(s + ' ' + t + ' ' + n)) return 'fund';
  if (/stock|azion|share|equity/.test(s) || (/^[A-Z]{1,5}$/.test(raw) && !/^(EUR|USD|GBP|CHF|ETF|ETC|CASH)$/.test(raw))) return 'stock';
  if (/\betf\b/.test(s)) return 'etf_eq';
  return '';
}

/** Sezione della liquidità ("Cash - Liquidity", "Conti", "Liquidità") o riga con una valuta nel tipo. */
export const isCashSection = (section, type = '') => /cash|liquid|contant|\bcont[io]\b|conti corrent|banc|deposit|risparm/.test(normHead(section)) || /^(euro|eur|dollari|dollaro|usd|sterline|gbp|franchi|chf)$/.test(normHead(type));
/** Broker con un conto per la liquidità: Trade Republic ha il conto corrente, Scalable Capital il conto deposito. */
const CASH_OF_BROKER = [[/scalable/, 'savings', 'Conto deposito'], [/trade ?republic/, 'checking', 'Conto corrente'], [/revolut|n26|bunq|wise/, 'checking', 'Conto corrente']];

/** Conti e valori di fine mese dal foglio del patrimonio. `holdings` sono anche i titoli che
    arrivano dal foglio delle operazioni dello stesso file: le loro righe diventano i valori di
    fine mese di quei titoli (non conti a parte, così non si contano due volte). */
export function planNetWorth(read, state, { includeOdd = false, holdings = state.holdings, investNames = [], refDate } = {}) {
  const inv = new Set([...investNames, ...state.accounts.filter(a => state.holdings.some(h => h.account === a.id)).map(a => a.name)].map(normHead));
  // stesso nome in più righe ("Contanti" in euro e "Contanti" in dollari): conti diversi, col tipo nel nome
  const count = new Map();
  for (const a of read.accounts) count.set(normHead(a.name), (count.get(normHead(a.name)) || 0) + 1);
  const nameOf = a => {
    const k = normHead(a.name);
    if (count.get(k) < 2) return a.name;
    const types = read.accounts.filter(x => normHead(x.name) === k).map(x => normHead(x.type));
    return a.type && new Set(types).size === types.length ? `${a.name} (${a.type})` : `${a.name} – riga ${a.row}`;
  };
  const claimed = new Set();
  const rows = read.accounts.map(a => {
    const cash = isCashSection(a.section, a.type);
    const n = normHead(a.name);
    let type = accountTypeFor(a.section, a.type, a.name), name = nameOf(a), institution = '', cls = '';
    let holding = null, invAcc = false;
    // un conto dello stesso nome già nell'app (da un import di prima) resta quello: niente doppioni
    // (anche "Contanti" di prima per "Contanti (Euro)", se la valuta è la stessa)
    const curGuess = currencyFor(a.type, a.name) || state.settings.currency;
    const findExisting = nm => state.accounts.find(x => !x.archived && !claimed.has(x.id) && !(hasHoldingsType(x.type) && state.holdings.some(hd => hd.account === x.id))
      && (nameKey(x.name) === nameKey(nm) || (x.aka || []).includes(nameKey(nm)) || (x.aka || []).includes(nameKey(a.name))
        || (name !== a.name && nameKey(x.name) === nameKey(a.name) && x.currency === curGuess)));
    if (cash) {
      if (/^etf/i.test(a.type)) {
        // un ETF tenuto come liquidità ("ETF:M", un ETF monetario): resta nella liquidità, ma è un ETF
        cls = positionClass(a.section, a.type, a.name) || 'etf_mm'; type = 'broker';
      } else {
        // nella liquidità un nome di broker è il suo conto di liquidità, non il conto dei titoli
        const br = CASH_OF_BROKER.find(([re]) => re.test(n));
        if (type !== 'cash') type = br ? br[1] : /deposit|risparm|vincol|\bcd\b/.test(n) ? 'savings' : 'checking';
        if (inv.has(n) || br) { institution = a.name; if (inv.has(n)) name = `${a.name} – ${br ? br[2] : 'Conto corrente'}`; }
      }
    } else {
      // già nel Net Worth dell'app da un import di prima: resta lì (non si sposta su un titolo)
      const prev = findExisting(name);
      holding = prev ? null : matchHolding(a.name, holdings);
      invAcc = !holding && !prev && inv.has(n);
      if (!holding) {
        cls = positionClass(a.section, a.type, a.name);
        if (cls) type = cls === 'crypto' ? 'crypto' : 'broker';
      }
    }
    const existing = holding ? null : findExisting(name) || null;
    if (existing) { type = existing.type; claimed.add(existing.id); }
    const currency = existing?.currency || currencyFor(a.type, a.name) || state.settings.currency;
    const odd = a.values.filter(v => v.odd);
    const future = a.values.filter(v => refDate && v.date > refDate).length;
    // già nell'app: il punto fermo del conto o il valore di fine mese del titolo (in centesimi)
    const liab = existing ? isLiab(existing.type) : false;
    const valOf = v => (existing ? state.valuations.filter(y => y.account === existing.id && y.date === v.date).sort((p, q) => (q.manual ? 1 : 0) - (p.manual ? 1 : 0))[0] : null);
    const nowOf = v => {
      if (existing) { const z = valOf(v); return z ? (liab ? Math.abs(z.value) : z.value) : null; }
      if (holding?.id) return state.snapshots?.[v.date.slice(0, 7)]?.nwHd?.[holding.id] ?? null;
      return null;
    };
    // scritto da D nell'app (cella, "Aggiorna i valori"): il file non lo cambia
    const manualOf = v => (existing ? !!valOf(v)?.manual : holding?.id ? !!state.snapshots?.[v.date.slice(0, 7)]?.nwMan?.[holding.id] : false);
    const usable = a.values.filter(v => (includeOdd || !v.odd) && !(refDate && v.date > refDate));
    const same = v => { const x = nowOf(v); return x != null && x === Math.round((liab ? Math.abs(v.value) : v.value) * 100); };
    const known = usable.filter(same).length;
    // un valore corretto nel file dopo l'ultimo import si aggiorna
    const changed = usable.filter(v => nowOf(v) != null && !same(v) && !manualOf(v)).map(v => ({ ...v, was: nowOf(v) / 100 }));
    const kept = usable.filter(v => nowOf(v) != null && !same(v) && manualOf(v)).map(v => ({ ...v, mine: nowOf(v) / 100 }));
    const values = usable.filter(v => nowOf(v) == null);
    const gross = isGross(a, read.accounts);
    const zero = !usable.some(v => v.value);
    const reason = invAcc ? 'è il totale del conto titoli: lo calcolo dai titoli' : gross ? 'lordo: conta solo il netto' : zero && usable.length ? 'sempre a zero' : '';
    // celle vuote dopo il primo valore (es. TFR scritto solo al 31/12): nel foglio quei mesi non lo contano
    const past = read.dates.filter(dt => !refDate || dt <= refDate);
    const firstAt = past.findIndex(dt => a.values.some(v => v.date === dt));
    const sparse = firstAt >= 0 && past.slice(firstAt).some(dt => !a.values.some(v => v.date === dt));
    return { ...a, name, institution, cls, sparse, key: String(a.row), holding, existing, type, currency, odd, future, known, changed, kept, values, reason, gross, cash, on: !reason && (values.length > 0 || changed.length > 0) };
  });
  return { rows };
}
const isLiab = t => ['card', 'mortgage', 'loan', 'debt'].includes(t);
const hasHoldingsType = t => t === 'broker' || t === 'crypto';
