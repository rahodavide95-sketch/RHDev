/* Dati di mercato pubblici (facoltativi). Si attivano solo con il consenso nelle
   impostazioni. Si inviano solo simboli di titoli pubblici (es. "VWCE.DE"), mai
   quantità, importi o dati personali. Le risposte sono controllate: solo numeri. */

import { MKT_RANGES, BINANCE_SYMS, CG_IDS } from './data/markets.js';

const cache = new Map();
const TTL = 5 * 60 * 1000;
const timeout = ms => (AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
const okNum = v => typeof v === 'number' && Number.isFinite(v);

async function getJSON(url, ms = 10000) {
  const r = await fetch(url, { ...timeout(ms), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  if (!t || t.trimStart().startsWith('<') || t.length > 5e6) throw new Error('Risposta non valida');
  return JSON.parse(t);
}

/** Prova la richiesta diretta e, se permesso, i proxy pubblici (vedono solo il simbolo richiesto). */
async function viaSources(url, useProxies) {
  const tries = [url];
  if (useProxies) tries.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://corsproxy.io/?url=${encodeURIComponent(url)}`);
  let last;
  for (const u of tries) {
    try { return await getJSON(u); } catch (e) { last = e; }
  }
  throw last || new Error('Non raggiungibile');
}

function normCurrency(price, cur) {
  if (cur === 'GBp' || cur === 'GBX') return { price: price / 100, cur: 'GBP' };
  if (cur === 'ILA') return { price: price / 100, cur: 'ILS' };
  if (cur === 'ZAc') return { price: price / 100, cur: 'ZAR' };
  return { price, cur: cur || 'USD' };
}

/** Grafico e prezzo da Yahoo Finance. */
export async function yahoo(symbol, rangeKey = '1M', { proxies = false, from, to } = {}) {
  const cfg = MKT_RANGES[rangeKey] || MKT_RANGES['1M'];
  const s = encodeURIComponent(symbol);
  const url = from && to
    ? `https://query1.finance.yahoo.com/v8/finance/chart/${s}?period1=${from}&period2=${to}&interval=1d`
    : `https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=${cfg.range}&interval=${cfg.interval}`;
  const key = 'y|' + url + '|' + proxies;
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.v;
  const data = await viaSources(url, proxies);
  const res = data?.chart?.result?.[0];
  if (!res) throw new Error('Simbolo non trovato');
  const ts = Array.isArray(res.timestamp) ? res.timestamp : [];
  const cl = res.indicators?.quote?.[0]?.close || [];
  const pts = [];
  for (let i = 0; i < cl.length; i++) if (okNum(cl[i]) && okNum(ts[i])) pts.push([ts[i], cl[i]]);
  const meta = res.meta || {};
  const rawPrice = okNum(meta.regularMarketPrice) ? meta.regularMarketPrice : pts.length ? pts[pts.length - 1][1] : null;
  if (!okNum(rawPrice)) throw new Error('Prezzo non disponibile');
  const { price, cur } = normCurrency(rawPrice, typeof meta.currency === 'string' ? meta.currency : 'USD');
  const scale = price / rawPrice;
  const closes = pts.map(p => p[1] * scale);
  const first = closes[0];
  const v = { price, currency: cur, closes, stamps: pts.map(p => p[0]), change: okNum(first) && first ? (price - first) / first * 100 : null, name: typeof meta.longName === 'string' ? meta.longName.slice(0, 80) : (typeof meta.shortName === 'string' ? meta.shortName.slice(0, 80) : '') };
  cache.set(key, { at: Date.now(), v });
  return v;
}

const BIN_RANGE = { '1G': ['5m', 288], '1S': ['1h', 168], '1M': ['1d', 31], '3M': ['1d', 92], '6M': ['1d', 183], '1A': ['1d', 366], '5A': ['1w', 261], Max: ['1M', 600] };

/** Crypto da Binance (prezzi in USDT ≈ USD). */
export async function binance(symbol, rangeKey = '1M') {
  const b = BINANCE_SYMS[symbol] || (/^[A-Z0-9]{2,10}-USD$/.test(symbol) ? symbol.replace('-USD', 'USDT') : null);
  if (!b) throw new Error('Crypto non supportata');
  let [interval, limit] = BIN_RANGE[rangeKey] || BIN_RANGE['1M'];
  if (rangeKey === 'YTD') { const n = new Date(); limit = Math.floor((n - new Date(n.getFullYear(), 0, 1)) / 864e5) + 2; interval = '1d'; }
  const url = `https://api.binance.com/api/v3/klines?symbol=${b}&interval=${interval}&limit=${limit}`;
  const key = 'b|' + url;
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.v;
  const data = await getJSON(url, 8000);
  if (!Array.isArray(data) || data.length < 2) throw new Error('Dati non disponibili');
  const closes = data.map(k => Number(k[4])).filter(okNum);
  const stamps = data.map(k => Math.floor(Number(k[0]) / 1000));
  const price = closes[closes.length - 1];
  const v = { price, currency: 'USD', closes, stamps, change: (price - closes[0]) / closes[0] * 100 };
  cache.set(key, { at: Date.now(), v });
  return v;
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

export const isCrypto = s => !!BINANCE_SYMS[s] || !!CG_IDS[s] || /^[A-Z0-9]{2,10}-(USD|EUR)$/.test(s);

/** Un simbolo qualsiasi: crypto prima da Binance, il resto da Yahoo. */
export async function quote(symbol, rangeKey, opts = {}) {
  if (isCrypto(symbol) && !symbol.endsWith('-EUR')) {
    try { return await binance(symbol, rangeKey); } catch { /* prova Yahoo */ }
  }
  return yahoo(symbol, rangeKey, opts);
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

/** Prezzi attuali dei titoli del portafoglio, nella loro valuta. */
export async function refreshHoldings(holdings, rates, { proxies = false } = {}) {
  const out = [], failed = [];
  await Promise.all(holdings.map(async hd => {
    try {
      const q = await quote(hd.symbol, '1S', { proxies });
      let p = q.price;
      if (q.currency !== hd.currency) {
        const rf = rates[q.currency], rt = rates[hd.currency];
        if (!rf || !rt) throw new Error('Cambio mancante ' + q.currency);
        p = p / rf * rt;
      }
      out.push({ id: hd.id, price: p });
    } catch { failed.push(hd); }
  }));
  return { updated: out, failed };
}
