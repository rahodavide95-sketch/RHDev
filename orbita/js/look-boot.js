/* Applica il tema scelto (Colori / Minimal) prima del primo disegno, così non si
   vede per un attimo l'altro tema. Script classico e sincrono: deve stare subito
   dopo <link id="look-css">. La scelta vera sta nel profilo; questa è la copia locale. */
(function () {
  try {
    if (localStorage.getItem('orbita:look') === 'minimal') {
      var link = document.getElementById('look-css');
      if (link) link.href = link.href.replace('look-color.css', 'look-minimal.css');
      document.documentElement.setAttribute('data-look', 'minimal');
    }
  } catch (e) { /* archivio del browser non disponibile: resta il tema predefinito */ }
})();
