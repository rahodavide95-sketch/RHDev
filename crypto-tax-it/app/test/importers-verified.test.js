// Casi basati sulla struttura dei formati verificata confrontando parser open source collaudati (solo come riferimento
// sui fatti del formato). I valori sono inventati.
const { test } = require('node:test');
const { CT, Kind, run, eq, blocking, codes, assert } = require('./helpers');
require('../src/pipeline.js');
const I = CT.importers;

const H = 'Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n';
const row = (ts, desc, cur, amt, toCur, toAmt, nAmt, kind) => `${ts},${desc},${cur},${amt},${toCur},${toAmt},EUR,${nAmt},0,${kind},\n`;

test('Crypto.com App: scambi con ordini limite, acquisti a valore nativo, dust conversion', () => {
  const csv = H +
    row('2025-01-01 10:00:00', 'Buy', 'EUR', '-500', 'BTC', '0.005', '500', 'recurring_buy_order') +
    row('2025-01-02 10:00:00', 'Limit buy', 'EUR', '-100', 'ETH', '0.03', '100', 'trading.limit_order.cash_account.purchase_commit') +
    row('2025-01-03 10:00:00', 'Limit sell', 'ETH', '-0.03', 'EUR', '110', '110', 'trading.limit_order.fiat_wallet.sell_commit') +
    row('2025-01-04 10:00:00', 'Card buy', 'CRO', '1000', '', '', '120', 'crypto_purchase') +
    row('2025-01-05 10:00:00', 'Dust', 'SHIB', '-5000', '', '', '2', 'dust_conversion_debited') +
    row('2025-01-05 10:00:00', 'Dust', 'CRO', '10', '', '', '2', 'dust_conversion_credited') +
    row('2025-01-06 10:00:00', 'Swap', 'CRO', '-100', 'ATOM', '3', '12', 'crypto_exchange');
  const r = I.TYPES.cryptocom_app.parse(csv, 'a.csv');
  // dust conversion: la riga in uscita e quella in entrata formano uno scambio SHIB -> CRO (la riga in entrata e' gia' contata)
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.BUY, Kind.SELL, Kind.BUY, Kind.SWAP, Kind.INFO, Kind.SWAP]);
  assert.equal(r.unknown.length, 0);
  eq(r.events[0].value, 500); assert.equal(r.events[0].asset, 'BTC');
  assert.equal(r.events[4].asset, 'SHIB'); eq(r.events[4].qty, 5000); eq(r.events[4].value, 2);
  assert.equal(r.events[4].counterAsset, 'CRO'); eq(r.events[4].counterQty, 10);
  // senza la riga in entrata non si indovina lo scambio: restano vendita e acquisto a valore nativo
  const lone = I.TYPES.cryptocom_app.parse(H + row('2025-01-05 10:00:00', 'Dust', 'SHIB', '-5000', '', '', '2', 'dust_conversion_debited') + row('2025-01-07 10:00:00', 'Dust', 'CRO', '10', '', '', '2', 'dust_conversion_credited'), 'b.csv');
  assert.deepEqual(lone.events.map((e) => e.kind), [Kind.SELL, Kind.BUY]);
});

test('Crypto.com App: proventi (interessi, staking, referral, cashback), spesa e blocchi interni', () => {
  const csv = H +
    row('2025-02-01 10:00:00', 'Interest', 'CRO', '1', '', '', '0.1', 'crypto_earn_interest_paid') +
    row('2025-02-02 10:00:00', 'Stake', 'CRO', '1', '', '', '0.1', 'mco_stake_reward') +
    row('2025-02-03 10:00:00', 'Ref', 'CRO', '1', '', '', '0.1', 'referral_bonus') +
    row('2025-02-04 10:00:00', 'Cashback', 'CRO', '1', '', '', '0.1', 'referral_card_cashback') +
    row('2025-02-05 10:00:00', 'Netflix', 'CRO', '1', '', '', '0.1', 'reimbursement') +
    row('2025-02-06 10:00:00', 'Pay', 'CRO', '-1', '', '', '0.1', 'crypto_payment') +
    row('2025-02-07 10:00:00', 'Lock', 'CRO', '-100', '', '', '10', 'lockup_lock') +
    row('2025-02-07 10:00:00', 'Stake', 'ATOM', '-1', '', '', '10', 'finance.dpos.staking.crypto_wallet') +
    row('2025-02-08 10:00:00', 'Limit lock', 'EUR', '-100', '', '', '100', 'trading.limit_order.fiat_wallet.purchase_lock');
  const r = I.TYPES.cryptocom_app.parse(csv, 'a.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.INCOME, Kind.INCOME, Kind.INCOME, Kind.INCOME, Kind.INCOME, Kind.SPEND, Kind.INFO, Kind.INFO, Kind.INFO]);
  assert.deepEqual(r.events.slice(0, 5).map((e) => e.incomeType), ['interest', 'staking', 'referral', 'cashback', 'cashback']);
  assert.equal(r.unknown.length, 0);
});

test('Crypto.com App: regalo tra utenti, riga senza tipo e importi negativi sui proventi', () => {
  const csv = H +
    row('2025-03-01 10:00:00', 'Gift in', 'BTC', '0.01', '', '', '500', 'crypto_transfer') +
    row('2025-03-02 10:00:00', 'EUR Deposit', 'EUR', '100', '', '', '100', '') +
    row('2025-03-03 10:00:00', 'EUR Withdrawal', 'EUR', '-100', '', '', '100', '') +
    row('2025-03-04 10:00:00', 'Boh', 'EUR', '5', '', '', '5', '') +
    row('2025-03-05 10:00:00', 'Storno', 'CRO', '-1', '', '', '0.1', 'crypto_earn_interest_paid');
  const r = I.TYPES.cryptocom_app.parse(csv, 'a.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.UNRESOLVED, Kind.FIAT_IN, Kind.FIAT_OUT, Kind.UNRESOLVED, Kind.UNRESOLVED]);
  assert.match(r.events[0].note, /regalo ricevuto/);
});

test('Crypto.com App: flusso completo con dust conversion e acquisto da App', () => {
  const csv = H +
    row('2025-01-01 10:00:00', 'Buy', 'EUR', '-1000', 'BTC', '0.01', '1000', 'viban_purchase') +
    row('2025-02-01 10:00:00', 'Sell', 'BTC', '-0.01', 'EUR', '1500', '1500', 'crypto_viban_exchange');
  const { y, engine } = run(I.TYPES.cryptocom_app.parse(csv, 'a.csv').events);
  eq(y.crypto.net, 500); eq(y.crypto.tax, 130); assert.equal(blocking(engine).length, 0);
});

const BP_RECENT = 'Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency,Tax Fiat\n';

test('Bitpanda recente: titoli di sezione, intestazioni ripetute, prelievo cripto con commissione, deposito fiat', () => {
  const csv = 'Bitpanda\nEstratto\n,,\n' + BP_RECENT +
    'A1,2025-01-05T09:05:00+01:00,buy,incoming,500.00,EUR,10.0,XAU,50,EUR,Metal,,5,EUR,0,EUR,\n' +
    'Crypto transactions\n' +
    BP_RECENT +
    'A2,2025-02-05T09:05:00+01:00,withdrawal,outgoing,-,EUR,0.5,ETH,,,Cryptocurrency,,0.001,ETH,,,\n' +
    'A3,2025-02-06T09:05:00+01:00,deposit,incoming,300.00,EUR,-,EUR,,,Fiat,,0,EUR,,,\n' +
    'A4,2025-02-07T09:05:00+01:00,deposit,incoming,-,EUR,0.2,ETH,,,Cryptocurrency,,0,ETH,,,\n';
  const r = I.TYPES.bitpanda.parse(csv, 'bp.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.TRANSFER_OUT, Kind.FIAT_IN, Kind.TRANSFER_IN]);
  assert.equal(r.rows, 4);
  eq(r.events[1].qty, '0.501');   // 0,5 inviati + 0,001 di commissione
  eq(r.events[2].qty, 300);
  eq(r.events[0].value, 500); assert.equal(r.events[0].assetHint, 'Metal');
});

test('Bitpanda variante precedente: ID/Type/Status/Created at, solo operazioni completate', () => {
  const csv = 'ID,Type,In/Out,Amount Fiat,Fee,Fiat,Amount Asset,Asset,Status,Created at\n' +
    'B1,buy,incoming,200.00,2.00,EUR,2.0,XAU,finished,2023-06-05T09:05:00+02:00\n' +
    'B2,buy,incoming,100.00,1.00,EUR,1.0,XAU,canceled,2023-06-06T09:05:00+02:00\n' +
    'B3,sell,outgoing,120.00,1.00,EUR,1.0,XAU,finished,2023-07-06T09:05:00+02:00\n';
  assert.equal(I.detectType(csv), 'bitpanda');
  const r = I.TYPES.bitpanda.parse(csv, 'old.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.INFO, Kind.SELL]);
  assert.equal(r.events[0].asset, 'XAU'); eq(r.events[2].value, 120);
  const { engine } = run(r.events, {}, { toYear: 2023 });
  eq(engine.disposals[0].gain, 20);   // 1 g venduto a 120, costo 100 (200 / 2 g)
});

test('Bitpanda: tipi non verificati restano da controllare (nessuna ipotesi)', () => {
  const csv = BP_RECENT + 'C1,2025-03-05T09:05:00+01:00,staking,incoming,1.00,EUR,0.01,ETH,,,Cryptocurrency,,0,EUR,,,\n';
  const r = I.TYPES.bitpanda.parse(csv, 'bp.csv');
  assert.equal(r.events[0].kind, Kind.UNRESOLVED);
  assert.equal(r.unknown.length, 1);
});

test('Crypto.com Exchange: colonne con nomi diversi vengono riconosciute per parola chiave', () => {
  const csv = 'Account Type,Order ID,Trade ID,Create Time (UTC),Instrument Name,Side,Traded Quantity,Traded Price,Fees,Fee Instrument Name,Margin Order\n' +
    'SPOT,o1,t1,2025-04-01 10:00:00,BTC_EUR,BUY,0.01,100000,1.5,EUR,False\n';
  const r = I.TYPES.cryptocom_exchange_trades.parse(csv, 'SPOT_TRADE.csv');
  assert.equal(r.events[0].kind, Kind.BUY);
  eq(r.events[0].value, 1000); eq(r.events[0].feeQty, '1.5'); assert.equal(r.events[0].feeAsset, 'EUR');
  assert.equal(I.detectType(csv), 'cryptocom_exchange_trades');
});

// Struttura copiata da un export reale di Bitpanda (ottobre 2026); identificativi e importi inventati.
const BP_REAL = 'Disclaimer: All data is without guarantee, errors and changes are reserved.;;;;;;;;;;;;;;;;;\n' +
  'Account opened at: 2021-01-01T10:00:00+01:00;;;;;;;;;;;;;;;;;\n' +
  'Venue: Bitpanda;;;;;;;;;;;;;;;;;\n' +
  'Transaction ID;Timestamp;Transaction Type;In/Out;Amount Fiat;Fiat;Amount Asset;Asset;Asset market price;Asset market price currency;Asset class;Product ID;Fee;Fee asset;Fee percent;Spread;Spread Currency;Tax Fiat\n' +
  'Fa1;2025-03-10T18:50:06+01:00;deposit;incoming;100.00;EUR;-;EUR;-;-;Fiat;-;0.00000000;EUR;-;-;-;0.00\n' +
  'Ta1;2025-03-10T18:50:28+01:00;buy;outgoing;100.00;EUR;1.10000000;Gold;90.91;EUR;Metal;28;-;-;-;-;-;0.00\n' +
  '0b1c2d3e-0000-4000-8000-000000000001;2025-04-08T17:15:47+02:00;transfer;incoming;10.00;EUR;0.10000000;Gold;100.00;EUR;Metal;28;-;-;-;-;-;-\n';

test('Bitpanda reale: ";", righe iniziali, oro "Gold" in grammi, «transfer» in entrata con il valore all\'arrivo', () => {
  assert.equal(I.detectType(BP_REAL), 'bitpanda');
  const r = I.TYPES.bitpanda.parse(BP_REAL, 'bitpanda-trades.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.FIAT_IN, Kind.BUY, Kind.TRANSFER_IN]);
  const [, buy, tr] = r.events;
  assert.equal(buy.asset, 'XAU'); eq(buy.qty, '1.1'); eq(buy.value, 100);
  assert.equal(tr.asset, 'XAU'); eq(tr.qty, '0.1'); eq(tr.value, 10); assert.equal(r.unknown.length, 0);
  // nell'analisi il «transfer» chiede l'origine e porta il valore all'arrivo; con quel costo il punto si chiude
  const a = CT.analyze({ files: [{ id: 'b', name: 'bp.csv', type: 'bitpanda', text: BP_REAL }], settings: { year: 2025 } });
  const q = a.engine.issues.find((i) => i.code === 'transfer_in_unmatched');
  eq(q.data.value, 10); assert.match(q.data.note, /Bitpanda/);
  const ok = CT.analyze({ files: [{ id: 'b', name: 'bp.csv', type: 'bitpanda', text: BP_REAL }], resolutions: { [q.uid]: { action: 'set_cost', cost_eur: '10.00' } }, settings: { year: 2025 } });
  assert.equal(ok.engine.issues.some((i) => i.code === 'transfer_in_unmatched'), false);
  eq(ok.engine.pool('XAU').lots.reduce((s, l) => s.plus(l.qty), CT.D(0)), '1.2');
});

// Coinbase "Transaction history": formato attuale (ID, importi con simbolo, quantita' negative, data "UTC") e formati precedenti.
// Struttura dal parser open source BittyTax (solo riferimento sui fatti del formato); valori inventati.
const CB_NEW = 'Transactions\nUser,Mario Rossi,00000000-0000-0000-0000-000000000000\n' +
  'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes\n' +
  'a1,2025-01-10 10:00:00 UTC,Buy,BTC,0.02,EUR,"€50,000.00","€1,000.00","€1,015.00",€15.00,Bought 0.02 BTC for €1015.00 EUR\n' +
  'a2,2025-02-10 10:00:00 UTC,Convert,BTC,-0.01,EUR,"€60,000.00",€594.00,€600.00,€6.00,Converted 0.01 BTC to 0.25 ETH\n' +
  'a3,2025-03-10 10:00:00 UTC,Sell,ETH,-0.05,EUR,"€3,000.00",€150.00,€148.00,€2.00,Sold 0.05 ETH for €148.00 EUR\n' +
  'a4,2025-04-10 10:00:00 UTC,Staking Income,ETH,0.001,EUR,"€2,500.00",€2.50,€2.50,€0.00,\n' +
  'a5,2025-05-10 10:00:00 UTC,Advanced Trade Sell,ETH,-0.1,EUR,"€2,600.00",€260.00,€259.00,€1.00,Sold 0.1 ETH for 0.0042 BTC on ETH-BTC at 0.042 BTC/ETH\n' +
  'a6,2025-06-10 10:00:00 UTC,Send,BTC,-0.005,EUR,"€55,000.00",€275.00,€275.00,€0.00,To: bc1qexample\n' +
  'a7,2025-06-11 10:00:00 UTC,Deposit,EUR,500,EUR,€1.00,€500.00,€500.00,€0.00,\n' +
  'a8,2025-06-12 10:00:00 UTC,Retail Staking Transfer,ETH,-0.05,EUR,"€2,600.00",€130.00,€130.00,€0.00,\n' +
  'a9,2025-06-13 10:00:00 UTC,Receive,BTC,0.0001,EUR,"€55,000.00",€5.50,€5.50,€0.00,Received 0.0001 BTC from Coinbase Referral\n' +
  'b1,2025-07-01 09:00:00 UTC,Asset Migration,ETH2,-0.2,EUR,"€2,000.00",€400.00,€400.00,€0.00,\n' +
  'b2,2025-07-01 09:00:00 UTC,Asset Migration,ETH,0.2,EUR,"€2,000.00",€400.00,€400.00,€0.00,\n' +
  'b3,2025-07-02 09:00:00 UTC,Mystery Thing,ADA,5,EUR,€0.50,€2.50,€2.50,€0.00,\n';

test('Coinbase attuale: righe iniziali, importi «€1,234.56», quantita\' negative, Buy/Convert/Sell/Staking/Advanced/Send/Deposit', () => {
  assert.equal(I.detectType(CB_NEW), 'coinbase');
  const r = I.TYPES.coinbase.parse(CB_NEW, 'coinbase.csv');
  const ev = r.events;
  const k = ev.map((e) => e.kind);
  assert.deepEqual(k, [Kind.BUY, Kind.SWAP, Kind.SELL, Kind.INCOME, Kind.SWAP, Kind.TRANSFER_OUT, Kind.FIAT_IN, Kind.INFO, Kind.INCOME, Kind.UNRESOLVED, Kind.SWAP]);
  const [buy, conv, sell, stake, adv, send, dep, , ref, unk, mig] = ev;
  assert.equal(buy.asset, 'BTC'); eq(buy.qty, '0.02'); eq(buy.value, 1000); eq(buy.feeQty, 15); assert.equal(buy.feeAsset, 'EUR');
  assert.equal(buy.ts.toISOString(), '2025-01-10T10:00:00.000Z');
  assert.equal(conv.asset, 'BTC'); eq(conv.qty, '0.01'); assert.equal(conv.counterAsset, 'ETH'); eq(conv.counterQty, '0.25'); eq(conv.value, 594);
  eq(sell.qty, '0.05'); eq(sell.value, 150); eq(sell.feeQty, 2);
  assert.equal(stake.incomeType, 'staking'); eq(stake.value, '2.5');
  assert.equal(adv.asset, 'ETH'); assert.equal(adv.counterAsset, 'BTC'); eq(adv.counterQty, '0.0042'); eq(adv.value, 259);
  eq(send.qty, '0.005'); eq(dep.qty, 500); assert.equal(dep.asset, 'EUR');
  assert.equal(ref.incomeType, 'referral');
  assert.match(unk.note, /Mystery Thing/); assert.equal(r.unknown.length, 1);
  assert.equal(mig.asset, 'ETH2'); assert.equal(mig.counterAsset, 'ETH'); assert.equal(mig.conv, true);
});

test('Coinbase: analisi completa (costo con commissione, permuta neutra BTC->ETH, vendita con commissione)', () => {
  const csv = 'Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes\n' +
    '2025-01-10T10:00:00Z,Buy,BTC,0.02,EUR,"€50,000.00","€1,000.00","€1,015.00",€15.00,Bought 0.02 BTC for €1015.00 EUR\n' +
    '2025-02-10T10:00:00Z,Convert,BTC,-0.02,EUR,"€60,000.00","€1,188.00","€1,200.00",€12.00,Converted 0.02 BTC to 0.5 ETH\n' +
    '2025-03-10T10:00:00Z,Sell,ETH,-0.5,EUR,"€3,000.00","€1,500.00","€1,490.00",€10.00,Sold 0.5 ETH for €1490.00 EUR\n';
  const a = CT.analyze({ files: [{ id: 'c', name: 'cb.csv', type: 'coinbase', text: csv }], settings: { year: 2025 } });
  // costo 1.015 (con commissione) passa all'ETH (Circ. 30/E); vendita: 1.500 - 10 = 1.490; guadagno 475
  eq(a.y.crypto.gains, 475); assert.equal(a.groups.blockCount, 0);
});

test('Coinbase formati precedenti: "Spot Price", "Total (inclusive of fees)", "Fees" e la valuta nel nome delle colonne', () => {
  const v2 = 'You can use this transaction report to inform your likely tax obligations.\n\nTransactions\nUser,x,y\n' +
    'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees),Fees,Notes\n' +
    '2023-05-01T08:00:00Z,Buy,ADA,100,EUR,0.35,35.00,36.50,1.50,Bought 100.0000 ADA for €36.50 EUR\n' +
    '2023-06-01T08:00:00Z,Coinbase Earn,XLM,10,EUR,0.08,0.80,0.80,0.00,Received 10 XLM from Coinbase Earn\n';
  const r2 = I.TYPES.coinbase.parse(v2, 'old.csv');
  assert.deepEqual(r2.events.map((e) => e.kind), [Kind.BUY, Kind.INCOME]);
  eq(r2.events[0].value, 35); eq(r2.events[0].feeQty, '1.5'); eq(r2.events[1].value, '0.8');
  const v1 = 'Timestamp,Transaction Type,Asset,Quantity Transacted,USD Spot Price at Transaction,USD Subtotal,USD Total (inclusive of fees),USD Fees,Notes\n' +
    '2023-01-05T08:00:00Z,Sell,BTC,0.01,17000,170.00,167.50,2.50,Sold 0.0100 BTC for $167.50 USD\n';
  assert.equal(I.detectType(v1), 'coinbase');
  const s1 = I.TYPES.coinbase.parse(v1, 'v1.csv').events[0];
  assert.equal(s1.kind, Kind.SELL); eq(s1.value, 170); assert.equal(s1.valueCcy, 'USD'); assert.equal(s1.feeAsset, 'USD'); eq(s1.feeQty, '2.5');
});

test('Coinbase risalvato con Excel in italiano: ";", decimali con la virgola, «1.234,56 €», numeri piccoli in formato esponenziale', () => {
  const csv = 'ID;Timestamp;Transaction Type;Asset;Quantity Transacted;Price Currency;Price at Transaction;Subtotal;Total (inclusive of fees and/or spread);Fees and/or Spread;Notes\n' +
    'a1;2025-01-10 10:00:00 UTC;Buy;BTC;0,015;EUR;50.000,00 €;750,00 €;761,25 €;11,25 €;Bought 0.015 BTC for €761.25 EUR\n' +
    'a2;2025-02-10 10:00:00 UTC;Staking Income;ETH;2,5E-05;EUR;3.000,00 €;0,08 €;0,08 €;0,00 €;\n' +
    'a3;2025-03-10 10:00:00 UTC;Convert;ETH;-1,5;EUR;3.000,00 €;4.455,00 €;4.500,00 €;45,00 €;Converted 1.5 ETH to 1,500 USDC\n';
  const r = I.TYPES.coinbase.parse(csv, 'cb-excel.csv');
  const [buy, stake, conv] = r.events;
  eq(buy.qty, '0.015'); eq(buy.value, 750); eq(buy.feeQty, '11.25');
  eq(stake.qty, '0.000025'); eq(stake.value, '0.08');
  eq(conv.qty, '1.5'); eq(conv.counterQty, 1500); eq(conv.value, 4455);
  // formato originale (punto decimale): "0.015" e "€1,015.00" restano giusti; un esponente non diventa un numero grande
  const orig = 'Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes\n' +
    '2025-01-10T10:00:00Z,Rewards Income,ETH,2.5E-05,EUR,"€3,000.00",€0.08,€0.08,€0.00,\n' +
    '2025-01-11T10:00:00Z,Buy,BTC,0.015,EUR,"€50,000.00",€750.00,€761.25,€11.25,Bought 0.015 BTC for €761.25 EUR\n';
  const o = I.TYPES.coinbase.parse(orig, 'cb.csv').events;
  eq(o[0].qty, '0.000025'); eq(o[1].qty, '0.015'); eq(o[1].value, 750);
});
