const { test } = require('node:test');
const { CT, D, Kind, T, ev, run, eq, blocking, codes, assert } = require('./helpers');

test('LIFO: si vendono prima gli ultimi lotti acquistati', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2024, 1, 10), 'BTC', 1, { value: 100 }),
    ev(Kind.BUY, T(2024, 6, 1), 'BTC', 1, { value: 200 }),
    ev(Kind.SELL, T(2025, 3, 1), 'BTC', '1.5', { value: 450 }),
  ]);
  eq(engine.disposals[0].cost, 250); // 1 x 200 + 0,5 x 100
  eq(engine.disposals[0].gain, 200);
  eq(y.crypto.tax, 52);
  assert.equal(blocking(engine).length, 0);
});

test('commissioni in euro: aumentano il costo e riducono il corrispettivo', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 5), 'BTC', 1, { value: 100, feeAsset: 'EUR', feeQty: 2 }),
    ev(Kind.SELL, T(2025, 2, 5), 'BTC', 1, { value: 150, feeAsset: 'EUR', feeQty: 3 }),
  ]);
  const d = engine.disposals[0];
  eq(d.cost, 102); eq(d.proceeds, 147); eq(d.gain, 45);
});

test('storico mancante: blocca e usa costo zero', () => {
  const { engine } = run([ev(Kind.SELL, T(2025, 2, 5), 'BTC', 1, { value: 150 })]);
  eq(engine.disposals[0].gain, 150);
  assert.ok(codes(engine, 'block').includes('missing_history'));
});

test('storico mancante: risoluzione con costo indicato', () => {
  const sell = ev(Kind.SELL, T(2025, 2, 5), 'BTC', 1, { value: 150, uid: 'S1' });
  const { engine } = run([sell], { resolutions: { S1: { action: 'cover_cost', cost_eur: '40' } } });
  eq(engine.disposals[0].gain, 110);
  assert.equal(blocking(engine).length, 0);
});

test('permuta (criterio "tutte imponibili"): realizzo al valore normale, nuovo lotto a quel valore', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05', value: 1500 }),
    ev(Kind.SELL, T(2025, 3, 1), 'BTC', '0.05', { value: 1400 }),
  ], { swapRule: 'all' });
  assert.deepEqual(engine.disposals.map((d) => d.gain.toString()), ['500', '-100']);
  eq(y.crypto.net, 400); eq(y.crypto.tax, 104);
});

test('permuta imponibile senza prezzo: blocca e chiede il prezzo', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'USDC', counterQty: '1500' }),
  ]);
  assert.ok(codes(engine, 'block').includes('missing_value'));
  assert.ok(engine.missingPrices.has('ETH|2025-02-01'));
});

test('permuta: prezzo inserito a mano', () => {
  const prices = new CT.PriceBook(); prices.setManual('ETH', '2025-02-01', 1600);
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'USDC', counterQty: '1600' }),
  ], { prices });
  assert.equal(blocking(engine).length, 0);
  eq(engine.disposals[0].gain, 600);
});

test('permuta: prezzo dedotto dalle operazioni dello stesso giorno', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.BUY, T(2025, 2, 1, 9), 'ETH', 1, { value: 1700 }),
    ev(Kind.SWAP, T(2025, 2, 1, 15), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05' }),
  ], { swapRule: 'all' });
  assert.equal(blocking(engine).length, 0);
  eq(engine.disposals[0].proceeds, 1700);
});

test('commissione pagata in cripto: onere accessorio e cessione', () => {
  const prices = new CT.PriceBook(); prices.setManual('CRO', '2025-02-01', '0.10');
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'CRO', 100, { value: 5 }),
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05', value: 1500, feeAsset: 'CRO', feeQty: 10 }),
  ], { prices, swapRule: 'all' });
  const swap = engine.disposals.find((d) => d.kind === 'swap');
  const fee = engine.disposals.find((d) => d.kind === 'fee');
  eq(swap.proceeds, 1499); eq(fee.proceeds, 1); eq(fee.cost, '0.5'); eq(fee.gain, '0.5');
});

test('permuta prima del 2023: non e un realizzo, il costo si trasferisce', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2021, 5, 1), 'ETH', 1, { value: 100 }),
    ev(Kind.SWAP, T(2022, 6, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.1', value: 1000 }),
    ev(Kind.SELL, T(2025, 2, 1), 'BTC', '0.1', { value: 1000 }),
  ]);
  assert.equal(engine.disposals.length, 1);
  eq(engine.disposals[0].gain, 900); // costo storico 100, non 1000
  eq(y.crypto.tax, 234);
});

test('Circ. 30/E: dal 2023 lo scambio tra cripto (ETH -> BTC) non e\' un realizzo, il costo passa alla cripto ricevuta', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05', value: 1500 }),
    ev(Kind.SELL, T(2025, 3, 1), 'BTC', '0.05', { value: 1400 }),
  ]);
  assert.deepEqual(engine.disposals.map((d) => [d.kind, d.gain.toString()]), [['sell', '400']]);   // 1400 - 1000 (costo dell'ETH)
  eq(y.crypto.net, 400); eq(y.crypto.tax, 104);
  assert.ok(codes(engine, 'info').includes('neutral_swaps'));
  assert.equal(engine.swapsCarried.length, 1); eq(engine.swapsCarried[0].cost, 1000); eq(engine.swapsCarried[0].value, 1500);
  assert.equal(blocking(engine).length, 0);
});

test('Circ. 30/E: scambio tra cripto senza valore in euro non blocca (il valore serve solo al quadro RW)', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05' }),
  ]);
  assert.equal(blocking(engine).length, 0);
  assert.equal(engine.disposals.length, 0);
  eq(engine.pool('BTC').lots[0].unitCost, 20000);   // 1000 / 0,05
});

test('Circ. 30/E: cripto -> stablecoin e stablecoin -> cripto sono realizzi; tra due stablecoin no', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'USDC', counterQty: '1600', value: 1500 }),   // +500
    ev(Kind.SWAP, T(2025, 2, 2), 'USDC', '1600', { counterAsset: 'USDT', counterQty: '1600', value: 1510 }),  // neutra
    ev(Kind.SWAP, T(2025, 2, 3), 'USDT', '1600', { counterAsset: 'BTC', counterQty: '0.02', value: 1520 }),  // +20
  ]);
  assert.deepEqual(engine.disposals.map((d) => [d.asset, d.gain.toString()]), [['ETH', '500'], ['USDT', '20']]);
  eq(y.crypto.net, 520);
  eq(engine.pool('BTC').lots[0].unitCost, 76000);   // 1520 / 0,02
});

test('Circ. 30/E: metallo -> cripto e\' un realizzo (paniere diverso)', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2025, 1, 5), 'XAU', 10, { value: 500, assetHint: 'Metal' }),
    ev(Kind.SWAP, T(2025, 3, 5), 'XAU', 10, { counterAsset: 'BTC', counterQty: '0.01', value: 700 }),
  ]);
  assert.equal(engine.disposals.length, 1); eq(y.metals.net, 200);
});

test('Circ. 30/E: commissione dello scambio neutro (in euro o in cripto) entra nel costo della cripto ricevuta', () => {
  const prices = new CT.PriceBook(); prices.setManual('CRO', '2025-02-01', '0.10');
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'CRO', 100, { value: 5 }),
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05', value: 1500, feeAsset: 'CRO', feeQty: 10 }),
    ev(Kind.SWAP, T(2025, 2, 2), 'BTC', '0.05', { counterAsset: 'SOL', counterQty: 10, value: 1500, feeAsset: 'EUR', feeQty: 2 }),
    ev(Kind.SELL, T(2025, 3, 1), 'SOL', 10, { value: 1400 }),
  ], { prices });
  const fee = engine.disposals.find((d) => d.kind === 'fee');
  eq(fee.proceeds, 1); eq(fee.cost, '0.5');                      // i CRO usati per pagare la commissione sono ceduti
  const sell = engine.disposals.find((d) => d.kind === 'sell');
  eq(sell.cost, 1003); eq(sell.gain, 397);                       // 1000 + 1 (CRO) + 2 (euro)
});

test('Circ. 30/E: lo scambio con un lotto senza costo documentato passa il "non documentato" alla cripto ricevuta', () => {
  const { engine } = run([
    ev(Kind.SWAP, T(2025, 2, 1), 'ETH', 1, { counterAsset: 'BTC', counterQty: '0.05', value: 1500, uid: 'SW' }),
    ev(Kind.SELL, T(2025, 3, 1), 'BTC', '0.05', { value: 1400 }),
  ]);
  assert.ok(codes(engine, 'block').includes('missing_history'));
  const sell = engine.disposals[0];
  eq(sell.gain, 1400); assert.equal(sell.uses[0].documented, false);
});

test('proventi: tassati al valore normale, non compensabili con le minus, diventano costo', () => {
  const { engine, y } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 1000 }),
    ev(Kind.SELL, T(2025, 2, 1), 'BTC', 1, { value: 950 }),
    ev(Kind.INCOME, T(2025, 3, 1), 'ADA', 10, { value: 100, incomeType: 'staking' }),
  ]);
  eq(y.crypto.income, 100); eq(y.crypto.taxable, 100); eq(y.crypto.tax, 26);
  eq(engine.pool('ADA').lots[0].unitCost, 10);
});

test('oro: paniere separato, nessuna compensazione con le minus cripto', () => {
  const { y } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 1000 }),
    ev(Kind.SELL, T(2025, 2, 1), 'BTC', 1, { value: 700 }),
    ev(Kind.BUY, T(2025, 1, 5), 'XAU', 10, { value: 500, assetHint: 'Metal' }),
    ev(Kind.SELL, T(2025, 3, 5), 'XAU', 5, { value: 350, assetHint: 'Metal' }),
  ]);
  eq(y.crypto.net, -300); eq(y.metals.net, 100); eq(y.metals.tax, 26);
});

test('data fiscale italiana: 23:30 UTC del 31/12 e gia 2026', () => {
  const { y } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 100 }),
    ev(Kind.SELL, T(2025, 12, 31, 23, 30), 'BTC', 1, { value: 200 }),
  ]);
  assert.equal(y.crypto.nDisposals, 0);
});

test('minusvalenze riportate automaticamente da anni precedenti (max 4 anni)', () => {
  const evs = [
    ev(Kind.BUY, T(2023, 1, 10), 'BTC', 1, { value: 3000 }),
    ev(Kind.SELL, T(2023, 6, 10), 'BTC', 1, { value: 400 }),      // -2.600 nel 2023 (oltre 2.000: riportabile)
    ev(Kind.BUY, T(2025, 1, 10), 'ETH', 1, { value: 1000 }),
    ev(Kind.SELL, T(2025, 6, 10), 'ETH', 1, { value: 5000 }),     // +4.000 nel 2025
  ];
  const a = run(evs);
  eq(a.years[2023].crypto.newLoss, 2600);
  eq(a.y.crypto.taxable, 1400); eq(a.y.crypto.tax, 364);
  assert.deepEqual(a.y.crypto.carryUsed.map((c) => [c.year, c.amount.toString()]), [[2023, '2600']]);
  const b = run(evs, {}, { useCarry: false });
  eq(b.y.crypto.taxable, 4000);
});

test('minusvalenze manuali: scadute oltre il quarto anno, utilizzo dalla piu vecchia', () => {
  const evs = [ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 1000 }), ev(Kind.SELL, T(2025, 2, 1), 'BTC', 1, { value: 2000 })];
  const { y } = run(evs, {}, { manualCarry: { crypto: [{ year: 2024, amount: 300 }, { year: 2020, amount: 999 }, { year: 2021, amount: 200 }] } });
  assert.deepEqual(y.crypto.carryUsed.map((c) => [c.year, c.amount.toString()]), [[2021, '200'], [2024, '300']]);
  assert.deepEqual(y.crypto.carryExpired.map((c) => c.year), [2020]);
  eq(y.crypto.taxable, 500); eq(y.crypto.tax, 130);
});

test('anno in perdita: nuova minusvalenza da riportare e nessuna imposta', () => {
  const { y } = run([ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 1000 }), ev(Kind.SELL, T(2025, 2, 1), 'BTC', 1, { value: 750 })]);
  eq(y.crypto.newLoss, 250); eq(y.crypto.tax, 0);
});

test('2024: franchigia 2.000 euro (sotto = esente, sopra = si tassa tutto)', () => {
  const mk = (sell) => [ev(Kind.BUY, T(2024, 1, 1), 'BTC', 1, { value: 1000 }), ev(Kind.SELL, T(2024, 2, 1), 'BTC', 1, { value: sell })];
  const a = run(mk(2500), {}, { toYear: 2024 }); // +1500
  assert.equal(a.y.crypto.thresholdExempt, true); eq(a.y.crypto.tax, 0);
  const b = run(mk(3500), {}, { toYear: 2024 }); // +2500
  assert.equal(b.y.crypto.thresholdExempt, false); eq(b.y.crypto.tax, 650);
});

test('2026: aliquota 33%, stablecoin euro (EMT) al 26%', () => {
  const { y } = run([
    ev(Kind.BUY, T(2026, 1, 1), 'BTC', 1, { value: 1000 }), ev(Kind.SELL, T(2026, 2, 1), 'BTC', 1, { value: 2000 }),
    ev(Kind.BUY, T(2026, 1, 1), 'EURC', 1000, { value: 1000 }), ev(Kind.SELL, T(2026, 2, 1), 'EURC', 1000, { value: 1100 }),
  ], {}, { toYear: 2026 });
  eq(y.crypto.taxable, 1100); eq(y.crypto.emtShare, 100); eq(y.crypto.tax, 356);
});

test('trasferimento tra conti propri con commissione di rete', () => {
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-02-01', 100000);
  const { engine } = run([
    ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 50000, account: 'app' }),
    ev(Kind.TRANSFER_OUT, T(2025, 2, 1, 10), 'BTC', 1, { account: 'app' }),
    ev(Kind.TRANSFER_IN, T(2025, 2, 1, 11), 'BTC', '0.9995', { account: 'exchange' }),
  ], { prices });
  assert.equal(blocking(engine).length, 0);
  const f = engine.disposals[0];
  assert.equal(f.kind, 'transfer_fee'); eq(f.qty, '0.0005'); eq(f.proceeds, 50); eq(f.cost, 25);
  eq(engine.pool('BTC').balance, '0.9995');
});

test('ingresso senza origine: blocca, poi risoluzione con costo', () => {
  const evs = [ev(Kind.TRANSFER_IN, T(2025, 2, 1), 'BTC', 1, { uid: 'X1' }), ev(Kind.SELL, T(2025, 3, 1), 'BTC', 1, { value: 100 })];
  const a = run(evs);
  assert.ok(codes(a.engine, 'block').includes('transfer_in_unmatched')); eq(a.engine.disposals[0].gain, 100);
  const b = run(evs, { resolutions: { X1: { action: 'set_cost', cost_eur: '40', acquired: '2023-05-01' } } });
  assert.equal(blocking(b.engine).length, 0); eq(b.engine.disposals[0].gain, 60);
});

test('uscita senza destinazione: provvisoria su wallet, risolvibile come wallet o come vendita', () => {
  const evs = [ev(Kind.BUY, T(2025, 1, 1), 'BTC', 1, { value: 100 }), ev(Kind.TRANSFER_OUT, T(2025, 2, 1), 'BTC', 1, { uid: 'O1' })];
  const a = run(evs);
  assert.ok(codes(a.engine, 'block').includes('transfer_out_unmatched')); assert.equal(a.engine.disposals.length, 0);
  const b = run(evs, { resolutions: { O1: { action: 'self_custody', wallet: 'Wallet Ledger' } } });
  assert.equal(blocking(b.engine).length, 0);
  assert.ok(b.engine.movements.some((m) => m.account === 'Wallet Ledger' && m.delta.eq(1)));
  const c = run(evs, { resolutions: { O1: { action: 'disposal', value_eur: '130' } } });
  eq(c.engine.disposals[0].gain, 30);
});

test('rideterminazione al 1/1/2025', () => {
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-01-01', 300);
  const evs = [ev(Kind.BUY, T(2023, 5, 1), 'BTC', 1, { value: 100 }), ev(Kind.SELL, T(2025, 6, 1), 'BTC', 1, { value: 350 })];
  const { engine } = run(evs, { rebase2025: true, prices });
  eq(engine.disposals[0].gain, 50); assert.ok(engine.disposals[0].uses[0].rebased); eq(engine.rebaseTotal, 300);
  const { engine: e2 } = run(evs, { rebase2025: true });
  assert.ok(codes(e2, 'block').includes('missing_price'));
});

test('RW: detenuto tutto l anno', () => {
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-01-01', 100); prices.setManual('BTC', '2025-12-31', 200);
  const { engine } = run([ev(Kind.BUY, T(2024, 5, 1), 'BTC', 2, { value: 100 })], { prices });
  const rows = CT.computeRW(engine, 2025, CT.tax.RULES[2025]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].days, 365); eq(rows[0].valueInitial, 200); eq(rows[0].valueFinal, 400); eq(rows[0].ivca, '0.8');
});

test('RW: acquistato e venduto nello stesso anno', () => {
  const { engine } = run([
    ev(Kind.BUY, T(2025, 3, 1), 'BTC', 1, { value: 100 }), ev(Kind.SELL, T(2025, 3, 10), 'BTC', 1, { value: 130 }),
  ]);
  const r = CT.computeRW(engine, 2025, CT.tax.RULES[2025])[0];
  assert.equal(r.days, 10); eq(r.valueInitial, 100); eq(r.valueFinal, 130); eq(r.qtyEnd, 0);
});

test('RW: manca il prezzo del 31/12 -> stima col prezzo noto piu\' vicino (non blocca); oro senza IVCA', () => {
  const { engine } = run([ev(Kind.BUY, T(2025, 3, 1), 'XAU', 10, { value: 500, assetHint: 'Metal', account: 'bp' })]);
  const r = CT.computeRW(engine, 2025, CT.tax.RULES[2025])[0];
  assert.ok(!codes(engine, 'block').includes('missing_price'));
  assert.ok(codes(engine, 'warn').includes('rw_estimated')); assert.ok(engine.missingPrices.has('XAU|2025-12-31'));
  assert.equal(r.estimated, true); eq(r.valueFinal, 500);          // 10 g x 50 euro/g del giorno dell'acquisto
  eq(r.ivca, 0);
});

test('RW: senza nessun prezzo noto per quell\'asset il valore non si inventa: blocca e chiede', () => {
  const { engine } = run([ev(Kind.TRANSFER_IN, T(2025, 3, 1), 'ADA', 100, { account: 'ex' })]);
  CT.computeRW(engine, 2025, CT.tax.RULES[2025]);
  assert.ok(codes(engine, 'block').includes('missing_price')); assert.ok(engine.missingPrices.has('ADA|2025-12-31'));
});

// ---- correzioni del controllo di ottobre 2026 (casi calcolati a mano)
test('franchigia 2023-2024: "non inferiori a 2.000 euro" -> esattamente 2.000 si tassa, 1.999 no', () => {
  const mk = (sell) => [ev(Kind.BUY, T(2024, 1, 1), 'BTC', 1, { value: 1000 }), ev(Kind.SELL, T(2024, 2, 1), 'BTC', 1, { value: sell })];
  const a = run(mk(2999), {}, { toYear: 2024 });
  assert.equal(a.y.crypto.thresholdExempt, true); eq(a.y.crypto.tax, 0);
  const b = run(mk(3000), {}, { toYear: 2024 });
  assert.equal(b.y.crypto.thresholdExempt, false); eq(b.y.crypto.taxable, 2000); eq(b.y.crypto.tax, 520);
});

test('minusvalenza netta 2023-2024 fino a 2.000 euro: non si riporta; sopra 2.000 si riporta tutta; dal 2025 sempre', () => {
  const sale = (y, buy, sell) => [ev(Kind.BUY, T(y, 1, 10), 'BTC', 1, { value: buy }), ev(Kind.SELL, T(y, 6, 10), 'BTC', 1, { value: sell })];
  const later = [ev(Kind.BUY, T(2025, 7, 1), 'ETH', 1, { value: 1000 }), ev(Kind.SELL, T(2025, 8, 1), 'ETH', 1, { value: 6000 })];   // +5.000 nel 2025
  const small = run([...sale(2024, 3000, 1500), ...later]);          // -1.500 nel 2024
  eq(small.years[2024].crypto.newLoss, 0); eq(small.years[2024].crypto.lossNotCarried, 1500);
  eq(small.y.crypto.taxable, 5000); eq(small.y.crypto.tax, 1300);
  const big = run([...sale(2024, 5000, 2500), ...later]);            // -2.500 nel 2024
  eq(big.years[2024].crypto.newLoss, 2500);
  eq(big.y.crypto.taxable, 2500); eq(big.y.crypto.tax, 650);
  const y25 = run(sale(2025, 1000, 500));                            // -500 nel 2025: riportabile
  eq(y25.y.crypto.newLoss, 500); eq(y25.y.crypto.lossNotCarried, 0);
});

test('oro: la minusvalenza si riporta anche sotto 2.000 euro (la soglia riguarda solo le cripto)', () => {
  const { years } = run([
    ev(Kind.BUY, T(2024, 1, 5), 'XAU', 10, { value: 500, assetHint: 'Metal' }), ev(Kind.SELL, T(2024, 3, 5), 'XAU', 10, { value: 400, assetHint: 'Metal' }),
  ]);
  eq(years[2024].metals.newLoss, 100);
});

test('rideterminazione al 1/1/2025: la perdita sui lotti rideterminati non e\' deducibile, il guadagno si', () => {
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-01-01', 300);
  const loss = run([ev(Kind.BUY, T(2023, 5, 1), 'BTC', 1, { value: 100 }), ev(Kind.SELL, T(2025, 6, 1), 'BTC', 1, { value: 250 })], { rebase2025: true, prices });
  eq(loss.engine.disposals[0].gain, -50); eq(loss.engine.disposals[0].taxGain, 0);
  eq(loss.y.crypto.losses, 0); eq(loss.y.crypto.newLoss, 0); eq(loss.y.crypto.nonDeductible, 50);
  // lotto rideterminato (in perdita) + lotto comprato nel 2025 (in guadagno): si compensa solo cio' che e' deducibile
  const mixed = run([
    ev(Kind.BUY, T(2023, 5, 1), 'BTC', 1, { value: 100 }), ev(Kind.BUY, T(2025, 2, 1), 'BTC', 1, { value: 200 }),
    ev(Kind.SELL, T(2025, 6, 1), 'BTC', 2, { value: 500 }),    // 250 + 250: lotto 2025 +50, lotto rideterminato (300) -50 non deducibile
  ], { rebase2025: true, prices });
  eq(mixed.engine.disposals[0].gain, 0); eq(mixed.engine.disposals[0].taxGain, 50);
  eq(mixed.y.crypto.taxable, 50); eq(mixed.y.crypto.tax, 13);
});

test('storno del cashback: riduce i proventi, non e\' una cessione', () => {
  const { engine, y } = run([
    ev(Kind.INCOME, T(2025, 3, 1), 'CRO', 100, { value: 10, incomeType: 'cashback' }),
    ev(Kind.INCOME_REVERSAL, T(2025, 3, 20), 'CRO', 100, { value: 8 }),
    ev(Kind.INCOME, T(2025, 4, 1), 'CRO', 50, { value: 5, incomeType: 'cashback' }),
  ]);
  assert.equal(engine.disposals.length, 0);
  eq(y.crypto.income, 7);                                 // 10 - 8 + 5
  eq(engine.pool('CRO').balance, 50);
  // uno storno da solo non crea una perdita
  const solo = run([ev(Kind.INCOME, T(2024, 12, 20), 'CRO', 100, { value: 10, incomeType: 'cashback' }), ev(Kind.INCOME_REVERSAL, T(2025, 1, 5), 'CRO', 100, { value: 9 })]);
  eq(solo.y.crypto.income, 0); eq(solo.y.crypto.taxable, 0);
});
