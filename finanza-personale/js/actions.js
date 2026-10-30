/* Le operazioni sui dati (aggiungi, modifica, elimina…), tutte passano da commit()
   così ogni modifica viene salvata cifrata e l'interfaccia si aggiorna. */

import { S, commit } from './session.js';
import { uid, stamp, hasPlan } from './core/model.js';
import { today, addDays, occurrences } from './core/dates.js';

const find = (arr, id) => arr.find(x => x.id === id);

/* ─── Conti ─── */
export function addAccount(a, opening = 0, openingDate = today()) {
  const id = uid('a-');
  commit(st => {
    const created = stamp();
    st.accounts.push({ id, name: a.name, type: a.type, institution: a.institution || '', currency: a.currency || st.settings.currency, emoji: a.emoji || '', color: '', archived: false, inNetWorth: a.inNetWorth !== false, notes: a.notes || '', created, order: st.accounts.length, plan: a.plan || null });
    if (!a.plan) st.valuations.push({ id: uid('v-'), account: id, date: openingDate, value: opening, created, kind: 'open', note: 'Saldo iniziale' });
  });
  return id;
}

export function updateAccount(id, patch) {
  commit(st => { const a = find(st.accounts, id); if (a) Object.assign(a, patch); });
}

export function setOpening(accId, value, date) {
  commit(st => {
    const v = st.valuations.find(x => x.account === accId && x.kind === 'open');
    if (v) { v.value = value; v.date = date; }
    else st.valuations.push({ id: uid('v-'), account: accId, date, value, created: 0, kind: 'open', note: 'Saldo iniziale' });
  });
}

/** "Il saldo vero oggi è X": un punto fermo, i movimenti successivi si sommano da lì. */
export function adjustBalance(accId, value, date = today(), note = '') {
  commit(st => { st.valuations.push({ id: uid('v-'), account: accId, date, value, created: stamp(), kind: 'adjust', note }); });
}
/** "Aggiorna i valori": più conti insieme alla stessa data.
    entries: [{ account, value }] per i conti normali (diventano punti fermi),
    [{ account, snapshot, month }] per i conti con titoli (valore dei titoli a fine mese). */
export function saveCheckIn(date, entries, note = 'Aggiornamento valori') {
  commit(st => {
    for (const e of entries) {
      if (e.snapshot != null) {
        const snap = st.snapshots[e.month] || (st.snapshots[e.month] = { byAcc: {}, at: 0 });
        snap.byAcc[e.account] = e.snapshot;
        snap.at = Date.now();
      } else {
        st.valuations.push({ id: uid('v-'), account: e.account, date, value: e.value, created: stamp(), kind: 'adjust', note });
      }
    }
  });
}
export function deleteValuation(id) {
  commit(st => { st.valuations = st.valuations.filter(v => v.id !== id || v.kind === 'open'); }, { undo: 'Valore eliminato' });
}

export function deleteAccount(id) {
  commit(st => {
    st.accounts = st.accounts.filter(a => a.id !== id);
    st.valuations = st.valuations.filter(v => v.account !== id);
    st.transactions = st.transactions.filter(t => t.account !== id && t.toAccount !== id);
    st.recurring = st.recurring.filter(r => r.account !== id && r.toAccount !== id);
    st.holdings = st.holdings.filter(h => h.account !== id);
    for (const g of st.goals) if (g.account === id) g.account = null;
  }, { undo: 'Conto eliminato' });
}

export function reorderAccounts(ids) {
  commit(st => { ids.forEach((id, i) => { const a = find(st.accounts, id); if (a) a.order = i; }); });
}

/* ─── Movimenti ─── */
export function saveTx(t) {
  let id = t.id;
  commit(st => {
    const now = stamp();
    const clean = {
      date: t.date, kind: t.kind, amount: Math.abs(t.amount), account: t.account,
      toAccount: t.kind === 'transfer' ? t.toAccount : null,
      amountTo: t.kind === 'transfer' ? Math.abs(t.amountTo ?? t.amount) : null,
      category: t.kind === 'transfer' ? null : t.category || null,
      payee: t.payee || '', note: t.note || '', tags: t.tags || [], flagged: !!t.flagged,
    };
    const ex = id && find(st.transactions, id);
    if (ex) Object.assign(ex, clean, { updated: now });
    else {
      id = uid('t-');
      st.transactions.push({ id, ...clean, recurring: t.recurring || null, created: now, updated: now, importHash: t.importHash || '' });
    }
    if (t.rememberRule && t.payee && clean.category) {
      const match = t.payee.toLowerCase().trim();
      if (!st.rules.some(r => r.match === match)) st.rules.push({ id: uid('r-'), match, category: clean.category, payee: '' });
    }
  });
  return id;
}

export function deleteTx(ids) {
  const set = new Set([].concat(ids));
  commit(st => { st.transactions = st.transactions.filter(t => !set.has(t.id)); }, { undo: set.size > 1 ? `${set.size} movimenti eliminati` : 'Movimento eliminato' });
}

export function bulkUpdateTx(ids, patch) {
  const set = new Set(ids);
  commit(st => {
    const now = stamp();
    for (const t of st.transactions) if (set.has(t.id)) {
      if ('category' in patch && t.kind !== 'transfer') {
        const c = st.categories.find(x => x.id === patch.category);
        if (!patch.category || (c && c.kind === t.kind)) t.category = patch.category;
      }
      if ('account' in patch && patch.account !== t.toAccount) t.account = patch.account;
      if ('addTag' in patch && !t.tags.includes(patch.addTag)) t.tags.push(patch.addTag);
      if ('flagged' in patch) t.flagged = patch.flagged;
      t.updated = now;
    }
  }, { undo: 'Modifica a più movimenti' });
}

export function duplicateTx(id) {
  const t = find(S.state.transactions, id);
  if (!t) return null;
  return saveTx({ ...t, id: null, date: today() });
}

/* ─── Scadenze e abbonamenti ─── */
export function saveRecurring(r) {
  let id = r.id;
  commit(st => {
    const ex = id && find(st.recurring, id);
    const clean = { ...r };
    delete clean.id;
    if (ex) Object.assign(ex, clean);
    else { id = uid('r-'); st.recurring.push({ id, lastPosted: null, active: true, created: stamp(), ...clean }); }
  });
  return id;
}
export function deleteRecurring(id) {
  commit(st => { st.recurring = st.recurring.filter(r => r.id !== id); }, { undo: 'Scadenza eliminata' });
}

function postOne(st, r, date, amount) {
  const now = stamp();
  st.transactions.push({
    id: uid('t-'), date, kind: r.kind, amount: amount ?? r.amount, account: r.account,
    toAccount: r.kind === 'transfer' ? r.toAccount : null, amountTo: r.kind === 'transfer' ? (amount ?? r.amount) : null,
    category: r.kind === 'transfer' ? null : r.category, payee: r.payee || r.name, note: '', tags: [], recurring: r.id,
    created: now, updated: now, importHash: '', flagged: false,
  });
  if (!r.lastPosted || date > r.lastPosted) r.lastPosted = date;
}

/** Registra la scadenza di quella data (eventualmente con un importo diverso). */
export function postRecurring(ruleId, date, amount) {
  commit(st => { const r = find(st.recurring, ruleId); if (r) postOne(st, r, date, amount); });
}
export function skipRecurring(ruleId, date) {
  commit(st => { const r = find(st.recurring, ruleId); if (r && (!r.lastPosted || date > r.lastPosted)) r.lastPosted = date; });
}

/** All'apertura: registra da sole le scadenze con "registra in automatico". */
export function runAutoPost() {
  if (!S.state) return 0;
  const t = today();
  let n = 0;
  const work = [];
  for (const r of S.state.recurring) {
    if (!r.active || !r.autoPost) continue;
    const from = r.lastPosted ? addDays(r.lastPosted, 1) : r.start;
    const dates = occurrences(r, from, t, 120);
    if (dates.length) work.push([r.id, dates]);
  }
  if (!work.length) return 0;
  commit(st => {
    for (const [rid, dates] of work) {
      const r = find(st.recurring, rid);
      if (!r) continue;
      for (const d of dates) { postOne(st, r, d); n++; }
    }
  });
  return n;
}

/* ─── Budget ─── */
export function setBudget(catId, cents) {
  commit(st => { if (cents > 0) st.budgets[catId] = cents; else delete st.budgets[catId]; });
}

/* ─── Obiettivi ─── */
export function saveGoal(g) {
  let id = g.id;
  commit(st => {
    const ex = id && find(st.goals, id);
    if (ex) Object.assign(ex, { name: g.name, emoji: g.emoji, target: g.target, date: g.date || null, account: g.account || null, color: g.color || '' });
    else { id = uid('g-'); st.goals.push({ id, name: g.name, emoji: g.emoji || '🎯', target: g.target, date: g.date || null, account: g.account || null, color: g.color || '', archived: false, created: stamp(), contributions: g.initial ? [{ id: uid('c-'), date: today(), amount: g.initial, note: 'Partenza' }] : [] }); }
  });
  return id;
}
export function contribute(goalId, amount, date = today(), note = '') {
  commit(st => { const g = find(st.goals, goalId); if (g) g.contributions.push({ id: uid('c-'), date, amount, note }); });
}
export function deleteContribution(goalId, cid) {
  commit(st => { const g = find(st.goals, goalId); if (g) g.contributions = g.contributions.filter(c => c.id !== cid); }, { undo: 'Versamento eliminato' });
}
export function deleteGoal(id) {
  commit(st => { st.goals = st.goals.filter(g => g.id !== id); }, { undo: 'Obiettivo eliminato' });
}
export function archiveGoal(id, v = true) { commit(st => { const g = find(st.goals, id); if (g) g.archived = v; }); }

/* ─── Investimenti ─── */
export function saveHolding(hd) {
  let id = hd.id;
  commit(st => {
    const ex = id && find(st.holdings, id);
    const clean = { account: hd.account, symbol: (hd.symbol || '').toUpperCase(), isin: (hd.isin || '').toUpperCase(), name: hd.name, cls: hd.cls, group: (hd.group || '').trim(), ter: hd.ter || 0, currency: hd.currency, price: hd.price ?? 0, priceDate: hd.priceDate || today(), priceAuto: hd.priceAuto !== false };
    if (ex) Object.assign(ex, clean);
    else { id = uid('h-'); st.holdings.push({ id, ...clean, created: stamp(), ops: hd.ops || [] }); }
  });
  return id;
}
export function deleteHolding(id) {
  commit(st => { st.holdings = st.holdings.filter(x => x.id !== id); }, { undo: 'Titolo eliminato' });
}
function applyOp(hd, op) {
  const ex = op.id && hd.ops.find(o => o.id === op.id);
  const clean = { date: op.date, type: op.type, qty: op.qty || 0, price: op.price || 0, fee: op.fee || 0, tax: op.type === 'sell' ? op.tax || 0 : 0, amount: op.amount || 0, cash: !!op.cash, note: op.note || '' };
  if (ex) Object.assign(ex, clean);
  else hd.ops.push({ id: uid('o-'), ...clean, created: stamp() });
  // il prezzo di un acquisto recente aggiorna il prezzo del titolo se non ce n'è uno più nuovo
  if ((op.type === 'buy' || op.type === 'sell') && op.price > 0 && (!hd.price || !hd.priceDate || op.date >= hd.priceDate)) { hd.price = op.price; hd.priceDate = op.date; }
}
export function saveOp(holdingId, op) {
  commit(st => {
    const hd = find(st.holdings, holdingId);
    if (hd) applyOp(hd, op);
  });
}
/** Più acquisti insieme (il PAC del mese): una sola modifica, un solo "Annulla". */
export function saveOps(list) {
  commit(st => {
    for (const { holding, op } of list) { const hd = find(st.holdings, holding); if (hd) applyOp(hd, op); }
  }, { undo: 'PAC registrato' });
}
export function deleteOp(holdingId, opId) {
  commit(st => { const hd = find(st.holdings, holdingId); if (hd) hd.ops = hd.ops.filter(o => o.id !== opId); }, { undo: 'Operazione eliminata' });
}
export function setPrices(updates) {
  // updates: [{id, price, date, ovType, src}]
  commit(st => {
    for (const u of updates) {
      const hd = find(st.holdings, u.id);
      if (!hd || !(u.price > 0)) continue;
      hd.price = u.price; hd.priceDate = u.date || today();
      if (u.ovType) hd.ovType = u.ovType;
      if (u.src != null) hd.priceSrc = u.src;
    }
  });
}
/** Collega i titoli al loro codice ISIN (per i prezzi online). */
export function linkHoldings(list) {
  commit(st => {
    for (const x of list) { const hd = find(st.holdings, x.id); if (hd) { hd.isin = x.isin; hd.ovType = x.ovType || ''; } }
  });
}

/* ─── Categorie e regole ─── */
export function saveCategory(c) {
  let id = c.id;
  commit(st => {
    const ex = id && find(st.categories, id);
    if (ex) Object.assign(ex, { name: c.name, emoji: c.emoji, group: c.group || 'Altro', ...(c.archived != null ? { archived: !!c.archived } : {}) });
    else { id = uid('c-'); st.categories.push({ id, name: c.name, emoji: c.emoji || '•', kind: c.kind, group: c.group || 'Altro', archived: false }); }
  });
  return id;
}
export function deleteCategory(id, moveTo = null) {
  commit(st => {
    st.categories = st.categories.filter(c => c.id !== id);
    for (const t of st.transactions) if (t.category === id) t.category = moveTo;
    for (const r of st.recurring) if (r.category === id) r.category = moveTo;
    st.rules = st.rules.filter(r => r.category !== id);
    delete st.budgets[id];
  }, { undo: 'Categoria eliminata' });
}
/** Rinomina un gruppo (la "categoria" dei fogli): tutte le sue sottocategorie lo seguono. */
export function renameGroup(kind, from, to) {
  const name = to.trim().slice(0, 40);
  if (!name || name === from) return;
  commit(st => {
    for (const c of st.categories) if (c.kind === kind && c.group === from) c.group = name;
    const gc = st.settings.groupColors;
    if (gc[`${kind}:${from}`]) { gc[`${kind}:${name}`] = gc[`${kind}:${from}`]; delete gc[`${kind}:${from}`]; }
  }, { undo: 'Gruppo rinominato' });
}
export function setGroupColor(kind, group, color) {
  commit(st => { st.settings.groupColors[`${kind}:${group}`] = color; });
}
/** Sposta una categoria su o giù nel suo gruppo (dir = -1 / +1). */
export function moveCategory(id, dir) {
  commit(st => {
    const c = find(st.categories, id);
    if (!c) return;
    const peers = st.categories.filter(x => x.kind === c.kind && x.group === c.group);
    const j = peers.indexOf(c) + dir;
    if (j < 0 || j >= peers.length) return;
    const a = st.categories.indexOf(c), b = st.categories.indexOf(peers[j]);
    [st.categories[a], st.categories[b]] = [st.categories[b], st.categories[a]];
  }, { noCount: true });
}
/** Sposta un gruppo intero prima o dopo il gruppo vicino. */
export function moveGroup(kind, group, dir) {
  commit(st => {
    const same = st.categories.filter(c => c.kind === kind);
    const order = [...new Set(same.map(c => c.group))];
    const i = order.indexOf(group), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const others = st.categories.filter(c => c.kind !== kind);
    st.categories = [...order.flatMap(g => same.filter(c => c.group === g)), ...others];
  }, { noCount: true });
}
export function archiveCategory(id, v = true) { commit(st => { const c = find(st.categories, id); if (c) c.archived = v; }); }

export function deleteRule(id) { commit(st => { st.rules = st.rules.filter(r => r.id !== id); }); }
export function saveRule(r) {
  commit(st => {
    const ex = r.id && find(st.rules, r.id);
    if (ex) Object.assign(ex, { match: r.match.toLowerCase().trim(), category: r.category, payee: r.payee || '' });
    else st.rules.push({ id: uid('r-'), match: r.match.toLowerCase().trim(), category: r.category, payee: r.payee || '' });
  });
}

/* ─── Impostazioni ─── */
export function setSetting(path, value) {
  commit(st => {
    const keys = path.split('.');
    let o = st.settings;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  });
}
/** Nuova valuta principale: i cambi vengono riportati alla nuova base. */
export function setBaseCurrency(cur) {
  commit(st => {
    const old = st.fx.rates, k = old[cur];
    const next = {};
    if (k) for (const [c, r] of Object.entries(old)) next[c] = r / k;
    next[cur] = 1;
    st.fx.rates = next;
    st.settings.currency = cur;
  });
}
export function setFx(rates, date) {
  commit(st => { st.fx.rates = { ...st.fx.rates, ...rates, [st.settings.currency]: 1 }; if (date) st.fx.date = date; });
}
export function saveSim(key, params) {
  commit(st => { st.sims[key] = params; }, { silent: true, noCount: true });
}

/** Importa movimenti già preparati (dal CSV). */
export function importTransactions(list) {
  commit(st => {
    for (const t of list) {
      const now = stamp();
      st.transactions.push({ id: uid('t-'), date: t.date, kind: t.kind, amount: t.amount, account: t.account, toAccount: null, amountTo: null, category: t.category || null, payee: t.payee || '', note: t.note || '', tags: t.tags || [], recurring: null, created: now, updated: now, importHash: t.importHash || '', flagged: false });
    }
  }, { undo: `${list.length} movimenti importati` });
}

export const accountIsPlan = acc => hasPlan(acc);

/** Importa investimenti già preparati da `planImport` (foglio Excel o CSV): una sola modifica, un solo "Annulla". */
export function importInvestments(plan, { cash = false } = {}) {
  commit(st => {
    const accId = new Map();
    for (const a of plan.accounts) {
      if (a.existingId) { accId.set(a, a.existingId); continue; }
      const id = uid('a-'), created = stamp();
      st.accounts.push({ id, name: a.name, type: 'broker', institution: '', currency: a.currency || st.settings.currency, emoji: '', color: '', archived: false, inNetWorth: true, notes: 'Creato importando un file', created, order: st.accounts.length, plan: null });
      // il conto esiste dalla prima operazione del file
      st.valuations.push({ id: uid('v-'), account: id, date: a.first || today(), value: 0, created, kind: 'open', note: 'Saldo iniziale' });
      accId.set(a, id);
    }
    for (const x of plan.holdings) {
      let hd = x.existing && find(st.holdings, x.existing.id);
      if (!hd) {
        hd = { id: uid('h-'), account: accId.get(x.acc), symbol: x.symbol || '', isin: x.isin || '', name: x.name, cls: x.cls, group: x.group || '', ter: x.ter || 0, currency: x.currency, price: 0, priceDate: null, priceAuto: true, created: stamp(), ops: [] };
        st.holdings.push(hd);
      } else {
        if (!hd.group && x.group) hd.group = x.group;
        if (!hd.ter && x.ter) hd.ter = x.ter;
      }
      for (const o of x.ops) {
        hd.ops.push({ id: uid('o-'), date: o.date, type: o.kind, qty: o.qty, price: o.price, fee: o.fee, tax: o.kind === 'sell' ? o.tax : 0, amount: o.amount, cash, note: o.note || '', created: stamp() });
        if ((o.kind === 'buy' || o.kind === 'sell') && (!hd.priceDate || o.date >= hd.priceDate)) { hd.price = o.price; hd.priceDate = o.date; }
      }
    }
    const cat = st.categories.find(c => c.id === 'c-tasse') || st.categories.find(c => c.kind === 'expense' && /tass|impost/i.test(c.name));
    for (const c of plan.costs) {
      const now = stamp();
      st.transactions.push({ id: uid('t-'), date: c.date, kind: 'expense', amount: Math.round(c.amount * 100), account: accId.get(c.acc), toAccount: null, amountTo: null, category: cat?.id || null, payee: c.payee || 'Imposta di bollo', note: c.note || '', tags: [], recurring: null, created: now, updated: now, importHash: '', flagged: false });
    }
  }, { undo: 'Importazione degli investimenti' });
}
