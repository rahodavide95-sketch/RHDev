/* Importazione degli investimenti da un foglio (Excel o CSV) con una riga per operazione:
   riconosce le colonne, capisce acquisti, vendite (anche con quote negative), cedole, costi e
   righe di imposte (imposta di bollo), e prepara cosa aggiungere ai dati senza ancora toccarli.
   Nulla viene indovinato in silenzio: le righe non capite vengono elencate col loro numero e la
   colonna "Totale" del file, se c'è, viene confrontata al centesimo con quanto importato. */

import { parseDateFlexible, isISODate } from './dates.js';
import { ASSET_CLASSES } from './model.js';
import { excelDate } from './xlsx.js';
import { CURRENCIES } from './money.js';
import { SEARCH_DB } from '../data/markets.js';

/** Intestazione semplificata: minuscole, senza accenti, parentesi e simboli. */
export const normHead = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)/g, ' ').replace(/[€$%:.*#_'’`]/g, ' ').replace(/\s+/g, ' ').trim();

export const FIELDS = [
  { key: 'date', label: 'Data', re: /^(data|date|giorno)( (di )?(acquisto|operazione|op|esecuzione|eseguito|valuta|trade|contabile))?$|^trade date$/ },
  { key: 'op', label: 'Operazione', re: /^(operazione|tipo operazione|tipo movimento|movimento|segno|side|transaction|transaction type|acquisto\/vendita|a\/v|buy\/sell|causale)$/ },
  { key: 'asset', label: 'Tipo di titolo', re: /^(asset|tipo|tipologia|tipo (titolo|strumento|asset)|asset class|asset type|classe|strumento finanziario)$/ },
  { key: 'name', label: 'Titolo', re: /^(info|titolo|nome|nome titolo|strumento|prodotto|descrizione|security|name|etf|fondo|asset name|instrument|coin|coins|moneta|crypto|cripto|criptovaluta|token)$/ },
  { key: 'isin', label: 'ISIN', re: /^(isin|codice isin|isin code)$/ },
  { key: 'symbol', label: 'Simbolo', re: /^(simbolo|ticker|symbol)$/ },
  { key: 'group', label: 'Categoria', re: /^(categoria|category|gruppo|settore|tema)$/ },
  { key: 'qty', label: 'Quantità', re: /^(quote|quota|quantita|qty|qta|q ta|numero quote|n quote|nr quote|pezzi|shares|units|quantity)$/ },
  { key: 'price', label: 'Prezzo', re: /^(costo quota|prezzo|prezzo (unitario|di acquisto|acquisto|eseguito|di esecuzione|medio)|price|costo unitario|prezzo quota|valore quota|valore|valore unitario|valore coin|cambio)$/ },
  { key: 'amount', label: 'Importo', re: /^(importo|controvalore|amount|investito|ammontare|importo lordo|lordo)$/ },
  { key: 'fee', label: 'Commissioni', re: /^(fee|fees|commissioni|commissione|costi|costo|spese|commission)$/ },
  { key: 'ter', label: 'TER', re: /^(ter|ongoing charges|spese correnti)$/ },
  { key: 'tax', label: 'Imposta', re: /^(imposta|imposte|tasse|tassa|tax|taxes|ritenuta|ritenute|capital gain|imposta capital gain)$/ },
  { key: 'total', label: 'Totale', re: /^(totale|total|importo totale|netto|importo netto|totale operazione)$/ },
  { key: 'broker', label: 'Broker / conto', re: /^(broker|conto|intermediario|piattaforma|banca|account|deposito|dossier)$/ },
  { key: 'currency', label: 'Valuta', re: /^(valuta|currency|divisa)$/ },
  { key: 'note', label: 'Note', re: /^(note|nota|notes|commento|commenti)$/ },
];

/** Riga d'intestazione e colonne riconosciute (la prima colonna da sinistra che corrisponde). */
export function findHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const map = {};
    (rows[i] || []).forEach((cell, j) => {
      if (typeof cell !== 'string') return;
      const n = normHead(cell);
      for (const f of FIELDS) if (map[f.key] == null && f.re.test(n)) { map[f.key] = j; break; }
    });
    const ok = map.date != null && (map.qty != null || map.amount != null || map.total != null);
    const score = Object.keys(map).length;
    // un foglio di crypto: la colonna del nome si chiama "coin", "crypto", "token"…
    const crypto = map.name != null && /^(coins?|crypto|cripto|criptovaluta|token|moneta)$/.test(normHead(rows[i][map.name]));
    if (ok && (!best || score > best.score)) best = { index: i, map, score, crypto };
  }
  return best;
}

/** Numero da una cella: già numero (Excel) o testo come "€ 3.000,14", "-21,08", "€ -" (vuoto). */
export function cellNumber(v, { money = false } = {}) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[€$£]|\b(EUR|USD|GBP|CHF)\b/gi, '').replace(/[\s '%]/g, '').replace(/[−–]/g, '-');
  if (s === '' || /^-+$/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s)) return null;
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (dots && commas) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (commas === 1) s = s.replace(',', '.');
  else if (commas > 1) s = s.replace(/,/g, '');
  else if (dots > 1) s = s.replace(/\./g, '');
  else if (dots === 1 && money && /^[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace('.', '');   // 1.500 € = millecinquecento
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function cellDate(v, date1904) {
  if (typeof v === 'number') return excelDate(v, date1904);
  if (typeof v !== 'string') return null;
  const d = parseDateFlexible(v.trim());
  return d && isISODate(d) ? d : null;
}

/** TER: "0,20%" → 0,2; da Excel una cella in percentuale vale 0,002 → 0,2. */
function cellTer(v) {
  const n = cellNumber(v);
  if (n == null || n < 0) return null;
  const pct = typeof v === 'number' && n < 0.03 ? n * 100 : n;
  return Math.min(10, Math.round(pct * 10000) / 10000);
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const CRYPTO_NAMES = new Map();
for (const x of SEARCH_DB) if (x.t === 'Crypto') {
  CRYPTO_NAMES.set(normHead(x.n), x.s);
  for (const part of x.n.split(/[/()]/)) if (part.trim()) CRYPTO_NAMES.set(normHead(part), x.s);
}
/** Simbolo della crypto per i prezzi ("BTC-USD") da "BTC", "btc", "Bitcoin", "BTC/EUR", "BTC-EUR"… */
export function cryptoSymbol(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const byName = CRYPTO_NAMES.get(normHead(t));
  if (byName) return byName;
  const u = t.toUpperCase().replace(/\s+/g, '');
  const pair = /^([A-Z0-9]{2,10})[/-]?(EUR|USD|USDT|USDC)$/.exec(u);
  if (pair && pair[1] !== 'USD' && pair[1] !== 'EUR') return pair[1] + '-USD';
  return /^[A-Z0-9]{2,10}$/.test(u) && t.length <= 6 ? u + '-USD' : '';
}

/** Tipo di titolo dalle sigle dei fogli più diffusi (ETF-A, ETC, STOCK…) o dai nomi dell'app. */
export function assetClass(text, name = '') {
  const t = normHead(text);
  for (const [k, c] of Object.entries(ASSET_CLASSES)) if (t && t === normHead(c.label)) return k;
  if (/^etf ?-? ?a\b|etf azion|equity/.test(t)) return 'etf_eq';
  if (/^etf ?-? ?o\b|etf obblig|bond etf/.test(t)) return 'etf_bd';
  if (/^etf ?-? ?m\b|monetar|money market|liquidit/.test(t)) return 'etf_mm';
  if (/^etc\b|^etn\b|oro|gold|commodit|materie/.test(t)) return 'gold';
  if (/crypto|cripto|bitcoin|btc/.test(t)) return 'crypto';
  if (/btp|bot\b|stato|govern|treasury/.test(t)) return 'gov';
  if (/obblig|bond/.test(t)) return 'bond';
  if (/fondo|fund|sicav/.test(t)) return 'fund';
  if (/^(stock|azion[ei]|share|shares|equity stock)$/.test(t)) return 'stock';
  if (/^etf\b/.test(t)) return /bond|aggregate|treasury|govt|corporate/i.test(name) ? 'etf_bd' : 'etf_eq';
  return t ? 'other' : null;
}

const COST_RE = /tass|impost|bollo|^tax/;

/** Legge le righe dopo l'intestazione. Restituisce operazioni, imposte del conto, righe saltate e problemi. */
export function readOperations(rows, header, { nums, date1904 = false } = {}) {
  const m = header.map;
  const get = (r, k) => (m[k] == null ? null : r[m[k]] ?? null);
  const text = (r, k) => { const v = get(r, k); return v == null ? '' : String(v).trim(); };
  const ops = [], costs = [], skipped = [], problems = [];
  for (let i = header.index + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const row = nums ? nums[i] : i + 1;
    const qty = cellNumber(get(r, 'qty'));
    const price = cellNumber(get(r, 'price'), { money: true });
    const amount = cellNumber(get(r, 'amount'), { money: true });
    const fee = Math.abs(cellNumber(get(r, 'fee'), { money: true }) || 0);
    let tax = Math.abs(cellNumber(get(r, 'tax'), { money: true }) || 0);
    const total = cellNumber(get(r, 'total'), { money: true });
    // righe di separazione ("2026"), modelli vuoti, promemoria senza numeri: si saltano
    if (![qty, amount, total].some(v => v) && !fee && !tax) { skipped.push(row); continue; }
    const date = cellDate(get(r, 'date'), date1904);
    if (!date) { problems.push({ row, msg: 'data mancante o non valida' }); continue; }
    const asset = text(r, 'asset'), opText = normHead(text(r, 'op')), group = text(r, 'group');
    const name0 = text(r, 'name'), note = text(r, 'note'), broker = text(r, 'broker');

    // imposte del conto (imposta di bollo): non sono operazioni su un titolo
    if (COST_RE.test(normHead(asset)) || /bollo|impost|tass/.test(opText) || (!qty && /bollo/i.test(group + ' ' + name0))) {
      const v = Math.abs(tax || total || amount || fee || 0);
      if (!v) { problems.push({ row, msg: 'imposta senza importo' }); continue; }
      costs.push({ row, date, amount: v, payee: (group || (asset && !/^tasse?$/i.test(asset) ? asset : '') || 'Imposta di bollo').slice(0, 120), note: [name0, note].filter(Boolean).join(' · ').slice(0, 300), broker: broker.slice(0, 60), fileTotal: total });
      continue;
    }

    let kind = null;
    if (opText) {
      if (/vend|sell|cession|rimbors/.test(opText)) kind = 'sell';
      else if (/acq|buy|sottoscr|compr|^pac$/.test(opText)) kind = 'buy';
      else if (/divid|cedol|coupon|provent|interess/.test(opText)) kind = 'div';
      else if (/commiss|costo|fee|spes/.test(opText)) kind = 'fee';
    }
    if (!kind && qty) kind = qty < 0 ? 'sell' : 'buy';
    if (!kind && /divid|cedol|coupon/i.test(note + ' ' + name0)) kind = 'div';
    if (!kind) { problems.push({ row, msg: 'non capisco se è un acquisto, una vendita o una cedola' }); continue; }

    let isin = text(r, 'isin').toUpperCase(), name = name0;
    let symbol = text(r, 'symbol').toUpperCase();
    const isCoin = header.crypto || /crypto|cripto/i.test(asset);
    if (isCoin && !isin) {
      symbol = cryptoSymbol(symbol) || cryptoSymbol(name0) || symbol;
      // il nome per esteso, se è una crypto conosciuta ("BTC" → "Bitcoin")
      const known = SEARCH_DB.find(x => x.s === symbol && x.t === 'Crypto');
      if (known && (!name0 || name0.toUpperCase() === name0)) name = known.n.split(' (')[0];
    }
    if (!isin && ISIN_RE.test(name0.toUpperCase())) { isin = name0.toUpperCase(); name = group || isin; }
    if (!name) name = group || symbol || isin;
    if (!name) { problems.push({ row, msg: 'manca il nome del titolo' }); continue; }
    const base = { row, kind, date, note: note.slice(0, 300), broker: broker.slice(0, 60), name, isin: ISIN_RE.test(isin) ? isin : '', symbol, group, asset: asset || (isCoin ? 'crypto' : ''), ter: cellTer(get(r, 'ter')), currency: text(r, 'currency').toUpperCase(), fileTotal: total };

    if (kind === 'buy' || kind === 'sell') {
      const q = Math.abs(qty || 0);
      if (!q) { problems.push({ row, msg: 'manca la quantità' }); continue; }
      const a = Math.abs(amount || 0), pc = Math.abs(price || 0);
      // se c'è l'importo, il prezzo è quello che lo rende esatto (quote × prezzo = importo del file)
      const p = a ? a / q : pc;
      if (!p) { problems.push({ row, msg: 'mancano prezzo e importo' }); continue; }
      let f = fee;
      if (kind === 'buy' && tax) { f += tax; tax = 0; }     // imposte sull'acquisto (es. Tobin tax): sono un costo dell'acquisto
      ops.push({ ...base, qty: q, price: p, fee: f, tax, amount: 0 });
    } else {
      const v = Math.abs(amount || total || fee || 0);
      if (!v) { problems.push({ row, msg: 'manca l\'importo' }); continue; }
      ops.push({ ...base, qty: 0, price: 0, fee: 0, tax: 0, amount: v });
    }
  }
  return { ops, costs, skipped, problems };
}

/** Soldi messi nell'investimento da un'operazione (come la colonna "totale" dei fogli dei PAC). */
export const opNet = o => (o.kind === 'buy' ? o.qty * o.price + o.fee : o.kind === 'sell' ? -(o.qty * o.price) + o.fee + o.tax : o.kind === 'fee' ? o.amount : -o.amount);

/** Confronto riga per riga con la colonna "Totale" del file, in centesimi (si accettano i due
    segni: investito positivo come nei fogli dei PAC, o uscita negativa come negli estratti). */
export function checkTotals(read) {
  const c = x => Math.round(x * 100);
  const rows = [...read.ops.map(o => ({ row: o.row, file: o.fileTotal, ours: opNet(o) })), ...read.costs.map(k => ({ row: k.row, file: k.fileTotal == null ? null : Math.abs(k.fileTotal), ours: k.amount }))]
    .filter(x => x.file != null).map(x => ({ row: x.row, file: c(x.file), ours: c(x.ours) }));
  if (!rows.length) return null;
  const near = (a, b) => Math.abs(a - b) <= 1;   // al massimo un centesimo di arrotondamento
  const same = rows.filter(x => near(x.file, x.ours)).length, opposite = rows.filter(x => near(x.file, -x.ours)).length;
  const sign = opposite > same ? -1 : 1;
  const bad = rows.filter(x => !near(x.file, sign * x.ours));
  const fileSum = rows.reduce((a, x) => a + x.file * sign, 0) / 100, ourSum = rows.reduce((a, x) => a + x.ours, 0) / 100;
  return { checked: rows.length, bad, fileSum, ourSum, ok: !bad.length };
}

const keyName = s => normHead(s).replace(/[^a-z0-9]/g, '');
const holdingKey = o => o.isin || o.symbol || keyName(o.name);

/** Prepara l'importazione rispetto ai dati attuali: conti e titoli da creare o già presenti,
    operazioni già importate (stessa data, tipo, quantità e prezzo) da non ripetere. */
export function planImport(read, state, { account = null, defaultName = 'Investimenti' } = {}) {
  const invAccounts = state.accounts.filter(a => !a.archived && (a.type === 'broker' || a.type === 'crypto'));
  const accounts = new Map();
  const accFor = broker => {
    const nm = broker.trim();
    const k = nm ? keyName(nm) : '';
    if (accounts.has(k)) return accounts.get(k);
    let ex = null;
    if (nm) ex = invAccounts.find(a => keyName(a.name) === k || (a.institution && keyName(a.institution) === k));
    else if (account) ex = state.accounts.find(a => a.id === account) || null;
    const a = { key: k, name: ex?.name || nm || defaultName, existingId: ex?.id || null, currency: ex?.currency || state.settings.currency, first: null };
    accounts.set(k, a);
    return a;
  };
  const holdings = new Map();
  let dups = 0;
  for (const o of read.ops) {
    const acc = accFor(o.broker);
    const hk = acc.key + '|' + holdingKey(o);
    let hd = holdings.get(hk);
    if (!hd) {
      const ex = acc.existingId ? state.holdings.find(x => x.account === acc.existingId && ((o.isin && x.isin === o.isin) || (o.symbol && x.symbol === o.symbol) || keyName(x.name) === keyName(o.name))) : null;
      hd = { key: hk, acc, existing: ex || null, name: ex?.name || o.name.slice(0, 80), isin: ex?.isin || o.isin, symbol: ex?.symbol || o.symbol.slice(0, 24), cls: ex?.cls || null, group: ex?.group || '', ter: ex?.ter || 0, currency: ex?.currency || (CURRENCIES[o.currency] ? o.currency : acc.currency), ops: [] };
      holdings.set(hk, hd);
    }
    if (!hd.cls) hd.cls = assetClass(o.asset, o.name);
    if (!hd.group && o.group) hd.group = o.group.slice(0, 40);
    if (o.ter && !hd.existing?.ter) hd.ter = o.ter;
    const dup = hd.existing?.ops.some(x => x.date === o.date && x.type === o.kind && Math.abs(x.qty - o.qty) < 1e-6 && Math.abs(x.price - o.price) < 1e-6 * Math.max(1, o.price) && Math.abs(x.amount - o.amount) < 0.005);
    if (dup) { dups++; continue; }
    hd.ops.push(o);
    if (!acc.first || o.date < acc.first) acc.first = o.date;
  }
  const costs = [];
  for (const c of read.costs) {
    const acc = accFor(c.broker);
    const dup = acc.existingId && state.transactions.some(t => t.account === acc.existingId && t.kind === 'expense' && t.date === c.date && t.amount === Math.round(c.amount * 100));
    if (dup) { dups++; continue; }
    costs.push({ ...c, acc });
    if (!acc.first || c.date < acc.first) acc.first = c.date;
  }
  for (const hd of holdings.values()) if (!hd.cls) hd.cls = 'other';
  const list = [...holdings.values()].filter(x => x.ops.length);
  const usedAcc = [...accounts.values()].filter(a => list.some(x => x.acc === a) || costs.some(c => c.acc === a));
  // un conto nuovo con sole crypto è un wallet crypto, altrimenti un conto investimenti
  for (const a of usedAcc) a.type = list.filter(x => x.acc === a).every(x => x.cls === 'crypto') && list.some(x => x.acc === a) ? 'crypto' : 'broker';
  return {
    accounts: usedAcc, holdings: list, costs, dups,
    count: list.reduce((a, x) => a + x.ops.length, 0) + costs.length,
    byKind: list.flatMap(x => x.ops).reduce((a, o) => ({ ...a, [o.kind]: (a[o.kind] || 0) + 1 }), {}),
  };
}
