// Lettore della CU: PDF generati con jsPDF come i modelli reali, letti con il vero pdf.js (lo stesso incluso nella pagina).
const { test } = require('node:test');
const { CT, assert } = require('./helpers');
globalThis.pdfjsWorker = require('../src/vendor/pdf.worker.min.js');
const pdfjsLib = require('../src/vendor/pdf.min.js');
const { jsPDF } = require('../src/vendor/jspdf.umd.min.js');
require('../src/cu.js');
const CU = CT.cu;

const page = () => { const d = new jsPDF({ unit: 'pt', format: 'a4' }); d.setFont('times', 'normal'); return d; };
const T = (d, s, x, y, size = 8) => { d.setFontSize(size); d.text(s, x, y); };
const read = (d) => CU.readPdf(d.output('arraybuffer'), pdfjsLib);

/** Pagina 2 della CU SIAE (lavoro autonomo, causale B): stessa disposizione del modello, importi della CU vista dall'utente. */
function siae(d, dy = 0, v = {}) {
  T(d, 'CERTIFICAZIONE LAVORO AUTONOMO, PROVVIGIONI E REDDITI DIVERSI', 150, 50 + dy, 11);
  T(d, 'Causale', 130, 70 + dy, 9); T(d, v.causale || 'B', 132, 85 + dy, 10);
  T(d, 'Anno', 190, 105 + dy); T(d, 'Anticipazione', 240, 105 + dy); T(d, 'Ammontare lordo corrisposto', 330, 105 + dy);
  T(d, 'Somme non soggette a ritenuta', 455, 100 + dy); T(d, 'per regime convenzionale', 462, 108 + dy);
  if (v.anno) T(d, v.anno, 188, 122 + dy, 9);
  T(d, v.lordo || '1.051,16', 318, 122 + dy, 9); T(d, '0,00', 452, 122 + dy, 9);
  T(d, 'Codice', 135, 140 + dy); T(d, 'Altre somme non soggette a ritenuta', 185, 140 + dy); T(d, 'Imponibile', 355, 140 + dy); T(d, 'Ritenute a titolo d\'acconto', 465, 140 + dy);
  T(d, '22', 130, 157 + dy, 9); T(d, v.ns || '420,46', 180, 157 + dy, 9); T(d, v.imp || '630,70', 318, 157 + dy, 9); T(d, v.rit || '126,13', 452, 157 + dy, 9);
  T(d, 'Ritenute a titolo d\'imposta', 190, 175 + dy); T(d, 'Ritenute sospese', 340, 175 + dy); T(d, 'Addizionale regionale a titolo d\'acconto', 452, 175 + dy);
  T(d, '0,00', 180, 192 + dy, 9); T(d, '0,00', 318, 192 + dy, 9); T(d, '0,00', 452, 192 + dy, 9);
  T(d, 'Imponibile anni precedenti', 462, 210 + dy); T(d, '0,00', 452, 227 + dy, 9);
}

test('CU SIAE: causale B, lordo, codice 22, somme non soggette, imponibile e ritenute; riduzione del 40% (meno di 35 anni)', async () => {
  const d = page();
  T(d, 'CERTIFICAZIONE UNICA 2026', 200, 20, 12); T(d, 'SOCIETA\' ITALIANA DEGLI AUTORI ED EDITORI', 150, 32, 9);
  siae(d);
  const r = await read(d);
  assert.equal(r.year, 2025); assert.equal(r.sostituto, 'SIAE');
  assert.deepEqual(r.autonomo.map(({ page: _p, ...b }) => b), [{ causale: 'B', anno: null, lordo: '1051.16', codice: '22', nonSoggette: '420.46', imponibile: '630.70', ritenute: '126.13' }]);
  assert.equal(CU.dedRate(r.autonomo[0]), 0.40);
  assert.deepEqual(r.warnings, []);
});

test('CU con piu\' moduli: un blocco per modulo; causale M (serate) e anno di arretrati segnalato', async () => {
  const d = page();
  siae(d, 0, { causale: 'M', lordo: '800,00', ns: '0,00', imp: '800,00', rit: '160,00' });
  siae(d, 300, { lordo: '200,00', ns: '50,00', imp: '150,00', rit: '30,00', anno: '2023' });
  const r = await read(d);
  assert.deepEqual(r.autonomo.map((b) => [b.causale, b.lordo, b.ritenute, b.anno]), [['M', '800.00', '160.00', null], ['B', '200.00', '30.00', '2023']]);
  assert.equal(CU.dedRate(r.autonomo[1]), 0.25);
  assert.ok(r.warnings.some((w) => /arretrati/.test(w)));
});

test('CU di lavoro dipendente: punti 1, 6, 21, 22, 26 e 27 (non il 29, acconto dell\'anno dopo); numeri delle caselle ignorati', async () => {
  const d = page();
  T(d, 'CERTIFICAZIONE UNICA 2026', 200, 20, 12);
  T(d, 'DATI FISCALI', 40, 50, 10);
  T(d, '1', 40, 70, 6); T(d, 'Redditi di lavoro dipendente e assimilati (indeterminato)', 48, 70); T(d, '2', 300, 70, 6); T(d, '(determinato)', 308, 70);
  T(d, '28.500,00', 48, 86, 9);
  T(d, 'Numero di giorni per i quali spettano le detrazioni', 40, 105);
  T(d, '6', 40, 118, 6); T(d, 'Lavoro dipendente', 48, 118); T(d, '7', 200, 118, 6); T(d, 'Pensione', 208, 118);
  T(d, '365', 48, 134, 9);
  T(d, '21', 40, 155, 6); T(d, 'Ritenute Irpef', 50, 155); T(d, '22', 200, 155, 6); T(d, 'Addizionale regionale all\'Irpef', 210, 155);
  T(d, '4.100,00', 50, 171, 9); T(d, '450,00', 210, 171, 9);
  T(d, 'Addizionale comunale all\'Irpef', 40, 190, 8);
  T(d, '26', 40, 203, 6); T(d, 'Acconto 2025', 50, 203); T(d, '27', 200, 203, 6); T(d, 'Saldo 2025', 210, 203); T(d, '29', 360, 203, 6); T(d, 'Acconto 2026', 370, 203);
  T(d, '72,00', 50, 219, 9); T(d, '168,00', 210, 219, 9); T(d, '75,00', 370, 219, 9);
  const r = await read(d);
  assert.deepEqual(r.dipendente, { p1: '28500.00', p6: '365', p21: '4100.00', p22: '450.00', p26: '72.00', p27: '168.00' });
  assert.equal(r.autonomo.length, 0);
});

test('CU come modulo compilabile: i valori dei campi PDF si leggono dalle annotazioni', async () => {
  const d = page();
  T(d, 'CERTIFICAZIONE UNICA 2026', 200, 20, 12);
  T(d, 'Causale', 130, 70, 9); T(d, 'Ammontare lordo corrisposto', 330, 105); T(d, 'Ritenute a titolo d\'acconto', 465, 140);
  const field = (name, value, x, y) => { const f = new d.AcroFormTextField(); f.fieldName = name; f.Rect = [x, y, 110, 16]; f.value = value; d.addField(f); };
  field('causale', 'B', 128, 74); field('lordo', '1.051,16', 316, 110); field('rit', '126,13', 450, 145);
  const r = await read(d);
  assert.equal(r.autonomo.length, 1);
  assert.equal(r.autonomo[0].causale, 'B'); assert.equal(r.autonomo[0].lordo, '1051.16'); assert.equal(r.autonomo[0].ritenute, '126.13');
});

test('PDF senza testo (scansione) o di altro tipo: nessun valore inventato, avviso chiaro', async () => {
  const d = page();
  T(d, 'Estratto conto', 40, 40, 12); T(d, '1.234,56', 40, 60, 9);
  const r = await read(d);
  assert.equal(r.autonomo.length, 0); assert.deepEqual(r.dipendente, {});
  assert.ok(r.warnings.some((w) => /Non ho trovato i campi della CU/.test(w)));
});
