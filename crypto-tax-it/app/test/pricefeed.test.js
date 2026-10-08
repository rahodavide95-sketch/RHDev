const { test } = require('node:test');
const { CT, assert } = require('./helpers');
require('../src/pricefeed.js');
const PF = CT.pricefeed;

const DAY = '2025-12-31';
const T0 = Date.parse(DAY + 'T00:00:00Z');
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const kl = (close, t = T0) => [[t, '1', '2', '0.5', String(close), '100', t + 86399999, '1', 5, '1', '1', '0']];
const calls = [];
/** Rete finta: `routes` e' una lista di [prefisso, risposta o funzione]. */
const net = (routes) => async (url) => {
  calls.push(url);
  for (const [prefix, r] of routes) if (url.includes(prefix)) { if (r === 'down') throw new TypeError('Failed to fetch'); return typeof r === 'function' ? r(url) : r; }
  return json(404, {});
};

test('Binance: coppia in euro, chiusura del giorno', async () => {
  const f = net([['symbol=BTCEUR', json(200, kl(76543.21))]]);
  const r = await PF.dailyEur('btc', DAY, f);
  assert.deepEqual(r, { price: '76543.21', source: 'Binance' });
  assert.match(calls.at(-1), /data-api\.binance\.vision\/api\/v3\/klines\?symbol=BTCEUR&interval=1d&startTime=\d+&endTime=\d+&limit=1/);
});

test('Binance: senza coppia in euro si passa da USDT e dal cambio EUR/USDT', async () => {
  const f = net([['symbol=POLEUR', json(400, { code: -1121, msg: 'Invalid symbol.' })], ['symbol=POLUSDT', json(200, kl(0.3))], ['symbol=EURUSDT', json(200, kl(1.2))]]);
  const r = await PF.dailyEur('POL', DAY, f);
  assert.equal(r.source, 'Binance');
  assert.equal(r.price, '0.25');
  const u = await PF.dailyEur('USDT', DAY, net([['symbol=EURUSDT', json(200, kl(1.25))]]));
  assert.equal(u.price, '0.8');
});

test('nomi diversi: LUNA2 si cerca come LUNA', async () => {
  const f = net([['symbol=LUNAEUR', json(200, kl(0.12))]]);
  assert.equal((await PF.dailyEur('LUNA2', DAY, f)).price, '0.12');
});

test('Binance bloccato dal browser: si passa a Kraken (BTC = XBT)', async () => {
  const f = net([['binance', 'down'], ['pair=XBTEUR', json(200, { error: [], result: { XXBTZEUR: [[T0 / 1000, '1', '2', '0.5', '76000.5', '1', '1', 3]], last: T0 / 1000 } })]]);
  assert.deepEqual(await PF.dailyEur('BTC', DAY, f), { price: '76000.5', source: 'Kraken' });
});

test('Binance e Kraken senza quotazione: si passa a CryptoCompare', async () => {
  const f = net([['symbol=', json(400, { code: -1121 })], ['kraken', json(200, { error: ['EQuery:Unknown asset pair'] })],
    ['cryptocompare', json(200, { Response: 'Success', Data: { Data: [{ time: T0 / 1000, close: 0.05 }, { time: T0 / 1000 + 86400, close: 0.06 }] } })]]);
  assert.deepEqual(await PF.dailyEur('HOT', DAY, f), { price: '0.05', source: 'CryptoCompare' });
});

test('nessuna fonte risponde: errore con il motivo di ciascuna, senza inventare un prezzo', async () => {
  await assert.rejects(() => PF.dailyEur('BTC', DAY, net([['binance', 'down'], ['kraken', json(429, {})], ['cryptocompare', json(200, { Response: 'Error', Message: 'rate limit' })]])),
    (e) => e.details.length === 3 && /Binance: collegamento bloccato/.test(e.details[0]) && /Kraken: HTTP 429/.test(e.details[1]) && /CryptoCompare: rate limit/.test(e.details[2]));
});

test('risposte strane: prezzo zero, giorno sbagliato, testo non JSON', async () => {
  await assert.rejects(() => PF.dailyEur('BTC', DAY, net([['symbol=BTCEUR', json(200, kl(0))], ['symbol=BTCUSDT', json(200, kl(0))], ['kraken', json(200, { error: [], result: { X: [[T0 / 1000 - 86400, '1', '1', '1', '9', '1', '1', 1]] } })], ['cryptocompare', { status: 200, ok: true, json: async () => { throw new Error('no json'); } }]])));
  await assert.rejects(() => PF.dailyEur('BTC!', DAY, net([])), /non validi/);
});
