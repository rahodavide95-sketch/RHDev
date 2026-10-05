#!/usr/bin/env node
/* Costruisce i file distribuibili (nessuna dipendenza):
 *   ../index.html          pagina unica autonoma: si apre con un doppio clic o si pubblica su GitHub Pages
 *   dist/artifact.html     stessa pagina senza doctype/head, per la pubblicazione come Artifact
 */
const fs = require('node:fs');
const path = require('node:path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const SCRIPTS = ['vendor/decimal.js', 'core.js', 'csv.js', 'importers.js', 'engine.js', 'tax.js', 'rw.js', 'zip.js', 'pipeline.js', 'report.js', 'ui.js'];
const scripts = SCRIPTS.map((f) => {
  const code = src(f);
  if (/<\/script/i.test(code)) throw new Error(`${f} contiene </script`);
  return `<script>\n${code}\n</script>`;
}).join('\n');

const fragment = src('index.src.html').replace('/*@@CSS@@*/', () => src('app.css')).replace('/*@@SCRIPTS@@*/', () => scripts);

const standalone = `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), standalone);
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), fragment);
console.log(`index.html ${(standalone.length / 1024).toFixed(0)} KB, artifact.html ${(fragment.length / 1024).toFixed(0)} KB`);
