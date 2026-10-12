/* theme-boot.js — caricato nel <head>: applica il tema prima del render per evitare lo sfarfallio */
(function(){try{var p=localStorage.getItem('labelfinance.theme')||'system';
      var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();
