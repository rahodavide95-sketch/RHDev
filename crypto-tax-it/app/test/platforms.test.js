const { test } = require('node:test');
const { CT, assert } = require('./helpers');
require('../src/platforms.js');

test('catalogo piattaforme: ogni tipo di file esiste e ha un parser', () => {
  const types = Object.keys(CT.importers.TYPES);
  for (const [k, p] of Object.entries(CT.PLATFORMS)) {
    assert.ok(p.name && p.blurb && p.steps.length, `${k}: dati mancanti`);
    for (const t of p.types) assert.ok(types.includes(t), `${k}: tipo ${t} senza parser`);
    for (const kd of p.kinds) assert.ok(p.types.includes(kd.type), `${k}: kind ${kd.type} non nei tipi`);
    assert.ok(['none', 'planned'].includes(p.api.status), `${k}: stato API`);
  }
});

test('ogni tipo di file appartiene a una piattaforma e le piattaforme native hanno un account', () => {
  for (const t of Object.keys(CT.importers.TYPES)) assert.ok(CT.platformOfType(t), `tipo ${t} senza piattaforma`);
  for (const k of ['cryptocom_app', 'cryptocom_exchange', 'bitpanda']) assert.equal(CT.PLATFORMS[k].native, true);
  assert.equal(CT.PLATFORMS.cryptocom_app.api.status, 'none');
});

test('zip dell\'Exchange: si usano solo i file delle operazioni', () => {
  const pol = CT.PLATFORMS.cryptocom_exchange.zipPolicy;
  assert.equal(pol('SPOT_TRADE.csv'), true);
  assert.equal(pol('SPOT_ORDER.csv'), false);
});
