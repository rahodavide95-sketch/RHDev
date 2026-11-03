/* Panoramica. D: "le cards nella panoramica non mi piacciono… non le voglio così"; scelte sue:
   poche card e grandi, con Net Worth, Entrate e uscite, Investimenti e Scadenze/budget/obiettivi.
   Ogni card: numero grande, pochi numeri di contorno, un grafico, un collegamento alla pagina. */

import { h, icon } from '../ui/dom.js';
import { lineChart, barChart, legend } from '../ui/charts.js';
import { progressBar, ring, empty, toast } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, linkBtn, avatar, colorVar, colorDot, setSectionColor, loadPeriod, savePeriod, periodPicker } from './common.js';
import { txEditor, accountEditor, recurringEditor, goalEditor } from './editors.js';
import { postRecurring, skipRecurring, setGroupColor } from '../actions.js';
import { formatMonth, monthKey, formatDate, relDays, today, monthName, diffMonths } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { groupColor } from './categories.js';
import { resolvePeriod, monthsBetween } from '../core/period.js';

// periodo della Panoramica (D: "anche nella panoramica, ovunque, devo avere la possibilità di mettere il range periodo che voglio"):
// vale per Net Worth, Entrate e uscite e Investimenti; resta su questo dispositivo
let period = loadPeriod('dash', 12);
const setPeriod = v => { period = v; savePeriod('dash', v); };
const span = P => P.from === P.to ? formatMonth(P.from) : `${formatMonth(P.from)} – ${formatMonth(P.to)}`;
const yearOnly = P => P.from.endsWith('-01') && P.to.slice(0, 4) === P.from.slice(0, 4) && (P.to.endsWith('-12') || P.value === 'ytd');
const periodName = P => yearOnly(P) ? P.from.slice(0, 4) : span(P);

function greeting(name) {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'Buonanotte' : hr < 13 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
  return name ? `${g}, ${name}` : g;
}

/* colori smorzati (D: "quei colori non farli così vivaci") */
const soft = c => `color-mix(in srgb, ${c} 62%, var(--ink-3))`;
const kpi = (label, value, extra) => h('div.dk', h('span.dk-l', label), h('span.dk-v', value), extra ? h('span.dk-x', extra) : null);
const head = (title, sub, href) => h('div.dash-head', h('div', h('a.dash-label', { href }, title, icon('chevR', 15)), sub || null));

/* ─── Net Worth: quello di fine mese (come la pagina Patrimonio), nel periodo scelto ─── */
function netWorthCard(ctx, P) {
  const { d } = ctx;
  const curM = monthKey(d.refDate);
  const M = d.nwMonthly(Math.max(13, diffMonths(P.from + '-01', curM + '-01') + 2));
  const keyAt = i => M.cols[i].slice(0, 7);
  const inP = M.cols.map((c, i) => i).filter(i => keyAt(i) >= P.from && keyAt(i) <= P.to);
  const withData = inP.filter(i => M.total[i] != null);
  const L = withData[withData.length - 1];
  if (!M.sections.length || L == null) {
    return h('section.card.dash-card.dash-wide', head('Net Worth', null, '#/patrimonio'),
      h('p.muted', M.sections.length ? `Nessun valore di fine mese in ${periodName(P)}: scegli un altro periodo qui sopra.` : 'Importa il tuo foglio Net Worth o scrivi i valori di fine mese: qui vedrai il patrimonio effettivo di ogni fine mese.'));
  }
  const now = M.total[L], prev = L > 0 ? M.total[L - 1] : null;
  const lastDate = M.cols[L], Y = Number(lastDate.slice(0, 4));
  // da dove parte il periodo: la fine del mese prima (come il 31/12 per l'anno), altrimenti il primo mese con valori
  const before = inP[0] > 0 && M.total[inP[0] - 1] != null ? inP[0] - 1 : withData[0];
  const startV = before !== L ? M.total[before] : null;
  let maxI = L;
  for (const i of withData) if (M.total[i] > M.total[maxI]) maxI = i;
  const idx = inP.filter(i => i <= L && i >= withData[0]);
  const chart = lineChart({
    labels: idx.map(i => formatMonth(keyAt(i), true)), tipLabels: idx.map(i => `Fine ${formatMonth(keyAt(i))}`),
    series: [{ name: 'Net Worth', color: 'var(--c1)', values: idx.map(i => M.total[i]), area: true }],
    fmt: tipMoney, fmtAxis: axisMoney, height: 230, zero: false, mask: ui.privacy, title: 'Net Worth a fine mese',
  });
  const chg = prev != null ? now - prev : null;
  const inPeriod = startV != null ? now - startV : null;
  const fromLabel = M.cols[before].slice(5) === '12-31' ? `Dal 31/12/${M.cols[before].slice(0, 4)}` : `Da fine ${formatMonth(keyAt(before))}`;
  const secs = M.sections.map(s => ({ s, v: s.total[L] || 0, col: soft(colorVar(s.color)) }));
  const pos = secs.reduce((a, x) => a + Math.max(0, x.v), 0) || 1;
  return h('section.card.dash-card.dash-wide.dash-nw',
    h('div.dash-head',
      h('div', h('a.dash-label', { href: '#/patrimonio' }, `Net Worth a fine ${monthName(Number(lastDate.slice(5, 7)))} ${Y}`, icon('chevR', 15)), h('div.dash-big', money(now)))),
    h('div.dash-kpis',
      kpi('Sul mese prima', chg != null ? money(chg, d.base, { sign: true, tone: chg >= 0 ? 'pos' : 'neg' }) : '—', chg != null && prev ? delta(chg / Math.abs(prev) * 100) : null),
      kpi(fromLabel, inPeriod != null ? money(inPeriod, d.base, { sign: true, tone: inPeriod >= 0 ? 'pos' : 'neg' }) : '—', inPeriod != null && startV ? delta(inPeriod / Math.abs(startV) * 100) : null),
      kpi('Il più alto nel periodo', money(M.total[maxI]), formatMonth(keyAt(maxI)))),
    h('div.dash-nw-body',
      h('div.dash-chart', chart),
      h('div.dash-secs',
        h('div.alloc-bar.dash-alloc', secs.filter(x => x.v > 0).map(x => h('span', { style: { width: (x.v / pos * 100) + '%', background: x.col }, title: x.s.name }))),
        h('div.dash-list', secs.map(x => h('div.dash-row',
          colorDot(x.s.color, c => setSectionColor(d, x.s.name, c), `Colore di ${x.s.name}`), h('a.dash-n', { href: '#/patrimonio?sez=' + encodeURIComponent(x.s.name), title: `Apri ${x.s.name} nel Net Worth` }, x.s.name),
          h('span.dash-p', x.v > 0 ? formatPercent(x.v / pos * 100, 0) : ''), x.s.total[L] == null ? h('span.dash-v.muted', '—') : h('span.dash-v', money(x.v, d.base, { tone: x.v < 0 ? 'neg' : '' }))))))));
}

/* ─── Entrate e uscite nel periodo scelto, come la pagina (media sui mesi trascorsi) ─── */
function rangeTable(d, kind, P) {
  const years = [...new Set(P.months.map(k => +k.slice(0, 4)))];
  const byMonth = new Map(), groups = new Map();
  for (const y of years) {
    const T = d.yearTable(y, kind);
    T.byMonth.forEach((v, m) => { const k = `${y}-${String(m + 1).padStart(2, '0')}`; if (k >= P.from && k <= P.to) byMonth.set(k, (byMonth.get(k) || 0) + v); });
    for (const g of T.groups) {
      const v = g.byMonth.reduce((a, x, m) => { const k = `${y}-${String(m + 1).padStart(2, '0')}`; return k >= P.from && k <= P.to ? a + x : a; }, 0);
      if (v) groups.set(g.name, (groups.get(g.name) || 0) + v);
    }
  }
  const total = [...byMonth.values()].reduce((a, v) => a + v, 0);
  return { byMonth, total, groups: [...groups].map(([name, total]) => ({ name, total })) };
}
function flowsCard(ctx, P) {
  const { d, st } = ctx;
  const href = '#/entrate-uscite';
  const curM = monthKey(d.refDate);
  const keys = P.months.filter(k => k <= curM);
  const title = `Entrate e uscite ${periodName(P)}`;
  const inc = rangeTable(d, 'income', P), out = rangeTable(d, 'expense', P);
  if (!inc.total && !out.total) {
    return h('section.card.dash-card', head(title, null, href),
      h('p.muted', st.transactions.length ? 'Niente in questo periodo: scegline un altro qui sopra.' : 'Importa il foglio delle entrate e delle uscite (mese per mese) o registra i movimenti: qui vedrai quanto entra, quanto esce e per cosa.'));
  }
  // mesi trascorsi, per la media: quello in corso conta solo se ha già degli importi
  // e non quelli prima del primo movimento (un periodo più lungo dei dati non abbassa la media)
  let firstFlow = curM;
  for (const t of st.transactions) if (t.kind !== 'transfer' && t.date.slice(0, 7) < firstFlow) firstFlow = t.date.slice(0, 7);
  const nMonths = Math.max(1, keys.filter(k => k >= firstFlow && (k < curM || inc.byMonth.get(k) || out.byMonth.get(k))).length);
  const saved = inc.total - out.total;
  const lastK = [...keys].reverse().find(k => inc.byMonth.get(k) || out.byMonth.get(k)) || keys[keys.length - 1];
  const chart = barChart({
    labels: keys.map(k => formatMonth(k, true)), tipLabels: keys.map(k => formatMonth(k)),
    series: [{ name: 'Entrate', color: 'var(--c3)', values: keys.map(k => inc.byMonth.get(k) || 0) }, ...(out.total ? [{ name: 'Uscite', color: 'var(--c2)', values: keys.map(k => out.byMonth.get(k) || 0) }] : [])],
    fmt: tipMoney, fmtAxis: axisMoney, height: 170, highlight: keys.indexOf(lastK), mask: ui.privacy, title: `${title} mese per mese`,
  });
  const macros = inc.groups.filter(g => g.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);
  const anno = Number(P.to.slice(0, 4));
  return h('section.card.dash-card',
    head(title, h('div.dash-big.sm', money(inc.total, d.base, { tone: 'pos' })), href),
    h('div.dash-kpis',
      kpi('Media al mese', money(Math.round(inc.total / nMonths)), `entrate, su ${nMonths} ${nMonths === 1 ? 'mese' : 'mesi'}`),
      kpi('Uscite', out.total ? money(out.total) : '—', out.total ? `${moneyText(Math.round(out.total / nMonths))} al mese` : 'nessuna nel periodo'),
      out.total ? kpi('Risparmio', money(saved, d.base, { sign: true, tone: saved >= 0 ? 'pos' : 'neg' }), inc.total ? `${formatPercent(saved / inc.total * 100, 0)} delle entrate` : null) : null),
    chart,
    out.total ? legend([{ label: 'Entrate', color: 'var(--c3)' }, { label: 'Uscite', color: 'var(--c2)' }]) : null,
    macros.length ? h('div.dash-list.dash-macros', macros.map(g => {
      const col = soft(groupColor(st, 'income', g.name));
      const raw = groupColor(st, 'income', g.name), m = /^var\(--c(\d)\)$/.exec(raw);
      return h('div.dash-row.dash-macro',
        colorDot(m ? +m[1] : raw, v => setGroupColor('income', g.name, v), `Colore di ${g.name}`), h('a.dash-n', { href: `${href}?tipo=entrate&anno=${anno}&cat=${encodeURIComponent(g.name)}`, title: `Solo ${g.name} in Entrate e uscite` }, g.name),
        h('span.dash-p', formatPercent(g.total / inc.total * 100, 0)), h('span.dash-v', money(g.total)),
        h('i.dash-bar', h('b', { style: { width: (g.total / macros[0].total * 100) + '%', background: col } })));
    })) : null);
}

/* ─── Investimenti: a sé (non entrano nel Net Worth), nel periodo scelto ─── */
function investCard(ctx, P) {
  const { d, st } = ctx;
  const href = '#/investimenti';
  if (!st.holdings.some(x => x.ops.length)) {
    return h('section.card.dash-card', head('Investimenti', null, href),
      h('p.muted', 'Importa il foglio delle operazioni (wallet e crypto): qui vedrai quanto hai investito, quando e quanto vale.'));
  }
  const all = d.invest(''), eq = d.invest('titoli'), cr = d.invest('crypto');
  const p = d.portfolio('');
  const curM = monthKey(d.refDate);
  const keys = P.months.filter(k => k <= curM);
  const sum = f => keys.reduce((a, k) => a + (f.months.get(k) || 0), 0);
  const tAll = sum(all), tEq = sum(eq), tCr = sum(cr);
  // la media sui mesi da quando investi (non su quelli prima della prima operazione)
  const active = keys.filter(k => all.firstMonth && k >= all.firstMonth);
  const nMonths = Math.max(1, active.length);
  const priced = p.value > 0 && st.holdings.some(x => x.price > 0);
  const tot = Math.max(1, Math.abs(tEq) + Math.abs(tCr));
  const sinceStart = P.value === 'all' || (all.firstMonth && P.from <= all.firstMonth && P.to >= curM);
  return h('section.card.dash-card',
    head('Investimenti', h('div.dash-big.sm', money(tAll)), href),
    h('p.dash-cap', sinceStart ? `Investito in totale, da ${formatMonth(all.firstMonth || curM)}` : `Investito in ${periodName(P)}`),
    h('div.dash-kpis',
      priced ? kpi('Valore oggi', money(p.value), h('span', money(p.gain, d.base, { sign: true, tone: p.gain >= 0 ? 'pos' : 'neg' }), ' ', delta(p.gainPct))) : null,
      kpi('Media al mese', money(Math.round(tAll / nMonths)), `su ${nMonths} ${nMonths === 1 ? 'mese' : 'mesi'}`),
      kpi('Da sempre', money(all.total), `da ${formatMonth(all.firstMonth || curM)}`)),
    h('div.alloc-bar.dash-alloc', [[tEq, 'var(--c1)', 'Azionario'], [tCr, 'var(--c4)', 'Crypto']].filter(x => x[0] > 0).map(([v, c, t]) => h('span', { style: { width: (v / tot * 100) + '%', background: soft(c) }, title: t }))),
    h('div.dash-list',
      h('a.dash-row', { href: href + '?scope=titoli' }, h('span.dash-dot', { style: { background: soft('var(--c1)') } }), h('span.dash-n', 'Azionario'), h('span.dash-p', formatPercent(Math.max(0, tEq) / tot * 100, 0)), h('span.dash-v', money(tEq))),
      h('a.dash-row', { href: href + '?scope=crypto' }, h('span.dash-dot', { style: { background: soft('var(--c4)') } }), h('span.dash-n', 'Crypto'), h('span.dash-p', formatPercent(Math.max(0, tCr) / tot * 100, 0)), h('span.dash-v', money(tCr)))),
    barChart({ labels: keys.map(k => formatMonth(k, true)), tipLabels: keys.map(k => formatMonth(k)), series: [{ name: 'Investito', color: 'var(--c1)', values: keys.map(k => all.months.get(k) || 0) }], fmt: tipMoney, fmtAxis: axisMoney, height: 130, mask: ui.privacy, highlight: keys.length - 1, title: 'Investito ogni mese' }));
}

/* ─── Scadenze, budget e obiettivi: una card sola, tre colonne ─── */
function dueCol(ctx) {
  const { d } = ctx;
  const due = d.dueList();
  const up = d.upcoming(21).slice(0, 5);
  const top = h('div.trio-head', h('h3', 'Scadenze'), linkBtn(due.length || up.length ? 'Tutte' : 'Gestisci', '#/scadenze'));
  if (!due.length && !up.length) {
    return h('div.trio-col', top, h('p.muted', 'Stipendio, affitto, bollette, abbonamenti: aggiungili una volta e l\'app li ricorda.'),
      h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => recurringEditor(ctx) }, icon('plus', 16), 'Aggiungi'));
  }
  return h('div.trio-col', top,
    due.length ? h('div.due-box',
      h('div.due-title', icon('alert', 16), `${due.length} da registrare`),
      due.slice(0, 3).map(x => h('div.due-row',
        avatar(x.rule.emoji || d.catById.get(x.rule.category)?.emoji || '🔁'),
        h('span.row-main', h('span.row-title', x.rule.name), h('span.row-sub', `${formatDate(x.date)} · ${relDays(x.date)}`)),
        h('span.due-amt', money(x.rule.amount, d.accById.get(x.rule.account)?.currency)),
        h('div.due-btns',
          h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: () => { postRecurring(x.rule.id, x.date); toast('Registrato', { kind: 'ok' }); } }, 'Registra'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => skipRecurring(x.rule.id, x.date) }, 'Salta'))))) : null,
    h('div.rows', up.map(x => h('button.row', { type: 'button', onclick: () => recurringEditor(ctx, x.rule) },
      h('span.date-chip', h('b', x.date.slice(8)), formatDate(x.date).split(' ')[1]),
      h('span.row-main', h('span.row-title', x.rule.name), h('span.row-sub', relDays(x.date))),
      h('span.row-end', x.rule.amount ? money(x.rule.kind === 'income' ? x.rule.amount : -x.rule.amount, d.accById.get(x.rule.account)?.currency, { sign: x.rule.kind === 'income', tone: x.rule.kind === 'income' ? 'pos' : x.rule.kind === 'transfer' ? 'mute' : '' }) : h('span.muted', 'variabile'))))));
}

function budgetCol(ctx) {
  const { d } = ctx;
  const b = d.budget();
  if (!b.rows.length) {
    return h('div.trio-col', h('div.trio-head', h('h3', 'Budget'), linkBtn('Imposta', '#/budget')),
      h('p.muted', 'Decidi quanto spendere al mese per categoria: qui vedi a che punto sei, giorno per giorno.'));
  }
  const pct = b.planned ? b.spent / b.planned : 0;
  return h('div.trio-col', h('div.trio-head', h('h3', 'Budget'), linkBtn('Tutti', '#/budget')),
    h('p.dash-cap', `${moneyText(b.spent)} spesi di ${moneyText(b.planned)} questo mese`),
    progressBar(pct, { marker: b.progress }),
    h('div.mini-list', b.rows.slice(0, 4).map(r => h('a.mini-row', { href: '#/budget' },
      h('span.mini-l', h('span.cat-emoji', r.category.emoji), r.category.name),
      h('span.mini-r', { class: r.left < 0 ? 'neg' : '' }, moneyText(Math.abs(r.left)), h('span.muted', r.left >= 0 ? ' restano' : ' oltre')),
      progressBar(r.pct, { marker: b.progress })))));
}

function goalsCol(ctx) {
  const { d, st } = ctx;
  const goals = st.goals.filter(g => !g.archived);
  if (!goals.length) {
    return h('div.trio-col', h('div.trio-head', h('h3', 'Obiettivi'), linkBtn('Crea', '#/obiettivi')),
      h('p.muted', 'Un viaggio, il fondo emergenza, la casa: dagli una cifra e una data, ti dico quanto mettere da parte al mese.'),
      h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => goalEditor(ctx) }, icon('plus', 16), 'Nuovo obiettivo'));
  }
  return h('div.trio-col', h('div.trio-head', h('h3', 'Obiettivi'), linkBtn('Tutti', '#/obiettivi')),
    h('div.goal-mini', goals.slice(0, 3).map(g => {
      const p = d.goal(g);
      return h('a.goal-mini-item', { href: '#/obiettivi' }, ring(p.pct, 64, 6, g.emoji), h('div.goal-mini-t', g.name), h('div.goal-mini-s', `${Math.round(p.pct * 100)}%`));
    })));
}

function planCard(ctx) {
  return h('section.card.dash-card.dash-wide',
    h('div.dash-head', h('div', h('span.dash-label', 'Scadenze, budget e obiettivi'))),
    h('div.dash-trio', dueCol(ctx), budgetCol(ctx), goalsCol(ctx)));
}

function startCard(ctx) {
  const { st } = ctx;
  const steps = [
    { done: st.accounts.length > 0, t: 'Aggiungi i tuoi conti', s: 'Conto corrente, carte, deposito, investimenti, mutuo…', fn: () => accountEditor(ctx) },
    { done: st.transactions.length > 0, t: 'Registra un movimento', s: 'Oppure importa il tuo file Excel o l\'estratto conto della banca.', fn: () => txEditor(ctx) },
    { done: st.recurring.length > 0, t: 'Aggiungi stipendio, affitto e abbonamenti', s: 'Li ricordo io e li registro quando arrivano.', fn: () => recurringEditor(ctx) },
    { done: Object.keys(st.budgets).length > 0, t: 'Imposta un budget', s: 'Quanto vuoi spendere al mese per categoria.', fn: () => ctx.go('budget') },
    { done: st.meta.lastBackup > 0, t: 'Fai il primo backup cifrato', s: 'Una copia dei dati fuori da questo dispositivo.', fn: () => ctx.go('impostazioni?backup=1') },
  ];
  const left = steps.filter(x => !x.done).length;
  if (!left || st.transactions.length > 40) return null;
  return h('section.card.start-card.dash-wide',
    h('div.card-head', h('div.card-titles', h('h2.card-title', 'Primi passi'), h('p.card-sub', `${steps.length - left} di ${steps.length} fatti`))),
    h('div.steps', steps.map((x, i) => h('button.step', { type: 'button', class: x.done ? 'done' : '', onclick: x.fn, disabled: x.done },
      h('span.step-n', x.done ? icon('check', 16) : String(i + 1)),
      h('span.row-main', h('span.row-title', x.t), h('span.row-sub', x.s)),
      x.done ? null : icon('chevR', 18)))),
    h('a.link-btn', { href: '#/impostazioni?import=1' }, icon('upload', 16), 'Importa un estratto conto CSV'));
}

/** Il periodo scelto, dentro i mesi che hanno dati (dal primo movimento, valore del Net Worth o investimento). */
function dashPeriod(ctx) {
  const { d, st } = ctx;
  const curM = monthKey(d.refDate);
  let first = curM;
  for (const t of st.transactions) if (t.date.slice(0, 7) < first) first = t.date.slice(0, 7);
  const inv = d.invest('').firstMonth;
  if (inv && inv < first) first = inv;
  const M = d.nwMonthly(120);
  const nwFirst = M.cols.find((c, i) => M.total[i] != null);
  if (nwFirst && nwFirst.slice(0, 7) < first) first = nwFirst.slice(0, 7);
  const r = resolvePeriod(period, curM, first);
  if (!r.months.length) Object.assign(r, resolvePeriod(12, curM, first));
  return { value: period, ...r, options: monthsBetween(first, curM) };
}

/** Solo gli avvisi che chiedono di fare qualcosa (es. un cambio mancante), in una riga. */
function notes(ctx) {
  const { d } = ctx;
  if (!d.missingFx.size) return null;
  return h('a.dash-note.dash-wide', { href: '#/impostazioni' }, icon('alert', 17),
    h('span', h('b', `Manca il cambio per ${[...d.missingFx].join(', ')}. `), 'Aggiungilo nelle impostazioni (o aggiornalo dalla BCE) per avere i totali giusti.'));
}

export default {
  render(ctx) {
    const { st } = ctx;
    const name = st.settings.name;
    if (!st.accounts.length) {
      return {
        title: greeting(name), sub: formatDate(today(), { long: true, year: true }),
        node: h('div.stack-lg', startCard(ctx) || null, h('section.card', empty({ icon: 'wallet', title: 'Inizia dai tuoi conti', text: 'Aggiungi il conto corrente con il saldo di oggi, o importa il tuo file Excel: da lì l\'app calcola tutto il resto.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => accountEditor(ctx) }, icon('plus', 18), 'Aggiungi un conto') }))),
      };
    }
    const P = dashPeriod(ctx);
    const bar = h('div.dash-period.dash-wide',
      h('span.dash-period-l', icon('calendar', 16), 'Periodo'),
      periodPicker({ value: period, range: P, months: P.options, onChange: v => { setPeriod(v); ctx.rerender(); } }));
    const node = h('div.dash2', notes(ctx), startCard(ctx), bar, netWorthCard(ctx, P), flowsCard(ctx, P), investCard(ctx, P), planCard(ctx));
    return { title: greeting(name), sub: formatDate(today(), { long: true, year: true }), node };
  },
};
