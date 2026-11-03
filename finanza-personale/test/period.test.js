import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPeriod, resolvePeriod, monthsBetween, previousPeriod } from '../js/core/period.js';

test('periodo: ultimi mesi, quest\'anno, anno scorso, tutto', () => {
  assert.deepEqual(resolvePeriod(12, '2026-10').months.length, 12);
  assert.equal(resolvePeriod(12, '2026-10').from, '2025-11');
  assert.deepEqual(resolvePeriod('ytd', '2026-10'), { from: '2026-01', to: '2026-10', months: monthsBetween('2026-01', '2026-10') });
  const py = resolvePeriod('py', '2026-10');
  assert.equal(py.from, '2025-01'); assert.equal(py.to, '2025-12'); assert.equal(py.months.length, 12);
  assert.equal(resolvePeriod('all', '2026-10', '2024-03').from, '2024-03');
});

test('periodo: non va oltre i dati che ci sono', () => {
  // i dati partono a marzo 2026: 12 mesi diventano marzo–ottobre
  assert.equal(resolvePeriod(12, '2026-10', '2026-03').from, '2026-03');
  // l'anno scorso senza dati: nessun mese
  assert.deepEqual(resolvePeriod('py', '2026-10', '2026-03').months, []);
});

test('periodo personalizzato: da un mese a un altro, anche scritti al contrario', () => {
  const r = resolvePeriod({ from: '2026-05', to: '2025-11' }, '2026-10');
  assert.equal(r.from, '2025-11'); assert.equal(r.to, '2026-05'); assert.equal(r.months.length, 7);
  // oltre l'ultimo mese con dati si ferma lì
  assert.equal(resolvePeriod({ from: '2026-01', to: '2027-03' }, '2026-10').to, '2026-10');
  assert.deepEqual(previousPeriod({ from: '2026-01', to: '2026-06' }), { from: '2025-07', to: '2025-12' });
});

test('periodo letto dal dispositivo: solo valori validi', () => {
  assert.equal(cleanPeriod('ytd'), 'ytd');
  assert.equal(cleanPeriod(24), 24);
  assert.deepEqual(cleanPeriod({ from: '2025-01', to: '2025-06', x: 1 }), { from: '2025-01', to: '2025-06' });
  assert.equal(cleanPeriod({ from: '2025-13', to: '2025-06' }), 12);
  assert.equal(cleanPeriod('boh', 6), 6);
  assert.equal(cleanPeriod(null), 12);
});
