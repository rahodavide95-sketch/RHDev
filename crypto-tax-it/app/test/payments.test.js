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
  const c = O.compute({ altri: '30000', occ: [{ lordo: '2.000', rit: '400', spese: '200' }], dir: [{ lordo: '1000', rit: '150' }], san: '629,11' });
  eq(c.occNet, 1800); eq(c.dirDed, 250); eq(c.dirNet, 750); eq(c.extra, 2550);
  eq(c.lordaExtra, '892.5');            // 2.550 x 35%
  eq(c.detrSan, 95);                    // (629,11 - 129,11) x 19%
  // solo stipendio: 7.140 - (1.910 x 20.000/22.000 + 65) - 1.000 = 4.338,64
  // con la musica (32.550): 8.032,50 - (1.910 x 17.450/22.000 + 65) - 1.000 x 7.450/8.000 - 95 = 5.426,27
  eq(c.base.netta, '4338.64'); eq(c.full.netta, '5426.27');
  eq(c.ritenute, 550); eq(c.irpefDue, '537.64');
  // senza CU e senza importi: aliquote medie 1,5% e 0,8% sui 2.550 € in piu' (lo stipendio lo ha gia' trattato il datore)
  eq(c.reg.saldo, '38.25'); eq(c.com.saldo, '20.4'); eq(c.addiz, '58.65'); eq(c.com.acconto, '6.12');
});

test('altri redditi: stipendio da 18.000 € + 3.000 € di serate: si perde la somma esente del cuneo (4,8%)', () => {
  const c = O.compute({ altri: '18000', occ: [{ lordo: '3000' }] });
  eq(c.base.somma, 864); eq(c.full.somma, 0); eq(c.lostBonus, 864);
  // 1.279,23 (IRPEF netta con 21.000, con l'ulteriore detrazione di 1.000) - 1.314,62 (solo stipendio) + 864
  eq(c.irpefDue, '828.62');
});

test('altri redditi: sotto i 35 anni la deduzione dei diritti d\'autore e\' del 40%; senza altri redditi la detrazione azzera l\'IRPEF', () => {
  const c = O.compute({ under35: true, dir: [{ lordo: '3000', rit: '360' }] });
  eq(c.dirNet, 1800); eq(c.netta, 0); eq(c.addiz, 0); eq(c.com.acconto, 0);
  eq(c.irpefCredit, 360);               // ritenute da recuperare (rimborso o compensazione)
  eq(c.irpefDue, 0);
});

test('piano: le stime della musica vanno in una sezione a parte (4001, 3801/3844, acconti 4033/4034)', () => {
  const r = res([]);
  const p = P.plan(r, { others: { altri: '30000', occ: [{ lordo: '5000', rit: '1000' }] } }, { payDay: '2026-05-10' });
  const g = p.items.map((i) => [i.group, i.code]);
  assert.deepEqual(g, [['other', '4001'], ['other', '3801'], ['other', '3844'], ['other', '4033'], ['other', '4034']]);
  // con 35.000: 8.890 - (1.910 x 15.000/22.000 + 65) - 1.000 x 5.000/8.000 = 6.897,73; meno 4.338,64 e 1.000 di ritenute
  eq(p.items[0].amount, '1559.09');
  eq(p.items[1].amount, 75); eq(p.items[2].amount, 40);   // 1,5% e 0,8% dei 5.000 € in piu'; acconto comunale 12 € (30% di 40): non si versa
  eq(p.invNow, 0); eq(p.otherNow, '2297.73');   // 1.559,09 + 75 + 40 + 623,64 di primo acconto IRPEF (40%)
});

test('piano: IRPEF a credito (spese sanitarie) non e\' una voce da pagare, non scade e non ha ravvedimento', () => {
  const r = res([]);
  const p = P.plan(r, { others: { altri: '30000', san: '1129,11' } }, { payDay: '2026-10-21' });
  const cred = p.items.find((i) => i.credit);
  assert.ok(cred); eq(cred.creditAmount, 190);          // 19% di 1.000
  assert.equal(cred.late, false); assert.equal(cred.ravv, null);
  assert.equal(p.now.includes(cred), false); eq(p.payNow, 0);
});

test('addizionali: con la CU si usa l\'aliquota media della CU; gli importi scritti a mano vincono sulla stima', () => {
  // CU: 30.000 € di stipendio, 450 € di regionale (1,5%) e 270 € di comunale (0,9%); 4.000 € netti di serate in piu'
  const cu = { altri: '30000', addRegTr: '450', addComTr: '270', occ: [{ lordo: '4000', rit: '800' }] };
  const c = O.compute(cu);
  assert.equal(c.reg.src, 'cu'); eq(c.reg.dovuta, 510); eq(c.reg.saldo, 60);          // 1,5% di 34.000 - 450
  eq(c.com.dovuta, 306); eq(c.com.saldo, 36); eq(c.com.acconto, '10.8');                  // 0,9% di 34.000 - 270; 30% di 0,9% x 4.000
  // importo dovuto scritto dall'utente: 600 € di regionale (es. Regione con scaglioni), meno i 450 della CU
  const m = O.compute(Object.assign({}, cu, { addRegMan: '600' }));
  assert.equal(m.reg.src, 'man'); eq(m.reg.dovuta, 600); eq(m.reg.saldo, 150);
  const items = O.paymentItems(m, 2025, P.deadlines(2025));
  const reg = items.find((i) => i.code === '3801');
  eq(reg.amount, 150); assert.equal(reg.estimate, false);
  assert.ok(!items.some((i) => i.code === '3843'));                                       // 10,80 €: fino a 12 € non si versa
  // trattenuta piu' alta del dovuto scritto: credito, nessun versamento
  const cr = O.compute(Object.assign({}, cu, { addRegMan: '400' }));
  eq(cr.reg.saldo, -50); assert.ok(!O.paymentItems(cr, 2025, P.deadlines(2025)).some((i) => i.code === '3801'));
  assert.ok(O.addizSteps(cr).some(([a, v]) => /regionale a credito/.test(a) && v.eq(50)));
  // dove si scrive: RV2 (dovuta scritta), RV3 (CU punto 22), RV11 (CU punti 26 e 27)
  const rows = O.where(m).map(([r]) => r);
  assert.ok(rows.includes('RV2') && rows.includes('RV3') && rows.includes('RV11') && !rows.includes('RV10'));
});

test('regola dei 12 €: IRPEF e addizionali fino a 12 € non si versano', () => {
  // 300 € di diritti d'autore senza ritenuta e uno stipendio: IRPEF in piu' 225 x 35% = 78,75 (meno il calo delle detrazioni)
  const c = O.compute({ altri: '30000', addRegTr: '450', addComTr: '0', dir: [{ lordo: '300' }] });
  eq(c.reg.saldo, '3.38');                                                                 // 1,5% di 225
  const items = O.paymentItems(c, 2025, P.deadlines(2025));
  assert.ok(!items.some((i) => i.code === '3801' || i.code === '3844'));
  assert.ok(O.addizSteps(c).some(([a]) => /fino a 12 € non si versa/.test(a)));
});
