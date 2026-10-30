import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXlsx } from '../js/core/xlsx.js';
import { readOperations, checkTotals, planImport, cryptoSymbol, findHeader } from '../js/core/invimport.js';
import { detectSheet, sheetHints, readMonths, planMonths, readNetWorth, planNetWorth, accountTypeFor, currencyFor, niceName, matchHolding, isGross } from '../js/core/sheets.js';
import { defaults, sanitize, derive, buyHistory } from '../js/core/model.js';

// file Excel con dati inventati (fatto con openpyxl): Wallet Summary, Crypto, Entrate 2026,
// Uscite 2026, Net Worth (con sezioni, Total/Gain/Loss/%, Asset Allocation, un errore di battitura)
// e un foglio "Note" che non è nessuno dei tre
const FILE = new URL('./fixtures/file-completo-esempio.xlsx', import.meta.url);
const REF = '2026-10-30';
let cache;
async function book() {
  if (!cache) cache = await readXlsx(readFileSync(FILE));
  return cache;
}
const sheet = async name => (await book()).sheets.find(s => s.name === name);

test('ogni foglio si riconosce dalla sua intestazione', async () => {
  const b = await book();
  const kinds = Object.fromEntries(b.sheets.map(s => [s.name, detectSheet(s)?.kind || null]));
  assert.deepEqual(kinds, { 'Wallet Summary': 'ops', Crypto: 'ops', 'Entrate 2026': 'months', 'Uscite 2026': 'months', 'Net Worth': 'networth', Note: null });
  assert.equal(detectSheet(await sheet('Crypto')).header.crypto, true);
  assert.equal(detectSheet(await sheet('Wallet Summary')).header.crypto, false);
});

test('crypto: COIN, QUANTITA\', VALORE, PIATTAFORMA e simboli per i prezzi', async () => {
  const sh = await sheet('Crypto');
  const hd = findHeader(sh.rows);
  for (const k of ['name', 'date', 'qty', 'price', 'amount', 'fee', 'total', 'broker', 'note']) assert.ok(hd.map[k] != null, k);
  const r = readOperations(sh.rows, hd, { nums: sh.nums });
  assert.equal(r.problems.length, 0);
  assert.equal(r.ops.length, 17);
  assert.ok(checkTotals(r).ok);
  const names = [...new Set(r.ops.map(o => `${o.name}|${o.symbol}`))];
  assert.deepEqual(names, ['Bitcoin|BTC-USD', 'Ethereum|ETH-USD', 'Solana|SOL-USD']);
  assert.ok(r.ops.every(o => o.asset === 'crypto'));
  assert.equal(r.ops.filter(o => o.kind === 'sell').length, 1);
  for (const [a, b] of [['BTC', 'BTC-USD'], ['btc', 'BTC-USD'], ['Bitcoin', 'BTC-USD'], ['ETH/EUR', 'ETH-USD'], ['SOL-EUR', 'SOL-USD'], ['Ripple', 'XRP-USD'], ['PEPE', 'PEPE-USD'], ['Un nome qualsiasi', ''], ['', '']]) assert.equal(cryptoSymbol(a), b, a);
});

test('wallet e crypto insieme: stessi conti, wallet crypto a parte, niente doppioni', async () => {
  const st = sanitize(defaults());
  const merged = { ops: [], costs: [], skipped: [], problems: [] };
  for (const n of ['Wallet Summary', 'Crypto']) {
    const sh = await sheet(n);
    const r = readOperations(sh.rows, findHeader(sh.rows), { nums: sh.nums });
    merged.ops.push(...r.ops); merged.costs.push(...r.costs);
  }
  const plan = planImport(merged, st);
  const accs = Object.fromEntries(plan.accounts.map(a => [a.name, a.type]));
  assert.deepEqual(accs, { 'Trade Republic': 'broker', Binance: 'crypto' });
  // Solana comprata su Trade Republic sta nello stesso conto degli ETF
  const sol = plan.holdings.find(x => x.symbol === 'SOL-USD');
  assert.equal(sol.acc.name, 'Trade Republic');
  assert.equal(sol.cls, 'crypto');
});

test('mese per mese: entrate con i totali delle categorie, uscite con un rimborso', async () => {
  const st = sanitize(defaults());
  const sh = await sheet('Entrate 2026');
  const det = detectSheet(sh);
  assert.deepEqual(sheetHints(sh, det), { kind: 'income', year: 2026 });
  const r = readMonths(sh.rows, det, { nums: sh.nums });
  // come il foglio di D: LAVORO (STIPENDIO, 13ESIMA, 14ESIMA, BUONI PASTO, WELFARE), MUSICA (ALTRO, DJ,
  // PRODUZIONE, GRAFICHE), INT. BANCA (CC, CD), ALTRO da solo; le righe di macro sono totali, non movimenti
  assert.deepEqual(r.lines.map(l => `${l.group}>${l.sub}`), ['LAVORO>STIPENDIO', 'LAVORO>13ESIMA', 'LAVORO>14ESIMA', 'LAVORO>BUONI PASTO', 'LAVORO>WELFARE', 'MUSICA>ALTRO', 'MUSICA>DJ', 'MUSICA>PRODUZIONE', 'MUSICA>GRAFICHE', 'INT. BANCA>CC', 'INT. BANCA>CD', 'ALTRO>']);
  assert.ok(r.checks.length === 3 && r.checks.every(c => c.ok));
  const p = planMonths(r, st, { year: 2026, kind: 'income', refDate: REF });
  assert.equal(p.total, 2539485);                                    // la somma della riga TOTALE del file
  assert.equal(p.keys.length, 12);                                   // anche 13ESIMA, ancora a zero, diventa una categoria
  // "LIQUIDITÀ A FINE 2025" (in cima) e il riepilogo sotto il TOTALE sono statistiche, non entrate
  assert.deepEqual(r.stats.map(x => x.label), ['LIQUIDITÀ A FINE 2025', 'RISPARMIO MEDIO']);
  assert.equal(p.future, 0);
  assert.ok(p.txs.every(t => t.date <= REF && t.date.endsWith(t.date.slice(0, 7) === '2026-10' ? '30' : t.date.slice(8))));
  // importato di nuovo (in qualunque conto): niente doppioni
  const again = planMonths(r, { ...st, transactions: p.txs.map((t, i) => ({ ...t, id: 't' + i, account: i % 2 ? 'a-x' : 'a-y' })) }, { year: 2026, kind: 'income', refDate: REF });
  assert.equal(again.txs.length, 0);
  assert.equal(again.dups, p.txs.length);
  const dj = p.txs.filter(t => t.name === 'DJ');
  assert.equal(dj.length, 7);
  assert.ok(dj.every(t => t.payee === 'Serate' && t.group === 'MUSICA'));

  const su = await sheet('Uscite 2026');
  const du = detectSheet(su);
  assert.equal(sheetHints(su, du).kind, 'expense');
  const ru = readMonths(su.rows, du, { nums: su.nums });
  const pu = planMonths(ru, st, { year: 2026, kind: 'expense', refDate: REF });
  assert.equal(pu.total, 1028300);
  const refund = pu.txs.filter(t => t.kind === 'income');
  assert.equal(refund.length, 1);
  assert.equal(refund[0].amount, 2500);
  // la categoria scritta solo nella prima riga vale anche per quelle sotto
  assert.ok(pu.txs.filter(t => t.name === 'BOLLETTE').every(t => t.group === 'CASA'));
});

test('un rimborso nella stessa categoria riduce le uscite della tabella', () => {
  const st = sanitize(defaults());
  st.accounts.push({ id: 'a-1', name: 'Conto', type: 'checking', currency: 'EUR', inNetWorth: true });
  const tx = (id, kind, amount, date) => ({ id, date, kind, amount, account: 'a-1', category: 'c-bollette', payee: 'Luce', created: 1, updated: 1 });
  st.transactions.push(tx('t-1', 'expense', 9500, '2026-01-31'), tx('t-2', 'income', 2500, '2026-01-31'));
  const s2 = sanitize(st);
  const T = derive(s2, REF).yearTable(2026, 'expense');
  assert.equal(T.total, 7000);
  assert.equal(derive(s2, REF).yearTable(2026, 'income').total, 0);
});

test('Net Worth: sezioni, totali saltati, valori strani, titoli, conti dei broker, TFR netto', async () => {
  const st = sanitize(defaults());
  const sh = await sheet('Net Worth');
  const det = detectSheet(sh);
  const r = readNetWorth(sh.rows, det, { nums: sh.nums });
  assert.equal(r.dates.length, 13);
  assert.equal(r.dates[0], '2025-12-31');
  assert.equal(r.checks.length, 5);
  assert.ok(r.checks.every(c => c.ok));
  const names = r.accounts.map(a => a.name);
  assert.deepEqual(names, ['Conto BancaX', 'Trade Republic', 'Scalable Capital', 'Contanti', 'Conto USD', 'S&P 500', 'Emerging Markets', 'Gold', 'Xeon', 'Rocket Lab', 'Bitcoin', 'Ethereum', 'TFR Lordo', 'TFR Netto']);
  assert.ok(!names.some(n => /total|gain|%|^cash$|allocation/i.test(n)));
  // titoli del foglio delle operazioni (come li prepara planImport): le loro righe diventano i loro valori di fine mese
  const holdings = [
    { name: 'Vanguard S&P 500 UCITS ETF', group: 'Azioni USA (S&P 500)', symbol: '' },
    { name: 'iShares Core MSCI Emerging Markets IMI UCITS ETF', group: 'Azioni globali / emergenti', symbol: '' },
    { name: 'Invesco Physical Gold A', group: 'Gold', symbol: '' },
    { name: 'Rocket Lab', group: 'Rocket Lab', symbol: '' },
    { name: 'Bitcoin', group: '', symbol: 'BTC-USD' }, { name: 'Ethereum', group: '', symbol: 'ETH-USD' },
  ];
  const p = planNetWorth(r, st, { refDate: REF, holdings, investNames: ['Trade Republic', 'Binance'] });
  const row = n => p.rows.find(x => x.name === n || x.institution === n);
  assert.deepEqual(p.rows.filter(x => x.on && !x.holding).map(x => x.name), ['Conto BancaX', 'Trade Republic – Conto corrente', 'Scalable Capital', 'Contanti', 'Conto USD', 'TFR Netto']);
  assert.deepEqual(p.rows.filter(x => x.on && x.holding).map(x => x.name), ['S&P 500', 'Emerging Markets', 'Gold', 'Rocket Lab', 'Bitcoin', 'Ethereum']);
  // Trade Republic e Scalable nella liquidità: il conto corrente e il conto deposito, non il conto titoli
  assert.equal(row('Trade Republic').type, 'checking');
  assert.equal(row('Trade Republic').institution, 'Trade Republic');
  assert.equal(row('Scalable Capital').type, 'savings');
  assert.equal(row('Conto BancaX').type, 'checking');
  assert.equal(row('Contanti').type, 'cash');
  assert.equal(row('Conto USD').currency, 'USD');
  assert.equal(row('TFR Netto').type, 'receivable');
  // il TFR lordo non si somma mai
  assert.equal(row('TFR Lordo').gross, true);
  assert.equal(row('TFR Lordo').on, false);
  assert.match(row('Xeon').reason, /zero/);
  assert.equal(isGross({ name: 'TFR', section: 'WORK' }, [{ name: 'TFR', section: 'WORK' }, { name: 'TFR NETTO', section: 'WORK' }]), true);
  assert.equal(isGross({ name: 'Stipendio', section: 'WORK' }, [{ name: 'Stipendio', section: 'WORK' }, { name: 'TFR NETTO', section: 'WORK' }]), false);
  // l'errore di battitura (500.000 € di contanti) è escluso; le date future pure
  assert.equal(row('Contanti').odd.length, 1);
  assert.equal(row('Contanti').values.length, 9);
  assert.ok(row('Conto BancaX').values.every(v => v.date <= REF));
  assert.equal(row('Conto BancaX').future, 3);
  const withOdd = planNetWorth(r, st, { refDate: REF, holdings, includeOdd: true });
  assert.equal(withOdd.rows.find(x => x.name === 'Contanti').values.length, 10);
});

test('Net Worth come il foglio: sezioni, Total, Gain/Loss e %, valori dei titoli a fine mese, Asset Allocation', () => {
  const st = sanitize(defaults());
  st.accounts.push(
    { id: 'a-cc', name: 'Conto', type: 'checking', currency: 'EUR', inNetWorth: true },
    { id: 'a-tr', name: 'Broker', type: 'broker', currency: 'EUR', inNetWorth: true },
    { id: 'a-tl', name: 'TFR lordo', type: 'receivable', currency: 'EUR', inNetWorth: false });
  st.valuations.push(
    { id: 'v-1', account: 'a-cc', date: '2025-12-31', value: 100000, kind: 'open', created: 1 },
    { id: 'v-2', account: 'a-cc', date: '2026-01-31', value: 110000, kind: 'adjust', created: 2 },
    { id: 'v-3', account: 'a-tl', date: '2025-12-31', value: 999900, kind: 'open', created: 3 });
  st.holdings.push({ id: 'h-1', account: 'a-tr', name: 'Vanguard S&P 500', cls: 'etf_eq', currency: 'EUR', price: 110, priceDate: '2026-02-10', ops: [{ id: 'o-1', date: '2025-12-15', type: 'buy', qty: 10, price: 100, fee: 0, created: 4 }] });
  st.snapshots['2025-12'] = { byAcc: {}, byHd: { 'h-1': 98000 } };
  st.snapshots['2026-01'] = { byAcc: {}, byHd: { 'h-1': 105000 } };
  st.settings.nwLayout = { sections: [{ name: 'Cash - Liquidity', color: 3, items: ['a:a-cc'] }, { name: 'ETF', color: 1, items: ['h:h-1'] }], labels: { 'h:h-1': 'S&P 500' } };
  const d = derive(sanitize(st), '2026-02-10');
  const S0 = d.nwSheet(2026);
  assert.deepEqual(S0.sections.map(x => x.name), ['Cash - Liquidity', 'ETF']);
  const etf = S0.sections[1];
  assert.equal(etf.rows[0].label, 'S&P 500');
  assert.deepEqual(etf.total.slice(0, 3), [98000, 105000, 110000]);     // 31/12 e 31/01 dal foglio, febbraio = oggi (10 × 110)
  assert.deepEqual(etf.gain.slice(0, 3), [null, 7000, 5000]);
  assert.equal(Math.round(etf.pct[1] * 100) / 100, 7.14);
  assert.deepEqual(S0.total.slice(0, 3), [198000, 215000, 220000]);
  // il lordo fuori dal patrimonio non c'è
  assert.ok(!S0.sections.some(x => x.rows.some(rr => rr.label === 'TFR lordo')));
  // i mesi futuri restano vuoti
  assert.equal(S0.total[5], null);
  const alloc = S0.alloc.find(x => x.name === 'ETF').pct[1];
  assert.equal(Math.round(alloc * 10) / 10, Math.round(105000 / 215000 * 1000) / 10);
  // il patrimonio di fine gennaio usa gli stessi valori dei titoli
  assert.equal(d.netWorthAt('2026-01-31').total, 215000);
});

test('tipi di conto, valute e nomi', () => {
  assert.equal(accountTypeFor('Cash - Liquidity', 'Euro', 'Banca'), 'checking');
  assert.equal(accountTypeFor('Cash - Liquidity', 'Euro', 'Contanti'), 'cash');
  assert.equal(accountTypeFor('Cash', '', 'Conto deposito'), 'savings');
  assert.equal(accountTypeFor('Crypto', '', 'Ledger'), 'crypto');
  assert.equal(accountTypeFor('Previdenza', '', 'Fondo pensione'), 'pension');
  assert.equal(accountTypeFor('Debiti', '', 'Mutuo casa'), 'debt');
  assert.equal(currencyFor('Dollari'), 'USD');
  assert.equal(currencyFor('Euro'), null);
  assert.equal(niceName('INT.  BANCA '), 'INT. BANCA');
  assert.equal(niceName('Groover'), 'Groover');
  assert.equal(matchHolding('S&P 500', [{ name: 'Vanguard S&P 500 UCITS ETF', group: '', symbol: '' }])?.name, 'Vanguard S&P 500 UCITS ETF');
  assert.equal(matchHolding('Conto BancaX', [{ name: 'Vanguard S&P 500 UCITS ETF', group: '', symbol: '' }]), null);
});

test('storia degli acquisti: quanto, quando, ogni quanto', () => {
  const ops = [];
  for (let m = 1; m <= 10; m++) ops.push({ id: 'o' + m, date: `2026-${String(m).padStart(2, '0')}-16`, type: 'buy', qty: 1, price: 100 + m, fee: 1, tax: 0, amount: 0, created: m });
  ops.push({ id: 'x', date: '2026-04-02', type: 'buy', qty: 5, price: 90, fee: 1, tax: 0, amount: 0, created: 50 });
  ops.push({ id: 'y', date: '2026-09-20', type: 'sell', qty: 2, price: 120, fee: 1, tax: 2, amount: 0, created: 60 });
  const H = buyHistory({ ops }, REF);
  assert.equal(H.buys, 11);
  assert.equal(H.sells, 1);
  assert.equal(H.spent, 1055 + 10 + 451);
  assert.equal(H.received, 240 - 1 - 2);
  assert.equal(H.regular, true);                      // un acquisto in più non cambia il PAC mensile
  assert.ok(H.median >= 28 && H.median <= 31);
  assert.equal(H.first, '2026-01-16');
  assert.equal(H.last, '2026-10-16');
  assert.equal(H.sinceLast, 14);
  assert.equal(H.minP.price, 90);
  assert.equal(H.maxP.date, '2026-10-16');
  assert.equal(H.biggest.date, '2026-04-02');
  assert.equal(H.monthsWith, 10);
  assert.equal(H.byYear.length, 1);
  const one = buyHistory({ ops: [ops[0]] }, REF);
  assert.equal(one.median, null);
  assert.equal(one.regular, false);
});
