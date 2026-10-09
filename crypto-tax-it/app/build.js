#!/usr/bin/env node
/* Costruisce i file distribuibili (nessuna dipendenza):
 *   ../index.html          pagina unica autonoma: si apre con un doppio clic o si pubblica su GitHub Pages
 *   dist/artifact.html     stessa pagina senza doctype/head, per la pubblicazione come Artifact
 */
const fs = require('node:fs');
const path = require('node:path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const SCRIPTS = ['vendor/decimal.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'core.js', 'csv.js', 'importers.js', 'engine.js', 'tax.js', 'rw.js', 'zip.js', 'pipeline.js', 'report.js', 'pdf.js', 'platforms.js', 'pricefeed.js', 'facsimile.js', 'api/common.js', 'api/cryptocom_exchange.js', 'api/bitpanda.js', 'api/binance.js', 'api/index.js', 'ui.js']
  .filter((f) => fs.existsSync(path.join(__dirname, 'src', f)));   // un collegamento non ancora presente viene saltato
const scriptTags = SCRIPTS.map((f) => {
  const code = src(f).replace(/<\/script/gi, '<\\/script'); // '<\/' e' equivalente a '</' dentro stringhe e regex JS
  return `<script data-app>\n${code}\n</script>`;
});
// sfondi dei moduli fac-simile (immagini JPEG) incorporati come dati: serve un unico file anche offline e dentro claude.ai
const jpg = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'src', 'assets', f)).toString('base64');
const assetTag = `<script data-app>\n(globalThis.CT = globalThis.CT || {}).fxAssets = { rw: '${jpg('fx-rw.jpg')}', w: '${jpg('fx-w.jpg')}' };\n</script>`;
scriptTags.splice(SCRIPTS.indexOf('facsimile.js') + 1, 0, assetTag);
const scripts = scriptTags.join('\n');

const fragment = src('index.src.html').replace('/*@@CSS@@*/', () => src('app.css')).replace('/*@@SCRIPTS@@*/', () => scripts);

const standalone = `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), standalone);
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), fragment);
console.log(`index.html ${(standalone.length / 1024).toFixed(0)} KB, artifact.html ${(fragment.length / 1024).toFixed(0)} KB`);
