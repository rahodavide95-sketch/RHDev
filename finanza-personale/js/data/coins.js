/* Loghi delle crypto: le immagini ufficiali (da CoinGecko), salvate nell'app in icons/crypto/<sigla>.png.
   L'app non le chiede a nessuno: nessuno sa quali crypto hai. */
export const COIN_LOGOS = new Set(['btc', 'eth', 'usdt', 'bnb', 'xrp', 'usdc', 'sol', 'trx', 'figrheloc', 'hype', 'zec', 'doge', 'xmr', 'usds', 'wbt', 'leo', 'link', 'ada', 'xlm', 'bch', 'near', 'dai', 'usde', 'rain', 'uni', 'ltc', 'usd1', 'cc', 'avax', 'sui', 'gram', 'hbar', 'xaut', 'usdg', 'pyusd', 'shib', 'qnt', 'tao', 'cro', 'rlusd', 'ena', 'usdy', 'usyc', 'okb', 'm', 'pepe', 'buidl', 'aave', 'ondo', 'btw', 'eursafo', 'usdf', 'pump', 'paxg', 'aster', 'dot', 'u', 'wlfi', 'sky', 'mnt', 'wld', 'usdd', 'morpho', 'htx', 'icp', 'bfusd', 'usdgo', 'bgb', 'etc', 'arb', 'jst', 'vvv', 'kcs', 'pol', 'gt', 'kas', 'ousd', 'pi', 'algo', 'jup', 'atom', 'render', 'nexo', 'fil', 'gho', 'inj', 'lit', 'zro', 'night', 'cake', 'ustb', 'xdc', 'dash', 'ethfi', 'pearl', 'jaaa', 'bdx', 'apt', 'usd0']);

/** Logo di una crypto dal simbolo ("BTC-USD", "BTC") o null. */
export function coinLogo(symbol) {
  const s = String(symbol || '').toLowerCase().replace(/-(usd|eur|usdt)$/, '');
  return s && COIN_LOGOS.has(s) ? `icons/crypto/${s}.png` : null;
}
