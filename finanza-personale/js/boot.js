/* Applica il tema e i colori salvati prima del primo disegno (niente lampo bianco al buio,
   niente cambio di colore all'apertura). */
(function () {
  var t = 'auto', look = null;
  try { t = localStorage.getItem('rhf-theme') || 'auto'; look = JSON.parse(localStorage.getItem('rhf-look') || 'null'); } catch (e) { /* navigazione privata */ }
  var root = document.documentElement;
  root.setAttribute('data-theme', t === 'light' || t === 'dark' ? t : 'auto');
  if (!look || typeof look !== 'object') return;
  var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  var vars = (dark ? look.dark : look.light) || {};
  for (var k in vars) if (/^--[a-z0-9-]+$/.test(k) && typeof vars[k] === 'string' && /^(#[0-9a-f]{6}|rgba\([0-9., ]+\))$/i.test(vars[k])) root.style.setProperty(k, vars[k]);
  if (look.zebra) root.setAttribute('data-zebra', '1');
  if (look.density === 'compact') root.setAttribute('data-density', 'compact');
})();
