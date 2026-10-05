const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { CT, assert } = require('./helpers');
require('../src/zip.js');
require('../src/pipeline.js');
require('../src/report.js');

// jsPDF e AutoTable (build per browser) caricati in un contesto con window/self come in una pagina web
const dir = path.join(__dirname, '../src/vendor/');
const sb = { console, TextEncoder, TextDecoder, URL, Blob, setTimeout, clearTimeout, atob, btoa, Uint8Array, ArrayBuffer, Intl, navigator: { userAgent: 'node' } };
sb.window = sb; sb.self = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(dir + 'jspdf.umd.min.js', 'utf8'), sb);
vm.runInContext(fs.readFileSync(dir + 'jspdf.plugin.autotable.min.js', 'utf8'), sb);
globalThis.jspdf = sb.jspdf;
require('../src/pdf.js');

const APP = `Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind
2025-01-10 10:00:00,Buy BTC,EUR,-1000,BTC,0.01,EUR,1000,1100,viban_purchase
2025-02-01 10:00:00,BTC -> ETH,BTC,-0.01,ETH,0.2,EUR,1200,1300,crypto_exchange
2025-03-01 10:00:00,Sell ETH,ETH,-0.2,EUR,1300,EUR,1300,1400,crypto_viban_exchange
2025-03-05 10:00:00,Earn,CRO,5,,,EUR,0.5,0.55,crypto_earn_interest_paid
2025-03-07 10:00:00,To exchange,CRO,-5,,,EUR,0.5,0.55,crypto_to_exchange_transfer
2025-03-08 10:00:00,Mystery,CRO,1,,,EUR,0.1,0.11,tipo_sconosciuto
`;
const BP = `Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency
E1,2025-01-05T09:05:00+01:00,buy,incoming,500.00,EUR,10.0,XAU,50,EUR,Metal,,5.00,EUR,0,EUR
E2,2025-03-05T09:05:00+01:00,sell,outgoing,350.00,EUR,5.0,XAU,70,EUR,Metal,,3.00,EUR,0,EUR
`;
const hasPoppler = (() => { try { cp.execSync('which pdftotext', { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
const text = (u8) => { const f = path.join(os.tmpdir(), `t${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(f, u8); const t = cp.execSync(`pdftotext -layout "${f}" -`, { encoding: 'utf8' }); fs.unlinkSync(f); return t; };

function state(extra = {}) {
  return Object.assign({
    files: [{ id: 'a', name: 'app.csv', type: 'cryptocom_app', text: APP }, { id: 'b', name: 'bitpanda.csv', type: 'bitpanda', text: BP }],
    manual: [], resolutions: {}, prices: {}, settings: { year: 2025, rebase2025: false, useCarry: true },
    taxpayer: { name: 'Rossi Mario', cf: 'RSSMRA80A01H501U' }, custodians: { 'Crypto.com App': { name: 'Foris DAX MT Limited', country: 'Malta' } },
  }, extra);
}

test('ZIP: scrittura e rilettura', async () => {
  const z = CT.zipStore([{ name: 'a.txt', data: new TextEncoder().encode('ciao') }, { name: 'è.txt', data: new TextEncoder().encode('mondo') }]);
  const files = await CT.unzip(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
  assert.deepEqual(files.map((f) => [f.name, f.text]), [['a.txt', 'ciao'], ['è.txt', 'mondo']]);
  const f = path.join(os.tmpdir(), 'zt.zip'); fs.writeFileSync(f, z);
  try { assert.match(cp.execSync(`python3 -c "import zipfile;z=zipfile.ZipFile('${f}');print(z.testzip(), z.namelist())"`, { encoding: 'utf8' }), /None/); } catch (e) { if (!/not found|No such/.test(String(e))) throw e; }
});

test('PDF: fascicolo in BOZZA con filigrana, intestazione e dati del contribuente', async () => {
  const s = state();
  const res = CT.analyze(s);
  const out = await CT.pdf.buildAll(res, s);
  assert.equal(out.draft, true);
  assert.equal(out.parts.length, CT.pdf.SECTIONS.length);
  assert.equal(Buffer.from(out.full.data.slice(0, 5)).toString(), '%PDF-');
  fs.mkdirSync(process.env.PDF_OUT || os.tmpdir(), { recursive: true });
  if (process.env.PDF_OUT) fs.writeFileSync(path.join(process.env.PDF_OUT, 'full-bozza.pdf'), out.full.data);
  if (!hasPoppler) return;
  const t = text(out.full.data);
  for (const frag of ['Fascicolo di supporto', 'Rossi Mario', 'RSSMRA80A01H501U', 'BOZZA', 'Prospetto quadro RT', 'Cripto-attività', 'Oro e metalli preziosi', 'Allegato A', 'Allegato E', 'Foris DAX MT Limited', 'Impronta SHA-256', 'tipo_sconosciuto']) {
    assert.ok(t.includes(frag), `manca "${frag}" nel PDF`);
  }
  assert.ok(/Pagina 1 di \d+/.test(t));
  assert.equal(t.includes('?'), false, 'caratteri non supportati sostituiti da ?');
});

test('PDF: senza problemi aperti non c e la filigrana e i totali tornano', async () => {
  const s = state();
  const base = CT.analyze(s);
  const prices = {};
  for (const k of base.engine.missingPrices.keys()) prices[k] = '100';
  s.prices = prices;
  s.resolutions = {};
  for (const i of base.engine.issues.filter((x) => x.level === 'block' && ['unrecognized_row'].includes(x.code))) s.resolutions[i.uid] = { action: 'ignore' };
  for (const i of base.engine.issues.filter((x) => x.code === 'transfer_out_unmatched')) s.resolutions[i.uid] = { action: 'self_custody' };
  let res = CT.analyze(s);
  for (const k of res.engine.missingPrices.keys()) s.prices[k] = '100';
  res = CT.analyze(s);
  assert.equal(res.groups.blockCount, 0, JSON.stringify(res.engine.issues.filter((i) => i.level === 'block')));
  const out = await CT.pdf.buildAll(res, s);
  assert.equal(out.draft, false);
  if (process.env.PDF_OUT) fs.writeFileSync(path.join(process.env.PDF_OUT, 'full-ok.pdf'), out.full.data);
  if (!hasPoppler) return;
  const t = text(out.full.data);
  assert.equal(t.includes('BOZZA'), false);
  assert.ok(t.includes('104,00'), 'imposta totale 104,00');
  assert.ok(t.includes('Calcolo completato senza punti aperti'));
});

test('PDF: grandi volumi (2.000 cessioni) in tempi ragionevoli', async () => {
  const rows = ['Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind'];
  rows.push('2024-01-01 10:00:00,Buy,EUR,-100000,BTC,10,EUR,100000,0,viban_purchase');
  for (let i = 0; i < 2000; i++) rows.push(`2025-02-${String(1 + (i % 27)).padStart(2, '0')} ${String(i % 24).padStart(2, '0')}:00:00,Sell,BTC,-0.001,EUR,${20 + (i % 7)},EUR,${20 + (i % 7)},0,crypto_viban_exchange`);
  const s = state({ files: [{ id: 'a', name: 'big.csv', type: 'cryptocom_app', text: rows.join('\n') }] });
  const res = CT.analyze(s);
  const t0 = Date.now();
  const out = await CT.pdf.buildAll(res, s);
  const ms = Date.now() - t0;
  assert.ok(out.full.data.length > 10000);
  assert.ok(ms < 30000, `troppo lento: ${ms} ms`);
});
