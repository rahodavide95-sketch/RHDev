/* pwa-redirect.js — chi usa la web-app installata (PWA) non deve vedere il sito: dritto al login */
try{if(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone){location.replace('app.html'+location.search+location.hash);}}catch(e){}
