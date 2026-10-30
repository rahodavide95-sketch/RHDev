/* Mercati: quotazioni pubbliche di indici, ETF, azioni, materie prime, valute e crypto.
   Solo con il consenso ai dati online. La ricerca è prima nell'elenco interno; "Cerca online"
   chiede a onvista.de solo il testo cercato. */

import { h, icon, debounce } from '../ui/dom.js';
import { sparkline, lineChart } from '../ui/charts.js';
import { openSheet, toast, empty } from '../ui/components.js';
import { card, segTabs } from './common.js';
import { holdingEditor } from './editors.js';
import { askMarketConsent } from './investments.js';
import { commit } from '../session.js';
import { MKT_CATEGORIES, SEARCH_DB } from '../data/markets.js';
import { quote, ovSearch, isIsin } from '../market.js';
import { formatNumber, formatPercent } from '../core/money.js';

const M = { cat: 'Preferiti', range: '1M', limit: 20, gen: 0 };
const RANGES = ['1G', '1S', '1M', '3M', '6M', 'YTD', '1A', '5A', 'Max'];
const CLS = { Azione: 'stock', ETF: 'etf_eq', Crypto: 'crypto', Obbligazione: 'gov', 'Materia prima': 'gold' };

const info = s => SEARCH_DB.find(x => x.s === s);
const fmtP = p => (p == null ? '—' : formatNumber(p, p >= 1000 ? 2 : p >= 1 ? 2 : 6, 2));
const pctTone = p => (p == null ? '' : p > 0 ? 'pos' : p < 0 ? 'neg' : '');

function inWatch(st, s) { return st.watchlist.some(w => w.symbol === s); }
function toggleWatch(st, item) {
  commit(s => {
    if (s.watchlist.some(w => w.symbol === item.symbol)) s.watchlist = s.watchlist.filter(w => w.symbol !== item.symbol);
    else s.watchlist.push({ symbol: item.symbol, name: item.name });
  }, { noCount: true });
}

function detailSheet(ctx, item) {
  const box = h('div.stack');
  const meta = info(item.symbol);
  let range = M.range;
  const body = h('div');
  const load = () => {
    body.replaceChildren(h('div.skeleton', { style: { height: '220px' } }));
    quote({ ...item, isin: item.isin || meta?.isin || undefined }, range).then(q => {
      const labels = q.stamps?.map(t => new Date(t * 1000).toLocaleDateString('it-IT', range === '1G' ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: ['5A', 'Max', '1A'].includes(range) ? '2-digit' : undefined })) || [];
      body.replaceChildren(
        h('div.mkt-head', h('div.hero-value', fmtP(q.price), h('span.muted.small', ' ' + (q.currency || 'punti'))), q.change != null ? h('span.delta', { class: 'delta-' + pctTone(q.change) }, formatPercent(q.change, 2, true)) : null),
        q.closes?.length > 1 ? lineChart({ labels, series: [{ name: item.name, color: (q.change ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)', values: q.closes, area: true }], fmt: v => fmtP(v) + (q.currency ? ' ' + q.currency : ''), fmtAxis: v => formatNumber(v, v >= 100 ? 0 : 2), height: 220, zero: false }) : h('p.muted', 'Grafico non disponibile.'),
        q.venue || q.isin ? h('p.fine', [q.venue ? `Prezzi di ${q.venue}` : '', q.isin ? `ISIN ${q.isin}` : ''].filter(Boolean).join(' · ')) : null);
    }).catch(() => body.replaceChildren(h('p.muted', 'Dati non raggiungibili ora. Riprova più tardi.')));
  };
  const tabs = h('div');
  const drawTabs = () => tabs.replaceChildren(segTabs(RANGES.map(r => ({ value: r, label: r })), range, v => { range = v; drawTabs(); load(); }));
  drawTabs();
  box.append(tabs, body,
    meta?.desc ? h('p.muted', meta.desc) : null,
    meta ? h('div.mini-list', h('div.mini-row', h('span.mini-l', 'Simbolo'), h('span.mini-r', item.symbol)), meta.x ? h('div.mini-row', h('span.mini-l', 'Mercato'), h('span.mini-r', meta.x)) : null, meta.isin ? h('div.mini-row', h('span.mini-l', 'ISIN'), h('span.mini-r', h('button.link', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(meta.isin); toast('ISIN copiato', { kind: 'ok' }); } catch { /* */ } } }, meta.isin, ' ', icon('copy', 13)))) : null) : null);
  load();
  openSheet({
    title: item.name, subtitle: item.symbol, size: 'lg', body: box,
    footer: [
      h('button.btn.btn-ghost', { type: 'button', onclick: () => { toggleWatch(ctx.st, item); toast(inWatch(ctx.st, item.symbol) ? 'Aggiunto ai preferiti' : 'Tolto dai preferiti'); } }, icon('star', 18), inWatch(ctx.st, item.symbol) ? 'Togli dai preferiti' : 'Preferito'),
      meta && meta.t !== 'Indice' && meta.t !== 'Valuta' ? h('button.btn.btn-soft', { type: 'button', onclick: () => holdingEditor(ctx, null, { name: meta.n, symbol: meta.s }) }, icon('plus', 18), 'Nel portafoglio') : null,
    ],
  });
}

async function fill(ctx, items, rows, gen) {
  // al massimo 6 richieste insieme
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      const it = items[k];
      try {
        const q = await quote({ ...it, isin: it.isin || info(it.symbol)?.isin || undefined, category: M.cat === 'Preferiti' ? '' : M.cat, currency: /Azioni IT/.test(M.cat) ? 'EUR' : undefined }, M.range);
        if (gen !== M.gen) return;
        const r = rows[k];
        r.querySelector('.mkt-price').textContent = fmtP(q.price) + (q.currency ? ' ' + q.currency : '');
        const c = r.querySelector('.mkt-chg');
        c.textContent = q.change == null ? '—' : formatPercent(q.change, 2, true);
        c.className = 'mkt-chg delta-' + pctTone(q.change);
        r.querySelector('.mkt-spark').replaceChildren(sparkline(q.closes || [], { color: (q.change ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)', width: 80, height: 30 }));
        r.dataset.chg = q.change ?? '';
      } catch {
        if (gen !== M.gen) return;
        rows[k].querySelector('.mkt-price').textContent = 'non disponibile';
        rows[k].querySelector('.mkt-spark').replaceChildren();
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

export default {
  render(ctx) {
    const { st } = ctx;
    if (!st.settings.market.enabled) {
      return {
        title: 'Mercati', node: h('section.card', empty({
          icon: 'globe', title: 'Quotazioni dei mercati',
          text: 'Indici, ETF, azioni, materie prime, valute e crypto con grafici. Per mostrarli l\'app chiede i prezzi pubblici a onvista.de e Binance: viene inviato solo il nome o il codice del titolo, mai i tuoi dati.',
          action: h('button.btn.btn-primary', { type: 'button', onclick: async () => { if (await askMarketConsent(ctx)) ctx.rerender(); } }, icon('globe', 18), 'Attiva i dati di mercato'),
        })),
      };
    }
    const cats = ['Preferiti', ...Object.keys(MKT_CATEGORIES)];
    const list = M.cat === 'Preferiti' ? st.watchlist.map(w => ({ symbol: w.symbol, name: w.name })) : MKT_CATEGORIES[M.cat] || [];
    const shown = list.slice(0, M.limit);
    const gen = ++M.gen;
    const rows = shown.map(it => h('div.row.mkt-row',
      h('button.mkt-main', { type: 'button', onclick: () => detailSheet(ctx, it) },
        h('span.row-main', h('span.row-title', it.name), h('span.row-sub', it.symbol)),
        h('span.mkt-spark', h('span.skeleton', { style: { width: '80px', height: '24px' } })),
        h('span.row-end', h('span.mkt-price.amt', '…'), h('span.mkt-chg', ''))),
      h('button.mkt-star', { type: 'button', class: inWatch(st, it.symbol) ? 'on' : '', 'aria-pressed': String(inWatch(st, it.symbol)), 'aria-label': `${it.name}: preferito`, onclick: () => toggleWatch(st, it) }, icon('star', 18))));
    setTimeout(() => fill(ctx, shown, rows, gen), 0);

    // ricerca nell'elenco interno (non esce dal dispositivo); online solo se richiesto
    const q = h('input.input.search-input', { type: 'search', placeholder: 'Cerca: Apple, VWCE, oro, bitcoin, ISIN…', 'aria-label': 'Cerca un titolo' });
    const res = h('div.search-results');
    q.addEventListener('input', debounce(() => {
      const t = q.value.trim().toLowerCase();
      if (!t) { res.replaceChildren(); return; }
      const found = SEARCH_DB.filter(x => x.s.toLowerCase().includes(t) || x.n.toLowerCase().includes(t) || (x.isin && x.isin.toLowerCase().includes(t))).slice(0, 8);
      const term = q.value.trim();
      const online = h('div.rows');
      const searchOnline = async () => {
        online.replaceChildren(h('p.muted', 'Cerco…'));
        try {
          const list = await ovSearch(term, 10);
          online.replaceChildren(...(list.length ? list.map(x => h('button.row', { type: 'button', onclick: () => detailSheet(ctx, { symbol: x.isin || x.symbol || x.name, name: x.name, isin: x.isin, type: x.type }) },
            h('span.row-main', h('span.row-title', x.name), h('span.row-sub', [x.display, x.isin, x.symbol].filter(Boolean).join(' · '))), icon('chevR', 16))) : [h('p.muted', 'Nessun risultato.')]));
        } catch { online.replaceChildren(h('p.muted', 'Ricerca non raggiungibile ora.')); }
      };
      res.replaceChildren(...found.map(x => h('button.row', { type: 'button', onclick: () => detailSheet(ctx, { symbol: x.s, name: x.n }) }, h('span.row-main', h('span.row-title', x.n), h('span.row-sub', `${x.s} · ${x.x} · ${x.t}`)), icon('chevR', 16))),
        term.length >= 2 ? h('button.row', { type: 'button', onclick: searchOnline }, h('span.row-main', h('span.row-title', `Cerca "${term}" online`), h('span.row-sub', isIsin(term) ? 'Per codice ISIN' : 'Azioni, ETF, ETC, indici, per nome o ISIN')), icon('search', 16)) : null, online);
    }, 120));

    return {
      title: 'Mercati', sub: 'Quotazioni pubbliche · ritardo possibile',
      node: h('div.stack',
        h('section.card', h('div.search-wrap', icon('search', 18), q), res),
        segTabs(cats.map(c => ({ value: c, label: c, count: c === 'Preferiti' ? st.watchlist.length || null : null })), M.cat, v => { M.cat = v; M.limit = 20; ctx.rerender(); }),
        segTabs(RANGES.map(r => ({ value: r, label: r })), M.range, v => { M.range = v; ctx.rerender(); }),
        card(null, {}, rows.length ? h('div.rows', rows) : h('p.muted', M.cat === 'Preferiti' ? 'Tocca la stella accanto a un titolo per averlo qui.' : 'Nessun titolo.'),
          list.length > M.limit ? h('button.btn.btn-soft.btn-block', { type: 'button', onclick: () => { M.limit += 20; ctx.rerender(); } }, `Mostra altri (${list.length - M.limit})`) : null),
        h('p.fine', icon('info', 14), ' Dati da onvista.de e Binance, a scopo informativo. Non sono consigli di investimento.')),
      actions: [h('button.icon-btn', { type: 'button', 'aria-label': 'Aggiorna', onclick: () => ctx.rerender() }, icon('refresh', 20))],
    };
  },
};

export { CLS };
