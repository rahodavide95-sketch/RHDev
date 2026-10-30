import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXlsx, excelDate, isZip, unzip, XlsxError } from '../js/core/xlsx.js';
import { findHeader, readOperations, checkTotals, planImport, cellNumber, assetClass } from '../js/core/invimport.js';
import { parseCSV } from '../js/core/csv.js';
import { defaults, sanitize } from '../js/core/model.js';

// file Excel con dati inventati (fatto con openpyxl): titolo, riga vuota, intestazione alla riga 3,
// separatore "2025", riga promemoria senza numeri, imposta di bollo, vendita con quote negative
const FILE = new URL('./fixtures/portafoglio-esempio.xlsx', import.meta.url);

async function sheet() {
  const buf = readFileSync(FILE);
  assert.ok(isZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  const book = await readXlsx(buf);
  return { book, sh: book.sheets[0] };
}

test('xlsx: fogli, celle, date e percentuali', async () => {
  const { book, sh } = await sheet();
  assert.deepEqual(book.sheets.map(s => s.name), ['Portafoglio', 'Altro']);
  assert.equal(sh.nums[0], 1);
  const hd = findHeader(sh.rows);
  assert.equal(sh.nums[hd.index], 3);
  for (const k of ['date', 'asset', 'group', 'name', 'qty', 'price', 'amount', 'fee', 'ter', 'tax', 'total', 'broker', 'note']) assert.ok(hd.map[k] != null, k);
  // la colonna "RIEPILOGO" a destra non viene presa
  assert.equal(Object.values(hd.map).includes(14), false);
  assert.equal(excelDate(45658), '2025-01-01');
  assert.equal(excelDate(45658, true), '2029-01-02');
  assert.equal(excelDate('x'), null);
});

test('xlsx: file non validi', async () => {
  await assert.rejects(readXlsx(new Uint8Array([1, 2, 3, 4, 5])), XlsxError);
  await assert.rejects(unzip(new Uint8Array(30)), XlsxError);
});

test('righe del foglio: acquisti, vendita con imposta, bollo, ISIN, TER', async () => {
  const { sh } = await sheet();
  const read = readOperations(sh.rows, findHeader(sh.rows), { nums: sh.nums });
  assert.deepEqual(read.problems, []);
  assert.equal(read.ops.length, 5);
  assert.equal(read.costs.length, 1);
  assert.equal(read.skipped.length, 2);        // "2025" e la riga "ribilanciamento"
  const sell = read.ops.find(o => o.kind === 'sell');
  assert.equal(sell.date, '2025-06-10');
  assert.equal(sell.qty, 3);
  assert.equal(sell.price, 110);
  assert.equal(sell.fee, 1);
  assert.equal(sell.tax, 2.5);
  const stock = read.ops.find(o => o.isin);
  assert.equal(stock.isin, 'IT0000000001');
  assert.equal(stock.name, 'Azione Esempio');
  assert.equal(read.ops[0].ter, 0.22);
  assert.equal(read.costs[0].amount, 1.5);
  assert.equal(read.costs[0].note, '01.01.2025 - 31.03.2025');
  const chk = checkTotals(read);
  assert.ok(chk.ok);
  assert.equal(chk.checked, 6);
  assert.equal(chk.fileSum, 1001 + 510 + 1.5 - 326.5 + 101 + 200);
  // un totale sbagliato nel file viene segnalato con il numero di riga
  const bad = { ...read, ops: read.ops.map((o, i) => (i === 1 ? { ...o, fileTotal: 512 } : o)) };
  const c2 = checkTotals(bad);
  assert.equal(c2.ok, false);
  assert.deepEqual(c2.bad.map(x => x.row), [read.ops[1].row]);
});

test('piano: conto e titoli nuovi, poi doppioni esclusi', async () => {
  const { sh } = await sheet();
  const read = readOperations(sh.rows, findHeader(sh.rows), { nums: sh.nums });
  const st = sanitize(defaults());
  const plan = planImport(read, st);
  assert.deepEqual(plan.accounts.map(a => [a.name, a.existingId, a.first]), [['Broker Esempio', null, '2025-01-15']]);
  assert.deepEqual(plan.holdings.map(x => [x.name, x.cls, x.group, x.ops.length]), [
    ['ETF Mondo Esempio', 'etf_eq', 'Mondo', 3], ['Azione Esempio', 'stock', 'Azione Esempio', 1], ['ETC Oro Esempio', 'gold', 'Oro', 1]]);
  assert.equal(plan.holdings[2].ter, 0.12);
  assert.equal(plan.count, 6);
  assert.deepEqual(plan.byKind, { buy: 4, sell: 1 });

  // stessi dati già presenti: niente da importare
  const s2 = sanitize({
    ...st,
    accounts: [{ id: 'b1', name: 'broker esempio', type: 'broker', currency: 'EUR' }],
    holdings: plan.holdings.map((x, i) => ({ id: 'h' + i, account: 'b1', name: x.name, isin: x.isin, cls: x.cls, currency: 'EUR', ops: x.ops.map((o, j) => ({ id: `o${i}-${j}`, date: o.date, type: o.kind, qty: o.qty, price: o.price, fee: o.fee, tax: o.tax, amount: o.amount, created: 1 })) })),
    transactions: [{ id: 't1', date: '2025-03-01', kind: 'expense', amount: 150, account: 'b1', payee: 'Imposta di bollo', created: 1 }],
  });
  const again = planImport(read, s2);
  assert.equal(again.count, 0);
  assert.equal(again.dups, 6);
  assert.equal(again.accounts.length, 0);
});

test('CSV come lo esporta Excel in italiano', () => {
  const csv = [
    'WALLET SUMMARY',
    'DATA ACQUISTO;ASSET;CATEGORY;INFO;QUOTE;COSTO QUOTA;IMPORTO;FEE;TER;IMPOSTA;TOTALE;BROKER;NOTE',
    '2025;;;;;;;€ -;;€ -;;;',
    '08/09/2025;ETF-A;Azioni USA;ETF Esempio;28,31;€ 105,96;€ 3.000,14;€ 1,00;;€ -;€ 3.001,14;Broker;PAC',
    '06/10/2025;TASSE;Imposta di bollo (Titoli);01.07.2025 - 30.09.2025;;;;€ -;;€ 2,87;€ 2,87;Broker;',
    '07/10/2025;ETF-O;Obbligazioni;Bond Esempio;-21,08;€ 23,77;-€ 501,03;€ 1,00;0,20%;€ 0,27;-€ 499,76;Broker;Venduto',
    ';ETC;Gold;Oro Esempio;;;;;;;;;ribilanciamento',
  ].join('\r\n');
  const { rows } = parseCSV(csv);
  const hd = findHeader(rows);
  assert.equal(hd.index, 1);
  const read = readOperations(rows, hd);
  assert.deepEqual(read.problems, []);
  assert.equal(read.ops.length, 2);
  assert.equal(read.costs.length, 1);
  assert.equal(read.ops[0].qty * read.ops[0].price, 3000.14);
  assert.equal(read.ops[1].kind, 'sell');
  assert.equal(read.ops[1].ter, 0.2);
  assert.ok(checkTotals(read).ok);
});

test('numeri e tipi di titolo', () => {
  assert.equal(cellNumber('€ 3.000,14', { money: true }), 3000.14);
  assert.equal(cellNumber('€ -', { money: true }), null);
  assert.equal(cellNumber('-€ 501,03', { money: true }), -501.03);
  assert.equal(cellNumber('(12,50)', { money: true }), -12.5);
  assert.equal(cellNumber('1.500', { money: true }), 1500);
  assert.equal(cellNumber('1.500'), 1.5);
  assert.equal(cellNumber('0.035', { money: true }), 0.035);
  assert.equal(cellNumber('1,234.56', { money: true }), 1234.56);
  assert.equal(cellNumber('12,5%'), 12.5);
  assert.equal(cellNumber('2025-09-08'), null);
  assert.equal(cellNumber('=A1+B2'), null);
  assert.equal(cellNumber(7), 7);
  for (const [t, k] of [['ETF-A', 'etf_eq'], ['ETF-O', 'etf_bd'], ['ETF-M', 'etf_mm'], ['ETC', 'gold'], ['STOCK', 'stock'], ['ETF azionario', 'etf_eq'], ['Oro e materie prime (ETC)', 'gold'], ['Crypto', 'crypto'], ['BTP', 'gov'], ['', null]]) assert.equal(assetClass(t), k, t);
});
