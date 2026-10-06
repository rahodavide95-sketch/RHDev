const { test } = require('node:test');
const { CT, assert } = require('./helpers');
require('../src/api/common.js');
const C = CT.api.common;

const res = (status, body, headers) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => (headers || {})[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('HMAC-SHA256: vettore di prova della documentazione Binance e RFC 4231', async () => {
  assert.equal(await C.hmacHex('NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j',
    'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'),
  'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
  assert.equal(await C.hmacHex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('request: restituisce il JSON, ripete su 429/5xx con Retry-After, poi si ferma', async () => {
  let n = 0; const waits = [];
  const f = async () => (++n < 3 ? res(429, {}, { 'retry-after': '2' }) : res(200, { ok: 1 }));
  assert.deepEqual(await C.request(f, 'https://x/y', {}, { sleep: async (ms) => waits.push(ms) }), { ok: 1 });
  assert.deepEqual(waits, [2000, 2000]);
  await assert.rejects(() => C.request(async () => res(503, 'x'), 'https://x/y', {}, { retries: 2, sleep: async () => {} }), (e) => e.code === 'http');
  await assert.rejects(() => C.request(async () => res(429, 'x'), 'https://x/y', {}, { retries: 1, sleep: async () => {} }), (e) => e.code === 'rate');
});

test('request: errori di rete, autenticazione, formato; le chiavi non compaiono negli errori', async () => {
  await assert.rejects(() => C.request(async () => { throw new TypeError('Failed to fetch'); }, 'https://x/y?signature=SEGRETO&a=1', {}), (e) => e.code === 'network' && !JSON.stringify(e.detail).includes('SEGRETO'));
  await assert.rejects(() => C.request(async () => res(401, { msg: 'bad key ABC123 rejected' }), 'https://x/y?apikey=ABC123', {}, { secrets: ['ABC123'] }), (e) => e.code === 'auth' && !JSON.stringify(e.detail).includes('ABC123'));
  await assert.rejects(() => C.request(async () => res(200, '<html>'), 'https://x/y', {}), (e) => e.code === 'format');
  await assert.rejects(() => C.request(async () => res(400, { code: -1 }), 'https://x/y', {}), (e) => e.code === 'http');
});

test('redact: firme e chiavi negli URL e nei corpi JSON', () => {
  assert.equal(C.redact('https://a/b?x=1&signature=abc&apiKey=zzz'), 'https://a/b?x=1&signature=***&apiKey=***');
  assert.equal(C.redact('{"api_key":"K1","sig":"S1","a":1}'), '{"api_key":"***","sig":"***","a":1}');
});
