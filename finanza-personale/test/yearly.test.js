import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sanitize, derive } from '../js/core/model.js';

const tx = (id, date, amount, category, payee, kind = 'income') => ({ id, date, kind, amount, account: 'cc', category, payee, created: 1 });

test('entrate dell\'anno come il foglio: categoria → sottocategoria → voce, mesi, totale, media', () => {
  const s = sanitize({
    ...defaults(),
    accounts: [{ id: 'cc', name: 'Conto', type: 'checking', currency: 'EUR' }],
    categories: [
      { id: 'dj', name: 'DJ', kind: 'income', group: 'Musica' },
      { id: 'prod', name: 'Produzione', kind: 'income', group: 'Musica' },
      { id: 'stip', name: 'Stipendio', kind: 'income', group: 'Lavoro' },
      { id: 'spesa', name: 'Spesa', kind: 'expense', group: 'Cibo' },
    ],
    transactions: [
      tx('1', '2026-01-27', 185000, 'stip', 'Azienda'),
      tx('2', '2026-02-27', 185000, 'stip', 'Azienda'),
      tx('3', '2026-02-10', 30000, 'dj', 'Raho'),
      tx('4', '2026-02-20', 20000, 'dj', 'raho '),            // stessa voce, scritta diversa
      tx('5', '2026-03-05', 15000, 'dj', 'Ohar'),
      tx('6', '2025-12-31', 99999, 'dj', 'Anno prima'),
      tx('7', '2026-03-01', 5000, null, ''),                  // senza categoria
      tx('8', '2026-03-02', 4000, 'spesa', 'Esselunga', 'expense'),
    ],
  });
  const d = derive(s, '2026-04-15');
  const T = d.yearTable(2026, 'income');
  assert.deepEqual(T.groups.map(g => g.name), ['Musica', 'Lavoro', 'Senza categoria']);   // ordine delle categorie
  const musica = T.groups[0];
  assert.equal(musica.total, 65000);
  assert.deepEqual(musica.byMonth.slice(0, 4), [0, 50000, 15000, 0]);
  const dj = musica.cats.find(c => c.id === 'dj');
  assert.deepEqual(dj.payees.map(p => [p.name, p.total]), [['Raho', 50000], ['Ohar', 15000]]);
  assert.equal(musica.cats.some(c => c.id === 'prod'), false);              // senza movimenti non compare…
  assert.ok(d.yearTable(2026, 'income', { empty: true }).groups[0].cats.some(c => c.id === 'prod'));   // …se non si chiede
  assert.equal(T.total, 185000 * 2 + 65000 + 5000);
  assert.equal(T.months, 4);                                                // gennaio–aprile per la media
  assert.equal(d.yearTable(2025, 'income').months, 12);
  assert.equal(d.yearTable(2026, 'expense').total, 4000);
});

test('categorie scritte in modi diversi diventano una sola (LAVORO e Lavoro)', async () => {
  const { defaults, sanitize, derive, tidyPlan, applyTidy } = await import('../js/core/model.js');
  const st = sanitize(defaults());
  st.accounts.push({ id: 'a-1', name: 'Conto', type: 'checking', currency: 'EUR', inNetWorth: false });
  // una versione precedente aveva scritto "Lavoro › Stipendio" (la categoria dell'app), la nuova "LAVORO › …"
  st.categories.push(
    { id: 'c-13', name: '13ESIMA', emoji: '•', kind: 'income', group: 'LAVORO', archived: false },
    { id: 'c-bp', name: 'BUONI PASTO', emoji: '•', kind: 'income', group: 'LAVORO', archived: false },
    { id: 'c-st2', name: 'STIPENDIO', emoji: '•', kind: 'income', group: 'LAVORO', archived: false },
    { id: 'c-cc', name: 'CC', emoji: '•', kind: 'income', group: 'INT. BANCA', archived: false },
    { id: 'c-cc2', name: 'cc', emoji: '•', kind: 'income', group: 'Int banca', archived: false });
  const tx = (id, category, amount) => ({ id, date: '2026-01-31', kind: 'income', amount, account: 'a-1', category, payee: '', created: 1, updated: 1 });
  st.transactions.push(tx('t1', 'i-stip', 185000), tx('t2', 'c-st2', 1000), tx('t3', 'c-bp', 16000), tx('t4', 'c-cc', 210), tx('t5', 'c-cc2', 90));
  const s2 = sanitize(st);
  const before = derive(s2, '2026-02-10').yearTable(2026, 'income');
  assert.equal(before.groups.filter(g => g.name.toLowerCase() === 'lavoro').length, 1, 'anche prima di unire la tabella ne mostra una sola');
  const plan = tidyPlan(s2);
  assert.ok(plan.count > 0);
  applyTidy(s2, plan);
  const inc = s2.categories.filter(c => c.kind === 'income' && !c.archived);
  assert.deepEqual([...new Set(inc.filter(c => c.group.toLowerCase() === 'lavoro').map(c => c.group))], ['LAVORO']);
  // "Stipendio" e "STIPENDIO" nella stessa macro: una sola voce, con tutti i movimenti
  const stip = inc.filter(c => c.group === 'LAVORO' && c.name.toLowerCase() === 'stipendio');
  assert.equal(stip.length, 1);
  assert.equal(s2.transactions.filter(t => t.category === stip[0].id).length, 2);
  // "INT. BANCA › CC" e "Int banca › cc": una sola
  assert.equal(inc.filter(c => c.name.toLowerCase() === 'cc').length, 1);
  const T = derive(s2, '2026-02-10').yearTable(2026, 'income');
  const lav = T.groups.find(g => g.name === 'LAVORO');
  assert.equal(lav.total, 185000 + 1000 + 16000);
  assert.equal(T.groups.filter(g => g.name.toLowerCase().replace(/[^a-z]/g, '') === 'intbanca').length, 1);
  // già in ordine: niente da fare
  assert.equal(tidyPlan(s2).count, 0);
});

test('una statistica importata come entrata ("Liquidità a fine 2025") si toglie', async () => {
  const { defaults, sanitize, tidyPlan, applyTidy } = await import('../js/core/model.js');
  const st = sanitize(defaults());
  st.accounts.push({ id: 'a-file', name: 'Entrate e uscite dal file', type: 'checking', currency: 'EUR', inNetWorth: false },
    { id: 'a-cc', name: 'Conto', type: 'checking', currency: 'EUR', inNetWorth: true });
  st.categories.push({ id: 'c-liq', name: 'LIQUIDITÀ A FINE 2025', emoji: '•', kind: 'income', group: 'LIQUIDITÀ A FINE 2025', archived: false },
    { id: 'c-sal', name: 'Saldo iniziale', emoji: '•', kind: 'income', group: 'ALTRO', archived: false });
  st.transactions.push({ id: 't1', date: '2026-01-31', kind: 'income', amount: 1523045, account: 'a-file', category: 'c-liq', payee: 'LIQUIDITÀ A FINE 2025', created: 1, updated: 1 },
    // una categoria scelta dall'utente con movimenti veri su un conto del patrimonio resta
    { id: 't2', date: '2026-01-10', kind: 'income', amount: 5000, account: 'a-cc', category: 'c-sal', payee: 'x', created: 2, updated: 2 });
  const s2 = sanitize(st);
  const plan = tidyPlan(s2);
  assert.deepEqual(plan.stats, ['c-liq']);
  applyTidy(s2, plan);
  assert.ok(!s2.categories.some(c => c.id === 'c-liq'));
  assert.ok(!s2.transactions.some(t => t.id === 't1'));
  assert.ok(s2.categories.some(c => c.id === 'c-sal') && s2.transactions.some(t => t.id === 't2'));
});
