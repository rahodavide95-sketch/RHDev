/* Genera index.html (pagina completa per GitHub Pages, iPhone e iPad)
   a partire da app.html (il sorgente).
   Uso:  node documenti-raho/build.js  */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
// i loghi (var X = 'logo-....png/webp') diventano immagini incorporate, byte per byte
let found = 0;
const app = fs.readFileSync(path.join(dir, 'app.html'), 'utf8').replace(/= '(logo-[a-z0-9-]+\.(png|webp))';/g, (m, file, ext) => {
  found++;
  return "= 'data:image/" + ext + ";base64," + fs.readFileSync(path.join(dir, file)).toString('base64') + "';";
});
if (found !== 2) throw new Error('loghi inseriti: ' + found + ' invece di 2, controlla RHBKNG_LOGO e RHBKNG_CONTRACT in app.html');

const head = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Documenti Raho">
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="icon" type="image/png" sizes="64x64" href="favicon-64.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
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
