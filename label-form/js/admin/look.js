/* Aspetto del sito per l'etichetta: tema (Scuro, Chiaro, Minimal, Automatico) e barra laterale
   stretta o larga. Scelte di questo dispositivo, salvate nel browser. */

export const THEMES = {
  scuro: { label: 'Scuro', ic: 'moon', hint: 'Fondo scuro con riflessi viola' },
  chiaro: { label: 'Chiaro', ic: 'sun', hint: 'Fondo chiaro, morbido' },
  minimal: { label: 'Minimal', ic: 'square', hint: 'Bianco e nero, essenziale' },
  auto: { label: 'Automatico', ic: 'contrast', hint: 'Scuro o chiaro come il dispositivo' },
};
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export const siteTheme = () => (THEMES[get('labelform-theme')] ? get('labelform-theme') : 'scuro');
function resolve(t) { return t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'chiaro' : 'scuro') : t; }
export function applySiteTheme(t = siteTheme()) {
  const r = resolve(t);
  document.documentElement.dataset.theme = r;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', r === 'scuro' ? '#0b0c11' : '#ffffff');
}
export function setSiteTheme(t) { set('labelform-theme', t); applySiteTheme(t); }
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (siteTheme() === 'auto') applySiteTheme('auto'); });

export const sideMini = () => document.documentElement.dataset.side === 'mini';
export function setSideMini(on) {
  if (on) document.documentElement.dataset.side = 'mini'; else delete document.documentElement.dataset.side;
  set('labelform-side', on ? 'mini' : 'wide');
}
