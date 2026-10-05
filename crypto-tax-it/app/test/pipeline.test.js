const { test } = require('node:test');
const { CT, eq, assert } = require('./helpers');
require('../src/pipeline.js');
require('../src/report.js');

const APP = `Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind
2025-01-10 10:00:00,Buy BTC,EUR,-1000,BTC,0.01,EUR,1000,1100,viban_purchase
2025-02-01 10:00:00,BTC -> ETH,BTC,-0.01,ETH,0.2,EUR,1200,1300,crypto_exchange
2025-03-05 10:00:00,Earn,CRO,5,,,EUR,0.5,0.55,crypto_earn_interest_paid
2025-03-08 10:00:00,Mystery,CRO,1,,,EUR,0.1,0.11,foo_bar_baz
`;
const files = (extra = []) => [{ id: 'a', name: 'app.csv', type: 'cryptocom_app', text: APP }, ...extra];

test('analyze: risultato, raggruppamento problemi, duplicati tra file sovrapposti', () => {
  const dup = { id: 'b', name: 'app2.csv', type: 'cryptocom_app', text: APP };
  const r = CT.analyze({ files: files([dup]), settings: { year: 2025 } });
  eq(r.y.crypto.gains, 200); eq(r.y.crypto.income, '0.5');
  assert.equal(r.engine.issues.filter((i) => i.code === 'duplicates').length, 1);
  assert.equal(r.groups.unknown.size, 1);
  assert.ok(r.groups.prices.size >= 1); // mancano i prezzi 1/1 e 31/12 per il prospetto RW
  assert.ok(r.groups.blockCount >= 2);
});

test('analyze: risoluzioni, prezzi inseriti e operazioni manuali', () => {
  const base = CT.analyze({ files: files(), settings: { year: 2025 } });
  const unk = [...base.groups.unknown.values()][0].items[0];
  const prices = {};
  for (const k of base.groups.prices.keys()) prices[k] = '100';
  for (const k of base.engine.missingPrices.keys()) prices[k] = '100';
  prices['ADA|2025-12-31'] = '0.5'; // l'operazione manuale su ADA richiede anche il suo prezzo di fine anno per il prospetto RW
  const r = CT.analyze({ files: files(), resolutions: { [unk.uid]: { action: 'ignore' } }, prices, settings: { year: 2025 },
    manual: [{ data: '2025-04-01 10:00', tipo: 'acquisto', conto: 'Wallet', asset: 'ADA', quantita: '100', valore_eur: '50' }] });
  assert.equal(r.groups.unknown.size, 0);
  assert.equal(r.engine.issues.filter((i) => i.level === 'block').length, 0, JSON.stringify(r.engine.issues.filter((i) => i.level === 'block')));
  assert.ok(r.balances.some((b) => b.account === 'Wallet' && b.asset === 'ADA'));
});

test('esportazioni: CSV italiano, riepilogo, report HTML e diagnostica senza importi', () => {
  const r = CT.analyze({ files: files(), settings: { year: 2025 } });
  const csv = CT.report.csv(CT.report.DISPOSAL_HEAD, CT.report.disposalsRows(r));
  assert.ok(csv.startsWith('﻿Data;Conto;Asset'));
  assert.ok(csv.includes('200,00'));
  assert.ok(CT.report.summaryText(r).includes('IMPOSTA SOSTITUTIVA TOTALE'));
  assert.ok(CT.report.reportHtml(r).includes('<table>'));
  const diag = CT.report.diagnostics(r, files());
  assert.ok(diag.includes('foo_bar_baz'));
  assert.equal(diag.includes('1200'), false);
});

test('anni diversi: il 2026 usa 33%', () => {
  const r = CT.analyze({ files: files(), settings: { year: 2026 } });
  assert.equal(r.y.rule.cryptoRate.toString(), '0.33');
});
