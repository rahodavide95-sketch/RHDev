/* Genera index.html (pagina completa per GitHub Pages, iPhone e iPad)
   a partire da app.html (il sorgente, che è anche l'artifact su claude.ai).
   Uso:  node documenti-raho/build.js  */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const app = fs.readFileSync(path.join(dir, 'app.html'), 'utf8');

const head = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Documenti Raho">
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px system-ui,-apple-system,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
</head>
<body>
<!-- File generato da build.js: modifica app.html, non questo file. -->
`;

fs.writeFileSync(path.join(dir, 'index.html'), head + app + '\n</body>\n</html>\n');
console.log('index.html aggiornato');
