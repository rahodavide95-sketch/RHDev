import test from 'node:test';
import assert from 'node:assert/strict';
import { merge3 } from '../js/core/merge.js';
import { defaults, sanitize } from '../js/core/model.js';

const tx = (id, amount, extra = {}) => ({ id, date: '2026-10-01', kind: 'expense', amount, account: 'a1', payee: 'x', created: 1, ...extra });

test('unione a tre vie: modifiche, aggiunte ed eliminazioni da due dispositivi', () => {
  const base = { transactions: [tx('t1', 100), tx('t2', 200), tx('t3', 300)], budgets: { c1: 1000, c2: 2000 }, settings: { theme: 'auto', lockMinutes: 5 } };
  const local = {
    transactions: [tx('t1', 150), tx('t2', 200), tx('t4', 400)],        // t1 modificato, t3 eliminato, t4 nuovo
    budgets: { c1: 1000, c2: 2500, c3: 300 },                             // c2 cambiato, c3 nuovo
    settings: { theme: 'dark', lockMinutes: 5 },
  };
  const remote = {
    transactions: [tx('t1', 100), tx('t2', 250), tx('t3', 300), tx('t5', 500)],   // t2 modificato, t5 nuovo
    budgets: { c2: 2000 },                                                // c1 tolto
    settings: { theme: 'auto', lockMinutes: 10 },
  };
  const m = merge3(base, local, remote);
  assert.deepEqual(m.transactions.map(t => [t.id, t.amount]), [['t1', 150], ['t2', 250], ['t4', 400], ['t5', 500]]);
  assert.deepEqual(m.budgets, { c2: 2500, c3: 300 });
  assert.deepEqual(m.settings, { theme: 'dark', lockMinutes: 10 });
});

test('stesso elemento cambiato da entrambi: si uniscono i campi e le liste interne', () => {
  const h = (ops, price = 100, name = 'ETF') => ({ id: 'h1', name, price, ops });
  const op = (id, qty) => ({ id, qty, type: 'buy' });
  const base = { holdings: [h([op('o1', 1)])] };
  const local = { holdings: [h([op('o1', 1), op('o2', 2)], 110)] };          // nuova operazione + prezzo
  const remote = { holdings: [h([op('o1', 1), op('o3', 3)], 100, 'ETF World')] };  // un'altra operazione + nome
  const m = merge3(base, local, remote);
  assert.deepEqual(m.holdings[0], { id: 'h1', name: 'ETF World', price: 110, ops: [op('o1', 1), op('o2', 2), op('o3', 3)] });
});

test('eliminato da una parte ma modificato dall\'altra: resta', () => {
  const base = { goals: [{ id: 'g1', target: 100 }] };
  const m = merge3(base, { goals: [] }, { goals: [{ id: 'g1', target: 200 }] });
  assert.deepEqual(m.goals, [{ id: 'g1', target: 200 }]);
});

test('senza base (primo collegamento) si sommano i dati delle due parti', () => {
  const a = sanitize({ ...defaults(), accounts: [{ id: 'a1', name: 'Conto A', type: 'checking' }], transactions: [tx('t1', 100)] });
  const b = sanitize({ ...defaults(), accounts: [{ id: 'a2', name: 'Conto B', type: 'checking' }], transactions: [tx('t2', 200, { account: 'a2' })] });
  const m = sanitize(merge3(null, a, b));
  assert.deepEqual(m.accounts.map(x => x.id), ['a1', 'a2']);
  assert.deepEqual(m.transactions.map(x => x.id), ['t1', 't2']);
  // le categorie di partenza sono le stesse: niente doppioni
  assert.equal(m.categories.length, defaults().categories.length);
});

test('nessuna modifica: il risultato è identico', () => {
  const s = sanitize({ ...defaults(), transactions: [tx('t1', 100)] , accounts: [{ id: 'a1', name: 'C', type: 'checking' }] });
  assert.deepEqual(merge3(s, s, structuredClone(s)), s);
});
