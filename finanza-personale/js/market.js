/* Dati di mercato pubblici (facoltativi). Si attivano solo con il consenso nelle
   impostazioni e vanno dal dispositivo direttamente alle fonti, senza intermediari:
   - titoli, ETF, ETC, indici, valute: onvista.de, per codice ISIN (prezzi in tempo reale
     della LS Exchange, la borsa di Trade Republic, o di Tradegate/Xetra/Milano);
   - crypto: Binance (CoinGecko di riserva); cambi: BCE (Frankfurter).
   Si inviano solo codici e nomi di titoli pubblici, mai quantità, importi o dati personali.
   Le risposte sono controllate: si tengono solo numeri e testi brevi. */

import { MKT_RANGES, BINANCE_SYMS, CG_IDS } from './data/markets.js';

const OV = 'https://api.onvista.de/api/v1';
const cache = new Map();
const TTL = 5 * 60 * 1000;
const timeout = ms => (AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
const okNum = v => typeof v === 'number' && Number.isFinite(v);
const str = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : '');
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
export const isIsin = s => ISIN_RE.test(String(s || '').toUpperCase());

async function getJSON(url, ms = 10000) {
  const r = await fetch(url, { ...timeout(ms), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  if (!t || t.trimStart().startsWith('<') || t.length > 5e6) throw new Error('Risposta non valida');
  return JSON.parse(t);
}
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}

function normCurrency(price, cur) {
  if (cur === 'GBp' || cur === 'GBX') return { price: price / 100, cur: 'GBP' };
  if (cur === 'ILA') return { price: price / 100, cur: 'ILS' };
  if (cur === 'ZAc') return { price: price / 100, cur: 'ZAR' };
  return { price, cur: /^[A-Z]{3}$/.test(cur || '') ? cur : '' };   // indici: punti, senza valuta
}

/* ─── onvista ─── */

export const OV_TYPES = ['FUND', 'STOCK', 'DERIVATIVE', 'BOND', 'INDEX', 'CRYPTO', 'CURRENCY', 'PRECIOUS_METAL', 'COMMODITY'];
const TYPE_RE = /^[A-Z_]{2,20}$/;

/** Ricerca per ISIN, nome o sigla. */
export async function ovSearch(q, limit = 8) {
  const term = String(q || '').trim().slice(0, 80);
  if (term.length < 2) return [];
  return cached('s|' + term + '|' + limit, 30 * 60 * 1000, async () => {
    const d = await getJSON(`${OV}/instruments/query?searchValue=${encodeURIComponent(term)}&limit=${limit}`);
    return (Array.isArray(d?.list) ? d.list : [])
      .filter(x => x && OV_TYPES.includes(x.entityType))
      .map(x => ({
        type: x.entityType, sub: str(x.entitySubType, 30), name: str(x.name), isin: isIsin(x.isin) ? x.isin : '',
        symbol: str(x.symbol, 12), display: str(x.displayType, 40), ev: /^\d{1,15}$/.test(String(x.entityValue)) ? String(x.entityValue) : '',
      }))
      .filter(x => x.isin || x.ev);
  });
}

/** Tutte le quotazioni di uno strumento (una per borsa e valuta). */
export async function ovSnapshot(type, idOrIsin) {
  if (!TYPE_RE.test(type)) throw new Error('Tipo non valido');
  const key = isIsin(idOrIsin) ? 'ISIN:' + idOrIsin.toUpperCase() : String(idOrIsin);
  if (!/^(ISIN:[A-Z0-9]{12}|\d{1,15})$/.test(key)) throw new Error('Codice non valido');
  return cached('q|' + type + '|' + key, 60 * 1000, async () => {
    const d = await getJSON(`${OV}/instruments/${type}/${key}/snapshot`);
    const raw = [d?.quote, ...(Array.isArray(d?.quoteList?.list) ? d.quoteList.list : [])].filter(Boolean);
    const quotes = raw.map(q => {
      const { price, cur } = normCurrency(q.last, str(q.isoCurrency, 4));
      const prev = okNum(q.previousLast) ? normCurrency(q.previousLast, str(q.isoCurrency, 4)).price : null;
      return { ex: str(q.market?.codeExchange, 8), venue: str(q.market?.name, 40), cur, last: price, prev, at: Date.parse(q.datetimeLast) || 0, idn: okNum(q.market?.idNotation) ? q.market.idNotation : null };
    }).filter(q => okNum(q.last) && q.last > 0);
    if (!quotes.length) throw new Error('Prezzo non disponibile');
    const ins = d?.instrument || {};
    return { type, ev: /^\d{1,15}$/.test(String(ins.entityValue)) ? String(ins.entityValue) : '', name: str(ins.name), isin: isIsin(ins.isin) ? ins.isin : '', quotes };
  });
}

// borse preferite: LS Exchange (Trade Republic), Tradegate, Xetra, gettex, Milano, Amsterdam…
const VENUES = ['LSX', 'GAT', 'GER', 'TRO', 'MIL', 'AMS', 'PAR', 'STU', 'FRA', 'QUO', 'MUN', 'DUS', 'HAM'];

/** La quotazione giusta: nella valuta del titolo se c'è, dalla borsa preferita, recente. */
export function pickQuote(quotes, currency, now = Date.now()) {
  if (!quotes?.length) return null;
  const newest = Math.max(...quotes.map(q => q.at));
  const fresh = quotes.filter(q => q.at >= newest - 7 * 864e5);        // niente borse ferme da giorni
  const same = currency ? fresh.filter(q => q.cur === currency) : [];
  const pool = same.length ? same : [fresh[0] || quotes[0]];
  const rank = q => { const i = VENUES.indexOf(q.ex); return i < 0 ? 99 : i; };
  void now;
  return [...pool].sort((a, b) => rank(a) - rank(b) || b.at - a.at)[0];
}

const OV_RANGE = d => (d <= 31 ? 'M1' : d <= 92 ? 'M3' : d <= 186 ? 'M6' : d <= 370 ? 'Y1' : d <= 1830 ? 'Y5' : 'MAX');

/** Chiusure giornaliere (dalla borsa scelta). */
export async function ovHistory(type, ev, idn, rangeKey = '1M') {
  if (!TYPE_RE.test(type) || !/^\d{1,15}$/.test(ev) || !okNum(idn)) throw new Error('Storico non disponibile');
  const cfg = MKT_RANGES[rangeKey] || MKT_RANGES['1M'];
  const now = new Date();
  const days = rangeKey === 'YTD' ? Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 864e5) + 1 : Math.max(7, cfg.days || 35);
  const start = new Date(now - days * 864e5).toISOString().slice(0, 10);
  return cached(`h|${type}|${ev}|${idn}|${start}`, 30 * 60 * 1000, async () => {
    const d = await getJSON(`${OV}/instruments/${type}/${ev}/eod_history?idNotation=${idn}&range=${OV_RANGE(days)}&startDate=${start}`);
    const ts = Array.isArray(d?.datetimeLast) ? d.datetimeLast : [], cl = Array.isArray(d?.last) ? d.last : [];
    const { price: k } = normCurrency(1, str(d?.isoCurrency, 4));
    const pts = [];
    for (let i = 0; i < Math.min(ts.length, cl.length); i++) if (okNum(ts[i]) && okNum(cl[i])) pts.push([ts[i], cl[i] * k]);
    return { stamps: pts.map(p => p[0]), closes: pts.map(p => p[1]) };
  });
}

/* ─── Somiglianza tra nomi (per scegliere lo strumento giusto in una ricerca) ─── */
const STOP = new Set(['ucits', 'etf', 'the', 'inc', 'plc', 'acc', 'dis', 'fund', 'shares', 'class']);
const CUR_WORDS = new Set(['usd', 'eur', 'gbp', 'chf', 'jpy']);
const words = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
export function nameScore(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  // una valuta nel nome dell'altro strumento che il titolo non ha (es. "USD High Yield" invece di "EUR High Yield")
  const aCur = [...A].filter(w => CUR_WORDS.has(w)), bCur = [...B].filter(w => CUR_WORDS.has(w) && !A.has(w));
  return common / (A.size + B.size - common) - (aCur.length ? bCur.length * 0.15 : 0);
}

/** Ricerche sempre più corte finché si trova qualcosa ("Invesco Physical Gold A" → "Invesco Physical Gold"). */
function shorterQueries(name) {
  const w = String(name || '').trim().split(/\s+/);
  const out = [w.join(' ')];
  if (w.length > 1 && w[w.length - 1].length <= 2) out.push(w.slice(0, -1).join(' '));
  const core = w.filter(x => !/^(ucits|etf|acc|dis|a|c)$/i.test(x));
  if (core.length >= 2) out.push(core.slice(0, 4).join(' '), core.slice(0, 3).join(' '), core.slice(0, 2).join(' '));
  return [...new Set(out)].filter(q => q.length >= 3);
}

// tipi di strumento da cercare per ogni tipo di titolo dell'app
const TYPES_BY_CLS = {
  etf_eq: ['FUND'], etf_bd: ['FUND'], etf_mm: ['FUND'], fund: ['FUND'], stock: ['STOCK'],
  gold: ['DERIVATIVE', 'FUND'], gov: ['BOND', 'FUND'], bond: ['BOND', 'FUND'], crypto: ['DERIVATIVE', 'FUND'],
};

/** Candidati per un titolo che non ha l'ISIN: i più simili per nome e, se si conosce il prezzo
    dell'ultima operazione, per prezzo (distingue ad accumulo e a distribuzione, valute diverse). */
export async function findCandidates({ name, symbol, price, currency, cls }) {
  const types = TYPES_BY_CLS[cls] || ['FUND', 'STOCK', 'DERIVATIVE', 'BOND'];
  const seen = new Map();
  const base = shorterQueries(name);
  const core = base[base.length - 1] || name;
  const queries = [...base, symbol && !/[.=^-]/.test(symbol) ? symbol : null, types.includes('DERIVATIVE') ? core + ' ETC' : null, types.includes('FUND') ? core + ' ETF' : null].filter(Boolean);
  for (const q of queries) {
    try { for (const c of await ovSearch(q, 8)) if (types.includes(c.type) && c.isin && !seen.has(c.isin)) seen.set(c.isin, c); } catch { /* prova la prossima */ }
    if (seen.size >= 4) break;
  }
  let list = [...seen.values()].map(c => ({ ...c, score: nameScore(name || symbol, c.name) + (symbol && c.symbol === symbol ? 0.5 : 0) })).sort((a, b) => b.score - a.score).slice(0, 6);
  if (price > 0) {
    await Promise.all(list.map(async c => {
      try {
        const sn = await ovSnapshot(c.type, c.isin);
        const q = pickQuote(sn.quotes, currency);
        if (q && (!currency || q.cur === currency)) { c.price = q.last; c.cur = q.cur; }
      } catch { /* senza prezzo */ }
      // prezzo lontano da quello pagato = probabilmente un altro strumento; senza prezzo nella valuta = poco probabile
      c.score -= c.price ? Math.min(1, Math.abs(Math.log(c.price / price))) : 0.5;
    }));
    list = list.sort((a, b) => b.score - a.score);
  }
  return list;
}

/* ─── Crypto ─── */
const BIN_RANGE = { '1G': ['5m', 288], '1S': ['1h', 168], '1M': ['1d', 31], '3M': ['1d', 92], '6M': ['1d', 183], '1A': ['1d', 366], '5A': ['1w', 261], Max: ['1M', 600] };

/** Crypto da Binance (prezzi in USDT ≈ USD). */
export async function binance(symbol, rangeKey = '1M') {
  const b = BINANCE_SYMS[symbol] || (/^[A-Z0-9]{2,10}-USD$/.test(symbol) ? symbol.replace('-USD', 'USDT') : null);
  if (!b) throw new Error('Crypto non supportata');
  let [interval, limit] = BIN_RANGE[rangeKey] || BIN_RANGE['1M'];
  if (rangeKey === 'YTD') { const n = new Date(); limit = Math.floor((n - new Date(n.getFullYear(), 0, 1)) / 864e5) + 2; interval = '1d'; }
  const url = `https://api.binance.com/api/v3/klines?symbol=${b}&interval=${interval}&limit=${limit}`;
  return cached('b|' + url, TTL, async () => {
    const data = await getJSON(url, 8000);
    if (!Array.isArray(data) || data.length < 2) throw new Error('Dati non disponibili');
    const closes = data.map(k => Number(k[4])).filter(okNum);
    const stamps = data.map(k => Math.floor(Number(k[0]) / 1000));
    const price = closes[closes.length - 1];
    return { price, currency: 'USD', closes, stamps, change: (price - closes[0]) / closes[0] * 100 };
  });
}

/** Ripiego per le crypto: CoinGecko (solo prezzo e variazione 24h). */
export async function coingecko(symbols) {
  const ids = symbols.map(s => CG_IDS[s]).filter(Boolean);
  if (!ids.length) return {};
  const data = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`, 8000);
  const out = {};
  for (const s of symbols) {
    const d = data?.[CG_IDS[s]];
    if (d && okNum(d.usd)) out[s] = { price: d.usd, currency: 'USD', closes: null, stamps: null, change: okNum(d.usd_24h_change) ? d.usd_24h_change : null };
  }
  return out;
}

export const isCrypto = s => !!BINANCE_SYMS[s] || !!CG_IDS[s] || /^[A-Z0-9]{2,10}-(USD|EUR)$/.test(s || '');

async function cryptoQuote(symbol, rangeKey) {
  try { return await binance(symbol, rangeKey); } catch (e) {
    const r = (await coingecko([symbol]))[symbol];
    if (r) return r;
    throw e;
  }
}

/* ─── Una quotazione qualsiasi ─── */

/** Tipi da cercare in base alla forma del simbolo (elenchi della pagina Mercati). */
export function typesFor(symbol = '', category = '') {
  if (/^Indici/.test(category) || symbol.startsWith('^') || /^FTSEMIB/.test(symbol)) return ['INDEX'];
  if (/^Valute/.test(category) || /=X$/.test(symbol) || symbol.startsWith('DX-')) return ['CURRENCY', 'INDEX'];
  if (/^Materie/.test(category) || /=F$/.test(symbol)) return ['PRECIOUS_METAL', 'COMMODITY', 'INDEX'];
  if (/^Azioni/.test(category)) return ['STOCK'];
  if (/^(ETF|Obblig)/.test(category)) return ['FUND', 'BOND'];
  return ['FUND', 'STOCK', 'DERIVATIVE', 'INDEX', 'BOND'];
}

/** Trova lo strumento su onvista: per ISIN se c'è, altrimenti per nome (o testo di ricerca). */
export async function resolveInstrument({ isin: isin0, type, ev, name, symbol, q, category }) {
  if (ev && /^\d{1,15}$/.test(String(ev)) && TYPE_RE.test(type || '')) return { type, id: String(ev) };
  const isin = isin0 || (isIsin(symbol) ? symbol.toUpperCase() : '');
  if (isIsin(isin) && TYPE_RE.test(type || '')) return { type, id: isin.toUpperCase() };
  if (isIsin(isin)) {
    const hit = (await ovSearch(isin, 3)).find(x => x.isin === isin.toUpperCase());
    if (hit) return { type: hit.type, id: hit.isin };
  }
  const types = typesFor(symbol, category);
  const term = q || name || symbol;
  const list = (await ovSearch(term, 10)).filter(x => types.includes(x.type));
  if (!list.length) throw new Error('Non trovato');
  const best = list.map((x, i) => ({ x, s: nameScore(term, x.name) - i * 0.01 - types.indexOf(x.type) * 0.05 })).sort((a, b) => b.s - a.s)[0].x;
  return { type: best.type, id: best.isin || best.ev };
}

/** Cambio tra due valute dalla BCE (Frankfurter), con lo storico giornaliero. "EURUSD=X" → EUR/USD. */
export async function fxQuote(symbol, rangeKey = '1M') {
  const m = /^([A-Z]{3})([A-Z]{3})=X$/.exec(symbol || '');
  if (!m) throw new Error('Cambio non valido');
  const [, from, to] = m;
  const cfg = MKT_RANGES[rangeKey] || MKT_RANGES['1M'];
  const now = new Date();
  const days = rangeKey === 'YTD' ? Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 864e5) + 1 : Math.max(10, Math.min(cfg.days || 35, 9000));
  const start = new Date(now - days * 864e5).toISOString().slice(0, 10);
  return cached(`fx|${from}|${to}|${start}`, 30 * 60 * 1000, async () => {
    const d = await getJSON(`https://api.frankfurter.dev/v1/${start}..?base=${from}&symbols=${to}`, 8000);
    const pts = Object.entries(d?.rates && typeof d.rates === 'object' ? d.rates : {})
      .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && okNum(v?.[to])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (!pts.length) throw new Error('Cambio non disponibile');
    const closes = pts.map(p => p[1][to]), stamps = pts.map(p => Math.floor(Date.parse(p[0] + 'T12:00:00Z') / 1000));
    const price = closes[closes.length - 1], first = rangeKey === '1G' && closes.length > 1 ? closes[closes.length - 2] : closes[0];
    return { price, currency: to, closes, stamps, change: first ? (price - first) / first * 100 : null, venue: 'BCE', name: `${from} / ${to}` };
  });
}

/** Prezzo, variazione e andamento. item: { symbol, name, isin, type, q, category, currency }. */
export async function quote(item, rangeKey = '1M') {
  const it = typeof item === 'string' ? { symbol: item } : item;
  if (isCrypto(it.symbol) && !it.isin) return cryptoQuote(it.symbol, rangeKey);
  if (/^[A-Z]{6}=X$/.test(it.symbol || '') && !it.isin) return fxQuote(it.symbol, rangeKey);
  const inst = await resolveInstrument(it);
  const snap = await ovSnapshot(inst.type, inst.id);
  const q = pickQuote(snap.quotes, it.currency);
  let hist = { closes: [], stamps: [] };
  try { if (snap.ev && q.idn) hist = await ovHistory(snap.type, snap.ev, q.idn, rangeKey); } catch { /* solo il prezzo */ }
  const closes = hist.closes.length ? [...hist.closes, q.last] : [];
  const stamps = hist.stamps.length ? [...hist.stamps, Math.floor((q.at || Date.now()) / 1000)] : [];
  const first = rangeKey === '1G' ? q.prev : closes[0];
  return {
    price: q.last, currency: q.cur, closes, stamps, venue: q.venue, at: q.at, type: snap.type, isin: snap.isin, name: snap.name,
    change: okNum(first) && first ? (q.last - first) / first * 100 : null,
  };
}

/** Cambi della BCE (Frankfurter): 1 EUR = x valuta. */
export async function ecbRates(base = 'EUR') {
  const urls = [`https://api.frankfurter.dev/v1/latest?base=${base}`, `https://api.frankfurter.app/latest?from=${base}`];
  let last;
  for (const u of urls) {
    try {
      const d = await getJSON(u, 8000);
      if (d && d.rates && typeof d.rates === 'object') {
        const rates = { [base]: 1 };
        for (const [k, v] of Object.entries(d.rates)) if (/^[A-Z]{3}$/.test(k) && okNum(v) && v > 0) rates[k] = v;
        return { rates, date: typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '' };
      }
    } catch (e) { last = e; }
  }
  throw last || new Error('Cambi non disponibili');
}

/** Prezzi attuali dei titoli del portafoglio, nella loro valuta.
    Titoli: per ISIN (serve l'ISIN); crypto: per simbolo (BTC-USD…). */
export async function refreshHoldings(holdings, rates) {
  const updated = [], failed = [];
  let i = 0;
  const work = async () => {
    while (i < holdings.length) {
      const hd = holdings[i++];
      try {
        const crypto = hd.cls === 'crypto' && isCrypto(hd.symbol) && !hd.isin;
        if (!crypto && !isIsin(hd.isin)) { failed.push({ id: hd.id, name: hd.name, symbol: hd.symbol, reason: 'isin' }); continue; }
        const q = await quote(crypto ? { symbol: hd.symbol } : { isin: hd.isin, type: hd.ovType, currency: hd.currency }, '1S');
        let p = q.price;
        if (q.currency && q.currency !== hd.currency) {
          const rf = rates[q.currency], rt = rates[hd.currency];
          if (!rf || !rt) throw new Error('Cambio mancante ' + q.currency);
          p = p / rf * rt;
        }
        updated.push({ id: hd.id, price: p, ovType: crypto ? '' : q.type, src: q.venue || (crypto ? 'Binance' : '') });
      } catch { failed.push({ id: hd.id, name: hd.name, symbol: hd.symbol, reason: 'net' }); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));
  return { updated, failed };
}
