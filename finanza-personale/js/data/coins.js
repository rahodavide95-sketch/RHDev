/* Loghi delle crypto: le immagini ufficiali (da CoinGecko), salvate nell'app in icons/crypto/<sigla>.png.
   L'app non le chiede a nessuno: nessuno sa quali crypto hai. */
export const COIN_LOGOS = new Set([]);

/** Logo di una crypto dal simbolo ("BTC-USD", "BTC") o null. */
export function coinLogo(symbol) {
  const s = String(symbol || '').toLowerCase().replace(/-(usd|eur|usdt)$/, '');
  return s && COIN_LOGOS.has(s) ? `icons/crypto/${s}.png` : null;
}
