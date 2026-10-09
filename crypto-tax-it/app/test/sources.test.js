// «Da dove arriva l'imposta»: vendite, scambi, pagamenti, commissioni e premi dell'anno, in parole semplici.
const { test } = require('node:test');
const { CT, D, assert } = require('./helpers');
require('../src/report.js');

const disp = (kind, gain, year) => ({ year: year || 2025, kind, gain: D(gain) });
const inc = (type, value, year) => ({ year: year || 2025, type, value: D(value) });

test('nessuna vendita ma premi, cashback e scambi: l\'elenco li mostra e lo dice', () => {
  const res = { year: 2025, engine: { disposals: [disp('swap', '3.5'), disp('swap', '-1'), disp('spend', '0.2'), disp('swap', '99', 2024)],
    incomes: [inc('cashback', '30'), inc('cashback', '12'), inc('interest', '5'), inc('cashback', '700', 2024)] } };
  const sx = CT.report.taxSources(res);
  assert.equal(sx.hasSales, false); assert.equal(sx.hasCashback, true);
  assert.deepEqual(sx.rows.map((r) => r.key), ['d:swap', 'd:spend', 'i:interest', 'i:cashback']);
  const swap = sx.rows.find((r) => r.key === 'd:swap');
  assert.equal(swap.count, 2); assert.equal(swap.amount.toString(), '2.5');          // guadagno netto dei due scambi, anno 2024 escluso
  const cb = sx.rows.find((r) => r.key === 'i:cashback');
  assert.equal(cb.count, 2); assert.equal(cb.amount.toString(), '42'); assert.equal(cb.group, 'income');
});

test('con una vendita in euro hasSales; senza operazioni nessuna riga', () => {
  assert.equal(CT.report.taxSources({ year: 2025, engine: { disposals: [disp('sell', '10')], incomes: [] } }).hasSales, true);
  const none = CT.report.taxSources({ year: 2025, engine: { disposals: [], incomes: [] } });
  assert.deepEqual(none.rows, []); assert.equal(none.hasCashback, false);
});
