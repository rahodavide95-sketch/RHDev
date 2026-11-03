/* Doppioni nati unendo due copie degli stessi dati (D: "adesso perché si è duplicata ogni cosa nel networth?
   cosa è successo?"). Succede quando lo stesso Excel è stato importato su due dispositivi (o di nuovo dopo
   che il collegamento all'account si era perso) e poi le due copie si sono unite: le righe sono le stesse ma
   con codici interni diversi, e l'unione le teneva entrambe.
   Qui si riconoscono dal contenuto e si uniscono: si tiene il primo e gli si spostano valori, movimenti,
   titoli e posto nel Net Worth dell'altro. Solo doppioni sicuri:
   - conti: stesso nome (come lo legge l'import), tipo, valuta, banca e genere di titolo;
   - titoli: stesso conto, nome, simbolo e tipo; le operazioni uguali restano una;
   - valori di fine mese dello stesso conto alla stessa data: uno solo (prima quello scritto a mano);
   - movimenti nati dalla stessa cella del file (stessa impronta) nello stesso conto: uno solo. */

const nk = x => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[()€$%:.*#_'’`]/g, ' ').replace(/\s+/g, ' ').trim();
const secKey = x => nk(String(x ?? '').replace(/\(.*?\)/g, ' '));

export function dedupePlan(st) {
  const inLayout = new Set((st.settings?.nwLayout?.sections || []).flatMap(s => s.items || []));
  const weight = new Map();
  for (const v of st.valuations) weight.set(v.account, (weight.get(v.account) || 0) + 1);
  for (const t of st.transactions) { weight.set(t.account, (weight.get(t.account) || 0) + 1); if (t.toAccount) weight.set(t.toAccount, (weight.get(t.toAccount) || 0) + 1); }
  // conti
  const accMap = new Map();
  const groups = new Map();
  for (const a of st.accounts) {
    if (a.archived) continue;
    const k = [nk(a.name), a.type, a.currency, nk(a.institution), a.cls || ''].join('|');
    (groups.get(k) || groups.set(k, []).get(k)).push(a);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keep = [...list].sort((x, y) => (inLayout.has('a:' + y.id) - inLayout.has('a:' + x.id)) || ((weight.get(y.id) || 0) - (weight.get(x.id) || 0)) || ((x.created || 0) - (y.created || 0)))[0];
    for (const a of list) if (a !== keep) accMap.set(a.id, keep.id);
  }
  const accOf = id => accMap.get(id) || id;
  // titoli (dopo aver unito i conti)
  const hdMap = new Map();
  const hg = new Map();
  for (const h of st.holdings) {
    const k = [accOf(h.account), nk(h.name), (h.symbol || '').toUpperCase(), h.cls || ''].join('|');
    (hg.get(k) || hg.set(k, []).get(k)).push(h);
  }
  for (const list of hg.values()) {
    if (list.length < 2) continue;
    const keep = [...list].sort((x, y) => (inLayout.has('h:' + y.id) - inLayout.has('h:' + x.id)) || (y.ops.length - x.ops.length))[0];
    for (const h of list) if (h !== keep) hdMap.set(h.id, keep.id);
  }
  // valori alla stessa data, movimenti della stessa cella
  const own = new Map(st.valuations.map(v => [v.id, v.account]));
  const byDate = new Map();
  for (const v of st.valuations) {
    const k = accOf(v.account) + '|' + v.date;
    (byDate.get(k) || byDate.set(k, []).get(k)).push(v);
  }
  const dropVal = new Set();
  for (const list of byDate.values()) {
    if (list.length < 2) continue;
    if (new Set(list.map(v => own.get(v.id))).size < 2) {
      // tutti dello stesso conto: vale già l'ultimo scritto; si tolgono solo le copie identiche a lui
      const latest = [...list].sort((x, y) => (y.created || 0) - (x.created || 0))[0];
      for (const v of list) if (v !== latest && v.value === latest.value) dropVal.add(v.id);
      continue;
    }
    // da due conti uniti: prima quello scritto a mano, poi quello del conto tenuto, poi il più recente
    const keep = [...list].sort((x, y) => (!!y.manual - !!x.manual) || ((own.get(y.id) === accOf(own.get(y.id))) - (own.get(x.id) === accOf(own.get(x.id)))) || ((y.created || 0) - (x.created || 0)))[0];
    for (const v of list) if (v !== keep) dropVal.add(v.id);
  }
  const byCell = new Map();
  for (const t of st.transactions) {
    if (!t.importHash) continue;
    const k = t.importHash + '|' + accOf(t.account);
    (byCell.get(k) || byCell.set(k, []).get(k)).push(t);
  }
  const dropTx = new Set();
  for (const list of byCell.values()) {
    if (list.length < 2) continue;
    const keep = [...list].sort((x, y) => (!!y.manual - !!x.manual) || ((y.updated || 0) - (x.updated || 0)))[0];
    for (const t of list) if (t !== keep) dropTx.add(t.id);
  }
  // sezioni del Net Worth con lo stesso nome
  const secs = st.settings?.nwLayout?.sections || [];
  const sameSec = secs.length - new Set(secs.map(s => secKey(s.name))).size;
  const count = accMap.size + hdMap.size + dropVal.size + dropTx.size + sameSec;
  return { accMap, hdMap, dropVal, dropTx, sameSec, count, rows: accMap.size + hdMap.size };
}

/** Unisce i doppioni trovati da dedupePlan. Restituisce quanti ne ha sistemati. */
export function applyDedupe(st, plan = dedupePlan(st)) {
  if (!plan.count) return 0;
  const { accMap, hdMap, dropVal, dropTx } = plan;
  const acc = id => (id && accMap.get(id)) || id;
  const hd = id => (id && hdMap.get(id)) || id;
  // conti: tutto quello che era del doppione passa al conto tenuto
  for (const [from, to] of accMap) {
    const a = st.accounts.find(x => x.id === from), k = st.accounts.find(x => x.id === to);
    if (a && k) k.aka = [...new Set([...(k.aka || []), ...(a.aka || []), nk(a.name)])].filter(x => x !== nk(k.name)).slice(-12);
  }
  for (const v of st.valuations) v.account = acc(v.account);
  for (const t of st.transactions) { t.account = acc(t.account); if (t.toAccount) t.toAccount = acc(t.toAccount); }
  for (const r of st.recurring) { r.account = acc(r.account); if (r.toAccount) r.toAccount = acc(r.toAccount); }
  for (const g of st.goals) if (g.account) g.account = acc(g.account);
  for (const h of st.holdings) h.account = acc(h.account);
  for (const snap of Object.values(st.snapshots || {})) {
    for (const [from, to] of accMap) if (snap.byAcc && from in snap.byAcc) { if (!(to in snap.byAcc)) snap.byAcc[to] = snap.byAcc[from]; delete snap.byAcc[from]; }
    for (const [from, to] of hdMap) for (const f of ['byHd', 'nwHd', 'nwMan']) {
      if (snap[f] && from in snap[f]) { if (!(to in snap[f])) snap[f][to] = snap[f][from]; delete snap[f][from]; }
    }
  }
  // titoli: le operazioni del doppione che non ci sono già
  const opKey = o => [o.date, o.type, o.qty, o.price, o.fee || 0, o.tax || 0].join('|');
  for (const [from, to] of hdMap) {
    const a = st.holdings.find(x => x.id === from), k = st.holdings.find(x => x.id === to);
    if (!a || !k) continue;
    const have = new Set(k.ops.map(opKey));
    for (const o of a.ops) if (!have.has(opKey(o))) { k.ops.push(o); have.add(opKey(o)); }
  }
  st.accounts = st.accounts.filter(a => !accMap.has(a.id));
  st.holdings = st.holdings.filter(h => !hdMap.has(h.id));
  st.valuations = st.valuations.filter(v => !dropVal.has(v.id));
  st.transactions = st.transactions.filter(t => !dropTx.has(t.id));
  // Net Worth: le righe dei doppioni vanno al posto di quelle tenute; sezioni con lo stesso nome unite
  const lay = st.settings?.nwLayout;
  if (lay) {
    const mapKey = k => (k.startsWith('a:') ? 'a:' + acc(k.slice(2)) : k.startsWith('h:') ? 'h:' + hd(k.slice(2)) : k);
    const seen = new Set();
    const merged = [];
    for (const s of lay.sections || []) {
      let into = merged.find(x => secKey(x.name) === secKey(s.name));
      if (!into) merged.push(into = { ...s, items: [], ...(s.was ? { was: [...s.was] } : {}) });
      else if (s.was) into.was = [...new Set([...(into.was || []), ...s.was])];
      for (const k of s.items || []) { const m = mapKey(k); if (!seen.has(m)) { seen.add(m); into.items.push(m); } }
    }
    lay.sections = merged.filter(s => s.items.length);
    for (const k of Object.keys(lay.labels || {})) {
      const m = mapKey(k);
      if (m !== k) { if (!(m in lay.labels)) lay.labels[m] = lay.labels[k]; delete lay.labels[k]; }
    }
  }
  return plan.count;
}
