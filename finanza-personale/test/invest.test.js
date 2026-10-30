import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sanitize, position, opsCash, investmentFlows, derive } from '../js/core/model.js';

const op = (id, date, type, extra = {}) => ({ id, date, type, qty: 0, price: 0, fee: 0, amount: 0, created: 1, ...extra });

function state() {
  return sanitize({
    ...defaults(),
    accounts: [
      { id: 'brk', name: 'Broker', type: 'broker', currency: 'EUR', inNetWorth: true },
      { id: 'cc', name: 'Conto', type: 'checking', currency: 'EUR', inNetWorth: true },
    ],
    holdings: [
      { id: 'sp', account: 'brk', name: 'S&P 500', cls: 'etf_eq', group: 'Azioni USA', ter: 0.07, currency: 'EUR', price: 120, ops: [
        op('o1', '2025-09-08', 'buy', { qty: 28.31, price: 105.96, fee: 1 }),
        op('o2', '2025-10-16', 'buy', { qty: 1.82, price: 109.95 }),
        op('o3', '2026-01-16', 'buy', { qty: 2.61, price: 114.96 }),
      ] },
      { id: 'bd', account: 'brk', name: 'Obbligazioni', cls: 'etf_bd', group: 'Obbligazioni', currency: 'EUR', price: 24, ops: [
        op('b1', '2025-09-08', 'buy', { qty: 21.08, price: 23.72, fee: 1 }),
        // venduta tutta: incasso 501,03 − 1 di commissione − 0,27 di imposta
        op('b2', '2025-10-07', 'sell', { qty: 21.08, price: 23.77, fee: 1, tax: 0.27, cash: true }),
        op('b3', '2025-12-01', 'div', { amount: 3.5 }),
      ] },
    ],
    transactions: [
      { id: 't1', date: '2025-10-06', kind: 'expense', amount: 287, account: 'brk', category: 'c-tasse', payee: 'Imposta di bollo', created: 1 },
      { id: 't2', date: '2026-01-12', kind: 'expense', amount: 377, account: 'brk', category: null, payee: 'Imposta di bollo titoli', created: 1 },
      // sul conto corrente non è un costo degli investimenti
      { id: 't3', date: '2026-01-12', kind: 'expense', amount: 3420, account: 'cc', category: 'c-tasse', payee: 'Imposta di bollo', created: 1 },
    ],
  });
}

test('categoria, TER e imposta sulle vendite passano dalla pulizia dei dati', () => {
  const s = state();
  assert.equal(s.holdings[0].group, 'Azioni USA');
  assert.equal(s.holdings[0].ter, 0.07);
  assert.equal(s.holdings[1].ops[1].tax, 0.27);
  // l'imposta vale solo per le vendite
  assert.equal(sanitize({ ...s, holdings: [{ ...s.holdings[0], ops: [{ ...s.holdings[0].ops[0], tax: 5 }] }] }).holdings[0].ops[0].tax, 0);
  // TER assurdi vengono limitati
  assert.equal(sanitize({ ...s, holdings: [{ ...s.holdings[0], ter: 400 }] }).holdings[0].ter, 10);
  assert.equal(sanitize({ ...s, holdings: [{ ...s.holdings[0], ter: 'x' }] }).holdings[0].ter, 0);
});

test('l\'imposta trattenuta riduce il realizzato e la liquidità incassata', () => {
  const bd = state().holdings[1];
  const p = position(bd);
  const cost = 21.08 * 23.72 + 1;
  assert.ok(Math.abs(p.realized - (21.08 * 23.77 - 1 - 0.27 - cost)) < 1e-9);
  assert.equal(p.taxes, 0.27);
  assert.equal(p.fees, 2);
  assert.equal(p.qty, 0);
  assert.ok(Math.abs(opsCash(bd) - (21.08 * 23.77 - 1 - 0.27)) < 1e-9);
});

test('investito mese per mese, per anno, per categoria e tasse e costi', () => {
  const s = state();
  const inv = investmentFlows(s, c => c);
  // settembre 2025: due acquisti con commissioni
  assert.equal(inv.months.get('2025-09'), Math.round((28.31 * 105.96 + 1) * 100) + Math.round((21.08 * 23.72 + 1) * 100));
  // ottobre 2025: vendita (soldi tolti) e un acquisto
  assert.equal(inv.months.get('2025-10'), -Math.round((21.08 * 23.77 - 1 - 0.27) * 100) + Math.round(1.82 * 109.95 * 100));
  assert.deepEqual(inv.yearList, [2025, 2026]);
  const y25 = inv.years.get(2025), y26 = inv.years.get(2026);
  assert.equal(y25.fees, 300);
  assert.equal(y25.taxes, 27);
  assert.equal(y25.income, 350);
  assert.equal(y25.costs, 287);
  assert.equal(y26.costs, 377);           // riconosciuta dalla parola "bollo"
  assert.equal(y26.net, Math.round(2.61 * 114.96 * 100));
  assert.equal(inv.total, [...inv.months.values()].reduce((a, v) => a + v, 0));
  assert.equal(inv.firstMonth, '2025-09');
  // media: il primo anno conta dal primo mese (settembre → dicembre = 4 mesi)
  assert.equal(inv.monthsIn(2025, '2026-10-30'), 4);
  assert.equal(inv.monthsIn(2026, '2026-10-30'), 10);
  const byGroup = inv.pivot(h => h.group);
  assert.equal(byGroup.get('Azioni USA').byYear.get(2026), Math.round(2.61 * 114.96 * 100));
  assert.ok(Math.abs(byGroup.get('Azioni USA').qty - (28.31 + 1.82 + 2.61)) < 1e-9);
  assert.equal(byGroup.get('Obbligazioni').qty, 0);
  assert.ok(Math.abs(byGroup.get('Azioni USA').qtyByYear.get(2025) - (28.31 + 1.82)) < 1e-9);
  assert.equal(byGroup.get('Obbligazioni').qtyByYear.get(2025), 0);
  // realizzato netto dell'anno = guadagno della vendita meno commissioni e imposta
  assert.equal(y25.realized, Math.round((21.08 * 23.77 - 1 - 0.27 - (21.08 * 23.72 + 1)) * 100));
});

test('derive: portafoglio con TER e investito nella valuta principale', () => {
  const s = state();
  const d = derive(s, '2026-10-30');
  const p = d.portfolio();
  const qty = 28.31 + 1.82 + 2.61;
  assert.equal(p.terYear, Math.round(qty * 120 * 0.07));
  assert.ok(p.hasTer);
  assert.equal(d.invest(), d.invest());   // calcolato una volta sola
  assert.equal(d.invest().years.get(2025).costs, 287);
});
