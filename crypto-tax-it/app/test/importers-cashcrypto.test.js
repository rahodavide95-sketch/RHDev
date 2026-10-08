// Export "contanti" e "criptovaluta" dell'App Crypto.com: la stessa operazione compare in entrambi, a volte con etichetta
// diversa (crypto_viban / crypto_viban_exchange) o con numeri scritti in modo diverso. Deve contare una volta sola.
const { test } = require('node:test');
const { CT, assert } = require('./helpers');
require('../src/pipeline.js');
require('../src/report.js');

const HEAD = 'Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash\n';
const file = (id, name, rows) => ({ id, name, type: 'cryptocom_app', text: HEAD + rows.join('\n') + '\n' });
const BUY = '2025-03-01 10:00:00,Bought ETH,EUR,-1000.00,ETH,0.5,EUR,1000.00,1190.00,viban_purchase,';
const SELL_CASH = '2025-09-01 10:00:00,Sold ETH,ETH,-0.5,EUR,1500.00,EUR,1500.00,1770.00,crypto_viban,';
const SELL_CRYPTO = '2025-09-01 10:00:00,Sold ETH,ETH,-0.5,EUR,1500,EUR,1500,1771.23,crypto_viban_exchange,';
const BUY_CRYPTO = '2025-03-01 10:00:00,Bought ETH,EUR,-1000,ETH,0.5,EUR,1000,1191.5,viban_purchase,';

test('crypto_viban e viban_card_top_up sono riconosciuti', () => {
  const r = CT.importers.TYPES.cryptocom_app.parse(HEAD + [SELL_CASH, '2022-01-05 09:00:00,Top Up Card,EUR,-200,,,EUR,200,230,viban_card_top_up,'].join('\n') + '\n', 'c.csv');
  assert.equal(r.unknown.length, 0, JSON.stringify(r.unknown));
  assert.equal(r.events[0].kind, CT.Kind.SELL);
  assert.equal(r.events[0].asset, 'ETH');
  assert.equal(r.events[0].value.toFixed(), '1500');
  assert.equal(r.events[1].kind, CT.Kind.INFO);
});

test('la stessa vendita nei due export (etichetta e formato numeri diversi) conta una volta sola', () => {
  const cash = file('cash', 'contanti.csv', [BUY, SELL_CASH]);
  const crypto = file('crypto', 'cripto.csv', [BUY_CRYPTO, SELL_CRYPTO]);
  const one = CT.analyze({ files: [crypto], settings: { year: 2025 } });
  const both = CT.analyze({ files: [cash, crypto], settings: { year: 2025 } });
  assert.equal(both.engine.issues.filter((i) => i.level === 'block' && i.code !== 'missing_price').length, 0, JSON.stringify(both.engine.issues.filter((i) => i.level === 'block')));
  assert.equal(String(both.y.crypto.gains), String(one.y.crypto.gains));
  assert.equal(String(both.y.crypto.gains), '500');
  const dup = both.engine.issues.find((i) => i.code === 'duplicates');
  assert.ok(dup && /2 righe/.test(dup.message), dup && dup.message);
});

test('righe identiche dentro lo stesso file restano distinte (due acquisti uguali)', () => {
  const f = file('a', 'a.csv', [BUY, BUY]);
  const r = CT.analyze({ files: [f], settings: { year: 2025 } });
  assert.equal(r.events.length, 2);
  assert.equal(r.engine.issues.filter((i) => i.code === 'duplicates').length, 0);
});

test('righe quasi uguali in file diversi (orario diverso di pochi secondi): si chiede, non si indovina', () => {
  const a = file('cash', 'contanti.csv', [BUY, SELL_CASH]);
  const b = file('crypto', 'cripto.csv', [BUY.replace('10:00:00', '10:00:20'), SELL_CRYPTO.replace('10:00:00', '10:00:20')]);
  let r = CT.analyze({ files: [a, b], settings: { year: 2025 } });
  assert.equal(r.groups.nearDup.length, 1);
  assert.equal(r.groups.nearDup[0].data.count, 2);
  assert.ok(r.groups.blockCount >= 1);
  // "sono le stesse": le operazioni del secondo file non vengono contate
  const key = r.groups.nearDup[0].uid;
  const same = CT.analyze({ files: [a, b], resolutions: { [key]: { action: 'dup_skip' } }, settings: { year: 2025 } });
  assert.equal(same.groups.nearDup.length, 0);
  assert.equal(String(same.y.crypto.gains), '500');
  assert.equal(same.events.length, 2);
  // "sono diverse": si tengono tutte (le vendite sarebbero due)
  const diff = CT.analyze({ files: [a, b], resolutions: { [key]: { action: 'ack' } }, settings: { year: 2025 } });
  assert.equal(diff.groups.nearDup.length, 0);
  assert.equal(diff.events.length, 4);
});

test('operazioni uguali nello stesso file o in file lontani nel tempo non generano la domanda', () => {
  const a = file('a', 'a.csv', [BUY, BUY.replace('2025-03-01', '2025-03-02')]);
  const b = file('b', 'b.csv', [BUY.replace('2025-03-01', '2025-04-01')]);
  const r = CT.analyze({ files: [a, b], settings: { year: 2025 } });
  assert.equal(r.groups.nearDup.length, 0);
});

// ---- "Balance Conversion": cambio di nome / migrazione di un token (MATIC -> POL)
const BUY_MATIC = '2024-01-10 10:00:00,Bought MATIC,EUR,-100,MATIC,100,EUR,100,110,viban_purchase,';
const CONV_OUT = '2024-09-04 12:00:00,Balance Conversion,MATIC,-100,,,EUR,50,55,crypto_wallet_swap_debited,';
const CONV_IN = '2024-09-04 12:00:00,Balance Conversion,POL,100,,,EUR,50,55,crypto_wallet_swap_credited,';
const SELL_POL = '2025-03-01 10:00:00,Sold POL,POL,-100,EUR,80,EUR,80,88,crypto_viban_exchange,';
let seq = 0;   // la cache di lettura e' per id e lunghezza: ogni prova usa un id nuovo
const conversionFiles = (rows) => [file('conv' + (++seq), 'cripto.csv', rows)];

test('conversione di saldo: si chiede cosa sia, non si ignora', () => {
  const r = CT.analyze({ files: conversionFiles([BUY_MATIC, CONV_OUT, CONV_IN, SELL_POL]), settings: { year: 2025 } });
  assert.equal(r.groups.conversions.length, 1);
  assert.match(r.groups.conversions[0].message, /MATIC.*POL/);
  assert.equal(r.groups.unknown.size, 0);
});

test('conversione come aggiornamento del token: nessuna vendita, il costo passa al nuovo token', () => {
  const key = CT.analyze({ files: conversionFiles([BUY_MATIC, CONV_OUT, CONV_IN, SELL_POL]), settings: { year: 2025 } }).groups.conversions[0].uid;
  const r = CT.analyze({ files: conversionFiles([BUY_MATIC, CONV_OUT, CONV_IN, SELL_POL]), resolutions: { [key]: { action: 'migration' } }, settings: { year: 2025 } });
  assert.equal(r.groups.conversions.length, 0);
  assert.equal(r.groups.history.length, 0);
  assert.equal(String(r.y.crypto.gains.minus(r.y.crypto.losses)), '-20');   // 80 incassati - 100 di costo (trasferito da MATIC)
  assert.deepEqual(r.balances.map((b) => b.asset + ':' + b.qty.toFixed()), []);   // MATIC e POL a zero
  const y24 = r.years[2024];
  assert.equal(String(y24.crypto.gains), '0');
});

test('conversione come scambio imponibile: la vendita avviene alla data della conversione', () => {
  const key = CT.analyze({ files: conversionFiles([BUY_MATIC, CONV_OUT, CONV_IN, SELL_POL]), settings: { year: 2025 } }).groups.conversions[0].uid;
  const r = CT.analyze({ files: conversionFiles([BUY_MATIC, CONV_OUT, CONV_IN, SELL_POL]), resolutions: { [key]: { action: 'swap' } }, settings: { year: 2025 } });
  assert.equal(r.groups.conversions.length, 0);
  assert.equal(String(r.years[2024].crypto.losses), '50');     // 50 incassati - 100 di costo
  assert.equal(String(r.y.crypto.gains), '30');                // POL costa 50, venduto a 80
});

test('conversione prima del 2023 o senza riga opposta', () => {
  const old = [BUY_MATIC.replace('2024-01-10', '2022-01-10'), CONV_OUT.replace('2024-09-04', '2022-09-04'), CONV_IN.replace('2024-09-04', '2022-09-04'), SELL_POL];
  const r = CT.analyze({ files: conversionFiles(old), settings: { year: 2025 } });
  assert.equal(r.groups.conversions.length, 0, 'prima del 2023 il costo passa da solo');
  assert.equal(String(r.y.crypto.gains.minus(r.y.crypto.losses)), '-20');
  const orphan = CT.analyze({ files: conversionFiles([BUY_MATIC, CONV_OUT, SELL_POL]), settings: { year: 2025 } });
  assert.equal(orphan.groups.unknown.size, 1);
});

test('conversione di saldo con righe a un secondo di distanza si abbina; due coppie vicine non si indovinano', () => {
  const near = [BUY_MATIC, CONV_OUT, CONV_IN.replace('12:00:00', '12:00:01'), SELL_POL];
  const r = CT.analyze({ files: conversionFiles(near), settings: { year: 2025 } });
  assert.equal(r.groups.conversions.length, 1);
  assert.equal(r.groups.unknown.size, 0);
  const two = [BUY_MATIC, CONV_OUT, CONV_OUT.replace('MATIC,-100', 'ATOM,-3'), CONV_IN, CONV_IN.replace('POL,100', 'XYZ,3'), SELL_POL];
  const r2 = CT.analyze({ files: conversionFiles(two), settings: { year: 2025 } });
  assert.equal(r2.groups.conversions.length, 0);
  assert.ok(r2.groups.unknown.size >= 1, 'abbinamento ambiguo: righe da controllare');
});

// ---- difetti trovati dai verificatori indipendenti
test('crypto_viban con segni invertiti non diventa un acquisto in silenzio', () => {
  const inverted = '2025-09-01 10:00:00,Sold ETH,EUR,1500,ETH,0.5,EUR,1500,1770,crypto_viban,';
  const r = CT.importers.TYPES.cryptocom_app.parse(HEAD + inverted + '\n', 'c.csv');
  assert.equal(r.events[0].kind, CT.Kind.UNRESOLVED);
  assert.match(r.events[0].unkKey, /crypto_viban/);
  const noAmount = '2025-09-01 10:00:00,Sold ETH,ETH,-0.5,EUR,,EUR,1500,1770,crypto_viban,';
  assert.equal(CT.importers.TYPES.cryptocom_app.parse(HEAD + noAmount + '\n', 'c.csv').events[0].kind, CT.Kind.UNRESOLVED);
});

test('la stessa operazione in tre file: con "sono le stesse" resta una sola', () => {
  const rows = (sec) => [BUY.replace('10:00:00', '10:00:' + sec)];
  const files3 = [file('t1', 'a.csv', rows('00')), file('t2', 'b.csv', rows('10')), file('t3', 'c.csv', rows('20'))];
  const r = CT.analyze({ files: files3, settings: { year: 2025 } });
  assert.equal(r.groups.nearDup.length, 1);
  assert.equal(r.groups.nearDup[0].data.names.length, 3);
  const k = r.groups.nearDup[0].uid;
  const done = CT.analyze({ files: files3, resolutions: { [k]: { action: 'dup_skip' } }, settings: { year: 2025 } });
  assert.equal(done.groups.nearDup.length, 0);
  assert.equal(done.events.length, 1);
});

test('due righe identiche in ciascuno di due file: se sono le stesse ne restano due, non una', () => {
  const rows = (sec) => [BUY.replace('10:00:00', '10:00:' + sec), BUY.replace('10:00:00', '10:01:' + sec)];
  const fs2 = [file('u1', 'a.csv', rows('00')), file('u2', 'b.csv', rows('10'))];
  const r = CT.analyze({ files: fs2, settings: { year: 2025 } });
  const k = r.groups.nearDup[0].uid;
  const done = CT.analyze({ files: fs2, resolutions: { [k]: { action: 'dup_skip' } }, settings: { year: 2025 } });
  assert.equal(done.events.length, 2);
});

test('conversione divisa in piu\' righe nello stesso istante: si sommano', () => {
  const rows = [BUY_MATIC, CONV_OUT.replace('-100', '-60').replace(',50,55', ',30,33'), CONV_OUT.replace('-100', '-40').replace(',50,55', ',20,22'),
    CONV_IN.replace('POL,100', 'POL,60').replace(',50,55', ',30,33'), CONV_IN.replace('POL,100', 'POL,40').replace(',50,55', ',20,22'), SELL_POL];
  const r = CT.analyze({ files: conversionFiles(rows), settings: { year: 2025 } });
  assert.equal(r.groups.unknown.size, 0);
  assert.equal(r.groups.conversions.length, 1);
  assert.match(r.groups.conversions[0].message, /100 MATIC → 100 POL/);
});

test('conversione con storico mancante: scelta e costo del mancante non si sovrascrivono', () => {
  const rows = [CONV_OUT, CONV_IN, SELL_POL];   // nessun acquisto di MATIC nei file
  let res = {};
  let r = CT.analyze({ files: conversionFiles(rows), resolutions: res, settings: { year: 2025 } });
  const convKey = r.groups.conversions[0].uid;
  assert.ok(convKey.startsWith('conv:'));
  assert.equal(r.groups.history.length, 1, 'finche\' non si sceglie, si tratta come scambio e manca il costo');
  res = { [convKey]: { action: 'migration' } };
  r = CT.analyze({ files: conversionFiles(rows), resolutions: res, settings: { year: 2025 } });
  assert.equal(r.groups.conversions.length, 0);
  assert.equal(r.groups.history.length, 1);
  const evUid = convKey.slice(5);
  res = { ...res, [evUid]: { action: 'cover_cost', cost_eur: '100' } };
  r = CT.analyze({ files: conversionFiles(rows), resolutions: res, settings: { year: 2025 } });
  assert.equal(r.groups.history.length, 0);
  assert.equal(r.groups.conversions.length, 0);
  assert.equal(String(r.y.crypto.gains.minus(r.y.crypto.losses)), '-20');
});

test('conversione senza valore in euro: con "aggiornamento" non si chiede un prezzo, con "scambio" si', () => {
  const noVal = [BUY_MATIC, CONV_OUT.replace(',50,55,', ',0,0,'), CONV_IN.replace(',50,55,', ',0,0,'), SELL_POL];
  let r = CT.analyze({ files: conversionFiles(noVal), settings: { year: 2025 } });
  const k = r.groups.conversions[0].uid;
  r = CT.analyze({ files: conversionFiles(noVal), resolutions: { [k]: { action: 'migration' } }, settings: { year: 2025 } });
  assert.equal(r.engine.issues.filter((i) => i.code === 'missing_value').length, 0);
  assert.equal(String(r.y.crypto.gains.minus(r.y.crypto.losses)), '-20');
  r = CT.analyze({ files: conversionFiles(noVal), resolutions: { [k]: { action: 'swap' } }, settings: { year: 2025 } });
  assert.ok(r.engine.issues.some((i) => i.code === 'missing_value'), 'un realizzo senza valore non e\' un realizzo da zero');
});

test('"non ho altri file: costo 0": il mancante si calcola a costo zero e resta segnato come non documentato', () => {
  const rows = [SELL_POL.replace('Sold POL', 'Sold POL').replace('POL', 'ETH'), ];
  const f = () => conversionFiles(rows);
  const first = CT.analyze({ files: f(), settings: { year: 2025 } });
  assert.equal(first.groups.history.length, 1);
  const res = {}; for (const i of first.groups.history) res[i.uid] = { action: 'cover_cost', cost_eur: '0', undocumented: true };
  const r = CT.analyze({ files: f(), resolutions: res, settings: { year: 2025 } });
  assert.equal(r.groups.history.length, 0);
  assert.equal(String(r.y.crypto.gains), '80');      // tutto l'incasso e' guadagno
  assert.ok(r.engine.disposals.some((d) => d.uses.some((u) => u.documented === false)), 'costo segnato come non documentato');
});
