// Moduli fac-simile Quadro RW / Quadro W: numeri e posizioni, confrontati con i due fac-simile di riferimento dell'utente.
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { CT, D, assert } = require('./helpers');
globalThis.window = globalThis;
const jsp = require('../src/vendor/jspdf.umd.min.js');
globalThis.jspdf = globalThis.jspdf || { jsPDF: jsp.jsPDF || jsp.default };
const asset = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', f)).toString('base64');
CT.fxAssets = { rw: asset('fx-rw.jpg'), w: asset('fx-w.jpg') };
const FX = require('../src/facsimile.js');

const row = (account, asset, days, vi, vf, ivca, extra) => Object.assign({ account, asset, cls: 'crypto', days, valueInitial: D(vi), valueFinal: D(vf), ivca: D(ivca) }, extra);
const res = (rw, extra) => Object.assign({ year: 2025, rw, groups: { blockCount: 0 } }, extra);
const texts = (page) => page.ops.map((o) => o.s);
const at = (page, s, x) => page.ops.find((o) => o.s === s && (x === undefined || Math.abs(o.x - x) < 0.01));

// i numeri del fac-simile di riferimento: App 6.787 -> 8.338 in 365 giorni (IC 17), Exchange 1 -> 1 in 247 giorni (IC 0)
const REF = res([row('CRYPTOCOM_APP', 'BTC', 365, 6787, 8338, '16.676'), row('CRYPTOCOM_EXCHANGE', 'ETH', 247, 1, 1, '0.0013')]);

test('moduli RW e W: stessi valori del fac-simile di riferimento', () => {
  const out = FX.build(REF, { custodians: {}, taxpayer: {} });
  assert.equal(out.available, true);
  assert.equal(out.total.toString(), '17');
  const rw = out.rw[0], w = out.w[0];
  for (const pg of [rw, w]) {
    for (const v of ['6.787', '8.338', '365', '247', '100,00']) assert.ok(texts(pg).includes(v), v);
    assert.equal(texts(pg).filter((s) => s === '21').length, 2);
  }
  // RW: IC e IC dovuta della prima riga, 17; seconda riga 0; totale RW8 17 (due volte: totale e imposta a debito)
  assert.equal(texts(rw).filter((s) => s === '17').length, 4);
  assert.equal(texts(rw).filter((s) => s === '0').length, 2);
  // il quadro W non ha le colonne dell'imposta
  assert.equal(texts(w).filter((s) => s === '17').length, 0);
  // segnaposto per gli acconti, come nel riferimento
  assert.ok(texts(rw).includes('INSERIRE ACCONTI') && texts(w).includes('INSERIRE ACCONTI'));
});

test('posizioni: stesse coordinate misurate sul fac-simile di riferimento', () => {
  const rw = FX.build(REF, { custodians: {}, taxpayer: {} }).rw[0];
  const g = FX._geo.RW;
  assert.ok(Math.abs(at(rw, '6.787').x - 454.75) < 1e-9 && at(rw, '6.787').align === 'right');
  assert.ok(Math.abs(at(rw, '6.787').y - 165.7) < 1e-9);                                 // riga RW1, casella 7
  assert.ok(Math.abs(at(rw, '365').y - 200.9) < 1e-9 && Math.abs(at(rw, '365').x - 240.0) < 1e-9);   // giorni (casella 10)
  assert.ok(Math.abs(at(rw, '247').y - 319.4) < 1e-9);                                    // riga RW2
  assert.equal(g.baseA.length, 5);
  assert.equal(Math.round((g.baseA[2] - g.baseA[1]) * 10), 959);                         // passo tra le righe RW2..RW5: 95,9 pt
  const w = FX.build(REF, { custodians: {}, taxpayer: {} }).w[0];
  assert.ok(Math.abs(at(w, '8.338').x - 550.75) < 1e-9);
});

test('codice fiscale, numero del modulo e bozza', () => {
  const out = FX.build(res(REF.rw, { groups: { blockCount: 2 } }), { custodians: {}, taxpayer: { cf: 'rssmra80a01h501u' } });
  const rw = out.rw[0];
  assert.deepEqual(rw.ops.filter((o) => o.align === 'center' && o.size === 11).map((o) => o.s).join(''), 'RSSMRA80A01H501U');
  assert.equal(rw.ops.filter((o) => o.align === 'center' && o.size === 11).length, 16);
  assert.ok(rw.ops.some((o) => /BOZZA/.test(o.s) && o.color === '#b00020'));
  assert.ok(!texts(FX.build(REF, { taxpayer: {} }).rw[0]).some((s) => /BOZZA/.test(s)));
});

test('piu\' di cinque righe: altri moduli, totali solo sul primo', () => {
  const many = res(Array.from({ length: 7 }, (_, i) => row('Piattaforma ' + i, 'BTC', 100 + i, 1000 + i, 2000 + i, '4')));
  const out = FX.build(many, { custodians: {}, taxpayer: {} });
  assert.equal(out.rw.length, 2); assert.equal(out.w.length, 2);
  assert.ok(texts(out.rw[0]).includes('INSERIRE ACCONTI'));
  assert.ok(!texts(out.rw[1]).includes('INSERIRE ACCONTI'));
  assert.equal(out.rw[1].ops.find((o) => o.size === 18.75).s, '2');                      // numero del modulo
});

test('oro: riga senza codice e senza imposta, segnalata; valori stimati e incompleti segnalati', () => {
  const r = res([row('Bitpanda', 'XAU', 300, 500, 540, '0', { cls: 'metal' }), row('Wallet', 'ADA', 365, 10, 20, '0.04', { estimated: true }),
    row('Exchange', 'DOT', 365, 0, 0, '0', { valueInitial: null, valueFinal: null })]);
  const out = FX.build(r, { custodians: { Wallet: { name: 'Ledger SAS', country: 'Francia' } }, taxpayer: {} });
  const rw = out.rw[0];
  assert.ok(texts(rw).some((s) => /ORO: VERIFICA/.test(s)));
  assert.equal(texts(rw).filter((s) => s === '21').length, 2);           // l'oro non ha il codice 21
  assert.ok(texts(rw).some((s) => /LEDGER_SAS FRANCIA/.test(s)));
  assert.ok(rw.ops.some((o) => /VALORI STIMATI/.test(o.s) && o.color === '#b00020'));
  assert.ok(texts(FX.build(r, {}).w[0]).some((s) => /VALORI STIM/.test(s)));
  assert.ok(texts(rw).some((s) => /DA COMPLETARE/.test(s)));
});

test('solo per il periodo d\'imposta 2025', () => {
  const out = FX.build(Object.assign({}, REF, { year: 2024 }), {});
  assert.equal(out.available, false); assert.match(out.reason, /2025/);
});

test('stesse operazioni di disegno => PDF valido a una pagina per modulo', () => {
  const out = FX.build(REF, { custodians: {}, taxpayer: { cf: 'RSSMRA80A01H501U' } });
  const buf = Buffer.from(FX.toPdf(out.rw, 'Quadro RW'));
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 100000 && buf.length < 1500000);
  assert.match(buf.toString('latin1'), /\/Count 1/);
  const two = Buffer.from(FX.toPdf(FX.build(res(Array.from({ length: 6 }, (_, i) => row('P' + i, 'BTC', 365, 1, 2, '0'))), {}).rw, 'x'));
  assert.match(two.toString('latin1'), /\/Count 2/);
});

test('una sola riga per piattaforma: cripto con giorni diversi si sommano, giorni = media pesata sul valore finale', () => {
  const r = res([
    row('CRYPTOCOM_APP', 'BTC', 365, 1000, 3000, '6'),      // 3000 x 365/365 x 0,2% = 6
    row('CRYPTOCOM_APP', 'ETH', 100, 0, 1000, '0.5479'),    // 1000 x 100/365 x 0,2%
    row('CRYPTOCOM_APP', 'SOL', 365, 200, 0, '0'),
    row('CRYPTOCOM_EXCHANGE', 'ADA', 200, 50, 100, '0.1')]);
  const out = FX.build(r, { custodians: {}, taxpayer: {} });
  assert.equal(out.rows.length, 2);                                      // due piattaforme, due righe (non quattro)
  const app = out.rows.find((x) => x.account === 'CRYPTOCOM_APP');
  assert.equal(app.vf.toString(), '4000'); assert.equal(app.vi.toString(), '1200');
  assert.equal(app.mixedDays, true);
  assert.equal(app.days, 299);                                           // (3000x365 + 1000x100) / 4000 = 298,75
  assert.equal(app.icDue.toString(), '7');                               // IC = somma attivita' per attivita'
  assert.ok(/GIORNI MEDI/.test(app.label3));
  const ex = out.rows.find((x) => x.account === 'CRYPTOCOM_EXCHANGE');
  assert.equal(ex.days, 200); assert.equal(ex.mixedDays, false); assert.ok(!/GIORNI MEDI/.test(ex.label3));
  // stessa piattaforma con cripto e oro: due righe (codici diversi)
  const gold = FX.build(res([row('Bitpanda', 'XAU', 365, 10, 20, '0', { cls: 'metal' }), row('Bitpanda', 'BTC', 365, 10, 20, '0.04')]), {});
  assert.equal(gold.rows.length, 2);
});

test('acconti versati: vuoti = segnaposto rosso; indicati = scritti in RW8/W8 con imposta a debito o a credito', () => {
  const st = (advance) => ({ custodians: {}, taxpayer: { advance } });
  const T = FX._geo.RW.tot;
  for (const bad of [undefined, '', '  ', 'abc', '-3']) {
    const o = FX.build(REF, st(bad));
    assert.ok(texts(o.rw[0]).includes('INSERIRE ACCONTI') && texts(o.w[0]).includes('INSERIRE ACCONTI'), String(bad));
  }
  // totale 17, acconti 5 -> RW8: totale 17, acconti 5, a debito 12, nessun credito; W8: acconti 5
  const o = FX.build(REF, st('5'));
  const rw = o.rw[0], w = o.w[0];
  assert.ok(!texts(rw).includes('INSERIRE ACCONTI') && !texts(w).includes('INSERIRE ACCONTI'));
  const base = rw.ops.filter((x) => Math.abs(x.y - T.base) < 1e-9);
  const at4 = (page, col) => page.ops.find((x) => Math.abs(x.y - T.base) < 1e-9 && Math.abs(x.x - T.right[col]) < 1e-9);
  assert.equal(at4(rw, 1).s, '17'); assert.equal(at4(rw, 4).s, '5'); assert.equal(at4(rw, 5).s, '12'); assert.equal(at4(rw, 6), undefined);
  assert.equal(base.length, 3);
  assert.ok(w.ops.some((x) => x.s === '5' && Math.abs(x.x - FX._geo.W.adv.right) < 1e-9));
  // acconti maggiori del dovuto (virgola e punti accettati): a debito 0, a credito 3
  const c = FX.build(REF, st('20,4')).rw[0];
  assert.equal(at4(c, 4).s, '20'); assert.equal(at4(c, 5).s, '0'); assert.equal(at4(c, 6).s, '3');
  // 0 euro di acconti e' un'indicazione valida (non il segnaposto)
  const z = FX.build(REF, st('0')).rw[0];
  assert.equal(at4(z, 4).s, '0'); assert.equal(at4(z, 5).s, '17');
  assert.equal(FX.toPdf(o.rw, 'RW').byteLength > 1000, true);
});

test('nessuna riga: i moduli restano vuoti (solo numero del modulo, totali a 0 e segnaposto), senza valori del riferimento', () => {
  const o = FX.build(res([]), { custodians: {}, taxpayer: {} });
  assert.equal(o.rows.length, 0);
  assert.deepEqual(texts(o.rw[0]).sort(), ['0', '0', '1', 'INSERIRE ACCONTI', 'VERSATI']);   // RW8: totale e imposta a debito 0; numero del modulo 1
  assert.deepEqual(texts(o.w[0]).sort(), ['1', 'INSERIRE ACCONTI', 'VERSATI']);
  for (const v of ['6.787', '8.338', '365', '247', '100,00', '21', 'CRYPTOCOM_APP']) assert.ok(!texts(o.rw[0]).includes(v) && !texts(o.w[0]).includes(v), v);
});
