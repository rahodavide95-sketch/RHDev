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

// ---- altri redditi (musica, spese sanitarie): casi calcolati a mano
require('../src/others.js');
const O = CT.others;

test('altri redditi: IRPEF 2025 a scaglioni 23/35/43 e detrazione per lavoro autonomo e redditi diversi', () => {
  eq(O.irpef(D(10000)), 2300); eq(O.irpef(D(30000)), 7140); eq(O.irpef(D(60000)), 18440);   // 6440 + 700 ; 6440 + 7700 + 4300
  eq(O.detrAutonomo(D(5000)), 1265); eq(O.detrAutonomo(D(28000)), 500); eq(O.detrAutonomo(D(55000)), 0);
});

test('altri redditi: DJ occasionale + SIAE con un lavoro dipendente da 30.000 € (aliquota 35% e detrazioni che calano)', () => {
  const c = O.compute({ altri: '30000', occ: [{ lordo: '2.000', rit: '400', spese: '200' }], dir: [{ lordo: '1000', rit: '150' }], san: '629,11', addiz: '2' });
  eq(c.occNet, 1800); eq(c.dirDed, 250); eq(c.dirNet, 750); eq(c.extra, 2550);
  eq(c.lordaExtra, '892.5');            // 2.550 x 35%
  eq(c.detrSan, 95);                    // (629,11 - 129,11) x 19%
  // solo stipendio: 7.140 - (1.910 x 20.000/22.000 + 65) - 1.000 = 4.338,64
  // con la musica (32.550): 8.032,50 - (1.910 x 17.450/22.000 + 65) - 1.000 x 7.450/8.000 - 95 = 5.426,27
  eq(c.base.netta, '4338.64'); eq(c.full.netta, '5426.27');
  eq(c.ritenute, 550); eq(c.irpefDue, '537.64'); eq(c.addiz, 51);
});

test('altri redditi: stipendio da 18.000 € + 3.000 € di serate: si perde la somma esente del cuneo (4,8%)', () => {
  const c = O.compute({ altri: '18000', occ: [{ lordo: '3000' }] });
  eq(c.base.somma, 864); eq(c.full.somma, 0); eq(c.lostBonus, 864);
  // 1.279,23 (IRPEF netta con 21.000, con l'ulteriore detrazione di 1.000) - 1.314,62 (solo stipendio) + 864
  eq(c.irpefDue, '828.62');
});

test('altri redditi: sotto i 35 anni la deduzione dei diritti d\'autore e\' del 40%; senza altri redditi la detrazione azzera l\'IRPEF', () => {
  const c = O.compute({ under35: true, dir: [{ lordo: '3000', rit: '360' }] });
  eq(c.dirNet, 1800); eq(c.netta, 0); eq(c.addiz, 0);
  eq(c.irpefCredit, 360);               // ritenute da recuperare (rimborso o compensazione)
  eq(c.irpefDue, 0);
});

test('piano: le stime della musica vanno in una sezione a parte (4001, 3801/3844, acconti 4033/4034)', () => {
  const r = res([]);
  const p = P.plan(r, { others: { altri: '30000', occ: [{ lordo: '5000', rit: '1000' }] } }, { payDay: '2026-05-10' });
  const g = p.items.map((i) => [i.group, i.code]);
  assert.deepEqual(g, [['other', '4001'], ['other', '3801 / 3844'], ['other', '4033'], ['other', '4034']]);
  // con 35.000: 8.890 - (1.910 x 15.000/22.000 + 65) - 1.000 x 5.000/8.000 = 6.897,73; meno 4.338,64 e 1.000 di ritenute
  eq(p.items[0].amount, '1559.09');
  eq(p.invNow, 0); eq(p.otherNow, '2282.73');   // 1.559,09 + 100 di addizionali + 623,64 di primo acconto (40%)
});
