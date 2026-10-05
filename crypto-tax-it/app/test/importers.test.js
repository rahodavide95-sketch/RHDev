// I file di prova sono SINTETICI e seguono la struttura ASSUNTA: verificano che il codice faccia cio' che si
// intende, NON che i formati reali di Crypto.com/Bitpanda coincidano. Quella validazione richiede i file veri.
const { test } = require('node:test');
const fs = require('node:fs');
const { CT, D, Kind, run, eq, blocking, codes, assert } = require('./helpers');
require('../src/zip.js');
const I = CT.importers;

const APP_CSV = `Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind
2025-01-10 10:00:00,Buy BTC,EUR,-1000,BTC,0.01,EUR,1000,1100,viban_purchase
2025-02-01 10:00:00,BTC -> ETH,BTC,-0.01,ETH,0.2,EUR,1200,1300,crypto_exchange
2025-03-01 10:00:00,Sell ETH,ETH,-0.2,EUR,1300,EUR,1300,1400,crypto_viban_exchange
2025-03-05 10:00:00,Earn,CRO,5,,,EUR,0.5,0.55,crypto_earn_interest_paid
2025-03-06 10:00:00,Lock,CRO,-5,,,EUR,0.5,0.55,crypto_earn_program_created
2025-03-07 10:00:00,To exchange,CRO,-5,,,EUR,0.5,0.55,crypto_to_exchange_transfer
2025-03-08 10:00:00,Mystery,CRO,1,,,EUR,0.1,0.11,foo_bar_baz
`;
const BITPANDA_CSV = `Bitpanda Customer Name
Export generato il 2025-12-31
,
Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency
T1,2025-01-05T09:00:00+01:00,deposit,incoming,500.00,EUR,500.00,EUR,,,Fiat,,0,EUR,,
T2,2025-01-05T09:05:00+01:00,buy,incoming,500.00,EUR,10.0,XAU,50,EUR,Metal,,5.00,EUR,0,EUR
T3,2025-03-05T09:05:00+01:00,sell,outgoing,350.00,EUR,5.0,XAU,70,EUR,Metal,,3.00,EUR,0,EUR
T4,2025-03-06T09:05:00+01:00,mystery,outgoing,1,EUR,1,XAU,70,EUR,Metal,,0,EUR,0,EUR
`;
const EXCH = `Trade Date,Instrument,Side,Quantity,Price,Fee,Fee Currency,Margin Order
2025-01-10 10:00:00,BTC_EUR,BUY,0.01,100000,1,EUR,False
2025-02-10 10:00:00,CRO_USDT,SELL,100,0.12,0.012,USDT,False
2025-02-11 10:00:00,ETH_EUR,BUY,1,3000,1,EUR,True
`;
const GENERIC = `data;tipo;conto;asset;quantità;valore_eur;asset_ricevuto;quantita_ricevuta;commissione_asset;commissione_quantita;commissione_eur;tipo_provento;nota
2025-03-01 12:00;acquisto;Ledger;BTC;0,01;600;;;;;;;
2025-05-01 12:00;permuta;Ledger;ETH;1;2.500,50;BTC;0,04;;;;;
2025-06-01 12:00;provento;Ledger;ADA;50;25;;;;;;staking;
2025-06-02 12:00;boh;Ledger;ADA;50;25;;;;;;;
`;

test('numeri e date', () => {
  eq(I.parseNum('1,234.56'), '1234.56'); eq(I.parseNum('1.234,56'), '1234.56'); eq(I.parseNum('1,5'), '1.5'); eq(I.parseNum('-0.0001'), '-0.0001');
  assert.equal(I.parseNum(''), null);
  assert.throws(() => I.parseNum('abc'));
  assert.equal(I.parseTs('2025-01-05T09:05:00+01:00').toISOString(), '2025-01-05T08:05:00.000Z');
  assert.equal(I.parseTs('05/01/2025 09:05').toISOString(), '2025-01-05T09:05:00.000Z');
});

test('CSV: virgolette, punto e virgola, righe iniziali', () => {
  const t = CT.csv.readTable('a;b;c\n"x;1";"he said ""hi""";3\n', undefined);
  assert.deepEqual(t.headers, ['a', 'b', 'c']); assert.equal(t.rows[0].a, 'x;1'); assert.equal(t.rows[0].b, 'he said "hi"');
});

test('riconoscimento automatico del tipo di file', () => {
  assert.equal(I.detectType(APP_CSV), 'cryptocom_app');
  assert.equal(I.detectType(BITPANDA_CSV), 'bitpanda');
  assert.equal(I.detectType(EXCH), 'cryptocom_exchange_trades');
  assert.equal(I.detectType(GENERIC), 'generic');
  assert.equal(I.detectType('a,b\n1,2\n'), null);
});

test('Crypto.com App', () => {
  const r = I.TYPES.cryptocom_app.parse(APP_CSV, 'app.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.SWAP, Kind.SELL, Kind.INCOME, Kind.INFO, Kind.TRANSFER_OUT, Kind.UNRESOLVED]);
  const [buy, swap, sell, inc] = r.events;
  assert.equal(buy.asset, 'BTC'); eq(buy.qty, '0.01'); eq(buy.value, 1000);
  assert.equal(swap.counterAsset, 'ETH'); eq(swap.counterQty, '0.2'); eq(swap.value, 1200);
  eq(sell.value, 1300); assert.equal(inc.incomeType, 'interest');
  assert.deepEqual(r.unknown, [{ key: 'Crypto.com App · tipo "foo_bar_baz"', count: 1 }]);
  assert.throws(() => I.TYPES.cryptocom_app.parse('a,b\n1,2\n', 'x.csv'), /colonne mancanti/);
});

test('Bitpanda: righe di testo iniziali, oro, fiat', () => {
  const r = I.TYPES.bitpanda.parse(BITPANDA_CSV, 'bp.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.FIAT_IN, Kind.BUY, Kind.SELL, Kind.UNRESOLVED]);
  const [, buy, sell] = r.events;
  assert.equal(buy.asset, 'XAU'); eq(buy.qty, 10); eq(buy.value, 500); assert.equal(buy.assetHint, 'Metal');
  eq(sell.value, 350); assert.equal(buy.ts.toISOString(), '2025-01-05T08:05:00.000Z');
});

test('Crypto.com Exchange: trade e intestazioni sconosciute', () => {
  const r = I.TYPES.cryptocom_exchange_trades.parse(EXCH, 't.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.SWAP, Kind.UNRESOLVED]);
  eq(r.events[0].value, 1000); assert.equal(r.events[0].feeAsset, 'EUR');
  assert.equal(r.events[1].counterAsset, 'USDT'); eq(r.events[1].counterQty, 12);
  assert.throws(() => I.TYPES.cryptocom_exchange_trades.parse('Foo,Bar\n1,2\n', 'x.csv'), /campi non riconosciuti/);
  assert.deepEqual(I.splitPair('ETHUSDC'), ['ETH', 'USDC']);
});

test('Modello universale: numeri all italiana, permuta, errori', () => {
  const r = I.TYPES.generic.parse(GENERIC, 'm.csv');
  assert.deepEqual(r.events.map((e) => e.kind), [Kind.BUY, Kind.SWAP, Kind.INCOME, Kind.UNRESOLVED]);
  eq(r.events[0].qty, '0.01'); eq(r.events[1].value, '2500.5'); assert.equal(r.events[1].counterAsset, 'BTC');
  assert.equal(r.events[0].account, 'Ledger');
});

test('describeFile: solo struttura, nessun importo', () => {
  const d = I.describeFile(BITPANDA_CSV);
  assert.equal(d.rows, 4); assert.ok(d.categorical['Transaction Type']);
  assert.equal(JSON.stringify(d).includes('350.00'), false);
});

test('flusso completo: App + Exchange abbinati, oro Bitpanda', () => {
  const app = I.TYPES.cryptocom_app.parse(APP_CSV, 'app.csv').events.filter((e) => e.kind !== Kind.UNRESOLVED);
  const bp = I.TYPES.bitpanda.parse(BITPANDA_CSV, 'bp.csv').events.filter((e) => e.kind !== Kind.UNRESOLVED);
  const { engine, y } = run([...app, ...bp]);
  // BTC: comprato 1000, scambiato a 1200 (+200), ETH venduto a 1300 (+100); oro: 10 g a 500 -> 5 g a 350 (+100)
  eq(y.crypto.gains, 300); eq(y.crypto.income, '0.5'); eq(y.metals.net, 100);
  assert.deepEqual(codes(engine, 'block'), ['transfer_out_unmatched']);
});

test('ZIP: estrae i CSV', async () => {
  const buf = Buffer.from(fs.readFileSync(__dirname + '/sample_zip.b64', 'utf8'), 'base64');
  const files = await CT.unzip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepEqual(files.map((f) => f.name), ['SPOT_TRADE.csv', 'TRANSFER.csv']);
  assert.ok(files[0].text.startsWith('Trade Date,Instrument'));
});
