/* Prezzi storici in euro scaricati da servizi pubblici (nessuna chiave), con la fonte scritta per esteso perche' si possano verificare.
   - Cripto: chiusura giornaliera (UTC). Si prova in ordine: Binance, Crypto.com Exchange, Kraken, Coinbase, CryptoCompare.
   - Oro, argento, platino, palladio (Bitpanda li conta in grammi): prezzo LBMA in euro per oncia troy diviso 31,1034768 g;
     per l'oro, in alternativa, PAX Gold (1 token = 1 oncia d'oro fino).
   - Valute (USD, GBP...): cambio di riferimento della Banca centrale europea.
   Con `check` il prezzo si confronta con una seconda fonte e la differenza si annota: chi controlla vede due fonti indipendenti.
   Se nessuna fonte risponde si lancia un errore che dice, per ognuna, perche' non ha funzionato: niente prezzi inventati.

   Dal browser molte borse rifiutano le richieste dirette (CORS). Per questo, quando la pagina e' pubblicata su Vercel, il programma chiede
   prima a /api/price (funzione nella cartella api/, stesso codice di questo file, eseguito sul server) e solo se manca prova direttamente.

   FONTI (formati dalla documentazione ufficiale; da qui non si possono raggiungere, i test usano risposte simulate):
   - Binance: GET https://data-api.binance.vision/api/v3/klines?symbol=BTCEUR&interval=1d&startTime=<ms>&endTime=<ms>&limit=1
     -> [[openTime, "open", "high", "low", "close", ...]]; simbolo inesistente: HTTP 400 {"code":-1121}
   - Crypto.com Exchange: GET https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=CRO_USD&timeframe=1D&start_ts=<ms>&end_ts=<ms>
     -> {"code":0,"result":{"data":[{"t":<ms>,"o":"..","h":"..","l":"..","c":"..","v":".."}]}}; coppia inesistente: code diverso da 0
   - Kraken: GET https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=1440&since=<s>
     -> {"error":[],"result":{"<coppia>":[[time,"open","high","low","close",...]],"last":<s>}}; errore: {"error":["EQuery:Unknown asset pair"]}
   - Coinbase (prezzo spot della piattaforma, documentato e senza chiave; accetta richieste dal browser, quindi funziona anche senza il
     servizio di Vercel): GET https://api.coinbase.com/v2/prices/BTC-EUR/spot?date=AAAA-MM-GG
     -> {"data":{"amount":"..","base":"BTC","currency":"EUR"}}; coppia inesistente: HTTP 404 {"errors":[...]}
   - Coinbase Exchange: GET https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=86400&start=<ISO>&end=<ISO>
     -> [[time, low, high, open, close, volume]]; coppia inesistente: HTTP 404
   - CryptoCompare: GET https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=EUR&limit=1&toTs=<s>
     -> {"Response":"Success","Data":{"Data":[{"time":<s>,"close":<n>}]}}
   - LBMA: GET https://prices.lbma.org.uk/json/gold_pm.json (gold_am, silver, platinum_pm/_am, palladium_pm/_am)
     -> [{"d":"AAAA-MM-GG","v":[USD, GBP, EUR]}, ...] per oncia troy; nei giorni senza asta (festivi, 31/12 pomeriggio) si usa l'ultima prima.
   - Bitpanda (listino della piattaforma, quello dei suoi estratti conto; usato per primo per cio' che e' custodito su Bitpanda):
     GET https://api.bitpanda.com/v3/currencies -> {"data":{"attributes":{"commodities":[{"attributes":{"symbol":"XAU","pid":"..."}}],"cryptocoins":[...]}}}
     GET https://api.bitpanda.com/v3/ohlc/<pid>/EUR/year (ultimo anno; "five-years" per date piu' vecchie)
     -> {"data":[{"type":"candle","attributes":{"open":"..","high":"..","low":"..","close":"..","time":{"date_iso8601":"2025-12-31T00:00:00+01:00","unix":".."}}}]}
     Percorsi presi da client open source (veeso/bitpanda-api-rs, matteoantoci/mcp-bitpanda): non e' un'API documentata da Bitpanda.
     I metalli sono quotati in euro al grammo, come nel file delle transazioni.
   - BCE: GET https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=..&endPeriod=..&format=jsondata
     (SDMX-JSON: unita' di valuta per 1 euro); in alternativa Frankfurter (stessi cambi BCE): https://api.frankfurter.app/AAAA-MM-GG?from=USD&to=EUR */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const DAY = 86400000;
  const OZ = '31.1034768';   // grammi in un'oncia troy

  // nomi diversi tra Crypto.com e le borse (solo per i giorni dal 2023 in poi, gli unici per cui servono prezzi)
  const BINANCE_ALIAS = { LUNA2: 'LUNA', LUNA: 'LUNC' };
  const KRAKEN_ALIAS = { BTC: 'XBT', DOGE: 'XDG' };
  const METALS = {
    XAU: { name: 'oro', lbma: [['gold_pm', 'LBMA Gold Price PM'], ['gold_am', 'LBMA Gold Price AM']], token: 'PAXG' },
    XAG: { name: 'argento', lbma: [['silver', 'LBMA Silver Price']] },
    XPT: { name: 'platino', lbma: [['platinum_pm', 'LBMA Platinum Price PM'], ['platinum_am', 'LBMA Platinum Price AM']] },
    XPD: { name: 'palladio', lbma: [['palladium_pm', 'LBMA Palladium Price PM'], ['palladium_am', 'LBMA Palladium Price AM']] },
  };
  const FIAT = new Set(['USD', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'BRL', 'RON', 'BGN', 'NZD', 'SGD', 'HKD', 'ZAR', 'MXN', 'INR', 'KRW', 'ILS']);

  class NoQuote extends Error {}   // il servizio funziona ma non quota questa coppia in quel giorno

  /** GET JSON con tempo massimo; gli errori hanno un motivo breve e comprensibile. */
  async function getJson(fetchImpl, url, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms || 9000) : null;
    let res;
    try { res = await fetchImpl(url, ctl ? { signal: ctl.signal } : {}); }
    catch (e) { throw new Error(e && e.name === 'AbortError' ? 'nessuna risposta (tempo scaduto)' : 'collegamento non riuscito (bloccato o assente)'); }
    finally { if (timer) clearTimeout(timer); }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, ok: res.ok, body };
  }

  const Dc = (x) => CT.D(x);
  const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? String(x) : null; };
  const sig = (x) => Dc(x).toSignificantDigits(10).toString();
  const dmy = (day) => day.split('-').reverse().join('/');
  const itn = (x, d) => Number(x).toLocaleString('it-IT', { maximumFractionDigits: d === undefined ? 6 : d });
  const minusDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') - n * DAY).toISOString().slice(0, 10);

  // ---------------------------------------------------------------- cambi BCE (euro per 1 unita' di valuta)
  const fxCache = new Map();
  async function ecbEurPer(fetchImpl, ccy, day) {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${ccy}.EUR.SP00.A?startPeriod=${minusDays(day, 10)}&endPeriod=${day}&format=jsondata`;
    const r = await getJson(fetchImpl, url);
    if (r.status === 404) throw new NoQuote('cambio non pubblicato');
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const ds = r.body.dataSets && r.body.dataSets[0];
    const series = ds && ds.series && Object.values(ds.series)[0];
    const dates = r.body.structure && r.body.structure.dimensions && r.body.structure.dimensions.observation && r.body.structure.dimensions.observation[0];
    if (!series || !dates) throw new Error('risposta non valida');
    let best = null;
    for (const [i, v] of Object.entries(series.observations || {})) {
      const d = dates.values[Number(i)] && dates.values[Number(i)].id;
      if (d && d <= day && Array.isArray(v) && Number(v[0]) > 0 && (!best || d > best.date)) best = { date: d, perEur: String(v[0]) };
    }
    if (!best) throw new NoQuote('nessun cambio nei 10 giorni prima');
    return { rate: sig(Dc(1).div(Dc(best.perEur))), date: best.date, label: `cambio BCE del ${dmy(best.date)} (${itn(best.perEur, 4)} ${ccy} per 1 €)` };
  }
  async function frankfurterEurPer(fetchImpl, ccy, day) {
    const r = await getJson(fetchImpl, `https://api.frankfurter.app/${day}?from=${ccy}&to=EUR`);
    if (!r.ok || !r.body || !r.body.rates) throw new Error(`HTTP ${r.status}`);
    const v = num(r.body.rates.EUR);
    if (!v || !r.body.date || r.body.date > day) throw new NoQuote('cambio non disponibile');
    return { rate: String(v), date: r.body.date, label: `cambio BCE del ${dmy(r.body.date)} (via Frankfurter: 1 ${ccy} = ${itn(v, 4)} €)` };
  }
  /** Euro per 1 unita' di `ccy` nel giorno `day` (o nell'ultimo giorno lavorativo prima). */
  async function eurPer(fetchImpl, ccy, day) {
    const key = `${ccy}|${day}`;
    if (fxCache.has(key)) return fxCache.get(key);
    let lastErr = null;
    for (const fn of [ecbEurPer, frankfurterEurPer]) {
      try { const r = await fn(fetchImpl, ccy, day); fxCache.set(key, r); return r; } catch (e) { lastErr = e; }
    }
    throw new Error(`cambio ${ccy}/EUR non disponibile (${lastErr ? lastErr.message : 'nessuna risposta'})`);
  }

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
    const when = `chiusura del ${dmy(day)} (UTC)`;
    let lastErr = null;
    for (const base of ['https://data-api.binance.vision', 'https://api.binance.com']) {
      try {
        if (S === 'USDT') { const e = await binanceClose(fetchImpl, base, 'EURUSDT', day); return { price: sig(Dc(1).div(Dc(e))), detail: `1 ÷ EUR/USDT ${itn(e)}, ${when}` }; }
        try { const p = await binanceClose(fetchImpl, base, `${S}EUR`, day); return { price: String(p), detail: `coppia ${S}/EUR, ${when}` }; } catch (e) { if (!(e instanceof NoQuote)) throw e; }
        const usd = await binanceClose(fetchImpl, base, `${S}USDT`, day);
        const eur = await binanceClose(fetchImpl, base, 'EURUSDT', day);
        return { price: sig(Dc(usd).div(Dc(eur))), detail: `${S}/USDT ${itn(usd)} ÷ EUR/USDT ${itn(eur)}, ${when}` };
      } catch (e) { lastErr = e; if (e instanceof NoQuote) throw e; }   // stesso risultato dall'altro indirizzo: inutile riprovare
    }
    throw lastErr || new Error('nessuna risposta');
  }

  // ---------------------------------------------------------------- Crypto.com Exchange
  async function cdcClose(fetchImpl, instrument, day) {
    const t0 = Date.parse(day + 'T00:00:00Z');
    const r = await getJson(fetchImpl, `https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=${encodeURIComponent(instrument)}&timeframe=1D&start_ts=${t0}&end_ts=${t0 + DAY - 1}`);
    if (r.body && typeof r.body.code === 'number' && r.body.code !== 0) throw new NoQuote('coppia non quotata');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = r.body && r.body.result && r.body.result.data;
    if (!Array.isArray(rows)) throw new Error('risposta non valida');
    const row = rows.find((k) => k && Number(k.t) === t0);
    if (!row) throw new NoQuote('nessuna quotazione quel giorno');
    const c = num(row.c);
    if (!c) throw new Error('prezzo non valido');
    return c;
  }
  async function viaCryptoCom(fetchImpl, sym, day) {
    const when = `chiusura del ${dmy(day)} (UTC)`;
    try { const p = await cdcClose(fetchImpl, `${sym}_EUR`, day); return { price: String(p), detail: `coppia ${sym}/EUR, ${when}` }; } catch (e) { if (!(e instanceof NoQuote)) throw e; }
    const usd = await cdcClose(fetchImpl, `${sym}_USD`, day);
    const fx = await eurPer(fetchImpl, 'USD', day);
    return { price: sig(Dc(usd).times(Dc(fx.rate))), detail: `coppia ${sym}/USD ${itn(usd)} $, ${when}, × ${fx.label}` };
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
    return { price: c, detail: `coppia ${sym}/EUR, chiusura del ${dmy(day)} (UTC)` };
  }

  // ---------------------------------------------------------------- Coinbase
  async function coinbaseClose(fetchImpl, product, day) {
    const t0 = Date.parse(day + 'T00:00:00Z') / 1000;
    const r = await getJson(fetchImpl, `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=86400&start=${day}T00:00:00Z&end=${day}T23:59:59Z`);
    if (r.status === 404) throw new NoQuote('coppia non quotata');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!Array.isArray(r.body)) throw new Error('risposta non valida');
    const row = r.body.find((k) => Array.isArray(k) && k[0] === t0);
    if (!row) throw new NoQuote('nessuna quotazione quel giorno');
    const c = num(row[4]);
    if (!c) throw new Error('prezzo non valido');
    return c;
  }
  async function viaCoinbase(fetchImpl, sym, day) {
    const when = `chiusura del ${dmy(day)} (UTC)`;
    try { const p = await coinbaseClose(fetchImpl, `${sym}-EUR`, day); return { price: String(p), detail: `coppia ${sym}/EUR, ${when}` }; } catch (e) { if (!(e instanceof NoQuote)) throw e; }
    const usd = await coinbaseClose(fetchImpl, `${sym}-USD`, day);
    const fx = await eurPer(fetchImpl, 'USD', day);
    return { price: sig(Dc(usd).times(Dc(fx.rate))), detail: `coppia ${sym}/USD ${itn(usd)} $, ${when}, × ${fx.label}` };
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
    return { price: c, detail: `media di mercato ${sym}/EUR, chiusura del ${dmy(day)} (UTC)` };
  }

  // ---------------------------------------------------------------- Bitpanda
  let bpAssets = null;
  async function bitpandaPid(fetchImpl, sym) {
    if (!bpAssets) {
      const r = await getJson(fetchImpl, 'https://api.bitpanda.com/v3/currencies', 15000);
      const a = r.body && r.body.data && r.body.data.attributes;
      if (!r.ok || !a || typeof a !== 'object') throw new Error(`HTTP ${r.status}`);
      bpAssets = a;
    }
    for (const list of Object.values(bpAssets)) {
      if (!Array.isArray(list)) continue;
      const hit = list.find((x) => x && x.attributes && String(x.attributes.symbol).toUpperCase() === sym && x.attributes.pid);
      if (hit) return hit.attributes.pid;
    }
    throw new NoQuote('asset non presente su Bitpanda');
  }
  async function viaBitpanda(fetchImpl, sym, day) {
    const pid = await bitpandaPid(fetchImpl, sym);
    const age = (Date.now() - Date.parse(day + 'T00:00:00Z')) / DAY;
    for (const period of age < 355 ? ['year', 'five-years'] : ['five-years']) {
      const r = await getJson(fetchImpl, `https://api.bitpanda.com/v3/ohlc/${encodeURIComponent(pid)}/EUR/${period}`, 15000);
      if (!r.ok || !r.body || !Array.isArray(r.body.data)) throw new Error(`HTTP ${r.status}`);
      const rows = r.body.data.map((x) => x && x.attributes).filter((a) => a && a.time && typeof a.time.date_iso8601 === 'string')
        .map((a) => ({ d: a.time.date_iso8601.slice(0, 10), t: Number(a.time.unix) * 1000 || Date.parse(a.time.date_iso8601), close: a.close }))
        .sort((a, b) => a.t - b.t);
      const i = rows.findIndex((x) => x.d === day);   // candela del giorno (data nell'ora di Vienna): la chiusura e' la fine di quel giorno
      if (i < 0) continue;
      const gap = rows[i + 1] ? rows[i + 1].t - rows[i].t : rows[i - 1] ? rows[i].t - rows[i - 1].t : Infinity;
      if (gap > 26 * 3600000) continue;               // candele settimanali: non danno il prezzo di quel giorno
      const c = num(rows[i].close);
      if (!c) throw new Error('prezzo non valido');
      return { price: c, detail: `Bitpanda, listino della piattaforma: chiusura del ${dmy(day)} (ora di Vienna)` };
    }
    throw new NoQuote('nessun prezzo giornaliero per quel giorno');
  }

  // ---------------------------------------------------------------- Coinbase (prezzo spot del giorno)
  async function viaCoinbaseSpot(fetchImpl, sym, day) {
    const r = await getJson(fetchImpl, `https://api.coinbase.com/v2/prices/${encodeURIComponent(sym)}-EUR/spot?date=${day}`);
    if (r.status === 400 || r.status === 404) throw new NoQuote('coppia non quotata');
    if (!r.ok || !r.body || !r.body.data) throw new Error(`HTTP ${r.status}`);
    const d = r.body.data;
    const c = num(d.amount);
    if (!c || (d.currency && String(d.currency).toUpperCase() !== 'EUR')) throw new NoQuote('nessuna quotazione quel giorno');
    return { price: c, detail: `Coinbase, prezzo spot ${sym}/EUR del ${dmy(day)}` };
  }

  // in ordine: prima chi accetta richieste dal browser (Binance, Coinbase), cosi' i prezzi arrivano anche senza il servizio di Vercel
  const CRYPTO = [['Binance', viaBinance], ['Coinbase', viaCoinbaseSpot], ['Crypto.com Exchange', viaCryptoCom], ['Kraken', viaKraken], ['Coinbase Exchange', viaCoinbase], ['CryptoCompare', viaCryptoCompare]];

  // ---------------------------------------------------------------- metalli preziosi (euro per grammo)
  const lbmaCache = new Map();
  async function lbmaTable(fetchImpl, file) {
    if (lbmaCache.has(file)) return lbmaCache.get(file);
    const r = await getJson(fetchImpl, `https://prices.lbma.org.uk/json/${file}.json`, 15000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!Array.isArray(r.body)) throw new Error('risposta non valida');
    lbmaCache.set(file, r.body);
    return r.body;
  }
  const viaLBMA = (sym) => async (fetchImpl, _s, day) => {
    const m = METALS[sym];
    const from = minusDays(day, 7);
    let best = null, lastErr = null;
    for (const [file, label] of m.lbma) {   // a parita' di giorno vince la prima asta dell'elenco (PM)
      let rows;
      try { rows = await lbmaTable(fetchImpl, file); } catch (e) { lastErr = e; continue; }
      for (const x of rows) {
        if (!x || typeof x.d !== 'string' || x.d > day || x.d < from || !Array.isArray(x.v)) continue;
        if (!(Number(x.v[2]) > 0) && !(Number(x.v[0]) > 0)) continue;
        if (!best || x.d > best.d) best = { d: x.d, v: x.v, label };
      }
    }
    if (!best) { if (lastErr) throw lastErr; throw new NoQuote('nessun prezzo nei 7 giorni prima'); }
    let perOz, how;
    if (Number(best.v[2]) > 0) { perOz = String(best.v[2]); how = `${itn(perOz, 2)} € per oncia`; }
    else {
      const fx = await eurPer(fetchImpl, 'USD', best.d);
      perOz = sig(Dc(String(best.v[0])).times(Dc(fx.rate)));
      how = `${itn(best.v[0], 2)} $ per oncia × ${fx.label}`;
    }
    return { price: sig(Dc(perOz).div(OZ)), detail: `${best.label} del ${dmy(best.d)}: ${how} ÷ 31,1035 grammi` };
  };
  /** Oro tramite PAX Gold: 1 token = 1 oncia troy d'oro fino custodita a Londra. */
  const viaGoldToken = (name, fn) => async (fetchImpl, _s, day) => {
    const r = await fn(fetchImpl, 'PAXG', day);
    return { price: sig(Dc(r.price).div(OZ)), detail: `PAX Gold su ${name} (1 token = 1 oncia d'oro): ${r.detail} ÷ 31,1035 grammi` };
  };
  const metalSources = (sym) => [['LBMA', viaLBMA(sym)]].concat(METALS[sym].token ? [['PAX Gold (Binance)', viaGoldToken('Binance', viaBinance)], ['PAX Gold (Kraken)', viaGoldToken('Kraken', viaKraken)], ['PAX Gold (CryptoCompare)', viaGoldToken('CryptoCompare', viaCryptoCompare)]] : []);

  // ---------------------------------------------------------------- valute
  const fiatSource = (name, fn) => async (fetchImpl, sym, day) => { const r = await fn(fetchImpl, sym, day); return { price: r.rate, detail: r.label }; };
  const FIAT_SOURCES = [['BCE', fiatSource('BCE', ecbEurPer)], ['Frankfurter (cambi BCE)', fiatSource('Frankfurter', frankfurterEurPer)]];

  const kindOf = (s) => (METALS[s] ? 'metal' : FIAT.has(s) ? 'fiat' : 'crypto');
  /** Fonti in ordine; con prefer 'bitpanda' o 'coinbase' (asset custodito li') il prezzo della piattaforma viene prima, le altre fanno da controllo. */
  const sourcesFor = (s, prefer) => {
    if (FIAT.has(s)) return FIAT_SOURCES;
    const list = METALS[s] ? metalSources(s) : CRYPTO;
    if (prefer === 'bitpanda') return [['Bitpanda', viaBitpanda]].concat(list);
    if (prefer === 'coinbase' && !METALS[s]) return [['Coinbase', viaCoinbaseSpot]].concat(list.filter(([n]) => n !== 'Coinbase'));
    return list;
  };

  /**
   * Prezzo in euro di 1 `sym` (per i metalli: di 1 grammo) nel giorno `day` (AAAA-MM-GG). Ritorna { price: stringa, source, detail }.
   * Con opts.check prova anche una seconda fonte e aggiunge check: { source, price, diffPct }. Se nessuna fonte risponde lancia un
   * Error il cui `details` elenca il motivo di ciascuna.
   */
  async function dailyEur(sym, day, fetchImpl, opts) {
    const f = fetchImpl || ((u, i) => globalThis.fetch(u, i));
    const s = String(sym).toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`${s}: simbolo o data non validi`);   // anche 1 lettera: es. S (Sonic)
    const details = [];
    let first = null, extra = 0;
    for (const [name, fn] of sourcesFor(s, opts && opts.prefer)) {
      if (first && (!opts || !opts.check || extra >= 3)) break;
      if (first) extra++;
      try {
        const r = await fn(f, s, day);
        if (!num(r.price)) { if (!first) details.push(`${name}: prezzo non valido`); continue; }
        if (!first) { first = { price: String(r.price), source: name, detail: r.detail }; continue; }
        const a = Number(first.price), b = Number(r.price);
        first.check = { source: name, price: String(r.price), detail: r.detail, diffPct: Math.round(Math.abs(b - a) / a * 10000) / 100 };
        break;
      } catch (e) { if (!first) details.push(`${name}: ${e.message}`); }
    }
    if (first) return first;
    const err = new Error('prezzo non disponibile');
    err.details = details;
    throw err;
  }

  /** Testo della fonte da mostrare e da stampare nei PDF, con l'eventuale confronto. */
  function describe(r) {
    let t = String(r.detail || '').startsWith(r.source) ? r.detail : `${r.source}: ${r.detail}`;
    if (r.check) t += r.check.diffPct <= 3 ? ` · confermato da ${r.check.source} (differenza ${itn(r.check.diffPct, 2)}%)` : ` · ATTENZIONE: ${r.check.source} dà ${itn(r.check.price)} € (differenza ${itn(r.check.diffPct, 2)}%)`;
    return t;
  }

  /**
   * Nel browser: prima il servizio della pagina pubblicata (api/price, niente blocchi CORS), poi le fonti dirette.
   * `base` e' l'indirizzo del servizio; null se la pagina non e' servita da un sito (file aperto dal disco).
   */
  let serverMissing = false;
  async function fetchEur(sym, day, opts) {
    const o = opts || {};
    const f = o.fetch || ((u, i) => globalThis.fetch(u, i));
    const base = o.base === undefined ? (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? 'api/price' : null) : o.base;
    if (base && !serverMissing) {
      let r = null;
      try { r = await getJson(f, `${base}?sym=${encodeURIComponent(sym)}&day=${encodeURIComponent(day)}${o.prefer ? `&prefer=${encodeURIComponent(o.prefer)}` : ''}`, 30000); } catch (e) { r = null; }
      if (r && r.ok && r.body && num(r.body.price)) return Object.assign(r.body, { via: 'server' });
      if (r && r.body && Array.isArray(r.body.details)) { const err = new Error(r.body.error || 'prezzo non disponibile'); err.details = r.body.details; throw err; }
      serverMissing = true;   // pagina senza servizio (GitHub Pages, file locale): si chiede direttamente alle fonti
    }
    return dailyEur(sym, day, f, { check: true, prefer: o.prefer });
  }

  /**
   * Controllo contro errori grossolani (per esempio un'altra moneta con lo stesso nome): il prezzo scaricato si confronta con un prezzo noto dai file
   * dell'utente `daysApart` giorni prima o dopo. Entro 30 giorni ammetto un cambio fino a 20 volte; poi la tolleranza cresce con la distanza,
   * perche' una cripto puo' valere anche 100 volte meno dopo qualche anno (es. GALA: 0,48 € nel 2021, 0,005 € nel 2025).
   */
  function plausible(price, ref, daysApart) {
    const p = Number(price), r = Number(ref);
    if (!(p > 0)) return false;
    if (!(r > 0)) return true;
    const lim = 20 * Math.max(1, (Number(daysApart) || 0) / 30);
    return p / r <= lim && p / r >= 1 / lim;
  }

  CT.pricefeed = { dailyEur, fetchEur, describe, plausible, kindOf, OZ, _reset: () => { fxCache.clear(); lbmaCache.clear(); bpAssets = null; serverMissing = false; },
    _sources: { viaBitpanda, viaCoinbaseSpot, viaBinance, viaCryptoCom, viaKraken, viaCoinbase, viaCryptoCompare, viaLBMA, ecbEurPer, frankfurterEurPer } };
  if (typeof module !== 'undefined') module.exports = CT.pricefeed;
})();
