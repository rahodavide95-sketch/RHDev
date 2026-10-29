/* Panoramica: patrimonio, questo mese, budget, scadenze, obiettivi, spese, investimenti. */

import { h, icon } from '../ui/dom.js';
import { lineChart, barChart, donut, SERIES, legend } from '../ui/charts.js';
import { progressBar, ring, empty, segmented, toast } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, linkBtn, txRow, avatar } from './common.js';
import { txEditor, accountEditor, recurringEditor, goalEditor } from './editors.js';
import { postRecurring, skipRecurring } from '../actions.js';
import { formatMonth, monthKey, formatDate, relDays, monthStart, monthEnd, addMonthKey, today } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { GROUPS, ASSET_CLASSES } from '../core/model.js';

let range = 12;

function greeting(name) {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'Buonanotte' : hr < 13 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
  return name ? `${g}, ${name}` : g;
}

function netWorthCard(ctx) {
  const { d } = ctx;
  const hist = d.netWorthHistory(range);
  const prev = hist.length > 1 ? hist[hist.length - 2].total : null;
  const first = hist[0]?.total;
  const chg = prev != null && prev !== 0 ? (d.netWorth - prev) / Math.abs(prev) * 100 : null;
  const chgAbs = prev != null ? d.netWorth - prev : null;
  const groups = Object.entries(d.groupTotals).filter(([, v]) => v !== 0);
  const chart = lineChart({
    labels: hist.map(x => formatMonth(x.month, true)), tipLabels: hist.map(x => formatMonth(x.month)),
    series: [{ name: 'Patrimonio', color: 'var(--c1)', values: hist.map(x => x.total), area: true }],
    fmt: tipMoney, fmtAxis: axisMoney, height: 200, zero: false, mask: ui.privacy, title: 'Patrimonio netto negli ultimi mesi',
  });
  return h('section.card.hero-card',
    h('div.hero-top',
      h('div',
        h('a.hero-label.hero-link', { href: '#/patrimonio' }, 'Patrimonio netto', icon('chevR', 15)),
        h('div.hero-value', money(d.netWorth)),
        h('div.hero-delta',
          chgAbs ? money(chgAbs, d.base, { sign: true, tone: chgAbs >= 0 ? 'pos' : 'neg' }) : null,
          chgAbs && chg != null ? delta(chg) : null,
          chgAbs ? h('span.muted', 'dall\'ultimo mese') : null)),
      segmented([{ value: 6, label: '6M' }, { value: 12, label: '1A' }, { value: 24, label: '2A' }], range, v => { range = v; ctx.rerender(); }, { small: true, label: 'Periodo' })),
    chart,
    h('div.hero-groups', groups.map(([g, v]) => h('a.hero-chip', { href: '#/conti' }, h('span.hero-chip-l', GROUPS[g].label), money(v, d.base, { tone: v < 0 ? 'neg' : '' })))),
    h('p.card-foot', first != null && hist.length > 2 ? [`In ${hist.length - 1} mesi: `, money(d.netWorth - first, d.base, { sign: true, tone: d.netWorth >= first ? 'pos' : 'neg' }), ' · '] : null, h('a', { href: '#/patrimonio' }, 'Andamento di ogni conto e confronto con l\'anno scorso')));
}

function monthCard(ctx) {
  const { d } = ctx;
  const flows = d.monthlyFlows(6);
  const cur = flows[flows.length - 1];
  const rate = cur.income > 0 ? (cur.income - cur.expense) / cur.income * 100 : null;
  const avg = flows.slice(0, -1).filter(f => f.income || f.expense);
  const avgExp = avg.length ? avg.reduce((a, f) => a + f.expense, 0) / avg.length : null;
  const b = d.budget();
  return h('section.card',
    h('div.card-head', h('div.card-titles', h('h2.card-title', 'Questo mese'), h('p.card-sub', formatMonth(monthKey(d.refDate)))), linkBtn('Analisi', '#/analisi')),
    h('div.stats-3',
      h('div.stat', h('div.stat-label', 'Entrate'), h('div.stat-value', money(cur.income, d.base, { tone: 'pos' }))),
      h('div.stat', h('div.stat-label', 'Uscite'), h('div.stat-value', money(cur.expense))),
      h('div.stat', h('div.stat-label', 'Risparmio'), h('div.stat-value', money(cur.net, d.base, { tone: cur.net >= 0 ? 'pos' : 'neg', sign: true })), rate != null ? h('div.stat-extra', formatPercent(rate, 0) + ' delle entrate') : null)),
    barChart({
      labels: flows.map(f => formatMonth(f.month, true).split(' ')[0]), tipLabels: flows.map(f => formatMonth(f.month)),
      series: [{ name: 'Entrate', color: 'var(--c3)', values: flows.map(f => f.income) }, { name: 'Uscite', color: 'var(--c2)', values: flows.map(f => f.expense) }],
      fmt: tipMoney, fmtAxis: axisMoney, height: 160, highlight: flows.length - 1, mask: ui.privacy, title: 'Entrate e uscite degli ultimi 6 mesi',
    }),
    legend([{ label: 'Entrate', color: 'var(--c3)' }, { label: 'Uscite', color: 'var(--c2)' }]),
    avgExp ? h('p.card-foot', icon('bolt', 15), ' A questo ritmo il mese chiude con ', h('b', moneyText(b.projected)), ' di spese (media ', moneyText(Math.round(avgExp)), ').') : null);
}

function budgetCard(ctx) {
  const { d } = ctx;
  const b = d.budget();
  if (!b.rows.length) return card('Budget', { action: linkBtn('Imposta', '#/budget') }, h('p.muted', 'Decidi quanto spendere al mese per categoria: qui vedrai a che punto sei, giorno per giorno.'));
  const pct = b.planned ? b.spent / b.planned : 0;
  return card('Budget', { sub: `${moneyText(b.spent)} di ${moneyText(b.planned)}`, action: linkBtn('Tutti', '#/budget') },
    progressBar(pct, { marker: b.progress }),
    h('div.mini-list', b.rows.slice(0, 5).map(r => h('a.mini-row', { href: '#/budget' },
      h('span.mini-l', h('span.cat-emoji', r.category.emoji), r.category.name),
      h('span.mini-r', { class: r.left < 0 ? 'neg' : '' }, moneyText(Math.abs(r.left)), h('span.muted', r.left >= 0 ? ' restano' : ' oltre')),
      progressBar(r.pct, { marker: b.progress })))));
}

function dueCard(ctx) {
  const { d } = ctx;
  const due = d.dueList();
  const up = d.upcoming(21).slice(0, 6);
  if (!due.length && !up.length) {
    return card('Scadenze', { action: linkBtn('Gestisci', '#/scadenze') }, h('p.muted', 'Stipendio, affitto, bollette, abbonamenti: aggiungili una volta e l\'app li ricorda per te.'),
      h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => recurringEditor(ctx) }, icon('plus', 16), 'Aggiungi una scadenza'));
  }
  return card('Scadenze', { sub: d.fixedMonthly ? `Spese fisse ≈ ${moneyText(Math.round(d.fixedMonthly))} al mese` : '', action: linkBtn('Tutte', '#/scadenze') },
    due.length ? h('div.due-box',
      h('div.due-title', icon('alert', 16), `${due.length} da registrare`),
      due.slice(0, 4).map(x => h('div.due-row',
        avatar(x.rule.emoji || d.catById.get(x.rule.category)?.emoji || '🔁'),
        h('span.row-main', h('span.row-title', x.rule.name), h('span.row-sub', `${formatDate(x.date)} · ${relDays(x.date)}`)),
        h('span.due-amt', money(x.rule.amount, d.accById.get(x.rule.account)?.currency)),
        h('div.due-btns',
          h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: () => { postRecurring(x.rule.id, x.date); toast('Registrato', { kind: 'ok' }); } }, 'Registra'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => skipRecurring(x.rule.id, x.date) }, 'Salta'))))) : null,
    h('div.rows', up.map(x => h('button.row', { type: 'button', onclick: () => recurringEditor(ctx, x.rule) },
      h('span.date-chip', h('b', x.date.slice(8)), formatDate(x.date).split(' ')[1]),
      h('span.row-main', h('span.row-title', x.rule.name), h('span.row-sub', relDays(x.date) + (x.rule.autoPost ? ' · automatica' : ''))),
      h('span.row-end', x.rule.amount ? money(x.rule.kind === 'income' ? x.rule.amount : -x.rule.amount, d.accById.get(x.rule.account)?.currency, { sign: x.rule.kind === 'income', tone: x.rule.kind === 'income' ? 'pos' : x.rule.kind === 'transfer' ? 'mute' : '' }) : h('span.muted', 'variabile'))))));
}

function goalsCard(ctx) {
  const { d, st } = ctx;
  const goals = st.goals.filter(g => !g.archived);
  if (!goals.length) return card('Obiettivi', { action: linkBtn('Crea', '#/obiettivi') }, h('p.muted', 'Un viaggio, il fondo emergenza, la casa: dagli una cifra e una data, ti dico quanto mettere da parte al mese.'),
    h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => goalEditor(ctx) }, icon('plus', 16), 'Nuovo obiettivo'));
  return card('Obiettivi', { action: linkBtn('Tutti', '#/obiettivi') },
    h('div.goal-mini', goals.slice(0, 4).map(g => {
      const p = d.goal(g);
      return h('a.goal-mini-item', { href: '#/obiettivi' }, ring(p.pct, 64, 6, g.emoji), h('div.goal-mini-t', g.name), h('div.goal-mini-s', `${Math.round(p.pct * 100)}%`));
    })));
}

function spendingCard(ctx) {
  const { d } = ctx;
  const m = monthKey(d.refDate);
  const f = d.flows(monthStart(m), monthEnd(m));
  const cats = [...f.byCat.entries()].map(([id, v]) => ({ id, v, c: d.catById.get(id) })).filter(x => x.c?.kind === 'expense' || x.id === '_exp').sort((a, b) => b.v - a.v);
  if (!cats.length) return card('Spese per categoria', { sub: formatMonth(m) }, h('p.muted', 'Ancora nessuna spesa questo mese.'));
  const top = cats.slice(0, 6), rest = cats.slice(6).reduce((a, x) => a + x.v, 0);
  const items = top.map((x, i) => ({ label: x.c ? x.c.name : 'Senza categoria', value: x.v, color: SERIES[i], emoji: x.c?.emoji || '•', id: x.id }));
  if (rest > 0) items.push({ label: 'Altro', value: rest, color: 'var(--c-other)', emoji: '…' });
  return card('Spese per categoria', { sub: formatMonth(m), action: linkBtn('Dettagli', '#/analisi') },
    h('div.donut-row',
      donut({ items, size: 168, thickness: 20, center: { value: moneyText(f.expense), label: 'in totale' }, fmt: tipMoney, mask: ui.privacy, onPick: it => it.id && ctx.go(`movimenti?cat=${it.id}&mese=${m}`) }),
      h('div.donut-legend', items.map(it => h('a.dl-row', { href: it.id ? `#/movimenti?cat=${it.id}&mese=${m}` : '#/analisi' },
        h('span.dl-key', { style: { background: it.color } }), h('span.dl-name', it.emoji + ' ' + it.label), h('span.dl-val', moneyText(it.value)))))));
}

function investCard(ctx) {
  const { d } = ctx;
  const p = d.portfolio();
  if (!p.rows.length) return null;
  const cls = [...p.byClass.entries()].sort((a, b) => b[1] - a[1]);
  const total = cls.reduce((a, x) => a + x[1], 0) || 1;
  return card('Investimenti', { action: linkBtn('Portafoglio', '#/investimenti') },
    h('div.stats-2',
      h('div.stat', h('div.stat-label', 'Valore'), h('div.stat-value', money(p.value))),
      h('div.stat', h('div.stat-label', 'Guadagno'), h('div.stat-value', money(p.gain, d.base, { sign: true, tone: p.gain >= 0 ? 'pos' : 'neg' })), h('div.stat-extra', delta(p.gainPct)))),
    h('div.alloc-bar', cls.map(([k, v], i) => h('span', { style: { width: (v / total * 100) + '%', background: SERIES[i] }, title: ASSET_CLASSES[k].label }))),
    h('div.alloc-legend', cls.map(([k, v], i) => h('span.legend-item', h('span.legend-key', { style: { background: SERIES[i] } }), `${ASSET_CLASSES[k].label} ${Math.round(v / total * 100)}%`))));
}

function recentCard(ctx) {
  const list = [...ctx.st.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created - a.created)).slice(0, 6);
  if (!list.length) return null;
  return card('Ultimi movimenti', { action: linkBtn('Tutti', '#/movimenti') }, h('div.rows', list.map(t => txRow(ctx, t, { showDate: true }))));
}

function insightsCard(ctx) {
  const { d, st } = ctx;
  const out = [];
  const flows = d.monthlyFlows(7).slice(0, -1).filter(f => f.income || f.expense);
  const avgExp = flows.length ? flows.reduce((a, f) => a + f.expense, 0) / flows.length : 0;
  const liquid = d.groupTotals.liquidity;
  if (avgExp > 0 && liquid > 0) {
    const months = liquid / avgExp;
    out.push({ ic: 'shield', tone: months >= 6 ? 'pos' : months >= 3 ? '' : 'warn', t: `La liquidità copre ${months >= 24 ? 'più di 24' : months.toFixed(1).replace('.', ',')} mesi di spese`, s: months >= 6 ? 'Ottimo cuscinetto per gli imprevisti.' : 'Di solito si consigliano da 3 a 6 mesi di spese.' });
  }
  if (flows.length >= 2) {
    const inc = flows.reduce((a, f) => a + f.income, 0), exp = flows.reduce((a, f) => a + f.expense, 0);
    if (inc > 0) out.push({ ic: 'trend', tone: inc > exp ? 'pos' : 'warn', t: `Risparmi in media il ${formatPercent((inc - exp) / inc * 100, 0)} delle entrate`, s: `Negli ultimi ${flows.length} mesi: ${moneyText(Math.round((inc - exp) / flows.length))} al mese.` });
  }
  const subs = st.recurring.filter(r => r.active && r.subscription);
  if (subs.length) {
    const yearly = subs.reduce((a, r) => a + d.toBase(r.amount, d.accById.get(r.account)?.currency || d.base) * ({ day: 365, week: 52, month: 12, year: 1 }[r.unit] / r.every), 0);
    out.push({ ic: 'repeat', t: `${subs.length} abbonamenti costano ${moneyText(Math.round(yearly))} all'anno`, s: 'Controlli quali usi davvero?', href: '#/scadenze' });
  }
  // categoria in crescita rispetto alla media
  const m = monthKey(d.refDate);
  const curF = d.flows(monthStart(m), monthEnd(m));
  const day = Number(d.refDate.slice(8, 10));
  if (day >= 10 && flows.length >= 3) {
    let best = null;
    const prev3 = [1, 2, 3].map(i => { const k = addMonthKey(m, -i); return d.flows(monthStart(k), monthEnd(k)).byCat; });
    for (const [cat, v] of curF.byCat) {
      const c = d.catById.get(cat);
      if (!c || c.kind !== 'expense') continue;
      const sumPrev = prev3.reduce((a, bc) => a + (bc.get(cat) || 0), 0);
      const avg = sumPrev / 3;
      if (avg > 2000 && v > avg * 1.3 && (!best || v - avg > best.diff)) best = { c, v, avg, diff: v - avg };
    }
    if (best) out.push({ ic: 'alert', tone: 'warn', t: `${best.c.emoji} ${best.c.name}: ${moneyText(best.v)} questo mese`, s: `La tua media è ${moneyText(Math.round(best.avg))}.`, href: `#/movimenti?cat=${best.c.id}&mese=${m}` });
  }
  if (d.missingFx.size) out.push({ ic: 'alert', tone: 'warn', t: `Manca il cambio per ${[...d.missingFx].join(', ')}`, s: 'Aggiungilo nelle impostazioni per avere totali corretti.', href: '#/impostazioni' });
  if (!out.length) return null;
  return card('Da sapere', {}, h('div.insights', out.map(x => h(x.href ? 'a.insight' : 'div.insight', { href: x.href, class: x.tone ? 'ins-' + x.tone : '' }, h('span.insight-ic', icon(x.ic, 18)), h('span', h('b', x.t), h('span.muted', x.s))))));
}

function startCard(ctx) {
  const { st } = ctx;
  const steps = [
    { done: st.accounts.length > 0, t: 'Aggiungi i tuoi conti', s: 'Conto corrente, carte, deposito, investimenti, mutuo…', fn: () => accountEditor(ctx) },
    { done: st.transactions.length > 0, t: 'Registra un movimento', s: 'Oppure importa l\'estratto conto della banca (CSV).', fn: () => txEditor(ctx) },
    { done: st.recurring.length > 0, t: 'Aggiungi stipendio, affitto e abbonamenti', s: 'Li ricordo io e li registro quando arrivano.', fn: () => recurringEditor(ctx) },
    { done: Object.keys(st.budgets).length > 0, t: 'Imposta un budget', s: 'Quanto vuoi spendere al mese per categoria.', fn: () => ctx.go('budget') },
    { done: st.meta.lastBackup > 0, t: 'Fai il primo backup cifrato', s: 'Una copia dei dati fuori da questo dispositivo.', fn: () => ctx.go('impostazioni?backup=1') },
  ];
  const left = steps.filter(x => !x.done).length;
  if (!left || st.transactions.length > 40) return null;
  return h('section.card.start-card',
    h('div.card-head', h('div.card-titles', h('h2.card-title', 'Primi passi'), h('p.card-sub', `${steps.length - left} di ${steps.length} fatti`))),
    h('div.steps', steps.map((x, i) => h('button.step', { type: 'button', class: x.done ? 'done' : '', onclick: x.fn, disabled: x.done },
      h('span.step-n', x.done ? icon('check', 16) : String(i + 1)),
      h('span.row-main', h('span.row-title', x.t), h('span.row-sub', x.s)),
      x.done ? null : icon('chevR', 18)))),
    h('a.link-btn', { href: '#/impostazioni?import=1' }, icon('upload', 16), 'Importa un estratto conto CSV'));
}

export default {
  render(ctx) {
    const { st } = ctx;
    const name = st.settings.name;
    // l'ordine su telefono (una colonna) lo decide il CSS con le classi o-*
    const o = (el, n) => { if (el) el.classList.add('o-' + n); return el; };
    const node = h('div.dash',
      h('div.dash-col.dash-main', o(startCard(ctx), 1), o(netWorthCard(ctx), 2), o(monthCard(ctx), 4), o(spendingCard(ctx), 7), o(recentCard(ctx), 10)),
      h('div.dash-col.dash-side', o(insightsCard(ctx), 3), o(dueCard(ctx), 5), o(budgetCard(ctx), 6), o(goalsCard(ctx), 8), o(investCard(ctx), 9)));
    if (!st.accounts.length) {
      return {
        title: greeting(name), sub: formatDate(today(), { long: true, year: true }),
        node: h('div.stack-lg', startCard(ctx) || null, h('section.card', empty({ icon: 'wallet', title: 'Inizia dai tuoi conti', text: 'Aggiungi il conto corrente con il saldo di oggi: da lì l\'app calcola tutto il resto.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => accountEditor(ctx) }, icon('plus', 18), 'Aggiungi un conto') }))),
      };
    }
    return { title: greeting(name), sub: formatDate(today(), { long: true, year: true }), node };
  },
};
