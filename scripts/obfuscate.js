/* Offusca il JavaScript pubblicato (NON il sorgente nel repo).
   Gira solo in fase di deploy: rende il codice online illeggibile, mantenendo
   intatta la "superficie pubblica" (funzioni globali, window.t, ecc.) così
   l'app continua a funzionare. Config identica a quella collaudata in locale. */
const ob = require('javascript-obfuscator');
const fs = require('fs');

const opts = {
  compact: true,
  renameGlobals: false,            // NON rinominare i globali → niente rotture
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  simplify: true,
  controlFlowFlattening: false,    // off: evita bug/lentezza
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
};

const files = ['label-finance/app.js', 'label-finance/sync.js', 'label-finance/i18n.js'];
let done = 0;
for (const f of files) {
  if (!fs.existsSync(f)) { console.warn('skip (manca):', f); continue; }
  const code = fs.readFileSync(f, 'utf8');
  const out = ob.obfuscate(code, opts).getObfuscatedCode();
  fs.writeFileSync(f, out);
  console.log('offuscato', f, code.length, '->', out.length);
  done++;
}
console.log('Totale file offuscati:', done);
