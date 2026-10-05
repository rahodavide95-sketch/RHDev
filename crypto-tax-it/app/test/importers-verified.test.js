// Casi basati sulla struttura dei formati verificata confrontando parser open source collaudati (solo come riferimento
// sui fatti del formato). I valori sono inventati.
const { test } = require('node:test');
const { CT, Kind, run, eq, blocking, codes, assert } = require('./helpers');
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
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.BUY, Kind.SELL, Kind.BUY, Kind.SELL, Kind.BUY, Kind.SWAP]);
  assert.equal(r.unknown.length, 0);
  eq(r.events[0].value, 500); assert.equal(r.events[0].asset, 'BTC');
  assert.equal(r.events[4].asset, 'SHIB'); eq(r.events[4].value, 2);
  assert.equal(r.events[5].asset, 'CRO'); eq(r.events[5].value, 2);
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
