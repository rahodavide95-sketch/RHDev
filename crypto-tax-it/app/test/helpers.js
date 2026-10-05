globalThis.Decimal = require('../src/vendor/decimal.js');
require('../src/core.js');
require('../src/csv.js');
require('../src/importers.js');
require('../src/engine.js');
require('../src/tax.js');
require('../src/rw.js');
const assert = require('node:assert/strict');
const CT = globalThis.CT;
const { D, Kind } = CT;

let n = 0;
const T = (y, m, d, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi));
function ev(kind, ts, asset, qty, o = {}) {
  const dec = (k) => (o[k] === undefined || o[k] === null ? undefined : { [k]: D(o[k]) });
  return CT.mkEvent({
    uid: o.uid || 'e' + ++n, ts, account: o.account || 'app', kind, asset, qty: D(qty),
    assetHint: o.assetHint || null, counterAsset: o.counterAsset || '', feeAsset: o.feeAsset || '', incomeType: o.incomeType || '',
    ...dec('value'), ...dec('counterQty'), ...dec('feeQty'), ...dec('feeValue'),
  });
}
function run(events, opts = {}, taxOpts = {}) {
  const prices = opts.prices || new CT.PriceBook();
  const engine = new CT.Engine({ ...opts, prices }).run(events);
  const toYear = taxOpts.toYear || 2025;
  const years = CT.tax.computeYears(engine, { toYear, ...taxOpts });
  return { engine, years, y: years[toYear] };
}
const eq = (a, b, msg) => assert.ok(D(a).eq(D(b)), `${msg || ''} atteso ${b}, ottenuto ${a}`);
const blocking = (engine) => engine.issues.filter((i) => i.level === 'block');
const codes = (engine, level) => engine.issues.filter((i) => !level || i.level === level).map((i) => i.code);

module.exports = { CT, D, Kind, T, ev, run, eq, blocking, codes, assert };
