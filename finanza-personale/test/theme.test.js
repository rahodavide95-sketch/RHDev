import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sanitize } from '../js/core/model.js';
import { lookVars, seriesOf, resolveLook, CHARTS } from '../js/ui/theme.js';

const S8 = ['#112233', '#445566', '#778899', '#aabbcc', '#ddeeff', '#010203', '#a1b2c3', '#c0ffee'];

test('colori scelti uno per uno: gli 8 dei grafici, guadagni e perdite', () => {
  const look = { ...defaults().settings.look, palette: 'custom', series: S8, pos: '#0066ff', neg: '#ff00aa' };
  const light = lookVars(look, false);
  S8.forEach((c, i) => assert.equal(light[`--c${i + 1}`], c));
  assert.equal(light['--pos'], '#0066ff');
  assert.equal(light['--neg'], '#ff00aa');
  // al buio i colori molto scuri si schiariscono, gli altri restano quelli scelti
  const dark = lookVars(look, true);
  assert.notEqual(dark['--c1'], '#112233');
  assert.equal(dark['--c4'], '#aabbcc');
  assert.deepEqual(seriesOf(look), S8);
  // senza scelte: i colori del gruppo pronto, verde e rosso di base
  const base = defaults().settings.look;
  assert.deepEqual(seriesOf({ ...base, chart: 'pastel' }), CHARTS.pastel.light);
  assert.equal(lookVars(base, false)['--pos'], undefined);
});

test('le scelte dei colori sopravvivono al salvataggio, quelle rotte si scartano', () => {
  const st = sanitize({ ...defaults(), settings: { ...defaults().settings, look: { palette: 'custom', brand: '#AA3366', head: '', bg: '', series: S8, pos: '#0066FF', neg: 'rosso' }, groupColors: { 'income:Lavoro': '#FF8800', 'income:Musica': 3, 'expense:Casa': 'x' } } });
  const L = st.settings.look;
  assert.equal(L.brand, '#aa3366');
  assert.equal(L.head, '');           // "nessun colore" resta nessun colore
  assert.deepEqual(L.series, S8);
  assert.equal(L.pos, '#0066ff');
  assert.equal(L.neg, '');
  assert.equal(resolveLook(L).head, '');
  assert.equal(st.settings.groupColors['income:Lavoro'], '#ff8800');
  assert.equal(st.settings.groupColors['income:Musica'], 3);
  assert.equal(st.settings.groupColors['expense:Casa'], undefined);
  const bad = sanitize({ ...defaults(), settings: { ...defaults().settings, look: { series: ['#000000'] } } });
  assert.equal(bad.settings.look.series, null);
});
