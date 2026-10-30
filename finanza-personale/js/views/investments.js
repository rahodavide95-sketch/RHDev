/* Investimenti: portafoglio (valore, guadagni, allocazione, tasse stimate), registro di tutte le
   operazioni, anno per anno (investito mese per mese, per tipo/categoria/titolo, tasse e costi)
   e il dettaglio di ogni titolo. */

import { h, icon, download } from '../ui/dom.js';
import { donut, SERIES, lineChart, barChart } from '../ui/charts.js';
import { empty, toast, confirmDialog, selectInput } from '../ui/components.js';
import { money, moneyText, compactText, delta, tipMoney, axisMoney, ui } from '../ui/fmt.js';
import { card, avatar, linkBtn, segTabs, stat } from './common.js';
import { holdingEditor, opEditor, accountEditor, pacEditor, bolloEditor, pickHoldingOp, txEditor } from './editors.js';
import { setPrices, setSetting, setFx } from '../actions.js';
import { ASSET_CLASSES, position, hasHoldings } from '../core/model.js';
import { formatNumber, formatPercent } from '../core/money.js';
import { formatDate, today, monthName, formatMonth, lastMonths, diffMonths } from '../core/dates.js';
import { toCSV, csvNumber } from '../core/csv.js';
import { refreshHoldings, quote, ecbRates } from '../market.js';
import { openInvestImport } from './invimport.js';

let groupBy = 'cls';
let pivotBy = 'cls';
let pivotUnit = 'eur';
let opsFilter = { hd: '', type: '' };
let busy = false;

const NO_GROUP = 'Senza categoria';
const groupOf = hd => hd.group || NO_GROUP;
const qtyText = q => (ui.privacy ? '••••' : formatNumber(q, 6));

export async function askMarketConsent(ctx) {
  if (ctx.st.settings.market.enabled) return true;
  const ok = await confirmDialog({
    title: 'Usare i dati di mercato online?', icon: 'globe', confirm: 'Attiva',
    message: h('div.stack-sm',
      h('p', 'Per i prezzi aggiornati l\'app chiede le quotazioni pubbliche a Yahoo Finance, Binance e CoinGecko, e i cambi alla BCE.'),
      h('p', h('b', 'Cosa viene inviato: '), 'solo i simboli dei titoli (es. "VWCE.DE"). Mai quantità, importi, conti o altri tuoi dati.'),
      h('p.muted', 'Puoi disattivarli quando vuoi dalle Impostazioni. Senza, i prezzi li scrivi tu.')),
  });
  if (ok) setSetting('market.enabled', true);
  return ok;
}

export async function updatePrices(ctx) {
  if (busy) return;
  const hs = ctx.st.holdings.filter(x => x.priceAuto && x.symbol && position(x).qty > 0);
  if (!hs.length) { toast('Nessun titolo con aggiornamento online: aggiungi il simbolo (ticker) ai titoli.'); return; }
  if (!(await askMarketConsent(ctx))) return;
  busy = true;
  ctx.rerender();
  try {
    let rates = ctx.st.fx.rates;
    try { const r = await ecbRates(ctx.st.settings.currency); setFx(r.rates, r.date); rates = r.rates; } catch { /* usa i cambi salvati */ }
    const { updated, failed } = await refreshHoldings(hs, rates, { proxies: ctx.st.settings.market.portfolioProxies });
    if (updated.length) setPrices(updated.map(u => ({ ...u, date: today() })));
    if (failed.length && !updated.length) toast('Prezzi non raggiungibili ora. Riprova più tardi o scrivili a mano.', { kind: 'err' });
    else if (failed.length) toast(`${updated.length} prezzi aggiornati, ${failed.length} non trovati: ${failed.map(f => f.symbol).join(', ')}`);
    else toast(`${updated.length} prezzi aggiornati`, { kind: 'ok' });
  } finally {
    busy = false;
    ctx.rerender();
  }
}

function summary(ctx, p) {
  const { d } = ctx;
  return h('section.card.inv-hero',
    h('div.hero-label', 'Valore del portafoglio'),
    h('div.hero-value', money(p.value)),
    h('div.hero-delta', money(p.gain, d.base, { sign: true, tone: p.gain >= 0 ? 'pos' : 'neg' }), delta(p.gainPct), h('span.muted', 'non realizzato')),
    h('div.stats-4',
      h('div.stat', h('div.stat-label', 'Investito'), h('div.stat-value', money(p.cost))),
      h('div.stat', h('div.stat-label', 'Realizzato'), h('div.stat-value', money(p.realized, d.base, { sign: true, tone: p.realized > 0 ? 'pos' : p.realized < 0 ? 'neg' : '' }))),
      h('div.stat', h('div.stat-label', 'Cedole e dividendi'), h('div.stat-value', money(p.dividends, d.base, { tone: 'pos' }))),
      h('div.stat', h('div.stat-label', 'Tasse se vendi oggi'), h('div.stat-value', money(p.taxIfSold)), h('div.stat-extra', 'bollo ≈ ', moneyText(p.bolloYear), '/anno', p.hasTer ? [' · TER ≈ ', moneyText(p.terYear), '/anno'] : null))));
}

function allocation(ctx, p) {
  const { d } = ctx;
  const hasGroups = p.rows.some(r => r.qty > 0 && r.holding.group);
  if (groupBy === 'grp' && !hasGroups) groupBy = 'cls';
  const map = new Map();
  for (const r of p.rows) {
    if (r.qty <= 0) continue;
    const k = groupBy === 'cls' ? ASSET_CLASSES[r.holding.cls].label : groupBy === 'grp' ? groupOf(r.holding) : groupBy === 'acc' ? r.account.name : r.holding.currency;
    map.set(k, (map.get(k) || 0) + r.valueBase);
  }
  const items = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: SERIES[i % 8] }));
  const tot = items.reduce((a, x) => a + x.value, 0) || 1;
  const opts = [{ value: 'cls', label: 'Tipo' }, { value: 'grp', label: 'Categoria' }, { value: 'acc', label: 'Conto' }, { value: 'cur', label: 'Valuta' }].filter(o => o.value !== 'grp' || hasGroups);
  return card('Allocazione', { action: segTabs(opts, groupBy, v => { groupBy = v; ctx.rerender(); }) },
    h('div.donut-row',
      donut({ items, size: 168, thickness: 20, center: { value: moneyText(p.value), label: 'totale' }, fmt: tipMoney, mask: ui.privacy }),
      h('div.donut-legend', items.map(it => h('div.dl-row', h('span.dl-key', { style: { background: it.color } }), h('span.dl-name', it.label), h('span.dl-val', formatPercent(it.value / tot * 100, 1)))))));
  void d;
}

function table(ctx, p) {
  const { d } = ctx;
  const rows = [...p.rows].sort((a, b) => b.valueBase - a.valueBase);
  const total = p.value || 1;
  const open = rows.filter(r => r.qty > 0), closed = rows.filter(r => r.qty <= 0);
  const line = r => h('a.row.hold-row', { href: '#/investimenti/' + r.holding.id },
    avatar(r.holding.cls === 'crypto' ? '🪙' : r.holding.cls === 'gov' || r.holding.cls === 'bond' ? '🏛️' : r.holding.cls === 'gold' ? '🥇' : '📈'),
    h('span.row-main', h('span.row-title', r.holding.name),
      h('span.row-sub', [r.holding.symbol, `${formatNumber(r.qty, 6)} × ${formatNumber(r.holding.price, 4)} ${r.holding.currency}`, r.holding.priceDate && r.holding.priceDate < today() ? `prezzo del ${formatDate(r.holding.priceDate)}` : ''].filter(Boolean).join(' · '))),
    h('span.row-end', money(r.valueBase), h('span.row-sub', money(r.valueBase - r.costBase, d.base, { sign: true, tone: r.valueBase >= r.costBase ? 'pos' : 'neg' }), ' ', delta(r.unrealizedPct)), h('span.weight', h('i', { style: { width: Math.min(100, r.valueBase / total * 100) + '%' } }))));
  return h('div.stack',
    card('Titoli', { sub: `${open.length} posizioni aperte` }, h('div.rows', open.map(line))),
    closed.length ? card('Posizioni chiuse', {}, h('div.rows', closed.map(r => h('a.row', { href: '#/investimenti/' + r.holding.id }, avatar('✓'), h('span.row-main', h('span.row-title', r.holding.name), h('span.row-sub', r.holding.symbol)), h('span.row-end', money(r.realizedBase + r.dividendsBase, d.base, { sign: true, tone: r.realizedBase >= 0 ? 'pos' : 'neg' }), h('span.row-sub', 'realizzato')))))) : null);
}

const OP_LABEL = { buy: 'Acquisto', sell: 'Vendita', div: 'Cedola / dividendo', fee: 'Costo' };

/** "2,61 × 114,96 € + 1 comm. − 0,27 imposta" */
function opDetail(o, c) {
  if (o.type !== 'buy' && o.type !== 'sell') return '';
  if (ui.privacy) return '';
  return `${formatNumber(o.qty, 6)} × ${formatNumber(o.price, 4)} ${c}` + (o.fee ? ` + ${formatNumber(o.fee, 2)} comm.` : '') + (o.tax ? ` − ${formatNumber(o.tax, 2)} imposta` : '');
}
/** Effetto sui soldi: acquisti e costi in uscita, vendite e cedole in entrata. */
function opAmount(o, c) {
  const cents = x => Math.round(x * 100);
  if (o.type === 'buy') return money(-cents(o.qty * o.price + o.fee), c);
  if (o.type === 'sell') return money(cents(o.qty * o.price - o.fee - (o.tax || 0)), c, { sign: true, tone: 'pos' });
  if (o.type === 'div') return money(cents(o.amount), c, { sign: true, tone: 'pos' });
  return money(-cents(Math.abs(o.amount)), c);
}
let chartRange = '1A';
const chartCache = new Map();

function priceChart(ctx, hd) {
  const box = h('div.price-chart');
  if (!ctx.st.settings.market.enabled || !hd.symbol) return null;
  const key = hd.symbol + '|' + chartRange;
  const draw = q => {
    if (!q?.closes?.length) { box.replaceChildren(h('p.muted', 'Grafico non disponibile per questo simbolo.')); return; }
    const labels = q.stamps.map(t => new Date(t * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));
    box.replaceChildren(lineChart({ labels, series: [{ name: hd.name, color: (q.change ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)', values: q.closes, area: true }], fmt: v => formatNumber(v, 2, 2) + ' ' + q.currency, fmtAxis: v => formatNumber(v, v >= 100 ? 0 : 2), height: 200, zero: false }));
  };
  if (chartCache.has(key)) draw(chartCache.get(key));
  else {
    box.append(h('div.skeleton', { style: { height: '200px' } }));
    quote(hd.symbol, chartRange, { proxies: ctx.st.settings.market.portfolioProxies }).then(q => { chartCache.set(key, q); if (box.isConnected) draw(q); }).catch(() => { if (box.isConnected) box.replaceChildren(h('p.muted', 'Grafico non raggiungibile ora.')); });
  }
  return card('Andamento', { action: segTabs(['1M', '6M', '1A', '5A'].map(x => ({ value: x, label: x })), chartRange, v => { chartRange = v; ctx.rerender(); }) }, box);
}

function detail(ctx, id) {
  const { st, d } = ctx;
  const hd = st.holdings.find(x => x.id === id);
  if (!hd) return { title: 'Titolo', node: h('section.card', empty({ icon: 'trend', title: 'Titolo non trovato', action: linkBtn('Portafoglio', '#/investimenti') })) };
  const p = position(hd);
  const acc = d.accById.get(hd.account);
  const cls = ASSET_CLASSES[hd.cls];
  const taxIfSold = Math.max(0, p.value - p.cost) * cls.tax / 100;
  const ops = [...hd.ops].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created - a.created));
  const c = hd.currency;
  const m = v => money(Math.round(v * 100), c);
  return {
    title: hd.name, sub: [hd.symbol, hd.isin, cls.label, hd.group, hd.ter ? `TER ${formatNumber(hd.ter, 3)}%` : ''].filter(Boolean).join(' · '),
    actions: [h('a.icon-btn', { href: '#/investimenti', 'aria-label': 'Portafoglio' }, icon('chevL', 20)), h('button.icon-btn', { type: 'button', 'aria-label': 'Modifica titolo', onclick: () => holdingEditor(ctx, hd) }, icon('edit', 20))],
    node: h('div.stack',
      h('section.card.inv-hero',
        h('div.hero-label', `${acc?.name || ''} · ${formatNumber(p.qty, 6)} quote`),
        h('div.hero-value', m(p.value)),
        h('div.hero-delta', money(Math.round((p.value - p.cost) * 100), c, { sign: true, tone: p.value >= p.cost ? 'pos' : 'neg' }), delta(p.unrealizedPct), h('span.muted', `prezzo ${formatNumber(hd.price, 4)} ${c}${hd.priceDate ? ' del ' + formatDate(hd.priceDate) : ''}`)),
        h('div.stats-4',
          h('div.stat', h('div.stat-label', 'Prezzo medio di carico'), h('div.stat-value', formatNumber(p.avg, 4) + ' ' + c)),
          h('div.stat', h('div.stat-label', 'Costo'), h('div.stat-value', m(p.cost))),
          h('div.stat', h('div.stat-label', 'Realizzato + cedole'), h('div.stat-value', money(Math.round((p.realized + p.dividends) * 100), c, { sign: true, tone: p.realized + p.dividends >= 0 ? 'pos' : 'neg' }))),
          h('div.stat', h('div.stat-label', `Tassa se vendi (${String(cls.tax).replace('.', ',')}%)`), h('div.stat-value', m(taxIfSold)))),
        p.fees || p.taxes || hd.ter ? h('p.inv-costs', [
          p.fees ? ['Commissioni pagate ', h('b', moneyText(Math.round(p.fees * 100), c))] : null,
          p.taxes ? [p.fees ? ' · ' : '', 'imposte trattenute ', h('b', moneyText(Math.round(p.taxes * 100), c))] : null,
          hd.ter && p.value ? [p.fees || p.taxes ? ' · ' : '', 'TER ≈ ', h('b', moneyText(Math.round(p.value * hd.ter), c)), ' all\'anno'] : null,
        ]) : null,
        h('div.row-btns',
          h('button.btn.btn-soft', { type: 'button', onclick: () => opEditor(ctx, hd, null, 'buy') }, icon('plus', 18), 'Acquisto'),
          h('button.btn.btn-soft', { type: 'button', onclick: () => opEditor(ctx, hd, null, 'sell') }, icon('minus', 18), 'Vendita'),
          h('button.btn.btn-soft', { type: 'button', onclick: () => opEditor(ctx, hd, null, 'div') }, icon('coins', 18), 'Cedola / dividendo'))),
      priceChart(ctx, hd),
      card('Operazioni', { sub: `${ops.length}` }, ops.length ? h('div.rows', ops.map(o => h('button.row', { type: 'button', onclick: () => opEditor(ctx, hd, o) },
        h('span.date-chip', h('b', o.date.slice(8)), formatDate(o.date).split(' ')[1]),
        h('span.row-main', h('span.row-title', OP_LABEL[o.type], o.cash ? h('span.pill', 'liquidità') : null), h('span.row-sub', [opDetail(o, c), o.note, formatDate(o.date, { year: true })].filter(Boolean).join(' · '))),
        h('span.row-end', opAmount(o, c))))) : h('p.muted', 'Nessuna operazione.'))),
  };
}

/* ─── Registro di tutte le operazioni (come il foglio con una riga per acquisto) ─── */
const TYPE_TABS = [{ value: '', label: 'Tutte' }, { value: 'buy', label: 'Acquisti' }, { value: 'sell', label: 'Vendite' }, { value: 'div', label: 'Cedole' }, { value: 'cost', label: 'Costi e tasse' }];

function opsView(ctx) {
  const { st, d } = ctx;
  const inv = d.invest();
  if (opsFilter.hd && !st.holdings.some(x => x.id === opsFilter.hd)) opsFilter.hd = '';
  const t = opsFilter.type;
  const items = [];
  for (const r of inv.rows) {
    if (opsFilter.hd && r.holding.id !== opsFilter.hd) continue;
    if (t && !(t === 'cost' ? r.op.type === 'fee' || r.op.fee || r.op.tax : r.op.type === t)) continue;
    items.push({ date: r.date, created: r.op.created, r });
  }
  if (!opsFilter.hd && (!t || t === 'cost')) for (const k of inv.costs) items.push({ date: k.date, created: k.tx.created || 0, k });
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created - a.created));

  const byYear = new Map();
  for (const it of items) { const y = it.date.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(it); }
  const hdOpts = [{ value: '', label: 'Tutti i titoli' }, ...[...st.holdings].sort((a, b) => a.name.localeCompare(b.name)).map(x => ({ value: x.id, label: x.name }))];
  const line = it => {
    if (it.k) {
      const tx = it.k.tx;
      return h('button.row', { type: 'button', onclick: () => txEditor(ctx, tx) },
        h('span.date-chip', h('b', tx.date.slice(8)), formatDate(tx.date).split(' ')[1]),
        h('span.row-main', h('span.row-title', tx.payee || 'Spesa del conto'), h('span.row-sub', ['Tasse e costi', d.accById.get(tx.account)?.name, tx.note].filter(Boolean).join(' · '))),
        h('span.row-end', money(-it.k.amount)));
    }
    const { holding: hd, op: o } = it.r;
    return h('button.row', { type: 'button', onclick: () => opEditor(ctx, hd, o) },
      h('span.date-chip', h('b', o.date.slice(8)), formatDate(o.date).split(' ')[1]),
      h('span.row-main', h('span.row-title', hd.name), h('span.row-sub', [OP_LABEL[o.type], opDetail(o, hd.currency), o.note].filter(Boolean).join(' · '))),
      h('span.row-end', opAmount(o, hd.currency)));
  };
  const exportCsv = () => {
    const rows = [['Data', 'Titolo', 'Simbolo', 'ISIN', 'Tipo', 'Categoria', 'Operazione', 'Quantità', 'Prezzo', 'Importo', 'Commissioni', 'Imposta', 'Totale', 'Valuta', 'Conto', 'Nota']];
    const n = (x, dec) => (x ? String(Math.round(x * 10 ** dec) / 10 ** dec).replace('.', ',') : '');
    for (const it of [...items].reverse()) {
      if (it.k) {
        const tx = it.k.tx, acc = d.accById.get(tx.account);
        rows.push([tx.date, tx.payee || 'Spesa del conto', '', '', '', '', 'Tasse e costi', '', '', '', '', csvNumber(tx.amount), csvNumber(-tx.amount), acc?.currency || '', acc?.name || '', tx.note]);
        continue;
      }
      const { holding: hd, op: o } = it.r;
      const tr = o.type === 'buy' || o.type === 'sell';
      const tot = o.type === 'buy' ? -(o.qty * o.price + o.fee) : o.type === 'sell' ? o.qty * o.price - o.fee - o.tax : o.type === 'div' ? o.amount : -Math.abs(o.amount);
      rows.push([o.date, hd.name, hd.symbol, hd.isin, ASSET_CLASSES[hd.cls].label, hd.group, OP_LABEL[o.type], tr ? n(o.qty, 6) : '', tr ? n(o.price, 6) : '', tr ? n(o.qty * o.price, 2) : n(Math.abs(o.amount), 2), n(o.fee, 2), n(o.tax, 2), n(tot, 2) || '0', hd.currency, d.accById.get(hd.account)?.name || '', o.note]);
    }
    download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `operazioni-${today()}.csv`);
    toast('Operazioni esportate', { kind: 'ok' });
  };
  const sumNet = list => list.reduce((a, it) => a + (it.r && (it.r.op.type === 'buy' || it.r.op.type === 'sell') ? it.r.net : 0), 0);
  return h('div.stack',
    h('div.row-btns.inv-tools',
      h('button.btn.btn-primary', { type: 'button', onclick: () => pacEditor(ctx) }, icon('repeat', 18), 'Registra il PAC'),
      h('button.btn.btn-soft', { type: 'button', onclick: () => pickHoldingOp(ctx) }, icon('plus', 18), 'Operazione'),
      h('button.btn.btn-soft', { type: 'button', onclick: () => bolloEditor(ctx) }, icon('plus', 18), 'Imposta di bollo'),
      h('button.btn.btn-soft', { type: 'button', onclick: () => openInvestImport(ctx) }, icon('upload', 18), 'Importa da Excel')),
    card('Tutte le operazioni', { sub: `${items.length} ${items.length === 1 ? 'riga' : 'righe'}`, action: h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportCsv, disabled: !items.length }, icon('download', 16), 'CSV') },
      h('div.inv-filters', selectInput(hdOpts, opsFilter.hd, v => { opsFilter.hd = v; ctx.rerender(); }), segTabs(TYPE_TABS, t, v => { opsFilter.type = v; ctx.rerender(); })),
      items.length ? h('div.stack', [...byYear.entries()].map(([y, list]) => h('div.inv-year',
        h('div.day-head', h('span', y), (() => { const net = sumNet(list); return net ? h('span.muted', 'investiti ', moneyText(net)) : null; })()),
        h('div.rows', list.map(line)))))
        : h('p.muted', 'Nessuna operazione con questi filtri.')));
}

/* ─── Anno per anno: investito mese per mese, per tipo/categoria/titolo, tasse e costi ─── */
const PIVOTS = [{ value: 'cls', label: 'Tipo' }, { value: 'grp', label: 'Categoria' }, { value: 'hd', label: 'Titolo' }, { value: 'acc', label: 'Conto' }];

function yearsView(ctx) {
  const { st, d } = ctx;
  const inv = d.invest();
  const p = d.portfolio();
  const years = inv.yearList;
  if (!years.length) return h('section.card', empty({ icon: 'trend', title: 'Ancora nessuna operazione', text: 'Registra acquisti e vendite (o il PAC del mese): qui vedi quanto investi ogni mese e ogni anno, dove e quanto ti costa.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => pacEditor(ctx) }, icon('repeat', 18), 'Registra il PAC') }));
  const curY = +d.refDate.slice(0, 4), curM = d.refDate.slice(0, 7);
  const c2 = v => moneyText(v);
  const cell = (v, extra = {}) => h('td.num', { class: [extra.cls, v > 0 ? '' : v < 0 ? 'neg' : 'muted'].filter(Boolean).join(' ') }, v ? c2(v) : '—');

  // in alto: i numeri che contano
  const monthsAll = inv.firstMonth ? Math.max(1, diffMonths(inv.firstMonth + '-01', curM + '-01') + 1) : 1;
  const costsAll = [...inv.years.values()].reduce((a, Y) => a + Y.fees + Y.taxes + Y.costs, 0);
  const thisY = inv.years.get(curY);
  const hero = h('section.card',
    h('div.stats-4',
      stat('Investito in totale', money(inv.total), `da ${formatMonth(inv.firstMonth || curM)}`),
      stat('Media al mese', money(Math.round(inv.total / monthsAll)), `su ${monthsAll} mesi`),
      stat(`Nel ${curY}`, money(thisY?.net || 0), thisY ? `${moneyText(Math.round(thisY.net / inv.monthsIn(curY, d.refDate)))} al mese` : 'ancora niente'),
      stat('Tasse e costi', money(costsAll), 'commissioni, imposte e bollo')));

  // grafico: investito ogni mese
  const span = Math.min(36, Math.max(12, monthsAll));
  const keys = lastMonths(span, curM);
  const chart = card('Investito ogni mese', { sub: 'Acquisti meno vendite, commissioni comprese' },
    barChart({ labels: keys.map(k => formatMonth(k, true)), tipLabels: keys.map(k => formatMonth(k)), series: [{ name: 'Investito', color: 'var(--c1)', values: keys.map(k => inv.months.get(k) || 0) }], fmt: tipMoney, fmtAxis: axisMoney, height: 220, mask: ui.privacy, highlight: keys.length - 1 }));

  // tabella mesi × anni
  const head = h('tr', h('th.sticky', 'Mese'), years.map(y => h('th.num', String(y))));
  const body = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    body.push(h('tr', h('td.sticky', monthName(m)), years.map(y => {
      const k = `${y}-${mm}`;
      if (k > curM) return h('td.num.muted', '');
      return cell(inv.months.get(k) || 0);
    })));
  }
  const yNet = y => [...inv.months.entries()].filter(([k]) => +k.slice(0, 4) === y).reduce((a, [, v]) => a + v, 0);
  const exportMonths = () => {
    const rows = [['Mese', ...years.map(String)]];
    for (let m = 1; m <= 12; m++) rows.push([monthName(m), ...years.map(y => csvNumber(inv.months.get(`${y}-${String(m).padStart(2, '0')}`) || 0))]);
    rows.push(['Totale anno', ...years.map(y => csvNumber(yNet(y)))]);
    rows.push(['Media al mese', ...years.map(y => csvNumber(Math.round(yNet(y) / inv.monthsIn(y, d.refDate))))]);
    download(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `investito-mese-per-mese-${today()}.csv`);
    toast('Tabella esportata', { kind: 'ok' });
  };
  const monthsCard = card('Mese per mese', { sub: `In totale ${moneyText(inv.total)}, in media ${moneyText(Math.round(inv.total / monthsAll))} al mese`, action: h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: exportMonths }, icon('download', 16), 'CSV') },
    scrollTable(h('table.table.nw-table.nw-months.inv-table',
      h('thead', head), h('tbody', body),
      h('tfoot',
        h('tr.total', h('td.sticky', 'Totale anno'), years.map(y => cell(yNet(y)))),
        h('tr.moves', h('td.sticky', 'Media al mese'), years.map(y => cell(Math.round(yNet(y) / inv.monthsIn(y, d.refDate)))))))));

  // per tipo / categoria / titolo / conto
  const hasGroups = st.holdings.some(x => x.group);
  if (pivotBy === 'grp' && !hasGroups) pivotBy = 'cls';
  const keyOf = { cls: hd => hd.cls, grp: groupOf, hd: hd => hd.id, acc: hd => hd.account }[pivotBy];
  const labelOf = { cls: k => ASSET_CLASSES[k]?.label || k, grp: k => k, hd: k => st.holdings.find(x => x.id === k)?.name || 'Titolo', acc: k => d.accById.get(k)?.name || 'Conto' }[pivotBy];
  const groups = [...inv.pivot(keyOf).values()].sort((a, b) => b.total - a.total);
  const isHd = pivotBy === 'hd';
  const inQty = isHd && pivotUnit === 'qty';
  const posOf = k => { const hd = st.holdings.find(x => x.id === k); return hd ? { hd, p: position(hd) } : null; };
  const totAll = groups.reduce((a, g) => a + g.total, 0);
  const qcell = q => h('td.num', { class: q ? (q < 0 ? 'neg' : '') : 'muted' }, q ? qtyText(q) : '—');
  const pmc = x => (x && x.p.qty > 0 ? (ui.privacy ? '••••' : `${formatNumber(x.p.avg, 4)} ${x.hd.currency}`) : '—');
  const pivotTable = h('table.table.nw-table.nw-months.inv-table',
    h('thead', h('tr', h('th.sticky', ''), years.map(y => h('th.num', String(y))), h('th.num.diff', inQty ? 'Quote' : 'Totale'), isHd ? [inQty ? null : h('th.num', 'Quote'), h('th.num', 'Prezzo medio')] : h('th.num', 'Peso'))),
    h('tbody', groups.map(g => {
      const x = isHd ? posOf(g.key) : null;
      return h('tr', { class: isHd ? 'click' : '', onclick: isHd ? () => ctx.go('investimenti/' + g.key) : null },
        h('td.sticky', labelOf(g.key)),
        years.map(y => (inQty ? qcell(g.qtyByYear.get(y) || 0) : cell(g.byYear.get(y) || 0))),
        inQty ? h('td.num.diff', x && x.p.qty > 0 ? qtyText(x.p.qty) : '—') : h('td.num.diff', { class: g.total < 0 ? 'neg' : '' }, c2(g.total)),
        isHd ? [inQty ? null : h('td.num', x && x.p.qty > 0 ? qtyText(x.p.qty) : '—'), h('td.num', pmc(x))]
          : h('td.num', totAll > 0 && g.total > 0 ? formatPercent(g.total / totAll * 100, 1) : '—'));
    })),
    inQty ? null : h('tfoot', h('tr.total', h('td.sticky', 'Totale'), years.map(y => cell(groups.reduce((a, g) => a + (g.byYear.get(y) || 0), 0))), h('td.num.diff', c2(totAll)), isHd ? [h('td.num', ''), h('td.num', '')] : h('td.num', ''))));
  // ciambella: quanto pesa ogni gruppo sul totale investito (i più piccoli insieme in "Altri")
  const pos = groups.filter(g => g.total > 0);
  const top = pos.slice(0, pos.length > 8 ? 7 : 8);
  const rest = pos.slice(top.length).reduce((a, g) => a + g.total, 0);
  const items = [...top.map((g, i) => ({ label: labelOf(g.key), value: g.total, color: SERIES[i] })), ...(rest ? [{ label: 'Altri', value: rest, color: SERIES[7] }] : [])];
  const totPos = items.reduce((a, x) => a + x.value, 0) || 1;
  const pivotDonut = items.length > 1 && !inQty ? h('div.donut-row.inv-donut',
    donut({ items, size: 152, thickness: 18, center: { value: compactText(totPos), label: 'investiti' }, fmt: tipMoney, mask: ui.privacy }),
    h('div.donut-legend', items.map(it => h('div.dl-row', h('span.dl-key', { style: { background: it.color } }), h('span.dl-name', it.label), h('span.dl-val', formatPercent(it.value / totPos * 100, 1)))))) : null;
  const pivotCard = card('Investito per anno', { sub: 'Quanto hai messo (o tolto) in ogni anno' },
    h('div.inv-filters', segTabs(PIVOTS.filter(o => o.value !== 'grp' || hasGroups), pivotBy, v => { pivotBy = v; ctx.rerender(); }),
      isHd ? segTabs([{ value: 'eur', label: 'Importi' }, { value: 'qty', label: 'Quote comprate' }], pivotUnit, v => { pivotUnit = v; ctx.rerender(); }) : null),
    pivotDonut,
    scrollTable(pivotTable),
    h('p.fine', icon('info', 14), h('span', 'Gli importi comprendono le commissioni (e per le vendite l\'imposta trattenuta), come la colonna "totale" dei fogli dei PAC: chi somma solo l\'importo vede qualche euro in meno. Il prezzo medio comprende le commissioni, come lo calcola il fisco.',
      hasGroups ? '' : ' Dai una categoria ai titoli (es. "Azioni USA", "Oro", "Liquidità") da "Modifica titolo" per vederli raggruppati.')));

  // rendite, tasse e costi
  const sumY = (y, f) => { const Y = inv.years.get(y); return Y ? f(Y) : 0; };
  const lines = [
    ['Cedole e dividendi', Y => Y.income],
    ['Guadagni realizzati (netti)', Y => Y.realized],
    ['Commissioni', Y => -Y.fees],
    ['Imposte sulle vendite', Y => -Y.taxes],
    ['Imposta di bollo e spese', Y => -Y.costs],
  ];
  const totCost = Y => -(Y.fees + Y.taxes + Y.costs);
  const tone = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');
  const vcell = v => h('td.num', { class: tone(v) }, v ? moneyText(v, ui.base, { sign: true }) : '—');
  const costTable = h('table.table.nw-table.nw-months.inv-table',
    h('thead', h('tr', h('th.sticky', ''), years.map(y => h('th.num', String(y))), h('th.num.diff', 'Totale'))),
    h('tbody', lines.map(([label, f]) => {
      const all = years.reduce((a, y) => a + sumY(y, f), 0);
      return h('tr', h('td.sticky', label), years.map(y => vcell(sumY(y, f))), h('td.num.diff', { class: tone(all) }, all ? moneyText(all, ui.base, { sign: true }) : '—'));
    })),
    h('tfoot', h('tr.total', h('td.sticky', 'Tasse e costi'), years.map(y => vcell(sumY(y, totCost))), (() => { const all = years.reduce((a, y) => a + sumY(y, totCost), 0); return h('td.num.diff', { class: tone(all) }, all ? moneyText(all, ui.base, { sign: true }) : '—'); })())));
  const costCard = card('Rendite, tasse e costi', { sub: 'Anno per anno', action: h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => bolloEditor(ctx) }, icon('plus', 16), 'Bollo') },
    scrollTable(costTable),
    h('p.fine', icon('info', 14), h('span', 'L\'imposta di bollo la registri con "Imposta di bollo" (o come spesa del conto investimenti in "Tasse e imposte").', p.hasTer ? [' I fondi costano anche ', h('b', moneyText(p.terYear)), ' all\'anno di TER, già compreso nel prezzo.'] : null)));

  return h('div.stack', hero, chart, monthsCard, pivotCard, costCard,
    h('p.fine', icon('info', 14), ' Investito = acquisti con commissioni meno vendite al netto di commissioni e imposte. Titoli in altre valute al cambio attuale.'));
}

/** Tabella larga che scorre di lato, aperta sugli anni più recenti. */
function scrollTable(table) {
  const wrap = h('div.table-wrap.nw-scroll', table);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; }));
  return wrap;
}

const importBtn = ctx => h('button.btn.btn-soft', { type: 'button', onclick: () => openInvestImport(ctx) }, icon('upload', 18), 'Importa da Excel o CSV');

const VIEWS = [{ value: '', label: 'Portafoglio' }, { value: 'operazioni', label: 'Operazioni' }, { value: 'anni', label: 'Anno per anno' }];

export default {
  render(ctx) {
    const { st, d } = ctx;
    if (ctx.route.params[0]) return detail(ctx, ctx.route.params[0]);
    const invAcc = st.accounts.filter(a => hasHoldings(a) && !a.archived);
    const p = d.portfolio();
    const vista = VIEWS.some(v => v.value === ctx.route.query.vista) ? ctx.route.query.vista : '';
    const actions = [
      h('button.btn.btn-soft', { type: 'button', disabled: busy, onclick: () => updatePrices(ctx), title: 'Aggiorna i prezzi online' }, icon('refresh', 18, busy ? 'spin' : ''), h('span', busy ? 'Aggiorno…' : 'Prezzi')),
      h('button.btn.btn-soft', { type: 'button', onclick: () => holdingEditor(ctx) }, icon('plus', 18), h('span', 'Titolo')),
    ];
    if (!invAcc.length && !st.holdings.length) {
      return { title: 'Investimenti', node: h('section.card', empty({ icon: 'trend', title: 'Nessun conto investimenti', text: 'Crea un conto investimenti (il tuo broker o la banca) o un wallet crypto, poi aggiungi ETF, azioni, BTP e crypto con le loro operazioni.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => accountEditor(ctx, null, { type: 'broker' }) }, icon('plus', 18), 'Crea un conto investimenti'), importBtn(ctx)) })), actions: [] };
    }
    if (!st.holdings.length) {
      return { title: 'Investimenti', node: h('section.card', empty({ icon: 'trend', title: 'Nessun titolo', text: 'Aggiungi i titoli che hai: con quantità e prezzo di carico calcolo guadagni, tasse e allocazione.', action: h('div.row-btns', h('button.btn.btn-primary', { type: 'button', onclick: () => holdingEditor(ctx) }, icon('plus', 18), 'Aggiungi un titolo'), importBtn(ctx)) })), actions };
    }
    const tabs = segTabs(VIEWS, vista, v => ctx.go('investimenti' + (v ? '?vista=' + v : '')));
    let body;
    if (vista === 'operazioni') body = opsView(ctx);
    else if (vista === 'anni') body = yearsView(ctx);
    else body = h('div.stack', summary(ctx, p), h('div.two-col', table(ctx, p), allocation(ctx, p)),
      h('p.fine', icon('info', 14), ' Tasse stimate con il costo medio ponderato: 26% (titoli di Stato 12,5%, crypto 33%). Non tiene conto di minusvalenze da compensare: per la dichiarazione senti il tuo commercialista.'));
    return {
      title: 'Investimenti', sub: st.settings.market.enabled ? 'Prezzi online attivi' : 'Prezzi inseriti a mano',
      node: h('div.stack', tabs, body),
      actions,
    };
  },
};
