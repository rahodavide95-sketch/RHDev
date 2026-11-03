import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sanitize, derive } from '../js/core/model.js';
import { merge3 } from '../js/core/merge.js';
import { dedupePlan, applyDedupe } from '../js/core/dedupe.js';

// lo stesso Net Worth importato su due dispositivi: stesse righe, codici diversi
const copy = (p, extra = {}) => sanitize({ ...defaults(),
  accounts: [
    { id: p + '-isy', name: 'ISYBANK', type: 'checking', currency: 'EUR', created: p === 'a' ? 1 : 2 },
    { id: p + '-ce', name: 'Contanti (Euro)', type: 'cash', currency: 'EUR' },
    { id: p + '-cd', name: 'Contanti (Dollari)', type: 'cash', currency: 'USD' },
    { id: p + '-sp', name: 'S&P 500', type: 'broker', cls: 'etf_eq', currency: 'EUR' },
  ],
  valuations: [
    { id: p + 'v1', account: p + '-isy', date: '2026-01-31', value: 10000, kind: 'open', created: 1 },
    { id: p + 'v2', account: p + '-isy', date: '2026-02-28', value: 12000, kind: 'adjust', created: 1, ...(extra.manual ? { value: 77700, manual: true } : {}) },
    { id: p + 'v3', account: p + '-ce', date: '2026-01-31', value: 5000, kind: 'open', created: 1 },
    { id: p + 'v4', account: p + '-cd', date: '2026-01-31', value: 4000, kind: 'open', created: 1 },
    { id: p + 'v5', account: p + '-sp', date: '2026-01-31', value: 9000, kind: 'open', created: 1 },
  ],
  transactions: [{ id: p + 't1', date: '2026-01-31', kind: 'income', amount: 185000, account: p + '-isy', payee: 'STIPENDIO', importHash: 'xl:abc' }],
  settings: { ...defaults().settings, nwLayout: { sections: [
    { name: 'Cash - Liquidity', color: 1, items: [`a:${p}-isy`, `a:${p}-ce`, `a:${p}-cd`] },
    { name: 'ETF', color: 2, items: [`a:${p}-sp`] }], labels: {} } },
});

test('due copie dello stesso Excel unite: ogni riga una volta sola, totali giusti', () => {
  const A = copy('a'), B = copy('b', { manual: true });
  const merged = sanitize(merge3(null, A, B));
  assert.equal(merged.accounts.length, 8);              // prima: tutto doppio
  const plan = dedupePlan(merged);
  assert.equal(plan.rows, 4);
  applyDedupe(merged);
  const st = sanitize(merged);
  assert.deepEqual(st.accounts.map(a => a.name).sort(), ['Contanti (Dollari)', 'Contanti (Euro)', 'ISYBANK', 'S&P 500']);
  // un valore per data; quello scritto a mano vince
  const isy = st.accounts.find(a => a.name === 'ISYBANK');
  assert.deepEqual(st.valuations.filter(v => v.account === isy.id).map(v => [v.date, v.value]).sort(), [['2026-01-31', 10000], ['2026-02-28', 77700]]);
  assert.equal(st.transactions.length, 1);
  // il Net Worth: sezioni e righe una volta sola, totale non raddoppiato
  const S0 = derive(st, '2026-03-10').nwSheet(2026);
  assert.deepEqual(S0.sections.map(x => [x.name, x.rows.map(r => r.name)]), [['Cash - Liquidity', ['ISYBANK', 'Contanti (Euro)', 'Contanti (Dollari)']], ['ETF', ['S&P 500']]]);
  assert.equal(st.settings.nwLayout.sections.length, 2);
  // e la seconda volta non c'è più niente da fare
  assert.equal(dedupePlan(st).count, 0);
});

test('righe diverse non si uniscono (stesso nome ma valuta o tipo diversi)', () => {
  const st = copy('a');
  assert.equal(dedupePlan(st).count, 0);
  st.accounts.push({ ...st.accounts[0], id: 'x-isy', currency: 'USD' });
  assert.equal(dedupePlan(sanitize(st)).rows, 0);
  // due "Conto corrente" in banche diverse restano due
  st.accounts.push({ id: 'cc1', name: 'Conto corrente', type: 'checking', currency: 'EUR', institution: 'Banca A' },
    { id: 'cc2', name: 'Conto corrente', type: 'checking', currency: 'EUR', institution: 'Banca B' });
  assert.equal(dedupePlan(sanitize(st)).rows, 0);
});

test('stesso conto con più valori alla stessa data: resta quello che si vede (l\'ultimo)', () => {
  const st = copy('a');
  st.valuations.push({ id: 'late', account: 'a-isy', date: '2026-02-28', value: 13000, kind: 'adjust', created: 5 });
  const s = sanitize(st);
  applyDedupe(s);
  assert.deepEqual(s.valuations.filter(v => v.account === 'a-isy' && v.date === '2026-02-28').map(v => v.value).sort(), [12000, 13000]);
  assert.equal(derive(sanitize(s), '2026-03-10').nwSheet(2026).sections[0].rows[0].values[2], 13000);
});
