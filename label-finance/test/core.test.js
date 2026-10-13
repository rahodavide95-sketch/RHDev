// Test dei calcoli puri (core.js). Esegui: npm test (dentro label-finance/)
// Girano con TZ=Europe/Rome: è lì che toISOString spostava le date di un giorno.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} atteso ${b}, ottenuto ${a}`);

test('fuso orario dei test: Europe/Rome', () => {
  assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -60);
});

test('parseAmount: formati europei e americani', () => {
  close(C.parseAmount('0,0034'), 0.0034, 'virgola con 4 decimali');
  close(C.parseAmount('12,5'), 12.5);
  close(C.parseAmount('0,123'), 0.123, 'zero davanti = decimale');
  close(C.parseAmount('1.234,56'), 1234.56);
  close(C.parseAmount('1,234.56'), 1234.56);
  close(C.parseAmount('1,234'), 1234, 'virgola + 3 cifre senza indizi = migliaia');
  close(C.parseAmount('1.234'), 1.234, 'punto + 3 cifre senza indizi = decimale');
  close(C.parseAmount('1.234.567'), 1234567);
  close(C.parseAmount('€8,70'), 8.7);
  close(C.parseAmount('$ 8.70'), 8.7);
  close(C.parseAmount("1'234.50"), 1234.5);
  close(C.parseAmount('-3'), -3);
  close(C.parseAmount('(3.50)'), -3.5, 'negativo contabile');
  close(C.parseAmount('3.50-'), -3.5, 'meno in fondo');
  close(C.parseAmount('€-3,50'), -3.5);
  close(C.parseAmount('−2,00'), -2, 'meno tipografico');
  close(C.parseAmount('3.4E-05'), 0.000034);
  close(C.parseAmount(''), 0);
  close(C.parseAmount(null), 0);
  close(C.parseAmount('n/d'), 0);
  close(C.parseAmount(7.5), 7.5);
});

test('parseAmount con separatore deciso dal file', () => {
  close(C.parseAmount('1.234', ','), 1234, 'file europeo: punto = migliaia');
  close(C.parseAmount('1,234', ','), 1.234, 'file europeo: virgola = decimale');
  close(C.parseAmount('1,234', '.'), 1234);
  close(C.parseAmount('0,5', '.'), 0.5, 'caso non ambiguo: resta decimale');
});

test('detectDecimalSep', () => {
  assert.equal(C.detectDecimalSep(['1.234', '12,50', '3,1']), ',');
  assert.equal(C.detectDecimalSep(['1,234', '12.50', '0.0031']), '.');
  assert.equal(C.detectDecimalSep(['1.234,00']), ',');
  assert.equal(C.detectDecimalSep(['10', '20']), null);
});

test('parseDate: niente slittamento di un giorno', () => {
  assert.equal(C.parseDate('2024/01/05'), '2024-01-05');
  assert.equal(C.parseDate('2024.01.05'), '2024-01-05');
  assert.equal(C.parseDate('2024-01-05T23:30:00Z'), '2024-01-05');
  assert.equal(C.parseDate('2024-01'), '2024-01-01');
  assert.equal(C.parseDate('January 2024'), '2024-01-01');
  assert.equal(C.parseDate('Jan 5, 2024'), '2024-01-05');
  assert.equal(C.parseDate('5 gennaio 2024'), '2024-01-05');
  assert.equal(C.parseDate('20240105'), '2024-01-05');
  assert.equal(C.parseDate('31/12/2025'), '2025-12-31');
  assert.equal(C.parseDate('12/31/2025'), '2025-12-31');
  assert.equal(C.parseDate('01/05/2024', 'mdy'), '2024-01-05');
  assert.equal(C.parseDate('01/05/2024', 'dmy'), '2024-05-01');
  assert.equal(C.parseDate('1/5/24 3:22pm', 'mdy'), '2024-01-05');
  assert.equal(C.parseDate('31/02/2024'), '', 'data impossibile');
  assert.equal(C.parseDate(''), '');
  assert.equal(C.parseDate('ciao'), '');
});

test('detectDateFormat: formato deciso sull\'intero file', () => {
  assert.equal(C.detectDateFormat(['01/05/2024', '02/03/2024', '03/14/2024']), 'mdy');
  assert.equal(C.detectDateFormat(['01/05/2024', '25/03/2024']), 'dmy');
  assert.equal(C.detectDateFormat(['01/05/2024']), 'dmy');
});

test('date locali e scadenze ricorrenti', () => {
  assert.equal(C.ymd(new Date(2026, 0, 1)), '2026-01-01');
  const seq = ['2025-01-15']; for (let i = 0; i < 4; i++) seq.push(C.addPeriod(seq[seq.length - 1], 'monthly', 15));
  assert.deepEqual(seq, ['2025-01-15', '2025-02-15', '2025-03-15', '2025-04-15', '2025-05-15']);
  const eom = ['2025-01-31']; for (let i = 0; i < 3; i++) eom.push(C.addPeriod(eom[eom.length - 1], 'monthly', 31));
  assert.deepEqual(eom, ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
  assert.equal(C.addPeriod('2024-02-29', 'yearly', 29), '2025-02-28');
  assert.equal(C.addPeriod('2025-12-29', 'weekly'), '2026-01-05');
});

const label = () => ({
  rates: { EUR: 1, USD: 0.5 },
  releases: [
    { id: 'r1', catalog: 'RHD001', title: 'Aurora', upc: '0884385001011', splits: [{ name: 'Nova Iris', pct: 50 }],
      tracks: [{ title: 'Aurora', isrc: 'ITRHD2500011', splits: [] }, { title: 'Aurora feat', isrc: 'ITRHD2500012', splits: [{ name: 'Nova Iris', pct: 30 }, { name: 'Kavi', pct: 30 }] }] },
    { id: 'r2', catalog: 'RHD002', title: 'Echoes', splits: [{ name: 'nova iris ', pct: 40 }] },
  ],
  transactions: [
    { id: 't1', kind: 'income', date: '2025-01-10', catalog: 'RHD001', net: 100, currency: 'EUR' },
    { id: 't2', kind: 'income', date: '2025-02-10', isrc: 'itrhd2500012', net: 200, currency: 'USD' },  // 100 € → quote traccia
    { id: 't3', kind: 'income', date: '2025-03-10', product: 'echoes', net: 50, currency: 'EUR' },      // collegata per titolo
    { id: 't4', kind: 'income', date: '2025-05-10', upc: '884385001011', net: 40, currency: 'EUR' },   // dopo il trimestre
    { id: 't5', kind: 'income', date: '2025-01-15', product: 'Sconosciuto', net: 10, currency: 'EUR' },
    { id: 't6', kind: 'expense', date: '2025-01-20', net: 30, currency: 'EUR' },
  ],
  recoup: [{ id: 'a1', artist: 'NOVA IRIS', kind: 'advance', amount: 60, date: '2025-01-01' }],
  payouts: [{ id: 'p1', artist: 'Nova Iris', amount: 20, date: '2025-04-01' }],
});

test('royalty: quote di traccia, cambio valuta, nomi scritti in modi diversi', () => {
  const { byArtist, labelTotal } = C.computeRoyalties(label());
  const nova = byArtist[C.artKey('Nova Iris')];
  close(nova.total, 50 + 30 + 20 + 20, 'Nova Iris');   // t1 50% di 100, t2 30% di 100, t3 40% di 50, t4 50% di 40
  close(byArtist.kavi.total, 30);
  assert.equal(Object.keys(byArtist).length, 2, '"Nova Iris" e "nova iris " sono lo stesso artista');
  close(labelTotal, 50 + 40 + 30 + 20 + 10, 'quota residua label');
});

test('royalty filtrate per periodo', () => {
  const { byArtist } = C.computeRoyalties(label(), { from: '2025-01-01', to: '2025-03-31' });
  close(byArtist[C.artKey('Nova Iris')].total, 100);
});

test('statement: il netto del periodo non include vendite successive', () => {
  const L = label(); L.recoup = []; L.payouts = [];
  const st = C.computeStatement(L, 'Nova Iris', '2025-01-01', '2025-03-31');
  close(st.total, 100);
  close(st.netPay, 100, 'prima era 120 (contava la vendita di maggio)');
  assert.equal(st.lines.length, 3);
  assert.deepEqual(st.lines.map(l => l.date), ['2025-01-10', '2025-02-10', '2025-03-10']);
});

test('statement: recoupment, pagamenti e saldo', () => {
  const st = C.computeStatement(label(), 'nova iris', '2025-01-01', '2025-06-30');
  close(st.total, 120);
  close(st.recoupable, 60);
  close(st.recouped, 60);
  close(st.residual, 0);
  close(st.netPay, 60);
  close(st.paidInPeriod, 20);
  close(st.balance, 40, '120 - 60 recoup - 20 già pagati');
  const q1 = C.computeStatement(label(), 'Nova Iris', '2025-01-01', '2025-01-31');
  close(q1.total, 50); close(q1.netPay, 0, 'tutto assorbito dall\'anticipo'); close(q1.residual, 10);
});

test('saldi artisti ad oggi', () => {
  const rows = C.artistBalances(label());
  const nova = rows.find(r => r.key === 'nova iris');
  close(nova.royalties, 120); close(nova.recoupable, 60); close(nova.paid, 20); close(nova.payable, 40);
  const kavi = rows.find(r => r.key === 'kavi');
  close(kavi.payable, 30);
});

test('import: non scarta righe uguali dello stesso file, scarta quelle già importate', () => {
  const row = (territory) => ({ kind: 'income', date: '2025-01-01', platform: 'Spotify', isrc: 'X', net: 0.0034, qty: 1, territory });
  const file = [row(''), row(''), row('IT')];
  const first = C.dedupAgainst([], file);
  assert.equal(first.kept.length, 3);
  const again = C.dedupAgainst(first.kept, file);
  assert.equal(again.kept.length, 0); assert.equal(again.skipped, 3);
  const partial = C.dedupAgainst([row('')], file);
  assert.equal(partial.kept.length, 2, 'solo una delle due righe uguali era già presente');
  assert.notEqual(C.txSig({ net: 0.0034 }), C.txSig({ net: 0.0041 }), 'frazioni di centesimo distinguono le righe');
});

test('safeImgSrc blocca HTML nascosto nelle immagini', () => {
  assert.equal(C.safeImgSrc('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(C.safeImgSrc('icon.png?v=3'), 'icon.png?v=3');
  assert.equal(C.safeImgSrc('x" onerror="alert(1)'), '');
  assert.equal(C.safeImgSrc('javascript:alert(1)'), '');
  assert.equal(C.safeImgSrc('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(C.safeImgSrc('../../etc/passwd'), '');
});

test('mergeAccounts: modifiche su due dispositivi non si cancellano a vicenda', () => {
  const base = { plan: 'free', activeLabel: 'L1', labels: [{ id: 'L1', name: 'Label', rates: { EUR: 1 },
    transactions: [{ id: 'a', net: 1 }, { id: 'b', net: 2 }, { id: 'c', net: 3 }] }] };
  const local = JSON.parse(JSON.stringify(base));
  const remote = JSON.parse(JSON.stringify(base));
  local.labels[0].transactions.push({ id: 'd', net: 4 });          // nuovo qui
  local.labels[0].transactions = local.labels[0].transactions.filter(t => t.id !== 'b');   // eliminato qui
  local.labels[0].rates.USD = 0.9;
  remote.labels[0].transactions.push({ id: 'e', net: 5 });         // nuovo nel cloud
  remote.labels[0].transactions.find(t => t.id === 'c').net = 33;  // modificato nel cloud
  remote.labels[0].name = 'Label Srl';
  remote.labels.push({ id: 'L2', name: 'Seconda', transactions: [] });
  const m = C.mergeAccounts(base, local, remote);
  const tx = m.labels[0].transactions;
  assert.deepEqual(tx.map(t => t.id).sort(), ['a', 'c', 'd', 'e']);
  assert.equal(tx.find(t => t.id === 'c').net, 33);
  assert.equal(m.labels[0].name, 'Label Srl');
  assert.equal(m.labels[0].rates.USD, 0.9);
  assert.equal(m.labels.length, 2);
});

test('mergeAccounts senza base: unisce senza perdere nulla', () => {
  const local = { labels: [{ id: 'L1', transactions: [{ id: 'a' }] }], activeLabel: 'L1' };
  const remote = { labels: [{ id: 'L1', transactions: [{ id: 'b' }] }], activeLabel: 'L1' };
  const m = C.mergeAccounts(null, local, remote);
  assert.deepEqual(m.labels[0].transactions.map(t => t.id).sort(), ['a', 'b']);
});

test('mergeAccounts: elemento eliminato in cloud e modificato qui resta', () => {
  const base = { labels: [{ id: 'L1', tasks: [{ id: 't', title: 'x' }] }] };
  const local = { labels: [{ id: 'L1', tasks: [{ id: 't', title: 'y' }] }] };
  const remote = { labels: [{ id: 'L1', tasks: [] }] };
  assert.equal(C.mergeAccounts(base, local, remote).labels[0].tasks[0].title, 'y');
});

test('rateFor: media mensile BCE del mese del movimento, poi tasso manuale', () => {
  const label = { rates: { EUR: 1, USD: 0.9 }, fx: { auto: true, months: { USD: { '2026-01': 0.95, '2026-03': 0.92 } } } };
  close(C.rateFor(label, 'USD', '2026-01-15'), 0.95, 'mese presente');
  close(C.rateFor(label, 'USD', '2026-02-10'), 0.95, 'mese mancante: il precedente più vicino');
  close(C.rateFor(label, 'USD', '2026-05-01'), 0.92, 'mese in corso non ancora pubblicato');
  close(C.rateFor(label, 'USD', '2025-06-01'), 0.95, 'prima dei dati: il primo mese disponibile');
  close(C.rateFor(label, 'EUR', '2026-01-01'), 1);
  close(C.rateFor(label, 'GBP', '2026-01-01'), 1, 'valuta senza tasso: invariata');
  close(C.rateFor(Object.assign({}, label, { fx: { auto: false, months: label.fx.months } }), 'USD', '2026-01-15'), 0.9, 'automatici spenti: tasso manuale');
  close(C.txEur(label, { net: 10, currency: 'usd', date: '2026-03-02' }), 9.2);
});

test('monthlyAverages: dalla serie giornaliera alle medie del mese', () => {
  const m = C.monthlyAverages({ '2026-01-02': { EUR: 0.9 }, '2026-01-05': { EUR: 1.0 }, '2026-02-01': { EUR: 0.8 }, '2026-02-02': { EUR: null } });
  assert.deepEqual(Object.keys(m).sort(), ['2026-01', '2026-02']);
  close(m['2026-01'], 0.95); close(m['2026-02'], 0.8);
});

test('periodo chiuso: le righe arrivate in ritardo vanno nel periodo successivo', () => {
  const label = { rates: { EUR: 1 }, releases: [{ catalog: 'C1', title: 'T', splits: [{ name: 'Ann', pct: 50 }] }],
    transactions: [
      { kind: 'income', date: '2026-02-10', catalog: 'C1', net: 100, currency: 'EUR' },
      { kind: 'income', date: '2026-03-05', acct: '2026-04-01', catalog: 'C1', net: 40, currency: 'EUR' },   // arrivata dopo la chiusura del Q1
    ], payouts: [], recoup: [] };
  const q1 = C.computeStatement(label, 'Ann', '2026-01-01', '2026-03-31');
  const q2 = C.computeStatement(label, 'Ann', '2026-04-01', '2026-06-30');
  close(q1.total, 50, 'Q1 invariato');
  close(q2.total, 20, 'la riga in ritardo finisce nel Q2');
  assert.equal(q2.lines[0].late, true); assert.equal(q2.lines[0].date, '2026-03-05', 'resta la data di vendita');
  close(C.computeRoyalties(label, { from: '2026-01-01', to: '2026-03-31' }).byArtist.ann.total, 50);
  close(C.royaltyTotals(label, { until: '2026-03-31' }).ann.total, 50);
});

test('sync: stesso movimento cambiato su due dispositivi in campi diversi → restano entrambe le modifiche', () => {
  const base = { activeLabel: 'L', labels: [{ id: 'L', transactions: [{ id: 'a', net: 5, note: 'orig' }], trash: [] }] };
  const cloud = { activeLabel: 'L', labels: [{ id: 'L', transactions: [{ id: 'a', net: 10, note: 'orig' }], trash: [{ id: 't1' }] }] };
  const here = { activeLabel: 'L', labels: [{ id: 'L', transactions: [{ id: 'a', net: 5, note: 'qui' }], trash: [{ id: 't2' }] }] };
  const m = C.mergeAccounts(base, here, cloud).labels[0];
  assert.deepEqual(m.transactions, [{ id: 'a', net: 10, note: 'qui' }]);
  assert.deepEqual(m.trash.map(x => x.id).sort(), ['t1', 't2'], 'il cestino si unisce, non si sovrascrive');
});

test('parseDate: mese/anno e trimestri dei report (06/2026, Q1 2026, 2026-Q3)', () => {
  assert.equal(C.parseDate('06/2026'), '2026-06-01');
  assert.equal(C.parseDate('6-2026'), '2026-06-01');
  assert.equal(C.parseDate('Q1 2026'), '2026-01-01');
  assert.equal(C.parseDate('2026-Q3'), '2026-07-01');
  assert.equal(C.parseDate('T4 2025'), '2025-10-01');
  assert.equal(C.parseDate('15/01/2026'), '2026-01-15', 'le date complete non cambiano');
});
