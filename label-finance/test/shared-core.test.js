// La Edge Function artist-statement usa una copia di core.js: devono restare identiche,
// altrimenti il portale artista mostrerebbe importi diversi dall'app.
// Per aggiornare la copia: cp core.js supabase/functions/_shared/lfcore.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('supabase/functions/_shared/lfcore.js è identico a core.js', () => {
  const root = path.join(__dirname, '..');
  const a = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
  const b = fs.readFileSync(path.join(root, 'supabase/functions/_shared/lfcore.js'), 'utf8');
  assert.equal(b, a, 'copia non aggiornata: esegui  cp core.js supabase/functions/_shared/lfcore.js');
});
