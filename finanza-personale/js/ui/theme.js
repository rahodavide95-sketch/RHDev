/* Tema chiaro / scuro / automatico e colori: palette pronte (anche "Excel", blu e grigio come
   i fogli di D) o colori scelti liberamente. I colori diventano variabili CSS sulla radice;
   una copia delle sole variabili resta nel browser (rhf-look) perché boot.js le applichi prima
   del primo disegno, senza lampi di colore. */

export const PALETTES = {
  viola:    { label: 'Viola', brand: '#4f46e5', head: '', bg: '', chart: 'vivid' },
  excel:    { label: 'Excel', brand: '#1f4e79', head: '#1f3864', bg: '#eef0f4', chart: 'vivid', zebra: true },
  oceano:   { label: 'Oceano', brand: '#1769aa', head: '#21405e', bg: '#edf1f5', chart: 'vivid' },
  smeraldo: { label: 'Smeraldo', brand: '#1d7a52', head: '#1f4e3d', bg: '#eef2ef', chart: 'vivid' },
  grafite:  { label: 'Grafite', brand: '#3c4452', head: '#3a3f48', bg: '#efeff1', chart: 'vivid' },
};

/* colori dei grafici (8 serie, nell'ordine) */
export const CHARTS = {
  vivid:  { label: 'Vivaci', light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] },
  office: { label: 'Excel (Office)', light: ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e'], dark: ['#5b8bd9', '#f08c47', '#b5b5b5', '#ffcb33', '#74ade0', '#83bd5c', '#5a7cc0', '#c46a2c'] },
  cool:   { label: 'Blu e verdi', light: ['#1769aa', '#26a69a', '#5c8fd6', '#7cb342', '#0097a7', '#3949ab', '#9ccc65', '#78909c'], dark: ['#4f97d6', '#3cc2b4', '#7aa8e8', '#93c95a', '#26b6c6', '#7584d4', '#b3dc84', '#9aafbb'] },
  green:  { label: 'Verdi e grigi', light: ['#1d7a52', '#5aa469', '#8fbf7f', '#3f6e8c', '#b3a369', '#6d7f74', '#2e9c8a', '#a3b1a6'], dark: ['#36a874', '#72bd80', '#a6d396', '#6595b4', '#cbbb80', '#8fa397', '#45c0aa', '#b9c6bc'] },
  pastel: { label: 'Pastello', light: ['#7aa6e0', '#f2a07b', '#7fd1ae', '#f3c969', '#eea4c3', '#9ccf8b', '#a99be8', '#f08f8f'], dark: ['#8fb6ea', '#f5b292', '#93dcbc', '#f6d585', '#f2b8d0', '#b0db9f', '#bbb0ef', '#f4a5a5'] },
};

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const rgba = (hex, a) => `rgba(${rgb(hex).join(', ')}, ${a})`;
const lum = hex => { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** Colori effettivi: quelli della palette, o quelli scelti con "Personalizzati". */
export function resolveLook(look = {}) {
  const p = PALETTES[look.palette] || (look.palette === 'custom' ? null : PALETTES.viola);
  const src = p || look;
  return {
    brand: HEX.test(src.brand) ? src.brand : PALETTES.viola.brand,
    head: HEX.test(src.head) ? src.head : '',
    bg: HEX.test(src.bg) ? src.bg : '',
    chart: look.chart && look.chart !== 'auto' && CHARTS[look.chart] ? look.chart : (p?.chart || 'vivid'),
    zebra: look.zebra == null ? !!p?.zebra : !!look.zebra,
    density: look.density === 'compact' ? 'compact' : 'normal',
  };
}

/** Le variabili CSS per il tema chiaro o scuro (vuoto = quelle del foglio di stile). */
export function lookVars(look, dark) {
  const L = resolveLook(look);
  const v = {};
  const isDefault = (look?.palette || 'viola') === 'viola' && L.chart === 'vivid';
  if (!isDefault || L.brand !== PALETTES.viola.brand) {
    // in scuro il colore principale si schiarisce, così resta leggibile sul fondo nero
    const brand = dark ? mix(L.brand, '#ffffff', lum(L.brand) < 0.08 ? 0.45 : 0.25) : L.brand;
    v['--brand'] = brand;
    v['--brand-soft'] = rgba(brand, dark ? 0.18 : 0.12);
    v['--ring'] = rgba(brand, dark ? 0.55 : 0.45);
  }
  if (L.head) {
    v['--thead-bg'] = dark ? mix(L.head, '#000000', 0.25) : L.head;
    v['--thead-ink'] = lum(L.head) > 0.45 ? '#111111' : '#ffffff';
  }
  if (L.bg && !dark) {
    v['--bg'] = L.bg;
    v['--glass'] = rgba(L.bg, 0.74);
    v['--card-2'] = mix(L.bg, '#ffffff', 0.55);
  }
  if (L.chart !== 'vivid') {
    const c = CHARTS[L.chart][dark ? 'dark' : 'light'];
    c.forEach((x, i) => { v[`--c${i + 1}`] = x; });
    v['--c1-soft'] = rgba(c[0], dark ? 0.18 : 0.14);
  }
  return v;
}

const VAR_NAMES = ['--brand', '--brand-soft', '--ring', '--thead-bg', '--thead-ink', '--bg', '--glass', '--card-2', '--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c1-soft'];

let lastLook = null;
/** Senza `look` (prima dello sblocco) restano i colori messi da boot.js. */
export function applyTheme(theme, look) {
  if (look) lastLook = look;
  look = lastLook;
  const root = document.documentElement;
  root.dataset.theme = theme === 'light' || theme === 'dark' ? theme : 'auto';
  try { localStorage.setItem('rhf-theme', root.dataset.theme); } catch { /* navigazione privata */ }
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (!look) { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0c' : '#f2f2f5'); return; }
  const L = resolveLook(look || {});
  const vars = lookVars(look || {}, dark);
  for (const n of VAR_NAMES) if (!(n in vars)) root.style.removeProperty(n);
  for (const [n, x] of Object.entries(vars)) root.style.setProperty(n, x);
  if (L.zebra) root.dataset.zebra = '1'; else delete root.dataset.zebra;
  root.dataset.density = L.density;
  try { localStorage.setItem('rhf-look', JSON.stringify({ light: lookVars(look || {}, false), dark: lookVars(look || {}, true), zebra: L.zebra, density: L.density })); } catch { /* navigazione privata */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0c' : (vars['--bg'] || '#f2f2f5'));
}
