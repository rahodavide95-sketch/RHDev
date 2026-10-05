const { test } = require('node:test');
const { CT, D, Kind, T, ev, run, eq, blocking, codes, assert } = require('./helpers');

test('RW: il valore di un trasferimento usa l importo dichiarato nel file, senza chiedere prezzi', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'CRO', 100, { value: 5, account: 'app' }),
    ev(Kind.TRANSFER_OUT, T(2025, 3, 7), 'CRO', 100, { value: 6, account: 'app', uid: 'O' }),
  ], { resolutions: { O: { action: 'self_custody', wallet: 'Ledger' } } });
  const prices = engine.prices; prices.setManual('CRO', '2025-12-31', '0.07');
  const rows = CT.computeRW(engine, 2025, CT.tax.RULES[2025]);
  const app = rows.find((r) => r.account === 'app'), wal = rows.find((r) => r.account === 'Ledger');
  eq(app.valueFinal, 6);          // uscita dichiarata a 6 € nel file
  eq(wal.valueInitial, 6); eq(wal.valueFinal, 7); eq(wal.days, 300);
  assert.equal(codes(engine, 'block').includes('missing_price'), false);
});

test('RW: senza valore nel file si chiede il prezzo del giorno del trasferimento', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'CRO', 100, { value: 5, account: 'app' }),
    ev(Kind.TRANSFER_OUT, T(2025, 3, 7), 'CRO', 100, { account: 'app', uid: 'O' }),
  ], { resolutions: { O: { action: 'self_custody' } } });
  CT.computeRW(engine, 2025, CT.tax.RULES[2025]);
  assert.ok(engine.missingPrices.has('CRO|2025-03-07'));
});

test('oro con portafoglio Bitpanda: vendita parziale con LIFO e valore a fine anno', () => {
  const prices = new CT.PriceBook(); prices.setManual('XAU', '2025-12-31', 80);
  const { engine, y } = run([
    ev(Kind.BUY, T(2025, 1, 5), 'XAU', 10, { value: 500, assetHint: 'Metal', account: 'Bitpanda' }),
    ev(Kind.BUY, T(2025, 2, 5), 'XAU', 10, { value: 700, assetHint: 'Metal', account: 'Bitpanda' }),
    ev(Kind.SELL, T(2025, 3, 5), 'XAU', 12, { value: 1000, assetHint: 'Metal', account: 'Bitpanda' }),
  ], { prices });
  eq(engine.disposals[0].cost, 10 * 70 + 2 * 50);   // 10 g del secondo lotto (70 €/g) + 2 g del primo (50 €/g)
  eq(y.metals.net, 1000 - 800);
  const rw = CT.computeRW(engine, 2025, CT.tax.RULES[2025])[0];
  eq(rw.qtyEnd, 8); eq(rw.valueFinal, 640); eq(rw.ivca, 0);
});

test('trasferimento App -> Exchange abbinato: nessun problema e saldi per conto corretti', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 50000, account: 'Crypto.com App' }),
    ev(Kind.TRANSFER_OUT, T(2025, 2, 1, 10), 'BTC', 1, { value: 60000, account: 'Crypto.com App' }),
    ev(Kind.TRANSFER_IN, T(2025, 2, 1, 10, 5), 'BTC', 1, { account: 'Crypto.com Exchange' }),
  ]);
  assert.equal(blocking(engine).length, 0);
  const bal = (a) => engine.movements.filter((m) => m.account === a).reduce((s, m) => s.plus(m.delta), D(0));
  eq(bal('Crypto.com App'), 0); eq(bal('Crypto.com Exchange'), 1);
  assert.equal(engine.disposals.length, 0);
});
