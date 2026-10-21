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
  assert.equal(r.price, '76543.21'); assert.equal(r.source, 'Binance'); assert.equal(r.detail, 'coppia BTC/EUR, chiusura del 31/12/2025 (UTC)');
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
  const f = net([['binance', 'down'], ['crypto.com', 'down'], ['pair=XBTEUR', json(200, { error: [], result: { XXBTZEUR: [[T0 / 1000, '1', '2', '0.5', '76000.5', '1', '1', 3]], last: T0 / 1000 } })]]);
  const r = await PF.dailyEur('BTC', DAY, f);
  assert.equal(r.price, '76000.5'); assert.equal(r.source, 'Kraken');
});

test('Binance e Kraken senza quotazione: si passa a CryptoCompare', async () => {
  const f = net([['symbol=', json(400, { code: -1121 })], ['crypto.com', json(200, { code: 40004, message: 'Invalid instrument_name' })], ['kraken', json(200, { error: ['EQuery:Unknown asset pair'] })],
    ['coinbase', json(404, { message: 'NotFound' })],
    ['cryptocompare', json(200, { Response: 'Success', Data: { Data: [{ time: T0 / 1000, close: 0.05 }, { time: T0 / 1000 + 86400, close: 0.06 }] } })]]);
  const r = await PF.dailyEur('HOT', DAY, f);
  assert.equal(r.price, '0.05'); assert.equal(r.source, 'CryptoCompare');
});

test('nessuna fonte risponde: errore con il motivo di ciascuna, senza inventare un prezzo', async () => {
  await assert.rejects(() => PF.dailyEur('BTC', DAY, net([['binance', 'down'], ['crypto.com', 'down'], ['kraken', json(429, {})], ['coinbase', json(500, {})], ['cryptocompare', json(200, { Response: 'Error', Message: 'rate limit' })]])),
    (e) => e.details.length === 5 && /Binance: collegamento non riuscito/.test(e.details[0]) && /Kraken: HTTP 429/.test(e.details[2]) && /CryptoCompare: rate limit/.test(e.details[4]));
});

test('risposte strane: prezzo zero, giorno sbagliato, testo non JSON', async () => {
  await assert.rejects(() => PF.dailyEur('BTC', DAY, net([['symbol=BTCEUR', json(200, kl(0))], ['symbol=BTCUSDT', json(200, kl(0))], ['crypto.com', 'down'], ['coinbase', 'down'], ['kraken', json(200, { error: [], result: { X: [[T0 / 1000 - 86400, '1', '1', '1', '9', '1', '1', 1]] } })], ['cryptocompare', { status: 200, ok: true, json: async () => { throw new Error('no json'); } }]])));
  await assert.rejects(() => PF.dailyEur('BTC!', DAY, net([])), /non validi/);
});

test('simbolo di una sola lettera (S, Sonic) ammesso; caratteri strani no, con il nome nel messaggio', async () => {
  const f = net([['symbol=SEUR', json(200, kl(0.31))]]);
  assert.equal((await PF.dailyEur('S', DAY, f)).price, '0.31');
  await assert.rejects(() => PF.dailyEur('A/B', DAY, net([])), /A\/B: simbolo o data non validi/);
});

test('plausibile: GALA da 0,48 € (2021) a 0,00497 € (2025) e\' vero, un salto di 100 volte in pochi giorni no', () => {
  assert.equal(PF.plausible(0.00497, 0.48, 1500), true);
  assert.equal(PF.plausible(0.00497, 0.48, 3), false);
  assert.equal(PF.plausible(48, 0.48, 3), false);
  assert.equal(PF.plausible(0.5, 0.48, 3), true);
  assert.equal(PF.plausible(0, 0.48, 3), false);
  assert.equal(PF.plausible(1, 0, 0), true);
});

// ---- nuove fonti, metalli, valute, doppio controllo e servizio della pagina pubblicata
const ecb = (pairs) => json(200, { dataSets: [{ series: { '0:0:0:0:0': { observations: Object.fromEntries(pairs.map(([, v], i) => [String(i), [v, 0, 0]])) } } }],
  structure: { dimensions: { observation: [{ id: 'TIME_PERIOD', values: pairs.map(([d]) => ({ id: d })) }] } } });

test('Crypto.com Exchange: CRO solo in dollari, convertito con il cambio BCE del giorno', async () => {
  PF._reset();
  const f = net([['binance', json(400, { code: -1121 })], ['instrument_name=CRO_EUR', json(200, { code: 40004 })],
    ['instrument_name=CRO_USD', json(200, { code: 0, result: { data: [{ t: T0, o: '0.1', h: '0.1', l: '0.1', c: '0.1175', v: '1' }] } })],
    ['data-api.ecb.europa.eu', ecb([['2025-12-30', '1.1740'], ['2025-12-31', '1.1750']])]]);
  const r = await PF.dailyEur('CRO', DAY, f);
  assert.equal(r.source, 'Crypto.com Exchange');
  assert.equal(r.price, '0.1');                                       // 0,1175 $ / 1,175 $ per euro
  assert.match(r.detail, /CRO\/USD 0,1175 \$.*cambio BCE del 31\/12\/2025 \(1,175 USD per 1 €\)/);
});

test('Coinbase in dollari quando la BCE non risponde: cambio da Frankfurter (stessi dati BCE)', async () => {
  PF._reset();
  const t = T0 / 1000;
  const f = net([['binance', 'down'], ['crypto.com', 'down'], ['kraken', 'down'], ['ADA-EUR', json(404, { message: 'NotFound' })],
    ['ADA-USD', json(200, [[t, 0.3, 0.4, 0.35, 0.47, 100]])], ['ecb.europa.eu', 'down'], ['frankfurter', json(200, { amount: 1, base: 'USD', date: '2025-12-31', rates: { EUR: 0.85 } })]]);
  const r = await PF.dailyEur('ADA', DAY, f);
  assert.equal(r.source, 'Coinbase'); assert.equal(r.price, '0.3995'); assert.match(r.detail, /Frankfurter/);
});

test('oro (grammi): prezzo LBMA in euro per oncia diviso 31,1034768; il 31/12 senza asta PM vale la AM, poi il giorno prima', async () => {
  PF._reset();
  const f = net([['gold_pm.json', json(200, [{ d: '2025-12-30', v: [4300, 3200, 3660] }, { d: '2026-01-02', v: [4400, 3300, 3750] }])],
    ['gold_am.json', json(200, [{ d: '2025-12-31', v: [4320, 3210, 3676.53] }])]]);
  const r = await PF.dailyEur('XAU', DAY, f);
  assert.equal(r.source, 'LBMA');
  assert.equal(r.price, '118.2031843');                                // 3.676,53 € / 31,1034768 g
  assert.match(r.detail, /LBMA Gold Price AM del 31\/12\/2025: 3676,53 € per oncia ÷ 31,1035 grammi/);
  PF._reset();
  const g = net([['gold_pm.json', json(200, [{ d: '2025-12-30', v: [4300, 3200, 3660] }])], ['gold_am.json', json(200, [])]]);
  assert.match((await PF.dailyEur('XAU', DAY, g)).detail, /PM del 30\/12\/2025/);
});

test('oro senza LBMA: PAX Gold (1 token = 1 oncia) su Binance; argento senza fonti: errore chiaro', async () => {
  PF._reset();
  const f = net([['lbma', 'down'], ['symbol=PAXGEUR', json(200, kl(3700))]]);
  const r = await PF.dailyEur('XAU', DAY, f);
  assert.equal(r.source, 'PAX Gold (Binance)'); assert.equal(r.price, '118.9577623');
  await assert.rejects(() => PF.dailyEur('XAG', DAY, net([['lbma', 'down']])), (e) => /LBMA/.test(e.details[0]));
});

test('valute: euro per 1 dollaro dal cambio BCE (ultimo giorno pubblicato)', async () => {
  PF._reset();
  const r = await PF.dailyEur('USD', '2026-01-01', net([['D.USD.EUR', ecb([['2025-12-31', '1.25']])]]));
  assert.equal(r.source, 'BCE'); assert.equal(r.price, '0.8'); assert.match(r.detail, /31\/12\/2025/);
});

test('doppio controllo: seconda fonte e differenza in percentuale; oltre il 3% il testo avvisa', async () => {
  PF._reset();
  const ok = net([['symbol=BTCEUR', json(200, kl(80000))], ['crypto.com', 'down'], ['pair=XBTEUR', json(200, { error: [], result: { X: [[T0 / 1000, '1', '1', '1', '80040', '1', '1', 1]] } })]]);
  const r = await PF.dailyEur('BTC', DAY, ok, { check: true });
  assert.equal(r.check.source, 'Kraken'); assert.equal(r.check.diffPct, 0.05);
  assert.match(PF.describe(r), /^Binance: coppia BTC\/EUR, chiusura del 31\/12\/2025 \(UTC\) · confermato da Kraken \(differenza 0,05%\)$/);
  const bad = net([['symbol=BTCEUR', json(200, kl(80000))], ['instrument_name=BTC_EUR', json(200, { code: 0, result: { data: [{ t: T0, c: '90000' }] } })]]);
  assert.match(PF.describe(await PF.dailyEur('BTC', DAY, bad, { check: true })), /ATTENZIONE: Crypto\.com Exchange dà 90\.000 € \(differenza 12,5%\)/);
});

test('pagina pubblicata: prima il servizio api/price; se manca (404 senza JSON) si va diretti e non lo si richiede piu\'', async () => {
  PF._reset();
  const viaServer = await PF.fetchEur('BTC', DAY, { base: 'api/price', fetch: net([['api/price?sym=BTC&day=2025-12-31', json(200, { price: '80000', source: 'Binance', detail: 'x' })]]) });
  assert.equal(viaServer.via, 'server'); assert.equal(viaServer.price, '80000');
  await assert.rejects(() => PF.fetchEur('BTC', DAY, { base: 'api/price', fetch: net([['api/price', json(404, { error: 'prezzo non disponibile', details: ['Binance: HTTP 500'] })]]) }), (e) => e.details[0] === 'Binance: HTTP 500');
  const seen = [];
  const f = async (u) => { seen.push(u); if (u.startsWith('api/price')) return { status: 404, ok: false, json: async () => { throw new Error('html'); } }; return u.includes('symbol=ETHEUR') ? json(200, kl(3000)) : json(404, {}); };
  assert.equal((await PF.fetchEur('ETH', DAY, { base: 'api/price', fetch: f })).price, '3000');
  await PF.fetchEur('ETH', DAY, { base: 'api/price', fetch: f });
  assert.equal(seen.filter((u) => u.startsWith('api/price')).length, 1);
  PF._reset();
});
