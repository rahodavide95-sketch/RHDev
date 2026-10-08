/* Prezzi storici in euro scaricati da servizi pubblici (nessuna chiave): chiusura giornaliera (UTC) di una cripto.
   Si prova in ordine: Binance (dati pubblici), Kraken, CryptoCompare. Il primo che risponde con un prezzo valido vince.
   Se nessuno risponde si lancia un errore che dice, per ogni servizio, perche' non ha funzionato: niente prezzi inventati.

   FONTI (formati verificati sulla documentazione ufficiale; la raggiungibilita' dal browser, cioe' CORS, NON e' verificabile da qui):
   - Binance: https://github.com/binance/binance-spot-api-docs rest-api.md "Kline/Candlestick data" e faqs/market_data_only.md
     GET https://data-api.binance.vision/api/v3/klines?symbol=BTCEUR&interval=1d&startTime=<ms>&endTime=<ms>&limit=1
     -> [[openTime, "open", "high", "low", "close", "volume", closeTime, ...]]; simbolo inesistente: HTTP 400 {"code":-1121,"msg":"Invalid symbol."}
   - Kraken: GET https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=1440&since=<s>
     -> {"error":[],"result":{"<coppia>":[[time,"open","high","low","close","vwap","volume",count],...],"last":<s>}}; errore: {"error":["EQuery:Unknown asset pair"]}
   - CryptoCompare: GET https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=EUR&limit=1&toTs=<s>
     -> {"Response":"Success","Data":{"Data":[{"time":<s>,"close":<n>,...}]}}; errore: {"Response":"Error","Message":"..."} */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const DAY = 86400000;

  // nomi diversi tra Crypto.com e le borse (solo per i giorni dal 2023 in poi, gli unici per cui servono prezzi)
  const BINANCE_ALIAS = { LUNA2: 'LUNA', LUNA: 'LUNC' };
  const KRAKEN_ALIAS = { BTC: 'XBT', DOGE: 'XDG' };

  class NoQuote extends Error {}   // il servizio funziona ma non quota questa coppia in quel giorno

  /** GET JSON con tempo massimo; gli errori hanno un motivo breve e comprensibile. */
  async function getJson(fetchImpl, url, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms || 10000) : null;
    let res;
    try { res = await fetchImpl(url, ctl ? { signal: ctl.signal } : {}); }
    catch (e) { throw new Error(e && e.name === 'AbortError' ? 'nessuna risposta (tempo scaduto)' : 'collegamento bloccato dal browser o assente'); }
    finally { if (timer) clearTimeout(timer); }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, ok: res.ok, body };
  }

  const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? String(x) : null; };

  // ---------------------------------------------------------------- Binance
  async function binanceClose(fetchImpl, base, symbol, day) {
    const t0 = Date.parse(day + 'T00:00:00Z');
    const url = `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&startTime=${t0}&endTime=${t0 + DAY - 1}&limit=1`;
    const r = await getJson(fetchImpl, url);
    if (r.status === 400 && r.body && r.body.code === -1121) throw new NoQuote('coppia non quotata');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!Array.isArray(r.body)) throw new Error('risposta non valida');
    const row = r.body.find((k) => Array.isArray(k) && k[0] === t0);
    if (!row) throw new NoQuote('nessuna quotazione quel giorno');
    const c = num(row[4]);
    if (!c) throw new Error('prezzo non valido');
    return c;
  }
  async function viaBinance(fetchImpl, sym, day) {
    const S = BINANCE_ALIAS[sym] || sym;
    const D = CT.D;
    let lastErr = null;
    for (const base of ['https://data-api.binance.vision', 'https://api.binance.com']) {
      try {
        if (S === 'USDT') return D(1).div(D(await binanceClose(fetchImpl, base, 'EURUSDT', day))).toSignificantDigits(10).toString();
        try { return String(await binanceClose(fetchImpl, base, `${S}EUR`, day)); } catch (e) { if (!(e instanceof NoQuote)) throw e; }
        const usd = await binanceClose(fetchImpl, base, `${S}USDT`, day);
        const eur = await binanceClose(fetchImpl, base, 'EURUSDT', day);
        return D(usd).div(D(eur)).toSignificantDigits(10).toString();
      } catch (e) { lastErr = e; if (e instanceof NoQuote) throw e; }   // stesso risultato dall'altro indirizzo: inutile riprovare
    }
    throw lastErr || new Error('nessuna risposta');
  }

  // ---------------------------------------------------------------- Kraken
  async function viaKraken(fetchImpl, sym, day) {
    const t0 = Math.floor(Date.parse(day + 'T00:00:00Z') / 1000);
    const pair = `${KRAKEN_ALIAS[sym] || sym}EUR`;
    const r = await getJson(fetchImpl, `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=1440&since=${t0 - 1}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = r.body;
    if (!b || typeof b !== 'object') throw new Error('risposta non valida');
    if (Array.isArray(b.error) && b.error.length) throw new NoQuote(String(b.error[0]));
    const key = b.result && Object.keys(b.result).find((k) => k !== 'last');
    const row = key && b.result[key].find((k) => Array.isArray(k) && k[0] === t0);
    if (!row) throw new NoQuote('nessuna quotazione quel giorno');
    const c = num(row[4]);
    if (!c) throw new Error('prezzo non valido');
    return c;
  }

  // ---------------------------------------------------------------- CryptoCompare
  async function viaCryptoCompare(fetchImpl, sym, day) {
    const to = Math.floor(Date.parse(day + 'T23:59:59Z') / 1000);
    const r = await getJson(fetchImpl, `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${encodeURIComponent(sym)}&tsym=EUR&limit=1&toTs=${to}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = r.body;
    if (!b || typeof b !== 'object') throw new Error('risposta non valida');
    if (b.Response === 'Error') throw new Error(String(b.Message || 'errore').slice(0, 60));
    const rows = b.Data && b.Data.Data;
    const row = Array.isArray(rows) && rows.find((x) => x && new Date(x.time * 1000).toISOString().slice(0, 10) === day);
    const c = row && num(row.close);
    if (!c) throw new NoQuote('nessuna quotazione quel giorno');
    return c;
  }

  const SOURCES = [['Binance', viaBinance], ['Kraken', viaKraken], ['CryptoCompare', viaCryptoCompare]];

  /**
   * Prezzo in euro di 1 `sym` alla chiusura (UTC) del giorno `day` (AAAA-MM-GG). Ritorna { price: stringa, source }.
   * Se nessuna fonte risponde lancia un Error il cui `details` elenca il motivo di ciascuna.
   */
  async function dailyEur(sym, day, fetchImpl) {
    const f = fetchImpl || ((u, i) => globalThis.fetch(u, i));
    const s = String(sym).toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('simbolo o data non validi');
    const details = [];
    for (const [name, fn] of SOURCES) {
      try {
        const p = await fn(f, s, day);
        if (num(p)) return { price: String(p), source: name };
        details.push(`${name}: prezzo non valido`);
      } catch (e) { details.push(`${name}: ${e.message}`); }
    }
    const err = new Error('prezzo non disponibile');
    err.details = details;
    throw err;
  }

  CT.pricefeed = { dailyEur, _sources: { viaBinance, viaKraken, viaCryptoCompare } };
  if (typeof module !== 'undefined') module.exports = CT.pricefeed;
})();
