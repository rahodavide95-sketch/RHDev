import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const root = new URL('../', import.meta.url);

test('il service worker mette in cache solo file che esistono', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const list = [...sw.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(list.length > 10);
  for (const f of list) if (f !== './') assert.ok(existsSync(new URL(f, root)), `manca ${f}`);
});

test('ogni modulo JS importato esiste', () => {
  const seen = new Set();
  const visit = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(new URL(rel, root), 'utf8');
    for (const [, spec] of src.matchAll(/from '(\.[^']+)'/g)) {
      const next = new URL(spec, new URL(rel, root)).pathname.replace(new URL(root).pathname, '');
      assert.ok(existsSync(new URL(next, root)), `${rel} importa ${spec} che non esiste`);
      visit(next);
    }
  };
  visit('js/app.js');
  assert.ok(seen.size >= 15);
});

test('nessuno script in linea e CSP presente (protezione XSS)', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0, 'script in linea non ammessi');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'niente gestori evento in linea');
});

test('la configurazione non contiene chiavi segrete', () => {
  const cfg = readFileSync(new URL('js/config.js', root), 'utf8');
  assert.doesNotMatch(cfg, /sb_secret_/);
  for (const [jwt] of cfg.matchAll(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g)) {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    assert.notEqual(payload.role, 'service_role', 'in config.js va la chiave anon, mai la service_role');
  }
});
