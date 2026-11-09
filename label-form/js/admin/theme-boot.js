/* Tema del sito e barra laterale, letti prima di disegnare la pagina (niente lampo di colore sbagliato).
   Script normale e non modulo: deve girare subito, nel <head>. */
(function () {
  try {
    var t = localStorage.getItem('labelform-theme');
    if (t === 'auto' || !t) t = t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'chiaro' : (t ? 'scuro' : 'scuro');
    if (t !== 'chiaro' && t !== 'minimal') t = 'scuro';
    document.documentElement.setAttribute('data-theme', t);
    if (localStorage.getItem('labelform-side') === 'mini') document.documentElement.setAttribute('data-side', 'mini');
  } catch (e) { document.documentElement.setAttribute('data-theme', 'scuro'); }
})();
