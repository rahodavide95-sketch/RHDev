/* pwa-redirect.js — eseguito nel <head> della landing (index.html), prima del render.
   - Chi usa la web-app installata (PWA) non deve vedere il sito: dritto al login.
   - Link di reset password (anche scaduti) che atterrano qui: inoltra all'app. */
try{
  const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  // anche i link scaduti (#error_code=…): l'app mostra il messaggio giusto
  const recovery=/[#&?]type=recovery\b|[#&]error_code=/.test(location.hash+location.search);
  if(standalone||recovery){ location.replace('app.html'+location.search+location.hash); }
}catch(e){}
