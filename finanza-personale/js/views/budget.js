/* Budget mensile per categoria, con il segno di "dove dovresti essere oggi" e le proposte automatiche. */

import { h, icon } from '../ui/dom.js';
import { progressBar, openSheet, amountInput, toast, confirmDialog, empty } from '../ui/components.js';
import { money, moneyText } from '../ui/fmt.js';
import { card } from './common.js';
import { setBudget } from '../actions.js';
import { commit } from '../session.js';
import { monthKey, addMonthKey, formatMonth, monthStart, monthEnd, today } from '../core/dates.js';
import { formatPercent } from '../core/money.js';

let month = null;

function avgSpend(ctx, catId, n = 3, ref) {
  let s = 0, k = 0;
  for (let i = 1; i <= n; i++) {
    const m = addMonthKey(ref, -i);
    const v = ctx.d.flows(monthStart(m), monthEnd(m)).byCat.get(catId) || 0;
    s += v; k++;
  }
  return k ? s / k : 0;
}
const round10 = c => Math.max(1000, Math.round(c / 1000) * 1000);

function editBudget(ctx, cat, cur) {
  const ref = monthKey(today());
  const avg = avgSpend(ctx, cat.id, 3, ref);
  const last = ctx.d.flows(monthStart(addMonthKey(ref, -1)), monthEnd(addMonthKey(ref, -1))).byCat.get(cat.id) || 0;
  const amt = amountInput({ value: cur || null, autofocus: true, big: true });
  const chip = (label, v) => (v > 0 ? h('button.chip', { type: 'button', onclick: () => { amt.input.value = (round10(v) / 100).toFixed(0); amt.input.dispatchEvent(new Event('input')); } }, label, ' ', h('b', moneyText(round10(v)))) : null);
  const save = () => { setBudget(cat.id, amt.getCents() || 0); toast('Budget aggiornato', { kind: 'ok' }); s.close(true); };
  const s = openSheet({
    title: `${cat.emoji} ${cat.name}`, subtitle: 'Budget al mese', size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, amt, h('div.chips', chip('Media 3 mesi', avg), chip('Mese scorso', last)), h('p.field-hint', 'Lascia vuoto per togliere il budget.'), h('button', { type: 'submit', hidden: true })),
    footer: [cur ? h('button.btn.btn-ghost', { type: 'button', onclick: () => { setBudget(cat.id, 0); s.close(true); } }, 'Togli budget') : null, h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva')],
  });
}

async function suggest(ctx) {
  const ref = monthKey(today());
  const props = [];
  for (const c of ctx.st.categories) {
    if (c.kind !== 'expense' || c.archived || ctx.st.budgets[c.id]) continue;
    const avg = avgSpend(ctx, c.id, 3, ref);
    if (avg >= 1500) props.push({ c, v: round10(avg) });
  }
  if (!props.length) { toast('Servono almeno un paio di mesi di spese per fare proposte.'); return; }
  const tot = props.reduce((a, p) => a + p.v, 0);
  const ok = await confirmDialog({
    title: 'Budget proposti', confirm: `Imposta ${props.length} budget`, icon: 'sparkle',
    message: h('div.stack-sm', h('p.muted', 'In base alla media degli ultimi 3 mesi (arrotondata):'), h('div.mini-list', props.map(p => h('div.mini-row', h('span.mini-l', h('span.cat-emoji', p.c.emoji), p.c.name), h('span.mini-r', moneyText(p.v))))), h('p', 'Totale ', h('b', moneyText(tot)), ' al mese.')),
  });
  if (!ok) return;
  commit(st => { for (const p of props) st.budgets[p.c.id] = p.v; });
  toast('Budget impostati: puoi cambiarli quando vuoi', { kind: 'ok' });
}

export default {
  render(ctx) {
    const { st, d } = ctx;
    const cur = monthKey(d.refDate);
    month = month || cur;
    const b = d.budget(month);
    const isCur = month === cur;
    const f = d.flows(monthStart(month), monthEnd(month));
    const cats = st.categories.filter(c => c.kind === 'expense' && !c.archived);
    const groups = [...new Set(cats.map(c => c.group))];
    const nav = h('div.month-nav',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Mese precedente', onclick: () => { month = addMonthKey(month, -1); ctx.rerender(); } }, icon('chevL', 20)),
      h('span.month-label', formatMonth(month)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Mese successivo', onclick: () => { month = addMonthKey(month, 1); ctx.rerender(); } }, icon('chevR', 20)),
      !isCur ? h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { month = cur; ctx.rerender(); } }, 'Oggi') : null);
    const left = b.planned - b.spent;
    const summary = h('section.card.budget-hero',
      nav,
      b.planned ? h('div.budget-main',
        h('div', h('div.hero-label', left >= 0 ? 'Ti restano' : 'Sei oltre di'), h('div.hero-value', money(Math.abs(left), d.base, { tone: left < 0 ? 'neg' : '' }))),
        h('div.budget-side', h('div', moneyText(b.spent), h('span.muted', ` di ${moneyText(b.planned)}`)), isCur ? h('div.muted', `Giorno ${Number(d.refDate.slice(8))} di ${new Date(+month.slice(0, 4), +month.slice(5), 0).getDate()}`) : null)) : null,
      b.planned ? progressBar(b.planned ? b.spent / b.planned : 0, { marker: isCur ? b.progress : null }) : null,
      h('div.stats-3',
        h('div.stat', h('div.stat-label', 'Entrate del mese'), h('div.stat-value', money(f.income, d.base, { tone: 'pos' }))),
        h('div.stat', h('div.stat-label', 'Spese totali'), h('div.stat-value', money(f.expense)), b.unplanned ? h('div.stat-extra', moneyText(b.unplanned), ' fuori budget') : null),
        h('div.stat', h('div.stat-label', isCur ? 'Previsione fine mese' : 'Risparmio'), h('div.stat-value', isCur ? money(b.projected) : money(f.income - f.expense, d.base, { sign: true, tone: f.income >= f.expense ? 'pos' : 'neg' })))),
      isCur && b.planned && b.progress > 0 ? h('p.card-foot', icon('info', 15), b.spent / b.planned > b.progress + 0.05 ? ` Stai spendendo più in fretta del previsto: oggi dovresti essere al ${formatPercent(b.progress * 100, 0)}, sei al ${formatPercent(b.spent / b.planned * 100, 0)}.` : ' Sei in linea: la riga verticale indica dove dovresti essere oggi.') : null);

    const byCat = new Map(b.rows.map(r => [r.category.id, r]));
    const sections = groups.map(g => {
      const items = cats.filter(c => c.group === g);
      const rows = items.map(c => {
        const r = byCat.get(c.id);
        const spent = f.byCat.get(c.id) || 0;
        if (!r && !spent) return null;
        return h('button.budget-row', { type: 'button', onclick: () => editBudget(ctx, c, st.budgets[c.id]) },
          h('div.budget-row-top',
            h('span.budget-name', h('span.cat-emoji', c.emoji), c.name),
            r ? h('span.budget-nums', h('b', moneyText(spent)), h('span.muted', ' / ' + moneyText(r.planned))) : h('span.budget-nums', moneyText(spent), h('span.pill', 'senza budget'))),
          r ? progressBar(r.pct, { marker: isCur ? b.progress : null }) : null,
          r ? h('div.budget-left', { class: r.left < 0 ? 'neg' : '' }, r.left >= 0 ? `${moneyText(r.left)} disponibili` : `${moneyText(-r.left)} oltre il budget`) : null);
      }).filter(Boolean);
      if (!rows.length) return null;
      return card(g, {}, h('div.budget-rows', rows));
    }).filter(Boolean);
    const noBudget = cats.filter(c => !st.budgets[c.id] && !(f.byCat.get(c.id)));
    const node = h('div.stack', summary,
      !b.rows.length ? h('section.card', empty({ icon: 'pie', title: 'Nessun budget impostato', text: 'Tocca una categoria qui sotto per decidere quanto spendere al mese, oppure lascia che te lo proponga io in base alle tue spese.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => suggest(ctx) }, icon('sparkle', 18), 'Proponimi i budget') })) : null,
      h('div.acc-grid', sections),
      noBudget.length ? card('Altre categorie', { sub: 'Nessuna spesa questo mese · tocca per impostare un budget' }, h('div.chips', noBudget.map(c => h('button.chip', { type: 'button', onclick: () => editBudget(ctx, c, 0) }, c.emoji + ' ' + c.name)))) : null);
    return { title: 'Budget', sub: formatMonth(month), node, actions: [h('button.btn.btn-soft', { type: 'button', onclick: () => suggest(ctx) }, icon('sparkle', 18), h('span', 'Proposte'))] };
  },
};
