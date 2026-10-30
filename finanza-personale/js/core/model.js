/* Il modello dei dati: com'è fatto lo stato, come si controlla (niente dati rotti
   anche da un file manomesso) e tutti i conti derivati (saldi, patrimonio, budget…).
   Gli importi sono centesimi interi nella valuta del conto. */

import { isISODate, today, addDays, monthKey, monthEnd, monthStart, lastMonths, occurrences, nextOccurrence, perYear, diffDays, diffMonths, addMonths } from './dates.js';
import { convert, isCurrency } from './money.js';
import { loanResidual } from './finance.js';

export const SCHEMA_VERSION = 1;

/* ─── Tipi di conto ─── */
export const ACCOUNT_TYPES = {
  checking:   { label: 'Conto corrente', group: 'liquidity', emoji: '🏦' },
  savings:    { label: 'Conto deposito / risparmio', group: 'liquidity', emoji: '🐷' },
  cash:       { label: 'Contanti', group: 'liquidity', emoji: '💶' },
  prepaid:    { label: 'Carta prepagata', group: 'liquidity', emoji: '💳' },
  card:       { label: 'Carta di credito', group: 'debt', emoji: '💳', liability: true },
  broker:     { label: 'Conto investimenti', group: 'investments', emoji: '📈', holdings: true },
  crypto:     { label: 'Wallet crypto', group: 'investments', emoji: '🪙', holdings: true },
  pension:    { label: 'Fondo pensione', group: 'investments', emoji: '🌱' },
  property:   { label: 'Immobile', group: 'assets', emoji: '🏡' },
  vehicle:    { label: 'Veicolo', group: 'assets', emoji: '🚗' },
  asset:      { label: 'Altro bene', group: 'assets', emoji: '💎' },
  receivable: { label: 'Credito (mi devono)', group: 'assets', emoji: '🤝' },
  mortgage:   { label: 'Mutuo', group: 'debt', emoji: '🏠', liability: true, plan: true },
  loan:       { label: 'Prestito / finanziamento', group: 'debt', emoji: '🧾', liability: true, plan: true },
  debt:       { label: 'Altro debito', group: 'debt', emoji: '📉', liability: true },
};
export const GROUPS = {
  liquidity: { label: 'Liquidità', order: 0 },
  investments: { label: 'Investimenti', order: 1 },
  assets: { label: 'Beni', order: 2 },
  debt: { label: 'Debiti', order: 3 },
};
export const isLiability = acc => !!ACCOUNT_TYPES[acc?.type]?.liability;
export const hasHoldings = acc => !!ACCOUNT_TYPES[acc?.type]?.holdings;
export const hasPlan = acc => !!ACCOUNT_TYPES[acc?.type]?.plan && !!acc.plan && acc.plan.principal > 0;

/* ─── Classi di investimento (con l'aliquota sulle plusvalenze) ─── */
export const ASSET_CLASSES = {
  etf_eq: { label: 'ETF azionario', tax: 26 },
  etf_bd: { label: 'ETF obbligazionario', tax: 26 },
  etf_mm: { label: 'ETF monetario', tax: 26 },
  stock:  { label: 'Azione', tax: 26 },
  gov:    { label: 'Titolo di Stato', tax: 12.5 },
  bond:   { label: 'Obbligazione', tax: 26 },
  fund:   { label: 'Fondo comune', tax: 26 },
  crypto: { label: 'Crypto', tax: 33 },
  gold:   { label: 'Oro e materie prime (ETC)', tax: 26 },
  other:  { label: 'Altro', tax: 26 },
};

/* ─── Categorie di partenza ─── */
const CAT = (id, name, emoji, kind, group) => ({ id, name, emoji, kind, group });
export const DEFAULT_CATEGORIES = [
  CAT('c-casa', 'Affitto / rata casa', '🏠', 'expense', 'Casa'),
  CAT('c-bollette', 'Bollette', '💡', 'expense', 'Casa'),
  CAT('c-tel', 'Internet e telefono', '📶', 'expense', 'Casa'),
  CAT('c-manut', 'Casa e arredo', '🛋️', 'expense', 'Casa'),
  CAT('c-spesa', 'Spesa', '🛒', 'expense', 'Cibo'),
  CAT('c-rist', 'Ristoranti e bar', '🍝', 'expense', 'Cibo'),
  CAT('c-carb', 'Carburante e ricarica', '⛽', 'expense', 'Trasporti'),
  CAT('c-trasp', 'Mezzi pubblici e taxi', '🚆', 'expense', 'Trasporti'),
  CAT('c-auto', 'Auto e moto', '🚗', 'expense', 'Trasporti'),
  CAT('c-salute', 'Salute', '🩺', 'expense', 'Persona'),
  CAT('c-cura', 'Cura personale', '💇', 'expense', 'Persona'),
  CAT('c-abbigl', 'Abbigliamento', '👕', 'expense', 'Persona'),
  CAT('c-svago', 'Svago e uscite', '🎟️', 'expense', 'Tempo libero'),
  CAT('c-viaggi', 'Viaggi', '✈️', 'expense', 'Tempo libero'),
  CAT('c-sport', 'Sport', '🏋️', 'expense', 'Tempo libero'),
  CAT('c-cultura', 'Libri e formazione', '📚', 'expense', 'Tempo libero'),
  CAT('c-abbon', 'Abbonamenti', '📺', 'expense', 'Abbonamenti'),
  CAT('c-shop', 'Shopping', '🛍️', 'expense', 'Persona'),
  CAT('c-lavoro', 'Attrezzatura e lavoro', '🎧', 'expense', 'Lavoro'),
  CAT('c-tasse', 'Tasse e imposte', '🏛️', 'expense', 'Finanza'),
  CAT('c-banca', 'Commissioni bancarie', '🏧', 'expense', 'Finanza'),
  CAT('c-assic', 'Assicurazioni', '🛡️', 'expense', 'Finanza'),
  CAT('c-intpass', 'Interessi passivi', '📉', 'expense', 'Finanza'),
  CAT('c-regali', 'Regali e donazioni', '🎁', 'expense', 'Persona'),
  CAT('c-animali', 'Animali', '🐾', 'expense', 'Famiglia'),
  CAT('c-figli', 'Figli', '🧸', 'expense', 'Famiglia'),
  CAT('c-altro', 'Altre spese', '📦', 'expense', 'Altro'),
  CAT('i-stip', 'Stipendio', '💼', 'income', 'Lavoro'),
  CAT('i-auton', 'Lavoro autonomo', '🧾', 'income', 'Lavoro'),
  CAT('i-cachet', 'Cachet e booking', '🎛️', 'income', 'Lavoro'),
  CAT('i-roy', 'Royalties', '🎵', 'income', 'Lavoro'),
  CAT('i-int', 'Interessi e dividendi', '📈', 'income', 'Finanza'),
  CAT('i-rimb', 'Rimborsi', '↩️', 'income', 'Altro'),
  CAT('i-vend', 'Vendite', '🏷️', 'income', 'Altro'),
  CAT('i-regali', 'Regali ricevuti', '🎁', 'income', 'Altro'),
  CAT('i-altro', 'Altre entrate', '💰', 'income', 'Altro'),
];

/* ─── Identificativi ─── */
const ALPH = '0123456789abcdefghijklmnopqrstuvwxyz';
export function uid(prefix = '') {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPH[x % 36];
  return prefix + s;
}
let lastStamp = 0;
/** Istante in millisecondi sempre crescente (due elementi creati insieme restano in ordine). */
export function stamp() {
  const n = Date.now();
  lastStamp = n > lastStamp ? n : lastStamp + 1;
  return lastStamp;
}

/* ─── Stato vuoto ─── */
export function defaults() {
  const t = stamp();
  return {
    v: SCHEMA_VERSION,
    meta: { created: t, updated: t, lastBackup: 0, changesSinceBackup: 0 },
    settings: {
      currency: 'EUR',
      theme: 'auto',
      lockMinutes: 5,
      hideAmounts: false,
      name: '',
      market: { enabled: false, proxies: true, portfolioProxies: false },
      backupDays: 14,
      onboarded: false,
    },
    accounts: [],
    valuations: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c, archived: false })),
    transactions: [],
    recurring: [],
    budgets: {},
    goals: [],
    holdings: [],
    snapshots: {},
    rules: [],
    sims: {},
    watchlist: [],
    fx: { rates: { EUR: 1 }, date: '' },
  };
}

/* ─── Controllo dei dati (difesa da file rotti o manomessi) ─── */
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const id = v => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/i.test(v) ? v : null);
const int = (v, min = -1e15, max = 1e15) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : 0);
const num = (v, def = 0, min = -1e15, max = 1e15) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : def);
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
const date = v => (isISODate(v) ? v : null);
const arr = v => (Array.isArray(v) ? v : []);
const emoji = v => str(v, 16);
const tags = v => [...new Set(arr(v).map(t => str(t, 30).toLowerCase()).filter(Boolean))].slice(0, 20);
const cur = v => (isCurrency(v) ? v : 'EUR');
const COLOR = /^#[0-9a-f]{6}$/i;

function cleanAccount(a) {
  const aid = id(a?.id); if (!aid) return null;
  const type = ACCOUNT_TYPES[a.type] ? a.type : 'checking';
  const out = {
    id: aid, name: str(a.name, 60) || 'Conto', type, institution: str(a.institution, 60), currency: cur(a.currency),
    emoji: emoji(a.emoji), color: COLOR.test(a.color) ? a.color : '', archived: bool(a.archived), inNetWorth: bool(a.inNetWorth, true),
    notes: str(a.notes, 2000), created: int(a.created, 0), order: num(a.order, 0),
    plan: null,
  };
  if (ACCOUNT_TYPES[type].plan && a.plan && typeof a.plan === 'object') {
    out.plan = {
      principal: num(a.plan.principal, 0, 0, 1e10), tan: num(a.plan.tan, 0, 0, 50), months: int(a.plan.months, 1, 600),
      start: date(a.plan.start) || today(), type: a.plan.type === 'italiano' ? 'italiano' : 'francese',
    };
  }
  return out;
}
function cleanValuation(v) {
  const vid = id(v?.id), acc = id(v?.account), d = date(v?.date);
  if (!vid || !acc || !d) return null;
  return { id: vid, account: acc, date: d, value: int(v.value), created: int(v.created, 0), kind: v.kind === 'open' ? 'open' : 'adjust', note: str(v.note, 300) };
}
function cleanCategory(c) {
  const cid = id(c?.id); if (!cid) return null;
  return { id: cid, name: str(c.name, 50) || 'Categoria', emoji: emoji(c.emoji) || '•', kind: c.kind === 'income' ? 'income' : 'expense', group: str(c.group, 40) || 'Altro', archived: bool(c.archived) };
}
function cleanTx(t) {
  const tid = id(t?.id), acc = id(t?.account), d = date(t?.date);
  const kind = ['expense', 'income', 'transfer'].includes(t?.kind) ? t.kind : null;
  if (!tid || !acc || !d || !kind) return null;
  const amount = int(t.amount, 0, 1e13);
  const out = {
    id: tid, date: d, kind, amount, account: acc,
    toAccount: kind === 'transfer' ? id(t.toAccount) : null,
    amountTo: kind === 'transfer' ? int(t.amountTo ?? t.amount, 0, 1e13) : null,
    category: kind === 'transfer' ? null : id(t.category),
    payee: str(t.payee, 120), note: str(t.note, 1000), tags: tags(t.tags),
    recurring: id(t.recurring), created: int(t.created, 0), updated: int(t.updated, 0),
    importHash: str(t.importHash, 64), flagged: bool(t.flagged),
  };
  if (kind === 'transfer' && (!out.toAccount || out.toAccount === acc)) return null;
  return out;
}
function cleanRecurring(r) {
  const rid = id(r?.id), acc = id(r?.account), start = date(r?.start);
  const kind = ['expense', 'income', 'transfer'].includes(r?.kind) ? r.kind : 'expense';
  if (!rid || !acc || !start) return null;
  return {
    id: rid, name: str(r.name, 80) || 'Scadenza', kind, amount: int(r.amount, 0, 1e13), account: acc,
    toAccount: kind === 'transfer' ? id(r.toAccount) : null, category: kind === 'transfer' ? null : id(r.category),
    payee: str(r.payee, 120), unit: ['day', 'week', 'month', 'year'].includes(r.unit) ? r.unit : 'month',
    every: int(r.every, 1, 120) || 1, start, end: date(r.end), autoPost: bool(r.autoPost), active: bool(r.active, true),
    subscription: bool(r.subscription), lastPosted: date(r.lastPosted), notes: str(r.notes, 1000), emoji: emoji(r.emoji), created: int(r.created, 0),
  };
}
function cleanGoal(g) {
  const gid = id(g?.id); if (!gid) return null;
  return {
    id: gid, name: str(g.name, 60) || 'Obiettivo', emoji: emoji(g.emoji) || '🎯', target: int(g.target, 0, 1e13), date: date(g.date),
    account: id(g.account), color: COLOR.test(g.color) ? g.color : '', archived: bool(g.archived), created: int(g.created, 0),
    contributions: arr(g.contributions).map(c => (id(c?.id) && date(c?.date) ? { id: c.id, date: c.date, amount: int(c.amount, -1e13, 1e13), note: str(c.note, 200) } : null)).filter(Boolean),
  };
}
function cleanHolding(h) {
  const hid = id(h?.id), acc = id(h?.account); if (!hid || !acc) return null;
  return {
    id: hid, account: acc, symbol: str(h.symbol, 24).toUpperCase(), isin: str(h.isin, 12).toUpperCase(), name: str(h.name, 80) || str(h.symbol, 24) || 'Titolo',
    cls: ASSET_CLASSES[h.cls] ? h.cls : 'other', currency: cur(h.currency), price: num(h.price, 0, 0, 1e12), priceDate: date(h.priceDate), priceAuto: bool(h.priceAuto, true),
    group: str(h.group, 40), ter: num(h.ter, 0, 0, 10), created: int(h.created, 0),
    ops: arr(h.ops).map(o => {
      const oid = id(o?.id), d = date(o?.date), type = ['buy', 'sell', 'div', 'fee'].includes(o?.type) ? o.type : null;
      if (!oid || !d || !type) return null;
      return { id: oid, date: d, type, qty: num(o.qty, 0, 0, 1e12), price: num(o.price, 0, 0, 1e12), fee: num(o.fee, 0, 0, 1e9), tax: o.type === 'sell' ? num(o.tax, 0, 0, 1e9) : 0, amount: num(o.amount, 0, -1e12, 1e12), cash: bool(o.cash), note: str(o.note, 300), created: int(o.created, 0) };
    }).filter(Boolean),
  };
}

/** Ripulisce uno stato qualunque (anche di un backup) e lo porta alla versione attuale. Non lancia mai errori. */
export function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const s = raw;
  const set = s.settings && typeof s.settings === 'object' ? s.settings : {};
  const out = {
    v: SCHEMA_VERSION,
    meta: {
      created: int(s.meta?.created, 0) || d.meta.created, updated: int(s.meta?.updated, 0) || d.meta.updated,
      lastBackup: int(s.meta?.lastBackup, 0), changesSinceBackup: int(s.meta?.changesSinceBackup, 0),
    },
    settings: {
      currency: cur(set.currency), theme: ['auto', 'light', 'dark'].includes(set.theme) ? set.theme : 'auto',
      lockMinutes: [0, 1, 2, 5, 10, 15, 30, 60].includes(set.lockMinutes) ? set.lockMinutes : 5,
      hideAmounts: bool(set.hideAmounts), name: str(set.name, 60),
      market: { enabled: bool(set.market?.enabled), proxies: bool(set.market?.proxies, true), portfolioProxies: bool(set.market?.portfolioProxies) },
      backupDays: [0, 7, 14, 30].includes(set.backupDays) ? set.backupDays : 14,
      onboarded: bool(set.onboarded),
    },
    accounts: arr(s.accounts).map(cleanAccount).filter(Boolean),
    valuations: arr(s.valuations).map(cleanValuation).filter(Boolean),
    categories: arr(s.categories).map(cleanCategory).filter(Boolean),
    transactions: arr(s.transactions).map(cleanTx).filter(Boolean),
    recurring: arr(s.recurring).map(cleanRecurring).filter(Boolean),
    budgets: {},
    goals: arr(s.goals).map(cleanGoal).filter(Boolean),
    holdings: arr(s.holdings).map(cleanHolding).filter(Boolean),
    snapshots: {},
    rules: arr(s.rules).map(r => (id(r?.id) && str(r.match, 80) ? { id: r.id, match: str(r.match, 80).toLowerCase(), category: id(r.category), payee: str(r.payee, 120) } : null)).filter(Boolean),
    sims: s.sims && typeof s.sims === 'object' ? JSON.parse(JSON.stringify(s.sims, (k, v) => (typeof v === 'string' ? v.slice(0, 200) : v))) : {},
    watchlist: arr(s.watchlist).map(w => (str(w?.symbol, 24) ? { symbol: str(w.symbol, 24).toUpperCase(), name: str(w.name, 80) } : null)).filter(Boolean).slice(0, 200),
    fx: { rates: { EUR: 1 }, date: date(s.fx?.date) || '' },
  };
  if (!out.categories.length) out.categories = d.categories;
  if (s.budgets && typeof s.budgets === 'object') {
    for (const [k, v] of Object.entries(s.budgets)) if (id(k) && int(v, 0) > 0) out.budgets[k] = int(v, 0, 1e13);
  }
  if (s.snapshots && typeof s.snapshots === 'object') {
    for (const [k, v] of Object.entries(s.snapshots)) {
      if (!/^\d{4}-\d{2}$/.test(k) || !v || typeof v !== 'object' || !v.byAcc || typeof v.byAcc !== 'object') continue;
      const byAcc = {};
      for (const [a, c] of Object.entries(v.byAcc)) if (id(a)) byAcc[a] = int(c);
      out.snapshots[k] = { byAcc, at: int(v.at, 0) };
    }
  }
  if (s.fx?.rates && typeof s.fx.rates === 'object') {
    for (const [k, v] of Object.entries(s.fx.rates)) if (isCurrency(k) && num(v, 0) > 0) out.fx.rates[k] = num(v, 1, 1e-6, 1e7);
  }
  out.fx.rates[out.settings.currency] = 1;
  // unicità degli id (un backup fuso male non deve creare doppioni)
  for (const key of ['accounts', 'valuations', 'categories', 'transactions', 'recurring', 'goals', 'holdings', 'rules']) {
    const seen = new Set();
    out[key] = out[key].filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }
  return out;
}

/* ═══ Conti derivati ═══════════════════════════════════════════════════════
   Saldo di un conto: si parte da un "punto fermo" (saldo iniziale o saldo
   verificato in una data) e si sommano i movimenti successivi. Un movimento dello
   stesso giorno conta se è stato inserito dopo il punto fermo. Prima del primo
   punto fermo il saldo si ricostruisce all'indietro. */

const keyLess = (aDate, aCreated, bDate, bCreated) => aDate < bDate || (aDate === bDate && aCreated < bCreated);

export function txDelta(tx, accId) {
  if (tx.kind === 'expense') return tx.account === accId ? -tx.amount : 0;
  if (tx.kind === 'income') return tx.account === accId ? tx.amount : 0;
  let d = 0;
  if (tx.account === accId) d -= tx.amount;
  if (tx.toAccount === accId) d += tx.amountTo ?? tx.amount;
  return d;
}

/** Indice veloce: per ogni conto i movimenti ordinati con le somme progressive. */
export function buildLedger(state) {
  const byAcc = new Map();
  const push = (acc, t, delta) => {
    let L = byAcc.get(acc);
    if (!L) byAcc.set(acc, (L = { items: [] }));
    L.items.push({ date: t.date, created: t.created, delta });
  };
  for (const t of state.transactions) {
    push(t.account, t, txDelta(t, t.account));
    if (t.kind === 'transfer' && t.toAccount) push(t.toAccount, t, txDelta(t, t.toAccount));
  }
  for (const L of byAcc.values()) {
    L.items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created - b.created));
    L.prefix = new Array(L.items.length + 1);
    L.prefix[0] = 0;
    for (let i = 0; i < L.items.length; i++) L.prefix[i + 1] = L.prefix[i] + L.items[i].delta;
  }
  const cps = new Map();
  for (const v of state.valuations) {
    let a = cps.get(v.account);
    if (!a) cps.set(v.account, (a = []));
    a.push(v);
  }
  for (const a of cps.values()) a.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.created - y.created));
  return { byAcc, cps };
}

// numero di movimenti con chiave < (date, created)
function countBefore(items, d, c) {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyLess(items[mid].date, items[mid].created, d, c)) lo = mid + 1; else hi = mid;
  }
  return lo;
}
// numero di movimenti con data <= d
function countUpTo(items, d) {
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (items[mid].date <= d) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Saldo "di cassa" del conto (movimenti + punti fermi) alla fine del giorno asOf, in centesimi della valuta del conto. */
export function cashBalance(ledger, accId, asOf) {
  const L = ledger.byAcc.get(accId) || { items: [], prefix: [0] };
  const cps = ledger.cps.get(accId) || [];
  const upTo = countUpTo(L.items, asOf);
  if (!cps.length) return L.prefix[upTo];
  // ultimo punto fermo con data <= asOf
  let lo = 0, hi = cps.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cps[mid].date <= asOf) lo = mid + 1; else hi = mid; }
  if (lo > 0) {
    const cp = cps[lo - 1];
    const after = countBefore(L.items, cp.date, cp.created + 0.5);   // movimenti fino al punto fermo compreso
    return cp.value + (upTo > after ? L.prefix[upTo] - L.prefix[after] : 0);
  }
  const cp = cps[0];
  const until = countBefore(L.items, cp.date, cp.created + 0.5);
  return cp.value - (until > upTo ? L.prefix[until] - L.prefix[upTo] : 0);
}

/* ─── Investimenti: posizione col metodo del costo medio ponderato (come in Italia) ─── */
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created - b.created);
export function position(h, asOf) {
  const ops = [...h.ops].filter(o => !asOf || o.date <= asOf).sort(byDate);
  let qty = 0, cost = 0, realized = 0, dividends = 0, fees = 0, taxes = 0, invested = 0;
  for (const o of ops) {
    if (o.type === 'buy') { qty += o.qty; cost += o.qty * o.price + o.fee; invested += o.qty * o.price + o.fee; fees += o.fee; }
    else if (o.type === 'sell') {
      const q = Math.min(o.qty, qty);
      const avg = qty > 0 ? cost / qty : 0;
      // guadagno realizzato al netto di commissioni e dell'imposta trattenuta dal broker
      realized += q * o.price - o.fee - (o.tax || 0) - avg * q;
      cost -= avg * q; qty -= q; fees += o.fee; taxes += o.tax || 0;
      if (qty < 1e-12) { qty = 0; cost = 0; }
    } else if (o.type === 'div') dividends += o.amount;
    else if (o.type === 'fee') { fees += Math.abs(o.amount); realized -= Math.abs(o.amount); }
  }
  const value = qty * (h.price || 0);
  return { qty, cost, avg: qty > 0 ? cost / qty : 0, value, unrealized: value - cost, unrealizedPct: cost > 0 ? (value - cost) / cost * 100 : 0, realized, dividends, fees, taxes, invested };
}

/** Movimenti che, sui conti investimenti, sono costi dell'investire: categorie "Tasse e imposte" e
    "Commissioni bancarie", o descrizione con "bollo" (l'imposta di bollo sui titoli). */
export const INVEST_COST_CATS = ['c-tasse', 'c-banca'];
const isInvestCost = t => t.kind === 'expense' && (INVEST_COST_CATS.includes(t.category) || /bollo/i.test(t.payee));

/** Soldi messi e tolti dagli investimenti, operazione per operazione, nella valuta principale (centesimi).
    Investito netto = acquisti con commissioni − vendite al netto di commissioni e imposta trattenuta,
    come la colonna "totale" di un foglio dei PAC. In più: commissioni, imposte, cedole, guadagni
    realizzati e le spese pagate dalla liquidità dei conti investimenti (imposta di bollo).
    Gli importi in altre valute usano il cambio attuale. */
export function investmentFlows(state, toBase) {
  const rows = [];
  for (const h of state.holdings) {
    let qty = 0, cost = 0;
    const c = x => toBase(Math.round(x * 100), h.currency);
    for (const o of [...h.ops].sort(byDate)) {
      const r = { date: o.date, holding: h, op: o, net: 0, qty: 0, fees: 0, taxes: 0, income: 0, realized: 0 };
      if (o.type === 'buy') {
        r.net = c(o.qty * o.price + o.fee); r.fees = c(o.fee); r.qty = o.qty;
        qty += o.qty; cost += o.qty * o.price + o.fee;
      } else if (o.type === 'sell') {
        const q = Math.min(o.qty, qty), avg = qty > 0 ? cost / qty : 0;
        const tax = o.tax || 0;
        r.net = -c(o.qty * o.price - o.fee - tax); r.fees = c(o.fee); r.taxes = c(tax); r.qty = -o.qty;
        r.realized = c(q * o.price - o.fee - tax - avg * q);
        cost -= avg * q; qty -= q;
        if (qty < 1e-12) { qty = 0; cost = 0; }
      } else if (o.type === 'div') r.income = c(o.amount);
      else if (o.type === 'fee') { r.fees = c(Math.abs(o.amount)); r.realized = -r.fees; }
      rows.push(r);
    }
  }
  rows.sort((a, b) => byDate(a.op, b.op));
  const accs = new Map(state.accounts.filter(hasHoldings).map(a => [a.id, a]));
  const costs = state.transactions
    .filter(t => accs.has(t.account) && isInvestCost(t))
    .map(t => ({ date: t.date, tx: t, amount: toBase(t.amount, accs.get(t.account).currency) }));

  const months = new Map();
  const years = new Map();
  const yr = y => {
    let v = years.get(y);
    if (!v) years.set(y, (v = { net: 0, buys: 0, sells: 0, fees: 0, taxes: 0, income: 0, realized: 0, costs: 0, firstMonth: 12 }));
    return v;
  };
  for (const r of rows) {
    const m = r.date.slice(0, 7), y = +r.date.slice(0, 4), Y = yr(y);
    if (r.op.type === 'buy' || r.op.type === 'sell') {
      months.set(m, (months.get(m) || 0) + r.net);
      Y.firstMonth = Math.min(Y.firstMonth, +m.slice(5));
      if (r.net >= 0) Y.buys += r.net; else Y.sells -= r.net;
    }
    Y.net += r.net; Y.fees += r.fees; Y.taxes += r.taxes; Y.income += r.income; Y.realized += r.realized;
  }
  for (const k of costs) yr(+k.date.slice(0, 4)).costs += k.amount;
  const yearList = [...years.keys()].sort((a, b) => a - b);
  const total = rows.reduce((a, r) => a + r.net, 0);
  const firstMonth = [...months.keys()].sort()[0] || null;

  /** Investito netto per gruppo (tipo, categoria, titolo…) e per anno. */
  function pivot(keyOf) {
    const out = new Map();
    for (const r of rows) {
      if (r.op.type !== 'buy' && r.op.type !== 'sell') continue;
      const k = keyOf(r.holding);
      let g = out.get(k);
      if (!g) out.set(k, (g = { key: k, total: 0, qty: 0, byYear: new Map(), qtyByYear: new Map() }));
      const y = +r.date.slice(0, 4);
      g.byYear.set(y, (g.byYear.get(y) || 0) + r.net);
      g.qtyByYear.set(y, (g.qtyByYear.get(y) || 0) + r.qty);
      g.total += r.net;
      g.qty += r.qty;
    }
    return out;
  }
  /** Mesi su cui fare la media dell'anno: dal primo mese con operazioni (gennaio se si investiva già
      prima) a dicembre, o al mese di riferimento per l'anno in corso. */
  function monthsIn(y, refDate) {
    const Y = years.get(y);
    if (!Y) return 0;
    const from = yearList[0] === y ? Y.firstMonth : 1;
    const ry = +refDate.slice(0, 4), rm = +refDate.slice(5, 7);
    const to = y === ry ? rm : y > ry ? 0 : 12;
    return Math.max(1, to - from + 1);
  }
  return { rows, costs, months, years, yearList, total, firstMonth, pivot, monthsIn };
}

/** Rate già pagate di un piano alla data (la prima un mese dopo l'inizio). */
export function paidInstallments(plan, asOf) {
  if (!plan || asOf < plan.start) return 0;
  let n = diffMonths(plan.start, asOf);
  if (addMonths(plan.start, n) > asOf) n--;
  return Math.max(0, Math.min(plan.months, n));
}

/** Fotografia del mese: valore di mercato dei titoli per conto (serve allo storico del patrimonio). */
export function snapshotMonth(state, d, refDate = today()) {
  const byAcc = {};
  for (const a of state.accounts) if (hasHoldings(a)) byAcc[a.id] = d.holdingsValue(a, refDate);
  state.snapshots[monthKey(refDate)] = { byAcc, at: Date.now() };
}

/** Effetto sulla liquidità del conto delle operazioni "pagate con la liquidità" (valuta del titolo). */
export function opsCash(h, asOf) {
  let c = 0;
  for (const o of h.ops) {
    if (!o.cash || (asOf && o.date > asOf)) continue;
    if (o.type === 'buy') c -= o.qty * o.price + o.fee;
    else if (o.type === 'sell') c += o.qty * o.price - o.fee - (o.tax || 0);
    else if (o.type === 'div') c += o.amount;
    else if (o.type === 'fee') c -= Math.abs(o.amount);
  }
  return c;
}

/* ─── Pacchetto di calcoli derivati, rifatto solo quando lo stato cambia ─── */
export function derive(state, refDate = today()) {
  const base = state.settings.currency;
  const rates = state.fx.rates;
  const ledger = buildLedger(state);
  const accById = new Map(state.accounts.map(a => [a.id, a]));
  const catById = new Map(state.categories.map(c => [c.id, c]));
  const holdingsByAcc = new Map();
  for (const h of state.holdings) {
    let a = holdingsByAcc.get(h.account);
    if (!a) holdingsByAcc.set(h.account, (a = []));
    a.push(h);
  }
  const toBase = (cents, currency) => convert(cents, currency, base, rates);
  const missingFx = new Set();
  for (const a of state.accounts) if (a.currency !== base && !rates[a.currency]) missingFx.add(a.currency);
  for (const h of state.holdings) if (h.currency !== base && !rates[h.currency]) missingFx.add(h.currency);

  /** Valore del conto in valuta del conto, alla data. */
  function accountValue(acc, asOf = refDate) {
    // mutuo/prestito con piano: il debito residuo segue il piano d'ammortamento (le rate si registrano come spese)
    if (hasPlan(acc)) return -Math.round(loanResidual(acc.plan, paidInstallments(acc.plan, asOf)) * 100);
    let v = cashBalance(ledger, acc.id, asOf);
    if (hasHoldings(acc)) v += holdingsCash(acc, asOf) + holdingsValue(acc, asOf);
    return v;
  }
  /** Titoli del conto in valuta del conto: quantità alla data × prezzo attuale
      (per i mesi passati, se c'è, vale la fotografia salvata quel mese). */
  function holdingsValue(acc, asOf = refDate) {
    const hs = holdingsByAcc.get(acc.id) || [];
    let v = 0;
    for (const h of hs) v += convert(Math.round(position(h, asOf).value * 100), h.currency, acc.currency, rates);
    return v;
  }
  /** Liquidità mossa dalle operazioni sui titoli (acquisti pagati dal conto, vendite, cedole). */
  function holdingsCash(acc, asOf = refDate) {
    let v = 0;
    for (const h of holdingsByAcc.get(acc.id) || []) v += convert(Math.round(opsCash(h, asOf) * 100), h.currency, acc.currency, rates);
    return v;
  }

  const balances = new Map();
  for (const a of state.accounts) balances.set(a.id, accountValue(a));

  /* ─── Patrimonio, oggi e nel tempo ───
     Contano i conti con "Conta nel patrimonio" (anche se archiviati: un conto chiuso deve
     restare nello storico dei mesi in cui esisteva). Un conto esiste dal primo punto fermo,
     movimento o operazione (mutui e prestiti: dall'inizio del piano); prima vale "—". */
  const nwAccounts = state.accounts.filter(a => a.inNetWorth);
  const startByAcc = new Map();
  for (const a of state.accounts) {
    let s = null;
    const upd = d => { if (d && (!s || d < s)) s = d; };
    if (hasPlan(a)) upd(a.plan.start);
    else {
      upd(ledger.cps.get(a.id)?.[0]?.date);
      upd(ledger.byAcc.get(a.id)?.items[0]?.date);
      for (const h of holdingsByAcc.get(a.id) || []) for (const o of h.ops) upd(o.date);
    }
    startByAcc.set(a.id, s);
  }
  const groupTotals = { liquidity: 0, investments: 0, assets: 0, debt: 0 };
  for (const a of nwAccounts) groupTotals[ACCOUNT_TYPES[a.type].group] += toBase(balances.get(a.id), a.currency);
  const assets = groupTotals.liquidity + groupTotals.investments + groupTotals.assets;
  const netWorth = assets + groupTotals.debt;

  /** Valore del conto (valuta del conto) a fine giornata `date`; null se a quella data non esisteva ancora.
      Per i titoli nei mesi passati: la fotografia salvata quel mese, altrimenti quantità di allora × prezzo attuale. */
  function valueAt(acc, date) {
    if (date >= refDate) return balances.get(acc.id);
    const s = startByAcc.get(acc.id);
    if (!s || date < s) return null;
    let v = accountValue(acc, date);
    if (hasHoldings(acc)) {
      const m = monthKey(date);
      const snap = state.snapshots[m]?.byAcc?.[acc.id];
      if (snap != null && date === monthEnd(m)) v += snap - holdingsValue(acc, date);
    }
    return v;
  }

  /** Patrimonio a una data: totale, gruppi e conto per conto (valuta principale; null = non esisteva). */
  function netWorthAt(date) {
    const groups = { liquidity: 0, investments: 0, assets: 0, debt: 0 };
    const byAcc = new Map();
    let total = 0;
    for (const a of nwAccounts) {
      const v = valueAt(a, date);
      if (v == null) { byAcc.set(a.id, null); continue; }
      const b = toBase(v, a.currency);
      byAcc.set(a.id, b);
      groups[ACCOUNT_TYPES[a.type].group] += b;
      total += b;
    }
    return { date, total, groups, byAcc, assets: groups.liquidity + groups.investments + groups.assets };
  }

  /** Fine del mese (o oggi, per il mese in corso; null per i mesi futuri). */
  const monthClose = m => (monthStart(m) > refDate ? null : monthEnd(m) > refDate ? refDate : monthEnd(m));
  /** Fine dell'anno (o oggi, per l'anno in corso). */
  const yearClose = y => (`${y}-12-31` > refDate ? refDate : `${y}-12-31`);
  /** Primo anno con dati. */
  const firstDate = [...startByAcc.entries()].filter(([id, s]) => s && nwAccounts.some(a => a.id === id)).map(([, s]) => s).sort()[0] || refDate;

  /** Patrimonio netto a fine mese per gli ultimi n mesi. */
  function netWorthHistory(n = 12) {
    return lastMonths(n, monthKey(refDate)).map(m => {
      const x = netWorthAt(monthClose(m));
      return { month: m, total: x.total, liq: x.groups.liquidity, inv: x.groups.investments, assets: x.assets, other: x.groups.assets, debt: x.groups.debt };
    });
  }

  /* Flussi: entrate e uscite per mese (i giroconti tra conti non contano). */
  const txBase = t => toBase(t.amount, accById.get(t.account)?.currency || base);
  function flows(from, to) {
    let income = 0, expense = 0;
    const byCat = new Map();
    for (const t of state.transactions) {
      if (t.kind === 'transfer' || t.date < from || t.date > to) continue;
      const v = txBase(t);
      if (t.kind === 'income') income += v; else expense += v;
      const k = t.category || (t.kind === 'income' ? '_inc' : '_exp');
      byCat.set(k, (byCat.get(k) || 0) + v);
    }
    return { income, expense, net: income - expense, byCat };
  }
  function monthlyFlows(n = 12) {
    return lastMonths(n, monthKey(refDate)).map(m => ({ month: m, ...flows(monthStart(m), monthEnd(m)) }));
  }

  /* Budget del mese */
  function budget(month = monthKey(refDate)) {
    const f = flows(monthStart(month), monthEnd(month));
    const rows = [];
    let planned = 0, spent = 0;
    for (const [cat, amt] of Object.entries(state.budgets)) {
      const c = catById.get(cat);
      if (!c || c.kind !== 'expense') continue;
      const s = f.byCat.get(cat) || 0;
      planned += amt; spent += s;
      rows.push({ category: c, planned: amt, spent: s, left: amt - s, pct: amt > 0 ? s / amt : 0 });
    }
    rows.sort((a, b) => b.pct - a.pct);
    let unplanned = 0;
    for (const [cat, s] of f.byCat) {
      const c = catById.get(cat);
      if ((c && c.kind === 'expense' && !state.budgets[cat]) || cat === '_exp') unplanned += s;
    }
    const isCurrent = month === monthKey(refDate);
    const [y, mm] = month.split('-').map(Number);
    const dim = new Date(y, mm, 0).getDate();
    const day = isCurrent ? Number(refDate.slice(8, 10)) : dim;
    return { month, rows, planned, spent, unplanned, totalSpent: f.expense, income: f.income, progress: day / dim, projected: isCurrent && day > 0 ? Math.round(f.expense / day * dim) : f.expense };
  }

  /* Scadenze */
  function dueList(upTo = refDate) {
    const out = [];
    for (const r of state.recurring) {
      if (!r.active) continue;
      const from = r.lastPosted ? addDays(r.lastPosted, 1) : r.start;
      for (const d of occurrences(r, from, upTo, 120)) out.push({ rule: r, date: d });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function upcoming(days = 30) {
    const out = [];
    const end = addDays(refDate, days);
    for (const r of state.recurring) {
      if (!r.active) continue;
      const from = r.lastPosted && addDays(r.lastPosted, 1) > refDate ? addDays(r.lastPosted, 1) : addDays(refDate, 1);
      for (const d of occurrences(r, from, end, 60)) out.push({ rule: r, date: d });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const ruleBase = r => toBase(r.amount, accById.get(r.account)?.currency || base);
  const subscriptions = state.recurring.filter(r => r.active && r.kind === 'expense');
  const fixedMonthly = subscriptions.reduce((a, r) => a + ruleBase(r) * perYear(r) / 12, 0);
  const recurringIncomeMonthly = state.recurring.filter(r => r.active && r.kind === 'income').reduce((a, r) => a + ruleBase(r) * perYear(r) / 12, 0);

  /* Obiettivi */
  function goal(g) {
    const saved = g.account && accById.get(g.account)
      ? toBase(balances.get(g.account) || 0, accById.get(g.account).currency)
      : g.contributions.reduce((a, c) => a + c.amount, 0);
    const pct = g.target > 0 ? Math.max(0, Math.min(1, saved / g.target)) : 0;
    let perMonth = null, monthsLeft = null;
    if (g.date && g.date > refDate) {
      monthsLeft = Math.max(1, Math.ceil(diffDays(refDate, g.date) / 30.44));
      perMonth = Math.max(0, Math.ceil((g.target - saved) / monthsLeft));
    }
    return { saved, pct, left: Math.max(0, g.target - saved), perMonth, monthsLeft, done: saved >= g.target && g.target > 0 };
  }

  /* Portafoglio */
  function portfolio() {
    const rows = state.holdings.map(h => {
      const p = position(h);
      const acc = accById.get(h.account);
      return {
        holding: h, account: acc, ...p,
        valueBase: toBase(Math.round(p.value * 100), h.currency),
        costBase: toBase(Math.round(p.cost * 100), h.currency),
        realizedBase: toBase(Math.round(p.realized * 100), h.currency),
        dividendsBase: toBase(Math.round(p.dividends * 100), h.currency),
        terBase: toBase(Math.round(p.value * (h.ter || 0)), h.currency),   // costo annuo del fondo: valore × TER%
        taxRate: ASSET_CLASSES[h.cls]?.tax ?? 26,
      };
    }).filter(r => r.account && !r.account.archived);
    const value = rows.reduce((a, r) => a + r.valueBase, 0);
    const cost = rows.reduce((a, r) => a + r.costBase, 0);
    const byClass = new Map();
    for (const r of rows) if (r.qty > 0) byClass.set(r.holding.cls, (byClass.get(r.holding.cls) || 0) + r.valueBase);
    const taxIfSold = rows.reduce((a, r) => a + Math.max(0, r.valueBase - r.costBase) * r.taxRate / 100, 0);
    return {
      rows, value, cost, gain: value - cost, gainPct: cost > 0 ? (value - cost) / cost * 100 : 0,
      realized: rows.reduce((a, r) => a + r.realizedBase, 0), dividends: rows.reduce((a, r) => a + r.dividendsBase, 0),
      byClass, taxIfSold: Math.round(taxIfSold), bolloYear: Math.round(value * 0.002),
      terYear: rows.reduce((a, r) => a + r.terBase, 0), hasTer: rows.some(r => r.qty > 0 && r.holding.ter > 0),
    };
  }

  /* Investito mese per mese e anno per anno, tasse e costi */
  let investCache = null;
  const invest = () => investCache || (investCache = investmentFlows(state, toBase));

  return {
    base, rates, ledger, accById, catById, holdingsByAcc, missingFx,
    balances, groupTotals, assets, netWorth, accountValue, holdingsValue, holdingsCash, toBase, txBase,
    nwAccounts, startByAcc, valueAt, netWorthAt, monthClose, yearClose, firstDate,
    netWorthHistory, flows, monthlyFlows, budget, dueList, upcoming, fixedMonthly, recurringIncomeMonthly, goal, portfolio, invest,
    refDate,
  };
}

/* ─── Categorizzazione automatica ─── */
export function suggestCategory(state, text, kind) {
  const q = (text || '').toLowerCase().trim();
  if (!q) return null;
  for (const r of state.rules) {
    const c = state.categories.find(x => x.id === r.category);
    if (c && (!kind || c.kind === kind) && q.includes(r.match)) return { category: r.category, payee: r.payee || null };
  }
  // impara dai movimenti già fatti: stesso beneficiario → stessa categoria più usata
  const counts = new Map();
  for (let i = state.transactions.length - 1, n = 0; i >= 0 && n < 4000; i--, n++) {
    const t = state.transactions[i];
    if (!t.category || (kind && t.kind !== kind)) continue;
    const p = t.payee.toLowerCase();
    if (p && (p === q || (q.length >= 4 && (p.includes(q) || q.includes(p))))) counts.set(t.category, (counts.get(t.category) || 0) + (p === q ? 3 : 1));
  }
  let best = null, bc = 0;
  for (const [c, n] of counts) if (n > bc) { best = c; bc = n; }
  return best ? { category: best, payee: null } : null;
}

/** Impronta per riconoscere i doppioni negli import. */
export function importHash(t) {
  const s = `${t.account}|${t.date}|${t.kind}|${t.amount}|${(t.payee || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

export { nextOccurrence };
