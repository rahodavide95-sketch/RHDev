// Collegamento API Binance.
// La rete e' SIMULATA da un server finto che implementa il comportamento DOCUMENTATO (e quello assunto in modo prudente,
// vedi il commento di testa di src/api/binance.js): firma HMAC-SHA256 della query string, intestazione X-MBX-APIKEY,
// timestamp/recvWindow, finestre massime (< 90 giorni per depositi e prelievi, 30 per Convert, 180 per i dividendi,
// 24 ore per myTrades con startTime/endTime, fromId incompatibile con startTime/endTime), limiti di righe per pagina,
// "ultime 100" del dribblet, limiti di frequenza con 429 e Retry-After.
// Nulla di cio' prova che l'API vera si comporti cosi': serve un account reale (vedi ASSUNTO nel modulo).
const { test } = require('node:test');
const crypto = require('node:crypto');
const { CT, D, Kind, T, ev, run, eq, blocking, codes, assert } = require('./helpers');
require('../src/platforms.js');
require('../src/api/common.js');
require('../src/api/binance.js');
require('../src/api/index.js');
const X = CT.api.binance;
const C = CT.api.common;
const I = CT.importers;

// nessun test deve mai toccare la rete vera: il fetch globale e' disattivato
globalThis.fetch = () => { throw new Error('rete reale vietata nei test'); };

const KEY = 'bnTESTapiKEY0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL0123';
const SECRET = 'bnTESTsecretSECRET9876543210zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQP';
const SEC = 1000, MIN = 60000, HOUR = 3600000, DAY = 86400000;
const NOW = Date.parse('2026-10-05T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const at = (s) => Date.parse(s);
const applyTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// ---------------------------------------------------------------- orologio virtuale (sleep e now iniettati)
function mkClock(ms) {
  const c = { t: ms, slept: [] };
  c.now = () => new Date(c.t);
  c.sleep = async (w) => { c.slept.push(w); c.t += w; };
  return c;
}

// ---------------------------------------------------------------- server finto
const res = (status, body, headers) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const DEFAULT_SYMBOLS = [
  ['BTCEUR', 'BTC', 'EUR'], ['ETHEUR', 'ETH', 'EUR'], ['BNBEUR', 'BNB', 'EUR'], ['ADAEUR', 'ADA', 'EUR'],
  ['BTCUSDT', 'BTC', 'USDT'], ['ETHUSDT', 'ETH', 'USDT'], ['BNBUSDT', 'BNB', 'USDT'], ['XRPUSDT', 'XRP', 'USDT'], ['SOLUSDT', 'SOL', 'USDT'],
  ['ETHBTC', 'ETH', 'BTC'], ['XRPBTC', 'XRP', 'BTC'], ['EURUSDT', 'EUR', 'USDT'], ['LTCUSDC', 'LTC', 'USDC'], ['SOLFDUSD', 'SOL', 'FDUSD'],
  ['DOGEBUSD', 'DOGE', 'BUSD'], ['BTCTRY', 'BTC', 'TRY'], ['ETHBNB', 'ETH', 'BNB'],
].map(([symbol, baseAsset, quoteAsset]) => ({ symbol, status: symbol === 'ADAEUR' ? 'BREAK' : 'TRADING', baseAsset, quoteAsset, quotePrecision: 8, filters: [], permissions: [], permissionSets: [['SPOT']] }));

// rotte, peso IP (6000 al minuto, esempio della documentazione), limiti per UID (Convert 3000 su 180000 al minuto) e parametri ammessi
const COMMON = ['recvWindow', 'timestamp', 'signature'];
const ROUTES = {
  '/api/v3/time': { signed: false, ip: 1, params: [] },
  '/api/v3/exchangeInfo': { signed: false, ip: 20, params: ['symbol', 'symbols', 'permissions', 'showPermissionSets', 'symbolStatus'] },
  '/api/v3/account': { signed: true, ip: 20, params: ['omitZeroBalances'] },
  '/api/v3/myTrades': { signed: true, ip: 20, params: ['symbol', 'orderId', 'startTime', 'endTime', 'fromId', 'limit'] },
  '/sapi/v1/capital/deposit/hisrec': { signed: true, ip: 1, params: ['includeSource', 'coin', 'status', 'startTime', 'endTime', 'offset', 'limit', 'txId'] },
  '/sapi/v1/capital/withdraw/history': { signed: true, perSecond: 10, params: ['coin', 'withdrawOrderId', 'status', 'offset', 'limit', 'idList', 'startTime', 'endTime'] },
  '/sapi/v1/convert/tradeFlow': { signed: true, uid: 3000, params: ['startTime', 'endTime', 'limit'] },
  '/sapi/v1/asset/assetDividend': { signed: true, ip: 10, params: ['asset', 'startTime', 'endTime', 'limit'] },
  '/sapi/v1/asset/dribblet': { signed: true, ip: 1, params: ['accountType', 'startTime', 'endTime'] },
  '/sapi/v1/fiat/payments': { signed: true, ip: 1, params: ['transactionType', 'beginTime', 'endTime', 'page', 'rows'] },
};

class FakeBinance {
  constructor(clock, o = {}) {
    Object.assign(this, {
      clock, skew: 0, latency: 0, ipLimit: 6000, edge: 'inclusive', reverse: false, listCap: null, offsetIgnored: false, fromIdZeroUnset: false,
      symbols: DEFAULT_SYMBOLS, balances: [], trades: {}, deposits: [], withdrawals: [], convert: [], dividends: [], dust: [], payBuy: [], paySell: [],
      faults: [], down: false, key: KEY, secret: SECRET, noRateLimits: false,
    }, o);
    this.log = []; this.ipUsed = []; this.uidUsed = []; this.secUsed = []; this.leaks = []; this.limited = 0;
    this.fetch = this.fetch.bind(this);
  }
  now() { return this.clock.t + this.skew; }
  async fetch(url, init) {
    const half = this.latency / 2;
    this.clock.t += half;
    try { return this.handle(url, init || {}); } finally { this.clock.t += half; }
  }
  inR(t, s, e) {
    switch (this.edge) {
      case 'inclusive': return t >= s && t <= e;
      case 'exclusive-end': return t >= s && t < e;
      case 'exclusive-start': return t > s && t <= e;
      default: return t > s && t < e;
    }
  }
  take(list, w, limit, windowMs) {
    const now = this.now();
    while (list.length && list[0].t <= now - windowMs) list.shift();
    if (list.reduce((a, x) => a + x.w, 0) + w > limit) return Math.max(1, Math.ceil((list[0].t + windowMs - now) / 1000));
    list.push({ t: now, w });
    return 0;
  }
  handle(url, init) {
    if (this.down) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const path = u.pathname, qs = u.search.slice(1), q = {};
    for (const [k, v] of u.searchParams) q[k] = v;
    const headers = init.headers || {};
    const e = { path, q, url, qs, headers, method: init.method || 'GET', t: this.now() };
    this.log.push(e);
    for (const f of this.faults) if (f.times > 0 && f.when(e)) { f.times--; return f.reply(e); }
    const r = ROUTES[path];
    if (!r) return res(404, { code: -1, msg: 'Not Found' });
    if (e.method !== 'GET') return res(405, { code: -1, msg: 'Method not allowed' });
    const bad = (code, msg, status = 400) => res(status, { code, msg });
    const ok = (body) => res(200, body);
    // limiti di frequenza (peso IP, peso UID, richieste al secondo)
    if (!this.noRateLimits) {
      let ra = 0;
      if (r.ip) ra = this.take(this.ipUsed, r.ip, this.ipLimit, MIN);
      if (!ra && r.uid) ra = this.take(this.uidUsed, r.uid, 180000, MIN);
      if (!ra && r.perSecond) ra = this.take(this.secUsed, 1, r.perSecond, SEC);
      if (ra) { this.limited++; return res(429, { code: -1003, msg: 'Too many requests.' }, { 'retry-after': String(ra) }); }
    }
    for (const k of Object.keys(q)) if (!r.params.includes(k) && !(r.signed && COMMON.includes(k))) return bad(-1104, `Not all sent parameters were read; parameter '${k}' was not read.`);
    if (r.signed) {
      if (headers['X-MBX-APIKEY'] !== this.key) return bad(-2015, 'Invalid API-key, IP, or permissions for action.', 401);
      const i = qs.lastIndexOf('&signature=');
      if (i < 0) return bad(-1102, "Mandatory parameter 'signature' was not sent, was empty/null, or malformed.");
      const sig = crypto.createHmac('sha256', this.secret).update(qs.slice(0, i)).digest('hex');
      if (sig !== qs.slice(i + 11)) return bad(-1022, 'Signature for this request is not valid.');
      const ts = Number(q.timestamp), rw = q.recvWindow === undefined ? 5000 : Number(q.recvWindow);
      if (!(ts > 0)) return bad(-1102, "Mandatory parameter 'timestamp' was not sent, was empty/null, or malformed.");
      if (!(rw > 0 && rw <= 60000)) return bad(-1100, 'recvWindow non valido');
      if (!(ts < this.now() + 1000 && this.now() - ts <= rw)) return bad(-1021, "Timestamp for this request is outside of the recvWindow.");
    } else if (headers['X-MBX-APIKEY'] !== undefined || 'signature' in q || 'timestamp' in q) this.leaks.push(e);
    return this[path](q, bad, ok);
  }
  list(a) { return this.reverse ? a.slice().reverse() : a; }
  '/api/v3/time'() { return res(200, { serverTime: this.now() }); }
  '/api/v3/exchangeInfo'() {
    return res(200, { timezone: 'UTC', serverTime: this.now(), rateLimits: this.noRateLimits ? [] : [{ rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: this.ipLimit }, { rateLimitType: 'RAW_REQUESTS', interval: 'MINUTE', intervalNum: 5, limit: 61000 }], exchangeFilters: [], symbols: this.symbols });
  }
  '/api/v3/account'(q) {
    const bal = q.omitZeroBalances === 'true' ? this.balances.filter((b) => !D(b.free).isZero() || !D(b.locked).isZero()) : this.balances;
    return res(200, { makerCommission: 10, takerCommission: 10, canTrade: true, canWithdraw: true, canDeposit: true, updateTime: this.now(), accountType: 'SPOT', balances: bal, permissions: ['SPOT'], uid: 1 });
  }
  '/api/v3/myTrades'(q, bad, ok) {
    if (!q.symbol) return bad(-1102, "Mandatory parameter 'symbol' was not sent, was empty/null, or malformed.");
    if (!this.symbols.some((s) => s.symbol === q.symbol)) return bad(-1121, 'Invalid symbol.');
    const limit = q.limit === undefined ? 500 : Number(q.limit);
    if (!(limit >= 1 && limit <= 1000)) return bad(-1100, 'Illegal characters found in parameter limit');
    if (q.fromId !== undefined && (q.startTime !== undefined || q.endTime !== undefined)) return bad(-1128, 'Combination of optional parameters invalid.');
    if (q.startTime !== undefined && q.endTime !== undefined && Number(q.endTime) - Number(q.startTime) > DAY) return bad(-1127, 'More than 24 hours between startTime and endTime.');
    const all = (this.trades[q.symbol] || []).slice().sort((a, b) => a.id - b.id);
    let rows;
    if (q.fromId !== undefined && !(this.fromIdZeroUnset && Number(q.fromId) === 0)) rows = all.filter((t) => t.id >= Number(q.fromId)).slice(0, limit);
    else if (q.startTime !== undefined || q.endTime !== undefined) rows = all.filter((t) => (q.startTime === undefined || t.time >= Number(q.startTime)) && (q.endTime === undefined || t.time <= Number(q.endTime))).slice(0, limit);
    else rows = all.slice(-limit);                       // senza fromId: le piu' recenti
    return ok(rows);
  }
  '/sapi/v1/capital/deposit/hisrec'(q, bad, ok) { return this.walletList(q, bad, ok, this.deposits, (d) => d.insertTime); }
  '/sapi/v1/capital/withdraw/history'(q, bad, ok) { return this.walletList(q, bad, ok, this.withdrawals, (d) => Date.parse(d.applyTime.replace(' ', 'T') + 'Z')); }
  walletList(q, bad, ok, rows, tOf) {
    const end = q.endTime !== undefined ? Number(q.endTime) : this.now();
    const start = q.startTime !== undefined ? Number(q.startTime) : end - 90 * DAY;
    if (end - start >= 90 * DAY) return bad(-1000, 'The time interval must be less than 90 days.');
    let limit = q.limit === undefined ? 1000 : Number(q.limit);
    if (!(limit >= 1 && limit <= 1000)) return bad(-1100, 'limit non valido');
    if (this.listCap) limit = Math.min(limit, this.listCap);
    const offset = this.offsetIgnored ? 0 : Number(q.offset || 0);
    const sel = rows.filter((d) => this.inR(tOf(d), start, end)).sort((a, b) => tOf(b) - tOf(a) || (a.id < b.id ? -1 : 1));
    return ok(this.list(sel).slice(offset, offset + limit));
  }
  '/sapi/v1/convert/tradeFlow'(q, bad, ok) {
    if (q.startTime === undefined || q.endTime === undefined) return bad(-1102, "Mandatory parameter 'startTime' was not sent, was empty/null, or malformed.");
    const start = Number(q.startTime), end = Number(q.endTime);
    if (end - start > 30 * DAY) return bad(-1000, 'The max interval between startTime and endTime is 30 days.');
    const limit = q.limit === undefined ? 100 : Number(q.limit);
    if (!(limit >= 1 && limit <= 1000)) return bad(-1100, 'limit non valido');
    const sel = this.convert.filter((c) => this.inR(c.createTime, start, end)).sort((a, b) => a.createTime - b.createTime || (a.quoteId < b.quoteId ? -1 : 1));
    return ok({ list: this.list(sel.slice(0, limit)), startTime: start, endTime: end, limit, moreData: sel.length > limit });
  }
  '/sapi/v1/asset/assetDividend'(q, bad, ok) {
    const end = q.endTime !== undefined ? Number(q.endTime) : this.now();
    const start = q.startTime !== undefined ? Number(q.startTime) : end - 30 * DAY;
    if (end - start > 180 * DAY) return bad(-1000, 'There cannot be more than 180 days between parameter startTime and endTime.');
    const limit = q.limit === undefined ? 20 : Number(q.limit);
    if (!(limit >= 1 && limit <= 500)) return bad(-1100, 'limit non valido');
    const sel = this.dividends.filter((d) => this.inR(d.divTime, start, end)).sort((a, b) => b.divTime - a.divTime || a.id - b.id);
    return ok({ rows: this.list(sel.slice(0, limit)), total: sel.length + (this.totalExtra || 0) });
  }
  '/sapi/v1/asset/dribblet'(q, bad, ok) {
    const end = q.endTime !== undefined ? Number(q.endTime) : this.now();
    const start = q.startTime !== undefined ? Number(q.startTime) : end - 90 * DAY;
    const sel = this.dust.filter((d) => this.inR(d.operateTime, start, end) && d.operateTime >= Date.UTC(2020, 11, 1)).sort((a, b) => b.operateTime - a.operateTime || a.transId - b.transId);
    let out = sel.slice(0, 100);                           // "solo le ultime 100 registrazioni"
    if (this.dustDetailCap) {                              // variante: il limite conta i DETTAGLI (non documentato quale sia la misura vera)
      out = []; let n = 0;
      for (const d of sel) { const k = (d.userAssetDribbletDetails || []).length; if (n + k > this.dustDetailCap) break; n += k; out.push(d); }
    }
    return ok({ total: sel.length, userAssetDribblets: this.list(out) });
  }
  '/sapi/v1/fiat/payments'(q, bad, ok) {
    if (q.transactionType !== '0' && q.transactionType !== '1') return bad(-1102, "Mandatory parameter 'transactionType' was not sent, was empty/null, or malformed.");
    const end = q.endTime !== undefined ? Number(q.endTime) : this.now();
    const start = q.beginTime !== undefined ? Number(q.beginTime) : end - 30 * DAY;
    if (end - start > 30 * DAY) return bad(-1000, 'Time range too large (maximum 30 days).');
    let rows = q.rows === undefined ? 100 : Number(q.rows);
    const page = this.pageIgnored ? 1 : (q.page === undefined ? 1 : Number(q.page));
    if (!(rows >= 1 && rows <= 500) || !(page >= 1)) return bad(-1100, 'rows o page non valido');
    if (this.payCap) rows = Math.min(rows, this.payCap);
    const src = q.transactionType === '0' ? this.payBuy : this.paySell;
    const sel = src.filter((p) => this.inR(p.createTime, start, end)).sort((a, b) => b.createTime - a.createTime || (a.orderNo < b.orderNo ? -1 : 1));
    return ok({ code: '000000', message: 'success', data: this.list(sel.slice((page - 1) * rows, page * rows)), total: sel.length + (this.totalExtra || 0), success: true });
  }
}

// ---------------------------------------------------------------- dati di prova (forma dei record: SDK ufficiale, importi come stringhe)
const trade = (symbol, id, t, o = {}) => ({ symbol, id, orderId: 900000 + id, orderListId: -1, price: '30000.00000000', qty: '0.10000000', quoteQty: '3000.00000000', commission: '0.00000000', commissionAsset: 'BNB', time: t, isBuyer: true, isMaker: false, isBestMatch: true, ...o });
const dep = (id, t, o = {}) => ({ id: 'd' + id, amount: '0.50000000', coin: 'BTC', network: 'BTC', status: 1, address: 'bc1qtestaddress', addressTag: '', txId: 'txd' + id, insertTime: t, completeTime: t + 60000, transferType: 0, confirmTimes: '2/2', unlockConfirm: 0, walletType: 0, ...o });
const wd = (id, t, o = {}) => ({ id: 'w' + id, amount: '0.02000000', transactionFee: '0.00010000', coin: 'BTC', status: 6, address: 'bc1qotheraddress', txId: 'txw' + id, applyTime: applyTime(t), network: 'BTC', transferType: 0, ...o });
const conv = (id, t, o = {}) => ({ quoteId: 'q' + id, orderId: 7000000 + id, orderStatus: 'SUCCESS', fromAsset: 'USDT', fromAmount: '100.00000000', toAsset: 'BTC', toAmount: '0.00200000', ratio: '0.00002', inverseRatio: '50000', createTime: t, ...o });
const div = (id, t, o = {}) => ({ id: 100000 + id, amount: '0.00100000', asset: 'BNB', divTime: t, enInfo: 'BNB distribution', tranId: 5000000 + id, ...o });
const dustRec = (id, t, o = {}) => ({ operateTime: t, totalTransferedAmount: '0.00098000', totalServiceChargeAmount: '0.00002000', transId: 800000 + id, userAssetDribbletDetails: [{ transId: 800000 + id, serviceChargeAmount: '0.00002000', amount: '0.50000000', operateTime: t, transferedAmount: '0.00098000', fromAsset: 'ADA' }], ...o });
const pay = (id, t, o = {}) => ({ orderNo: 'o' + id, sourceAmount: '1010.00', fiatCurrency: 'EUR', obtainAmount: '0.02500000', cryptoCurrency: 'BTC', totalFee: '10.00', price: '40000.000000', status: 'Completed', paymentMethod: 'Credit Card', createTime: t, updateTime: t + 1000, ...o });

// ---------------------------------------------------------------- esecuzione di sync sul server finto
function setup(state, o = {}) {
  const clock = mkClock(NOW);
  const srv = new FakeBinance(clock, state);
  const progress = [];
  const opts = { fetch: srv.fetch, sleep: clock.sleep, now: () => new Date(clock.t + (o.localSkew || 0)), onProgress: (m) => progress.push(m), options: Object.assign({ startDate: '2024-01-01' }, o.options) };
  return { clock, srv, progress, opts };
}
async function runSync(state, o = {}) {
  const s = setup(state, o);
  const out = await X.sync(Object.assign({ apiKey: KEY, apiSecret: SECRET }, o.creds), s.opts);
  return Object.assign(s, { out });
}
async function syncError(state, o = {}) {
  try { await runSync(state, o); } catch (e) { return e; }
  assert.fail('sync doveva fallire');
}
const lacks = (value, ...secrets) => { const t = typeof value === 'string' ? value : JSON.stringify(value); for (const s of secrets) assert.ok(!t.includes(s), `compare un segreto: ${s.slice(0, 8)}…`); };
const noSecrets = (value) => lacks(value, KEY, SECRET);
const callsTo = (srv, path) => srv.log.filter((e) => e.path === path);
const kinds = (r) => r.events.map((e) => e.kind);
const BAL = [{ asset: 'BTC', free: '0.50000000', locked: '0.00000000' }, { asset: 'USDT', free: '100.00000000', locked: '0.00000000' }];

// ---------------------------------------------------------------- contratto del connettore
test('contratto del connettore: campi, opzioni, istruzioni e limiti in italiano; registrazione nel registro', () => {
  assert.equal(X.id, 'binance'); assert.equal(X.label, 'Binance'); assert.equal(X.platform, 'binance');
  assert.ok(CT.PLATFORMS[X.platform]);
  assert.deepEqual(X.fields.map((f) => f.key), ['apiKey', 'apiSecret']);
  assert.ok(X.fields.every((f) => f.secret === true && f.label && f.placeholder));
  assert.deepEqual(X.options.map((o) => o.key), ['quotes', 'extraSymbols', 'startDate', 'withdrawFee']);
  assert.equal(X.options.find((o) => o.key === 'quotes').default, 'EUR,USDT,USDC,BTC,ETH,BNB,FDUSD');
  assert.ok(X.options.every((o) => o.label && typeof o.label === 'string'));
  const help = X.help.join(' ');
  assert.ok(/Abilita lettura/.test(help) && /NON abilitare/i.test(help) && /prelievi/.test(help), 'le istruzioni dicono di abilitare solo la lettura');
  assert.ok(X.help.length >= 4 && X.limits.length >= 4 && [...X.help, ...X.limits].every((t) => typeof t === 'string' && t.length > 20));
  assert.ok(/Earn/.test(X.limits.join(' ')) && /futures/i.test(X.limits.join(' ')));
  assert.equal(typeof X.sync, 'function'); assert.equal(typeof X.parse, 'function');
  CT.api.register();
  assert.ok(CT.api.ids().includes('binance'));
  assert.ok(I.TYPES.api_binance && /Binance/.test(I.TYPES.api_binance.label));
  assert.equal(CT.platformOfType('api_binance'), 'binance');
  assert.equal(CT.api.forPlatform('binance'), X);
  assert.ok(CT.PLATFORMS.binance.types.includes('api_binance'));
});

// ---------------------------------------------------------------- firma
test('firma: vettore della documentazione ufficiale (rest-api.md, HMAC SHA256), comprese le lettere non ASCII percent-encoded', async () => {
  const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
  assert.equal(await C.hmacHex(secret, 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'),
    'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
  assert.equal(await C.hmacHex(secret, 'symbol=%EF%BC%91%EF%BC%92%EF%BC%93%EF%BC%94%EF%BC%95%EF%BC%96&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'),
    'e1353ec6b14d888f1164ae9af8228a3dbd508bc82eb867db8ab6046442f33ef3');
});

test('sync: ogni richiesta privata e\' firmata (HMAC del testo prima di "&signature="), chiave solo nell\'intestazione, rifatta a ogni tentativo; le pubbliche senza chiave', async () => {
  const { srv, out } = await runSync({ balances: BAL, deposits: [dep(1, at('2024-05-01T10:00:00Z'))] });
  assert.ok(out.raw);
  assert.ok(srv.log.length > 20);
  for (const e of srv.log) {
    const route = ROUTES[e.path];
    assert.ok(route, 'rotta inattesa ' + e.path);
    assert.equal(e.method, 'GET');
    if (route.signed) {
      assert.equal(e.headers['X-MBX-APIKEY'], KEY);
      const i = e.qs.lastIndexOf('&signature=');
      assert.ok(i > 0 && /^[0-9a-f]{64}$/.test(e.qs.slice(i + 11)), 'firma in coda');
      assert.equal(e.qs.slice(i + 11), crypto.createHmac('sha256', SECRET).update(e.qs.slice(0, i)).digest('hex'));
      assert.equal(e.q.recvWindow, '5000');
      assert.ok(/^\d{13}$/.test(e.q.timestamp));
    }
    assert.ok(!e.url.includes(KEY) && !e.url.includes(SECRET), 'la chiave non sta mai nell\'indirizzo');
  }
  assert.deepEqual(srv.leaks, [], 'le richieste pubbliche non portano chiave ne\' firma');
  assert.equal(srv.limited, 0);
});

test('sync: l\'orologio del computer sbagliato (10 minuti indietro, ritardo di rete) non rovina le firme: ci si allinea a /api/v3/time', async () => {
  const { srv, out } = await runSync({ balances: BAL, latency: 80, skew: 0 }, { localSkew: -10 * MIN });
  assert.ok(out.raw);
  for (const e of srv.log.filter((x) => ROUTES[x.path].signed)) {
    const d = e.t - Number(e.q.timestamp);                                   // il server accetta se 0 <= d <= recvWindow (e timestamp < server + 1 s)
    assert.ok(d >= 0 && d <= 5000, `scarto ${d} ms`);
  }
  assert.equal(srv.log[0].path, '/api/v3/time');
});

// ---------------------------------------------------------------- finestre
test('finestre: coprono [da, a] senza buchi, mai piu\' lunghe del massimo, con la sovrapposizione prevista', () => {
  const { makeWindows } = X._internal;
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 300; k++) {
    const from = 1500000000000 + rnd(1e10), to = from + 1 + rnd(2e11), len = (1 + rnd(120)) * DAY, overlap = HOUR;
    const w = makeWindows(from, to, len, overlap);
    assert.equal(w[0].s, from); assert.equal(w[w.length - 1].e, to);
    for (let i = 0; i < w.length; i++) {
      assert.ok(w[i].e - w[i].s <= len && w[i].e > w[i].s);
      if (i > 0) assert.equal(w[i - 1].e - w[i].s, overlap, 'sovrapposizione');
    }
  }
  assert.deepEqual(makeWindows(10, 10, DAY, HOUR), []);
});

test('finestre: i massimi documentati sono rispettati con margine (89 < 90, 29 < 30, 170 < 180 giorni) e myTrades non usa mai startTime/endTime', () => {
  const { WIN } = X._internal.constants;
  assert.ok(WIN.wallet.len < 90 * DAY && WIN.convert.len < 30 * DAY && WIN.dividend.len < 180 * DAY && WIN.fiat.len <= 30 * DAY && WIN.dust.len <= 30 * DAY);
});

for (const edge of ['inclusive', 'exclusive-end', 'exclusive-start', 'exclusive-both']) {
  test(`sync: con data predefinita (1/7/2017) nessuna finestra supera i massimi e nessun record ai confini va perso (confini ${edge})`, async () => {
    const { makeWindows } = X._internal;
    const { WIN } = X._internal.constants;
    // 1a passata: serve solo a conoscere "a" (istante di fine), che non dipende dai dati
    const probe = await runSync({ balances: BAL, edge }, { options: { startDate: undefined } });
    const startMs = at('2017-07-01T00:00:00Z');
    assert.equal(probe.out.raw.options.startDate, '2017-07-01');
    const to = at(probe.out.raw.range.to);
    const from = startMs - 1;
    const edges = (wins, floor) => {
      const set = new Set();
      for (const w of wins) for (const t of [w.s, w.s + 1, w.e - 1, w.e]) if (t >= floor && t < to - 5000) set.add(t);   // anche esattamente sui bordi: con bordi esclusivi senza sovrapposizione andrebbero persi
      return [...set].sort((a, b) => a - b);
    };
    const grid = (step, floor = startMs) => { const a = []; for (let t = floor + 3 * HOUR; t < to - DAY; t += step) a.push(t); return a; };
    const times = {
      dep: edges(makeWindows(from, to, WIN.wallet.len, WIN.wallet.overlap), startMs).concat(grid(7 * DAY)),
      wd: edges(makeWindows(from, to, WIN.wallet.len, WIN.wallet.overlap), startMs).map((t) => Math.floor(t / 1000) * 1000).concat(grid(11 * DAY).map((t) => Math.floor(t / 1000) * 1000)),
      conv: edges(makeWindows(from, to, WIN.convert.len, WIN.convert.overlap), startMs).concat(grid(6 * DAY)),
      div: edges(makeWindows(from, to, WIN.dividend.len, WIN.dividend.overlap), startMs).concat(grid(20 * DAY)),
      pay: edges(makeWindows(from, to, WIN.fiat.len, WIN.fiat.overlap), startMs).concat(grid(9 * DAY)),
    };
    const dustFloor = Date.UTC(2020, 11, 1);
    times.dust = edges(makeWindows(Math.max(from, dustFloor - 1), to, WIN.dust.len, WIN.dust.overlap), dustFloor).concat(grid(13 * DAY, dustFloor));
    const uniq = (a) => [...new Set(a)];
    for (const k of Object.keys(times)) times[k] = uniq(times[k]);
    const state = {
      balances: BAL, edge,
      deposits: times.dep.map((t, i) => dep(i, t)),
      withdrawals: times.wd.map((t, i) => wd(i, t)),
      convert: times.conv.map((t, i) => conv(i, t)),
      dividends: times.div.map((t, i) => div(i, t)),
      dust: times.dust.map((t, i) => dustRec(i, t)),
      payBuy: times.pay.map((t, i) => pay(i, t)),
    };
    const r = await runSync(state, { options: { startDate: undefined } });
    assert.equal(r.srv.limited, 0, 'nessun 429');
    const idsOf = (rows, f) => rows.map(f).sort();
    assert.deepEqual(idsOf(r.out.raw.deposits, (x) => x.id), idsOf(state.deposits, (x) => x.id), 'depositi');
    assert.deepEqual(idsOf(r.out.raw.withdrawals, (x) => x.id), idsOf(state.withdrawals, (x) => x.id), 'prelievi');
    assert.deepEqual(idsOf(r.out.raw.convert, (x) => x.quoteId), idsOf(state.convert, (x) => x.quoteId), 'convert');
    assert.deepEqual(idsOf(r.out.raw.dividends, (x) => x.id), idsOf(state.dividends, (x) => x.id), 'dividendi');
    assert.deepEqual(idsOf(r.out.raw.dust, (x) => x.transId), idsOf(state.dust, (x) => x.transId), 'piccoli saldi');
    assert.deepEqual(idsOf(r.out.raw.fiatPayments.buy, (x) => x.orderNo), idsOf(state.payBuy, (x) => x.orderNo), 'acquisti con carta');
    assert.ok(state.deposits.length > 400 && state.convert.length > 500);
    // il primo anno utile e' esplicito: nessuna richiesta di storico parte prima della data di inizio
    for (const e of r.srv.log.filter((x) => ['/sapi/v1/capital/deposit/hisrec', '/sapi/v1/convert/tradeFlow', '/sapi/v1/asset/assetDividend'].includes(x.path))) assert.ok(Number(e.q.startTime) >= from, 'startTime prima della data di inizio');
    assert.equal(Math.min(...callsTo(r.srv, '/sapi/v1/capital/deposit/hisrec').map((e) => Number(e.q.startTime))), from);
    assert.equal(Math.min(...callsTo(r.srv, '/sapi/v1/asset/dribblet').map((e) => Number(e.q.startTime))), dustFloor - 1);
  });
}

test('sync: la data di inizio e\' rispettata (nessuna richiesta prima) e la copertura dei piccoli saldi dipende da essa', async () => {
  const r = await runSync({ balances: BAL }, { options: { startDate: '2020-06-15' } });
  const s = at('2020-06-15T00:00:00Z');
  assert.equal(r.out.raw.range.from, '2020-06-15T00:00:00.000Z');
  for (const e of r.srv.log) for (const k of ['startTime', 'beginTime']) if (e.q[k] !== undefined) assert.ok(Number(e.q[k]) >= s - 1);
  const dust = r.out.coverage.find((c) => /piccoli saldi/.test(c.what));
  assert.equal(dust.complete, false);
  assert.match(dust.note, /01\/12\/2020/);
  // la profondita' dello storico di Binance non e' dichiarata: nessuna fonte con storico si dichiara completa, qualunque sia la data di inizio
  const r2 = await runSync({ balances: BAL }, { options: { startDate: '2021-01-01' } });
  assert.equal(r2.out.coverage.find((c) => /piccoli saldi/.test(c.what)).complete, false);
  assert.match(r2.out.coverage.find((c) => /piccoli saldi/.test(c.what)).note, /storico/);
  assert.equal(r.out.coverage.find((c) => /Depositi di cripto/.test(c.what)).complete, false);
});

// ---------------------------------------------------------------- paginazione
test('paginazione depositi/prelievi: piu\' di 1000 righe in una finestra -> pagine con offset fino alla pagina vuota, senza doppioni', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const deposits = []; for (let i = 0; i < 2500; i++) deposits.push(dep(i, base + i * 60000));
  const withdrawals = []; for (let i = 0; i < 1001; i++) withdrawals.push(wd(i, base + i * 120000));
  const r = await runSync({ balances: BAL, deposits, withdrawals }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.deposits.length, 2500);
  assert.equal(new Set(r.out.raw.deposits.map((x) => x.id)).size, 2500);
  assert.equal(r.out.raw.withdrawals.length, 1001);
  const offs = callsTo(r.srv, '/sapi/v1/capital/deposit/hisrec').filter((e) => Number(e.q.startTime) <= base && Number(e.q.endTime) >= base + 2500 * 60000).map((e) => Number(e.q.offset));
  assert.deepEqual(offs, [0, 1000, 2000, 2500], 'pagina vuota alla fine');
  assert.ok(callsTo(r.srv, '/sapi/v1/capital/deposit/hisrec').every((e) => e.q.limit === '1000'));
  assert.deepEqual(r.out.raw.deposits.map((x) => x.insertTime), r.out.raw.deposits.map((x) => x.insertTime).slice().sort((a, b) => a - b), 'raw in ordine cronologico');
});

test('paginazione: se il server taglia le pagine a meno del richiesto (limite reale piu\' basso) si continua comunque fino alla pagina vuota', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const deposits = []; for (let i = 0; i < 1300; i++) deposits.push(dep(i, base + i * 60000));
  const withdrawals = []; for (let i = 0; i < 700; i++) withdrawals.push(wd(i, base + i * 120000));
  const r = await runSync({ balances: BAL, deposits, withdrawals, listCap: 500 }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.deposits.length, 1300);
  assert.equal(r.out.raw.withdrawals.length, 700);
});

test('paginazione: un server che ignora offset (stessa pagina all\'infinito) -> errore "format", mai dati spacciati per completi', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const deposits = []; for (let i = 0; i < 1500; i++) deposits.push(dep(i, base + i * 60000));
  const e = await syncError({ balances: BAL, deposits, offsetIgnored: true }, { options: { startDate: '2025-02-01' } });
  assert.ok(e instanceof C.ApiError); assert.equal(e.code, 'format'); assert.match(e.message, /offset/);
  noSecrets(e.message); noSecrets(e.detail);
});

test('Convert: piu\' di 1000 righe in una finestra (moreData) -> finestra divisa a meta\' finche\' tutto e\' scaricato, senza doppioni', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const convert = []; for (let i = 0; i < 1500; i++) convert.push(conv(i, base + i * 1000));
  const r = await runSync({ balances: BAL, convert }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.convert.length, 1500);
  assert.equal(new Set(r.out.raw.convert.map((x) => x.quoteId)).size, 1500);
  assert.ok(callsTo(r.srv, '/sapi/v1/convert/tradeFlow').every((e) => e.q.limit === '1000' && Number(e.q.endTime) - Number(e.q.startTime) <= 29 * DAY));
});

test('Convert: piu\' di 1000 righe nello stesso istante (non separabili) -> errore "incomplete", non dati parziali', async () => {
  const t = at('2025-03-01T00:00:00Z');
  const convert = []; for (let i = 0; i < 1001; i++) convert.push(conv(i, t));
  const e = await syncError({ balances: BAL, convert }, { options: { startDate: '2025-02-01' } });
  assert.equal(e.code, 'incomplete'); assert.match(e.message, /Binance/);
});

test('Dividendi: piu\' di 500 righe in una finestra (senza offset) -> finestra divisa; stesso istante oltre 500 -> "incomplete"', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const dividends = []; for (let i = 0; i < 1200; i++) dividends.push(div(i, base + i * 2000));
  const r = await runSync({ balances: BAL, dividends }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.dividends.length, 1200);
  assert.ok(callsTo(r.srv, '/sapi/v1/asset/assetDividend').every((e) => e.q.limit === '500'));
  const same = []; for (let i = 0; i < 501; i++) same.push(div(i, base));
  const e = await syncError({ balances: BAL, dividends: same }, { options: { startDate: '2025-02-01' } });
  assert.equal(e.code, 'incomplete');
});

test('Piccoli saldi: "solo le ultime 100" -> finestre divise finche\' meno di 100; le registrazioni precedenti al 1/12/2020 non esistono per Binance', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const dust = []; for (let i = 0; i < 250; i++) dust.push(dustRec(i, base + i * 60000));
  dust.push(dustRec(9000, at('2020-06-01T00:00:00Z')));
  const r = await runSync({ balances: BAL, dust }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.dust.length, 250);
  assert.equal(r.out.coverage.find((c) => /piccoli saldi/.test(c.what)).complete, false, '100 o piu\' registrazioni: copertura dichiarata incompleta');
  const r2 = await runSync({ balances: BAL, dust }, { options: { startDate: '2017-07-01' } });
  assert.equal(r2.out.raw.dust.length, 250, 'quelle del 2020-06 non sono restituite dal server');
  assert.equal(r2.out.coverage.find((c) => /piccoli saldi/.test(c.what)).complete, false);
});

test('Acquisti con carta: pagine da 500 con page=1,2,3, anche vendite; finestre di 29 giorni', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const payBuy = []; for (let i = 0; i < 1200; i++) payBuy.push(pay(i, base + i * 60000));
  const paySell = [pay(5000, base + 5000, { orderNo: 's1', status: 'Completed' })];
  const r = await runSync({ balances: BAL, payBuy, paySell }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.fiatPayments.buy.length, 1200);
  assert.equal(r.out.raw.fiatPayments.sell.length, 1);
  const pages = callsTo(r.srv, '/sapi/v1/fiat/payments').filter((e) => e.q.transactionType === '0' && Number(e.q.beginTime) <= base && Number(e.q.endTime) >= base + 1200 * 60000).map((e) => Number(e.q.page));
  assert.deepEqual(pages, [1, 2, 3, 4], 'fino alla pagina vuota');
  assert.ok(callsTo(r.srv, '/sapi/v1/fiat/payments').every((e) => e.q.rows === '500' && Number(e.q.endTime) - Number(e.q.beginTime) <= 30 * DAY));
});

test('Acquisti con carta: righe per pagina ridotte dal server (limite reale piu\' basso) -> si continua fino alla pagina vuota; page ignorato -> "format"; totale dichiarato maggiore -> copertura incompleta', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const payBuy = []; for (let i = 0; i < 350; i++) payBuy.push(pay(i, base + i * 60000));
  const small = await runSync({ balances: BAL, payBuy, payCap: 100 }, { options: { startDate: '2025-02-01' } });
  assert.equal(small.out.raw.fiatPayments.buy.length, 350);
  assert.ok(!/ATTENZIONE/.test(small.out.coverage.find((c) => /carta/.test(c.what)).note), 'nessun totale incoerente: nessuna segnalazione in piu\'');
  const e = await syncError({ balances: BAL, payBuy, pageIgnored: true }, { options: { startDate: '2025-02-01' } });
  assert.equal(e.code, 'format'); assert.match(e.message, /page/);
  const extra = await runSync({ balances: BAL, payBuy, totalExtra: 7 }, { options: { startDate: '2025-02-01' } });
  const cov = extra.out.coverage.find((c) => /carta/.test(c.what));
  assert.equal(cov.complete, false); assert.match(cov.note, /ATTENZIONE/);
  assert.ok(extra.out.warnings.some((w) => /Acquisti con carta: Binance dichiara più registrazioni/.test(w)));
  assert.equal(extra.out.raw.fiatPayments.buy.length, 350, 'i dati scaricati restano, ma non sono spacciati per completi');
});

test('Dividendi: totale dichiarato maggiore delle righe ricevute (significato non documentato) -> copertura incompleta con avviso, non un errore', async () => {
  const dividends = [div(1, at('2025-03-01T00:00:00Z')), div(2, at('2025-03-02T00:00:00Z'))];
  const ok = await runSync({ balances: BAL, dividends }, { options: { startDate: '2025-02-01' } });
  assert.ok(!/ATTENZIONE/.test(ok.out.coverage.find((c) => /Dividendi/.test(c.what)).note));
  const r = await runSync({ balances: BAL, dividends, totalExtra: 3 }, { options: { startDate: '2025-02-01' } });
  const cov = r.out.coverage.find((c) => /Dividendi/.test(c.what));
  assert.equal(cov.complete, false); assert.match(cov.note, /ATTENZIONE/);
  assert.ok(r.out.warnings.some((w) => /Dividendi e premi: Binance dichiara un totale/.test(w)));
  assert.equal(r.out.raw.dividends.length, 2);
});

test('myTrades: fromId da 0, 1000 per volta, fromId = ultimo id + 1; mai startTime/endTime insieme a fromId; con piu\' pagine la prova fromId=1 conferma la partenza', async () => {
  const base = at('2024-02-01T00:00:00Z');
  const trades = []; for (let i = 0; i < 2500; i++) trades.push(trade('BTCEUR', 100 + i * 3, base + i * 1000, { isBuyer: i % 2 === 0 }));
  const r = await runSync({ balances: BAL, trades: { BTCEUR: trades } });
  assert.equal(r.out.raw.spotTrades.BTCEUR.length, 2500);
  const calls = callsTo(r.srv, '/api/v3/myTrades').filter((e) => e.q.symbol === 'BTCEUR');
  assert.deepEqual(calls.map((e) => e.q.fromId), ['0', '1', String(100 + 999 * 3 + 1), String(100 + 1999 * 3 + 1)]);
  assert.ok(calls.every((e) => e.q.limit === '1000' && e.q.startTime === undefined && e.q.endTime === undefined));
  assert.deepEqual(r.out.raw.spotTrades.BTCEUR.map((t) => t.id), trades.map((t) => t.id));
});

test('myTrades: se fromId=0 fosse trattato come "assente" (restituisce le ultime 1000) lo si scopre -> errore "incomplete" con la coppia', async () => {
  const base = at('2024-02-01T00:00:00Z');
  const trades = []; for (let i = 0; i < 2500; i++) trades.push(trade('BTCEUR', 1 + i, base + i * 1000));
  const e = await syncError({ balances: BAL, trades: { BTCEUR: trades }, fromIdZeroUnset: true });
  assert.equal(e.code, 'incomplete'); assert.match(e.message, /BTCEUR/); assert.match(e.message, /fromId/);
  noSecrets(e.message);
});

test('myTrades: pagina piu\' lunga del richiesto, operazione senza id, riga di un\'altra coppia o con id precedente a fromId -> "format"', async () => {
  const base = at('2024-02-01T00:00:00Z');
  const mk = (f) => ({ balances: BAL, faults: [{ when: (e) => e.path === '/api/v3/myTrades' && e.q.symbol === 'BTCEUR', times: 1, reply: f }] });
  const many = []; for (let i = 0; i < 1001; i++) many.push(trade('BTCEUR', i + 1, base + i));
  assert.equal((await syncError(mk(() => res(200, many)))).code, 'format');
  assert.equal((await syncError(mk(() => res(200, [{ ...trade('BTCEUR', 1, base), id: undefined }])))).code, 'format');
  assert.equal((await syncError(mk(() => res(200, [trade('ETHEUR', 1, base)])))).code, 'format');
  assert.equal((await syncError(mk(() => res(200, { not: 'a list' })))).code, 'format');
});

// ---------------------------------------------------------------- elenco delle coppie spot
test('coppie spot: tutte quelle in EUR, piu\' quelle con quota scelta il cui asset e\' stato visto (saldi, depositi...) e, a cascata, quelle scoperte dalle operazioni', async () => {
  const t = at('2024-05-01T10:00:00Z');
  const state = {
    balances: [...BAL, { asset: 'LDBTC', free: '1', locked: '0' }],
    deposits: [dep(1, t, { coin: 'ETH' })],
    trades: { ETHBTC: [trade('ETHBTC', 1, t, { qty: '1', quoteQty: '0.05', commissionAsset: 'BNB', commission: '0.001' })] },
  };
  const r = await runSync(state);
  const queried = [...new Set(callsTo(r.srv, '/api/v3/myTrades').map((e) => e.q.symbol))].sort();
  // EUR: BTCEUR ETHEUR BNBEUR ADAEUR | base fiat con quota ammessa: EURUSDT | quote ammesse con base vista: BTCUSDT (BTC), ETHUSDT e ETHBTC (ETH),
  // poi per cascata (la commissione in BNB rende "vista" BNB): BNBUSDT, ETHBNB
  assert.deepEqual(queried, ['ADAEUR', 'BNBEUR', 'BNBUSDT', 'BTCEUR', 'BTCUSDT', 'ETHBNB', 'ETHBTC', 'ETHEUR', 'ETHUSDT', 'EURUSDT']);
  assert.deepEqual(r.out.raw.queriedSymbols, queried);
  assert.deepEqual(Object.keys(r.out.raw.spotTrades), ['ETHBTC']);
  assert.equal(r.out.raw.spotTrades.ETHBTC.length, 1);
  for (const never of ['DOGEBUSD', 'BTCTRY', 'XRPUSDT', 'SOLUSDT', 'LTCUSDC', 'SOLFDUSD', 'XRPBTC']) assert.ok(!queried.includes(never), never);
});

test('coppie spot: opzioni "quotes" e "extraSymbols" (maiuscole, trattini e barre ignorati); coppia non in elenco -> si prova comunque, se Binance risponde -1121 avviso e nessun errore', async () => {
  const r = await runSync({ balances: [...BAL, { asset: 'DOGE', free: '1', locked: '0' }] }, { options: { quotes: 'usdt', extraSymbols: 'xrp-btc, DOGE/BUSD; VECCHIOBTC' } });
  const queried = [...new Set(callsTo(r.srv, '/api/v3/myTrades').map((e) => e.q.symbol))].sort();
  assert.deepEqual(queried, ['ADAEUR', 'BNBEUR', 'BTCEUR', 'BTCUSDT', 'DOGEBUSD', 'ETHEUR', 'EURUSDT', 'VECCHIOBTC', 'XRPBTC']);
  assert.ok(r.out.warnings.some((w) => /VECCHIOBTC/.test(w) && /file/.test(w) && /non è valida/.test(w)));
  assert.ok(!r.out.raw.queriedSymbols.includes('VECCHIOBTC'), 'rifiutata da Binance: non e\' tra le interrogate');
  assert.deepEqual(r.out.raw.rejectedSymbols, ['VECCHIOBTC']);
  assert.deepEqual(r.out.raw.options.quotes, ['USDT']);
  assert.deepEqual(r.out.raw.options.extraSymbols, ['XRPBTC', 'DOGEBUSD', 'VECCHIOBTC']);
});

test('coppie spot: la copertura spot e\' SEMPRE incompleta, con nota e avviso espliciti sulle coppie ritirate; asset ritirato dal listino non viene interrogato', async () => {
  const t = at('2024-05-01T10:00:00Z');
  const r = await runSync({ balances: BAL, deposits: [dep(1, t, { coin: 'LUNC' })] });
  const spot = r.out.coverage.find((c) => /spot/i.test(c.what));
  assert.equal(spot.complete, false);
  assert.match(spot.note, /ritirat/); assert.match(spot.note, /file/);
  assert.ok(r.out.warnings.some((w) => /Binance non dice con quali coppie/.test(w) && /ritirate/.test(w)));
  assert.ok(!callsTo(r.srv, '/api/v3/myTrades').some((e) => /LUNC/.test(e.q.symbol)));
});

test('copertura: ogni prodotto non scaricato e\' dichiarato incompleto con nota; quelli scaricati hanno conteggi e date', async () => {
  const r = await runSync({ balances: BAL, deposits: [dep(1, at('2024-05-01T10:00:00Z')), dep(2, at('2025-05-01T10:00:00Z'))], withdrawals: [wd(1, at('2024-06-01T10:00:00Z'))], convert: [conv(1, at('2024-07-01T10:00:00Z'))], dividends: [div(1, at('2024-08-01T10:00:00Z'))] });
  const cov = r.out.coverage;
  for (const c of cov) { assert.equal(typeof c.what, 'string'); assert.equal(typeof c.complete, 'boolean'); if (c.complete === false) assert.ok(c.note && c.note.length > 20, c.what); }
  const dp = cov.find((c) => c.what === 'Depositi di cripto');
  assert.deepEqual([dp.count, dp.from, dp.to, dp.complete], [2, '2024-05-01T10:00:00.000Z', '2025-05-01T10:00:00.000Z', false]);   // false: profondita' dello storico non dichiarata
  assert.match(dp.note, /non dichiara per quanto tempo conserva lo storico/);
  assert.equal(cov.find((c) => /Prelievi/.test(c.what)).count, 1);
  assert.equal(cov.find((c) => /Convert/.test(c.what)).count, 1);
  assert.equal(cov.find((c) => /Dividendi/.test(c.what)).count, 1);
  for (const what of [/Earn/, /Staking|Launchpool/, /Margine/, /Futures/, /P2P/, /Pay/, /Auto-Invest/, /euro/, /Convert Transfer/, /Dual Investment/]) {
    const c = cov.find((x) => what.test(x.what));
    assert.ok(c, String(what)); assert.equal(c.complete, false);
  }
  // nessuna fonte con storico e' dichiarata completa: Binance non dichiara quanto indietro lo conserva
  for (const what of [/Depositi di cripto/, /Prelievi/, /Binance Convert/, /Dividendi/, /piccoli saldi/, /carta o bonifico/, /spot/]) assert.equal(cov.find((x) => what.test(x.what)).complete, false, String(what));
  const ct = cov.find((x) => /Convert Transfer/.test(x.what));
  assert.match(ct.note, /stablecoin/); assert.match(ct.note, /BUSD/); assert.match(ct.note, /file/);
  assert.match(cov.find((x) => /Dual Investment/.test(x.what)).note, /gift card/);
  assert.match(cov.find((x) => /Dual Investment/.test(x.what)).what, /BLVT/);
  assert.doesNotMatch(cov.find((x) => /P2P/.test(x.what)).note, /non offre/, 'il P2P esiste: la nota non deve dire il contrario');
  assert.match(cov.find((x) => /P2P/.test(x.what)).note, /storico/);
  assert.doesNotMatch(cov.find((x) => /euro/.test(x.what)).note, /meno di 3/);
  assert.match(cov.find((x) => /euro/.test(x.what)).note, /da 2 a 4 richieste al minuto/);
  assert.ok(X.limits.join(' ').match(/Convert Transfer/) && X.limits.join(' ').match(/Dual Investment/) && X.limits.join(' ').match(/gift card/) && X.limits.join(' ').match(/BLVT/));
});

// ---------------------------------------------------------------- limiti di frequenza e errori
test('frequenza: le pause calcolate dai limiti di exchangeInfo bastano (mai 429 con 60 coppie e limite stretto di 1200 al minuto)', async () => {
  const symbols = DEFAULT_SYMBOLS.slice();
  for (let i = 0; i < 60; i++) symbols.push({ symbol: `COIN${i}EUR`, status: 'TRADING', baseAsset: `COIN${i}`, quoteAsset: 'EUR' });
  const r = await runSync({ balances: BAL, symbols, ipLimit: 1200 });
  assert.equal(r.srv.limited, 0);
  assert.ok(callsTo(r.srv, '/api/v3/myTrades').length >= 64);
  assert.ok(r.clock.slept.filter((w) => w >= 2000).length >= 60, 'con 1200 al minuto serve un myTrades ogni 2 s');
});

test('frequenza: 429 con Retry-After viene atteso (secondi del server) e riprovato con una firma NUOVA; dopo un 429 la pausa di quel tipo di richiesta aumenta', async () => {
  const state = { balances: BAL, faults: [{ when: (e) => e.path === '/sapi/v1/capital/withdraw/history', times: 2, reply: () => res(429, { code: -1003, msg: 'Too many requests' }, { 'retry-after': '7' }) }] };
  const r = await runSync(state, { options: { startDate: '2026-01-01' } });
  const calls = callsTo(r.srv, '/sapi/v1/capital/withdraw/history');
  assert.ok(r.clock.slept.filter((w) => w === 7000).length === 2, 'attese esattamente quanto dice Retry-After');
  assert.equal(calls[0].q.startTime, calls[1].q.startTime);
  assert.notEqual(calls[0].q.signature, calls[1].q.signature, 'firma rifatta');
  assert.ok(Number(calls[2].q.timestamp) > Number(calls[0].q.timestamp));
  assert.ok(r.out.raw);
  assert.ok(r.clock.slept.filter((w) => w >= 800).length >= 1, 'pausa raddoppiata dopo il 429');
});

test('frequenza: 5xx transitori si ripetono; 429 persistente dopo i tentativi -> errore "rate" e nessun dato parziale; Retry-After enorme (ban 418) -> si ferma subito', async () => {
  const flaky = await runSync({ balances: BAL, faults: [{ when: (e) => e.path === '/api/v3/account', times: 2, reply: () => res(503, 'Service Unavailable') }] });
  assert.ok(flaky.out.raw.account.balances.length === 2);
  const e429 = await syncError({ balances: BAL, faults: [{ when: (e) => e.path === '/sapi/v1/convert/tradeFlow', times: 999, reply: () => res(429, { code: -1003 }, { 'retry-after': '3' }) }] });
  assert.equal(e429.code, 'rate'); noSecrets(e429.message); noSecrets(e429.detail);
  const s = setup({ balances: BAL, faults: [{ when: (e) => e.path === '/api/v3/account', times: 999, reply: () => res(418, { code: -1003 }, { 'retry-after': '7200' }) }] });
  const e418 = await X.sync({ apiKey: KEY, apiSecret: SECRET }, s.opts).catch((x) => x);
  assert.equal(e418.code, 'rate'); assert.match(e418.message, /120 minuti/);
  assert.ok(s.clock.slept.every((w) => w < 7200000), 'non si aspettano due ore');
  const e5 = await syncError({ balances: BAL, faults: [{ when: (e) => e.path === '/sapi/v1/asset/assetDividend', times: 999, reply: () => res(500, 'boom') }] });
  assert.equal(e5.code, 'http');
});

test('errori: rete assente, chiavi rifiutate (401), 403 WAF, firma non valida, orologio fuori margine, errori 4xx della piattaforma; nessun segreto nei messaggi', async () => {
  let e = await syncError({ down: true });
  assert.equal(e.code, 'network'); assert.match(e.message, /Collegamento non riuscito/);
  e = await syncError({ balances: BAL, key: 'ALTRA-CHIAVE-0123456789' });
  assert.equal(e.code, 'auth'); noSecrets(e.message); noSecrets(e.detail);
  e = await syncError({ balances: BAL, secret: 'ALTRO-SEGRETO-0123456789' });
  assert.equal(e.code, 'auth'); assert.match(e.message, /firma/i); noSecrets(e.message);
  e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/account', times: 1, reply: () => res(403, '<html>WAF</html>') }] });
  assert.equal(e.code, 'auth'); assert.match(e.message, /403/);
  e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/account', times: 99, reply: () => res(400, { code: -1021, msg: `Timestamp for this request is outside of the recvWindow. ${KEY}` }) }] });
  assert.equal(e.code, 'config'); assert.match(e.message, /orologio/); noSecrets(e.message); noSecrets(e.detail);
  e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/account', times: 1, reply: () => res(400, { code: -1100, msg: 'Illegal characters' }) }] });
  assert.equal(e.code, 'http'); noSecrets(e.detail);
  e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/myTrades', times: 1, reply: () => res(400, { code: -1121, msg: 'Invalid symbol.' }) }] });
  assert.equal(e.code, 'http');
});

test('errori a meta\' scaricamento: la sincronizzazione si ferma, non restituisce nulla di parziale', async () => {
  const t = at('2025-05-01T10:00:00Z');
  const s = setup({ balances: BAL, deposits: [dep(1, t)], faults: [{ when: (e) => e.path === '/sapi/v1/convert/tradeFlow' && Number(e.q.startTime) > t, times: 99, reply: () => res(401, { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }) }] });
  let got = null, err = null;
  try { got = await X.sync({ apiKey: KEY, apiSecret: SECRET }, s.opts); } catch (e) { err = e; }
  assert.equal(got, null); assert.equal(err.code, 'auth');
});

test('formato: risposte diverse dalla documentazione -> errore "format" (nessuna ipotesi)', async () => {
  const cases = {
    '/api/v3/time': [{ nope: 1 }, { serverTime: 'ieri' }, '<html>maintenance</html>'],
    '/api/v3/exchangeInfo': [{ timezone: 'UTC' }, { symbols: [{ symbol: 'X' }] }, { symbols: 'no' }],
    '/api/v3/account': [{ balances: 'no' }, { balances: [{ asset: 'BTC', free: 'abc', locked: '0' }] }, []],
    '/sapi/v1/capital/deposit/hisrec': [{ rows: [] }, [{ amount: '1', coin: 'BTC' }], 'non json'],
    '/sapi/v1/capital/withdraw/history': [{ rows: [] }, [{ amount: '1' }]],
    '/sapi/v1/convert/tradeFlow': [{ list: [] }, { moreData: false }, { list: 'no', moreData: false }],
    '/sapi/v1/asset/assetDividend': [[], { total: 0 }, { rows: 'no' }],
    '/sapi/v1/asset/dribblet': [{ total: 0 }, { userAssetDribblets: [5] }, { userAssetDribblets: [{ transId: 1, userAssetDribbletDetails: 'no' }] }],
    '/sapi/v1/fiat/payments': [[], { code: '000000', data: 'no' }, { code: '000000', data: [{ sourceAmount: '1' }] }],
  };
  for (const [path, bodies] of Object.entries(cases)) {
    for (const body of bodies) {
      const e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === path, times: 1, reply: () => res(200, body) }] });
      assert.equal(e.code, 'format', `${path} ${JSON.stringify(body)} -> ${e.code}`);
      assert.match(e.message, /Binance|formato/);
      noSecrets(e.message); noSecrets(e.detail);
    }
  }
});

test('formato: fiat/payments con success:false o codice diverso da 000000 -> errore "http" della piattaforma (non un elenco vuoto)', async () => {
  const e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/sapi/v1/fiat/payments', times: 1, reply: () => res(200, { code: '400002', message: 'Fiat service not activated', data: null, success: false }) }] });
  assert.equal(e.code, 'http');
  const ok = await runSync({ balances: BAL, faults: [{ when: (x) => x.path === '/sapi/v1/fiat/payments', times: 99, reply: () => res(200, { code: '000000', message: 'success', data: null, total: 0, success: true }) }] });
  assert.deepEqual(ok.out.raw.fiatPayments, { buy: [], sell: [] });
});

test('credenziali e opzioni non valide: errore "config" prima di qualsiasi richiesta', async () => {
  const bad = async (creds, options, re) => {
    const s = setup({ balances: BAL }, { options });
    const e = await X.sync(creds, s.opts).catch((x) => x);
    assert.ok(e instanceof C.ApiError && e.code === 'config', JSON.stringify(options) + ' ' + e.message);
    if (re) assert.match(e.message, re);
    assert.equal(s.srv.log.length, 0, 'nessuna richiesta');
  };
  await bad({}, {}, /chiave/i);
  await bad({ apiKey: KEY }, {});
  await bad({ apiKey: '  ', apiSecret: SECRET }, {});
  await bad({ apiKey: KEY, apiSecret: SECRET }, { startDate: '15/03/2019' }, /aaaa-mm-gg/);
  await bad({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2019-02-30' });
  await bad({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2016-12-31' }, /2017/);
  await bad({ apiKey: KEY, apiSecret: SECRET }, { startDate: '2026-12-31' }, /futuro/);
  await bad({ apiKey: KEY, apiSecret: SECRET }, { quotes: 'EUR,US DT!' }, /quotazione/);
  await bad({ apiKey: KEY, apiSecret: SECRET }, { extraSymbols: 'BT' }, /Coppia non valida/);
  await bad({ apiKey: KEY, apiSecret: SECRET }, { withdrawFee: 'forse' }, /sì/);
});

test('raw, avvisi, copertura, avanzamento: nessuna credenziale, JSON serializzabile, importi come stringhe esatte, errori dell\'interfaccia ignorati', async () => {
  const t = at('2025-03-01T10:00:00Z');
  const state = {
    balances: BAL,
    deposits: [dep(1, t, { amount: '0.00100000' })],
    withdrawals: [wd(1, t, { amount: '1234.56789012', transactionFee: '0.00000001' })],
    trades: { BTCEUR: [trade('BTCEUR', 5, t, { qty: '0.00012345', quoteQty: '7.40700000', commission: '0.00000001' })] },
  };
  const s = setup(state);
  s.opts.onProgress = (m) => { s.progress.push(m); throw new Error('errore dell\'interfaccia'); };
  const out = await X.sync({ apiKey: KEY, apiSecret: SECRET }, s.opts);
  assert.deepEqual(JSON.parse(JSON.stringify(out.raw)), out.raw);
  assert.equal(out.raw.version, 1); assert.equal(out.raw.fetchedAt, iso(NOW));
  noSecrets(out.raw); noSecrets(out.coverage); noSecrets(out.warnings); noSecrets(s.progress);
  assert.equal(out.raw.deposits[0].amount, '0.00100000');
  assert.equal(out.raw.withdrawals[0].amount, '1234.56789012'); assert.equal(out.raw.withdrawals[0].transactionFee, '0.00000001');
  assert.equal(out.raw.spotTrades.BTCEUR[0].qty, '0.00012345');
  assert.ok(s.progress.length > 10 && s.progress.every((m) => typeof m === 'string' && /[a-zà-ù]/.test(m)));
  assert.ok(s.progress.some((m) => /Depositi/.test(m)) && s.progress.some((m) => /spot/.test(m)));
  assert.ok(out.warnings.every((w) => typeof w === 'string'));
});

test('raw: l\'ordine delle righe del server non conta (due scarichi con ordine opposto danno lo stesso raw)', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const mk = (reverse) => ({ balances: BAL, reverse, deposits: Array.from({ length: 30 }, (_, i) => dep(i, base + i * 3600000)), convert: Array.from({ length: 20 }, (_, i) => conv(i, base + i * 7200000)), dividends: Array.from({ length: 10 }, (_, i) => div(i, base + i * 9000000)), payBuy: Array.from({ length: 12 }, (_, i) => pay(i, base + i * 5000000)) });
  const a = await runSync(mk(false), { options: { startDate: '2025-02-01' } });
  const b = await runSync(mk(true), { options: { startDate: '2025-02-01' } });
  assert.deepEqual(a.out.raw, b.out.raw);
});

test('avviso: acquisto con carta con un acquisto spot di pari quantita\' entro 10 minuti = possibile doppione segnalato (nulla viene scartato dal raw); quantita\' o orari diversi, o vendite: nessun avviso', async () => {
  const t = at('2025-03-01T10:00:00Z');
  const mk = (tr) => ({ balances: BAL, payBuy: [pay(1, t)], trades: { BTCEUR: tr } });
  const same = await runSync(mk([trade('BTCEUR', 1, t + 2 * MIN, { qty: '0.02500000', quoteQty: '1000' })]), { options: { startDate: '2025-02-01' } });
  assert.ok(same.out.warnings.some((w) => /1 acquisto con carta/.test(w) && /da controllare/.test(w)));
  assert.equal(same.out.raw.spotTrades.BTCEUR.length, 1); assert.equal(same.out.raw.fiatPayments.buy.length, 1);
  for (const tr of [trade('BTCEUR', 2, t + 2 * MIN, { qty: '0.02600000' }), trade('BTCEUR', 3, t + 11 * MIN, { qty: '0.025' }), trade('BTCEUR', 4, t + MIN, { qty: '0.025', isBuyer: false })]) {
    const r = await runSync(mk([tr]), { options: { startDate: '2025-02-01' } });
    assert.ok(!r.out.warnings.some((w) => /1 acquisto con carta/.test(w)), JSON.stringify(tr));
  }
});

test('avvisi: depositi e prelievi non conclusi, vendite con carta, conversioni di piccoli saldi, campo direction, asset LD (Earn)', async () => {
  const t = at('2025-03-01T10:00:00Z');
  const r = await runSync({
    balances: [...BAL, { asset: 'LDUSDT', free: '5', locked: '0' }],
    deposits: [dep(1, t, { status: 0 }), dep(2, t + 1, { status: 8 })],
    withdrawals: [wd(1, t, { status: 4 })],
    dust: [dustRec(1, t)],
    dividends: [div(1, t, { direction: 1 })],
    paySell: [pay(1, t, { orderNo: 's1' })],
  });
  const w = r.out.warnings.join('\n');
  assert.match(w, /2 depositi non sono ancora completati/);
  assert.match(w, /1 prelievo non ancora completato/);
  assert.match(w, /vendite verso carta/);
  assert.match(w, /piccoli saldi/);
  assert.match(w, /direction/);
  assert.match(w, /LD/);
  assert.match(w, /commissione di rete/);
});

// ---------------------------------------------------------------- parse: dai dati grezzi agli eventi
const SYMS = [['BTCEUR', 'BTC', 'EUR'], ['ETHBTC', 'ETH', 'BTC'], ['EURUSDT', 'EUR', 'USDT'], ['BTCUSDT', 'BTC', 'USDT'], ['ETHUSDT', 'ETH', 'USDT'], ['BTCUSD', 'BTC', 'USD']]
  .map(([symbol, baseAsset, quoteAsset]) => ({ symbol, baseAsset, quoteAsset, status: 'TRADING' }));
const rawOf = (o = {}) => ({ version: 1, fetchedAt: '2026-10-05T10:00:00.000Z', options: { withdrawFeeIncluded: false }, symbols: SYMS, spotTrades: {}, deposits: [], withdrawals: [], convert: [], dividends: [], dust: [], fiatPayments: { buy: [], sell: [] }, ...o });
const parse = (o) => X.parse(rawOf(o), 'binance-api');
const T0 = at('2024-03-01T12:00:00Z');
const one = (r) => { assert.equal(r.events.length, 1, JSON.stringify(r.events.map((e) => [e.kind, e.note]))); return r.events[0]; };

test('parse spot: coppia con quota fiat -> BUY / SELL con valore in EUR e commissione separata, importi decimali esatti', () => {
  const b = one(parse({ spotTrades: { BTCEUR: [trade('BTCEUR', 11, T0, { qty: '0.00123456', quoteQty: '37.03680000', commission: '0.00000123', commissionAsset: 'BTC' })] } }));
  assert.equal(b.kind, Kind.BUY); assert.equal(b.asset, 'BTC'); eq(b.qty, '0.00123456'); eq(b.value, '37.0368'); assert.equal(b.valueCcy, 'EUR');
  assert.equal(b.feeAsset, 'BTC'); eq(b.feeQty, '0.00000123');
  assert.equal(b.uid, 'api:binance:trade:BTCEUR:11'); assert.equal(b.account, 'Binance'); assert.equal(b.ts.toISOString(), '2024-03-01T12:00:00.000Z');
  assert.equal(b.ref, '900011');
  const s = one(parse({ spotTrades: { BTCEUR: [trade('BTCEUR', 12, T0, { isBuyer: false, qty: '0.04', quoteQty: '2000.00', commission: '2.00', commissionAsset: 'EUR' })] } }));
  assert.equal(s.kind, Kind.SELL); assert.equal(s.asset, 'BTC'); eq(s.qty, '0.04'); eq(s.value, '2000'); assert.equal(s.feeAsset, 'EUR'); eq(s.feeQty, '2');
  const z = one(parse({ spotTrades: { BTCEUR: [trade('BTCEUR', 13, T0, { commission: '0.00000000' })] } }));
  assert.equal(z.feeAsset, ''); eq(z.feeQty, 0);
});

test('parse spot: quota non fiat (USDT, BTC) -> SWAP nei due versi, valore non indicato (lo ricava il motore); commissione in BNB', () => {
  const buy = one(parse({ spotTrades: { ETHBTC: [trade('ETHBTC', 1, T0, { qty: '2.00000000', quoteQty: '0.10000000', commission: '0.001', commissionAsset: 'BNB' })] } }));
  assert.equal(buy.kind, Kind.SWAP); assert.equal(buy.asset, 'BTC'); eq(buy.qty, '0.1'); assert.equal(buy.counterAsset, 'ETH'); eq(buy.counterQty, '2'); assert.equal(buy.value, null);
  assert.equal(buy.feeAsset, 'BNB'); eq(buy.feeQty, '0.001');
  const sell = one(parse({ spotTrades: { ETHBTC: [trade('ETHBTC', 2, T0, { isBuyer: false, qty: '2.00000000', quoteQty: '0.10000000' })] } }));
  assert.equal(sell.kind, Kind.SWAP); assert.equal(sell.asset, 'ETH'); eq(sell.qty, '2'); assert.equal(sell.counterAsset, 'BTC'); eq(sell.counterQty, '0.1');
});

test('parse spot: base fiat (EURUSDT) -> acquisto o vendita di USDT con valore in EUR; quota in altra valuta (USD) tiene la valuta', () => {
  const sellEur = one(parse({ spotTrades: { EURUSDT: [trade('EURUSDT', 1, T0, { isBuyer: false, qty: '100.00000000', quoteQty: '108.00000000' })] } }));
  assert.equal(sellEur.kind, Kind.BUY); assert.equal(sellEur.asset, 'USDT'); eq(sellEur.qty, '108'); eq(sellEur.value, '100'); assert.equal(sellEur.valueCcy, 'EUR');
  const buyEur = one(parse({ spotTrades: { EURUSDT: [trade('EURUSDT', 2, T0, { isBuyer: true, qty: '100.00000000', quoteQty: '108.00000000' })] } }));
  assert.equal(buyEur.kind, Kind.SELL); assert.equal(buyEur.asset, 'USDT'); eq(buyEur.qty, '108'); eq(buyEur.value, '100');
  const usd = one(parse({ spotTrades: { BTCUSD: [trade('BTCUSD', 3, T0, { qty: '1', quoteQty: '60000' })] } }));
  assert.equal(usd.kind, Kind.BUY); assert.equal(usd.valueCcy, 'USD');
});

test('parse spot: uid distinti per coppia e id; duplicati (finestre sovrapposte) contati una volta; ordine del raw irrilevante', () => {
  const a = trade('BTCEUR', 5, T0), b = trade('BTCUSDT', 5, T0);
  const r = parse({ spotTrades: { BTCEUR: [a, a, { ...a }], BTCUSDT: [b] } });
  assert.equal(r.events.length, 2); assert.equal(r.rows, 2);
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 2);
  const r2 = parse({ spotTrades: { BTCUSDT: [b], BTCEUR: [a] } });
  assert.deepEqual(r.events.map((e) => e.uid).sort(), r2.events.map((e) => e.uid).sort());
});

test('parse spot: dati mancanti o incoerenti, coppia sconosciuta, commissione negativa o senza valuta -> UNRESOLVED', () => {
  const bad = (t, symbol = 'BTCEUR') => { const r = parse({ spotTrades: { [symbol]: [t] } }); assert.equal(r.events.length, 1); assert.equal(r.events[0].kind, Kind.UNRESOLVED, JSON.stringify(t)); assert.ok(r.events[0].note); return r; };
  bad(trade('BTCEUR', 1, T0, { qty: '0' }));
  bad(trade('BTCEUR', 1, T0, { qty: 'abc' }));
  bad(trade('BTCEUR', 1, T0, { quoteQty: '-5' }));
  bad(trade('BTCEUR', 1, T0, { isBuyer: 'true' }));
  bad(trade('BTCEUR', 1, T0, { time: 'ieri' }));
  bad(trade('BTCEUR', 1, T0, { commission: '-1' }));
  bad(trade('BTCEUR', 1, T0, { commission: '0.5', commissionAsset: '' }));
  bad(trade('BTCEUR', 1, T0, { commission: undefined }));
  bad({ ...trade('BTCEUR', 1, T0), id: undefined });
  const r = bad(trade('XYZEUR', 1, T0, {}), 'XYZEUR');
  assert.equal(r.unknown.length, 1);
  assert.deepEqual(parse({ spotTrades: { BTCEUR: ['stringa'] } }).events.map((e) => e.kind), [Kind.UNRESOLVED]);
});

test('parse depositi: stato 1 e 6 -> TRANSFER_IN con importo netto; 2 -> INFO; 0, 7, 8 e sconosciuti -> UNRESOLVED; valuta fiat -> FIAT_IN', () => {
  const r = parse({ deposits: [dep(1, T0), dep(2, T0 + 1, { status: 6, amount: '3' }), dep(3, T0 + 2, { status: 2 }), dep(4, T0 + 3, { status: 0 }), dep(5, T0 + 4, { status: 7 }), dep(6, T0 + 5, { status: 8 }), dep(7, T0 + 6, { status: 99 }), dep(8, T0 + 7, { coin: 'EUR', amount: '250' })] });
  assert.deepEqual(kinds(r), [Kind.TRANSFER_IN, Kind.TRANSFER_IN, Kind.INFO, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.FIAT_IN]);
  const e = r.events;
  assert.equal(e[0].asset, 'BTC'); eq(e[0].qty, '0.5'); assert.equal(e[0].uid, 'api:binance:dep:d1'); assert.equal(e[0].ref, 'txd1'); assert.equal(e[0].account, 'Binance');
  eq(e[1].qty, '3'); assert.equal(e[7].asset, 'EUR');
  assert.equal(r.unknown.length, 4);
  assert.match(e[3].note, /non ancora completato/);
  assert.deepEqual(parse({ deposits: [dep(1, T0, { amount: '0' })] }).events.map((x) => x.kind), [Kind.UNRESOLVED]);
  assert.deepEqual(parse({ deposits: [dep(1, T0, { coin: '' })] }).events.map((x) => x.kind), [Kind.UNRESOLVED]);
  assert.deepEqual(parse({ deposits: [dep(1, T0, { status: undefined })] }).events.map((x) => x.kind), [Kind.UNRESOLVED]);
});

test('parse prelievi: stato 6 -> TRANSFER_OUT con quantita\' = importo + commissione di rete (opzione "gia\' compresa" = solo importo); stati 1, 3, 5 -> INFO; 0, 2, 4 e sconosciuti -> UNRESOLVED', () => {
  const rows = [wd(1, T0), wd(2, T0 + 1000, { status: 1 }), wd(3, T0 + 2000, { status: 3 }), wd(4, T0 + 3000, { status: 5 }), wd(5, T0 + 4000, { status: 0 }), wd(6, T0 + 5000, { status: 2 }), wd(7, T0 + 6000, { status: 4 }), wd(8, T0 + 7000, { status: 77 }), wd(9, T0 + 8000, { coin: 'EUR', amount: '100', transactionFee: '0' })];
  const r = parse({ withdrawals: rows });
  assert.deepEqual(kinds(r), [Kind.TRANSFER_OUT, Kind.INFO, Kind.INFO, Kind.INFO, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.FIAT_OUT]);
  eq(r.events[0].qty, '0.0201'); assert.equal(r.events[0].asset, 'BTC'); assert.equal(r.events[0].ts.toISOString(), '2024-03-01T12:00:00.000Z'); assert.equal(r.events[0].uid, 'api:binance:wd:w1');
  const incl = X.parse(rawOf({ withdrawals: [wd(1, T0)], options: { withdrawFeeIncluded: true } }), 'x');
  eq(incl.events[0].qty, '0.02');
  const nofee = parse({ withdrawals: [wd(1, T0, { transactionFee: undefined })] });
  eq(nofee.events[0].qty, '0.02');
  for (const bad of [{ amount: 'x' }, { transactionFee: '-1' }, { applyTime: 'domani' }, { coin: '' }, { status: undefined }]) assert.deepEqual(parse({ withdrawals: [wd(1, T0, bad)] }).events.map((x) => x.kind), [Kind.UNRESOLVED], JSON.stringify(bad));
});

test('parse prelievi e depositi: senza id si usa coin + txId + data + importo; stesso deposito due volte = uno solo; deposito e prelievo con lo stesso id restano distinti', () => {
  const d = { ...dep(1, T0), id: undefined };
  const r = parse({ deposits: [d, { ...d }, { ...dep(2, T0), id: 'x1' }], withdrawals: [{ ...wd(1, T0), id: 'x1' }] });
  assert.deepEqual(kinds(r), [Kind.TRANSFER_IN, Kind.TRANSFER_IN, Kind.TRANSFER_OUT]);
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 3);
  assert.equal(r.events[0].uid, `api:binance:dep:BTC|txd1|${T0}|0.50000000`);
  assert.deepEqual(r.events.slice(1).map((e) => e.uid), ['api:binance:dep:x1', 'api:binance:wd:x1']);
  assert.equal(r.rows, 3);
});

test('parse Convert: SUCCESS cripto->cripto = SWAP, fiat->cripto = BUY, cripto->fiat = SELL; FAIL = INFO; altri stati e dati mancanti = UNRESOLVED; orderId oltre 2^53 -> quoteId', () => {
  const r = parse({ convert: [conv(1, T0), conv(2, T0 + 1, { fromAsset: 'EUR', fromAmount: '500', toAsset: 'BTC', toAmount: '0.01' }), conv(3, T0 + 2, { fromAsset: 'BTC', fromAmount: '0.01', toAsset: 'EUR', toAmount: '600' }), conv(4, T0 + 3, { orderStatus: 'FAIL' }), conv(5, T0 + 4, { orderStatus: 'PROCESS' }), conv(6, T0 + 5, { orderStatus: 'ACCEPT_SUCCESS' }), conv(7, T0 + 6, { fromAmount: '0' }), conv(8, T0 + 7, { toAsset: '' })] });
  assert.deepEqual(kinds(r), [Kind.SWAP, Kind.BUY, Kind.SELL, Kind.INFO, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED]);
  const [sw, bu, se] = r.events;
  assert.equal(sw.asset, 'USDT'); eq(sw.qty, '100'); assert.equal(sw.counterAsset, 'BTC'); eq(sw.counterQty, '0.002'); assert.equal(sw.value, null); assert.equal(sw.uid, 'api:binance:convert:7000001');
  assert.equal(bu.asset, 'BTC'); eq(bu.qty, '0.01'); eq(bu.value, '500'); assert.equal(bu.valueCcy, 'EUR');
  assert.equal(se.asset, 'BTC'); eq(se.qty, '0.01'); eq(se.value, '600');
  const big = parse({ convert: [conv(9, T0, { orderId: 12345678901234567890 })] });
  assert.equal(big.events[0].uid, 'api:binance:convert:q' + 'q9');
  const strId = parse({ convert: [conv(9, T0, { orderId: '12345678901234567890' })] });
  assert.equal(strId.events[0].uid, 'api:binance:convert:12345678901234567890');
});

test('parse dividendi e premi: INCOME con asset e quantita\', tipo "other" e descrizione in nota; direction 1 accettato, altro -> UNRESOLVED; dati non validi -> UNRESOLVED', () => {
  const r = parse({ dividends: [div(1, T0, { amount: '12.34567890', asset: 'ADA', enInfo: 'Airdrop ADA' }), div(2, T0 + 1, { direction: 1 }), div(3, T0 + 2, { direction: 2 }), div(4, T0 + 3, { amount: '0' }), div(5, T0 + 4, { asset: '' }), div(6, T0 + 5, { divTime: 'x' }), { ...div(7, T0), id: undefined, tranId: undefined }] });
  assert.deepEqual(kinds(r), [Kind.INCOME, Kind.INCOME, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED]);
  const e = r.events[0];
  assert.equal(e.asset, 'ADA'); eq(e.qty, '12.3456789'); assert.equal(e.incomeType, 'other'); assert.match(e.note, /Airdrop ADA/); assert.equal(e.value, null); assert.equal(e.uid, 'api:binance:div:100001');
  assert.match(r.events[2].note, /direction/);
});

test('parse piccoli saldi (dribblet): ogni asset ceduto = SWAP verso BNB (o targetAsset) con l\'importo accreditato; registrazioni senza dettagli -> UNRESOLVED', () => {
  const rec = dustRec(1, T0, { userAssetDribbletDetails: [
    { transId: 801, serviceChargeAmount: '0.00002', amount: '0.5', operateTime: T0, transferedAmount: '0.00098', fromAsset: 'ADA' },
    { transId: 802, serviceChargeAmount: '0.00001', amount: '2', operateTime: T0 + 1000, transferedAmount: '0.00049', fromAsset: 'XRP', targetAsset: 'BNB' },
    { transId: 803, serviceChargeAmount: '0.1', amount: '3', operateTime: T0 + 2000, transferedAmount: '0.9', fromAsset: 'DOGE', targetAsset: 'USDT' },
  ] });
  const r = parse({ dust: [rec, dustRec(2, T0 + 5000, { userAssetDribbletDetails: [] }), { ...dustRec(3, T0), transId: undefined }, dustRec(4, T0, { userAssetDribbletDetails: [{ transId: 1, amount: '1', fromAsset: 'ADA' }] })] });
  assert.deepEqual(kinds(r), [Kind.SWAP, Kind.SWAP, Kind.SWAP, Kind.UNRESOLVED, Kind.UNRESOLVED, Kind.UNRESOLVED]);
  const [a, b, c] = r.events;
  assert.equal(a.asset, 'ADA'); eq(a.qty, '0.5'); assert.equal(a.counterAsset, 'BNB'); eq(a.counterQty, '0.00098'); assert.equal(a.value, null);
  assert.equal(b.asset, 'XRP'); assert.equal(c.counterAsset, 'USDT');
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 6);
});

test('parse acquisti con carta: BUY con importo pagato (commissione compresa, verificata dal prezzo); fallito o rimborsato -> INFO; in corso o stato ignoto -> UNRESOLVED', () => {
  const r = parse({ fiatPayments: { buy: [
    pay(1, T0),                                                                                    // 1010 pagati, 10 di commissione: (1010-10)/0.025 = 40000 = prezzo
    pay(2, T0 + 1, { sourceAmount: '20.0', obtainAmount: '4.462', cryptoCurrency: 'LUNA', totalFee: '0.2', price: '4.437472' }),   // esempio dei riassunti della documentazione (NON verificato sulla fonte)
    pay(3, T0 + 2, { totalFee: '0', price: '40400.000000' }),                                       // senza commissione
    pay(4, T0 + 3, { status: 'Failed' }), pay(5, T0 + 4, { status: 'Refunded' }),
    pay(6, T0 + 5, { status: 'Processing' }), pay(7, T0 + 6, { status: 'Boh' }),
  ], sell: [] } });
  assert.deepEqual(kinds(r), [Kind.BUY, Kind.BUY, Kind.BUY, Kind.INFO, Kind.INFO, Kind.UNRESOLVED, Kind.UNRESOLVED]);
  const [a, b, c] = r.events;
  assert.equal(a.asset, 'BTC'); eq(a.qty, '0.025'); eq(a.value, '1010'); assert.equal(a.valueCcy, 'EUR'); assert.equal(a.feeAsset, ''); eq(a.feeQty, 0); assert.equal(a.uid, 'api:binance:pay:o1'); assert.match(a.note, /Credit Card/);
  assert.equal(b.asset, 'LUNA'); eq(b.value, '20'); eq(b.qty, '4.462');
  eq(c.value, '1010');
});

test('parse acquisti con carta: se il prezzo non conferma che la commissione e\' compresa (o manca) -> UNRESOLVED; dati non validi; asset fiat; USD tiene la valuta', () => {
  const k = (o) => parse({ fiatPayments: { buy: [pay(1, T0, o)], sell: [] } }).events[0];
  assert.equal(k({ price: '40400.000000' }).kind, Kind.UNRESOLVED, 'prezzo lordo = commissione non dimostrata compresa');
  assert.equal(k({ price: '41000.000000' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ price: undefined }).kind, Kind.UNRESOLVED);
  assert.equal(k({ price: '0' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ totalFee: undefined }).kind, Kind.UNRESOLVED);
  assert.equal(k({ totalFee: '-1' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ sourceAmount: '0' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ obtainAmount: 'x' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ cryptoCurrency: '' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ cryptoCurrency: 'EUR' }).kind, Kind.UNRESOLVED);
  assert.equal(k({ createTime: 'x' }).kind, Kind.UNRESOLVED);
  assert.match(k({ price: '40400.000000' }).note, /commissione/);
  const usd = k({ fiatCurrency: 'USD' });
  assert.equal(usd.kind, Kind.BUY); assert.equal(usd.valueCcy, 'USD');
  assert.equal(k({ totalFee: '0.000000', price: '40000.000000', sourceAmount: '1000.00' }).kind, Kind.BUY);
});

test('parse vendite verso carta o bonifico: campi non documentati -> sempre UNRESOLVED (tranne quelle fallite = INFO)', () => {
  const r = parse({ fiatPayments: { buy: [], sell: [pay(1, T0), pay(2, T0 + 1, { status: 'Failed' })] } });
  assert.deepEqual(kinds(r), [Kind.UNRESOLVED, Kind.INFO]);
  assert.match(r.events[0].note, /file/);
});

test('parse: struttura non valida -> errore con messaggio chiaro; fileName e etichetta; risultato deterministico e indipendente dal JSON', () => {
  assert.throws(() => X.parse(null), /Binance/);
  assert.throws(() => X.parse({ version: 2 }), /versione/);
  assert.throws(() => X.parse({ ...rawOf(), deposits: 'no' }), /deposits/);
  assert.throws(() => X.parse({ ...rawOf(), spotTrades: [] }), /spotTrades/);
  assert.throws(() => X.parse({ ...rawOf(), convert: {} }), /convert/);
  const raw = rawOf({ spotTrades: { BTCEUR: [trade('BTCEUR', 1, T0)] }, deposits: [dep(1, T0)], withdrawals: [wd(1, T0)], convert: [conv(1, T0)], dividends: [div(1, T0)], dust: [dustRec(1, T0)], fiatPayments: { buy: [pay(1, T0)], sell: [] } });
  const a = X.parse(raw, 'f1'), b = X.parse(JSON.parse(JSON.stringify(raw)), 'f2');
  assert.equal(a.label, 'Binance · dati da API'); assert.equal(a.rows, 7);
  assert.deepEqual(a.events.map((e) => [e.uid, e.kind, e.asset, e.qty.toFixed(), e.ts.getTime()]), b.events.map((e) => [e.uid, e.kind, e.asset, e.qty.toFixed(), e.ts.getTime()]));
  assert.equal(new Set(a.events.map((e) => e.uid)).size, a.events.length);
  assert.ok(a.events.every((e) => e.account === 'Binance' && e.uid.startsWith('api:binance:') && e.ts instanceof Date));
  assert.ok(a.events[0].src.startsWith('f1'));
  const empty = X.parse(rawOf(), 'x');
  assert.deepEqual(empty.events, []); assert.equal(empty.rows, 0);
  // il registro dei tipi (usato dall'interfaccia) legge il testo JSON e dà lo stesso risultato
  assert.equal(I.TYPES.api_binance.parse(JSON.stringify(raw), 'f3').events.length, a.events.length);
});

// ---------------------------------------------------------------- prove complete: sync -> parse -> motore
test('prova completa: acquisto con carta, acquisto e vendita spot con commissioni in EUR, premio, prelievo verso un altro conto -> plusvalenza e costi calcolati a mano', async () => {
  const t = (s) => at(s);
  const state = {
    balances: [{ asset: 'BTC', free: '0.0651', locked: '0' }],
    payBuy: [pay(1, t('2024-01-15T12:00:00Z'))],                                                                  // 1010 EUR (commissione 10 compresa) -> 0,025 BTC
    trades: { BTCEUR: [
      trade('BTCEUR', 11, t('2024-02-01T12:00:00Z'), { qty: '0.10000000', price: '30000.00000000', quoteQty: '3000.00000000', commission: '3.00000000', commissionAsset: 'EUR' }),
      trade('BTCEUR', 12, t('2024-03-01T12:00:00Z'), { isBuyer: false, qty: '0.04000000', price: '50000.00000000', quoteQty: '2000.00000000', commission: '2.00000000', commissionAsset: 'EUR' }),
    ] },
    dividends: [div(1, t('2024-03-01T13:00:00Z'), { amount: '0.00020000', asset: 'BTC', enInfo: 'BTC distribution' })],
    withdrawals: [wd(1, t('2024-03-20T12:00:00Z'), { amount: '0.02000000', transactionFee: '0.00010000' })],
  };
  const r = await runSync(state);
  assert.equal(r.srv.limited, 0);
  const parsed = X.parse(JSON.parse(JSON.stringify(r.out.raw)), 'binance.json');
  assert.deepEqual(parsed.unknown, []);
  assert.deepEqual(kinds(parsed).sort(), [Kind.BUY, Kind.BUY, Kind.INCOME, Kind.SELL, Kind.TRANSFER_OUT].sort());
  // l'arrivo sul conto proprio (Ledger): 0,02 BTC, ricavato dall'uscita meno la commissione di rete
  const arrival = ev(Kind.TRANSFER_IN, T(2024, 3, 20, 13), 'BTC', '0.02', { account: 'Ledger' });
  const prices = new CT.PriceBook(); prices.setManual('BTC', '2024-03-20', '60000');
  const { engine } = run([...parsed.events, arrival], { prices }, { toYear: 2024 });
  assert.deepEqual(blocking(engine).map((i) => i.code + ':' + i.message), []);
  const sale = engine.disposals.find((d) => d.kind === 'sell');
  eq(sale.proceeds, '1998'); eq(sale.fee, '2');          // 2000 - 2 di commissione
  eq(sale.cost, '1201.2');                                // LIFO: 0,04 BTC dal lotto del 1/2 (3000 + 3 di commissione = 30030 per BTC)
  eq(sale.gain, '796.8');
  assert.equal(engine.incomes.length, 1);
  eq(engine.incomes[0].value, '10');                      // 0,0002 BTC al prezzo del giorno (50000, dedotto dalla vendita)
  const fee = engine.disposals.find((d) => d.kind === 'transfer_fee');
  eq(fee.qty, '0.0001'); eq(fee.proceeds, '6'); eq(fee.cost, '5'); eq(fee.gain, '1');   // commissione di rete = 0,0201 - 0,02; costo dal lotto del premio (50000)
  eq(engine.pool('BTC').balance, '0.0851');              // 0,025 + 0,1 - 0,04 + 0,0002 - 0,0001 (0,02 sono sul Ledger)
  assert.equal(engine.disposals.filter((d) => d.kind === 'sell' || d.kind === 'transfer_fee').length, 2);
});

test('prova completa: USDT comprati con EUR (EURUSDT) e poi scambiati con BTC (BTCUSDT) = permuta tassata al valore del giorno; i lotti ripartono dal valore', async () => {
  const state = {
    balances: [{ asset: 'BTC', free: '0.002', locked: '0' }],
    trades: {
      EURUSDT: [trade('EURUSDT', 1, at('2024-05-02T12:00:00Z'), { isBuyer: false, qty: '100.00000000', price: '1.08000000', quoteQty: '108.00000000', commission: '0', commissionAsset: 'EUR' })],
      BTCUSDT: [trade('BTCUSDT', 5, at('2024-05-02T14:00:00Z'), { qty: '0.00200000', price: '54000.00000000', quoteQty: '108.00000000', commission: '0', commissionAsset: 'BTC' })],
    },
  };
  const r = await runSync(state);                       // EURUSDT ha come base una valuta: si interroga anche senza saldo in EUR
  const parsed = X.parse(r.out.raw, 'b');
  assert.deepEqual(kinds(parsed).sort(), [Kind.BUY, Kind.SWAP]);
  const { engine } = run(parsed.events, {}, { toYear: 2024 });
  assert.deepEqual(blocking(engine).map((i) => i.code), []);
  const swap = engine.disposals.find((d) => d.kind === 'swap');
  assert.equal(swap.asset, 'USDT'); eq(swap.qty, '108');
  assert.equal(swap.proceeds.toFixed(6), '100.000000');   // 108 USDT a 100/108 EUR (prezzo dedotto dall'acquisto in EUR)
  assert.equal(swap.gain.toFixed(6), '0.000000');
  const lot = engine.pool('BTC').lots[0];
  eq(lot.qty, '0.002'); assert.equal(lot.unitCost.toFixed(6), '50000.000000');
  assert.equal(engine.pool('USDT').balance.toFixed(), '0');
});

test('prova completa: commissione in BNB senza lotti e senza prezzo -> il motore lo segnala (nessuna ipotesi); con BNB acquistato lo stesso giorno il calcolo torna', async () => {
  const btc = trade('BTCEUR', 1, at('2024-05-02T12:00:00Z'), { qty: '0.01', quoteQty: '500', commission: '0.01', commissionAsset: 'BNB' });
  const bnb = trade('BNBEUR', 1, at('2024-05-02T10:00:00Z'), { qty: '1', price: '300', quoteQty: '300', commission: '0', commissionAsset: 'BNB' });
  const first = run(X.parse((await runSync({ balances: BAL, trades: { BTCEUR: [btc] } })).out.raw, 'b').events, {}, { toYear: 2024 });
  assert.ok(codes(first.engine, 'block').includes('missing_price'), 'senza prezzo del BNB');
  assert.ok(codes(first.engine, 'block').includes('missing_history'), 'e senza BNB acquistato');
  const second = run(X.parse((await runSync({ balances: BAL, trades: { BTCEUR: [btc], BNBEUR: [bnb] } })).out.raw, 'b').events, {}, { toYear: 2024 });
  assert.deepEqual(blocking(second.engine).map((i) => i.code), []);
  const lot = second.engine.pool('BTC').lots[0];
  eq(lot.unitCost.times(lot.qty), '503');                // 500 + 0,01 BNB x 300 (prezzo dedotto dall'acquisto di BNB in EUR dello stesso giorno)
  const feeD = second.engine.disposals.find((d) => d.asset === 'BNB');
  eq(feeD.qty, '0.01'); eq(feeD.proceeds, '3'); eq(feeD.cost, '3'); eq(feeD.gain, '0');
  eq(second.engine.pool('BNB').balance, '0.99');
});

test('prova completa: un record sconosciuto nei dati scaricati blocca il risultato definitivo (UNRESOLVED -> problema "unrecognized_row")', async () => {
  const state = { balances: BAL, deposits: [dep(1, at('2024-05-02T12:00:00Z'), { status: 0 })] };
  const out = (await runSync(state)).out;
  const parsed = X.parse(out.raw, 'b');
  assert.equal(parsed.unknown.length, 1);
  const { engine } = run(parsed.events, {}, { toYear: 2024 });
  assert.ok(codes(engine, 'block').includes('unrecognized_row'));
});

// ================================================================ correzioni dopo la verifica: test di non regressione
// ---------------------------------------------------------------- bisezione: la riga a meta' finestra non si perde con nessuna semantica dei confini
for (const edge of ['inclusive', 'exclusive-end', 'exclusive-start', 'exclusive-both']) {
  test(`bisezione: una riga esattamente a meta' della finestra divisa (Convert, dividendi, piccoli saldi) non va persa (confini ${edge})`, async () => {
    const { makeWindows } = X._internal;
    const { WIN } = X._internal.constants;
    const probe = await runSync({ balances: BAL, edge }, { options: { startDate: '2025-02-01' } });
    const to = at(probe.out.raw.range.to), from = at('2025-02-01T00:00:00Z') - 1;
    const firstWin = (cfg) => makeWindows(from, to, cfg.len, cfg.overlap)[0];
    const midOf = (w) => Math.floor((w.s + w.e) / 2);
    const spread = (w, n, mk) => { const mid = midOf(w); const a = []; for (let i = 0; i < n; i++) a.push(mk(i, i % 2 ? mid + DAY + i * 1000 : w.s + DAY + i * 1000)); a.push(mk(n, mid)); return a; };
    const wc = firstWin(WIN.convert), wd = firstWin(WIN.dividend), wu = firstWin(WIN.dust);
    const state = {
      balances: BAL, edge,
      convert: spread(wc, 1199, conv),            // 1200 righe > 1000: finestra divisa
      dividends: spread(wd, 599, div),            // 600 righe > 500
      dust: spread(wu, 149, dustRec),             // 150 righe > 100
    };
    const r = await runSync(state, { options: { startDate: '2025-02-01' } });
    assert.equal(r.out.raw.convert.length, 1200, 'Convert');
    assert.ok(r.out.raw.convert.some((x) => x.createTime === midOf(wc)), 'Convert: la riga a meta\' c\'e\'');
    assert.equal(r.out.raw.dividends.length, 600, 'dividendi');
    assert.ok(r.out.raw.dividends.some((x) => x.divTime === midOf(wd)), 'dividendi: la riga a meta\' c\'e\'');
    assert.equal(r.out.raw.dust.length, 150, 'piccoli saldi');
    assert.ok(r.out.raw.dust.some((x) => x.operateTime === midOf(wu)), 'piccoli saldi: la riga a meta\' c\'e\'');
    // la bisezione e' stata davvero usata (piu' richieste che finestre)
    assert.ok(callsTo(r.srv, '/sapi/v1/convert/tradeFlow').length > makeWindows(from, to, WIN.convert.len, WIN.convert.overlap).length);
  });
}

test('bisezione: le due meta\' di una finestra divisa si sovrappongono di 1 ms per lato e nessuna finestra supera il massimo', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const r = await runSync({ balances: BAL, convert: Array.from({ length: 1100 }, (_, i) => conv(i, base + i * 1000)) }, { options: { startDate: '2025-02-01' } });
  const calls = callsTo(r.srv, '/sapi/v1/convert/tradeFlow').map((e) => [Number(e.q.startTime), Number(e.q.endTime)]);
  assert.ok(calls.every(([s, e]) => e > s && e - s <= 29 * DAY));
  // due meta' di una finestra divisa: la seconda inizia 1 ms PRIMA della fine della prima (mid+1 / mid-1)
  assert.ok(calls.some(([, e1]) => calls.some(([s2]) => e1 - s2 === 2)), 'le due meta\' si sovrappongono: [s, mid+1] e [mid-1, e]');
  assert.equal(r.out.raw.convert.length, 1100);
});

// ---------------------------------------------------------------- 418, 429 senza Retry-After, errori di rete
test('418 (ban dell\'IP): ci si ferma subito, senza insistere, con un messaggio di ban (anche senza Retry-After leggibile)', async () => {
  for (const headers of [undefined, { 'retry-after': '120' }]) {
    const s = setup({ balances: BAL, faults: [{ when: (e) => e.path === '/api/v3/account', times: 999, reply: () => res(418, { code: -1003, msg: 'Way too many requests; IP banned' }, headers) }] });
    const e = await X.sync({ apiKey: KEY, apiSecret: SECRET }, s.opts).catch((x) => x);
    assert.ok(e instanceof C.ApiError); assert.equal(e.code, 'rate');
    assert.match(e.message, /bloccato il tuo indirizzo IP/); assert.match(e.message, /418/);
    assert.match(e.message, headers ? /2 minuti/ : /da 2 minuti a 3 giorni/);
    assert.equal(callsTo(s.srv, '/api/v3/account').length, 1, 'una sola richiesta: niente martellamento');
    assert.ok(s.clock.slept.every((w) => w < 5000), 'nessuna attesa lunga: ci si ferma');
    noSecrets(e.message); noSecrets(e.detail);
  }
});

test('429 senza Retry-After leggibile (nel browser l\'intestazione non e\' visibile salvo Access-Control-Expose-Headers): si attende almeno 60 secondi (il peso si misura sul minuto)', async () => {
  const state = { balances: BAL, faults: [{ when: (e) => e.path === '/sapi/v1/capital/withdraw/history', times: 2, reply: () => res(429, { code: -1003, msg: 'Too many requests' }) }] };
  const r = await runSync(state, { options: { startDate: '2026-01-01' } });
  assert.equal(r.clock.slept.filter((w) => w === 60000).length, 2, 'due attese da 60 secondi');
  assert.ok(r.out.raw);
  // 429 persistente senza intestazione: errore "rate" dopo i tentativi, mai oltre il numero massimo di richieste
  const e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/account', times: 999, reply: () => res(429, { code: -1003 }) }] });
  assert.equal(e.code, 'rate');
});

test('errore di rete: se fallisce la PRIMA richiesta e\' blocco del browser o rete assente (errore subito, una sola richiesta); a meta\' scarico si ripete e lo scarico riesce', async () => {
  const s0 = setup({ down: true });
  let n0 = 0; const f0 = s0.opts.fetch; s0.opts.fetch = (...a) => { n0++; return f0(...a); };
  const e0 = await X.sync({ apiKey: KEY, apiSecret: SECRET }, s0.opts).catch((x) => x);
  assert.equal(e0.code, 'network'); assert.match(e0.message, /Collegamento non riuscito/); assert.equal(n0, 1); assert.deepEqual(s0.clock.slept, []);
  // un solo guasto transitorio dopo molte richieste: ripetuto, nessun errore
  const t = at('2024-05-01T10:00:00Z');
  const r = await runSync({ balances: BAL, trades: { BTCEUR: [trade('BTCEUR', 1, t)] }, faults: [{ when: (e) => e.path === '/api/v3/myTrades' && e.q.symbol === 'BTCEUR', times: 1, reply: () => { throw new TypeError('Failed to fetch'); } }] });
  assert.equal(r.out.raw.spotTrades.BTCEUR.length, 1);
  assert.equal(callsTo(r.srv, '/api/v3/myTrades').filter((e) => e.q.symbol === 'BTCEUR').length, 2, 'una richiesta fallita, una ripetuta');
  assert.ok(r.clock.slept.includes(2000), 'attesa prima della ripetizione');
  const [a, b] = callsTo(r.srv, '/api/v3/myTrades').filter((e) => e.q.symbol === 'BTCEUR');
  assert.notEqual(a.q.signature, b.q.signature, 'ripetizione rifirmata');
  assert.ok(Number(b.q.timestamp) > Number(a.q.timestamp), 'con un timestamp nuovo');
  // guasto persistente a meta' scarico: errore "network" dopo 3 ripetizioni, con un messaggio diverso (non parla del blocco dentro claude.ai)
  const e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/sapi/v1/asset/assetDividend', times: 999, reply: () => { throw new TypeError('Failed to fetch'); } }] });
  assert.equal(e.code, 'network'); assert.match(e.message, /interrotto durante lo scarico/); assert.doesNotMatch(e.message, /claude\.ai/);
  noSecrets(e.message); noSecrets(e.detail);
});

// ---------------------------------------------------------------- coppie indicate dall'utente fuori da exchangeInfo
test('extraSymbols fuori da exchangeInfo: si prova comunque; se Binance restituisce operazioni sono "non riconosciute" (senza elenco non si sa base e quota) e bloccano; altri errori si propagano', async () => {
  const t = at('2024-05-01T10:00:00Z');
  const ok = (symbol) => ({ when: (e) => e.path === '/api/v3/myTrades' && e.q.symbol === symbol, times: 99, reply: () => res(200, [trade(symbol, 7, t, { qty: '2', quoteQty: '10' })]) });
  const r = await runSync({ balances: BAL, faults: [ok('LUNAOLDBTC')] }, { options: { extraSymbols: 'LUNAOLDBTC' } });
  assert.deepEqual(r.out.raw.spotTrades.LUNAOLDBTC.map((x) => x.id), [7]);
  assert.ok(r.out.raw.queriedSymbols.includes('LUNAOLDBTC'));
  assert.ok(!r.out.raw.symbols.some((x) => x.symbol === 'LUNAOLDBTC'), 'nessuna valuta inventata');
  assert.ok(r.out.warnings.some((w) => /LUNAOLDBTC/.test(w) && /hanno restituito operazioni/.test(w) && /da controllare/.test(w)));
  const parsed = X.parse(r.out.raw, 'b');
  assert.equal(parsed.unknown.length, 1); assert.equal(parsed.events[0].kind, Kind.UNRESOLVED); assert.match(parsed.events[0].note, /LUNAOLDBTC/);
  const { engine } = run(parsed.events, {}, { toYear: 2024 });
  assert.ok(codes(engine, 'block').includes('unrecognized_row'));
  // un errore diverso da -1121 (qui un 400 con altro codice) non e' "coppia non valida": lo scarico si ferma
  const e = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/myTrades' && x.q.symbol === 'ZZZZBTC', times: 99, reply: () => res(400, { code: -1100, msg: 'Illegal characters' }) }] }, { options: { extraSymbols: 'ZZZZBTC' } });
  assert.equal(e.code, 'http');
  // una coppia ELENCATA che risponde -1121 e' un errore (non si nasconde): vale la scorciatoia solo per quelle scritte dall'utente e fuori elenco
  const e2 = await syncError({ balances: BAL, faults: [{ when: (x) => x.path === '/api/v3/myTrades' && x.q.symbol === 'BTCEUR', times: 99, reply: () => res(400, { code: -1121, msg: 'Invalid symbol.' }) }] });
  assert.equal(e2.code, 'http');
});

// ---------------------------------------------------------------- piccoli saldi: total, dettagli
test('piccoli saldi: il criterio "dettagli >= 100" divide la finestra anche con meno di 100 registrazioni (limite sui dettagli): nulla va perso', async () => {
  const base = at('2025-03-01T00:00:00Z');
  const two = (i, t) => dustRec(i, t, { userAssetDribbletDetails: [{ transId: 1000 + i, serviceChargeAmount: '0.00001', amount: '0.5', operateTime: t, transferedAmount: '0.0005', fromAsset: 'ADA' }, { transId: 2000 + i, serviceChargeAmount: '0.00001', amount: '1', operateTime: t, transferedAmount: '0.0004', fromAsset: 'XRP' }] });
  const dust = Array.from({ length: 60 }, (_, i) => two(i, base + i * 60000));   // 60 registrazioni (< 100) con 120 dettagli
  const r = await runSync({ balances: BAL, dust, dustDetailCap: 100 }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.dust.length, 60, 'tutte le registrazioni, anche quelle oltre i primi 100 dettagli');
  const cov = r.out.coverage.find((c) => /piccoli saldi/.test(c.what));
  assert.ok(!/ATTENZIONE/.test(cov.note), 'la finestra e\' stata ridotta: nessuna troncatura residua');
  assert.ok(!r.out.warnings.some((w) => /100 o più dettagli/.test(w)));
});

test('piccoli saldi: UNA registrazione con 100 o piu\' dettagli (finestra non riducibile) -> nessun errore, scarico accettato, copertura incompleta con avviso', async () => {
  const t = at('2025-03-01T10:00:00Z');
  const details = Array.from({ length: 150 }, (_, i) => ({ transId: 5000 + i, serviceChargeAmount: '0.00001', amount: '0.5', operateTime: t, transferedAmount: '0.0005', fromAsset: 'ADA' }));
  const r = await runSync({ balances: BAL, dust: [dustRec(1, t, { userAssetDribbletDetails: details })] }, { options: { startDate: '2025-02-01' } });
  assert.equal(r.out.raw.dust.length, 1); assert.equal(r.out.raw.dust[0].userAssetDribbletDetails.length, 150);
  const cov = r.out.coverage.find((c) => /piccoli saldi/.test(c.what));
  assert.equal(cov.complete, false); assert.match(cov.note, /ATTENZIONE/); assert.match(cov.note, /100 o più dettagli/);
  assert.ok(r.out.warnings.some((w) => /una singola registrazione contiene 100 o più dettagli/.test(w)));
  // 100 registrazioni nello stesso istante sono invece un errore (limite certo sulle registrazioni, non separabili)
  const e = await syncError({ balances: BAL, dust: Array.from({ length: 101 }, (_, i) => dustRec(i, t)) }, { options: { startDate: '2025-02-01' } });
  assert.equal(e.code, 'incomplete');
});

test('piccoli saldi: "total" (conteggio delle registrazioni esterne) maggiore delle ricevute su una pagina non piena -> copertura incompleta con avviso, senza dividere all\'infinito', async () => {
  const dustFaults = [{ when: (e) => e.path === '/sapi/v1/asset/dribblet', times: 9999, reply: () => res(200, { total: '57', userAssetDribblets: [] }) }];
  const r = await runSync({ balances: BAL, faults: dustFaults }, { options: { startDate: '2025-02-01' } });
  const cov = r.out.coverage.find((c) => /piccoli saldi/.test(c.what));
  assert.equal(cov.complete, false); assert.match(cov.note, /ATTENZIONE/); assert.match(cov.note, /più registrazioni di quelle consegnate/);
  assert.ok(r.out.warnings.some((w) => /Conversioni di piccoli saldi: Binance dichiara più registrazioni/.test(w)));
  const { makeWindows } = X._internal; const { WIN } = X._internal.constants;
  assert.equal(callsTo(r.srv, '/sapi/v1/asset/dribblet').length, makeWindows(at('2025-02-01T00:00:00Z') - 1, at(r.out.raw.range.to), WIN.dust.len, WIN.dust.overlap).length, 'una richiesta per finestra');
  // total numerico uguale alle righe: nessuna segnalazione
  const t = at('2025-03-01T10:00:00Z');
  const ok = await runSync({ balances: BAL, dust: [dustRec(1, t), dustRec(2, t + 1000)] }, { options: { startDate: '2025-02-01' } });
  assert.ok(!/ATTENZIONE/.test(ok.out.coverage.find((c) => /piccoli saldi/.test(c.what)).note));
  assert.ok(!ok.out.warnings.some((w) => /piccoli saldi: Binance dichiara/.test(w)));
});

// ---------------------------------------------------------------- Simple Earn (LD)
test('Simple Earn: un asset tenuto solo in Earn (saldo LDSOL) rende "visto" SOL: le sue coppie non in euro vengono interrogate e gli acquisti non spariscono', async () => {
  const t = at('2024-05-01T10:00:00Z');
  const sol = trade('SOLUSDT', 1, t, { qty: '2', quoteQty: '300', commission: '0.002', commissionAsset: 'SOL' });
  const r = await runSync({ balances: [{ asset: 'LDSOL', free: '2', locked: '0' }], trades: { SOLUSDT: [sol] } });
  assert.ok(r.out.raw.queriedSymbols.includes('SOLUSDT'));
  assert.ok(r.out.raw.queriedSymbols.includes('SOLFDUSD'), 'anche le altre coppie con quota ammessa');
  assert.deepEqual(r.out.raw.spotTrades.SOLUSDT.map((x) => x.id), [1]);
  assert.ok(r.out.warnings.some((w) => /LD/.test(w)), 'avviso sugli interessi di Earn resta');
  // senza il saldo in Earn, SOL non verrebbe cercato (e USDT da solo non lo rivela)
  const without = await runSync({ balances: BAL, trades: { SOLUSDT: [sol] } });
  assert.ok(!without.out.raw.queriedSymbols.includes('SOLUSDT'));
  // un prefisso LD senza coppia corrispondente non aggiunge nulla
  const other = await runSync({ balances: [...BAL, { asset: 'LDQQQ', free: '1', locked: '0' }] });
  assert.deepEqual(other.out.raw.queriedSymbols, without.out.raw.queriedSymbols);
});

// ---------------------------------------------------------------- operazioni spot precedenti a startDate
test('startDate: le operazioni spot precedenti restano nel raw (myTrades non si filtra) ma non sono conteggiate (INFO), con avviso e nota; le altre restano', async () => {
  const state = { balances: BAL, trades: { BTCEUR: [trade('BTCEUR', 1, at('2022-03-01T12:00:00Z')), trade('BTCEUR', 2, at('2024-03-01T12:00:00Z'), { qty: '0.2', quoteQty: '6000' })] } };
  const r = await runSync(state, { options: { startDate: '2024-01-01' } });
  assert.equal(r.out.raw.spotTrades.BTCEUR.length, 2, 'il raw e\' fedele a cio\' che Binance ha restituito');
  const spot = r.out.coverage.find((c) => /spot/.test(c.what));
  assert.equal(spot.count, 1); assert.equal(spot.from, '2024-03-01T12:00:00.000Z');
  assert.match(spot.note, /Altre 1 operazioni sono precedenti alla data di inizio/);
  assert.ok(r.out.warnings.some((w) => /1 operazione spot è precedente alla data di inizio/.test(w) && /NON conteggiate/.test(w)));
  const p = X.parse(r.out.raw, 'b');
  assert.deepEqual(kinds(p), [Kind.INFO, Kind.BUY]);
  assert.match(p.events[0].note, /precedente alla data di inizio/);
  assert.equal(p.events[1].uid, 'api:binance:trade:BTCEUR:2');
  assert.deepEqual(p.unknown, []);
  // senza il blocco "range" (dati vecchi) nessun filtro; con data di inizio piu' vecchia tutto e' conteggiato
  const old = JSON.parse(JSON.stringify(r.out.raw)); delete old.range;
  assert.deepEqual(kinds(X.parse(old, 'b')), [Kind.BUY, Kind.BUY]);
  const all = await runSync(state, { options: { startDate: '2020-01-01' } });
  assert.deepEqual(kinds(X.parse(all.out.raw, 'b')), [Kind.BUY, Kind.BUY]);
  assert.ok(!all.out.warnings.some((w) => /precedent/.test(w)));
  assert.match(X.options.find((o) => o.key === 'startDate').help, /operazioni spot precedenti/);
});

// ---------------------------------------------------------------- possibili doppioni: l'acquisto con carta diventa "da controllare"
test('parse: acquisto con carta con acquisto spot (o Convert da valuta) di pari quantita\' entro 10 minuti -> UNRESOLVED sull\'acquisto con carta (blocca); ignorandolo resta un solo acquisto', () => {
  const payRow = pay(1, T0);                       // 0,025 BTC
  const spot = trade('BTCEUR', 1, T0 + 2 * MIN, { qty: '0.02500000', quoteQty: '1000' });
  const r = parse({ spotTrades: { BTCEUR: [spot] }, fiatPayments: { buy: [payRow], sell: [] } });
  assert.deepEqual(kinds(r), [Kind.BUY, Kind.UNRESOLVED]);
  assert.match(r.events[1].note, /due volte/); assert.match(r.events[1].note, /acquisto spot BTCEUR/); assert.equal(r.events[1].uid, 'api:binance:pay:o1');
  assert.equal(r.unknown.length, 1);
  const blocked = run(r.events, {}, { toYear: 2024 });
  assert.ok(codes(blocked.engine, 'block').includes('unrecognized_row'));
  const fixed = run(r.events, { resolutions: { 'api:binance:pay:o1': { action: 'ignore' } } }, { toYear: 2024 });
  assert.ok(!codes(fixed.engine, 'block').includes('unrecognized_row'));
  eq(fixed.engine.pool('BTC').balance, '0.025');
  // Convert da valuta verso la stessa cripto, riuscita
  const cv = conv(1, T0 + 3 * MIN, { fromAsset: 'EUR', fromAmount: '1000', toAsset: 'BTC', toAmount: '0.02500000' });
  const rc = parse({ convert: [cv], fiatPayments: { buy: [payRow], sell: [] } });
  assert.deepEqual(kinds(rc), [Kind.BUY, Kind.UNRESOLVED]); assert.match(rc.events[1].note, /conversione Convert/);
  // nessun doppione: quantita' diversa, oltre 10 minuti, vendita spot, Convert fallita o da cripto
  for (const o of [
    { spotTrades: { BTCEUR: [trade('BTCEUR', 2, T0 + 2 * MIN, { qty: '0.02600000' })] } },
    { spotTrades: { BTCEUR: [trade('BTCEUR', 3, T0 + 11 * MIN, { qty: '0.025' })] } },
    { spotTrades: { BTCEUR: [trade('BTCEUR', 4, T0 + MIN, { qty: '0.025', isBuyer: false })] } },
    { convert: [conv(2, T0 + MIN, { fromAsset: 'EUR', toAsset: 'BTC', toAmount: '0.025', orderStatus: 'FAIL' })] },
    { convert: [conv(3, T0 + MIN, { fromAsset: 'USDT', toAsset: 'BTC', toAmount: '0.025' })] },
  ]) {
    const x = parse({ ...o, fiatPayments: { buy: [payRow], sell: [] } });
    assert.ok(!x.events.some((e) => e.kind === Kind.UNRESOLVED), JSON.stringify(o));
  }
  // un acquisto con carta non completato non viene confrontato (resta INFO/UNRESOLVED per il suo stato)
  const f = parse({ spotTrades: { BTCEUR: [spot] }, fiatPayments: { buy: [pay(5, T0, { status: 'Failed' })], sell: [] } });
  assert.deepEqual(kinds(f), [Kind.BUY, Kind.INFO]);
});

test('sync: la sincronizzazione segnala come "da controllare" l\'acquisto con carta che coincide con una conversione Convert da valuta', async () => {
  const t = at('2025-03-01T10:00:00Z');
  const r = await runSync({ balances: BAL, payBuy: [pay(1, t)], convert: [conv(1, t + 3 * MIN, { fromAsset: 'EUR', fromAmount: '1000', toAsset: 'BTC', toAmount: '0.02500000' })] }, { options: { startDate: '2025-02-01' } });
  assert.ok(r.out.warnings.some((w) => /1 acquisto con carta/.test(w) && /Convert/.test(w) && /da controllare/.test(w)));
  const p = X.parse(r.out.raw, 'b');
  assert.deepEqual(kinds(p).sort(), [Kind.BUY, Kind.UNRESOLVED].sort());
  assert.match(r.out.coverage.find((c) => /carta/.test(c.what)).note, /possibile doppione/);
});

// ---------------------------------------------------------------- cambio tra due valute con commissione
test('parse: coppia con base e quota fiat -> INFO senza effetto; la commissione pagata in una cripto non si perde (evento FEE separato), quella in valuta e\' annotata', () => {
  const raw = { symbols: [...SYMS, { symbol: 'EURGBP', baseAsset: 'EUR', quoteAsset: 'GBP', status: 'TRADING' }] };
  const r = parse({ ...raw, spotTrades: { EURGBP: [trade('EURGBP', 1, T0, { qty: '100', quoteQty: '86', commission: '0.01', commissionAsset: 'BNB' })] } });
  assert.deepEqual(kinds(r), [Kind.INFO, Kind.FEE]);
  assert.equal(r.events[1].asset, 'BNB'); eq(r.events[1].qty, '0.01'); assert.equal(r.events[1].uid, 'api:binance:trade:EURGBP:1#fee');
  assert.equal(new Set(r.events.map((e) => e.uid)).size, 2);
  const fiatFee = parse({ ...raw, spotTrades: { EURGBP: [trade('EURGBP', 2, T0, { qty: '100', quoteQty: '86', commission: '0.5', commissionAsset: 'EUR' })] } });
  assert.deepEqual(kinds(fiatFee), [Kind.INFO]); assert.match(fiatFee.events[0].note, /commissione in valuta/);
  const none = parse({ ...raw, spotTrades: { EURGBP: [trade('EURGBP', 3, T0, { qty: '100', quoteQty: '86' })] } });
  assert.deepEqual(kinds(none), [Kind.INFO]);
  // il motore tratta la commissione in BNB come cessione di BNB (con lotti e prezzo): qui senza lotti segnala
  const bnb = ev(Kind.BUY, T(2024, 2, 1), 'BNB', '1', { value: '300' });
  const { engine } = run([bnb, ...r.events], {}, { toYear: 2024 });
  eq(engine.pool('BNB').balance, '0.99');
});
