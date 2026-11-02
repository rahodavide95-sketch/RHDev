/* Panoramica. D: "le cards nella panoramica non mi piacciono… non le voglio così"; scelte sue:
   poche card e grandi, con Net Worth, Entrate e uscite, Investimenti e Scadenze/budget/obiettivi.
   Ogni card: numero grande, pochi numeri di contorno, un grafico, un collegamento alla pagina. */

import { h, icon } from '../ui/dom.js';
import { lineChart, barChart, legend } from '../ui/charts.js';
import { progressBar, ring, empty, segmented, toast } from '../ui/components.js';
import { money, moneyText, delta, axisMoney, tipMoney, ui } from '../ui/fmt.js';
import { card, linkBtn, avatar, colorVar, colorDot, setSectionColor } from './common.js';
import { txEditor, accountEditor, recurringEditor, goalEditor } from './editors.js';
import { postRecurring, skipRecurring, setGroupColor } from '../actions.js';
import { formatMonth, monthKey, formatDate, relDays, today, monthName, diffMonths, lastMonths } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { groupColor } from './categories.js';

let range = 12;

function greeting(name) {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'Buonanotte' : hr < 13 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
  return name ? `${g}, ${name}` : g;
}

/* colori smorzati (D: "quei colori non farli così vivaci") */
const soft = c => `color-mix(in srgb, ${c} 62%, var(--ink-3))`;
const kpi = (label, value, extra) => h('div.dk', h('span.dk-l', label), h('span.dk-v', value), extra ? h('span.dk-x', extra) : null);
const head = (title, sub, href) => h('div.dash-head', h('div', h('a.dash-label', { href }, title, icon('chevR', 15)), sub || null));

/* ─── Net Worth: quello di fine mese (come la pagina Patrimonio) ─── */
function netWorthCard(ctx) {
  const { d } = ctx;
  const M = d.nwMonthly(Math.max(range, 13));
  const L = M.last;
  if (!M.sections.length || M.total[L] == null) {
    return h('section.card.dash-card.dash-wide', head('Net Worth', null, '#/patrimonio'),
      h('p.muted', 'Importa il tuo foglio Net Worth o scrivi i valori di fine mese: qui vedrai il patrimonio effettivo di ogni fine mese.'));
  }
  const now = M.total[L], prev = L > 0 ? M.total[L - 1] : null;
  const lastDate = M.cols[L], Y = Number(lastDate.slice(0, 4));
  const decI = M.cols.indexOf(`${Y - 1}-12-31`);
  const startY = decI >= 0 ? M.total[decI] : null;
  let maxI = L;
  M.total.forEach((v, i) => { if (v != null && v > (M.total[maxI] ?? -Infinity)) maxI = i; });
  const from = Math.max(0, L + 1 - range);
  const idx = Array.from({ length: L + 1 - from }, (_, k) => from + k);
  const chart = lineChart({
    labels: idx.map(i => formatMonth(M.cols[i].slice(0, 7), true)), tipLabels: idx.map(i => `Fine ${formatMonth(M.cols[i].slice(0, 7))}`),
    series: [{ name: 'Net Worth', color: 'var(--c1)', values: idx.map(i => M.total[i]), area: true }],
    fmt: tipMoney, fmtAxis: axisMoney, height: 230, zero: false, mask: ui.privacy, title: 'Net Worth a fine mese',
  });
  const chg = prev != null ? now - prev : null;
  const ytd = startY != null ? now - startY : null;
  const secs = M.sections.map(s => ({ s, v: s.total[L] || 0, col: soft(colorVar(s.color)) }));
  const pos = secs.reduce((a, x) => a + Math.max(0, x.v), 0) || 1;
  return h('section.card.dash-card.dash-wide.dash-nw',
    h('div.dash-head',
      h('div', h('a.dash-label', { href: '#/patrimonio' }, `Net Worth a fine ${monthName(Number(lastDate.slice(5, 7)))} ${Y}`, icon('chevR', 15)), h('div.dash-big', money(now))),
      segmented([{ value: 6, label: '6M' }, { value: 12, label: '1A' }, { value: 24, label: '2A' }], range, v => { range = v; ctx.rerender(); }, { small: true, label: 'Periodo' })),
    h('div.dash-kpis',
      kpi('Sul mese prima', chg != null ? money(chg, d.base, { sign: true, tone: chg >= 0 ? 'pos' : 'neg' }) : '—', chg != null && prev ? delta(chg / Math.abs(prev) * 100) : null),
      kpi(`Dal 31/12/${Y - 1}`, ytd != null ? money(ytd, d.base, { sign: true, tone: ytd >= 0 ? 'pos' : 'neg' }) : '—', ytd != null && startY ? delta(ytd / Math.abs(startY) * 100) : null),
      kpi('Il più alto', money(M.total[maxI]), formatMonth(M.cols[maxI].slice(0, 7)))),
    h('div.dash-nw-body',
      h('div.dash-chart', chart),
      h('div.dash-secs',
        h('div.alloc-bar.dash-alloc', secs.filter(x => x.v > 0).map(x => h('span', { style: { width: (x.v / pos * 100) + '%', background: x.col }, title: x.s.name }))),
        h('div.dash-list', secs.map(x => h('div.dash-row', 
          colorDot(x.s.color, c => setSectionColor(d, x.s.name, c), `Colore di ${x.s.name}`), h('span.dash-n', x.s.name),
          h('span.dash-p', x.v > 0 ? formatPercent(x.v / pos * 100, 0) : ''), x.s.total[L] == null ? h('span.dash-v.muted', '—') : h('span.dash-v', money(x.v, d.base, { tone: x.v < 0 ? 'neg' : '' }))))))));
}

/* ─── Entrate e uscite dell'anno, come la pagina (media sui mesi trascorsi) ─── */
function flowsCard(ctx) {
  const { d, st } = ctx;
  const Y = Number(d.refDate.slice(0, 4));
  const inc = d.yearTable(Y, 'income'), out = d.yearTable(Y, 'expense');
  const href = '#/entrate-uscite';
  if (!inc.total && !out.total) {
    return h('section.card.dash-card', head(`Entrate e uscite ${Y}`, null, href),
      h('p.muted', 'Importa il foglio delle entrate e delle uscite (mese per mese) o registra i movimenti: qui vedrai quanto entra, quanto esce e per cosa.'));
  }
  const avg = t => (t.months ? Math.round(t.total / t.months) : 0);
  const saved = inc.total - out.total;
  const cur = +d.refDate.slice(5, 7);
  const shown = Math.max(inc.months, out.months, 1);
  const labels = Array.from({ length: 12 }, (_, i) => monthName(i + 1, true));
  const chart = barChart({
    labels: labels.slice(0, Math.max(shown, cur)), tipLabels: labels.map((_, i) => `${monthName(i + 1)} ${Y}`).slice(0, Math.max(shown, cur)),
    series: [{ name: 'Entrate', color: 'var(--c3)', values: inc.byMonth.slice(0, Math.max(shown, cur)) }, ...(out.total ? [{ name: 'Uscite', color: 'var(--c2)', values: out.byMonth.slice(0, Math.max(shown, cur)) }] : [])],
    fmt: tipMoney, fmtAxis: axisMoney, height: 170, highlight: shown - 1, mask: ui.privacy, title: `Entrate e uscite ${Y} mese per mese`,
  });
  const macros = [...inc.groups].filter(g => g.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);
  return h('section.card.dash-card',
    head(`Entrate e uscite ${Y}`, h('div.dash-big.sm', money(inc.total, d.base, { tone: 'pos' })), href),
    h('div.dash-kpis',
      kpi('Media al mese', money(avg(inc)), `entrate, su ${inc.months} ${inc.months === 1 ? 'mese' : 'mesi'}`),
      kpi('Uscite', out.total ? money(out.total) : '—', out.total ? `${moneyText(avg(out))} al mese` : 'ancora nessuna'),
      out.total ? kpi('Risparmio', money(saved, d.base, { sign: true, tone: saved >= 0 ? 'pos' : 'neg' }), inc.total ? `${formatPercent(saved / inc.total * 100, 0)} delle entrate` : null) : null),
    chart,
    out.total ? legend([{ label: 'Entrate', color: 'var(--c3)' }, { label: 'Uscite', color: 'var(--c2)' }]) : null,
    macros.length ? h('div.dash-list.dash-macros', macros.map(g => {
      const col = soft(groupColor(st, 'income', g.name));
      const raw = groupColor(st, 'income', g.name), m = /^var\(--c(\d)\)$/.exec(raw);
      return h('div.dash-row.dash-macro',
        colorDot(m ? +m[1] : raw, v => setGroupColor('income', g.name, v), `Colore di ${g.name}`), h('a.dash-n', { href }, g.name),
        h('span.dash-p', formatPercent(g.total / inc.total * 100, 0)), h('span.dash-v', money(g.total)),
        h('i.dash-bar', h('b', { style: { width: (g.total / macros[0].total * 100) + '%', background: col } })));
    })) : null);
}

/* ─── Investimenti: a sé (non entrano nel Net Worth) ─── */
function investCard(ctx) {
  const { d, st } = ctx;
  const href = '#/investimenti';
  if (!st.holdings.some(x => x.ops.length)) {
    return h('section.card.dash-card', head('Investimenti', null, href),
      h('p.muted', 'Importa il foglio delle operazioni (wallet e crypto): qui vedrai quanto hai investito, quando e quanto vale.'));
  }
  const all = d.invest(''), eq = d.invest('titoli'), cr = d.invest('crypto');
  const p = d.portfolio('');
  const Y = Number(d.refDate.slice(0, 4)), curM = monthKey(d.refDate);
  const thisY = all.years.get(Y);
  const monthsAll = all.firstMonth ? Math.max(1, diffMonths(all.firstMonth + '-01', curM + '-01') + 1) : 1;
  const priced = p.value > 0 && st.holdings.some(x => x.price > 0);
  const tot = Math.max(1, Math.abs(eq.total) + Math.abs(cr.total));
  const keys = lastMonths(12, curM);
  return h('section.card.dash-card',
    head('Investimenti', h('div.dash-big.sm', money(all.total)), href),
    h('p.dash-cap', `Investito in totale, da ${formatMonth(all.firstMonth || curM)}`),
    h('div.dash-kpis',
      priced ? kpi('Valore oggi', money(p.value), h('span', money(p.gain, d.base, { sign: true, tone: p.gain >= 0 ? 'pos' : 'neg' }), ' ', delta(p.gainPct))) : null,
      kpi(`Nel ${Y}`, money(thisY?.net || 0), thisY ? `${moneyText(Math.round(thisY.net / all.monthsIn(Y, d.refDate)))} al mese` : 'ancora niente'),
      kpi('Media al mese', money(Math.round(all.total / monthsAll)), `su ${monthsAll} mesi`)),
    h('div.alloc-bar.dash-alloc', [[eq.total, 'var(--c1)', 'Azionario'], [cr.total, 'var(--c4)', 'Crypto']].filter(x => x[0] > 0).map(([v, c, t]) => h('span', { style: { width: (v / tot * 100) + '%', background: soft(c) }, title: t }))),
    h('div.dash-list',
      h('a.dash-row', { href: href + '?scope=titoli' }, h('span.dash-dot', { style: { background: soft('var(--c1)') } }), h('span.dash-n', 'Azionario'), h('span.dash-p', formatPercent(Math.max(0, eq.total) / tot * 100, 0)), h('span.dash-v', money(eq.total))),
      h('a.dash-row', { href: href + '?scope=crypto' }, h('span.dash-dot', { style: { background: soft('var(--c4)') } }), h('span.dash-n', 'Crypto'), h('span.dash-p', formatPercent(Math.max(0, cr.total) / tot * 100, 0)), h('span.dash-v', money(cr.total)))),
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
    const node = h('div.dash2', notes(ctx), startCard(ctx), netWorthCard(ctx), flowsCard(ctx), investCard(ctx), planCard(ctx));
    return { title: greeting(name), sub: formatDate(today(), { long: true, year: true }), node };
  },
};
