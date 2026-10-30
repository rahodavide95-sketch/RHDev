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
