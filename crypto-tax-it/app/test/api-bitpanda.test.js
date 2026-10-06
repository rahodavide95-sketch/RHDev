// Collegamento API Bitpanda. La rete e' SIMULATA e implementa il comportamento descritto nelle fonti citate in
// src/api/bitpanda.js: autenticazione x-api-key, /operations paginato a cursore (page_size massimo 100, ultima pagina con
// next_cursor residuo, cursore sconosciuto = riparte da pagina 1), /currencies, /assets?id=, errori 401/429/5xx, e per i difetti
// emersi nella verifica: commissioni nei campi fee_amount/trade, storni (compensates), cursori senza has_next_page, pagine vuote,
// errori scritti nel corpo, rifiuto di page_size, reindirizzamenti/tempo massimo, date nulle.
// ATTENZIONE: la forma dei movimenti e' quella OSSERVATA da terzi su dati reali, non verificata da noi su un conto reale:
// questi test provano che il codice fa cio' che si intende, non che Bitpanda risponda davvero cosi'.
const { test } = require('node:test');
const { CT, D, Kind, T, ev, run, eq, blocking, codes, assert } = require('./helpers');
require('../src/api/common.js');
require('../src/platforms.js');
const B = require('../src/api/bitpanda.js');
const { ApiError } = CT.api.common;

// ---------------------------------------------------------------- dati di prova
const KEY = 'bp-test-KEY-0123456789abcdef';
const IDS = { eur: 'cur-eur', usd: 'cur-usd', gold: 'ast-gold', btc: 'ast-btc', eth: 'ast-eth', aapl: 'ast-aapl', bci: 'ast-bci', lev: 'ast-lev', ghost: 'ast-ghost', silver: 'ast-silver', odd: 'ast-odd' };
const CURRENCIES = [{ id: IDS.eur, symbol: 'EUR', name: 'Euro' }, { id: IDS.usd, symbol: 'USD', name: 'Dollaro' }];
const ASSETS = [
  { id: IDS.gold, name: 'Gold', symbol: 'XAU', type: 'commodity', group: 'metal' },
  { id: IDS.silver, name: 'Silver', symbol: 'XAG', type: 'commodity', group: 'metal' },
  { id: IDS.btc, name: 'Bitcoin', symbol: 'BTC', type: 'cryptocoin', group: 'coin' },
  { id: IDS.eth, name: 'Ethereum', symbol: 'ETH', type: 'cryptocoin', group: 'coin' },
  { id: IDS.aapl, name: 'Apple', symbol: 'AAPL', isin: 'US0378331005', type: 'equity_security', group: 'equity_stock' },
  { id: IDS.bci, name: 'Bitpanda Crypto Index 10', symbol: 'BCI10', type: 'index', group: 'index' },
  { id: IDS.lev, name: 'BTC 3x', symbol: 'BTC3L', type: 'cryptocoin', group: 'leveraged_token' },
  { id: IDS.odd, name: 'Petrolio', symbol: 'OIL', type: 'commodity', group: 'energy' },
];
const FIAT_IDS = new Set([IDS.eur, IDS.usd]);

/** Registro contabile di prova: assegna a ogni movimento il saldo dopo l'operazione, come fa Bitpanda (asset_balance_after). */
function ledger(opening = '0') {
  const specs = [];
  let n = 0;
  return {
    add(opType, ts, legs, o = {}) { specs.push({ opType, ts, legs, n: ++n, id: o.id }); return this; },
    ops() {
      const bal = new Map();
      const out = [];
      const sorted = specs.slice().sort((a, b) => a.ts.localeCompare(b.ts) || a.n - b.n);
      for (const s of sorted) {
        const transactions = s.legs.map((g, i) => {
          const wallet = g.wallet || `w-${g.ref}`;
          const signed = g.f === 'INCOMING' ? D(g.a) : D(g.a).neg();
          const prev = bal.get(wallet) || D(opening);
          const voided = g.after !== undefined;                          // movimento annullato: il saldo non cambia
          const after = voided ? prev : prev.plus(signed);
          bal.set(wallet, after);
          const tx = {
            transaction_id: `tx-${s.n}-${i}`, transaction_type: g.t, flow: g.f,
            asset_amount: { value: g.a }, credited_at: g.ts || s.ts, asset_balance_after: { value: voided ? g.after : after.toFixed() },
            wallet_id: wallet, order_id: String(s.n),
          };
          if (FIAT_IDS.has(g.ref) || g.cur) { tx.currency_id = g.ref; tx.asset_amount.currency_id = g.ref; } else { tx.asset_id = g.ref; tx.asset_amount.asset_id = g.ref; }
          if (g.extra) Object.assign(tx, g.extra);
          return tx;
        });
        out.push({ operation_id: s.id || `op-${s.n}`, operation_type: s.opType, transactions });
      }
      return out.reverse();     // l'API restituisce prima le piu' recenti
    },
  };
}
const L = (t, f, ref, a, o = {}) => ({ t, f, ref, a, ...o });
/** Registro con grande saldo iniziale: per provare solo la conversione, senza dover costruire lo storico dall'inizio. */
const rich = () => ledger('1000000000');
const rawOf = (operations, o = {}) => ({ version: 1, fetchedAt: '2026-10-05T10:00:00.000Z', currencies: CURRENCIES, assets: ASSETS, operations, ...o });
const parseOps = (operations, o) => B.parse(rawOf(operations, o), 'bp-api');
const kinds = (r) => r.events.map((e) => e.kind);

// ---------------------------------------------------------------- rete simulata
const res = (status, body, headers) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const b64 = (i) => Buffer.from(String(i)).toString('base64');

/** Server finto con le caratteristiche documentate/osservate. `s` permette di forzare anomalie. */
function fakeBitpanda(s) {
  s = { key: KEY, ops: [], assets: ASSETS, currencies: CURRENCIES, ...s };
  const log = [];
  const calls = { n: 0 };
  const f = async (url, init) => {
    calls.n++;
    const u = new URL(url);
    const headers = {};
    for (const [k, v] of Object.entries((init && init.headers) || {})) headers[k.toLowerCase()] = v;
    log.push({ url, path: u.pathname, params: Object.fromEntries(u.searchParams), headers, method: init && init.method, redirect: init && init.redirect, signal: init && init.signal });
    if (s.networkDown) throw new TypeError('Failed to fetch');
    if (s.respond) { const r = s.respond(u, calls.n, log); if (r) return r; }
    if (u.origin !== 'https://api.public.bitpanda.com' || !u.pathname.startsWith('/v1/')) return res(404, { error: { code: 'not_found' } });
    if (headers['x-api-key'] !== s.key) return res(401, { errors: [{ status: 401, code: 'unauthorized', title: `Unauthorized (chiave ${headers['x-api-key']})` }] });
    const p = u.pathname.slice(3);
    if (p === '/operations') {
      const size = Math.min(Number(u.searchParams.get('page_size') || 25), 100);          // massimo 100
      const cur = u.searchParams.get('cursor');
      let start = 0;
      if (cur && !s.ignoreCursor) { const i = Number(Buffer.from(cur, 'base64').toString()); start = Number.isInteger(i) && i >= 0 && i <= s.ops.length ? i : 0; }   // cursore sconosciuto: riparte da pagina 1
      const end = Math.min(start + size, s.ops.length);
      return res(200, { data: s.ops.slice(start, end), has_next_page: end < s.ops.length, next_cursor: s.noStaleCursor && end >= s.ops.length ? undefined : b64(end) });   // l'ultima pagina ha ancora un next_cursor
    }
    if (p === '/currencies') return res(200, { data: s.currencies });
    if (p === '/assets') {
      const id = u.searchParams.get('id');
      return res(200, { data: s.assets.filter((a) => a.id === id), has_next_page: false });
    }
    return res(404, { error: { code: 'not_found' } });
  };
  return { f, log, calls, state: s };
}

const noSleep = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };
async function doSync(srv, creds, extra = {}) {
  const sl = noSleep();
  const out = await B.sync(creds || { apiKey: KEY }, { fetch: srv.f, sleep: sl.sleep, now: () => new Date('2026-10-05T10:00:00.000Z'), ...extra });
  return { out, waits: sl.waits };
}
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof ApiError && e.code === code && !JSON.stringify([e.message, e.detail]).includes(KEY));
const opsRequests = (srv) => srv.log.filter((r) => r.path === '/v1/operations');

/** Storico di prova: deposito 3000 EUR, oro (2 acquisti, 1 vendita), BTC con commissioni separate. */
function sampleLedger() {
  return ledger()
    .add('deposit', '2025-01-05T09:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '3000')])
    .add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '600'), L('buy', 'INCOMING', IDS.gold, '10')])
    .add('buy', '2025-02-01T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '400'), L('buy', 'INCOMING', IDS.gold, '5')])
    .add('sell', '2025-03-05T10:00:00.000Z', [L('sell', 'OUTGOING', IDS.gold, '6'), L('sell', 'INCOMING', IDS.eur, '540')])
    .add('buy', '2025-06-01T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '1000'), L('buy', 'INCOMING', IDS.btc, '0.01'), L('fee', 'OUTGOING', IDS.eur, '10')])
    .add('sell', '2025-09-01T10:00:00.000Z', [L('sell', 'OUTGOING', IDS.btc, '0.004'), L('sell', 'INCOMING', IDS.eur, '500'), L('fee', 'OUTGOING', IDS.eur, '5')]);
}

// ---------------------------------------------------------------- contratto
test('contratto del connettore: campi, aiuti in italiano, limiti, piattaforma', () => {
  assert.equal(B.id, 'bitpanda'); assert.equal(B.label, 'Bitpanda'); assert.equal(B.platform, 'bitpanda');
  assert.ok(CT.PLATFORMS[B.platform], 'la piattaforma esiste nel catalogo');
  assert.equal(CT.api.bitpanda, B); assert.equal(typeof B.sync, 'function'); assert.equal(typeof B.parse, 'function');
  assert.deepEqual(B.fields.map((x) => [x.key, x.secret]), [['apiKey', true]]);
  assert.ok(Array.isArray(B.options));
  assert.ok(B.help.length >= 3 && B.help.every((x) => typeof x === 'string' && x.length > 10));
  const help = B.help.join(' ');
  assert.match(help, /Transaction/); assert.match(help, /Trade \(Read\)/); assert.match(help, /mai/i); assert.match(help, /scrittura/);
  assert.ok(B.limits.length >= 3 && B.limits.some((x) => /XAU/.test(x)) && B.limits.some((x) => /Azioni/.test(x)));
  assert.equal(B._internal.BASE_URL, 'https://api.public.bitpanda.com/v1');
});

// ---------------------------------------------------------------- sync: paginazione e finestre
test('sync: tutte le pagine (250 operazioni, pagine da 100), nessun buco ne doppione, nessuna finestra di date', async () => {
  const led = ledger();
  for (let i = 0; i < 250; i++) led.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1.00')]);
  const srv = fakeBitpanda({ ops: led.ops() });
  const { out } = await doSync(srv);
  const reqs = opsRequests(srv);
  assert.equal(reqs.length, 3, 'tre pagine: l\'ultima ha un next_cursor residuo che NON va seguito');
  assert.ok(reqs.every((r) => r.params.page_size === '100'), 'sempre il massimo documentato');
  assert.equal(reqs[0].params.cursor, undefined); assert.ok(reqs[1].params.cursor && reqs[2].params.cursor);
  assert.ok(srv.log.every((r) => !('from' in r.params) && !('to' in r.params)), 'nessuna finestra: si legge tutto lo storico');
  assert.deepEqual(out.raw.operations.map((o) => o.operation_id), srv.state.ops.map((o) => o.operation_id), 'stesso ordine, nessuna perdita');
  assert.equal(new Set(out.raw.operations.map((o) => o.operation_id)).size, 250);
  assert.equal(out.raw.version, 1); assert.equal(out.raw.fetchedAt, '2026-10-05T10:00:00.000Z');
  assert.equal(out.coverage[0].count, 250); assert.equal(out.coverage[0].complete, true);
  assert.equal(out.coverage[0].from, '2024-01-01T00:00:00.000Z'); assert.equal(out.coverage[0].to, '2024-01-01T00:04:09.000Z');
  assert.ok(srv.log.every((r) => r.headers['x-api-key'] === KEY && r.method === 'GET'));
});

test('sync: pagina piena esatta (100 operazioni) e conto vuoto', async () => {
  const led = ledger();
  for (let i = 0; i < 100; i++) led.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1')]);
  const srv = fakeBitpanda({ ops: led.ops(), noStaleCursor: true });
  const { out } = await doSync(srv);
  assert.equal(out.raw.operations.length, 100); assert.equal(opsRequests(srv).length, 1);
  const empty = await doSync(fakeBitpanda({ ops: [] }));
  assert.equal(empty.out.raw.operations.length, 0);
  assert.equal(empty.out.coverage[0].complete, false); assert.match(empty.out.coverage[0].note, /Transaction/);
});

test('sync: cursore non accettato (l\'API riparte da pagina 1) -> errore, mai dati parziali', async () => {
  const led = ledger();
  for (let i = 0; i < 150; i++) led.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1')]);
  await rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ ops: led.ops(), ignoreCursor: true }).f, sleep: async () => {} }), 'incomplete');
  // anche con un cursore che cambia ogni volta, ma pagine che ricominciano da capo, ci si ferma subito (non dopo migliaia di pagine)
  const first = led.ops().slice(0, 100);
  const loop = fakeBitpanda({ respond: (u, n) => (u.pathname === '/v1/operations' ? res(200, { data: first, has_next_page: true, next_cursor: `c${n}` }) : null) });
  await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: loop.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'incomplete' && /ripartita dall'inizio/.test(e.message));
  assert.equal(opsRequests(loop).length, 2);
});

test('sync: pagina troncata (altre pagine annunciate ma senza cursore) -> errore', async () => {
  const srv = fakeBitpanda({ ops: sampleLedger().ops(), respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: sampleLedger().ops().slice(0, 2), has_next_page: true }) : null) });
  await rejects(B.sync({ apiKey: KEY }, { fetch: srv.f, sleep: async () => {} }), 'incomplete');
  const stuck = fakeBitpanda({ respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: sampleLedger().ops().slice(0, 2), has_next_page: true, next_cursor: u.searchParams.get('cursor') || 'x' }) : null) });
  await rejects(B.sync({ apiKey: KEY }, { fetch: stuck.f, sleep: async () => {} }), 'incomplete');
});

test('sync: senza indicatore di pagina successiva si accetta solo una pagina non piena', async () => {
  const full = sampleLedger().ops();
  const ok = fakeBitpanda({ ops: full, respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: full }) : null) });
  assert.equal((await doSync(ok)).out.raw.operations.length, full.length);
  const led = ledger();
  for (let i = 0; i < 100; i++) led.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1')]);
  const hundred = led.ops();
  await rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: hundred }) : null) }).f, sleep: async () => {} }), 'format');
});

test('sync: grafia camelCase della paginazione accettata (la documentazione la mostra cosi)', async () => {
  const ops = sampleLedger().ops();
  const srv = fakeBitpanda({ ops, respond: (u) => {
    if (u.pathname !== '/v1/operations') return null;
    return u.searchParams.get('cursor') ? res(200, { data: ops.slice(3), hasNextPage: false }) : res(200, { data: ops.slice(0, 3), hasNextPage: true, nextCursor: 'c2' });
  } });
  assert.equal((await doSync(srv)).out.raw.operations.length, ops.length);
});

test('sync: operazione letta due volte (stesso contenuto) conta una volta; contenuto diverso -> errore', async () => {
  const ops = sampleLedger().ops();
  const dup = fakeBitpanda({ ops, respond: (u) => {
    if (u.pathname !== '/v1/operations') return null;
    return u.searchParams.get('cursor') ? res(200, { data: [ops[2], ...ops.slice(3)], has_next_page: false }) : res(200, { data: ops.slice(0, 3), has_next_page: true, next_cursor: 'c2' });
  } });
  const { out } = await doSync(dup);
  assert.equal(out.raw.operations.length, ops.length);
  const changed = fakeBitpanda({ ops, respond: (u) => {
    if (u.pathname !== '/v1/operations') return null;
    const alt = JSON.parse(JSON.stringify(ops[2])); alt.transactions[0].asset_amount.value = '999';
    return u.searchParams.get('cursor') ? res(200, { data: [alt, ...ops.slice(3)], has_next_page: false }) : res(200, { data: ops.slice(0, 3), has_next_page: true, next_cursor: 'c2' });
  } });
  await rejects(B.sync({ apiKey: KEY }, { fetch: changed.f, sleep: async () => {} }), 'incomplete');
});

// ---------------------------------------------------------------- sync: errori
test('sync: 429 con Retry-After viene ripetuto e il risultato e completo', async () => {
  const ops = sampleLedger().ops();
  let first = true;
  const srv = fakeBitpanda({ ops, respond: (u) => { if (first && u.pathname === '/v1/operations') { first = false; return res(429, { errors: [{ status: 429 }] }, { 'retry-after': '3' }); } return null; } });
  const { out, waits } = await doSync(srv);
  assert.deepEqual(waits, [3000]); assert.equal(out.raw.operations.length, ops.length); assert.equal(opsRequests(srv).length, 2);
});

test('sync: errori di rete, 401, 500 persistente, JSON non valido o troncato', async () => {
  const ops = sampleLedger().ops();
  await rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ networkDown: true }).f, sleep: async () => {} }), 'network');
  // chiave sbagliata: l'errore NON contiene la chiave, nemmeno se il server la ripete nel messaggio
  const WRONG = 'WRONGKEY-9876543210';
  await assert.rejects(() => B.sync({ apiKey: WRONG }, { fetch: fakeBitpanda({ ops }).f, sleep: async () => {} }),
    (e) => e instanceof ApiError && e.code === 'auth' && /Transaction/.test(e.message) && !JSON.stringify([e.message, e.detail]).includes(WRONG));
  const down = fakeBitpanda({ respond: () => res(503, 'Service Unavailable') });
  const sl = noSleep();
  await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: down.f, sleep: sl.sleep }), (e) => e.code === 'http');
  assert.equal(down.calls.n, 5, 'una richiesta + 4 ripetizioni, poi ci si ferma');
  assert.deepEqual(sl.waits, [2000, 4000, 8000, 16000]);
  await rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ respond: () => res(200, '<html>Bad gateway</html>') }).f, sleep: async () => {} }), 'format');
  await rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ respond: () => res(200, '{"data":[{"operation_id":"a","transac') }).f, sleep: async () => {} }), 'format');
  await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ respond: () => res(400, { errors: [{ title: `bad key ${KEY}` }] }) }).f, sleep: async () => {} }),
    (e) => e.code === 'http' && !JSON.stringify([e.message, e.detail]).includes(KEY));
});

test('sync: risposte con forma diversa da quella documentata -> errore format', async () => {
  const ops = sampleLedger().ops();
  const bad = (respond) => rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ ops, respond }).f, sleep: async () => {} }), 'format');
  await bad((u) => (u.pathname === '/v1/operations' ? res(200, { data: 'no' }) : null));
  await bad((u) => (u.pathname === '/v1/operations' ? res(200, { items: [] }) : null));
  await bad((u) => (u.pathname === '/v1/operations' ? res(200, [1, 2]) : null));
  await bad((u) => (u.pathname === '/v1/operations' ? res(200, { data: [{ operation_type: 'buy', transactions: [] }], has_next_page: false }) : null));
  await bad((u) => (u.pathname === '/v1/operations' ? res(200, { data: [{ operation_id: 'a', operation_type: 'buy', transactions: 5 }], has_next_page: false }) : null));
  await bad((u) => (u.pathname === '/v1/operations' ? res(200, { data: [], has_next_page: 'yes' }) : null));
  await bad((u) => (u.pathname === '/v1/currencies' ? res(200, { data: [{ symbol: 'EUR' }] }) : null));
  await bad((u) => (u.pathname === '/v1/assets' ? res(200, { data: [{ symbol: 'BTC' }] }) : null));
});

test('sync: chiave mancante o non valida -> errore di configurazione, nessuna richiesta', async () => {
  const srv = fakeBitpanda({});
  for (const bad of [undefined, {}, { apiKey: '' }, { apiKey: '   ' }, { apiKey: 'chiave con spazi' }, { apiKey: 'chiave\ncapo' }]) {
    await assert.rejects(() => B.sync(bad, { fetch: srv.f }), (e) => e instanceof ApiError && e.code === 'config');
  }
  assert.equal(srv.calls.n, 0);
});

test('sync: la chiave non compare in raw, avvisi, copertura, URL; e usata solo nell\'intestazione', async () => {
  const srv = fakeBitpanda({ ops: sampleLedger().ops() });
  const { out } = await doSync(srv);
  assert.ok(!JSON.stringify(out).includes(KEY));
  assert.ok(srv.log.every((r) => !r.url.includes(KEY) && r.headers['x-api-key'] === KEY));
  assert.ok(srv.log.every((r) => r.url.startsWith('https://api.public.bitpanda.com/v1/')));
  assert.equal(JSON.parse(JSON.stringify(out.raw)).operations.length, out.raw.operations.length, 'raw serializzabile');
});

test('sync: valute e asset scaricati; asset non in catalogo (elenco vuoto) -> operazione non riconosciuta, non errore', async () => {
  const led = ledger()
    .add('deposit', '2025-01-01T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '500')])
    .add('buy', '2025-01-02T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '100'), L('buy', 'INCOMING', IDS.ghost, '1')])
    .add('buy', '2025-01-03T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '100'), L('buy', 'INCOMING', IDS.btc, '0.001')]);
  for (const srv of [fakeBitpanda({ ops: led.ops() })]) {
    const { out } = await doSync(srv);
    assert.deepEqual(out.raw.assets.map((a) => a.id), [IDS.btc], 'solo gli asset trovati finiscono in raw');
    assert.deepEqual(out.raw.currencies, CURRENCIES);
    assert.ok(out.warnings.some((w) => /non risultano nel catalogo/.test(w)));
    const r = B.parse(out.raw, 'x');
    assert.deepEqual(kinds(r), [Kind.FIAT_IN, Kind.UNRESOLVED, Kind.BUY]);
    assert.equal(srv.log.filter((x) => x.path === '/v1/assets').length, 2, 'una richiesta per asset, con il filtro id documentato');
    assert.ok(srv.log.filter((x) => x.path === '/v1/assets').every((x) => x.params.id && !('page_size' in x.params)));
  }
  // qualunque errore HTTP sugli asset (500, ma anche 404) ferma la sincronizzazione: mai dati parziali
  for (const respond of [(u) => (u.pathname === '/v1/assets' ? res(500, 'boom') : null), (u) => (u.pathname === '/v1/assets' ? res(404, { error: { code: 'not_found' } }) : null)]) {
    const srv = fakeBitpanda({ ops: led.ops(), respond });
    await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: srv.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'http');
  }
});

// ---------------------------------------------------------------- sync: copertura e controllo di continuita
test('copertura: voce delle operazioni completa e verificata, voci dei prodotti non scaricati con nota', async () => {
  const { out } = await doSync(fakeBitpanda({ ops: sampleLedger().ops() }));
  const [ops, ...rest] = out.coverage;
  assert.equal(ops.what, B._internal.COV.ops); assert.equal(ops.count, 6); assert.equal(ops.complete, true); assert.match(ops.note, /saldo zero/);
  assert.equal(ops.from, '2025-01-05T09:00:00.000Z'); assert.equal(ops.to, '2025-09-01T10:00:00.000Z');
  assert.deepEqual(rest.map((c) => c.what), [B._internal.COV.stock, B._internal.COV.earn, B._internal.COV.index, B._internal.COV.other]);
  assert.ok(rest.every((c) => c.complete === false && typeof c.note === 'string' && c.note.length > 20 && c.from === null && c.to === null));
  for (const c of out.coverage) assert.ok(['what', 'count', 'from', 'to', 'complete', 'note'].every((k) => k in c));
  assert.ok(out.warnings.every((w) => typeof w === 'string'));
  assert.ok(out.warnings.some((w) => /non è ancora stato provato con un conto reale/.test(w)));
  assert.ok(out.warnings.some((w) => /grammo/.test(w)), 'avviso sull\'unita dell\'oro');
  assert.ok(out.warnings.some((w) => /commissioni come movimenti separati/.test(w)));
});

test('continuita: storico che non parte da zero (manca il periodo precedente) -> complete=false', async () => {
  const ops = sampleLedger().ops();
  const truncated = ops.filter((o) => o.operation_id !== 'op-1');       // senza il primo deposito: il conto in euro parte da un saldo negativo/diverso da zero
  const { out } = await doSync(fakeBitpanda({ ops: truncated }));
  assert.equal(out.coverage[0].complete, false);
  assert.match(out.coverage[0].note, /non risulta completo/); assert.ok(out.warnings.some((w) => /Storico possibilmente incompleto/.test(w)));
  // oro: manca il primo acquisto -> il portafoglio dell'oro parte da un saldo diverso da zero
  const { out: out2 } = await doSync(fakeBitpanda({ ops: ops.filter((o) => o.operation_id !== 'op-2') }));
  assert.equal(out2.coverage[0].complete, false); assert.ok(out2.warnings.some((w) => /invece che da zero/.test(w) && /XAU/.test(w)));
});

test('continuita: operazione mancante in mezzo allo storico -> complete=false', async () => {
  const ops = sampleLedger().ops().filter((o) => o.operation_id !== 'op-3');      // secondo acquisto di oro
  const { out } = await doSync(fakeBitpanda({ ops }));
  assert.equal(out.coverage[0].complete, false);
  assert.ok(out.warnings.some((w) => /non sono coerenti con i saldi/.test(w)));
});

test('continuita: senza saldi nei movimenti non si puo verificare -> complete=false con spiegazione', async () => {
  const ops = JSON.parse(JSON.stringify(sampleLedger().ops()));
  for (const o of ops) for (const t of o.transactions) delete t.asset_balance_after;
  const { out } = await doSync(fakeBitpanda({ ops }));
  assert.equal(out.coverage[0].complete, false); assert.match(out.coverage[0].note, /non ha fornito i saldi/);
});

test('continuita: depositi annullati (saldo -1) non falsano il controllo', async () => {
  const led = sampleLedger().add('deposit', '2025-02-10T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '77', { after: '-1' })], { id: 'op-void' });
  const { out } = await doSync(fakeBitpanda({ ops: led.ops() }));
  assert.equal(out.coverage[0].complete, true);
});

// ---------------------------------------------------------------- parse: acquisti e vendite
test('parse: acquisto e vendita di ORO -> XAU, assetHint Metal, importi esatti, data UTC', () => {
  const ops = rich()
    .add('buy', '2025-01-10T10:30:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '599.99'), L('buy', 'INCOMING', IDS.gold, '10.12345678')])
    .add('sell', '2025-03-05T09:00:00.000Z', [L('sell', 'OUTGOING', IDS.gold, '4.5'), L('sell', 'INCOMING', IDS.eur, '300.01')]).ops();
  const r = parseOps(ops);
  assert.deepEqual(kinds(r), [Kind.BUY, Kind.SELL]);
  const [buy, sell] = r.events;
  assert.equal(buy.asset, 'XAU'); assert.equal(buy.assetHint, 'Metal'); eq(buy.qty, '10.12345678'); eq(buy.value, '599.99'); assert.equal(buy.valueCcy, 'EUR');
  assert.equal(buy.ts.toISOString(), '2025-01-10T10:30:00.000Z'); assert.equal(buy.account, 'Bitpanda'); assert.equal(buy.account, CT.PLATFORMS.bitpanda.account);
  assert.equal(sell.asset, 'XAU'); assert.equal(sell.assetHint, 'Metal'); eq(sell.qty, '4.5'); eq(sell.value, '300.01');
  assert.equal(buy.feeQty.toString(), '0'); assert.equal(buy.feeAsset, '');
  assert.equal(r.label, 'Bitpanda · dati da API'); assert.equal(r.rows, 2); assert.deepEqual(r.unknown, []);
  assert.equal(buy.src, 'bp-api:op-1'); assert.equal(buy.uid, 'api:bitpanda:op-1'); assert.equal(sell.uid, 'api:bitpanda:op-2');
});

test('parse: argento e alias dei metalli; metallo con simbolo sconosciuto -> non riconosciuto', () => {
  const ok = parseOps(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '50'), L('buy', 'INCOMING', IDS.silver, '60')]).ops());
  assert.equal(ok.events[0].asset, 'XAG'); assert.equal(ok.events[0].assetHint, 'Metal');
  const gold = { ...ASSETS[0], symbol: 'GOLD' };
  const alias = B.parse(rawOf(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '50'), L('buy', 'INCOMING', IDS.gold, '1')]).ops(), { assets: [gold] }), 'x');
  assert.equal(alias.events[0].asset, 'XAU');
  const weird = { ...ASSETS[0], symbol: 'MYSTERY' };
  const bad = B.parse(rawOf(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '50'), L('buy', 'INCOMING', IDS.gold, '1')]).ops(), { assets: [weird] }), 'x');
  assert.deepEqual(kinds(bad), [Kind.UNRESOLVED]); assert.match(bad.events[0].note, /metallo non riconosciuto/);
});

test('parse: criptovalute con commissione separata (acquisto sommata al costo, vendita sottratta dall\'incasso) e piano di accumulo', () => {
  const r = parseOps(sampleLedger().add('savings_plan', '2025-07-01T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '50'), L('buy', 'INCOMING', IDS.eth, '0.02')]).ops());
  const byId = Object.fromEntries(r.events.map((e) => [e.uid, e]));
  const btcBuy = byId['api:bitpanda:op-5'], btcSell = byId['api:bitpanda:op-6'], plan = byId['api:bitpanda:op-7'];
  assert.equal(btcBuy.kind, Kind.BUY); assert.equal(btcBuy.asset, 'BTC'); assert.equal(btcBuy.assetHint, 'Cryptocurrency'); eq(btcBuy.value, 1000); assert.equal(btcBuy.feeAsset, 'EUR'); eq(btcBuy.feeQty, 10);
  assert.equal(btcSell.kind, Kind.SELL); eq(btcSell.value, 500); assert.equal(btcSell.feeAsset, 'EUR'); eq(btcSell.feeQty, 5);
  assert.equal(plan.kind, Kind.BUY); assert.equal(plan.asset, 'ETH'); eq(plan.value, 50); assert.equal(plan.feeAsset, '');
  assert.deepEqual(r.unknown, []);
});

test('parse: acquisto pagato in altra valuta -> valueCcy della valuta (il motore chiede il cambio, non lo inventa)', () => {
  const r = parseOps(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.usd, '110'), L('buy', 'INCOMING', IDS.btc, '0.001')]).ops());
  assert.equal(r.events[0].valueCcy, 'USD'); eq(r.events[0].value, 110);
  const { engine } = run(r.events);
  assert.ok(codes(engine, 'block').includes('missing_price'), 'senza il cambio USD/EUR il motore blocca invece di indovinare');
});

test('parse: azioni/ETF -> BUY/SELL con assetHint Stock/ETF, il motore le ignora con avviso (non vengono calcolate)', () => {
  const ops = rich()
    .add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '800'), L('buy', 'INCOMING', IDS.aapl, '4'), L('fee', 'OUTGOING', IDS.eur, '1'), L('tax', 'OUTGOING', IDS.eur, '2')])
    .add('buy_reserve', '2025-01-11T10:00:00.000Z', [L('transfer', 'OUTGOING', IDS.eur, '100')]).ops();
  const r = parseOps(ops);
  assert.deepEqual(kinds(r), [Kind.BUY, Kind.INFO]);
  const b = r.events[0]; assert.equal(b.asset, 'US0378331005'); assert.equal(b.assetHint, 'Stock'); eq(b.qty, 4); eq(b.value, 800);
  const { engine } = run(r.events);
  assert.deepEqual(codes(engine, 'warn'), ['out_of_scope']); assert.equal(engine.disposals.length, 0); assert.deepEqual(blocking(engine), []);
});

// ---------------------------------------------------------------- parse: trasferimenti e valute
test('parse: depositi e prelievi in euro -> FIAT_IN / FIAT_OUT', () => {
  const r = parseOps(rich()
    .add('deposit', '2025-01-01T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '1000')])
    .add('withdrawal', '2025-01-02T10:00:00.000Z', [L('withdrawal', 'OUTGOING', IDS.eur, '200.5'), L('fee', 'OUTGOING', IDS.eur, '1')]).ops());
  assert.deepEqual(kinds(r), [Kind.FIAT_IN, Kind.FIAT_OUT]);
  assert.equal(r.events[0].asset, 'EUR'); eq(r.events[0].qty, 1000); eq(r.events[1].qty, '200.5');
});

test('parse: deposito di cripto -> TRANSFER_IN; prelievo -> TRANSFER_OUT con la commissione di rete inclusa', () => {
  const r = parseOps(rich()
    .add('deposit', '2025-01-01T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.btc, '0.5')])
    .add('withdrawal', '2025-01-02T10:00:00.000Z', [L('withdrawal', 'OUTGOING', IDS.btc, '0.2'), L('fee', 'OUTGOING', IDS.btc, '0.0005')])
    .add('withdrawal', '2025-01-03T10:00:00.000Z', [L('withdrawal', 'OUTGOING', IDS.eth, '1')]).ops());
  assert.deepEqual(kinds(r), [Kind.TRANSFER_IN, Kind.TRANSFER_OUT, Kind.TRANSFER_OUT]);
  eq(r.events[0].qty, '0.5'); assert.equal(r.events[0].asset, 'BTC');
  eq(r.events[1].qty, '0.2005'); assert.match(r.events[1].note, /commissione di rete/); eq(r.events[2].qty, 1);
});

test('parse: piu movimenti nella stessa operazione -> un evento ciascuno con uid distinti', () => {
  const r = parseOps(rich().add('deposit', '2025-01-01T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '10'), L('deposit', 'INCOMING', IDS.eur, '20')]).ops());
  assert.deepEqual(kinds(r), [Kind.FIAT_IN, Kind.FIAT_IN]);
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 2); assert.ok(r.events.every((e) => e.uid.startsWith('api:bitpanda:op-1#')));
});

test('parse: prenotazioni di fondi e depositi annullati -> INFO (nessun effetto)', () => {
  const r = parseOps(rich()
    .add('stock_buy_reserve', '2025-01-01T10:00:00.000Z', [L('transfer', 'OUTGOING', IDS.eur, '100')])
    .add('deposit', '2025-01-02T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '50', { after: '-1' })]).ops());
  assert.deepEqual(kinds(r), [Kind.INFO, Kind.INFO]); assert.match(r.events[1].note, /annullata/);
});

// ---------------------------------------------------------------- parse: tutto cio che non e certo -> UNRESOLVED
test('parse: tipi sconosciuti, premi, indici, strutture anomale -> UNRESOLVED (mai ipotesi)', () => {
  const cases = {
    'tipo sconosciuto': [['swap', [L('buy', 'INCOMING', IDS.eth, '1'), L('sell', 'OUTGOING', IDS.btc, '0.05')]], /tipo "swap"/],
    'staking/premio': [['staking_reward', [L('reward', 'INCOMING', IDS.eth, '0.01')]], /premio, interesse o staking/],
    'interesse': [['interest', [L('interest', 'INCOMING', IDS.btc, '0.0001')]], /premio, interesse o staking/],
    'dividendo in euro': [['dividend', [L('dividend', 'INCOMING', IDS.eur, '3')]], /premio, interesse o staking/],
    'indice cripto (gamba)': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '0.0001', { extra: { index_asset_id: IDS.bci } })]], /indice cripto/],
    'indice cripto (asset)': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.bci, '1')]], /indice cripto/],
    'token a leva': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.lev, '1')]], /non gestito/],
    'altra materia prima': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.odd, '1')]], /non gestito/],
    'asset ignoto': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', 'ast-nope', '1')]], /asset sconosciuto/],
    'valuta ignota': [['buy', [L('buy', 'OUTGOING', 'cur-nope', '10', { cur: true }), L('buy', 'INCOMING', IDS.btc, '1')]], /valuta sconosciuta/],
    'due movimenti in valuta': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '1')]], /struttura diversa/],
    'scambio tra cripto come buy': [['buy', [L('buy', 'OUTGOING', IDS.btc, '1'), L('buy', 'INCOMING', IDS.eth, '10')]], /struttura diversa/],
    'imposta nell\'acquisto': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '1'), L('tax', 'OUTGOING', IDS.eur, '1')]], /"tax"/],
    'direzione invertita': [['buy', [L('buy', 'INCOMING', IDS.eur, '10'), L('buy', 'OUTGOING', IDS.btc, '1')]], /direzione inattesa/],
    'vendita con tipi misti': [['sell', [L('buy', 'INCOMING', IDS.eur, '10'), L('sell', 'OUTGOING', IDS.btc, '1')]], /"buy"/],
    'importo zero': [['buy', [L('buy', 'OUTGOING', IDS.eur, '0'), L('buy', 'INCOMING', IDS.btc, '1')]], /zero/],
    'commissioni in due valute': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '1'), L('fee', 'OUTGOING', IDS.eur, '1'), L('fee', 'OUTGOING', IDS.btc, '0.1')]], /più valute/],
    'commissione in entrata': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '1'), L('fee', 'INCOMING', IDS.eur, '1')]], /entrata/],
    'prelievo di metalli': [['withdrawal', [L('withdrawal', 'OUTGOING', IDS.gold, '5')]], /metalli/],
    'deposito con commissione': [['deposit', [L('deposit', 'INCOMING', IDS.btc, '1'), L('fee', 'OUTGOING', IDS.btc, '0.1')]], /commissioni/],
    'prelievo con commissione in euro': [['withdrawal', [L('withdrawal', 'OUTGOING', IDS.btc, '1'), L('fee', 'OUTGOING', IDS.eur, '2')]], /commissioni/],
    'deposito in valuta con direzione sbagliata': [['deposit', [L('deposit', 'OUTGOING', IDS.eur, '5')]], /direzione/],
    'operazione in valuta sconosciuta': [['cashback', [L('transfer', 'INCOMING', IDS.eur, '5')]], /tipo "cashback"/],
    'movimento di tipo ignoto in deposito': [['deposit', [L('deposit', 'INCOMING', IDS.btc, '1'), L('transfer', 'INCOMING', IDS.btc, '1')]], /"transfer"/],
    'saldo negativo parziale': [['buy', [L('buy', 'OUTGOING', IDS.eur, '10', { after: '-1' }), L('buy', 'INCOMING', IDS.btc, '1')]], /saldo negativo/],
  };
  for (const [name, [[opType, legs], re]] of Object.entries(cases)) {
    const r = parseOps(rich().add(opType, '2025-01-10T10:00:00.000Z', legs).ops());
    assert.equal(r.events.length, 1, name); assert.equal(r.events[0].kind, Kind.UNRESOLVED, name);
    assert.match(r.events[0].note + ' ' + r.events[0].unkKey, re, name);
    assert.ok(r.events[0].unkKey.startsWith('Bitpanda API · '), name); assert.equal(r.unknown.length, 1, name); assert.match(r.events[0].note, /^Operazione op-1 /, name);
    const { engine } = run(r.events); assert.deepEqual(codes(engine, 'block'), ['unrecognized_row'], name);
  }
});

test('parse: movimenti malformati (importo numerico, negativo, direzione, riferimenti, tipo, data) -> UNRESOLVED', () => {
  const base = () => JSON.parse(JSON.stringify(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '1')]).ops()));
  const mut = (f) => { const ops = base(); f(ops[0].transactions); return parseOps(ops); };
  const muts = {
    'importo numero JS': (t) => { t[1].asset_amount.value = 1; },
    'importo con virgola': (t) => { t[1].asset_amount.value = '1,5'; },
    'importo testo': (t) => { t[1].asset_amount.value = 'abc'; },
    'importo senza oggetto': (t) => { delete t[1].asset_amount; },
    'importo negativo': (t) => { t[1].asset_amount.value = '-1'; },
    'flow ignoto': (t) => { t[1].flow = 'SIDEWAYS'; },
    'flow mancante': (t) => { delete t[1].flow; },
    'senza riferimenti': (t) => { delete t[1].asset_id; },
    'doppio riferimento': (t) => { t[1].currency_id = IDS.eur; },
    'riferimento dell\'importo diverso': (t) => { t[1].asset_amount.asset_id = IDS.eth; },
    'tipo mancante': (t) => { delete t[1].transaction_type; },
    'movimento non oggetto': (t) => { t[1] = 'x'; },
    'senza data': (t) => { delete t[0].credited_at; delete t[1].credited_at; },
    'data non valida': (t) => { t[0].credited_at = 'ieri'; t[1].credited_at = 'ieri'; },
  };
  for (const [name, f] of Object.entries(muts)) {
    const r = mut(f);
    assert.equal(r.events.length, 1, name); assert.equal(r.events[0].kind, Kind.UNRESOLVED, name);
  }
});

test('parse: operazione senza tipo o senza movimenti, o record non valido in raw -> UNRESOLVED', () => {
  const ops = [
    { operation_id: 'a', transactions: [{ transaction_type: 'buy', flow: 'INCOMING', asset_id: IDS.btc, asset_amount: { value: '1' }, credited_at: '2025-01-01T00:00:00Z' }] },
    { operation_id: 'b', operation_type: 'buy', transactions: [] },
    { operation_type: 'buy', transactions: [] },
    null,
    'x',
    { operation_id: 'c', operation_type: 'buy', transactions: 'no' },
  ];
  const r = parseOps(ops);
  assert.ok(r.events.every((e) => e.kind === Kind.UNRESOLVED)); assert.equal(r.events.length, 6);
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 6, 'uid sempre distinti');
  assert.equal(r.rows, 2, 'solo le operazioni valide contano come righe');
});

// ---------------------------------------------------------------- parse: deduplica, determinismo, purezza
test('parse: operazioni duplicate in raw (finestre sovrapposte) contate una volta; duplicato diverso -> non riconosciuto', () => {
  const ops = sampleLedger().ops();
  const once = parseOps(ops);
  const twice = parseOps([...ops, ...ops]);
  assert.deepEqual(twice.events.map((e) => e.uid), once.events.map((e) => e.uid)); assert.equal(twice.rows, once.rows);
  const alt = JSON.parse(JSON.stringify(ops[0])); alt.transactions[0].asset_amount.value = '123';
  const conflict = parseOps([...ops, alt]);
  assert.equal(conflict.events.length, once.events.length + 1);
  const extra = conflict.events.find((e) => e.kind === Kind.UNRESOLVED);
  assert.match(extra.note, /due volte con contenuto diverso/); assert.ok(extra.uid.includes('#conflitto'));
});

test('parse: deterministico, senza rete e senza orologio; uid stabili e univoci; sopravvive a JSON.stringify', () => {
  const savedFetch = globalThis.fetch, savedNow = Date.now;
  globalThis.fetch = () => { throw new Error('parse non deve usare la rete'); };
  Date.now = () => { throw new Error('parse non deve usare l\'orologio'); };
  let a, b, c;
  try {
    const raw = rawOf(sampleLedger().ops());
    a = B.parse(raw, 'f.json'); b = B.parse(raw, 'f.json'); c = B.parse(JSON.parse(JSON.stringify(raw)), 'f.json');
  } finally { globalThis.fetch = savedFetch; Date.now = savedNow; }
  const ids = (r) => r.events.map((e) => e.uid);
  assert.deepEqual(ids(a), ids(b)); assert.deepEqual(ids(a), ids(c));
  assert.equal(new Set(ids(a)).size, ids(a).length);
  assert.ok(ids(a).every((u) => /^api:bitpanda:/.test(u)));
  assert.deepEqual(a.events.map((e) => e.qty.toString()), c.events.map((e) => e.qty.toString()));
  assert.ok(a.events.every((e) => e.ts instanceof Date && e.account === 'Bitpanda'));
});

test('parse: importi decimali esatti, mai float', () => {
  const r = parseOps(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '0.1'), L('buy', 'INCOMING', IDS.btc, '0.123456789012345678')]).add('buy', '2025-01-11T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '123456789.123456789'), L('buy', 'INCOMING', IDS.eth, '0.00000001')]).ops());
  assert.equal(r.events[0].qty.toFixed(), '0.123456789012345678'); assert.equal(r.events[0].value.toFixed(), '0.1');
  assert.equal(r.events[1].value.toFixed(), '123456789.123456789'); assert.equal(r.events[1].qty.toFixed(), '0.00000001');
});

test('parse: orari con fuso e frazioni di secondo -> istante UTC corretto', () => {
  const mk = (ts) => parseOps(rich().add('buy', ts, [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '1')]).ops()).events[0].ts.toISOString();
  assert.equal(mk('2025-07-01T10:00:00.610Z'), '2025-07-01T10:00:00.000Z');
  assert.equal(mk('2025-07-01T12:00:00+02:00'), '2025-07-01T10:00:00.000Z');
});

test('parse: raw non valido -> errore format', () => {
  for (const bad of [null, {}, { version: 2, operations: [], currencies: [], assets: [] }, { version: 1, operations: {}, currencies: [], assets: [] }, 'x']) {
    assert.throws(() => B.parse(bad, 'x'), (e) => e instanceof ApiError && e.code === 'format');
  }
});

test('parse: registrato come tipo di file api_bitpanda dal registro dei collegamenti', { skip: !require('node:fs').existsSync(require('node:path').join(__dirname, '../src/api/index.js')) && 'registro dei collegamenti assente' }, () => {
  const index = require('../src/api/index.js');
  assert.ok(index.ids().includes('bitpanda'));
  const t = CT.importers.TYPES.api_bitpanda;
  assert.ok(t); const r = t.parse(JSON.stringify(rawOf(sampleLedger().ops())), 'bitpanda-api.json');
  assert.equal(r.events.length, 6);
});

// ---------------------------------------------------------------- end-to-end
test('end-to-end: raw -> parse -> motore: plusvalenze calcolate a mano (oro LIFO + BTC con commissioni)', () => {
  const r = parseOps(sampleLedger().ops());
  assert.deepEqual(kinds(r), [Kind.FIAT_IN, Kind.BUY, Kind.BUY, Kind.SELL, Kind.BUY, Kind.SELL].map((k) => k));   // dal piu vecchio al piu recente
  const { engine, y } = run(r.events);
  assert.deepEqual(blocking(engine), []);
  // ORO (LIFO): lotti 10 g a 600 (gen) e 5 g a 400 (feb); vendita di 6 g a 540: 5 g dal lotto piu recente (costo 400) + 1 g dal piu vecchio (costo 60) = 460 -> +80
  const gold = engine.disposals.find((d) => d.asset === 'XAU');
  eq(gold.proceeds, 540); eq(gold.cost, 460); eq(gold.gain, 80); assert.equal(gold.cls, 'metal');
  eq(y.metals.gains, 80); eq(y.metals.net, 80);
  // BTC: costo 1000 + commissione 10 = 1010 per 0,01; vendita di 0,004 a 500 con commissione 5 -> incasso 495, costo 404 -> +91
  const btc = engine.disposals.find((d) => d.asset === 'BTC');
  eq(btc.proceeds, 495); eq(btc.cost, 404); eq(btc.gain, 91); assert.equal(btc.cls, 'crypto');
  eq(y.crypto.gains, 91); eq(y.crypto.net, 91);
  assert.deepEqual(engine.disposals.map((d) => d.asset).sort(), ['BTC', 'XAU']);
});

test('end-to-end: prelievo con commissione di rete abbinato all\'arrivo su un altro conto', () => {
  const r = parseOps(ledger()
    .add('deposit', '2025-06-02T08:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '1050')])
    .add('buy', '2025-06-02T09:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '1050'), L('buy', 'INCOMING', IDS.btc, '0.0105')])
    .add('withdrawal', '2025-06-02T10:00:00.000Z', [L('withdrawal', 'OUTGOING', IDS.btc, '0.01'), L('fee', 'OUTGOING', IDS.btc, '0.0005')]).ops());
  const arrival = ev(Kind.TRANSFER_IN, T(2025, 6, 2, 11), 'BTC', '0.01', { account: 'Wallet hardware' });
  const { engine } = run([...r.events, arrival]);
  assert.deepEqual(blocking(engine), []);
  const fee = engine.disposals.find((d) => d.kind === 'transfer_fee');
  // prezzo del giorno dedotto dall'acquisto: 100.000 EUR/BTC; commissione di rete 0,0005 BTC = 50 EUR di incasso e 50 di costo -> plusvalenza 0
  eq(fee.qty, '0.0005'); eq(fee.proceeds, 50); eq(fee.cost, 50); eq(fee.gain, 0);
  assert.equal(engine.pools.get('BTC').balance.toString(), '0.01');
});

test('end-to-end: un\'operazione non riconosciuta blocca il risultato definitivo', () => {
  const r = parseOps(sampleLedger().add('staking_reward', '2025-04-01T10:00:00.000Z', [L('reward', 'INCOMING', IDS.eth, '0.01')]).ops());
  const { engine } = run(r.events);
  assert.deepEqual(codes(engine, 'block'), ['unrecognized_row']);
  assert.equal(r.unknown.length, 1);
});

test('end-to-end: sync (rete simulata) -> raw -> parse -> motore, con la stessa plusvalenza attesa', async () => {
  const srv = fakeBitpanda({ ops: sampleLedger().ops() });
  const { out } = await doSync(srv);
  assert.equal(out.coverage[0].complete, true);
  const r = B.parse(JSON.parse(JSON.stringify(out.raw)), 'bitpanda-api.json');
  assert.equal(r.events.length, 6); assert.deepEqual(r.unknown, []);
  const { engine, y } = run(r.events);
  assert.deepEqual(blocking(engine), []);
  eq(y.metals.net, 80); eq(y.crypto.net, 91);
  assert.ok(!JSON.stringify(out).includes(KEY));
});

// ====================================================================================================================
// CORREZIONI DOPO LA VERIFICA: ogni test sotto protegge da un difetto confermato (nessun dato fiscale sbagliato in silenzio)
// ====================================================================================================================
const fromSrc = () => require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/api/bitpanda.js'), 'utf8');
const money = (value, extra = {}) => ({ value, ...extra });

// ---------------------------------------------------------------- commissioni nei campi fee_amount / trade.fee / rate_with_fee
test('parse: commissione in fee_amount / trade.fee / rate_with_fee -> UNRESOLVED (mai evento identico a quello senza commissione)', () => {
  const buyLegs = (assetExtra = {}, fiatExtra = {}, assetId = IDS.btc, qty = '0.01') => [L('buy', 'OUTGOING', IDS.eur, '500', { extra: fiatExtra }), L('buy', 'INCOMING', assetId, qty, { extra: assetExtra })];
  const cases = {
    'acquisto, fee_amount sul movimento asset': ['buy', buyLegs({ fee_amount: money('0.0001', { asset_id: IDS.btc }) }), /fee_amount = 0\.0001/],
    'acquisto, fee_amount sul movimento in valuta': ['buy', buyLegs({}, { fee_amount: money('5', { currency_id: IDS.eur }) }), /fee_amount = 5/],
    'acquisto, trade.fee con rate e rate_with_fee': ['buy', buyLegs({ trade: { trade_id: 'T1', fee: money('5'), rate: money('50000'), rate_with_fee: money('50500') } }), /trade\.fee = 5/],
    'acquisto, solo rate_with_fee diverso da rate': ['buy', buyLegs({ trade: { rate: money('50000'), rate_with_fee: money('50500') } }), /rate_with_fee \(50500\) diverso da trade\.rate \(50000\)/],
    'acquisto di oro con fee_amount': ['buy', buyLegs({ fee_amount: money('0.01') }, {}, IDS.gold, '10'), /fee_amount = 0\.01/],
    'piano di accumulo con trade.fee come stringa': ['savings_plan', buyLegs({ trade: { fee: '1.5' } }), /trade\.fee = 1\.5/],
    'fee_amount non leggibile (numero JS)': ['buy', buyLegs({ fee_amount: 5 }), /valore non leggibile/],
    'fee_amount con valore nullo': ['buy', buyLegs({ fee_amount: { value: null } }), /valore non leggibile/],
    'fee_amount negativo': ['buy', buyLegs({ fee_amount: money('-1') }), /valore non leggibile/],
    'vendita con fee_amount': ['sell', [L('sell', 'OUTGOING', IDS.btc, '0.004', { extra: { fee_amount: money('0.00001') } }), L('sell', 'INCOMING', IDS.eur, '200')], /fee_amount = 0\.00001/],
    'prelievo di cripto con fee_amount': ['withdrawal', [L('withdrawal', 'OUTGOING', IDS.btc, '0.2', { extra: { fee_amount: money('0.0005') } })], /fee_amount = 0\.0005/],
    'prelievo con fee_amount E movimento fee (rischio di doppio conteggio)': ['withdrawal', [L('withdrawal', 'OUTGOING', IDS.btc, '0.2', { extra: { fee_amount: money('0.0005') } }), L('fee', 'OUTGOING', IDS.btc, '0.0005')], /fee_amount = 0\.0005/],
    'deposito di cripto con fee_amount': ['deposit', [L('deposit', 'INCOMING', IDS.btc, '1', { extra: { fee_amount: money('0.0002') } })], /fee_amount = 0\.0002/],
  };
  for (const [name, [opType, legs, re]] of Object.entries(cases)) {
    const r = parseOps(rich().add(opType, '2025-01-10T10:00:00.000Z', legs).ops());
    assert.equal(r.events.length, 1, name); assert.equal(r.events[0].kind, Kind.UNRESOLVED, name);
    assert.match(r.events[0].note, re, name); assert.match(r.events[0].note, /non documenta se è già compresa/, name);
    assert.ok(r.events[0].unkKey.startsWith('Bitpanda API · '), name); assert.equal(r.unknown.length, 1, name);
    const { engine } = run(r.events); assert.deepEqual(codes(engine, 'block'), ['unrecognized_row'], name);
  }
});

test('parse: commissioni assenti, vuote o a zero NON bloccano; azioni e valute non sono toccate dai campi commissione', () => {
  const ok = (assetExtra, fiatExtra = {}) => parseOps(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '500', { extra: fiatExtra }), L('buy', 'INCOMING', IDS.btc, '0.01', { extra: assetExtra })]).ops());
  for (const [name, extra, fiat] of [
    ['fee_amount zero', { fee_amount: money('0.00000000') }, {}], ['fee_amount null', { fee_amount: null }, {}], ['fee_amount oggetto vuoto', { fee_amount: {} }, {}],
    ['fee_amount zero sul movimento in valuta', {}, { fee_amount: money('0') }],
    ['trade senza commissione', { trade: { trade_id: 'T1' } }, {}], ['trade.fee zero', { trade: { fee: money('0'), rate: money('50000'), rate_with_fee: money('50000') } }, {}],
    ['rate e rate_with_fee uguali come numeri', { trade: { rate: money('50000'), rate_with_fee: money('50000.00') } }, {}],
  ]) {
    const r = ok(extra, fiat);
    assert.deepEqual(kinds(r), [Kind.BUY], name); eq(r.events[0].qty, '0.01'); eq(r.events[0].value, 500); assert.equal(r.events[0].feeAsset, '', name);
  }
  // azioni/ETF (non calcolati) e depositi in euro: un fee_amount non li trasforma in blocchi
  const stock = parseOps(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '800'), L('buy', 'INCOMING', IDS.aapl, '4', { extra: { fee_amount: money('1') } })]).ops());
  assert.deepEqual(kinds(stock), [Kind.BUY]); assert.equal(stock.events[0].assetHint, 'Stock');
  const fiat = parseOps(rich().add('withdrawal', '2025-01-10T10:00:00.000Z', [L('withdrawal', 'OUTGOING', IDS.eur, '10', { extra: { fee_amount: money('1') } })]).ops());
  assert.deepEqual(kinds(fiat), [Kind.FIAT_OUT]);
});

test('sync: operazioni con commissione in un campo -> avviso; prelievi con movimento fee separato -> avviso (anche senza commissioni sugli acquisti)', async () => {
  const withFee = ledger()
    .add('deposit', '2025-01-05T09:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '1500')])
    .add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '1000'), L('buy', 'INCOMING', IDS.btc, '0.02', { extra: { fee_amount: money('0.0001') } })]);
  const a = await doSync(fakeBitpanda({ ops: withFee.ops() }));
  assert.ok(a.out.warnings.some((w) => /commissione in un campo \(fee_amount o trade\.fee\)/.test(w)));
  assert.ok(a.out.warnings.some((w) => /1 operazioni non sono state riconosciute/.test(w)));
  assert.equal(JSON.stringify(a.out.raw).includes('"fee_amount":{"value":"0.0001"}'), true, 'raw conserva la risposta com\'e\'');
  assert.deepEqual(kinds(B.parse(a.out.raw, 'x')), [Kind.FIAT_IN, Kind.UNRESOLVED]);

  const wd = ledger()
    .add('deposit', '2025-01-05T09:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '1000')])
    .add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '1000'), L('buy', 'INCOMING', IDS.btc, '0.02')])
    .add('withdrawal', '2025-01-20T10:00:00.000Z', [L('withdrawal', 'OUTGOING', IDS.btc, '0.01'), L('fee', 'OUTGOING', IDS.btc, '0.0005')]);
  const b = await doSync(fakeBitpanda({ ops: wd.ops() }));
  assert.ok(b.out.warnings.some((w) => /1 prelievi di criptovalute hanno la commissione di rete come movimento separato/.test(w) && /non è documentata/.test(w)));
  assert.ok(!b.out.warnings.some((w) => /commissioni come movimenti separati: sono sommate/.test(w)), 'nessuna commissione su acquisti/vendite');
  const out = B.parse(b.out.raw, 'x').events.find((e) => e.kind === Kind.TRANSFER_OUT);
  eq(out.qty, '0.0105');
  // senza commissioni nessuno dei due avvisi
  const c = await doSync(fakeBitpanda({ ops: sampleLedger().ops().filter((o) => !['op-5', 'op-6'].includes(o.operation_id)) }));
  assert.ok(!c.out.warnings.some((w) => /prelievi di criptovalute|commissione in un campo/.test(w)));
});

// ---------------------------------------------------------------- storni e correzioni (compensates)
test('parse: storno (compensates) E operazione stornata -> UNRESOLVED; niente acquisto fantasma', () => {
  const bought = (extra) => rich()
    .add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '500'), L('buy', 'INCOMING', IDS.btc, '0.01')])
    .add('sell', '2025-01-11T10:00:00.000Z', [L('sell', 'OUTGOING', IDS.btc, '0.01', { extra }), L('sell', 'INCOMING', IDS.eur, '500')])
    .add('deposit', '2025-01-12T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '10')]);
  for (const [name, extra, re] of [
    ['compensates con l\'id di una transazione', { compensates: 'tx-1-1' }, /fa riferimento a tx-1-1/],
    ['compensates come oggetto', { compensates: { transaction_id: 'tx-1-1' } }, /tx-1-1/],
    ['compensates_info', { compensates_info: { original_transaction_id: 'tx-1-1', reason: 'errore' } }, /tx-1-1/],
    ['compensates con l\'id dell\'operazione', { compensates: 'op-1' }, /op-1/],
  ]) {
    const r = parseOps(bought(extra).ops());
    assert.deepEqual(kinds(r), [Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.FIAT_IN], name);
    const [orig, rev] = r.events;
    assert.equal(orig.uid, 'api:bitpanda:op-1', name); assert.match(orig.note, /è stata stornata o corretta dall'operazione op-2/, name);
    assert.equal(rev.uid, 'api:bitpanda:op-2', name); assert.match(rev.note, /è uno storno o una correzione/, name); assert.match(rev.note, re, name);
    assert.ok(!r.events.some((e) => e.kind === Kind.BUY || e.kind === Kind.SELL), name);
    assert.equal(r.unknown.length, 1); assert.equal(r.unknown[0].count, 2);
    const { engine } = run(r.events); assert.deepEqual(codes(engine, 'block'), ['unrecognized_row', 'unrecognized_row'], name); assert.equal(engine.disposals.length, 0);
  }
});

test('parse: compensates senza riferimenti noti blocca solo lo storno; compensates vuoto o assente non cambia nulla; anche a livello di operazione', () => {
  const ops = rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '500'), L('buy', 'INCOMING', IDS.btc, '0.01')])
    .add('deposit', '2025-01-12T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '10', { extra: { compensates: 'tx-che-non-ho-scaricato' } })]).ops();
  const r = parseOps(ops);
  assert.deepEqual(kinds(r), [Kind.BUY, Kind.UNRESOLVED]); assert.match(r.events[1].note, /compensates/);
  for (const empty of [null, '', [], {}, false, '  ']) {
    const q = parseOps(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '500', { extra: { compensates: empty, compensates_info: empty } }), L('buy', 'INCOMING', IDS.btc, '0.01')]).ops());
    assert.deepEqual(kinds(q), [Kind.BUY], JSON.stringify(empty));
  }
  // compensates scritto sull'operazione invece che sul movimento
  const top = JSON.parse(JSON.stringify(rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '500'), L('buy', 'INCOMING', IDS.btc, '0.01')]).ops()));
  top[0].compensates = 'tx-9-9';
  assert.deepEqual(kinds(parseOps(top)), [Kind.UNRESOLVED]);
  // l'uid resta quello dell'operazione: nessun doppione
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 2);
});

test('sync: storno rilevato -> avviso e coverage non completa', async () => {
  const led = sampleLedger().add('sell', '2025-09-05T10:00:00.000Z', [L('sell', 'OUTGOING', IDS.gold, '1', { extra: { compensates: 'tx-2-1' } }), L('sell', 'INCOMING', IDS.eur, '90')]);
  const { out } = await doSync(fakeBitpanda({ ops: led.ops() }));
  assert.ok(out.warnings.some((w) => /sono storni o correzioni \(campo "compensates"\)/.test(w)));
  const r = B.parse(out.raw, 'x');
  assert.equal(r.events.filter((e) => e.kind === Kind.UNRESOLVED).length, 2);
});

// ---------------------------------------------------------------- paginazione: cursore senza has_next_page, pagine vuote, page_size rifiutato
test('sync: cursore di continuazione SENZA has_next_page -> errore, anche con pagina corta (forma OpenAPI { data, cursor })', async () => {
  const ops = sampleLedger().ops();
  for (const shape of [{ next_cursor: 'c2' }, { nextCursor: 'c2' }, { cursor: 'c2' }, { end_cursor: 'c2' }]) {
    const srv = fakeBitpanda({ ops, respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: ops.slice(0, 2), ...shape }) : null) });
    await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: srv.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'incomplete' && /non dice se ci sono altre pagine/.test(e.message), JSON.stringify(shape));
    assert.equal(opsRequests(srv).length, 1, JSON.stringify(shape));
  }
  // la forma ufficiale con 60 operazioni e pagine da 25: prima 25 su 60 con complete=true (a volte), ora errore
  const led = ledger();
  for (let i = 0; i < 60; i++) led.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1')]);
  const all = led.ops();
  const official = fakeBitpanda({ ops: all, respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: all.slice(0, 25), cursor: 'abc' }) : null) });
  await rejects(B.sync({ apiKey: KEY }, { fetch: official.f, sleep: async () => {} }), 'incomplete');
  // lo stesso vale per /currencies e /assets
  await rejects(B.sync({ apiKey: KEY }, { fetch: fakeBitpanda({ ops, respond: (u) => (u.pathname === '/v1/currencies' ? res(200, { data: CURRENCIES, cursor: 'x' }) : null) }).f, sleep: async () => {} }), 'incomplete');
});

test('sync: senza has_next_page e senza cursore la pagina corta e\' accettata, ma la fine NON e\' confermata (complete=false, nota onesta)', async () => {
  const ops = sampleLedger().ops();
  for (const extra of [{}, { next_cursor: null, cursor: '' }]) {
    const srv = fakeBitpanda({ ops, respond: (u) => (u.pathname === '/v1/operations' ? res(200, { data: ops, ...extra }) : null) });
    const { out } = await doSync(srv);
    assert.equal(out.raw.operations.length, ops.length);
    assert.equal(out.coverage[0].complete, false);
    assert.match(out.coverage[0].note, /non ha confermato la fine dell'elenco/); assert.doesNotMatch(out.coverage[0].note, /Lette tutte le pagine/);
    assert.ok(out.warnings.some((w) => /non ha confermato la fine dell'elenco delle operazioni/.test(w)), 'avviso visibile anche fuori dalla copertura');
  }
  // con has_next_page === false la fine e' confermata
  const { out } = await doSync(fakeBitpanda({ ops }));
  assert.equal(out.coverage[0].complete, true); assert.match(out.coverage[0].note, /fine confermata da Bitpanda/);
});

test('sync: pagine vuote con has_next_page=true -> ci si ferma dopo 3 richieste, non 2000', async () => {
  const loop = fakeBitpanda({ respond: (u, n) => (u.pathname === '/v1/operations' ? res(200, { data: [], has_next_page: true, next_cursor: `c${n}` }) : null) });
  await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: loop.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'incomplete' && /pagine vuote/.test(e.message));
  assert.equal(opsRequests(loop).length, 3);
  // pagine vuote NON consecutive (separate da pagine con dati) sono ammesse: il conteggio riparte
  const ops = sampleLedger().ops();
  const seq = [[], [], ops.slice(0, 3), [], [], ops.slice(3)];
  let i = 0;
  const ok = fakeBitpanda({ ops, respond: (u) => { if (u.pathname !== '/v1/operations') return null; const page = seq[i++]; return res(200, { data: page, has_next_page: i < seq.length, next_cursor: `c${i}` }); } });
  const { out } = await doSync(ok);
  assert.equal(out.raw.operations.length, ops.length); assert.equal(out.coverage[0].complete, true);
});

test('sync: page_size=100 rifiutato (HTTP 400) alla prima pagina -> una ripetizione senza page_size; poi errore chiaro', async () => {
  const led = ledger();
  for (let i = 0; i < 60; i++) led.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1')]);
  const ops = led.ops();
  const srv = fakeBitpanda({ ops, respond: (u) => (u.pathname === '/v1/operations' && u.searchParams.has('page_size') ? res(400, { errors: [{ status: 400, code: 'bad_request', title: `page_size ${KEY}` }] }) : null) });
  const { out } = await doSync(srv);
  const reqs = opsRequests(srv);
  assert.equal(reqs.length, 4, 'prova con page_size, poi tre pagine da 25 senza');
  assert.equal(reqs[0].params.page_size, '100'); assert.ok(reqs.slice(1).every((r) => !('page_size' in r.params)));
  assert.equal(out.raw.operations.length, 60); assert.equal(out.coverage[0].complete, true);
  assert.ok(out.warnings.some((w) => /dimensione di pagina/.test(w)));
  assert.ok(!JSON.stringify(out).includes(KEY));
  // il rifiuto persiste: errore 'http' con spiegazione e invito a usare il file, dopo 2 sole richieste
  const dead = fakeBitpanda({ respond: (u) => (u.pathname === '/v1/operations' ? res(400, { errors: [{ status: 400 }] }) : null) });
  await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: dead.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'http' && /rifiutato la richiesta delle operazioni/.test(e.message) && /file CSV/.test(e.message));
  assert.equal(opsRequests(dead).length, 2);
  // un 400 su una pagina successiva alla prima (cursore) NON innesca la ripetizione: errore subito
  const big = ledger();
  for (let i = 0; i < 150; i++) big.add('deposit', new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(), [L('deposit', 'INCOMING', IDS.eur, '1')]);
  const late = fakeBitpanda({ ops: big.ops(), respond: (u) => (u.pathname === '/v1/operations' && u.searchParams.has('cursor') ? res(400, { errors: [{ status: 400 }] }) : null) });
  await rejects(B.sync({ apiKey: KEY }, { fetch: late.f, sleep: async () => {} }), 'http');
  assert.equal(opsRequests(late).length, 2); assert.equal(opsRequests(late)[1].params.page_size, '100');
  // un 400 su /currencies non ha alternative
  const cur = fakeBitpanda({ ops, respond: (u) => (u.pathname === '/v1/currencies' ? res(400, { errors: [{ status: 400 }] }) : null) });
  await rejects(B.sync({ apiKey: KEY }, { fetch: cur.f, sleep: async () => {} }), 'http');
  assert.equal(cur.log.filter((r) => r.path === '/v1/currencies').length, 1);
});

// ---------------------------------------------------------------- errori scritti nel corpo di una risposta HTTP 200
test('sync: errore nel corpo con HTTP 200 -> classificato (auth, rate, http), ripetuto se transitorio, mai accettato come dati', async () => {
  const ops = sampleLedger().ops();
  const bodyOf = (body) => fakeBitpanda({ ops, respond: (u) => (u.pathname === '/v1/operations' ? res(200, body) : null) });
  // chiave rifiutata: messaggio sui permessi, nessuna ripetizione, la chiave mai nel testo (nemmeno se il server la ripete)
  for (const body of [{ errors: [{ status: 401, code: 'unauthorized', title: `Unauthorized ${KEY}` }] }, { errors: [{ status: 403, code: 'forbidden' }] }, { error: { code: 'invalid_api_key' } }, { error: { status: 401 } }]) {
    const srv = bodyOf(body);
    await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: srv.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'auth' && /Transaction/.test(e.message) && !JSON.stringify([e.message, e.detail]).includes(KEY), JSON.stringify(body));
    assert.equal(opsRequests(srv).length, 1);
  }
  // limite di frequenza nel corpo: ripetuto con attesa crescente, poi 'rate'
  const rate = bodyOf({ error: { code: 'rate_limited', status: 429 } });
  const sl = noSleep();
  await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: rate.f, sleep: sl.sleep }), (e) => e instanceof ApiError && e.code === 'rate');
  assert.deepEqual(sl.waits, [2000, 4000, 8000, 16000]); assert.equal(opsRequests(rate).length, 5);
  // errore del server nel corpo, anche insieme a data: 'http' dopo le ripetizioni, mai "conto vuoto"
  const both = bodyOf({ data: [], errors: [{ status: 500, code: 'internal' }], has_next_page: false });
  await rejects(B.sync({ apiKey: KEY }, { fetch: both.f, sleep: async () => {} }), 'http');
  assert.equal(opsRequests(both).length, 5);
  // altro errore (422) e codice senza stato: 'http' subito, nessuna ripetizione
  for (const body of [{ errors: [{ status: 422, code: 'invalid' }] }, { error: { code: 'not_found' } }, { error: 'boom' }]) {
    const srv = bodyOf(body);
    await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: srv.f, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'http' && !JSON.stringify([e.message, e.detail]).includes(KEY), JSON.stringify(body));
    assert.equal(opsRequests(srv).length, 1);
  }
  // un errore transitorio che poi passa: completo
  let first = true;
  const flaky = fakeBitpanda({ ops, respond: (u) => { if (first && u.pathname === '/v1/operations') { first = false; return res(200, { errors: [{ status: 503, code: 'unavailable' }] }); } return null; } });
  const r = await doSync(flaky);
  assert.deepEqual(r.waits, [2000]); assert.equal(r.out.raw.operations.length, ops.length); assert.equal(r.out.coverage[0].complete, true);
  // campi di errore vuoti NON sono errori
  for (const extra of [{ errors: [] }, { error: null }, { errors: [], error: null }]) {
    const srv = bodyOf({ data: ops, has_next_page: false, ...extra });
    assert.equal((await doSync(srv)).out.raw.operations.length, ops.length, JSON.stringify(extra));
  }
  assert.equal(B._internal.bodyError({ data: [] }, KEY), null); assert.equal(B._internal.bodyError([1], KEY), null);
});

// ---------------------------------------------------------------- reindirizzamenti e tempo massimo
test('sync: nessun reindirizzamento seguito e tempo massimo per OGNI richiesta (anche nelle ripetizioni)', async () => {
  let first = true;
  const srv = fakeBitpanda({ ops: sampleLedger().ops(), respond: (u) => { if (first && u.pathname === '/v1/operations') { first = false; return res(429, {}, { 'retry-after': '1' }); } return null; } });
  await doSync(srv);
  assert.ok(srv.log.length > 4);
  assert.ok(srv.log.every((r) => r.redirect === 'error'), 'la chiave non deve seguire un redirect verso un\'altra origine');
  if (typeof AbortSignal.timeout === 'function') {
    assert.ok(srv.log.every((r) => r.signal instanceof AbortSignal));
    assert.equal(new Set(srv.log.map((r) => r.signal)).size, srv.log.length, 'un segnale nuovo per ogni tentativo: uno scaduto resterebbe scaduto');
  }
  // un reindirizzamento rifiutato o un tempo scaduto sono errori di rete: nessun dato, nessuna chiave nel messaggio
  for (const err of [new TypeError('redirect mode is set to error'), new DOMException('The operation timed out.', 'TimeoutError')]) {
    await assert.rejects(() => B.sync({ apiKey: KEY }, { fetch: async () => { throw err; }, sleep: async () => {} }), (e) => e instanceof ApiError && e.code === 'network' && !JSON.stringify([e.message, e.detail]).includes(KEY));
  }
});

// ---------------------------------------------------------------- date nulle: mai ts=null (il motore e il PDF non le accettano)
test('parse: operazione senza credited_at -> UNRESOLVED con data dello scarico (mai null); il motore con rebase2025 non va in crash', () => {
  const undated = (opType, legs, o = {}) => { const ops = JSON.parse(JSON.stringify(rich().add(opType, '2025-01-10T10:00:00.000Z', legs).ops())); for (const t of ops[0].transactions) delete t.credited_at; return parseOps(ops, o); };
  const r = undated('deposit', [L('deposit', 'INCOMING', IDS.eur, '100')]);
  assert.deepEqual(kinds(r), [Kind.UNRESOLVED]);
  assert.ok(r.events[0].ts instanceof Date && !Number.isNaN(r.events[0].ts.getTime()));
  assert.equal(r.events[0].ts.toISOString(), '2026-10-05T10:00:00.000Z', 'data dello scarico (raw.fetchedAt)');
  assert.match(r.events[0].note, /Bitpanda non indica la data di questa operazione/);
  for (const rebase2025 of [false, true]) {
    const engine = new CT.Engine({ prices: new CT.PriceBook(), rebase2025 }).run(r.events);
    assert.deepEqual(codes(engine, 'block'), ['unrecognized_row'], `rebase2025=${rebase2025}`);
  }
  // anche insieme a operazioni normali del 2025 (il rebase scatta durante il ciclo)
  const mixed = parseOps([...sampleLedger().ops(), ...JSON.parse(JSON.stringify(rich().add('deposit', '2025-01-10T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '1')], { id: 'op-nodate' }).ops())).map((o) => { for (const t of o.transactions) delete t.credited_at; return o; })]);
  assert.ok(mixed.events.every((e) => e.ts instanceof Date && !Number.isNaN(e.ts.getTime())));
  const eng = new CT.Engine({ prices: new CT.PriceBook(), rebase2025: true }).run(mixed.events);
  assert.ok(codes(eng, 'block').includes('unrecognized_row'));
  assert.equal(CT.taxDate(mixed.events.find((e) => e.uid === 'api:bitpanda:op-nodate').ts), '2026-10-05');
  // prenotazione senza data (INFO), acquisto senza data, record non valido, duplicato con contenuto diverso: tutti con ts valido
  const info = undated('buy_reserve', [L('transfer', 'OUTGOING', IDS.eur, '100')]);
  assert.deepEqual(kinds(info), [Kind.INFO]); assert.ok(info.events[0].ts instanceof Date);
  assert.deepEqual(kinds(undated('buy', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '0.001')])), [Kind.UNRESOLVED]);
  const bad = parseOps([null, 'x', { operation_id: 'z' }]);
  assert.ok(bad.events.every((e) => e.kind === Kind.UNRESOLVED && e.ts instanceof Date));
  const dupOps = sampleLedger().ops(); const alt = JSON.parse(JSON.stringify(dupOps[0])); alt.transactions[0].asset_amount.value = '123';
  assert.ok(parseOps([...dupOps, alt]).events.every((e) => e.ts instanceof Date));
});

test('parse: data di ripiego senza raw.fetchedAt = ultima data nota; senza nessuna data = 1/1/1970 (deterministico, mai l\'orologio)', () => {
  const dated = rich().add('buy', '2025-01-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '0.001')]).add('buy', '2025-02-10T10:00:00.000Z', [L('buy', 'OUTGOING', IDS.eur, '10'), L('buy', 'INCOMING', IDS.btc, '0.001')]).ops();
  const noDate = JSON.parse(JSON.stringify(rich().add('deposit', '2025-03-01T10:00:00.000Z', [L('deposit', 'INCOMING', IDS.eur, '5')], { id: 'op-nd' }).ops()));
  for (const t of noDate[0].transactions) delete t.credited_at;
  const withLast = parseOps([...dated, ...noDate], { fetchedAt: undefined });
  assert.equal(withLast.events.find((e) => e.kind === Kind.UNRESOLVED).ts.toISOString(), '2025-02-10T10:00:00.000Z');
  const onlyUndated = parseOps(noDate, { fetchedAt: 'non e una data' });
  assert.equal(onlyUndated.events[0].ts.getTime(), 0);
});

test('sync: gli eventi senza data non allargano l\'intervallo delle date della copertura', async () => {
  const ops = [...sampleLedger().ops(), { operation_id: 'op-nodate', operation_type: 'deposit', transactions: [{ transaction_id: 't-nd', transaction_type: 'deposit', flow: 'INCOMING', currency_id: IDS.eur, asset_amount: { value: '5' }, wallet_id: 'w-extra' }] }];
  const { out } = await doSync(fakeBitpanda({ ops }));
  assert.equal(out.coverage[0].from, '2025-01-05T09:00:00.000Z'); assert.equal(out.coverage[0].to, '2025-09-01T10:00:00.000Z');
  assert.equal(out.coverage[0].complete, false, 'il portafoglio senza data non e\' verificabile');
  assert.ok(out.warnings.some((w) => /1 operazioni non sono state riconosciute/.test(w)));
});

// ---------------------------------------------------------------- campi non interpretati e onesta' delle note
test('sync: campi sconosciuti (status, state...) nelle operazioni o nei movimenti -> avviso con i NOMI, mai i valori', async () => {
  const ops = JSON.parse(JSON.stringify(sampleLedger().ops()));
  for (const o of ops) for (const t of o.transactions) delete t.order_id;
  const clean = await doSync(fakeBitpanda({ ops }));
  assert.ok(!clean.out.warnings.some((w) => /non interpreta/.test(w)), 'nessun campo sconosciuto, nessun avviso');
  ops[0].status = 'cancelled-QWERTY'; ops[1].transactions[0].state = 'SETTLED-ASDFG';
  const { out } = await doSync(fakeBitpanda({ ops }));
  const w = out.warnings.find((x) => /non interpreta/.test(x));
  assert.ok(w, 'avviso presente'); assert.match(w, /\bstate\b/); assert.match(w, /\bstatus\b/);
  assert.ok(!/QWERTY|ASDFG/.test(w), 'mai i valori');
  assert.deepEqual(B._internal.unknownKeys(ops), ['state', 'status']);
  assert.deepEqual(B._internal.unknownKeys([null, { operation_id: 'a', operation_type: 'x', transactions: [null, 'x', { flow: 'INCOMING', fee_amount: null, trade: {}, compensates: null }] }]), []);
});

test('onesta\' delle note: il controllo dei saldi e\' un rilevatore, non una garanzia (note, limiti e commento di testa)', async () => {
  const { out } = await doSync(fakeBitpanda({ ops: sampleLedger().ops() }));
  assert.equal(out.coverage[0].complete, true);
  assert.doesNotMatch(out.coverage[0].note, /non ha buchi/); assert.match(out.coverage[0].note, /non può escludere ogni buco/);
  const lim = B.limits[0];
  assert.doesNotMatch(lim, /non abbia buchi/); assert.match(lim, /non una garanzia/); assert.match(lim, /non può escludere ogni buco/);
  assert.ok(B.limits.some((x) => /compensates/.test(x) && /fee_amount/.test(x)));
});

test('documentazione: nel commento di testa le prove non verificate sono classificate O (osservato), non V (verificato)', () => {
  const src = fromSrc();
  const line = (re) => { const l = src.split('\n').filter((x) => re.test(x)); assert.ok(l.length >= 1, String(re)); return l.join('\n'); };
  assert.doesNotMatch(line(/Prefisso \/v1 dei percorsi/), /\bV \[/); assert.match(line(/Prefisso \/v1 dei percorsi/), /\bO \[F5\]/);
  assert.doesNotMatch(line(/Paginazione a cursore: parametri/), /\bV \[/);
  assert.doesNotMatch(line(/^\s*page_size = 100/), /\bV \[/); assert.match(line(/^\s*page_size = 100/), /\bO \[F5\]/);
  assert.match(src, /TOOL\s+MCP, non per la REST/);
  assert.match(src, /\[F7\][^\n]*ALTRA API/); assert.match(src, /SKILL\.md elenca i tipi di asset/);
  assert.doesNotMatch(src, /risposta documentata/);
  assert.match(src, /\[F8\] https:\/\/github\.com\/pneumann1980\/portfolia/);
  // l'URL base dichiarato nel codice coincide con quello descritto (e con il test del contratto)
  assert.equal(B._internal.BASE_URL, 'https://api.public.bitpanda.com/v1');
});
