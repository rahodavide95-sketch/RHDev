/* Funzione Vercel: GET /api/price?sym=BTC&day=2025-12-31[&prefer=bitpanda|coinbase] -> { price, source, detail, check }.
   Scarica il prezzo dal server, dove le borse non bloccano la richiesta come fanno con il browser (CORS). Usa lo stesso codice della
   pagina (app/src/pricefeed.js). Riceve solo simbolo e data: nessun dato personale. Su GitHub Pages questa funzione non gira e la
   pagina chiede i prezzi direttamente alle fonti. */
globalThis.Decimal = require('../app/src/vendor/decimal.js');
require('../app/src/core.js');
const PF = require('../app/src/pricefeed.js');

module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const sym = String(q.get('sym') || '').toUpperCase().slice(0, 12);
  const day = String(q.get('day') || '').slice(0, 10);
  const prefer = ['bitpanda', 'coinbase'].includes(q.get('prefer')) ? q.get('prefer') : undefined;   // asset custodito li': prima il suo listino
  const send = (status, body, cache) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache ? 'public, s-maxage=2592000, max-age=86400' : 'no-store');
    res.end(JSON.stringify(body));
  };
  if (!/^[A-Z0-9]{1,12}$/.test(sym) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(400, { error: 'simbolo o data non validi', details: [] });
  const past = day < new Date().toISOString().slice(0, 10);   // un prezzo di un giorno passato non cambia: si puo' tenere in cache
  try {
    const r = await PF.dailyEur(sym, day, (u, i) => fetch(u, Object.assign({ headers: { 'User-Agent': 'dichiarazione-redditi (prezzi storici)', Accept: 'application/json' } }, i)), { check: true, prefer });
    send(200, r, past);
  } catch (e) {
    send(404, { error: e.message, details: e.details || [] }, false);
  }
};
