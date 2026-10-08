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
  assert.ok(r.engine.issues.some((i) => i.code === 'rw_estimated')); // i prezzi 1/1 e 31/12 per il prospetto RW sono stimati con quelli noti: non bloccano
  assert.equal(r.groups.prices.size, 0);
  assert.ok(r.groups.blockCount >= 1);
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

test('dati API: sovrapposizione con un file e copertura incompleta, con conferma', () => {
  const apiRaw = { version: 1, fetchedAt: '2025-10-05T10:00:00Z' };
  CT.importers.TYPES.api_prova = { label: 'Prova · API', parse: (text, name) => {
    const ev = [CT.mkEvent({ uid: 'api:prova:1', ts: new Date('2025-02-01T10:00:00Z'), account: 'Prova', kind: CT.Kind.BUY, asset: 'BTC', qty: CT.D('0.01'), value: CT.D('1000'), valueCcy: 'EUR' })];
    return CT.importers.finish('Prova', 1, ev);
  } };
  const apiFile = { id: 'ap', name: 'api', type: 'api_prova', text: JSON.stringify(apiRaw), platform: 'binance', api: { coverage: [{ what: 'Earn', complete: false, note: 'non scaricato' }, { what: 'Spot', complete: true }], warnings: [] } };
  const csv = 'data;tipo;conto;asset;quantita;valore_eur\n2025-02-01 12:00;acquisto;Binance;ETH;1;2000\n';
  const fileSameDay = { id: 'fl', name: 'm.csv', type: 'generic', text: csv, platform: 'binance' };
  let r = CT.analyze({ files: [apiFile, fileSameDay], settings: { year: 2025 } });
  assert.equal(r.groups.overlap.length, 1);
  assert.deepEqual(r.groups.overlap[0].data.apiIds, ['ap']);
  assert.equal(r.groups.apiIncomplete.length, 1);
  // conferma "nessuna operazione di questo tipo" e file disattivato
  fileSameDay.disabled = true;
  r = CT.analyze({ files: [apiFile, fileSameDay], resolutions: { 'api_cov:binance:Earn': { action: 'ack' } }, settings: { year: 2025 } });
  assert.equal(r.groups.overlap.length, 0);
  assert.equal(r.groups.apiIncomplete.length, 0);
  delete CT.importers.TYPES.api_prova;
});
