/* Importi: sempre in centesimi interi (niente errori di arrotondamento dei decimali).
   Lettura "all'italiana" (1.234,56 · 1234,5 · 1.500 = millecinquecento) e anche
   all'inglese (1,234.56 · 12.5). Si possono scrivere piccoli calcoli: "12,50+3*2". */

export const CURRENCIES = {
  EUR: { symbol: '€', name: 'Euro' },
  USD: { symbol: '$', name: 'Dollaro USA' },
  GBP: { symbol: '£', name: 'Sterlina' },
  CHF: { symbol: 'CHF', name: 'Franco svizzero' },
  JPY: { symbol: '¥', name: 'Yen', decimals: 0 },
  CAD: { symbol: 'C$', name: 'Dollaro canadese' },
  AUD: { symbol: 'A$', name: 'Dollaro australiano' },
  SEK: { symbol: 'kr', name: 'Corona svedese' },
  NOK: { symbol: 'kr', name: 'Corona norvegese' },
  DKK: { symbol: 'kr', name: 'Corona danese' },
  PLN: { symbol: 'zł', name: 'Złoty' },
  CZK: { symbol: 'Kč', name: 'Corona ceca' },
  HUF: { symbol: 'Ft', name: 'Fiorino' },
  RON: { symbol: 'lei', name: 'Leu' },
  TRY: { symbol: '₺', name: 'Lira turca' },
  CNY: { symbol: '¥', name: 'Yuan' },
  HKD: { symbol: 'HK$', name: 'Dollaro di Hong Kong' },
  SGD: { symbol: 'S$', name: 'Dollaro di Singapore' },
  BRL: { symbol: 'R$', name: 'Real' },
  MXN: { symbol: 'MX$', name: 'Peso messicano' },
  INR: { symbol: '₹', name: 'Rupia indiana' },
  ZAR: { symbol: 'R', name: 'Rand' },
  AED: { symbol: 'AED', name: 'Dirham' },
};

export const isCurrency = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, c);

/** Euro (numero) → centesimi interi. */
export const toCents = n => {
  const v = Math.round(Number(n) * 100);
  return Number.isFinite(v) ? v : 0;
};
export const fromCents = c => (Number(c) || 0) / 100;

/** Normalizza un numero scritto a mano in formato JS ("1.234,56" → "1234.56"). */
function normalizeNumber(tok) {
  let s = tok;
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    // il separatore che compare per ultimo è quello dei decimali
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (commas) {
    if (commas > 1) s = s.replace(/,/g, '');            // 1,234,567
    else s = s.replace(',', '.');                       // virgola = decimali (italiano)
  } else if (dots > 1) {
    s = s.replace(/\./g, '');                           // 1.234.567
  } else if (dots === 1 && /^\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace('.', '');                             // 1.500 = millecinquecento
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  return Number(s);
}

/** Legge un importo (anche un piccolo calcolo) e restituisce i centesimi, o null se non è valido. */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? toCents(input) : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[€$£¥]|EUR|USD|CHF|GBP/gi, '').replace(/[\s ']/g, '')
    .replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  if (!s) return null;
  const toks = s.match(/\d[\d.,]*|[.,]\d+|[-+*/()]/g);
  if (!toks || toks.join('') !== s) return null;
  let i = 0;
  const peek = () => toks[i];
  const num = () => {
    const t = toks[i];
    if (t === '(') { i++; const v = expr(); if (toks[i] !== ')') throw 0; i++; return v; }
    if (t === '-') { i++; return -num(); }
    if (t === '+') { i++; return num(); }
    if (t === undefined || /[-+*/()]/.test(t)) throw 0;
    const v = normalizeNumber(t);
    if (v === null) throw 0;
    i++;
    return v;
  };
  const term = () => {
    let v = num();
    while (peek() === '*' || peek() === '/') {
      const op = toks[i++];
      const r = num();
      if (op === '*') v *= r;
      else { if (r === 0) throw 0; v /= r; }
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = toks[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== toks.length || !Number.isFinite(v) || Math.abs(v) > 1e13) return null;
    return Math.round(v * 100 + (v >= 0 ? 1e-9 : -1e-9));
  } catch {
    return null;
  }
}

/** Legge un numero decimale generico (quantità, percentuali, prezzi) senza arrotondare ai centesimi. */
export function parseDecimal(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[%€$£\s ]/g, '').replace(/[−–]/g, '-');
  if (!s) return null;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  else if (s[0] === '+') s = s.slice(1);
  // qui un punto singolo è sempre decimale (0.0035 BTC, 1.234 quote)
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (commas === 1) s = s.replace(',', '.');
  else if (commas > 1) s = s.replace(/,/g, '');
  else if (dots > 1) s = s.replace(/\./g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const fmtCache = new Map();
function nf(key, opts) {
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.NumberFormat('it-IT', opts); fmtCache.set(key, f); }
  return f;
}

/** Centesimi → "€ 1.234,56" (stile italiano). opts: {sign, decimals, currency} */
export function formatMoney(cents, currency = 'EUR', opts = {}) {
  const v = (Number(cents) || 0) / 100;
  const dec = opts.decimals ?? (CURRENCIES[currency]?.decimals ?? 2);
  const key = `m|${currency}|${dec}`;
  let s;
  try {
    s = nf(key, { style: 'currency', currency, minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' })
      .format(Math.abs(v));
  } catch {
    s = nf(`n|${dec}`, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' }).format(Math.abs(v)) + ' ' + currency;
  }
  const neg = v < 0 && Math.abs(v) >= 0.5 * Math.pow(10, -dec);
  if (neg) return '−' + s;
  if (opts.sign && v > 0) return '+' + s;
  return s;
}

/** Numero semplice all'italiana: 1.234,5 */
export function formatNumber(n, maxDec = 2, minDec = 0) {
  const v = Number(n) || 0;
  const s = nf(`d|${minDec}|${maxDec}`, { minimumFractionDigits: minDec, maximumFractionDigits: maxDec, useGrouping: 'always' }).format(Math.abs(v));
  return (v < 0 && s !== '0' ? '−' : '') + s;
}

export function formatPercent(p, dec = 1, sign = false) {
  const v = Number(p) || 0;
  const s = formatNumber(v, dec, dec) + '%';
  return sign && v > 0 ? '+' + s : s;
}

/** Forma compatta per assi e riquadri piccoli: 950 · 12,3k · 1,2 Mln */
export function formatCompact(cents, currency = 'EUR') {
  const v = (Number(cents) || 0) / 100, a = Math.abs(v);
  const sym = CURRENCIES[currency]?.symbol ?? currency;
  let s;
  if (a >= 1e9) s = formatNumber(a / 1e9, 1) + ' Mld';
  else if (a >= 1e6) s = formatNumber(a / 1e6, a >= 1e7 ? 0 : 1) + ' Mln';
  else if (a >= 1e4) s = formatNumber(a / 1e3, 0) + 'k';
  else if (a >= 1e3) s = formatNumber(a / 1e3, 1) + 'k';
  else s = formatNumber(a, 0);
  return (v < 0 ? '−' : '') + sym + ' ' + s;
}

/** Cambi: rates = { EUR: 1, USD: 1.08, ... } (unità di valuta per 1 unità della base). */
export function convert(cents, from, to, rates) {
  if (!cents || from === to) return Math.round(cents || 0);
  const rf = rates?.[from], rt = rates?.[to];
  if (!rf || !rt) return Math.round(cents);   // cambio sconosciuto: meglio mostrare il valore che zero
  return Math.round((cents / rf) * rt);
}

export const sum = arr => arr.reduce((a, b) => a + (b || 0), 0);
