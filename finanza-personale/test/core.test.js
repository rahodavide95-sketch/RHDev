import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseDecimal, formatMoney, formatCompact, convert } from '../js/core/money.js';
import { addMonths, occurrences, nextOccurrence, parseDateFlexible, isISODate, diffDays, perYear } from '../js/core/dates.js';
import { simPAC, simInterest, simLoan, simFIRE, simBond, irr, loanResidual, simTrueCost, simInflation } from '../js/core/finance.js';
import { defaults, sanitize, derive, position, buildLedger, cashBalance, suggestCategory, importHash, paidInstallments } from '../js/core/model.js';
import { parseCSV, guessMapping, rowsToTransactions, toCSV, hasHeader } from '../js/core/csv.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('importi scritti all\'italiana e all\'inglese', () => {
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('1234,5'), 123450);
  assert.equal(parseAmount('1.500'), 150000);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('€ 2.000'), 200000);
  assert.equal(parseAmount('-35,90'), -3590);
  assert.equal(parseAmount('0,1+0,2'), 30);
  assert.equal(parseAmount('12,50*2+1'), 2600);
  assert.equal(parseAmount('(10+5)/3'), 500);
  assert.equal(parseAmount('1.234.567,89'), 123456789);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('5/0'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('2+'), null);
  assert.equal(parseAmount('1e5'), null);
  assert.equal(parseAmount('alert(1)'), null);
  assert.equal(parseDecimal('0,0035'), 0.0035);
  assert.equal(parseDecimal('1.234'), 1.234);
  assert.equal(parseDecimal('3,5%'), 3.5);
});

test('formattazione', () => {
  assert.equal(formatMoney(123456), '1.234,56 €');
  assert.equal(formatMoney(-500), '−5,00 €');
  assert.equal(formatMoney(500, 'EUR', { sign: true }), '+5,00 €');
  assert.equal(formatCompact(1234567), '€ 12k');
  assert.equal(formatCompact(250000000), '€ 2,5 Mln');
  assert.equal(convert(10000, 'USD', 'EUR', { EUR: 1, USD: 1.25 }), 8000);
  assert.equal(convert(10000, 'EUR', 'EUR', {}), 10000);
});

test('date e ricorrenze', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-03-10', -3), '2025-12-10');
  const r = { unit: 'month', every: 1, start: '2026-01-31' };
  assert.deepEqual(occurrences(r, '2026-01-01', '2026-05-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(nextOccurrence(r, '2026-03-01'), '2026-03-31');
  assert.equal(nextOccurrence({ ...r, end: '2026-02-15' }, '2026-03-01'), null);
  assert.deepEqual(occurrences({ unit: 'week', every: 2, start: '2026-10-01' }, '2026-10-10', '2026-11-01'), ['2026-10-15', '2026-10-29']);
  assert.deepEqual(occurrences({ unit: 'year', every: 1, start: '2024-02-29' }, '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.equal(occurrences({ unit: 'day', every: 1, start: '2020-01-01' }, '2026-01-01', '2026-01-03').length, 3);
  assert.equal(parseDateFlexible('29/10/2026'), '2026-10-29');
  assert.equal(parseDateFlexible('29.10.26'), '2026-10-29');
  assert.equal(parseDateFlexible('2026-10-29T10:00:00Z'), '2026-10-29');
  assert.equal(parseDateFlexible('10/29/2026', 'mdy'), '2026-10-29');
  assert.equal(parseDateFlexible('31/02/2026'), null);
  assert.equal(parseDateFlexible('12 ottobre 2026'), '2026-10-12');
  assert.ok(isISODate('2026-02-28') && !isISODate('2026-02-30'));
  assert.equal(diffDays('2026-10-29', '2026-11-01'), 3);
  near(perYear({ unit: 'month', every: 3 }), 4);
});

test('PAC: la tassa si paga solo alla vendita, sul guadagno', () => {
  const r = simPAC({ initial: 10000, contribution: 0, years: 10, annualReturn: 5, ter: 0, inflation: 0, taxRate: 26, bollo: false });
  near(r.totals.value, 10000 * Math.pow(1.05, 10), 0.01);
  near(r.totals.tax, (10000 * Math.pow(1.05, 10) - 10000) * 0.26, 0.01);
  near(r.totals.netIrr, ((Math.pow(1.05, 10) - 1) * 0.74 + 1) ** (1 / 10) * 100 - 100, 0.001);
  // versamenti mensili senza rendimento: il valore è la somma dei versamenti
  const z = simPAC({ initial: 0, contribution: 100, freq: 12, years: 2, annualReturn: 0, ter: 0, bollo: false });
  near(z.totals.value, 2400);
  near(z.totals.tax, 0);
  // il TER riduce il rendimento: 5% lordo con 1% di costi
  const t = simPAC({ initial: 1000, years: 1, annualReturn: 5, ter: 1, bollo: false, inflation: 0 });
  near(t.totals.value, 1000 * 1.05 * 0.99);
  // costi effettivamente pagati, mese per mese, sul valore del momento (~1% di ~1.025 €)
  assert.ok(t.totals.ter > 10 && t.totals.ter < 10.5, String(t.totals.ter));
  // bollo 0,20% del valore a fine anno
  const b = simPAC({ initial: 10000, years: 1, annualReturn: 0, ter: 0, bollo: true, inflation: 0 });
  near(b.totals.bollo, 20);
  near(b.totals.net, 9980);
  // un PAC può partire da zero (il vecchio calcolatore lo rifiutava)
  assert.ok(simPAC({ initial: 0, contribution: 200, years: 20, annualReturn: 6 }).totals.net > 48000);
  // scenari: pessimista < base < ottimista
  const s = simPAC({ initial: 5000, contribution: 300, years: 15, annualReturn: 6, spread: 2 });
  assert.ok(s.totals.lowNet < s.totals.net && s.totals.net < s.totals.highNet);
});

test('conto deposito e conto corrente', () => {
  // 10.000 € al 3% per 12 mesi, interessi a fine anno: 300 lordi, 222 netti
  const d = simInterest({ capital: 10000, rate: 3, months: 12, period: 12, compound: true, bollo: 'none' });
  near(d.totals.gross, 300);
  near(d.totals.tax, 78);
  near(d.totals.final, 10222);
  near(d.totals.netYield, 2.22, 0.001);
  // bollo 0,20% annuo
  const b = simInterest({ capital: 10000, rate: 0, months: 12, period: 12, bollo: 'percent' });
  near(b.totals.bollo, 20);
  // conto corrente: 34,20 € solo con giacenza media oltre 5.000 €
  near(simInterest({ capital: 6000, rate: 0, months: 12, bollo: 'fixed' }).totals.bollo, 34.2);
  near(simInterest({ capital: 4000, rate: 0, months: 12, bollo: 'fixed' }).totals.bollo, 0);
  near(simInterest({ capital: 6000, rate: 0, months: 6, bollo: 'fixed' }).totals.bollo, 17.1);
  // capitalizzazione trimestrale > interessi pagati a parte
  const c = simInterest({ capital: 10000, rate: 4, months: 36, period: 3, compound: true });
  const s = simInterest({ capital: 10000, rate: 4, months: 36, period: 3, compound: false });
  assert.ok(c.totals.final > s.totals.final);
  near(s.totals.final, 10000 + 10000 * 0.04 * 3 * 0.74, 0.01);
});

test('mutuo alla francese e TAEG', () => {
  const r = simLoan({ principal: 100000, tan: 3, months: 240 });
  near(r.totals.firstRata, 554.6, 0.01);
  near(r.rows[r.rows.length - 1].balance, 0, 0.001);
  assert.equal(r.rows.length, 240);
  near(r.totals.taeg, (Math.pow(1.0025, 12) - 1) * 100, 0.0001);
  // con spese iniziali il TAEG sale
  assert.ok(simLoan({ principal: 100000, tan: 3, months: 240, upfront: 1500 }).totals.taeg > r.totals.taeg);
  // estinzione parziale: stessa rata, meno mesi
  const p = simLoan({ principal: 100000, tan: 3, months: 240, prepayments: [{ month: 60, amount: 20000, mode: 'durata' }] });
  assert.ok(p.rows.length < 240 && p.totals.interest < r.totals.interest);
  near(p.rows[p.rows.length - 1].balance, 0, 0.001);
  // estinzione parziale: stessa durata, rata più bassa
  const q = simLoan({ principal: 100000, tan: 3, months: 240, prepayments: [{ month: 60, amount: 20000, mode: 'rata' }] });
  assert.equal(q.rows.length, 240);
  assert.ok(q.rows[100].rata < r.rows[100].rata);
  // all'italiana: quota capitale costante
  const it = simLoan({ principal: 12000, tan: 6, months: 12, type: 'italiano' });
  near(it.rows[0].capital, 1000); near(it.rows[11].capital, 1000);
  near(it.rows[0].interest, 60);
  // tasso zero
  near(simLoan({ principal: 1200, tan: 0, months: 12 }).totals.firstRata, 100);
  near(loanResidual({ principal: 100000, tan: 3, months: 240 }, 0), 100000);
  near(loanResidual({ principal: 100000, tan: 3, months: 240 }, 240), 0);
  assert.equal(paidInstallments({ start: '2026-01-15', months: 240 }, '2026-03-14'), 1);
  assert.equal(paidInstallments({ start: '2026-01-15', months: 240 }, '2026-03-15'), 2);
});

test('FIRE, obbligazioni, inflazione, costo vero', () => {
  const f = simFIRE({ annualExpenses: 20000, assets: 500000, monthlySaving: 0, realReturn: 0, swr: 4 });
  near(f.target, 500000);
  assert.equal(f.months, 0);
  const g = simFIRE({ annualExpenses: 24000, assets: 0, monthlySaving: 1000, realReturn: 0, swr: 4 });
  assert.equal(g.months, 600);
  assert.ok(g.sensitivity[0].months < g.months);
  // BTP alla pari: rendimento lordo = cedola (capitalizzata due volte l'anno)
  const b = simBond({ price: 100, coupon: 4, freq: 2, years: 5, taxRate: 12.5 });
  near(b.totals.grossYtm, (Math.pow(1.02, 2) - 1) * 100, 0.0001);
  near(b.totals.netYtm, (Math.pow(1 + 0.02 * 0.875, 2) - 1) * 100, 0.0001);
  const under = simBond({ price: 95, coupon: 2, freq: 1, years: 3, taxRate: 12.5 });
  assert.ok(under.totals.grossYtm > 2 && under.totals.netYtm < under.totals.grossYtm);
  near(irr([-100, 110]), 0.1, 1e-9);
  assert.equal(irr([100, 100]), null);
  const i = simInflation({ amount: 1000, years: 10, rate: 2 });
  near(i.totals.purchasingPower, 1000 / Math.pow(1.02, 10));
  const c = simTrueCost({ monthly: 10, years: 1, annualReturn: 0 });
  near(c.totals.spent, 120); near(c.totals.invested, 120);
});

function sampleState() {
  const s = defaults();
  s.accounts.push({ id: 'a1', name: 'Conto', type: 'checking', currency: 'EUR', inNetWorth: true, archived: false, created: 1, plan: null });
  s.accounts.push({ id: 'a2', name: 'USD', type: 'checking', currency: 'USD', inNetWorth: true, archived: false, created: 1, plan: null });
  s.accounts.push({ id: 'a3', name: 'Mutuo', type: 'mortgage', currency: 'EUR', inNetWorth: true, archived: false, created: 1, plan: { principal: 100000, tan: 3, months: 240, start: '2026-01-15', type: 'francese' } });
  s.accounts.push({ id: 'b1', name: 'Broker', type: 'broker', currency: 'EUR', inNetWorth: true, archived: false, created: 1, plan: null });
  s.valuations.push({ id: 'v1', account: 'a1', date: '2026-10-01', value: 100000, created: 1000, kind: 'open' });
  s.fx.rates = { EUR: 1, USD: 1.25 };
  const tx = (id, date, kind, amount, extra = {}) => s.transactions.push({ id, date, kind, amount, account: 'a1', category: kind === 'expense' ? 'c-spesa' : kind === 'income' ? 'i-stip' : null, payee: '', note: '', tags: [], created: 2000, ...extra });
  tx('t1', '2026-10-05', 'expense', 2500, { payee: 'Esselunga' });
  tx('t2', '2026-10-10', 'income', 200000);
  tx('t3', '2026-10-12', 'transfer', 12500, { toAccount: 'a2', amountTo: 15000 });
  tx('t4', '2026-09-20', 'expense', 1000);                      // prima del saldo iniziale: già compresa
  tx('t5', '2026-10-01', 'expense', 700, { created: 500 });     // stesso giorno, inserita prima del saldo
  tx('t6', '2026-10-01', 'expense', 300, { created: 1500 });    // stesso giorno, inserita dopo
  s.holdings.push({ id: 'h1', account: 'b1', symbol: 'VWCE', name: 'VWCE', cls: 'etf_eq', currency: 'EUR', price: 120, priceDate: '2026-10-29', ops: [
    { id: 'o1', date: '2026-01-10', type: 'buy', qty: 10, price: 100, fee: 2, amount: 0, created: 1 },
    { id: 'o2', date: '2026-03-10', type: 'buy', qty: 10, price: 110, fee: 2, amount: 0, created: 2 },
    { id: 'o3', date: '2026-06-10', type: 'sell', qty: 5, price: 115, fee: 1, amount: 0, created: 3 },
    { id: 'o4', date: '2026-07-01', type: 'div', qty: 0, price: 0, fee: 0, amount: 12, created: 4 },
  ] });
  return sanitize(s);
}

test('saldi con punto fermo, giroconti in valuta, mutuo e titoli', () => {
  const s = sampleState();
  const d = derive(s, '2026-10-29');
  // 1000 − 3 (dopo il saldo) − 25 + 2000 − 125 = 2847 €
  assert.equal(d.balances.get('a1'), 284700);
  assert.equal(d.balances.get('a2'), 15000);                    // 150 USD
  // prima del punto fermo si ricostruisce all'indietro: a fine settembre 1000 + 7 = 1007 €
  assert.equal(d.accountValue(s.accounts[0], '2026-09-30'), 100700);
  assert.equal(d.accountValue(s.accounts[0], '2026-09-19'), 100700 + 1000);
  const mortgage = s.accounts.find(a => a.id === 'a3');
  near(-d.balances.get('a3') / 100, loanResidual(mortgage.plan, 9), 0.01);
  // posizione a costo medio ponderato
  const p = position(s.holdings[0]);
  near(p.qty, 15);
  near(p.avg, 2104 / 20);
  near(p.realized, 5 * 115 - 1 - 5 * 2104 / 20);
  near(p.dividends, 12);
  assert.equal(d.balances.get('b1'), 180000);
  // patrimonio: 2847 + 150/1.25 + 1800 − mutuo
  assert.equal(d.netWorth, 284700 + 12000 + 180000 + d.balances.get('a3'));
  const f = d.flows('2026-10-01', '2026-10-31');
  assert.equal(f.income, 200000);
  assert.equal(f.expense, 2500 + 700 + 300);
  const h = d.netWorthHistory(3);
  assert.equal(h.length, 3);
  assert.equal(h[2].total, d.netWorth);
});

test('budget, scadenze, obiettivi', () => {
  const s = sampleState();
  s.budgets['c-spesa'] = 10000;
  s.recurring.push({ id: 'r1', name: 'Netflix', kind: 'expense', amount: 1299, account: 'a1', category: 'c-abbon', unit: 'month', every: 1, start: '2026-08-15', active: true, autoPost: false, lastPosted: '2026-08-15', created: 1 });
  s.goals.push({ id: 'g1', name: 'Vacanza', target: 300000, date: '2027-04-29', contributions: [{ id: 'c1', date: '2026-10-01', amount: 100000 }], created: 1 });
  const c = sanitize(s);
  const d = derive(c, '2026-10-29');
  const b = d.budget('2026-10');
  assert.equal(b.rows[0].spent, 3500);
  assert.equal(b.planned, 10000);
  assert.deepEqual(d.dueList().map(x => x.date), ['2026-09-15', '2026-10-15']);
  assert.equal(d.upcoming(30)[0].date, '2026-11-15');
  near(d.fixedMonthly, 1299, 0.5);
  const g = d.goal(c.goals[0]);
  assert.equal(g.saved, 100000);
  assert.equal(g.monthsLeft, 6);
  assert.equal(g.perMonth, Math.ceil(200000 / 6));
});

test('sanitize: dati rotti o manomessi non passano', () => {
  const s = sanitize({
    accounts: [{ id: 'ok', name: '<b>x</b>', type: 'boh' }, { id: '../../etc', name: 'no' }, null],
    transactions: [
      { id: 't1', date: '2026-13-01', kind: 'expense', amount: 5, account: 'ok' },
      { id: 't2', date: '2026-01-01', kind: 'hack', amount: 5, account: 'ok' },
      { id: 't3', date: '2026-01-01', kind: 'expense', amount: 'NaN', account: 'ok', tags: ['A', 'a', 5] },
      { id: 't3', date: '2026-01-02', kind: 'expense', amount: 1, account: 'ok' },
      { id: 't4', date: '2026-01-01', kind: 'transfer', amount: 5, account: 'ok', toAccount: 'ok' },
    ],
    settings: { lockMinutes: 9999, theme: 'javascript:' },
    fx: { rates: { USD: -1, XXX: 3, GBP: 0.85 } },
    __proto__: { polluted: true },
  });
  assert.equal(s.accounts.length, 1);
  assert.equal(s.accounts[0].type, 'checking');
  assert.equal(s.transactions.length, 1);
  assert.equal(s.transactions[0].amount, 0);
  assert.deepEqual(s.transactions[0].tags, ['a']);
  assert.equal(s.settings.lockMinutes, 5);
  assert.equal(s.settings.theme, 'auto');
  assert.deepEqual(s.fx.rates, { EUR: 1, GBP: 0.85 });
  assert.ok(s.categories.length > 20);
  assert.deepEqual(sanitize(null).accounts, []);
});

test('categoria suggerita e impronta dei doppioni', () => {
  const s = sampleState();
  s.rules.push({ id: 'r1', match: 'netflix', category: 'c-abbon', payee: 'Netflix' });
  assert.equal(suggestCategory(s, 'PAGAMENTO NETFLIX.COM', 'expense').category, 'c-abbon');
  assert.equal(suggestCategory(s, 'esselunga', 'expense').category, 'c-spesa');
  assert.equal(suggestCategory(s, 'boh', 'expense'), null);
  const a = importHash({ account: 'a1', date: '2026-10-01', kind: 'expense', amount: 100, payee: 'Bar  Roma' });
  const b = importHash({ account: 'a1', date: '2026-10-01', kind: 'expense', amount: 100, payee: 'bar roma' });
  assert.equal(a, b);
  assert.notEqual(a, importHash({ account: 'a1', date: '2026-10-01', kind: 'expense', amount: 101, payee: 'bar roma' }));
});

test('CSV della banca', () => {
  const text = '﻿Data operazione;Data valuta;Descrizione;Importo\n29/10/2026;29/10/2026;"PAGAMENTO POS ""BAR"" ROMA";-3,50\n28/10/2026;28/10/2026;Stipendio ottobre;1.850,00\n\n27/10/2026;27/10/2026;Riga senza importo;\n';
  const { rows, delimiter } = parseCSV(text);
  assert.equal(delimiter, ';');
  assert.ok(hasHeader(rows));
  const m = guessMapping(rows[0], rows.slice(1));
  assert.equal(m.date, 0); assert.equal(m.description, 2); assert.equal(m.amount, 3);
  const { items, errors } = rowsToTransactions(rows.slice(1), m);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { row: 0, date: '2026-10-29', amount: -350, description: 'PAGAMENTO POS "BAR" ROMA', category: '' });
  assert.equal(items[1].amount, 185000);
  assert.deepEqual(errors, [2]);
  // righe di intestazione della banca prima della tabella
  const pre = parseCSV('Estratto conto\nIntestatario;Mario Rossi\n\nData;Descrizione;Importo\n28/10/2026;POS;-45,30\n27/10/2026;STIPENDIO;1.850,00\n');
  assert.equal(pre.delimiter, ';');
  // colonne separate entrate / uscite
  const t2 = parseCSV('Date,Description,Paid out,Paid in\n2026-10-01,Coffee,"2.50",\n2026-10-02,Refund,,"10.00"\n');
  const m2 = guessMapping(t2.rows[0], t2.rows.slice(1));
  const r2 = rowsToTransactions(t2.rows.slice(1), m2).items;
  assert.deepEqual(r2.map(x => x.amount), [-250, 1000]);
  // esportazione sicura per Excel
  const out = toCSV([['=HYPERLINK("x")', '-3,50', 'a;b']]);
  assert.equal(out, '\uFEFF"\'=HYPERLINK(""x"")";-3,50;"a;b"');
});

test('ledger: tanti movimenti restano veloci', () => {
  const s = defaults();
  s.accounts.push({ id: 'a1', name: 'C', type: 'checking', currency: 'EUR', inNetWorth: true, created: 1 });
  for (let i = 0; i < 20000; i++) s.transactions.push({ id: 't' + i, date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, kind: i % 3 ? 'expense' : 'income', amount: 100 + (i % 50), account: 'a1', created: i });
  const c = sanitize(s);
  const t0 = performance.now();
  const d = derive(c, '2026-10-29');
  d.netWorthHistory(24);
  d.monthlyFlows(24);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `troppo lento: ${ms} ms`);
  const L = buildLedger(c);
  const sumAll = c.transactions.reduce((a, t) => a + (t.kind === 'income' ? t.amount : -t.amount), 0);
  assert.equal(cashBalance(L, 'a1', '2026-10-29'), sumAll);
});
