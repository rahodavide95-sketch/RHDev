// Collegamento API Crypto.com Exchange.
// La rete e' SIMULATA da un server finto che implementa il comportamento DOCUMENTATO (e quello assunto in modo prudente,
// vedi il commento di testa del modulo): firma, nonce entro 60 secondi, finestre massime (24 ore per i trade, 90 giorni
// per depositi/prelievi), start incluso / end escluso per i trade, limiti di righe per pagina, limiti di frequenza
// (1 richiesta al secondo per private/get-trades, 3 ogni 100 ms per gli altri metodi) con 429 e Retry-After.
// Nulla di cio' prova che l'API vera si comporti cosi': serve un account reale (vedi ASSUNTO nel modulo).
const { test } = require('node:test');
const crypto = require('node:crypto');
const { CT, D, Kind, run, eq, blocking, codes, assert } = require('./helpers');
require('../src/platforms.js');
require('../src/api/common.js');
require('../src/api/cryptocom_exchange.js');
const X = CT.api.cryptocom_exchange;
const I = CT.importers;

// nessun test deve mai toccare la rete vera: il fetch globale e' disattivato
globalThis.fetch = () => { throw new Error('rete reale vietata nei test'); };

const KEY = 'TESTKEY-abcdef123456';
const SECRET = 'TESTSECRET-0123456789abcdef';
const DAY = 86400000;
const T0 = Date.parse('2025-01-01T00:00:00Z');
const NOW = Date.parse('2025-06-15T12:00:00Z');
const OPTS = { startDate: '2025-01-01', feeIncluded: 'si' };      // la semantica della commissione dei prelievi la sceglie l'utente (non e' documentata)

// ---------------------------------------------------------------- orologio virtuale (sleep e now iniettati)
function mkClock(ms) {
  const c = { t: ms, slept: [] };
  c.now = () => new Date(c.t);
  c.sleep = async (w) => { c.slept.push(w); c.t += w; };
  return c;
}

// ---------------------------------------------------------------- firma: algoritmo JavaScript della documentazione ufficiale
// (ricopiato dall'esempio di rest-common-api-reference, con node:crypto al posto di crypto-js)
function docSign(body, secret) {
  const { id, method, params, nonce, api_key } = body;
  function isObject(obj) { return obj !== undefined && obj !== null && obj.constructor == Object; }
  function isArray(obj) { return obj !== undefined && obj !== null && obj.constructor == Array; }
  function arrayToString(obj) { return obj.reduce((a, b) => a + (isObject(b) ? objectToString(b) : (isArray(b) ? arrayToString(b) : b)), ''); }
  function objectToString(obj) {
    return (obj == null ? '' : Object.keys(obj).sort().reduce((a, b) => a + b + (isArray(obj[b]) ? arrayToString(obj[b]) : (isObject(obj[b]) ? objectToString(obj[b]) : obj[b])), ''));
  }
  const sigPayload = method + id + api_key + objectToString(params) + nonce;
  return crypto.createHmac('sha256', secret).update(sigPayload).digest('hex');
}

// ---------------------------------------------------------------- server finto
const res = (status, body, headers) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const clone = (x) => JSON.parse(JSON.stringify(x));

class FakeExchange {
  constructor(clock, o = {}) {
    this.clock = clock;
    this.trades = o.trades || [];
    this.deposits = o.deposits || [];
    this.withdrawals = o.withdrawals || [];
    this.order = o.order || 'desc';               // ordine delle righe dei trade: 'desc' | 'asc' | 'byid'
    this.endInclusive = o.endInclusive !== false; // depositi/prelievi: end_ts incluso o escluso (non documentato)
    this.key = KEY; this.secret = SECRET;
    this.log = []; this.rateLimited = 0; this.calls = new Map(); this.inject = o.inject || [];
    this.fetch = (url, init) => this._fetch(url, init);
  }

  async _fetch(url, init) {
    const root = 'https://api.crypto.com/exchange/v1/';
    if (!String(url).startsWith(root)) return res(404, { code: 40002, message: 'METHOD_NOT_FOUND' });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    const method = String(url).slice(root.length);
    assert.equal(body.method, method);
    assert.equal(typeof body.id, 'string'); assert.equal(typeof body.nonce, 'string');
    assert.ok(body.params && typeof body.params === 'object');
    for (const [k, v] of Object.entries(body.params)) assert.ok(typeof v === 'string' || (k === 'limit' && Number.isInteger(v)), `parametro ${k} deve essere una stringa`);
    this.log.push({ method, params: clone(body.params), t: this.clock.t, nonce: body.nonce });
    const nth = (this.calls.get(method) || 0) + 1; this.calls.set(method, nth);
    for (const f of this.inject) { const r = f(method, body.params, nth, this); if (r) { if (r === 'throw') throw new TypeError('Failed to fetch'); return r; } }
    const err = (status, code, message, headers) => res(status, { id: body.id, method, code, message }, headers);
    if (body.api_key !== this.key || body.sig !== docSign(body, this.secret)) return err(401, 40101, 'UNAUTHORIZED');
    if (Math.abs(this.clock.t - Number(body.nonce)) > 60000) return err(400, 40102, 'INVALID_NONCE');
    // limiti di frequenza documentati
    const hist = this.hist = this.hist || new Map();
    const h = hist.get(method) || []; hist.set(method, h);
    const t = this.clock.t;
    const limited = method === 'private/get-trades' ? h.some((x) => t - x < 1000) : h.filter((x) => t - x < 100).length >= 3;
    if (limited) { this.rateLimited++; return err(429, 42901, 'TOO_MANY_REQUESTS', { 'retry-after': '1' }); }
    h.push(t);
    const p = body.params;
    const ok = (result, numericCode) => res(200, { id: body.id, method, code: numericCode ? 0 : '0', result });
    if (method === 'private/get-trades') {
      const isNs = (s) => String(s).length >= 17;
      const toNs = (s) => (isNs(s) ? BigInt(s) : BigInt(s) * 1000000n);
      if (!/^\d+$/.test(p.start_time || '') || !/^\d+$/.test(p.end_time || '')) return err(400, 40004, 'MISSING_OR_INVALID_ARGUMENT');
      const s = toNs(p.start_time), e = toNs(p.end_time);
      if (p.limit > 100 || p.limit < 1) return err(400, 40001, 'BAD_REQUEST');
      if (e - s > BigInt(DAY) * 1000000n) return err(400, 40005, 'INVALID_DATE');   // massimo (assunto) 24 ore
      let rows = this.trades.filter((r) => BigInt(r.create_time_ns) >= s && BigInt(r.create_time_ns) < e);   // start incluso, end escluso
      const byTime = (a, b) => (BigInt(a.create_time_ns) < BigInt(b.create_time_ns) ? -1 : BigInt(a.create_time_ns) > BigInt(b.create_time_ns) ? 1 : (Number(a.trade_id) - Number(b.trade_id)));
      if (this.order === 'desc') rows.sort((a, b) => byTime(b, a));
      else if (this.order === 'asc') rows.sort(byTime);
      else rows.sort((a, b) => Number(b.trade_id) - Number(a.trade_id));
      rows = rows.slice(0, p.limit);
      return ok({ data: clone(rows) });
    }
    if (method === 'private/get-deposit-history' || method === 'private/get-withdrawal-history') {
      const dep = method === 'private/get-deposit-history';
      const pageSize = Number(p.page_size), page = Number(p.page), s = Number(p.start_ts), e = Number(p.end_ts);
      if (!(pageSize >= 1 && pageSize <= 200) || !(page >= 0) || !Number.isFinite(s) || !Number.isFinite(e)) return err(400, 40001, 'BAD_REQUEST');
      if (e - s > 90 * DAY) return err(400, 40005, 'INVALID_DATE');   // massimo (assunto) 90 giorni
      const src = dep ? this.deposits : this.withdrawals;
      const rows = src.filter((r) => Number(r.create_time) >= s && (this.endInclusive ? Number(r.create_time) <= e : Number(r.create_time) < e)).sort((a, b) => Number(a.create_time) - Number(b.create_time) || Number(a.id) - Number(b.id));
      return ok({ [dep ? 'deposit_list' : 'withdrawal_list']: clone(rows.slice(page * pageSize, (page + 1) * pageSize)) }, true);
    }
    return err(400, 40002, 'METHOD_NOT_FOUND');
  }
}

// ---------------------------------------------------------------- generatori di dati
let seq = 1000;
function mkTrade(ms, o = {}) {
  const id = String(o.id || ++seq);
  const sub = o.sub !== undefined ? o.sub : Number(id) % 1000000;
  const ns = String(BigInt(ms) * 1000000n + BigInt(sub));
  return {
    account_id: 'acc-1', event_date: new Date(ms).toISOString().slice(0, 10), journal_type: o.journal || 'TRADING',
    traded_quantity: o.qty || '0.0100', traded_price: o.price || '100000', fees: o.fees === undefined ? '-0.50' : o.fees, fee_credits: o.credits || '0',
    order_id: String(900000 + Number(id)), trade_id: id, trade_match_id: String(Number(id) + 5), client_oid: 'c', taker_side: 'TAKER',
    side: o.side || 'BUY', instrument_name: o.inst || 'BTC_EUR', fee_instrument_name: o.feeInst === undefined ? 'EUR' : o.feeInst,
    create_time: String(ms), create_time_ns: ns, transact_time_ns: ns, match_count: '1', match_index: '0', ...(o.extra || {}),
  };
}
let wseq = 5000;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const mkDep = (ms, o = {}) => ({ currency: o.cur || 'BTC', fee: has(o, 'fee') ? o.fee : '0', create_time: String(ms), id: String(o.id || ++wseq), update_time: String(ms + 60000), amount: o.amount || '0.5', address: 'bc1qesempio', status: o.status === undefined ? '1' : o.status, txid: 'tx' + wseq });
const mkWdr = (ms, o = {}) => ({ currency: o.cur || 'BTC', client_wid: '', fee: has(o, 'fee') ? o.fee : '0.0001', create_time: String(ms), id: String(o.id || ++wseq), update_time: String(ms + 60000), amount: o.amount || '0.5', address: 'bc1qesempio', status: o.status === undefined ? '5' : o.status, txid: 'tx' + wseq, network_id: 'BTC' });

function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

async function doSync(fake, clock, extra = {}) {
  const msgs = [];
  const out = await X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: OPTS, onProgress: (m) => msgs.push(m), ...extra });
  out.msgs = msgs;
  return out;
}
const secretFree = (x) => { const t = typeof x === 'string' ? x : JSON.stringify(x); return !t.includes(KEY) && !t.includes(SECRET); };
const cov = (out, what) => out.coverage.find((c) => c.what === what);

// ================================================================ contratto e firma
test('contratto del connettore: campi, opzioni, istruzioni e limiti in italiano', () => {
  assert.equal(X.id, 'cryptocom_exchange'); assert.equal(X.platform, 'cryptocom_exchange'); assert.ok(CT.PLATFORMS[X.platform]);
  assert.equal(X.label, 'Crypto.com Exchange');
  assert.deepEqual(X.fields.map((f) => [f.key, f.secret]), [['apiKey', false], ['apiSecret', true]]);
  for (const f of X.fields) assert.ok(f.label);
  assert.ok(X.options.every((o) => o.key && o.label));
  assert.ok(X.help.length >= 4 && X.limits.length >= 4);
  assert.ok(X.help.join(' ').includes('NON attivare mai'));
  assert.equal(typeof X.sync, 'function'); assert.equal(typeof X.parse, 'function');
  assert.strictEqual(CT.api.cryptocom_exchange, X);
});

test('firma: vettori calcolati con l\'esempio Python della documentazione ufficiale (la doc non pubblica hash attesi)', async () => {
  // stringhe da firmare e hash prodotti eseguendo params_to_str() della documentazione ufficiale (Python, hmac-sha256)
  const V = [
    [{ id: '1', method: 'private/get-trades', api_key: 'token', params: { instrument_name: 'BTCUSD-PERP', start_time: '1619089031996081486', end_time: '1619200052124211357', limit: 20 }, nonce: '1613570791060' },
      'private/get-trades1tokenend_time1619200052124211357instrument_nameBTCUSD-PERPlimit20start_time16190890319960814861613570791060', '034fc8ddc5f4e067db49905afd0f27cf7e020acda793a1f47958d9dec3711bec'],
    [{ id: 11, method: 'public/auth', api_key: 'token', params: {}, nonce: 1589594102779 }, 'public/auth11token1589594102779', '9dcebf6eeec155f829227ee447dee73120e0aead42fab74d38ed5d8271793dc8'],
    [{ id: '14', method: 'private/create-order-list', api_key: 'token', nonce: '1587846358253', params: { contingency_type: 'LIST', order_list: [
      { instrument_name: 'ONE_USDT', side: 'BUY', type: 'LIMIT', price: '0.24', quantity: '1.0' },
      { instrument_name: 'ONE_USDT', side: 'BUY', type: 'STOP_LIMIT', price: '0.27', quantity: '1.0', trigger_price: '0.26' }] } },
    'private/create-order-list14tokencontingency_typeLISTorder_listinstrument_nameONE_USDTprice0.24quantity1.0sideBUYtypeLIMITinstrument_nameONE_USDTprice0.27quantity1.0sideBUYtrigger_price0.26typeSTOP_LIMIT1587846358253',
    '071efea6fb9f8a1d6fad96083a708801e2e13013e74065463b5634dd3c9d9ab3'],
    [{ id: '-1', method: 'private/get-deposit-history', api_key: 'token', params: { currency: 'XRP', start_ts: '1587846300000', end_ts: '1587846358253', page_size: '2', page: '0', status: '1' }, nonce: '1587846358253' },
      'private/get-deposit-history-1tokencurrencyXRPend_ts1587846358253page0page_size2start_ts1587846300000status11587846358253', 'a733ddc8d493d52bf5ca88576f6da7b40f80446d5820a9909f18989bf7b08083'],
    [{ id: '5', method: 'private/create-withdrawal', api_key: 'token', nonce: '1607063412000', params: { client_wid: 'my_withdrawal_002', currency: 'BTC', amount: '1', address: '2NBqqD5GRJ8wHy1PYyCXTe9ke5226FhavBf', address_tag: '', network_id: null } },
      'private/create-withdrawal5tokenaddress2NBqqD5GRJ8wHy1PYyCXTe9ke5226FhavBfaddress_tagamount1client_widmy_withdrawal_002currencyBTCnetwork_idnull1607063412000', '1be99dbbd77416c80d9d211d13a0898eedd8765c5eaf520515163a1ff694fafd'],
  ];
  for (const [req, payload, hex] of V) {
    assert.equal(req.method + req.id + req.api_key + X.paramsToString(req.params) + req.nonce, payload);
    const signed = await X.signRequest(req, 'secretKey');
    assert.equal(signed.sig, hex);
    assert.equal(docSign(req, 'secretKey'), hex);            // e coincide con l'esempio JavaScript ufficiale
    assert.equal(req.sig, undefined);                         // la richiesta originale non viene modificata
  }
});

test('firma: stessa stringa dell\'algoritmo ufficiale su parametri qualsiasi (ordine delle chiavi, null, liste, annidamenti)', async () => {
  const shapes = [{}, { b: '2', a: '1' }, { z: null, a: [] }, { list: ['x', 'y'], o: { k2: 'v', k1: ['a', { q: '1', p: '2' }] } }, { limit: 100, start_time: '1', end_time: '2' }];
  for (const params of shapes) {
    const req = { id: '77', method: 'private/get-trades', api_key: KEY, params, nonce: '1700000000000' };
    assert.equal((await X.signRequest(req, SECRET)).sig, docSign(req, SECRET));
  }
});

// ================================================================ sync: formato richiesta, finestre, paginazione
test('sync: richieste POST firmate, numeri come stringhe, nonce fresco; il server finto verifica firma e frequenza', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, { trades: [mkTrade(T0 + 5 * DAY)] });
  const out = await doSync(fake, clock);
  assert.equal(out.raw.version, 1);
  assert.equal(fake.rateLimited, 0, 'le attese tra richieste devono rispettare i limiti documentati');
  assert.equal(fake.log[0].method, 'private/get-deposit-history');           // prima il wallet: un problema di permessi emerge subito
  assert.ok(fake.log.some((l) => l.method === 'private/get-withdrawal-history'));
  assert.ok(fake.log.some((l) => l.method === 'private/get-trades'));
  const trades = fake.log.filter((l) => l.method === 'private/get-trades');
  for (const l of trades) assert.equal(l.params.limit, 100);
  for (let i = 1; i < trades.length; i++) assert.ok(trades[i].t - trades[i - 1].t >= 1000, 'almeno 1 secondo tra due richieste di trade');
  assert.ok(out.msgs.length > 10 && out.msgs.every((m) => /[a-z]/.test(m)));
  assert.ok(out.msgs.some((m) => m.startsWith('Operazioni di trading')));
});

test('sync: finestre entro i massimi, senza buchi e senza doppioni; bordi delle finestre inclusi', async () => {
  const clock = mkClock(NOW);
  const rnd = lcg(42);
  const STEP = 86398000;                        // finestre di 23h59m59s con 1 s di sovrapposizione (vedi modulo)
  const trades = [];
  for (let n = 0; n < 300; n++) trades.push(mkTrade(T0 + Math.floor(rnd() * (NOW - T0 - 1000))));
  // operazioni proprio sui bordi di finestra, in ogni modo possibile
  for (const k of [1, 2, 3, 50, 100, 150]) for (const d of [-1000, -1, 0, 1, 999, 1000, 1001]) trades.push(mkTrade(T0 + k * STEP + d));
  trades.push(mkTrade(T0), mkTrade(NOW - 1));
  const deps = [], wdrs = [];
  for (const ms of [T0, T0 + 89 * DAY - 1, T0 + 89 * DAY, T0 + 89 * DAY + 1, T0 + 88 * DAY + 23 * 3600000 + 1800000, NOW - 5]) { deps.push(mkDep(ms)); wdrs.push(mkWdr(ms)); }
  for (const ms of [T0 + 10 * DAY, T0 + 100 * DAY]) { deps.push(mkDep(ms)); }
  for (const end of [true, false]) {
    const fake = new FakeExchange(mkClock(NOW), { trades, deposits: deps, withdrawals: wdrs, endInclusive: end });
    const c2 = fake.clock;
    const out = await doSync(fake, c2);
    assert.equal(fake.rateLimited, 0);
    const got = out.raw['private/get-trades'];
    assert.equal(got.length, trades.length, 'ogni operazione compare una volta sola');
    assert.deepEqual(new Set(got.map((r) => r.trade_id)).size, trades.length);
    assert.equal(out.raw['private/get-deposit-history'].length, deps.length);
    assert.equal(out.raw['private/get-withdrawal-history'].length, wdrs.length);
    // finestre: ognuna entro il massimo, contigue o sovrapposte, dall'inizio fino a ora
    const win = fake.log.filter((l) => l.method === 'private/get-trades').map((l) => [BigInt(l.params.start_time), BigInt(l.params.end_time)]);
    assert.equal(win[0][0], BigInt(T0) * 1000000n);
    assert.equal(win[win.length - 1][1], BigInt(NOW) * 1000000n);
    for (let i = 0; i < win.length; i++) {
      assert.ok(win[i][1] - win[i][0] <= BigInt(DAY) * 1000000n);
      if (i) assert.ok(win[i][0] <= win[i - 1][1] && win[i][0] > win[i - 1][0], 'nessun buco tra una finestra e la successiva');
    }
    const ww = fake.log.filter((l) => l.method === 'private/get-deposit-history' && l.params.page === '0').map((l) => [Number(l.params.start_ts), Number(l.params.end_ts)]);
    assert.equal(ww[0][0], T0); assert.equal(ww[ww.length - 1][1], NOW);
    for (let i = 0; i < ww.length; i++) { assert.ok(ww[i][1] - ww[i][0] <= 90 * DAY); if (i) assert.ok(ww[i][0] < ww[i - 1][1]); }
    assert.ok(ww.length >= 2);
    // ordinati in modo deterministico
    assert.deepEqual(got.map((r) => r.create_time_ns), [...got.map((r) => r.create_time_ns)].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)));
  }
});

test('sync: copertura con la data predefinita (1/10/2019): MAI "completa" perche\' la profondita\' dello storico non e\' dichiarata; con data piu\' recente lo dice anche', async () => {
  const c1 = mkClock(Date.parse('2019-10-04T00:00:00Z'));
  const f1 = new FakeExchange(c1, { trades: [mkTrade(Date.parse('2019-10-02T10:00:00Z'))] });
  const o1 = await X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: f1.fetch, sleep: c1.sleep, now: c1.now });
  assert.equal(o1.raw.settings.startDate, '2019-10-01');
  for (const w of ['Operazioni di trading spot', 'Depositi di criptovalute', 'Prelievi di criptovalute']) {
    const c = cov(o1, w);
    assert.equal(c.complete, false, w);                                   // non verificabile: l'utente deve confermare
    assert.ok(c.note.includes('non dichiara quanto indietro arriva lo storico'), w);
    assert.ok(!c.note.includes('Hai scelto di partire dal'), w);
  }
  assert.equal(cov(o1, 'Operazioni di trading spot').from, '2019-10-01T00:00:00.000Z');
  assert.equal(cov(o1, 'Operazioni di trading spot').to, '2019-10-04T00:00:00.000Z');
  assert.ok(cov(o1, 'Operazioni di trading spot').note.includes('Prima: 2019-10-02, ultima: 2019-10-02.'));
  assert.ok(o1.warnings.some((w) => w.includes('non dichiara quanto indietro arriva lo storico')));
  const clock = mkClock(NOW); const fake = new FakeExchange(clock);
  const o2 = await doSync(fake, clock);          // data di inizio 2025-01-01
  for (const w of ['Operazioni di trading spot', 'Depositi di criptovalute', 'Prelievi di criptovalute']) {
    assert.equal(cov(o2, w).complete, false, w);
    assert.ok(cov(o2, w).note.includes('Hai scelto di partire dal 2025-01-01'));
    assert.ok(cov(o2, w).note.includes('non dichiara quanto indietro arriva lo storico'));
  }
  assert.ok(o2.warnings.some((w) => w.includes('Hai scelto di partire dal 2025-01-01')));
});

test('sync: storico completamente vuoto: nessuna voce "completa" e nota esplicita (un conto vuoto non si distingue da uno storico non raggiungibile)', async () => {
  const clock = mkClock(NOW); const out = await doSync(new FakeExchange(clock), clock);
  for (const w of ['Operazioni di trading spot', 'Depositi di criptovalute', 'Prelievi di criptovalute']) {
    const c = cov(out, w);
    assert.equal(c.count, 0); assert.equal(c.complete, false, w);
    assert.ok(c.note.includes('Nessun dato nel periodo') && c.note.includes('potrebbe non essere raggiungibile'), w);
  }
  assert.ok(out.coverage.every((c) => c.complete === false), 'nessuna voce della copertura puo\' risultare completa');
});

test('sync: copertura dichiara non scaricati margine, derivati, staking, conversioni e valuta', async () => {
  const clock = mkClock(NOW); const out = await doSync(new FakeExchange(clock), clock);
  const bad = out.coverage.filter((c) => c.complete === false && c.from === null);
  assert.deepEqual(bad.map((c) => c.what), ['Margine e derivati (futures, perpetui)', 'Staking, interessi e premi', 'Conversioni, airdrop, rettifiche e sottoconti', 'Depositi e prelievi in valuta (fiat)']);
  for (const c of bad) assert.ok(c.note && c.count === 0);
  for (const c of out.coverage) assert.ok(typeof c.what === 'string' && typeof c.complete === 'boolean' && 'count' in c && 'from' in c && 'to' in c);
});

for (const order of ['desc', 'asc']) {
  test(`sync: giornata con piu' di 100 operazioni (pagine piene), server che ordina ${order}: arrivano tutte`, async () => {
    const clock = mkClock(NOW);
    const day = T0 + 20 * DAY;
    const trades = [];
    for (let n = 0; n < 250; n++) trades.push(mkTrade(day + n * 1000 + (n % 7), { sub: n * 13 }));
    trades.push(mkTrade(day - 1), mkTrade(day + 86398000 - 5));       // anche attorno ai bordi
    const fake = new FakeExchange(clock, { trades, order });
    const out = await doSync(fake, clock);
    assert.equal(fake.rateLimited, 0);
    assert.equal(out.raw['private/get-trades'].length, trades.length);
    assert.equal(new Set(out.raw['private/get-trades'].map((r) => r.trade_id)).size, trades.length);
    assert.equal(cov(out, 'Operazioni di trading spot').count, trades.length);
    assert.equal(out.warnings.filter((w) => /non posso/.test(w)).length, 0);
  });
}

test('sync: operazioni con lo stesso tempo e piu\' di 100 in una pagina: dichiarate non esaurite, non perse in silenzio', async () => {
  const clock = mkClock(NOW);
  const day = T0 + 30 * DAY;
  const trades = [];
  for (let n = 0; n < 130; n++) trades.push(mkTrade(day, { sub: 7 }));         // stesso identico istante
  const out = await doSync(new FakeExchange(clock, { trades }), clock);
  const c = cov(out, 'Operazioni di trading spot');
  assert.equal(c.complete, false);
  assert.ok(c.note.includes('stesso istante'));
  assert.ok(out.warnings.some((w) => w.includes('stesso istante')));
  assert.ok(out.raw['private/get-trades'].length >= 100);
});

test('sync: ordine delle righe non legato al tempo con pagina piena: dichiarato non garantito', async () => {
  const clock = mkClock(NOW);
  const day = T0 + 12 * DAY;
  const trades = [];
  for (let n = 0; n < 160; n++) trades.push(mkTrade(day + ((n * 37) % 160) * 1000, { id: 20000 + n }));
  const out = await doSync(new FakeExchange(clock, { trades, order: 'byid' }), clock);
  assert.equal(cov(out, 'Operazioni di trading spot').complete, false);
  assert.ok(out.warnings.some((w) => w.includes('ordine non interpretabile')));
});

test('sync: depositi e prelievi con piu\' di 200 righe: pagine successive fino alla pagina non piena', async () => {
  const clock = mkClock(NOW);
  const deps = [], wdrs = [];
  for (let n = 0; n < 450; n++) deps.push(mkDep(T0 + 10 * DAY + n * 60000));
  for (let n = 0; n < 200; n++) wdrs.push(mkWdr(T0 + 11 * DAY + n * 60000));          // esattamente una pagina piena: serve la pagina dopo
  const fake = new FakeExchange(clock, { deposits: deps, withdrawals: wdrs });
  const out = await doSync(fake, clock);
  assert.equal(out.raw['private/get-deposit-history'].length, 450);
  assert.equal(out.raw['private/get-withdrawal-history'].length, 200);
  const pages = fake.log.filter((l) => l.method === 'private/get-withdrawal-history' && Number(l.params.start_ts) <= T0 + 11 * DAY).map((l) => l.params.page);
  assert.deepEqual(pages, ['0', '1']);
  assert.equal(fake.rateLimited, 0);
  for (const l of fake.log.filter((x) => x.method !== 'private/get-trades')) assert.equal(l.params.page_size, '200');
});

test('sync: con "paginazione che non avanza" (il server ignora page) non si cicla e si dichiara l\'incompletezza', async () => {
  const clock = mkClock(NOW);
  const deps = []; for (let n = 0; n < 230; n++) deps.push(mkDep(T0 + 3 * DAY + n * 1000));
  const fake = new FakeExchange(clock, { deposits: deps });
  fake.inject.push((method, params) => {
    if (method !== 'private/get-deposit-history' || params.page === '0') return null;
    return res(200, { id: '1', method, code: 0, result: { deposit_list: deps.slice(0, 200) } });   // page ignorata: sempre le prime 200
  });
  // la firma non e' verificata sulle risposte iniettate: basta il comportamento del client
  const out = await doSync(fake, clock);
  assert.equal(cov(out, 'Depositi di criptovalute').complete, false);
  assert.ok(out.warnings.some((w) => w.includes('la paginazione non avanza')));
});

// ================================================================ errori e limiti di frequenza
test('rete: 429 con Retry-After viene ripetuto e riesce (anche oltre i 60 secondi totali: la firma si rifa ad ogni tentativo)', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, { trades: [mkTrade(T0 + 2 * DAY)] });
  let n = 0;
  fake.inject.push((method) => (method === 'private/get-trades' && n++ < 3 ? res(429, { code: 42901, message: 'TOO_MANY_REQUESTS' }, { 'retry-after': '30' }) : null));
  const out = await doSync(fake, clock);
  assert.equal(out.raw['private/get-trades'].length, 1);
  assert.ok(clock.slept.filter((x) => x === 30000).length === 3);
  assert.equal(fake.log.filter((l) => l.method === 'private/get-trades' && l.t >= NOW + 90000).length > 0, true);
});

test('rete: interruzioni a meta\' scaricamento si ripetono (con attese crescenti); se la piattaforma non e\' mai raggiunta ci si ferma subito', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, { trades: [mkTrade(T0 + 2 * DAY)] });
  let fails = 0;
  fake.inject.push((method, p, nth) => (method === 'private/get-trades' && nth >= 3 && nth <= 4 && fails++ < 2 ? 'throw' : null));
  const out = await doSync(fake, clock);
  assert.equal(out.raw['private/get-trades'].length, 1);
  assert.deepEqual(clock.slept.filter((x) => x === 2000 || x === 4000), [2000, 4000]);
  // troppe interruzioni di fila: errore "network", niente dati parziali
  const c2 = mkClock(NOW); const f2 = new FakeExchange(c2);
  f2.inject.push((method, p, nth) => (nth >= 3 ? 'throw' : null));
  await assert.rejects(() => doSync(f2, c2), (e) => e instanceof CT.ApiError && e.code === 'network' && secretFree(e.detail));
  assert.deepEqual(c2.slept.filter((x) => x >= 2000 && x <= 16000 && x % 2000 === 0), [2000, 4000, 8000, 16000]);
  // mai raggiunta: nessuna ripetizione
  const c3 = mkClock(NOW); const f3 = new FakeExchange(c3, { inject: [() => 'throw'] });
  await assert.rejects(() => doSync(f3, c3), (e) => e.code === 'network');
  assert.equal(f3.log.length, 1); assert.equal(c3.slept.length, 0);
});

test('rete: 429 persistente si ferma con errore "rate", senza dati parziali', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, { inject: [(m) => (m === 'private/get-withdrawal-history' ? res(429, { code: 42901 }) : null)] });
  await assert.rejects(() => doSync(fake, clock), (e) => e instanceof CT.ApiError && e.code === 'rate' && secretFree(e.message) && secretFree(e.detail));
});

test('errori: rete assente, chiavi rifiutate, orologio sfasato, IP non ammesso, errori della piattaforma, 5xx', async () => {
  const clock = mkClock(NOW);
  const make = (inject, o) => new FakeExchange(clock, { inject, ...o });
  const run = (fake) => doSync(fake, clock);
  const bad = (p, check) => assert.rejects(p, (e) => e instanceof CT.ApiError && check(e) && secretFree(e.message) && secretFree(e.detail));
  await bad(run(make([() => 'throw'])), (e) => e.code === 'network');
  const wrong = new FakeExchange(clock); wrong.secret = 'ALTRO-SEGRETO';
  await bad(run(wrong), (e) => e.code === 'auth' && e.detail.method === 'private/get-deposit-history' && /NON abilitare il permesso di prelievo/.test(e.message));
  await bad(run(make([() => res(400, { id: '1', method: 'x', code: 40102, message: 'INVALID_NONCE' })])), (e) => e.code === 'config' && /orologio/.test(e.message));
  await bad(run(make([() => res(401, { id: '1', method: 'x', code: 40103, message: 'IP_ILLEGAL' })])), (e) => e.code === 'auth' && /indirizzi IP/.test(e.message));
  await bad(run(make([() => res(200, { id: '1', method: 'private/get-deposit-history', code: '40101', message: 'UNAUTHORIZED' })])), (e) => e.code === 'auth');
  await bad(run(make([() => res(200, { id: '1', method: 'private/get-deposit-history', code: 50001, message: 'ERR_INTERNAL ' + KEY })])), (e) => e.code === 'http' && /50001/.test(e.message));
  await bad(run(make([() => res(200, { id: '1', method: 'private/get-deposit-history', code: '42901' })])), (e) => e.code === 'rate');
  await bad(run(make([() => res(500, 'Internal')])), (e) => e.code === 'http');
  await bad(run(make([() => res(400, { id: '1', method: 'x', code: 40001, message: 'BAD_REQUEST' })])), (e) => e.code === 'http');
});

test('formato: risposte diverse dalla documentazione fermano la sincronizzazione (code "format")', async () => {
  const clock = mkClock(NOW);
  const body = (b) => () => res(200, b);
  const cases = [
    ['non JSON', () => res(200, '<html>ciao</html>')],
    ['array', body([])],
    ['senza code', body({ id: '1', result: {} })],
    ['senza result', body({ id: '1', method: 'private/get-deposit-history', code: 0 })],
    ['metodo diverso', body({ id: '1', method: 'private/get-trades', code: 0, result: { deposit_list: [] } })],
    ['deposit_list non e\' un elenco', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: { deposit_list: {} } })],
    ['deposit_list mancante', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: {} })],
    ['deposito senza id', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: { deposit_list: [{ currency: 'BTC', amount: '1', status: '1', create_time: String(T0 + 1000), fee: '0' }] } })],
    ['deposito con importo non numerico', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: { deposit_list: [{ id: '1', currency: 'BTC', amount: 'abc', status: '1', create_time: String(T0 + 1000), fee: '0' }] } })],
    ['deposito con importo float impreciso', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: { deposit_list: [{ id: '1', currency: 'BTC', amount: 0.12345678901234567, status: '1', create_time: String(T0 + 1000), fee: '0' }] } })],
    ['pagina piu\' grande del massimo', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: { deposit_list: Array.from({ length: 201 }, (_, n) => mkDep(T0 + n * 1000, { id: 70000 + n })) } })],
    ['deposito oltre la fine richiesta', body({ id: '1', method: 'private/get-deposit-history', code: 0, result: { deposit_list: [mkDep(NOW + 3600000)] } })],
  ];
  for (const [name, f] of cases) {
    await assert.rejects(() => doSync(new FakeExchange(clock, { inject: [f] }), clock), (e) => e instanceof CT.ApiError && e.code === 'format' && secretFree(e.message) && secretFree(e.detail), name);
  }
  // risposte dei trade
  const tcase = (name, f) => assert.rejects(() => doSync(new FakeExchange(mkClock(NOW), { inject: [(m) => (m === 'private/get-trades' ? f() : null)] }), mkClock(NOW)), (e) => e instanceof CT.ApiError && e.code === 'format', name);
  const t1 = mkTrade(T0 + 1000);
  const tr = (data) => () => res(200, { id: '1', method: 'private/get-trades', code: '0', result: { data } });
  await tcase('data non e\' un elenco', tr({}));
  await tcase('pagina oltre il limite di 100', tr(Array.from({ length: 101 }, (_, n) => mkTrade(T0 + 1000 + n))));
  await tcase('side sconosciuto', tr([{ ...t1, side: 'HOLD' }]));
  await tcase('senza trade_id', tr([{ ...t1, trade_id: undefined }]));
  await tcase('quantita\' non numerica', tr([{ ...t1, traded_quantity: 'x' }]));
  await tcase('senza commissioni', tr([{ ...t1, fees: undefined }]));
  await tcase('senza tempo', tr([{ ...t1, create_time_ns: undefined, create_time: undefined }]));
  await tcase('operazione fuori dalla finestra richiesta (filtro ignorato)', tr([mkTrade(NOW - 10 * DAY)]));
  await tcase('riga non oggetto', tr(['x']));
});

test('sync: opzione prelievi non scelta -> raw.settings.feeIncluded null, avviso che conta i prelievi con commissione; scelta si/no dichiarata come scelta', async () => {
  const clock = mkClock(NOW);
  const wdrs = [mkWdr(Date.parse('2025-06-14T09:00:00Z'), { id: 1, fee: '0.0001' }), mkWdr(Date.parse('2025-06-14T10:00:00Z'), { id: 2, fee: '0' })];
  const sync1 = (options) => { const c = mkClock(NOW); return X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: new FakeExchange(c, { withdrawals: wdrs }).fetch, sleep: c.sleep, now: c.now, options }); };
  const none = await sync1({ startDate: '2025-06-13' });
  assert.equal(none.raw.settings.feeIncluded, null);
  assert.ok(none.warnings.some((w) => /^1 prelievi con commissione verranno segnalati come «non riconosciuti»/.test(w)), JSON.stringify(none.warnings));
  assert.ok(!none.warnings.some((w) => /Ho assunto/.test(w)));
  const ev = X.parse(none.raw, 'a.json').events;
  assert.deepEqual(ev.map((e) => e.kind).sort(), [Kind.TRANSFER_OUT, Kind.UNRESOLVED].sort());
  assert.equal(X.options.find((o) => o.key === 'feeIncluded').default, undefined);         // nessun valore predefinito
  for (const [v, flag, re] of [['si', true, /Per tua scelta l'importo è ciò che esce dal conto/], ['No', false, /Per tua scelta la commissione è stata aggiunta/]]) {
    const out = await sync1({ startDate: '2025-06-13', feeIncluded: v });
    assert.equal(out.raw.settings.feeIncluded, flag);
    assert.ok(out.warnings.some((w) => re.test(w)), v);
    assert.ok(!out.warnings.some((w) => /verranno segnalati come «non riconosciuti»: la documentazione/.test(w)), v);
  }
  assert.equal(clock.slept.length, 0);
});

test('credenziali e opzioni non valide: errore "config" prima di qualsiasi richiesta', async () => {
  const clock = mkClock(NOW); const fake = new FakeExchange(clock);
  const go = (creds, options) => X.sync(creds, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options });
  const cfg = (p) => assert.rejects(p, (e) => e instanceof CT.ApiError && e.code === 'config');
  await cfg(go({ apiKey: '', apiSecret: SECRET }, OPTS));
  await cfg(go({ apiKey: KEY }, OPTS));
  await cfg(go(undefined, OPTS));
  await cfg(go({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2025-13-40' }));
  await cfg(go({ apiKey: KEY, apiSecret: SECRET }, { startDate: '01/01/2025' }));
  await cfg(go({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2025-07-01' }));      // nel futuro rispetto a "ora"
  await cfg(go({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2010-01-01' }));
  await cfg(go({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2025-01-01', feeIncluded: 'forse' }));
  const saved = globalThis.fetch; globalThis.fetch = undefined;
  try { await cfg(X.sync({ apiKey: KEY, apiSecret: SECRET }, { sleep: clock.sleep, now: clock.now, options: OPTS })); } finally { globalThis.fetch = saved; }
  assert.equal(fake.log.length, 0);
});

test('interruzione facoltativa (AbortSignal): errore "incomplete", nessun dato parziale', async () => {
  const clock = mkClock(NOW); const fake = new FakeExchange(clock);
  const ctl = new AbortController();
  let n = 0;
  await assert.rejects(() => doSync(fake, clock, { signal: ctl.signal, onProgress: () => { if (++n === 5) ctl.abort(); } }), (e) => e instanceof CT.ApiError && e.code === 'incomplete');
});

test('raw: JSON serializzabile, importi esattamente come restituiti, nessuna credenziale in raw, avvisi o copertura', async () => {
  const clock = mkClock(NOW);
  const t = mkTrade(T0 + 2 * DAY, { qty: '0.00012345678901234567', price: '98765.4321', fees: '-0.0000000525', feeInst: 'BTC' });
  const out = await doSync(new FakeExchange(clock, { trades: [t], deposits: [mkDep(T0 + DAY, { amount: '1.000000000000000001' })], withdrawals: [mkWdr(T0 + 3 * DAY)] }), clock);
  const again = JSON.parse(JSON.stringify(out.raw));
  assert.deepEqual(again, out.raw);
  assert.equal(out.raw.fetchedAt, new Date(NOW).toISOString());
  assert.equal(out.raw['private/get-trades'][0].traded_quantity, '0.00012345678901234567');
  assert.equal(out.raw['private/get-deposit-history'][0].amount, '1.000000000000000001');
  assert.ok(secretFree(out.raw) && secretFree(out.coverage) && secretFree(out.warnings) && secretFree(out.msgs));
  assert.ok(!JSON.stringify(out.raw).includes('"sig"') && !JSON.stringify(out.raw).includes('api_key'));
  assert.deepEqual(out.raw.settings, { startDate: '2025-01-01', feeIncluded: true });
  // la richiesta (con la firma) non finisce da nessuna parte
  assert.ok(!JSON.stringify(out).includes('"nonce"'));
});

// ================================================================ regressioni: percorso reale del browser, errori transitori, firma, codici
// Il fetch del browser lancia "Illegal invocation" se viene chiamato come metodo di un altro oggetto (this diverso da window).
const strictThis = (f) => function (url, init) {
  if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  return f(url, init);
};
const SMALL = { startDate: '2025-06-13', feeIncluded: 'si' };       // pochi giorni: test veloci

test('fetch predefinito del browser: sync senza opts.fetch chiama globalThis.fetch come funzione globale (no "Illegal invocation")', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, { trades: [mkTrade(Date.parse('2025-06-14T08:00:00Z'))], deposits: [mkDep(Date.parse('2025-06-14T09:00:00Z'))] });
  const saved = globalThis.fetch;
  globalThis.fetch = strictThis((u, i) => fake.fetch(u, i));
  try {
    // percorso dell'interfaccia: c.sync(creds, { onProgress, options }) senza fetch
    const out = await X.sync({ apiKey: KEY, apiSecret: SECRET }, { sleep: clock.sleep, now: clock.now, options: SMALL, onProgress: () => {} });
    assert.equal(out.raw['private/get-trades'].length, 1);
    assert.equal(out.raw['private/get-deposit-history'].length, 1);
    assert.ok(fake.log.length > 3);
  } finally { globalThis.fetch = saved; }
});

test('fetch passato in opts: viene chiamato come funzione "nuda", mai come metodo dell\'oggetto interno', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, { trades: [mkTrade(Date.parse('2025-06-14T08:00:00Z'))] });
  const out = await X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: strictThis((u, i) => fake.fetch(u, i)), sleep: clock.sleep, now: clock.now, options: SMALL });
  assert.equal(out.raw['private/get-trades'].length, 1);
  // se invece il fetch globale rifiuta la chiamata il messaggio resta quello della rete (e non si ripete: la piattaforma non e' mai stata raggiunta)
  const saved = globalThis.fetch;
  globalThis.fetch = () => { throw new TypeError('Failed to fetch'); };
  try { await assert.rejects(() => X.sync({ apiKey: KEY, apiSecret: SECRET }, { sleep: clock.sleep, now: clock.now, options: SMALL }), (e) => e instanceof CT.ApiError && e.code === 'network'); } finally { globalThis.fetch = saved; }
});

test('forme numeriche viste in ccxt (code numerico, create_time/amount/fee/trade_id come numeri JSON): sync() le accetta e parse() le converte esatte', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock);
  const dayMs = Date.parse('2025-06-14T08:00:00Z');
  fake.inject.push((method, params, nth) => {
    if (nth !== 1) return null;
    if (method === 'private/get-deposit-history') return res(200, { id: 1, method, code: 0, result: { deposit_list: [{ currency: 'BTC', fee: 0, create_time: dayMs, id: '6201135', update_time: dayMs + 1000, amount: 0.00114571, address: 'bc1qesempio', status: '1', txid: 'abc/2' }] } });
    if (method === 'private/get-withdrawal-history') return res(200, { id: 1, method, code: 0, result: { withdrawal_list: [{ currency: 'BTC', client_wid: '', fee: 0.0005, create_time: dayMs + 5000, id: '5775977', update_time: dayMs + 6000, amount: 0.0005, address: 'bc1qesempio', status: '1', txid: '', network_id: 'BTC' }] } });
    if (method === 'private/get-trades') {
      const s = Number(BigInt(params.start_time) / 1000000n);
      return res(200, { id: 1, method, code: 0, result: { data: [{ trade_id: 38554669, instrument_name: 'BTC_EUR', side: 'BUY', traded_quantity: 0.5, traded_price: 30000, fees: -0.25, fee_instrument_name: 'EUR', create_time: s + 5000 }] } });
    }
    return null;
  });
  const out = await X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: SMALL });
  assert.equal(out.raw['private/get-deposit-history'].length, 1);
  assert.equal(out.raw['private/get-withdrawal-history'].length, 1);
  assert.equal(out.raw['private/get-trades'].length, 1);
  const ev = X.parse(out.raw, 'api.json').events;
  const dep = ev.find((e) => e.kind === Kind.TRANSFER_IN), buy = ev.find((e) => e.kind === Kind.BUY);
  eq(dep.qty, '0.00114571'); eq(buy.qty, '0.5'); eq(buy.value, 15000); eq(buy.feeQty, '0.25');
  assert.equal(buy.uid, 'api:cryptocom_exchange:trade:38554669');
  // il prelievo con stato 1 (in elaborazione) e' "non concluso": mai ipotesi
  assert.ok(ev.some((e) => e.kind === Kind.UNRESOLVED && /non ancora concluso/.test(e.note)));
});

test('errori transitori documentati (408/40801, 400/50001, 200+42901): si ripetono con attese crescenti e poi riescono, senza perdere nulla', async () => {
  const mk = (injectFor) => {
    const clock = mkClock(NOW);
    const fake = new FakeExchange(clock, { trades: [mkTrade(Date.parse('2025-06-14T08:00:00Z'))] });
    let n = 0;
    fake.inject.push((method) => (method === 'private/get-trades' && n++ < 3 ? injectFor() : null));
    return { clock, fake };
  };
  const cases = {
    'HTTP 408 con 40801': () => res(408, { id: '1', method: 'private/get-trades', code: 40801, message: 'REQUEST_TIMEOUT' }),
    'HTTP 408 senza corpo': () => res(408, ''),
    'HTTP 400 con 50001': () => res(400, { id: '1', method: 'private/get-trades', code: 50001, message: 'ERR_INTERNAL' }),
    'HTTP 200 con code 50001': () => res(200, { id: '1', method: 'private/get-trades', code: 50001, message: 'ERR_INTERNAL' }),
    'HTTP 200 con code 40801': () => res(200, { id: '1', method: 'private/get-trades', code: '40801', message: 'REQUEST_TIMEOUT' }),
    'HTTP 200 con code 42901': () => res(200, { id: '1', method: 'private/get-trades', code: '42901', message: 'TOO_MANY_REQUESTS' }),
  };
  for (const [name, f] of Object.entries(cases)) {
    const { clock, fake } = mk(f);
    const out = await X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: SMALL });
    assert.equal(out.raw['private/get-trades'].length, 1, name);
    assert.deepEqual(clock.slept.filter((x) => x === 2000 || x === 4000 || x === 8000), [2000, 4000, 8000], name);
    // la firma si rifa ad ogni tentativo: ogni nonce e' fresco rispetto all'orologio al momento della richiesta
    for (const l of fake.log) assert.ok(Math.abs(Number(l.nonce) - l.t) <= 60000, name);
    assert.equal(new Set(fake.log.map((l) => l.nonce)).size > 1, true);
  }
});

test('errori transitori persistenti: dopo 4 ripetizioni (2, 4, 8, 16 s) errore, nessun dato parziale; gli errori NON transitori non si ripetono', async () => {
  const persistent = {
    'HTTP 408': [() => res(408, { code: 40801, message: 'REQUEST_TIMEOUT' }), 'http', /40801|408/],
    'HTTP 400 con 50001': [() => res(400, { code: 50001, message: 'ERR_INTERNAL' }), 'http', /50001/],
    'HTTP 200 con 42901': [() => res(200, { id: '1', method: 'private/get-trades', code: 42901 }), 'rate', /Troppe richieste/],
  };
  for (const [name, [f, code, re]] of Object.entries(persistent)) {
    const clock = mkClock(NOW);
    const fake = new FakeExchange(clock, { inject: [(m) => (m === 'private/get-trades' ? f() : null)] });
    await assert.rejects(() => X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: SMALL }),
      (e) => e instanceof CT.ApiError && e.code === code && re.test(e.message) && secretFree(e.message) && secretFree(e.detail), name);
    assert.deepEqual(clock.slept.filter((x) => x >= 2000 && x % 2000 === 0 && x <= 16000), [2000, 4000, 8000, 16000], name);
    assert.equal(fake.log.filter((l) => l.method === 'private/get-trades').length, 5, name);        // 1 + 4 ripetizioni
  }
  // 40001/40004/40005/40101 non sono transitori: una sola richiesta
  for (const [status, code] of [[400, 40001], [400, 40004], [400, 40005], [401, 40101]]) {
    const clock = mkClock(NOW);
    const fake = new FakeExchange(clock, { inject: [(m) => (m === 'private/get-trades' ? res(status, { code, message: 'X' }) : null)] });
    await assert.rejects(() => X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: SMALL }), (e) => e instanceof CT.ApiError, String(code));
    assert.equal(fake.log.filter((l) => l.method === 'private/get-trades').length, 1, String(code));
  }
});

test('errori HTTP 4xx: il codice della piattaforma compare nel messaggio (40005 date, 40004 parametro, 40001 richiesta) e in detail', async () => {
  const run1 = (status, body) => {
    const clock = mkClock(NOW);
    const fake = new FakeExchange(clock, { inject: [(m) => (m === 'private/get-deposit-history' ? res(status, body) : null)] });
    return X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: SMALL });
  };
  const bad = (p, check) => assert.rejects(p, (e) => e instanceof CT.ApiError && e.code === 'http' && check(e) && secretFree(e.message) && secretFree(e.detail));
  await bad(run1(400, { id: '1', method: 'x', code: 40005, message: 'INVALID_DATE' }), (e) => /40005/.test(e.message) && /data di inizio|intervallo di date/.test(e.message) && e.detail.platformCode === 40005 && e.detail.status === 400 && e.detail.method === 'private/get-deposit-history');
  await bad(run1(400, { id: '1', method: 'x', code: '40004', message: 'MISSING_OR_INVALID_ARGUMENT' }), (e) => /40004/.test(e.message) && e.detail.platformCode === 40004);
  await bad(run1(400, { id: '1', method: 'x', code: 40001, message: 'BAD_REQUEST' }), (e) => /40001/.test(e.message));
  // altri codici 4xx: codice e testo della piattaforma (ripulito dalle chiavi) nel messaggio
  await bad(run1(400, { id: '1', method: 'x', code: 40003, message: 'INVALID_REQUEST ' + KEY }), (e) => /40003/.test(e.message) && /INVALID_REQUEST/.test(e.message));
  // senza codice nel corpo: messaggio generico con lo stato HTTP
  await bad(run1(400, 'Bad Request'), (e) => /\(400\)/.test(e.message));
});

test('firma impossibile (crypto.subtle assente): errore "config" con il messaggio giusto, non "network"; nessuna richiesta inviata', async () => {
  const clock = mkClock(NOW); const fake = new FakeExchange(clock);
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
  try {
    await assert.rejects(() => X.sync({ apiKey: KEY, apiSecret: SECRET }, { fetch: fake.fetch, sleep: clock.sleep, now: clock.now, options: SMALL }),
      (e) => e instanceof CT.ApiError && e.code === 'config' && /calcolare la firma/.test(e.message) && !/bloccato la richiesta/.test(e.message) && secretFree(e.message) && secretFree(e.detail));
  } finally { if (desc) Object.defineProperty(globalThis, 'crypto', desc); else delete globalThis.crypto; }
  assert.equal(fake.log.length, 0);
  assert.equal(typeof globalThis.crypto.subtle.importKey, 'function');         // ripristinato
});

// ================================================================ parse: ogni tipo di record
const mkRaw = (o = {}) => ({ version: 1, fetchedAt: '2025-06-15T12:00:00.000Z', settings: { startDate: '2025-01-01', feeIncluded: o.feeIncluded === undefined ? true : o.feeIncluded },
  'private/get-trades': o.trades || [], 'private/get-deposit-history': o.deposits || [], 'private/get-withdrawal-history': o.withdrawals || [] });
const one = (raw) => { const r = X.parse(raw, 'api.json'); assert.equal(r.events.length, 1); return r.events[0]; };

test('parse: acquisto con quota fiat -> BUY con commissione separata, esatto in decimale, data UTC dai nanosecondi', () => {
  const e = one(mkRaw({ trades: [mkTrade(Date.parse('2025-01-10T10:00:00.123Z'), { id: 38554669, qty: '0.1', price: '0.2', fees: '-1.025570', feeInst: 'EUR', inst: 'BTC_EUR', sub: 456789 })] }));
  assert.equal(e.kind, Kind.BUY); assert.equal(e.asset, 'BTC'); eq(e.qty, '0.1'); eq(e.value, '0.02'); assert.equal(e.valueCcy, 'EUR');
  assert.equal(e.feeAsset, 'EUR'); eq(e.feeQty, '1.02557');
  assert.equal(e.uid, 'api:cryptocom_exchange:trade:38554669'); assert.equal(e.account, CT.PLATFORMS.cryptocom_exchange.account);
  assert.ok(e.ts instanceof Date); assert.equal(e.ts.toISOString(), '2025-01-10T10:00:00.123Z');
  assert.equal(e.value.toFixed(), '0.02');                  // nessun errore da virgola mobile (0,1 x 0,2 in float = 0,020000000000000004)
});

test('parse: vendita con quota fiat (USD) -> SELL; il valore resta nella valuta della coppia', () => {
  const e = one(mkRaw({ trades: [mkTrade(T0 + DAY, { side: 'SELL', inst: 'ETH_USD', qty: '2', price: '3000.5', fees: '-6.001', feeInst: 'USD' })] }));
  assert.equal(e.kind, Kind.SELL); assert.equal(e.asset, 'ETH'); eq(e.qty, 2); eq(e.value, '6001'); assert.equal(e.valueCcy, 'USD'); assert.equal(e.feeAsset, 'USD');
});

test('parse: quota non fiat (USDT, BTC) -> SWAP nei due versi, valore non indicato; commissione in altro asset', () => {
  const [buy, sell] = X.parse(mkRaw({ trades: [
    mkTrade(T0 + DAY, { id: 1, side: 'BUY', inst: 'CRO_USDT', qty: '100', price: '0.12', fees: '-0.1', feeInst: 'CRO' }),
    mkTrade(T0 + 2 * DAY, { id: 2, side: 'SELL', inst: 'ETH_BTC', qty: '2', price: '0.05', fees: '-0.0001', feeInst: 'BTC' })] }), 'a.json').events;
  assert.equal(buy.kind, Kind.SWAP); assert.equal(buy.asset, 'USDT'); eq(buy.qty, 12); assert.equal(buy.counterAsset, 'CRO'); eq(buy.counterQty, 100); assert.equal(buy.value, null);
  assert.equal(buy.feeAsset, 'CRO'); eq(buy.feeQty, '0.1');
  assert.equal(sell.kind, Kind.SWAP); assert.equal(sell.asset, 'ETH'); eq(sell.qty, 2); assert.equal(sell.counterAsset, 'BTC'); eq(sell.counterQty, '0.1'); assert.equal(sell.feeAsset, 'BTC');
});

test('parse: commissione zero senza asset, crediti commissione in nota, numeri JSON esatti accettati', () => {
  const e = one(mkRaw({ trades: [mkTrade(T0, { fees: '0', credits: '-0.25', feeInst: '' })] }));
  assert.equal(e.feeAsset, ''); eq(e.feeQty, 0); assert.ok(e.note.includes('Crediti commissione usati: 0.25'));
  const n = one(mkRaw({ trades: [{ ...mkTrade(T0 + 1000), traded_quantity: 0.5, traded_price: 30000, fees: -0.25, create_time: T0 + 1000 }] }));
  eq(n.qty, '0.5'); eq(n.value, 15000); eq(n.feeQty, '0.25');
});

test('parse: record sconosciuti o non interpretabili -> UNRESOLVED (mai ipotesi)', () => {
  const U = (t) => { const e = one(mkRaw({ trades: [t] })); assert.equal(e.kind, Kind.UNRESOLVED, t.instrument_name + t.fees); assert.ok(e.unkKey.startsWith('Crypto.com Exchange (API) · ')); assert.ok(e.note); return e; };
  U(mkTrade(T0, { inst: 'BTCUSD-PERP' }));
  U(mkTrade(T0, { inst: 'BTCUSD-240329' }));
  U(mkTrade(T0, { extra: { isolation_id: '19848526', isolation_type: 'ISOLATED_MARGIN' } }));
  U(mkTrade(T0, { journal: 'SESSION_SETTLE' }));
  U(mkTrade(T0, { fees: '0.2' }));                       // commissione positiva = accredito
  U(mkTrade(T0, { fees: '-0.2', feeInst: '' }));         // commissione senza valuta
  U(mkTrade(T0, { qty: '0' }));
  U(mkTrade(T0, { price: '-1' }));
  U(mkTrade(T0, { inst: 'EUR_USD' }));                   // base fiat
  U(mkTrade(T0, { side: 'HOLD' }));
  U(mkTrade(T0, { id: undefined, extra: { trade_id: undefined } }));
  const r = X.parse(mkRaw({ trades: [mkTrade(T0, { inst: 'BTCUSD-PERP' }), mkTrade(T0 + 1000, { id: 3, inst: 'ETHUSD-PERP' })] }), 'a.json');
  assert.deepEqual(r.unknown, [{ key: 'Crypto.com Exchange (API) · strumento non spot', count: 2 }]);
  // una riga non oggetto non fa crollare la conversione
  assert.equal(one(mkRaw({ trades: ['x'] })).kind, Kind.UNRESOLVED);
});

test('parse: depositi cripto -> TRANSFER_IN netto; stati non arrivati -> INFO; commissione != 0 o stato ignoto -> UNRESOLVED; fiat -> FIAT_IN', () => {
  const dep = (o) => one(mkRaw({ deposits: [mkDep(Date.parse('2025-03-07T10:00:10Z'), o)] }));
  const ok = dep({ id: 2220, amount: '0.003', cur: 'btc' });
  assert.equal(ok.kind, Kind.TRANSFER_IN); assert.equal(ok.asset, 'BTC'); eq(ok.qty, '0.003'); assert.equal(ok.uid, 'api:cryptocom_exchange:deposito:2220');
  assert.equal(ok.ts.toISOString(), '2025-03-07T10:00:10.000Z'); assert.equal(ok.account, 'Crypto.com Exchange'); assert.ok(ok.ref.startsWith('tx'));
  for (const s of ['0', '2', '3']) assert.equal(dep({ status: s }).kind, Kind.INFO, 'stato ' + s);
  assert.equal(dep({ status: '9' }).kind, Kind.UNRESOLVED);
  const withFee = dep({ fee: '1.0' }); assert.equal(withFee.kind, Kind.UNRESOLVED); assert.ok(/lordo o netto/.test(withFee.note));
  assert.equal(dep({ amount: '0' }).kind, Kind.UNRESOLVED);
  assert.equal(dep({ cur: 'EUR' }).kind, Kind.FIAT_IN);
  const noFee = { ...mkDep(T0 + DAY), fee: undefined }; assert.equal(one(mkRaw({ deposits: [noFee] })).kind, Kind.UNRESOLVED);
});

test('parse: prelievi cripto -> TRANSFER_OUT (commissione compresa o aggiunta); stati non conclusi -> INFO o UNRESOLVED', () => {
  const wd = (o, feeIncluded) => one(mkRaw({ feeIncluded, withdrawals: [mkWdr(Date.parse('2025-04-01T09:00:00Z'), o)] }));
  const incl = wd({ id: 9, amount: '0.001', fee: '0.0001' }, true);
  assert.equal(incl.kind, Kind.TRANSFER_OUT); eq(incl.qty, '0.001'); assert.equal(incl.uid, 'api:cryptocom_exchange:prelievo:9'); assert.ok(incl.note.includes('già compresa'));
  const add = wd({ id: 9, amount: '0.001', fee: '0.0001' }, false);
  eq(add.qty, '0.0011'); assert.ok(add.note.includes('aggiunta'));
  assert.equal(wd({ fee: undefined }, false).kind, Kind.UNRESOLVED);
  assert.equal(wd({ fee: undefined }, true).kind, Kind.TRANSFER_OUT);
  for (const s of ['2', '4', '6']) assert.equal(wd({ status: s }, true).kind, Kind.INFO, 'stato ' + s);
  for (const s of ['0', '1', '3']) { const e = wd({ status: s }, true); assert.equal(e.kind, Kind.UNRESOLVED, 'stato ' + s); assert.ok(/non ancora concluso/.test(e.note)); }
  assert.equal(wd({ status: '7' }, true).kind, Kind.UNRESOLVED);
  assert.equal(wd({ cur: 'USD' }, true).kind, Kind.FIAT_OUT);
});

test('parse: semantica della commissione dei prelievi NON scelta (null o assente) -> UNRESOLVED per ogni prelievo con commissione, nessuna ipotesi; senza commissione nessuna ambiguita\'', () => {
  const wd = (o, feeIncluded) => one(mkRaw({ feeIncluded, withdrawals: [mkWdr(Date.parse('2025-04-01T09:00:00Z'), o)] }));
  for (const choice of [null, 'forse']) {
    const e = wd({ id: 9, amount: '0.001', fee: '0.0001' }, choice);
    assert.equal(e.kind, Kind.UNRESOLVED); assert.ok(e.unkKey.endsWith('prelievo con commissione (semantica non documentata)'));
    assert.ok(/non dice se l'importo comprende già la commissione/.test(e.note) && /si» o «no/.test(e.note));
  }
  assert.equal(wd({ fee: undefined }, null).kind, Kind.UNRESOLVED);          // commissione non indicata: non si sa quanto e' uscito
  for (const f of ['0', '0.0', '0.00000000']) {
    const e = wd({ fee: f, amount: '0.5' }, null);
    assert.equal(e.kind, Kind.TRANSFER_OUT, f); eq(e.qty, '0.5'); assert.ok(e.note.includes('nessuna commissione'));
  }
  // raw senza la sezione settings (o senza feeIncluded): stesso comportamento prudente
  const raw = mkRaw({ withdrawals: [mkWdr(T0 + DAY, { id: 4, fee: '0.0001' })] }); delete raw.settings;
  assert.equal(one(raw).kind, Kind.UNRESOLVED);
  // le scelte dell'utente restano applicate come prima
  eq(wd({ amount: '0.001', fee: '0.0001' }, true).qty, '0.001'); eq(wd({ amount: '0.001', fee: '0.0001' }, false).qty, '0.0011');
  // i depositi non dipendono dalla scelta sui prelievi
  assert.equal(one(mkRaw({ feeIncluded: null, deposits: [mkDep(T0 + DAY)] })).kind, Kind.TRANSFER_IN);
});

test('parse: duplicati contati una volta, uid distinti tra depositi, prelievi e operazioni con lo stesso id, risultato deterministico', () => {
  const t = mkTrade(T0 + DAY, { id: 77 });
  const d = mkDep(T0 + DAY, { id: 77 }), w = mkWdr(T0 + DAY, { id: 77 });
  const raw = mkRaw({ trades: [t, { ...t }], deposits: [d, { ...d }], withdrawals: [w, { ...w }] });
  const r = X.parse(raw, 'api.json');
  assert.equal(r.events.length, 3); assert.equal(r.rows, 3);
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 3);
  assert.deepEqual(r.events.map((e) => e.uid), ['api:cryptocom_exchange:trade:77', 'api:cryptocom_exchange:deposito:77', 'api:cryptocom_exchange:prelievo:77']);
  assert.deepEqual(X.parse(raw, 'api.json').events.map((e) => e.uid), r.events.map((e) => e.uid));
  assert.deepEqual(X.parse(JSON.stringify(raw), 'api.json').events.map((e) => [e.uid, e.kind, e.qty.toString()]), r.events.map((e) => [e.uid, e.kind, e.qty.toString()]));
  assert.equal(r.label, 'Crypto.com Exchange (API)'); assert.ok(r.from instanceof Date && r.to instanceof Date); assert.deepEqual(r.unknown, []);
});

test('parse: versione o struttura non valida -> errore "format"', () => {
  const bad = (x) => assert.throws(() => X.parse(x, 'a.json'), (e) => e instanceof CT.ApiError && e.code === 'format');
  bad({ ...mkRaw(), version: 2 }); bad(null); bad('non json'); bad({ version: 1, 'private/get-trades': {} });
});

// ================================================================ prova completa: raw -> parse -> motore
const T = (iso) => new Date(iso);
function app(csvRows) {
  const head = 'Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind\n';
  return I.TYPES.cryptocom_app.parse(head + csvRows, 'app.csv').events;
}

test('prova completa: acquisto e vendita con commissioni -> plusvalenza calcolata a mano', () => {
  // acquisto 0,01 BTC a 100.000 = 1.000 EUR + 1 EUR di commissione  -> costo 1.001 (100.100 EUR per BTC)
  // vendita 0,004 BTC a 120.000 = 480 EUR - 0,48 EUR di commissione -> corrispettivo 479,52; costo 0,004 x 100.100 = 400,40
  // plusvalenza = 479,52 - 400,40 = 79,12
  const raw = mkRaw({ trades: [
    mkTrade(Date.parse('2025-01-10T10:00:00Z'), { id: 1, side: 'BUY', inst: 'BTC_EUR', qty: '0.01', price: '100000', fees: '-1', feeInst: 'EUR' }),
    mkTrade(Date.parse('2025-02-10T10:00:00Z'), { id: 2, side: 'SELL', inst: 'BTC_EUR', qty: '0.004', price: '120000', fees: '-0.48', feeInst: 'EUR' })] });
  const events = X.parse(raw, 'api.json').events;
  const { engine, y } = run(events);
  assert.equal(blocking(engine).length, 0, JSON.stringify(engine.issues));
  assert.equal(engine.disposals.length, 1);
  const d = engine.disposals[0];
  eq(d.proceeds, '479.52'); eq(d.cost, '400.4'); eq(d.gain, '79.12'); assert.equal(d.day, '2025-02-10');
  eq(y.crypto.gains, '79.12'); eq(y.crypto.tax, 21);              // 79,12 -> 79 EUR imponibili x 26% = 20,54 -> 21 EUR
});

test('prova completa: permuta tramite USDT con prezzo inserito, poi vendita degli USDT', () => {
  // acquisto 0,01 BTC a 1.000 EUR (commissione 0); permuta 0,002 BTC -> 120 USDT con BTC a 55.000 EUR = 110 EUR: costo 200 -> -90
  // vendita di 120 USDT a 0,93 = 111,60 EUR; costo dei 120 USDT = 110 (valore alla permuta) -> +1,60
  const raw = mkRaw({ trades: [
    mkTrade(Date.parse('2025-01-10T10:00:00Z'), { id: 1, side: 'BUY', inst: 'BTC_EUR', qty: '0.01', price: '100000', fees: '0', feeInst: '' }),
    mkTrade(Date.parse('2025-03-10T10:00:00Z'), { id: 2, side: 'SELL', inst: 'BTC_USDT', qty: '0.002', price: '60000', fees: '0', feeInst: '' }),
    mkTrade(Date.parse('2025-03-20T10:00:00Z'), { id: 3, side: 'SELL', inst: 'USDT_EUR', qty: '120', price: '0.93', fees: '0', feeInst: '' })] });
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-03-10', 55000);
  const { engine } = run(X.parse(raw, 'api.json').events, { prices });
  assert.equal(blocking(engine).length, 0, JSON.stringify(engine.issues));
  assert.deepEqual(engine.disposals.map((d) => [d.asset, d.gain.toString()]), [['BTC', '-90'], ['USDT', '1.6']]);
});

test('prova completa: trasferimenti App -> Exchange e Exchange -> altro conto abbinati; commissione di rete = differenza', () => {
  // BTC comprato sull'Exchange: 0,01 a 100.000 (nessuna commissione) -> 100.000 EUR per BTC.
  // App -> Exchange 0,003 BTC (arrivo identico): nessuna commissione. Exchange -> Ledger: esce 0,001, arrivano 0,0009:
  // commissione di rete 0,0001 BTC = 9 EUR (BTC a 90.000) contro un costo di 10 EUR -> -1 EUR.
  const exch = X.parse(mkRaw({
    trades: [mkTrade(Date.parse('2025-01-10T10:00:00Z'), { id: 1, side: 'BUY', inst: 'BTC_EUR', qty: '0.01', price: '100000', fees: '0', feeInst: '' })],
    deposits: [mkDep(Date.parse('2025-03-07T10:00:10Z'), { id: 11, amount: '0.003' })],
    withdrawals: [mkWdr(Date.parse('2025-04-01T09:00:00Z'), { id: 12, amount: '0.001', fee: '0.0001' })] }), 'api.json').events;
  const appEv = app('2025-03-07 10:00:00,To exchange,BTC,-0.003,,,EUR,300,330,crypto_to_exchange_transfer\n');
  const ledger = I.TYPES.generic.parse('data;tipo;conto;asset;quantita;valore_eur\n2025-04-01 09:30;trasferimento_entrata;Ledger;BTC;0.0009;\n', 'm.csv').events;
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-04-01', 90000);
  const { engine } = run([...exch, ...appEv, ...ledger], { prices });
  assert.equal(blocking(engine).length, 0, JSON.stringify(engine.issues));
  assert.deepEqual(codes(engine, 'block'), []);
  assert.equal(engine.disposals.length, 1);
  const d = engine.disposals[0];
  assert.equal(d.kind, 'transfer_fee'); eq(d.qty, '0.0001'); eq(d.proceeds, 9); eq(d.cost, 10); eq(d.gain, -1);
  // senza il conto di arrivo il prelievo resta "non abbinato" e blocca (nessuna ipotesi)
  const lonely = run([...exch, ...appEv]).engine;
  assert.ok(codes(lonely, 'block').includes('transfer_out_unmatched'));
});

test('prova completa: prelievo con commissione e arrivo sul conto di destinazione: la scelta si/no cambia la commissione di rete (e senza scelta il prelievo blocca)', () => {
  // 0,05 BTC comprati a 100.000 EUR (nessuna commissione). Prelievo di 0,02 BTC con commissione documentata 0,0001; sul Ledger arrivano 0,0199.
  // Scelta "si" (l'importo comprende la commissione): esce 0,02, arriva 0,0199 -> commissione di rete 0,0001 BTC = pari alla commissione indicata
  //   dalla piattaforma: ricavo 0,0001 x 90.000 = 9, costo 0,0001 x 100.000 = 10 -> -1.
  // Scelta "no" (esce importo + commissione = 0,0201): arriva 0,0199 -> commissione di rete 0,0002 BTC, il DOPPIO di quella indicata
  //   (segnale che la scelta non coincide con la realta'): ricavo 18, costo 20 -> -2.
  const buy = mkTrade(Date.parse('2025-01-10T10:00:00Z'), { id: 1, side: 'BUY', inst: 'BTC_EUR', qty: '0.05', price: '100000', fees: '0', feeInst: '' });
  const wdr = mkWdr(Date.parse('2025-04-01T09:00:00Z'), { id: 12, amount: '0.02', fee: '0.0001' });
  const ledger = I.TYPES.generic.parse('data;tipo;conto;asset;quantita;valore_eur\n2025-04-01 09:30;trasferimento_entrata;Ledger;BTC;0.0199;\n', 'm.csv').events;
  const go = (feeIncluded) => {
    const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-04-01', 90000);
    return run([...X.parse(mkRaw({ feeIncluded, trades: [buy], withdrawals: [wdr] }), 'api.json').events, ...ledger], { prices });
  };
  const yes = go(true).engine, no = go(false).engine;
  assert.equal(blocking(yes).length, 0, JSON.stringify(yes.issues)); assert.equal(blocking(no).length, 0, JSON.stringify(no.issues));
  const d1 = yes.disposals[0], d2 = no.disposals[0];
  assert.equal(yes.disposals.length, 1); assert.equal(no.disposals.length, 1);
  eq(d1.qty, '0.0001'); eq(d1.proceeds, 9); eq(d1.cost, 10); eq(d1.gain, -1);
  eq(d2.qty, '0.0002'); eq(d2.proceeds, 18); eq(d2.cost, 20); eq(d2.gain, -2);
  // senza scelta: il prelievo e' "non riconosciuto" e il risultato non e' definitivo
  const none = go(null);
  assert.ok(blocking(none.engine).length > 0);
  assert.ok(X.parse(mkRaw({ feeIncluded: null, trades: [buy], withdrawals: [wdr] }), 'api.json').unknown.some((u) => u.key.includes('prelievo con commissione')));
});

test('prova completa: sync su server finto -> parse -> motore, con avvisi e copertura coerenti', async () => {
  const clock = mkClock(NOW);
  const fake = new FakeExchange(clock, {
    trades: [
      mkTrade(Date.parse('2025-01-10T10:00:00Z'), { id: 1, side: 'BUY', inst: 'BTC_EUR', qty: '0.01', price: '100000', fees: '-1', feeInst: 'EUR' }),
      mkTrade(Date.parse('2025-02-10T10:00:00Z'), { id: 2, side: 'SELL', inst: 'BTC_EUR', qty: '0.004', price: '120000', fees: '-0.48', feeInst: 'EUR' }),
      mkTrade(Date.parse('2025-02-11T10:00:00Z'), { id: 3, inst: 'BTCUSD-PERP' })],
    deposits: [mkDep(Date.parse('2025-03-07T10:00:10Z'), { id: 11, amount: '0.003' }), mkDep(Date.parse('2025-03-08T10:00:00Z'), { id: 13, status: '3' })],
    withdrawals: [mkWdr(Date.parse('2025-04-01T09:00:00Z'), { id: 12, amount: '0.001', fee: '0.0001' }), mkWdr(Date.parse('2025-05-01T09:00:00Z'), { id: 14, status: '1' })] });
  const out = await doSync(fake, clock);
  assert.ok(out.warnings.some((w) => /1 operazioni riguardano derivati/.test(w)));
  assert.ok(out.warnings.some((w) => /1 depositi non risultano arrivati/.test(w)));
  assert.ok(out.warnings.some((w) => /1 prelievi non sono ancora completati/.test(w)));
  assert.ok(out.warnings.some((w) => /non dice se l'importo comprende già la commissione/.test(w)));
  const r = X.parse(out.raw, 'api.json');
  assert.deepEqual(r.events.map((e) => e.kind).sort(), [Kind.BUY, Kind.SELL, Kind.UNRESOLVED, Kind.TRANSFER_IN, Kind.INFO, Kind.TRANSFER_OUT, Kind.UNRESOLVED].sort());
  assert.deepEqual(r.unknown.map((u) => u.key).sort(), ['Crypto.com Exchange (API) · prelievo non concluso', 'Crypto.com Exchange (API) · strumento non spot']);
  const good = r.events.filter((e) => e.kind !== Kind.UNRESOLVED);
  const appEv = app('2025-03-07 10:00:00,To exchange,BTC,-0.003,,,EUR,300,330,crypto_to_exchange_transfer\n');
  const ledger = I.TYPES.generic.parse('data;tipo;conto;asset;quantita;valore_eur\n2025-04-01 09:30;trasferimento_entrata;Ledger;BTC;0.0009;\n', 'm.csv').events;
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2025-04-01', 90000);
  const { engine, y } = run([...good, ...appEv, ...ledger], { prices });
  assert.equal(blocking(engine).length, 0, JSON.stringify(engine.issues));
  // 79,12 (vendita) - 1,01 (commissione di rete: 9 - 0,0001 x 100.100) = 78,11
  eq(y.crypto.gains, '79.12'); eq(y.crypto.losses, '1.01'); eq(y.crypto.net, '78.11');
});
