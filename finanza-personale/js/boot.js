/* Applica il tema salvato prima del primo disegno (niente lampo bianco al buio). */
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('rhf-theme') || 'auto'; } catch (e) { /* navigazione privata */ }
  document.documentElement.setAttribute('data-theme', t === 'light' || t === 'dark' ? t : 'auto');
})();
