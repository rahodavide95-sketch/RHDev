/* Modello dati e utilita' comuni. Tutti gli importi sono Decimal (decimal.js): mai numeri JavaScript. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const Decimal = globalThis.Decimal;
  Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
  const D = (x) => (x instanceof Decimal ? x : new Decimal(x));
  const ZERO = new Decimal(0);

  const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'BRL']);
  const METAL_SYMBOLS = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM']);
  const METAL_ALIASES = { GOLD: 'XAU', SILVER: 'XAG', PLATINUM: 'XPT', PALLADIUM: 'XPD' };
  const STABLE = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'EURC', 'EURT', 'PYUSD', 'FDUSD', 'USDD']);
  // E-money token in euro conformi a MiCA: dal 2026 restano al 26% (lista indicativa, da verificare)
  const EMT_EUR = new Set(['EURC', 'EURCV', 'EURI', 'EURQ', 'EURR']);

  const Kind = Object.freeze({
    BUY: 'buy', SELL: 'sell', SWAP: 'swap', INCOME: 'income', SPEND: 'spend',
    TRANSFER_OUT: 'transfer_out', TRANSFER_IN: 'transfer_in', FEE: 'fee',
    FIAT_IN: 'fiat_in', FIAT_OUT: 'fiat_out', INFO: 'info', UNRESOLVED: 'unresolved',
  });

  /** 'crypto' | 'metal' | 'fiat' | 'other'. `hint` = classe dichiarata dalla fonte (es. Bitpanda "Asset class"). */
  function classify(symbol, hint) {
    const s = String(symbol || '').toUpperCase();
    if (hint) {
      const h = String(hint).trim().toLowerCase();
      if (['cryptocurrency', 'crypto', 'cryptocoin', 'token'].includes(h)) return 'crypto';
      if (['metal', 'metals', 'precious metal', 'precious metals'].includes(h)) return 'metal';
      if (h === 'fiat') return 'fiat';
      return 'other';
    }
    if (FIAT.has(s)) return 'fiat';
    if (METAL_SYMBOLS.has(s)) return 'metal';
    return 'crypto';
  }

  // Data fiscale = data di calendario in Italia
  const romeFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayCache = new Map();
  function taxDate(ts) {
    const k = ts.getTime();
    let v = dayCache.get(k);
    if (v === undefined) { v = romeFmt.format(ts); dayCache.set(k, v); }
    return v;
  }
  const yearOf = (day) => parseInt(day.slice(0, 4), 10);

  function mkEvent(o) {
    return Object.assign({
      uid: '', ts: null, account: '', kind: Kind.INFO, asset: '', qty: ZERO, assetHint: null,
      counterAsset: '', counterQty: ZERO, value: null, valueCcy: 'EUR',
      feeAsset: '', feeQty: ZERO, feeValue: null, feeValueCcy: 'EUR',
      incomeType: '', ref: '', note: '', src: '', raw: null, unkKey: '',
    }, o);
  }

  /** Arrotondamento all'unita' di euro (0,5 per eccesso), come nei modelli dichiarativi. */
  const roundEuro = (x) => D(x).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  /** Formattazioni */
  const fx2 = (x) => (x === null || x === undefined ? '' : D(x).toFixed(2));
  const fq = (x) => (x === null || x === undefined ? '' : D(x).toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));

  Object.assign(CT, { Decimal, D, ZERO, FIAT, METAL_SYMBOLS, METAL_ALIASES, STABLE, EMT_EUR, Kind, classify, taxDate, yearOf, mkEvent, roundEuro, fx2, fq });
  if (typeof module !== 'undefined') module.exports = CT;
})();
