import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNetWorth, detectMonths, readNetWorth, planNetWorth, readMonths, planMonths, positionClass, reconcileNetWorth } from '../js/core/sheets.js';
import { defaults, sanitize } from '../js/core/model.js';

// Stessa struttura del foglio Net Worth di D (nomi e numeri inventati): due "Contanti" (euro e
// dollari), un ETF monetario nella liquidità, titoli con la colonna Type, TFR lordo e netto solo
// al 31/12, colonna "2025 to 2026", Asset Allocation con una riga vuota e il totale del Net Worth.
const NW = [
  ['NET WORTH', 'Type', '31/12/2025', '31/01/2026', '28/02/2026', '2025 to 2026'],
  ['Cash - Liquidity'],
  ['Banca Uno', 'Cash', 1200, 1350, 1410],
  ['Contanti', 'Euro', 80, 95, 60],
  ['Contanti', 'Dollari', null, 40, 45],
  ['Fondo Monetario', 'ETF:M', 0, 2000, 2010],
  [null, 'Total', 1280, 3485, 3525, 3525],
  [null, 'Gain/Loss', null, 2205, 40],
  [null, '%', null, 1.72, 0.01],
  ['ETF'],
  ['Indice Mondo', 'ETF:S', 3000, 3100, 3050],
  [null, 'Total', 3000, 3100, 3050],
  ['Stock'],
  ['Razzi Spa', 'RKTS', 0, 250, 270],
  [null, 'Total', 0, 250, 270],
  ['Materie prime'],
  ['Oro (Piattaforma)', 'XAU', 400, 410, 420],
  [null, 'Total', 400, 410, 420],
  ['Crypto'],
  ['Exchange Uno', 'BTC+ALT', 700, 650, 900],
  [null, 'Total', 700, 650, 900],
  ['WORK'],
  ['TFR Lordo', 'Cash', 9000, null, null, 9400],
  ['TFR Netto', 'Cash', 7000, null, null, 7300],
  [null, 'Total', 7000, null, null, 7300],
  ['Asset Allocation', '%'],
  ['Cash', 0.1, 1280, 3485, 3525],
  ['ETF', 0.24, 3000, 3100, 3050],
  ['Stock', 0, 0, null, null],
  ['Materie prime', 0.03, 400, 410, 420],
  ['Crypto', 0.06, 700, 650, 900],
  ['TFR (netto)', null, 7000],
  [null, 'Total', 12380, 7645, 7895],
];

test('Net Worth come quello di D: ogni riga al posto giusto', () => {
  const info = detectNetWorth(NW);
  const read = readNetWorth(NW, info);
  assert.deepEqual(read.dates, ['2025-12-31', '2026-01-31', '2026-02-28']);
  assert.ok(read.checks.every(c => c.ok), JSON.stringify(read.checks));
  assert.deepEqual(read.grand.map(v => v.value), [12380, 7645, 7895]);
  assert.equal(read.alloc.length, 6);
  const { rows } = planNetWorth(read, sanitize(defaults()), { refDate: '2026-03-10' });
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  // due righe "Contanti": due conti, ognuno con la sua valuta
  assert.equal(by['Contanti (Euro)'].currency, 'EUR');
  assert.equal(by['Contanti (Dollari)'].currency, 'USD');
  assert.equal(by['Contanti (Euro)'].type, 'cash');
  // titoli dalla colonna Type
  assert.deepEqual([by['Fondo Monetario'].cls, by['Fondo Monetario'].cash], ['etf_mm', true]);
  assert.equal(by['Indice Mondo'].cls, 'etf_eq');
  assert.equal(by['Razzi Spa'].cls, 'stock');
  assert.equal(by['Oro (Piattaforma)'].cls, 'gold');
  assert.deepEqual([by['Exchange Uno'].cls, by['Exchange Uno'].type], ['crypto', 'crypto']);
  // TFR: solo il netto
  assert.equal(by['TFR Lordo'].on, false);
  assert.equal(by['TFR Netto'].on, true);
  assert.equal(by['TFR Netto'].type, 'receivable');
  assert.equal(by['Banca Uno'].cls, '');
  // TFR scritto solo al 31/12: nel Net Worth conta solo lì (come il totale del foglio); i conti pieni no
  assert.equal(by['TFR Netto'].sparse, true);
  assert.equal(by['Banca Uno'].sparse, false);
  assert.equal(by['Contanti (Dollari)'].sparse, false);      // vuoto solo prima del primo valore
});

test('tipo di titolo dalla colonna Type e dalla sezione', () => {
  for (const [sec, type, want] of [['ETF', 'ETF:S', 'etf_eq'], ['Cash', 'ETF:M', 'etf_mm'], ['ETF', 'ETF:B', 'etf_bd'], ['Materie prime', 'ETC', 'gold'], ['Altro', 'XAU', 'gold'],
    ['Stock', 'RKLB', 'stock'], ['Azioni', '', 'stock'], ['Crypto', 'BTC+ALT', 'crypto'], ['Obbligazioni', 'BTP', 'gov'], ['WORK', 'Cash', ''], ['Cash - Liquidity', 'Cash', ''], ['Casa', 'EUR', '']]) {
    assert.equal(positionClass(sec, type), want, `${sec} ${type}`);
  }
});

test('reimportando: valori uguali saltati, valori corretti nel file aggiornati, conti non doppi', () => {
  const read = readNetWorth(NW, detectNetWorth(NW));
  const st = sanitize({ ...defaults(),
    accounts: [{ id: 'a-cu', name: 'Contanti', type: 'cash', currency: 'EUR' }, { id: 'a-b1', name: 'Banca Uno', type: 'checking', currency: 'EUR' }, { id: 'a-im', name: 'Indice Mondo', type: 'broker', currency: 'EUR' }],
    valuations: [
      { id: 'v1', account: 'a-b1', date: '2025-12-31', value: 120000, kind: 'open', created: 1 },
      { id: 'v2', account: 'a-b1', date: '2026-01-31', value: 99000, kind: 'adjust', created: 1 },     // nel file ora è 1350
      { id: 'v3', account: 'a-im', date: '2025-12-31', value: 300000, kind: 'open', created: 1 },
    ] });
  const { rows } = planNetWorth(read, st, { refDate: '2026-03-10' });
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(by['Banca Uno'].existing.id, 'a-b1');
  assert.equal(by['Banca Uno'].known, 1);
  assert.deepEqual(by['Banca Uno'].changed.map(v => [v.date, v.was, v.value]), [['2026-01-31', 990, 1350]]);
  assert.deepEqual(by['Banca Uno'].values.map(v => v.date), ['2026-02-28']);
  // il vecchio "Contanti" (in euro, da un import di prima) è "Contanti (Euro)"; quello in dollari è nuovo
  assert.equal(by['Contanti (Euro)'].existing?.id, 'a-cu');
  assert.equal(by['Contanti (Dollari)'].existing, null);
  // un titolo già importato come riga del Net Worth resta lo stesso conto
  assert.equal(by['Indice Mondo'].existing?.id, 'a-im');
});

test('controllo col foglio: il perché delle differenze', () => {
  const read = readNetWorth(NW, detectNetWorth(NW));
  // l'app: valori del foglio, ma il TFR resta 7000 nei mesi vuoti e la riga Stock conta sempre
  const val = (a, date) => a.values.find(v => v.date === date)?.value ?? (/TFR Netto/.test(a.name) ? 7000 : null);
  const own = read.accounts.filter(a => !/Lordo/.test(a.name));
  const cents = v => (v == null ? null : Math.round(v * 100));
  const app = {
    row: (a, date) => cents(val(a, date)),
    section: (s, date) => { const vs = own.filter(a => a.section === s).map(a => val(a, date)).filter(v => v != null); return vs.length ? cents(vs.reduce((x, y) => x + y, 0)) : null; },
    grand: date => cents(own.reduce((x, a) => x + (val(a, date) || 0), 0)),
  };
  const r = reconcileNetWorth(read, app, { refDate: '2026-03-10' });
  assert.deepEqual(r.months.map(m => m.diff / 100), [0, 7250, 7270]);
  assert.equal(r.ok, 1);
  const kinds = Object.fromEntries(r.causes.map(c => [c.kind, c]));
  assert.equal(kinds.carry.name, 'TFR Netto');
  assert.deepEqual(kinds.carry.dates, ['2026-01-31', '2026-02-28']);
  assert.equal(kinds.allocEmpty.name, 'Stock');
  assert.equal(kinds.allocEmpty.section, 'Stock');
});

// Entrate come il foglio di D: categoria ripetuta su ogni riga, note come voci, statistiche in fondo
const EN = (feb = 1850, djA = 220) => [
  ['ENTRATE 2026'],
  ['CATEGORIA', 'SUB CATEGORIA', 'NOTE', 'GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC', 'TOTALI', 'MEDIA MENS.'],
  ['LAVORO', null, null, 2010, feb + 160, 2010],
  ['LAVORO', 'STIPENDIO', null, 1850, feb, 1850],
  ['LAVORO', 'BUONI PASTO', null, 160, 160, 160],
  ['MUSICA', null, null, djA, 310],
  ['MUSICA', 'DJ', 'Serata A', djA],
  ['MUSICA', 'DJ', 'Serata B', null, 310],
  ['TOTALI', null, null, 2010 + djA, feb + 470, 2010],
  [],
  ['STATISTICHE'],
  ['Liquidità a fine 2025', null, 4321, 77, 0.4],
];

test('entrate reimportate: importi cambiati aggiornati, celle svuotate tolte, niente doppioni', () => {
  const plan = (rows, st, refDate = '2026-03-15') => planMonths(readMonths(rows, detectMonths(rows)), st, { year: 2026, kind: 'income', refDate });
  const st0 = sanitize(defaults());
  const p1 = plan(EN(), st0);
  assert.equal(p1.txs.length, 8);
  assert.ok(p1.txs.every(t => /^xl:[0-9a-f]{16}$/.test(t.hash)));
  assert.equal(p1.txs.find(t => t.payee === 'STIPENDIO' && t.date.startsWith('2026-03')).date, '2026-03-15');     // mese in corso: oggi
  const st1 = { ...st0, transactions: p1.txs.map((t, i) => ({ id: 't' + i, date: t.date, kind: t.kind, amount: t.amount, account: 'a-f', category: 'c' + t.catKey, payee: t.payee, importHash: t.hash, tags: [] })) };
  // stesso file: niente
  const p2 = plan(EN(), st1);
  assert.deepEqual([p2.txs.length, p2.changed.length, p2.removes.length, p2.dups], [0, 0, 0, 8]);
  // più avanti nello stesso mese: il movimento di marzo è lo stesso (non un doppione con la data nuova)
  assert.equal(plan(EN(), st1, '2026-03-28').txs.length, 0);
  // stipendio di febbraio corretto nel file, serata A tolta
  const p3 = plan(EN(1990, null), st1);
  assert.equal(p3.txs.length, 0);
  assert.deepEqual(p3.changed.map(u => [u.payee, u.ym, u.was, u.now]), [['STIPENDIO', '2026-02', 185000, 199000]]);
  assert.deepEqual(p3.removes.map(x => [x.payee, x.ym]), [['Serata A', '2026-01']]);
});

test('entrate importate prima delle impronte: riconosciute dal mese, non raddoppiate', () => {
  const st = sanitize({ ...defaults(),
    accounts: [{ id: 'a-f', name: 'Entrate e uscite dal file', type: 'checking', currency: 'EUR', inNetWorth: false }],
    categories: [{ id: 'c-st', name: 'STIPENDIO', kind: 'income', group: 'LAVORO' }, { id: 'c-bp', name: 'BUONI PASTO', kind: 'income', group: 'LAVORO' }, { id: 'c-dj', name: 'DJ', kind: 'income', group: 'MUSICA' }],
    transactions: [
      { id: 'old1', date: '2026-03-10', kind: 'income', amount: 185000, account: 'a-f', category: 'c-st', payee: 'STIPENDIO' },
      { id: 'old2', date: '2026-02-28', kind: 'income', amount: 170000, account: 'a-f', category: 'c-st', payee: 'STIPENDIO' },
    ] });
  const p = planMonths(readMonths(EN(), detectMonths(EN())), st, { year: 2026, kind: 'income', refDate: '2026-03-28' });
  assert.ok(!p.txs.some(t => t.payee === 'STIPENDIO' && t.date >= '2026-02-01'));
  assert.deepEqual(p.updates.filter(u => u.same).map(u => u.id), ['old1']);
  assert.deepEqual(p.changed.map(u => [u.id, u.was, u.now]), [['old2', 170000, 185000]]);
});

test('conto "solo nei mesi con un valore": nel Net Worth vale solo dove è scritto', async () => {
  const { derive } = await import('../js/core/model.js');
  const st = sanitize({ ...defaults(),
    accounts: [{ id: 'a-tfr', name: 'TFR Netto', type: 'receivable', currency: 'EUR', nwSparse: true }, { id: 'a-b', name: 'Banca', type: 'checking', currency: 'EUR' }],
    valuations: [
      { id: 'v1', account: 'a-tfr', date: '2025-12-31', value: 700000, kind: 'open', created: 1 },
      { id: 'v2', account: 'a-b', date: '2025-12-31', value: 120000, kind: 'open', created: 1 },
    ] });
  assert.equal(st.accounts[0].nwSparse, true);
  const S0 = derive(st, '2026-03-10').nwSheet(2026);
  const row = name => S0.sections.flatMap(x => x.rows).find(r => r.name === name).values.slice(0, 3);
  assert.deepEqual(row('TFR Netto'), [700000, null, null]);
  assert.deepEqual(row('Banca'), [120000, 120000, 120000]);
  assert.deepEqual(S0.total.slice(0, 3), [820000, 120000, 120000]);
});

test('righe fuori dalle sezioni di D: nella sua sezione dello stesso tipo, niente nomi inventati', async () => {
  const { derive } = await import('../js/core/model.js');
  const st = sanitize({ ...defaults(),
    accounts: [
      { id: 'a-b1', name: 'Banca Uno', type: 'checking', currency: 'EUR' },
      { id: 'a-b2', name: 'Banca Due', type: 'savings', currency: 'EUR' },        // non è nel layout
      { id: 'a-tfr', name: 'TFR', type: 'receivable', currency: 'EUR' },        // non è nel layout
      { id: 'a-x', name: 'Vanguard FTSE All-World', type: 'broker', currency: 'EUR' },   // tipo sconosciuto, nome da ETF
    ],
    valuations: ['a-b1', 'a-b2', 'a-tfr', 'a-x'].map((a, i) => ({ id: 'v' + i, account: a, date: '2026-01-31', value: 10000 * (i + 1), kind: 'open', created: 1 })),
    settings: { ...defaults().settings, nwLayout: { sections: [{ name: 'Cash - Liquidity', color: 1, items: ['a:a-b1'] }, { name: 'ETF', color: 2, items: [] }, { name: 'WORK', color: 3, items: [] }], labels: {} } } });
  const S0 = derive(st, '2026-03-10').nwSheet(2026);
  const where = Object.fromEntries(S0.sections.flatMap(x => x.rows.map(r => [r.name, x.name])));
  assert.equal(where['Banca Due'], 'Cash - Liquidity');
  assert.equal(where['TFR'], 'WORK');
  assert.equal(where['Vanguard FTSE All-World'], 'ETF');
  assert.ok(!S0.sections.some(x => ['Liquidità', 'Crediti', 'Altri investimenti'].includes(x.name)));
});

test('un conto nato dal file resta nella sua sezione del file; i tipi sconosciuti non si mescolano', async () => {
  const { derive } = await import('../js/core/model.js');
  const st = sanitize({ ...defaults(),
    accounts: [
      { id: 'a-etf', name: 'Indice Mondo', type: 'broker', currency: 'EUR', notes: 'Creato importando un file (sezione "ETF")' },
      { id: 'a-stk', name: 'Razzi Spa', type: 'broker', currency: 'EUR', notes: 'Creato importando un file (sezione "Stock")' },   // fuori dal layout
      { id: 'a-unk', name: 'Qualcosa', type: 'broker', currency: 'EUR' },                                                     // tipo sconosciuto, nessun indizio
    ],
    valuations: ['a-etf', 'a-stk', 'a-unk'].map((a, i) => ({ id: 'v' + i, account: a, date: '2026-01-31', value: 10000, kind: 'open', created: 1 })),
    settings: { ...defaults().settings, nwLayout: { sections: [{ name: 'ETF', color: 1, items: ['a:a-etf'] }, { name: 'Stock', color: 2, items: [] }], labels: {} } } });
  const S0 = derive(st, '2026-03-10').nwSheet(2026);
  const where = Object.fromEntries(S0.sections.flatMap(x => x.rows.map(r => [r.name, x.name])));
  assert.equal(where['Razzi Spa'], 'Stock');
  assert.notEqual(where['Qualcosa'], 'ETF');
});

test('conto rinominato in app: reimportando, la riga col nome vecchio è lo stesso conto', () => {
  const read = readNetWorth(NW, detectNetWorth(NW));
  const st = sanitize({ ...defaults(), accounts: [{ id: 'a-b1', name: 'Il mio conto', type: 'checking', currency: 'EUR', aka: ['banca uno'] }] });
  const { rows } = planNetWorth(read, st, { refDate: '2026-03-10' });
  const r = rows.find(x => x.name === 'Banca Uno');
  assert.equal(r.existing?.id, 'a-b1');
});

test('sottocategoria spostata a mano in un\'altra categoria: reimportando non ne nasce una nuova', () => {
  // D trascina "DJ" da MUSICA a LAVORO: l'app si ricorda da dove veniva (was) e il file la ritrova
  const st = sanitize({ ...defaults(),
    categories: [{ id: 'c-st', name: 'STIPENDIO', kind: 'income', group: 'LAVORO' }, { id: 'c-bp', name: 'BUONI PASTO', kind: 'income', group: 'LAVORO' },
      { id: 'c-dj', name: 'DJ', kind: 'income', group: 'LAVORO', was: ['musica|dj'] }] });
  assert.deepEqual(st.categories.find(c => c.id === 'c-dj').was, ['musica|dj']);
  const p = planMonths(readMonths(EN(), detectMonths(EN())), st, { year: 2026, kind: 'income', refDate: '2026-03-28' });
  assert.deepEqual(p.newCats, []);
  assert.ok(p.txs.filter(t => t.payee.startsWith('Serata')).every(t => t.catId === 'c-dj'));
});

test('valuta di una riga del Net Worth: dal Type o dal nome (solo per contanti e conti)', async () => {
  const { currencyFor } = await import('../js/core/sheets.js');
  assert.equal(currencyFor('Dollari', 'Contanti'), 'USD');
  assert.equal(currencyFor('$', 'Contanti'), 'USD');
  assert.equal(currencyFor('Cash', 'Contanti (USD)'), 'USD');
  assert.equal(currencyFor('Cash', 'Contanti $'), 'USD');
  assert.equal(currencyFor('Euro', 'Contanti'), null);
  assert.equal(currencyFor('ETF:S', 'iShares $ Treasury'), null);
});

test('sezione del Net Worth rinominata: il nome vecchio resta, e le righe nate da quella sezione ci tornano', async () => {
  const { derive } = await import('../js/core/model.js');
  const st = sanitize({ ...defaults(),
    accounts: [{ id: 'a-r', name: 'Razzi Spa', type: 'broker', currency: 'EUR', notes: 'Importato dal foglio Net Worth (sezione "Stock")' }],
    valuations: [{ id: 'v1', account: 'a-r', date: '2026-01-31', value: 25000, kind: 'open' }],
    settings: { ...defaults().settings, nwLayout: { sections: [{ name: 'Azioni', color: 3, items: [], was: ['Stock', '', 'Stock'] }, { name: 'ETF', items: ['a:zzz'] }], labels: {} } } });
  assert.deepEqual(st.settings.nwLayout.sections[0].was, ['Stock']);
  assert.equal(st.settings.nwLayout.sections[1].was, undefined);
  const G = derive(st).nwGroups();
  assert.ok(G.sections.find(x => x.name === 'Azioni').items.includes('a:a-r'));
});
