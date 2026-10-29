import test from 'node:test';
import assert from 'node:assert/strict';
import { yahoo, binance, ecbRates, refreshHoldings, quote } from '../js/market.js';

// risposte finte al posto della rete
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

const yahooBody = (price, currency, closes) => ({ chart: { result: [{ meta: { regularMarketPrice: price, currency, longName: 'Test SpA' }, timestamp: closes.map((_, i) => 1700000000 + i * 86400), indicators: { quote: [{ close: closes }] } }] } });

test('Yahoo: prezzo, variazione, pence convertiti in sterline, niente credenziali', async () => {
  const calls = fakeFetch([[/chart\/AAA/, yahooBody(110, 'USD', [100, null, 105, 110])], [/chart\/BBB\.L/, yahooBody(2500, 'GBp', [2000, 2500])]]);
  const a = await yahoo('AAA', '1M');
  assert.equal(a.price, 110);
  assert.equal(a.closes.length, 3);
  assert.ok(Math.abs(a.change - 10) < 1e-9);
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal(calls[0].opts.referrerPolicy, 'no-referrer');
  const b = await yahoo('BBB.L', '1M');
  assert.equal(b.currency, 'GBP');
  assert.equal(b.price, 25);
  assert.deepEqual(b.closes, [20, 25]);
});

test('Yahoo: senza proxy non si passa da altri siti; con proxy sì, solo col simbolo', async () => {
  const calls = fakeFetch([[/allorigins/, yahooBody(5, 'EUR', [4, 5])]]);
  await assert.rejects(yahoo('ZZZ.MI', '1S', { proxies: false }));
  assert.ok(calls.every(c => !/allorigins|corsproxy/.test(c.url)));
  const r = await yahoo('ZZZ.MI', '1S', { proxies: true });
  assert.equal(r.price, 5);
  assert.ok(decodeURIComponent(calls[calls.length - 1].url).includes('chart/ZZZ.MI'));
});

test('risposte strane o ostili vengono rifiutate', async () => {
  fakeFetch([[/chart\/HTML/, '<html>blocked</html>'], [/chart\/NAN/, yahooBody('1e9; alert(1)', 'USD', ['x', 'y'])]]);
  await assert.rejects(yahoo('HTML', '1M'));
  await assert.rejects(yahoo('NAN', '1M'));
});

test('Binance per le crypto, BCE per i cambi, aggiornamento del portafoglio', async () => {
  const k = (t, c) => [t, '0', '0', '0', String(c)];
  fakeFetch([
    [/binance\.com.*BTCUSDT/, [k(1, 60000), k(2, 66000)]],
    [/frankfurter\.dev/, { base: 'EUR', date: '2026-10-28', rates: { USD: 1.1, GBP: 0.85, 'BAD!': 3, JPY: -1 } }],
    [/chart\/VWCE\.DE/, yahooBody(140, 'EUR', [138, 140])],
  ]);
  const b = await binance('BTC-USD', '1M');
  assert.equal(b.price, 66000);
  assert.ok(Math.abs(b.change - 10) < 1e-9);
  const q = await quote('BTC-USD', '1M');
  assert.equal(q.currency, 'USD');
  const fx = await ecbRates('EUR');
  assert.deepEqual(fx.rates, { EUR: 1, USD: 1.1, GBP: 0.85 });
  assert.equal(fx.date, '2026-10-28');
  const res = await refreshHoldings([
    { id: 'h1', symbol: 'BTC-USD', currency: 'EUR' },
    { id: 'h2', symbol: 'VWCE.DE', currency: 'EUR' },
    { id: 'h3', symbol: 'NONESISTE', currency: 'EUR' },
  ], { EUR: 1, USD: 1.1 });
  const byId = Object.fromEntries(res.updated.map(u => [u.id, u.price]));
  assert.ok(Math.abs(byId.h1 - 60000) < 1e-6);   // 66.000 USD / 1,1
  assert.equal(byId.h2, 140);
  assert.deepEqual(res.failed.map(f => f.id), ['h3']);
});
