/* Dati di esempio per la modalità prova: inventati, con date relative a oggi. */

import { defaults, uid, sanitize, position } from './core/model.js';
import { today, addMonths, addDays, monthKey, toISO, parts, daysInMonth } from './core/dates.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function demoState() {
  const r = rng(20261029);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => Math.round(a + r() * (b - a));
  const s = defaults();
  const t0 = today();
  const MONTHS = 22;                                   // quasi due anni di storia
  const start = addMonths(t0, -MONTHS).slice(0, 8) + '01';
  let created = 1;
  s.settings.name = 'Alex';
  s.settings.onboarded = true;
  s.settings.market.enabled = false;
  s.fx = { rates: { EUR: 1, USD: 1.08, GBP: 0.85, CHF: 0.94 }, date: t0 };

  const acc = (id, name, type, extra = {}) => { s.accounts.push({ id, name, type, institution: extra.institution || '', currency: extra.currency || 'EUR', emoji: extra.emoji || '', color: '', archived: false, inNetWorth: true, notes: '', created: created++, order: s.accounts.length, plan: extra.plan || null }); };
  const open = (account, value, date = start) => s.valuations.push({ id: uid('v-'), account, date, value, created: 0, kind: 'open', note: 'Saldo iniziale' });
  acc('a-cc', 'Conto principale', 'checking', { institution: 'Banca Esempio' });
  acc('a-cd', 'Conto deposito', 'savings', { institution: 'Deposito Esempio' });
  acc('a-cash', 'Contanti', 'cash');
  acc('a-card', 'Carta di credito', 'card', { institution: 'Banca Esempio' });
  acc('a-brk', 'Broker', 'broker', { institution: 'Broker Esempio' });
  acc('a-btc', 'Wallet crypto', 'crypto');
  acc('a-car', 'Auto', 'vehicle', { emoji: '🚗' });
  acc('a-mut', 'Mutuo casa', 'mortgage', { institution: 'Banca Esempio', plan: { principal: 140000, tan: 3.1, months: 300, start: addMonths(t0, -38), type: 'francese' } });
  acc('a-casa', 'Casa', 'property', { emoji: '🏡' });
  open('a-cc', 420000); open('a-cd', 1200000); open('a-cash', 12000); open('a-card', 0); open('a-brk', 150000); open('a-btc', 0);
  open('a-car', 1250000);
  s.valuations.push({ id: uid('v-'), account: 'a-car', date: addMonths(t0, -12), value: 1100000, created: 4, kind: 'adjust', note: 'Valutazione' });
  s.valuations.push({ id: uid('v-'), account: 'a-car', date: addMonths(t0, -1), value: 980000, created: 5, kind: 'adjust', note: 'Valutazione' });
  s.valuations.push({ id: uid('v-'), account: 'a-casa', date: addMonths(t0, -10).slice(0, 8) + '28', value: 21800000, created: 6, kind: 'adjust', note: 'Stima agenzia' });
  open('a-casa', 21000000, addMonths(t0, -38));

  const tx = (date, kind, amount, account, category, payee, extra = {}) => {
    if (date > t0) return;
    s.transactions.push({ id: uid('t-'), date, kind, amount, account, toAccount: extra.to || null, amountTo: extra.to ? amount : null, category: kind === 'transfer' ? null : category, payee, note: extra.note || '', tags: extra.tags || [], recurring: extra.rec || null, created: created++, updated: 0, importHash: '', flagged: false });
  };

  // scadenze
  const rec = (id, name, kind, amount, account, category, unit, every, startDate, extra = {}) => s.recurring.push({ id, name, kind, amount, account, toAccount: extra.to || null, category, payee: name, unit, every, start: startDate, end: null, autoPost: !!extra.auto, active: true, subscription: !!extra.sub, lastPosted: null, notes: '', emoji: extra.emoji || '', created: created++ });
  const m0 = start.slice(0, 7);
  rec('r-stip', 'Stipendio', 'income', 185000, 'a-cc', 'i-stip', 'month', 1, m0 + '-27', { auto: true });
  rec('r-mutuo', 'Rata mutuo', 'expense', 67200, 'a-cc', 'c-casa', 'month', 1, s.accounts.find(a => a.id === 'a-mut').plan.start.slice(0, 8) + parts(s.accounts.find(a => a.id === 'a-mut').plan.start).d.toString().padStart(2, '0'), { auto: true });
  rec('r-luce', 'Luce e gas', 'expense', 9800, 'a-cc', 'c-bollette', 'month', 2, m0 + '-12');
  rec('r-tel', 'Fibra e telefono', 'expense', 2990, 'a-cc', 'c-tel', 'month', 1, m0 + '-05', { auto: true });
  rec('r-netflix', 'Netflix', 'expense', 1399, 'a-card', 'c-abbon', 'month', 1, m0 + '-18', { auto: true, sub: true });
  rec('r-spotify', 'Spotify', 'expense', 1199, 'a-card', 'c-abbon', 'month', 1, m0 + '-03', { auto: true, sub: true });
  rec('r-icloud', 'iCloud+', 'expense', 299, 'a-card', 'c-abbon', 'month', 1, m0 + '-09', { auto: true, sub: true });
  rec('r-palestra', 'Palestra', 'expense', 4900, 'a-cc', 'c-sport', 'month', 1, m0 + '-02', { sub: true });
  rec('r-pac', 'PAC ETF', 'transfer', 30000, 'a-cc', null, 'month', 1, m0 + '-28', { to: 'a-brk', auto: true });
  rec('r-risp', 'Risparmio mensile', 'transfer', 20000, 'a-cc', null, 'month', 1, m0 + '-28', { to: 'a-cd', auto: true });
  rec('r-ass', 'Assicurazione auto', 'expense', 48000, 'a-cc', 'c-auto', 'year', 1, addMonths(t0, 2).slice(0, 8) + '15');
  rec('r-carta', 'Saldo carta di credito', 'transfer', 0, 'a-cc', null, 'month', 1, m0 + '-15', { to: 'a-card' });

  // movimenti mese per mese
  let cardSpent = 0;
  for (let k = 0; ; k++) {
    const mStart = addMonths(start, k);
    if (mStart > t0) break;
    const { y, m } = parts(mStart);
    const dim = daysInMonth(y, m);
    const D = d => toISO(y, m, Math.min(d, dim));
    tx(D(27), 'income', 185000, 'a-cc', 'i-stip', 'Stipendio', { rec: 'r-stip' });
    tx(D(5), 'expense', 2990, 'a-cc', 'c-tel', 'Fibra e telefono', { rec: 'r-tel' });
    tx(D(18), 'expense', 1399, 'a-card', 'c-abbon', 'Netflix', { rec: 'r-netflix' });
    tx(D(3), 'expense', 1199, 'a-card', 'c-abbon', 'Spotify', { rec: 'r-spotify' });
    tx(D(9), 'expense', 299, 'a-card', 'c-abbon', 'iCloud+', { rec: 'r-icloud' });
    tx(D(2), 'expense', 4900, 'a-cc', 'c-sport', 'Palestra', { rec: 'r-palestra' });
    tx(D(28), 'transfer', 30000, 'a-cc', null, 'PAC ETF', { to: 'a-brk', rec: 'r-pac' });
    tx(D(28), 'transfer', 20000, 'a-cc', null, 'Risparmio mensile', { to: 'a-cd', rec: 'r-risp' });
    const mutStart = s.accounts.find(a => a.id === 'a-mut').plan.start;
    tx(D(parts(mutStart).d), 'expense', 67200, 'a-cc', 'c-casa', 'Rata mutuo', { rec: 'r-mutuo' });
    if (m % 2 === 0) tx(D(12), 'expense', between(7800, 12800), 'a-cc', 'c-bollette', 'Luce e gas', { rec: 'r-luce' });
    // spesa ogni settimana
    for (let d = 2 + between(0, 2); d <= dim; d += 7) tx(D(d), 'expense', between(3800, 9200), pick(['a-cc', 'a-card']), 'c-spesa', pick(['Esselunga', 'Coop', 'Conad', 'Lidl', 'Mercato']));
    for (let i = 0; i < between(4, 7); i++) tx(D(between(1, dim)), 'expense', between(900, 5600), pick(['a-card', 'a-cc', 'a-cash']), 'c-rist', pick(['Trattoria da Gino', 'Sushi Zen', 'Pizzeria Bella Napoli', 'Bar Centrale', 'Bistrot 21']));
    for (let i = 0; i < between(2, 4); i++) tx(D(between(1, dim)), 'expense', between(4000, 7000), 'a-card', 'c-carb', pick(['Eni', 'Q8', 'IP']));
    tx(D(between(1, dim)), 'expense', between(1500, 4000), 'a-cc', 'c-trasp', pick(['Trenitalia', 'ATM', 'Italo']));
    if (r() < 0.7) tx(D(between(1, dim)), 'expense', between(2500, 14000), 'a-card', 'c-shop', pick(['Amazon', 'Zalando', 'IKEA', 'MediaWorld']));
    if (r() < 0.6) tx(D(between(1, dim)), 'expense', between(1500, 9000), 'a-cc', 'c-salute', pick(['Farmacia', 'Dentista', 'Ottico']));
    if (r() < 0.8) tx(D(between(1, dim)), 'expense', between(2000, 6000), 'a-card', 'c-svago', pick(['Cinema', 'Concerto', 'Teatro', 'Museo']));
    if (r() < 0.5) tx(D(between(1, dim)), 'income', between(30000, 90000), 'a-cc', 'i-cachet', pick(['Club Esempio', 'Festival Demo', 'Evento privato']), { tags: ['dj'] });
    if (m % 3 === 0) tx(D(20), 'income', between(8000, 26000), 'a-cc', 'i-roy', 'Etichetta Esempio', { note: 'Royalties trimestre' });
    if (r() < 0.25) tx(D(between(1, dim)), 'expense', between(8000, 45000), 'a-card', 'c-lavoro', pick(['Thomann', 'Negozio musicale']), { tags: ['dj'] });
    tx(D(between(1, dim)), 'transfer', 10000, 'a-cc', null, 'Prelievo', { to: 'a-cash' });
    tx(D(between(1, dim)), 'expense', between(1000, 4000), 'a-cash', 'c-rist', 'Caffè e colazioni');
    tx(D(between(1, 10)), 'expense', 250, 'a-cc', 'c-banca', 'Canone conto');
  }
  // la carta si salda il 15 di ogni mese con quanto speso il mese prima
  for (let k = 1; ; k++) {
    const mStart = addMonths(start, k);
    if (mStart > t0) break;
    const prevKey = monthKey(addMonths(start, k - 1));
    const spent = s.transactions.filter(t => t.account === 'a-card' && t.kind === 'expense' && monthKey(t.date) === prevKey).reduce((a, t) => a + t.amount, 0);
    cardSpent = spent;
    tx(mStart.slice(0, 8) + '15', 'transfer', spent, 'a-cc', null, 'Saldo carta di credito', { to: 'a-card', rec: 'r-carta' });
  }
  void cardSpent;
  // ultima registrazione delle scadenze
  for (const rr of s.recurring) {
    const own = s.transactions.filter(t => t.recurring === rr.id).map(t => t.date).sort();
    rr.lastPosted = own[own.length - 1] || null;
  }

  // investimenti
  const buyMonthly = (hid, priceFrom, priceTo, amount) => {
    const ops = [];
    for (let k = 0; ; k++) {
      const d = addMonths(start, k).slice(0, 8) + '28';
      if (d > t0) break;
      const price = (priceFrom + (priceTo - priceFrom) * (k / MONTHS)) * (1 + (r() - 0.5) * 0.03);
      ops.push({ id: uid('o-'), date: d, type: 'buy', qty: Math.round(amount / price * 1000) / 1000, price: Math.round(price * 100) / 100, fee: 0, amount: 0, cash: true, note: 'PAC', created: created++ });
    }
    return ops;
  };
  s.holdings.push({ id: 'h-vwce', account: 'a-brk', symbol: 'VWCE.DE', isin: 'IE00BK5BQT80', name: 'Vanguard FTSE All-World', cls: 'etf_eq', group: 'Azioni mondo', ter: 0.22, currency: 'EUR', price: 142.36, priceDate: t0, priceAuto: true, created: created++, ops: [
    { id: uid('o-'), date: addMonths(t0, -21), type: 'buy', qty: 60, price: 108.4, fee: 2.95, amount: 0, note: '', created: created++ },
    ...buyMonthly('h-vwce', 110, 141, 200),
  ] });
  s.holdings.push({ id: 'h-agg', account: 'a-brk', symbol: 'AGGH.MI', isin: 'IE00BDBRDM35', name: 'iShares Core Global Aggregate Bond', cls: 'etf_bd', group: 'Obbligazioni', ter: 0.1, currency: 'EUR', price: 4.79, priceDate: t0, priceAuto: true, created: created++, ops: buyMonthly('h-agg', 4.65, 4.8, 100) });
  s.holdings.push({ id: 'h-btp', account: 'a-brk', symbol: 'BTP-2030', isin: 'IT0005000000', name: 'BTP esempio 3,5% 2030', cls: 'gov', group: 'Obbligazioni', currency: 'EUR', price: 101.2, priceDate: t0, priceAuto: false, created: created++, ops: [
    { id: uid('o-'), date: addMonths(t0, -14), type: 'buy', qty: 50, price: 98.6, fee: 5, amount: 0, note: 'Nominale 5.000 €', created: created++ },
    { id: uid('o-'), date: addMonths(t0, -8), type: 'div', qty: 0, price: 0, fee: 0, amount: 76.56, note: 'Cedola netta', created: created++ },
    { id: uid('o-'), date: addMonths(t0, -2), type: 'div', qty: 0, price: 0, fee: 0, amount: 76.56, note: 'Cedola netta', created: created++ },
  ] });
  s.holdings.push({ id: 'h-aapl', account: 'a-brk', symbol: 'AAPL', isin: 'US0378331005', name: 'Apple', cls: 'stock', group: 'Azioni USA', currency: 'USD', price: 241.5, priceDate: t0, priceAuto: true, created: created++, ops: [
    { id: uid('o-'), date: addMonths(t0, -11), type: 'buy', qty: 8, price: 189.3, fee: 4, amount: 0, note: '', created: created++ },
    { id: uid('o-'), date: addMonths(t0, -3), type: 'sell', qty: 3, price: 230, fee: 4, tax: 30.32, amount: 0, cash: true, note: 'Ribilanciamento', created: created++ },
  ] });
  s.holdings.push({ id: 'h-gold', account: 'a-brk', symbol: 'SGLD.MI', isin: 'IE00B579F325', name: 'Invesco Physical Gold', cls: 'gold', group: 'Oro', ter: 0.12, currency: 'EUR', price: 248.1, priceDate: t0, priceAuto: true, created: created++, ops: buyMonthly('h-gold', 196, 246, 50) });
  s.holdings.push({ id: 'h-btc', account: 'a-btc', symbol: 'BTC-USD', isin: '', name: 'Bitcoin', cls: 'crypto', group: 'Crypto', currency: 'EUR', price: 91500, priceDate: t0, priceAuto: true, created: created++, ops: [
    { id: uid('o-'), date: addMonths(t0, -16), type: 'buy', qty: 0.035, price: 58200, fee: 3, amount: 0, note: '', created: created++ },
    { id: uid('o-'), date: addMonths(t0, -6), type: 'buy', qty: 0.012, price: 84300, fee: 2, amount: 0, note: '', created: created++ },
  ] });

  // imposta di bollo sui titoli, ogni tre mesi dalla liquidità del broker
  for (let k = 3; k <= MONTHS; k += 3) tx(addMonths(start, k).slice(0, 8) + '05', 'expense', 300 + k * 40, 'a-brk', 'c-tasse', 'Imposta di bollo', { note: 'Trimestre' });

  // budget
  Object.assign(s.budgets, { 'c-spesa': 32000, 'c-rist': 18000, 'c-carb': 16000, 'c-shop': 10000, 'c-svago': 8000, 'c-abbon': 4000, 'c-salute': 6000, 'c-trasp': 4000 });

  // obiettivi
  s.goals.push({ id: 'g-em', name: 'Fondo emergenza', emoji: '🛟', target: 1800000, date: null, account: 'a-cd', color: '', archived: false, created: created++, contributions: [] });
  s.goals.push({ id: 'g-jp', name: 'Viaggio in Giappone', emoji: '🗾', target: 450000, date: addMonths(t0, 10), account: null, color: '', archived: false, created: created++, contributions: [
    { id: uid('c-'), date: addMonths(t0, -4), amount: 60000, note: '' }, { id: uid('c-'), date: addMonths(t0, -2), amount: 50000, note: '' }, { id: uid('c-'), date: addDays(t0, -10), amount: 40000, note: '' }] });
  s.goals.push({ id: 'g-dj', name: 'Nuova consolle', emoji: '🎛️', target: 280000, date: addMonths(t0, 5), account: null, color: '', archived: false, created: created++, contributions: [{ id: uid('c-'), date: addMonths(t0, -1), amount: 90000, note: '' }] });

  s.rules.push({ id: uid('r-'), match: 'esselunga', category: 'c-spesa', payee: '' }, { id: uid('r-'), match: 'netflix', category: 'c-abbon', payee: 'Netflix' });
  s.watchlist.push({ symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World' }, { symbol: '^GSPC', name: 'S&P 500' }, { symbol: 'BTC-USD', name: 'Bitcoin' });

  // fotografie dei mesi passati (valore di mercato dei titoli), per uno storico realistico
  const P0 = { 'h-vwce': 106, 'h-agg': 4.6, 'h-btp': 97.5, 'h-aapl': 182, 'h-btc': 38000, 'h-gold': 190 };
  const clean = sanitize(s);
  for (let k = 0; ; k++) {
    const m = monthKey(addMonths(start, k));
    if (m >= monthKey(t0)) break;
    const end = addMonths(start, k + 1).slice(0, 8) + '01';
    const last = addDays(end, -1);
    const byAcc = { 'a-brk': 0, 'a-btc': 0 };
    for (const hd of clean.holdings) {
      const qty = position(hd, last).qty;
      if (!qty) continue;
      const f = (k + 1) / MONTHS;
      const price = (P0[hd.id] + (hd.price - P0[hd.id]) * f) * (1 + Math.sin(k * 1.7 + hd.price) * (hd.cls === 'crypto' ? 0.12 : 0.03));
      const fx = hd.currency === 'USD' ? 1 / clean.fx.rates.USD : 1;
      byAcc[hd.account] += Math.round(qty * price * fx * 100);
    }
    clean.snapshots[m] = { byAcc, at: 1 };
  }
  return clean;
}
