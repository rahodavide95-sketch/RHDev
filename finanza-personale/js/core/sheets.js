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

export function readMonths(rows, info, { nums } = {}) {
  const { cols, map } = info;
  const lines = [], skipped = [], checks = [];
  let lastGroup = '';
  const raw = [];
  for (let i = info.index + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const row = nums ? nums[i] : i + 1;
    let group = text(r[map.group]);
    const sub = map.sub != null ? text(r[map.sub]) : '';
    const note = map.note != null ? text(r[map.note]) : '';
    if (TOTAL_RE.test(group)) continue;                          // riga dei totali in fondo
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
  return { lines, skipped, checks };
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
export function currencyFor(type) {
  const t = normHead(type);
  if (/dollar|usd|\$/.test(t)) return 'USD';
  if (/sterlin|gbp|£/.test(t)) return 'GBP';
  if (/franch|chf/.test(t)) return 'CHF';
  return null;
}

export function readNetWorth(rows, info, { nums } = {}) {
  const { dates, typeCol, nameCol } = info;
  const accounts = [], totals = [], skipped = [];
  let section = '', skipSection = false;
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
    if (skipSection) continue;
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
  return { accounts, checks, skipped, dates: dates.map(d => d.date) };
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
export function planMonths(read, state, { year, kind, refDate }) {
  const cats = state.categories.filter(c => c.kind === kind);
  // stessa categoria solo se coincidono categoria e sottocategoria: "MUSICA › ROYALTIES" non è "Lavoro › Royalties"
  const find = (g, n) => cats.find(c => catKey(c.group, c.name) === catKey(g, n));
  const newCats = new Map();
  const txs = [];
  let dups = 0, future = 0;
  for (const l of read.lines) {
    const group = niceName(l.group), name = niceName(l.sub || l.group);
    const cat = find(group, name);
    const k = catKey(group, name);
    if (!cat && !newCats.has(k)) newCats.set(k, { key: k, group, name });
    const payee = l.note || name;
    l.values.forEach((v, m) => {
      if (!v) return;
      let date = `${year}-${pad(m + 1)}-${pad(lastDay(year, m))}`;
      if (date.slice(0, 7) === refDate.slice(0, 7) && date > refDate) date = refDate;
      if (date > refDate) { future++; return; }
      const amount = Math.round(Math.abs(v) * 100);
      const tk = v < 0 ? (kind === 'income' ? 'expense' : 'income') : kind;     // un importo negativo è il contrario (es. un rimborso)
      // già nell'app (in qualunque conto: anche se l'altra volta è finito in un altro conto non va contato due volte)
      if (state.transactions.some(t => t.date === date && t.amount === amount && t.kind === tk && (t.payee || '') === payee)) { dups++; return; }
      txs.push({ row: l.row, date, kind: tk, amount, catKey: k, catId: cat?.id || null, payee, group, name });
    });
  }
  const keys = [...new Set(read.lines.map(l => catKey(niceName(l.group), niceName(l.sub || l.group))))];
  return { txs, newCats: [...newCats.values()], keys, dups, future, total: txs.reduce((a, t) => a + (t.kind === kind ? t.amount : -t.amount), 0) };
}

/** Conti e valori di fine mese dal foglio del patrimonio. `holdings` sono anche i titoli che
    arrivano dal foglio delle operazioni dello stesso file: le loro righe non si contano due volte. */
/** TFR e simili: conta solo il netto. Lordo = "lordo" nel nome, o la stessa voce senza "netto"
    ("TFR" accanto a "TFR netto") nella stessa sezione. */
export function isGross(a, all) {
  if (/nett/i.test(a.name)) return false;
  const words = x => normHead(x).split(/[^a-z0-9]+/).filter(w => w && !/^(nett|lord)/.test(w));
  const netRow = all.find(b => b !== a && b.section === a.section && /nett/i.test(b.name));
  return !!netRow && (/lord/i.test(a.name) || (words(a.name).length > 0 && words(a.name).every(w => words(netRow.name).includes(w))));
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
  const rows = read.accounts.map(a => {
    const cash = isCashSection(a.section, a.type);
    const n = normHead(a.name);
    let type = accountTypeFor(a.section, a.type, a.name), name = a.name, institution = '';
    let holding = null, invAcc = false;
    if (cash) {
      // nella liquidità un nome di broker è il suo conto di liquidità, non il conto dei titoli
      const br = CASH_OF_BROKER.find(([re]) => re.test(n));
      if (type !== 'cash') type = br ? br[1] : /deposit|risparm|vincol|\bcd\b/.test(n) ? 'savings' : 'checking';
      if (inv.has(n) || br) { institution = a.name; if (inv.has(n)) name = `${a.name} – ${br ? br[2] : 'Conto corrente'}`; }
    } else {
      holding = matchHolding(a.name, holdings);
      invAcc = !holding && inv.has(n);
    }
    const existing = holding ? null : state.accounts.find(x => !hasHoldingsType(x.type) && (normHead(x.name) === normHead(name) || normHead(x.name) === n)) || null;
    if (existing) type = existing.type;
    const currency = existing?.currency || currencyFor(a.type) || state.settings.currency;
    const odd = a.values.filter(v => v.odd);
    const future = a.values.filter(v => refDate && v.date > refDate).length;
    // già nell'app: il punto fermo del conto o il valore di fine mese del titolo
    const has = v => (existing && state.valuations.some(z => z.account === existing.id && z.date === v.date)) || (holding?.id && state.snapshots?.[v.date.slice(0, 7)]?.byHd?.[holding.id] != null);
    const known = a.values.filter(has).length;
    const values = a.values.filter(v => (includeOdd || !v.odd) && !(refDate && v.date > refDate)).filter(v => !has(v));
    const gross = isGross(a, read.accounts);
    const zero = values.every(v => !v.value);
    const reason = invAcc ? 'è il totale del conto titoli: lo calcolo dai titoli' : gross ? 'lordo: conta solo il netto' : zero && values.length ? 'sempre a zero' : '';
    return { ...a, name, institution, key: String(a.row), holding, existing, type, currency, odd, future, known, values, reason, gross, cash, on: !reason && values.length > 0 };
  });
  return { rows };
}
const hasHoldingsType = t => t === 'broker' || t === 'crypto';
