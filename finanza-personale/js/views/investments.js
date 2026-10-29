/* Portafoglio: valore, guadagni, allocazione, tasse stimate e il dettaglio di ogni titolo. */

import { h, icon } from '../ui/dom.js';
import { donut, SERIES, lineChart } from '../ui/charts.js';
import { empty, toast, confirmDialog } from '../ui/components.js';
import { money, moneyText, delta, tipMoney, ui } from '../ui/fmt.js';
import { card, avatar, linkBtn, segTabs } from './common.js';
import { holdingEditor, opEditor, accountEditor } from './editors.js';
import { setPrices, setSetting, setFx } from '../actions.js';
import { ASSET_CLASSES, position, hasHoldings } from '../core/model.js';
import { formatNumber, formatPercent } from '../core/money.js';
import { formatDate, today } from '../core/dates.js';
import { refreshHoldings, quote, ecbRates } from '../market.js';

let groupBy = 'cls';
let busy = false;

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
      h('div.stat', h('div.stat-label', 'Tasse se vendi oggi'), h('div.stat-value', money(p.taxIfSold)), h('div.stat-extra', 'bollo ≈ ', moneyText(p.bolloYear), '/anno'))));
}

function allocation(ctx, p) {
  const { d } = ctx;
  const map = new Map();
  for (const r of p.rows) {
    if (r.qty <= 0) continue;
    const k = groupBy === 'cls' ? ASSET_CLASSES[r.holding.cls].label : groupBy === 'acc' ? r.account.name : r.holding.currency;
    map.set(k, (map.get(k) || 0) + r.valueBase);
  }
  const items = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: SERIES[i % 8] }));
  const tot = items.reduce((a, x) => a + x.value, 0) || 1;
  return card('Allocazione', { action: segTabs([{ value: 'cls', label: 'Tipo' }, { value: 'acc', label: 'Conto' }, { value: 'cur', label: 'Valuta' }], groupBy, v => { groupBy = v; ctx.rerender(); }) },
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
    title: hd.name, sub: [hd.symbol, hd.isin, cls.label].filter(Boolean).join(' · '),
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
        h('div.row-btns',
          h('button.btn.btn-soft', { type: 'button', onclick: () => opEditor(ctx, hd, null, 'buy') }, icon('plus', 18), 'Acquisto'),
          h('button.btn.btn-soft', { type: 'button', onclick: () => opEditor(ctx, hd, null, 'sell') }, icon('minus', 18), 'Vendita'),
          h('button.btn.btn-soft', { type: 'button', onclick: () => opEditor(ctx, hd, null, 'div') }, icon('coins', 18), 'Cedola / dividendo'))),
      priceChart(ctx, hd),
      card('Operazioni', { sub: `${ops.length}` }, ops.length ? h('div.rows', ops.map(o => h('button.row', { type: 'button', onclick: () => opEditor(ctx, hd, o) },
        h('span.date-chip', h('b', o.date.slice(8)), formatDate(o.date).split(' ')[1]),
        h('span.row-main', h('span.row-title', OP_LABEL[o.type], o.cash ? h('span.pill', 'liquidità') : null), h('span.row-sub', (o.type === 'buy' || o.type === 'sell' ? `${formatNumber(o.qty, 6)} × ${formatNumber(o.price, 4)} ${c}${o.fee ? ` + ${formatNumber(o.fee, 2)} comm.` : ''}` : '') + (o.note ? ' · ' + o.note : '') + ' · ' + formatDate(o.date, { year: true }))),
        h('span.row-end', o.type === 'buy' ? m(-(o.qty * o.price + o.fee)) : o.type === 'sell' ? money(Math.round((o.qty * o.price - o.fee) * 100), c, { sign: true, tone: 'pos' }) : o.type === 'div' ? money(Math.round(o.amount * 100), c, { sign: true, tone: 'pos' }) : m(-Math.abs(o.amount)))))) : h('p.muted', 'Nessuna operazione.'))),
  };
}

export default {
  render(ctx) {
    const { st, d } = ctx;
    if (ctx.route.params[0]) return detail(ctx, ctx.route.params[0]);
    const invAcc = st.accounts.filter(a => hasHoldings(a) && !a.archived);
    const p = d.portfolio();
    const actions = [
      h('button.btn.btn-soft', { type: 'button', disabled: busy, onclick: () => updatePrices(ctx), title: 'Aggiorna i prezzi online' }, icon('refresh', 18, busy ? 'spin' : ''), h('span', busy ? 'Aggiorno…' : 'Prezzi')),
      h('button.btn.btn-soft', { type: 'button', onclick: () => holdingEditor(ctx) }, icon('plus', 18), h('span', 'Titolo')),
    ];
    if (!invAcc.length && !st.holdings.length) {
      return { title: 'Investimenti', node: h('section.card', empty({ icon: 'trend', title: 'Nessun conto investimenti', text: 'Crea un conto investimenti (il tuo broker o la banca) o un wallet crypto, poi aggiungi ETF, azioni, BTP e crypto con le loro operazioni.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => accountEditor(ctx, null, { type: 'broker' }) }, icon('plus', 18), 'Crea un conto investimenti') })), actions: [] };
    }
    if (!p.rows.length) {
      return { title: 'Investimenti', node: h('section.card', empty({ icon: 'trend', title: 'Nessun titolo', text: 'Aggiungi i titoli che hai: con quantità e prezzo di carico calcolo guadagni, tasse e allocazione.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => holdingEditor(ctx) }, icon('plus', 18), 'Aggiungi un titolo') })), actions };
    }
    return {
      title: 'Investimenti', sub: st.settings.market.enabled ? 'Prezzi online attivi' : 'Prezzi inseriti a mano',
      node: h('div.stack', summary(ctx, p), h('div.two-col', table(ctx, p), allocation(ctx, p)),
        h('p.fine', icon('info', 14), ' Tasse stimate con il costo medio ponderato: 26% (titoli di Stato 12,5%, crypto 33%). Non tiene conto di minusvalenze da compensare: per la dichiarazione senti il tuo commercialista.')),
      actions,
    };
  },
};
