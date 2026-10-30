import test from 'node:test';
import assert from 'node:assert/strict';
import { ovSearch, ovSnapshot, pickQuote, quote, refreshHoldings, ecbRates, binance, findCandidates, nameScore, resolveInstrument } from '../js/market.js';

// risposte finte al posto della rete (stessa forma di quelle vere di onvista, Binance e BCE)
function fakeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    for (const [re, body] of routes) {
      if (re.test(url)) {
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return calls;
}

const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const q = (ex, name, cur, last, ago = 0, idn = 1, prev = null) => ({ market: { codeExchange: ex, name, idNotation: idn }, isoCurrency: cur, last, previousLast: prev, datetimeLast: iso(now - ago) });
const snap = (type, ev, isin, name, main, list) => ({ instrument: { entityType: type, entityValue: ev, isin, name }, quote: main, quoteList: { list } });
const ETF = snap('FUND', '151023875', 'IE00BFMXXD54', 'Vanguard S&P 500 UCITS ETF USD Acc.',
  q('LSX', 'LS Exchange', 'EUR', 132.235, 0, 283089788, 133.0),
  [q('LSE', 'London Stock Exchange', 'GBp', 11017, 60000, 2), q('GAT', 'Tradegate BSX', 'EUR', 132.24, 1000, 3), q('GER', 'Xetra', 'EUR', 132.34, 900000, 4), q('@DE', 'Baader Trading', 'EUR', 99, 400 * 864e5, 5)]);
const STOCK = snap('STOCK', '182277215', 'US7731211089', 'Rocket Lab USA', q('NMS', 'Nasdaq', 'USD', 56.335, 0, 9), [q('NMS', 'Nasdaq', 'USD', 56.335, 0, 9)]);
const HIST = { isoCurrency: 'EUR', datetimeLast: [1790769600, 1790856000, 1790942400], last: [120, 'x', 125] };
const SEARCH = { list: [
  { entityType: 'DERIVATIVE', entityValue: '330142570', name: 'Invesco Physical Gold II ETC', isin: 'XS3384723154', symbol: 'G2LD', displayType: 'ETC' },
  { entityType: 'DERIVATIVE', entityValue: '25169147', name: 'Invesco Physical Gold ETC', isin: 'IE00B579F325', symbol: '8PSG', displayType: 'ETC' },
  { entityType: 'NEWS', entityValue: '1', name: 'Notizia', isin: null },
  { entityType: 'FUND', entityValue: 'abc', name: '<b>strano</b>', isin: 'nonvalido' },
] };

test('onvista: ricerca, solo campi controllati, niente credenziali', async () => {
  const calls = fakeFetch([[/instruments\/query/, SEARCH]]);
  const r = await ovSearch('Invesco Physical Gold');
  assert.deepEqual(r.map(x => x.isin), ['XS3384723154', 'IE00B579F325']);
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal(calls[0].opts.referrerPolicy, 'no-referrer');
  assert.ok(calls[0].url.startsWith('https://api.onvista.de/api/v1/instruments/query?searchValue=Invesco%20Physical%20Gold'));
});

test('quotazione giusta: valuta del titolo, LS Exchange prima, niente borse ferme, pence in sterline', async () => {
  fakeFetch([[/FUND\/ISIN:IE00BFMXXD54\/snapshot/, ETF]]);
  const s = await ovSnapshot('FUND', 'IE00BFMXXD54');
  assert.equal(s.ev, '151023875');
  assert.equal(pickQuote(s.quotes, 'EUR').venue, 'LS Exchange');
  const gbp = pickQuote(s.quotes, 'GBP');
  assert.equal(gbp.cur, 'GBP');
  assert.ok(Math.abs(gbp.last - 110.17) < 1e-9);
  // Baader fermo da più di un anno: mai scelto
  assert.ok(!s.quotes.filter(x => x.venue === 'Baader Trading').some(x => x === pickQuote(s.quotes.filter(y => y.ex === '@DE' || y.ex === 'LSX'), 'EUR')));
  // valuta che non c'è: la quotazione principale
  assert.equal(pickQuote(s.quotes, 'CHF').venue, 'LS Exchange');
});

test('quote per ISIN con storico; per nome sceglie il più simile', async () => {
  fakeFetch([[/FUND\/ISIN:IE00BFMXXD54\/snapshot/, ETF], [/eod_history/, HIST], [/instruments\/query/, SEARCH], [/DERIVATIVE\/ISIN:IE00B579F325\/snapshot/, snap('DERIVATIVE', '25169147', 'IE00B579F325', 'Invesco Physical Gold ETC', q('LSX', 'LS Exchange', 'EUR', 337.6, 0, 7), [])]]);
  const r = await quote({ isin: 'IE00BFMXXD54', type: 'FUND', currency: 'EUR' }, '1M');
  assert.equal(r.price, 132.235);
  assert.equal(r.currency, 'EUR');
  assert.deepEqual(r.closes, [120, 125, 132.235]);
  assert.ok(Math.abs(r.change - (132.235 - 120) / 120 * 100) < 1e-9);
  assert.equal(r.venue, 'LS Exchange');
  const day = await quote({ isin: 'IE00BFMXXD54', type: 'FUND', currency: 'EUR' }, '1G');
  assert.ok(Math.abs(day.change - (132.235 - 133) / 133 * 100) < 1e-9);
  const inst = await resolveInstrument({ name: 'Invesco Physical Gold A' });
  assert.deepEqual(inst, { type: 'DERIVATIVE', id: 'IE00B579F325' });
  const c = await findCandidates({ name: 'Invesco Physical Gold A' });
  assert.equal(c[0].isin, 'IE00B579F325');
  assert.ok(nameScore('Vanguard S&P 500 UCITS ETF', 'Vanguard S&P 500 UCITS ETF USD Acc.') > nameScore('Vanguard S&P 500 UCITS ETF', 'Vanguard S&P 500 Growth Index Fund'));
});

test('risposte strane o ostili vengono rifiutate', async () => {
  fakeFetch([[/STOCK\/ISIN:US0000000001/, '<html>blocked</html>'], [/STOCK\/ISIN:US0000000002/, snap('STOCK', '1', 'US0000000002', 'X', q('NMS', 'N', 'USD', '1e9; alert(1)'), [])]]);
  await assert.rejects(ovSnapshot('STOCK', 'US0000000001'));
  await assert.rejects(ovSnapshot('STOCK', 'US0000000002'), /Prezzo non disponibile/);
  await assert.rejects(ovSnapshot('STOCK/../x', 'US0000000002'));
  await assert.rejects(ovSnapshot('STOCK', '../../x'));
});

test('portafoglio: ISIN, cambio, crypto e titoli senza ISIN', async () => {
  const k = (t, c) => [t, '0', '0', '0', String(c)];
  fakeFetch([
    [/binance\.com.*BTCUSDT/, [k(1, 60000), k(2, 66000)]],
    [/frankfurter\.dev/, { base: 'EUR', date: '2026-10-28', rates: { USD: 1.1, GBP: 0.85, 'BAD!': 3, JPY: -1 } }],
    [/FUND\/ISIN:IE00BFMXXD54\/snapshot/, ETF], [/STOCK\/ISIN:US7731211089\/snapshot/, STOCK], [/eod_history/, HIST],
    // senza tipo salvato: prima si cerca l'ISIN per sapere che strumento è
    [/query\?searchValue=US7731211089/, { list: [{ entityType: 'STOCK', entityValue: '182277215', name: 'Rocket Lab USA', isin: 'US7731211089' }] }],
  ]);
  const b = await binance('BTC-USD', '1M');
  assert.equal(b.price, 66000);
  const fx = await ecbRates('EUR');
  assert.deepEqual(fx.rates, { EUR: 1, USD: 1.1, GBP: 0.85 });
  const res = await refreshHoldings([
    { id: 'h1', cls: 'crypto', symbol: 'BTC-USD', currency: 'EUR' },
    { id: 'h2', cls: 'etf_eq', isin: 'IE00BFMXXD54', ovType: 'FUND', currency: 'EUR' },
    { id: 'h3', cls: 'stock', isin: 'US7731211089', currency: 'EUR' },
    { id: 'h4', cls: 'etf_eq', name: 'Senza codice', symbol: 'VUAA.DE', currency: 'EUR' },
  ], fx.rates);
  const byId = Object.fromEntries(res.updated.map(u => [u.id, u]));
  assert.ok(Math.abs(byId.h1.price - 60000) < 1e-6);          // 66.000 USD / 1,1
  assert.equal(byId.h2.price, 132.235);
  assert.equal(byId.h2.src, 'LS Exchange');
  assert.ok(Math.abs(byId.h3.price - 56.335 / 1.1) < 1e-9);   // solo in dollari: convertito
  assert.equal(byId.h3.ovType, 'STOCK');
  assert.deepEqual(res.failed.map(f => [f.id, f.reason]), [['h4', 'isin']]);
});
