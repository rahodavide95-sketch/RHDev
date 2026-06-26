// Build per Vercel: prepara la cartella "dist" da pubblicare.
//  - copia solo i file del SITO (esclude backend/docs/dev)
//  - offusca app.js, sync.js, i18n.js nella copia pubblicata
// Il sorgente nel repo resta leggibile: l'offuscamento avviene solo qui.
import { readdirSync, cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import obfuscator from 'javascript-obfuscator';
const { obfuscate } = obfuscator;

const OUT = 'dist';
// Cartelle/file da NON pubblicare (backend, documentazione interna, file di build).
const EXCLUDE = new Set([
  'node_modules', 'dist', 'supabase', 'docs', 'README.md',
  'build-vercel.mjs', 'package.json', 'package-lock.json', 'vercel.json',
]);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Copia ogni voce del sito nella cartella di output.
for (const entry of readdirSync('.')) {
  if (EXCLUDE.has(entry) || entry.startsWith('.')) continue;
  cpSync(entry, `${OUT}/${entry}`, { recursive: true });
}

// Offuscamento (stessa config collaudata in scripts/obfuscate.js).
const opts = {
  compact: true, renameGlobals: false, identifierNamesGenerator: 'hexadecimal',
  stringArray: true, stringArrayThreshold: 0.75, stringArrayEncoding: ['base64'],
  simplify: true, controlFlowFlattening: false, deadCodeInjection: false,
  selfDefending: false, debugProtection: false,
};
let n = 0;
for (const f of ['app.js', 'sync.js', 'i18n.js']) {
  const p = `${OUT}/${f}`;
  if (!existsSync(p)) { console.warn('manca:', p); continue; }
  const code = readFileSync(p, 'utf8');
  writeFileSync(p, obfuscate(code, opts).getObfuscatedCode());
  console.log('offuscato', f);
  n++;
}
console.log(`Build Vercel pronta in "${OUT}/" — file offuscati: ${n}`);
