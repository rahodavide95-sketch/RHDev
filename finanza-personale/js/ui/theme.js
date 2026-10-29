/* Tema chiaro / scuro / automatico (lo stesso valore lo legge boot.js prima del primo disegno). */
export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'light' || theme === 'dark' ? theme : 'auto';
  try { localStorage.setItem('rhf-theme', root.dataset.theme); } catch { /* navigazione privata */ }
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0c' : '#f2f2f5');
}
