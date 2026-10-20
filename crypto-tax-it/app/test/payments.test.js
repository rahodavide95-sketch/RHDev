const { test } = require('node:test');
const { CT, D, Kind, T, ev, run, eq, assert } = require('./helpers');
require('../src/payments.js');

const P = CT.payments;
const dl = P.deadlines(2025);

test('scadenze per l\'anno d\'imposta 2025 (Redditi PF 2026): sabato e domenica slittano al lunedi\'', () => {
  assert.equal(dl.saldo, '2026-06-30'); assert.equal(dl.saldoMagg, '2026-07-30'); assert.equal(dl.m730, '2026-09-30');
  assert.equal(dl.filing, '2026-11-02');           // il 31/10/2026 e' sabato
  assert.equal(dl.acconto2, '2026-11-30');
});

test('ravvedimento: oltre 90 giorni 1/8 del 25% (3,125%) + interessi legali 1,6%', () => {
  const r = P.ravvedimento(D(1000), dl.saldo, '2026-10-21', dl);
  assert.equal(r.days, 113);
  eq(r.sanction, '31.25'); eq(r.interest, '4.95'); eq(r.total, '1036.2');   // 1000 x 1,6% x 113/365 = 4,95
});

test('ravvedimento: entro 90 giorni 1/9 del 12,5%; entro 30 giorni 1/10; entro 15 giorni 1/15 al giorno', () => {
  eq(P.ravvedimento(D(1000), dl.saldo, '2026-08-15', dl).sanction, '13.89');   // 46 giorni
  eq(P.ravvedimento(D(1000), dl.saldo, '2026-07-25', dl).sanction, '12.5');    // 25 giorni
  eq(P.ravvedimento(D(1000), dl.saldo, '2026-07-06', dl).sanction, '5');       // 6 giorni: 12,5% x 6/15 / 10
  assert.equal(P.ravvedimento(D(1000), dl.saldo, '2026-06-30', dl), null);
});

function res(events, opts = {}) {
  const prices = new CT.PriceBook();
  for (const [k, v] of Object.entries(opts.prices || {})) { const [s, d] = k.split('|'); prices.setManual(s, d, v); }
  const r = run(events, { prices });
  return { year: 2025, y: r.y, rw: CT.computeRW(r.engine, 2025, r.y.rule), groups: { blockCount: 0 }, engine: r.engine };
}

test('piano: imposta cripto 1715 + IVCA 1727; pagando il 21/10/2026 si aggiunge il ravvedimento', () => {
  const r = res([ev(Kind.BUY, T(2024, 1, 1), 'BTC', 2, { value: 1000 }), ev(Kind.SELL, T(2025, 3, 1), 'BTC', 1, { value: 5500 })],
    { prices: { 'BTC|2025-01-01': '90000', 'BTC|2025-12-31': '80000' } });
  const p = P.plan(r, {}, { payDay: '2026-10-21' });
  const crypto = p.items.find((i) => i.key === 'crypto'), ivca = p.items.find((i) => i.key === 'ivca');
  assert.equal(crypto.code, '1715'); eq(crypto.amount, 1300);           // (5500 - 500) x 26%
  assert.equal(ivca.code, '1727'); eq(ivca.amount, 160);                // 1 BTC x 80.000 x 0,2%
  assert.ok(crypto.late && ivca.late);
  eq(crypto.ravv.sanction, '40.63'); eq(crypto.ravv.interest, '6.44');  // 1300 x 3,125% ; 1300 x 1,6% x 113/365
  eq(p.taxTotal, 1460);
  // acconto IVCA 2026: 160 € (tra 51,65 e 257,52) in un'unica rata entro il 30/11/2026, non ancora scaduta
  const acc = p.items.filter((i) => i.advance);
  assert.deepEqual(acc.map((a) => [a.code, a.amount.toString(), a.due, a.late]), [['1729', '160', '2026-11-30', false]]);
  assert.equal(p.now.some((i) => i.advance), false);
  assert.ok(p.hasRT && p.hasRW);
});

test('piano: pagando entro il 30 luglio basta la maggiorazione dello 0,40%', () => {
  const r = res([ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 1000 }), ev(Kind.SELL, T(2025, 3, 1), 'BTC', 1, { value: 2000 })]);
  const p = P.plan(r, {}, { payDay: '2026-07-20' });
  const c = p.items.find((i) => i.key === 'crypto');
  assert.ok(c.ravv.magg); eq(c.ravv.sanction, '1.04'); eq(c.payAmount, '261.04');
  const early = P.plan(r, {}, { payDay: '2026-05-10' });
  assert.equal(early.items.find((i) => i.key === 'crypto').late, false);
});

test('piano: acconti IVCA gia\' versati riducono il saldo; IVCA oltre 257,52 € -> acconto 40% + 60%', () => {
  const r = res([ev(Kind.BUY, T(2024, 1, 1), 'BTC', 2, { value: 1000 })], { prices: { 'BTC|2025-01-01': '90000', 'BTC|2025-12-31': '80000' } });
  const p = P.plan(r, { taxpayer: { advance: '100' } }, { payDay: '2026-05-01' });
  eq(p.ivca, 320); eq(p.items.find((i) => i.key === 'ivca').amount, 220);
  assert.deepEqual(p.items.filter((i) => i.advance).map((a) => [a.code, a.amount.toString(), a.due]), [['1728', '128', '2026-06-30'], ['1729', '192', '2026-11-30']]);
  assert.equal(p.hasRT, false);
});

test('piano: niente da pagare se non ci sono imposte (ma il quadro RW resta da compilare)', () => {
  const r = res([ev(Kind.BUY, T(2025, 6, 1), 'BTC', '0.001', { value: 50 })], { prices: { 'BTC|2025-12-31': '80000' } });
  const p = P.plan(r, {}, { payDay: '2026-10-21' });
  eq(p.taxTotal, 0); eq(p.grandTotal, 0); assert.equal(p.items.length, 0);   // IVCA 0,09 € -> 0 dopo l'arrotondamento
  assert.ok(p.hasRW);
});

test('giorni festivi: il 31/10/2027 e\' domenica e l\'1/11 e\' festivo -> 2/11/2027', () => {
  assert.equal(P.workday('2027-10-31'), '2027-11-02');
  assert.equal(P.deadlines(2025).filingNext, '2027-11-02');
});
