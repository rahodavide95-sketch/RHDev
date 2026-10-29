/* Obiettivi di risparmio: avanzamento, quanto mettere da parte al mese, versamenti. */

import { h, icon } from '../ui/dom.js';
import { ring, progressBar, empty, twoTap } from '../ui/components.js';
import { money, moneyText } from '../ui/fmt.js';
import { card } from './common.js';
import { goalEditor, contributeEditor, undoToast } from './editors.js';
import { deleteContribution, archiveGoal } from '../actions.js';
import { formatDate, relDays } from '../core/dates.js';

let showArchived = false;

function goalCard(ctx, g) {
  const { d } = ctx;
  const p = d.goal(g);
  const acc = g.account ? d.accById.get(g.account) : null;
  const status = p.done ? 'Raggiunto! 🎉'
    : p.perMonth != null ? `Metti da parte ${moneyText(p.perMonth)} al mese per ${p.monthsLeft} ${p.monthsLeft === 1 ? 'mese' : 'mesi'}`
    : g.date && !p.done ? 'La data è passata' : 'Senza scadenza';
  const contribs = [...g.contributions].sort((a, b) => (a.date < b.date ? 1 : -1));
  return h('section.card.goal-card', { class: p.done ? 'done' : '' },
    h('div.goal-top',
      ring(p.pct, 84, 8, g.emoji),
      h('div.goal-info',
        h('h3.goal-name', g.name),
        h('div.goal-amt', money(p.saved), h('span.muted', ' di ', moneyText(g.target))),
        h('div.goal-status', status),
        g.date ? h('div.muted.small', `Entro il ${formatDate(g.date, { long: true, year: true })} · ${relDays(g.date)}`) : null,
        acc ? h('div.muted.small', icon('wallet', 13), ` Collegato a ${acc.name}`) : null),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Modifica obiettivo', onclick: () => goalEditor(ctx, g) }, icon('edit', 18))),
    progressBar(p.pct, { tone: p.done ? 'ok' : 'brand' }),
    !acc ? h('div.row-btns',
      h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => contributeEditor(ctx, g) }, icon('plus', 16), 'Aggiungi'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => contributeEditor(ctx, g, true) }, icon('minus', 16), 'Togli'),
      p.done ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => archiveGoal(g.id, !g.archived) }, icon('archive', 16), g.archived ? 'Ripristina' : 'Archivia') : null) : null,
    !acc && contribs.length ? h('details.goal-hist', h('summary', `${contribs.length} versamenti`), h('div.rows', contribs.map(c => h('div.row.static',
      h('span.row-main', h('span.row-title', c.note || (c.amount >= 0 ? 'Versamento' : 'Prelievo')), h('span.row-sub', formatDate(c.date, { year: true }))),
      h('span.row-end', money(c.amount, ctx.d.base, { sign: true, tone: c.amount >= 0 ? 'pos' : 'neg' })),
      twoTap('', () => { deleteContribution(g.id, c.id); undoToast('Versamento eliminato'); }, { cls: 'icon-btn danger', iconName: 'trash', confirmLabel: '?' }))))) : null);
}

export default {
  render(ctx) {
    const { st, d } = ctx;
    const goals = st.goals.filter(g => showArchived || !g.archived);
    if (!st.goals.length) {
      return { title: 'Obiettivi', node: h('section.card', empty({ icon: 'target', title: 'Nessun obiettivo', text: 'Fondo emergenza, vacanza, auto, anticipo per la casa: scegli cifra e data e ti dico quanto risparmiare ogni mese.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => goalEditor(ctx) }, icon('plus', 18), 'Crea un obiettivo') })) };
    }
    const active = st.goals.filter(g => !g.archived);
    const tot = active.reduce((a, g) => a + g.target, 0), saved = active.reduce((a, g) => a + Math.min(g.target, d.goal(g).saved), 0);
    const monthly = active.reduce((a, g) => a + (d.goal(g).perMonth || 0), 0);
    const archivedN = st.goals.filter(g => g.archived).length;
    return {
      title: 'Obiettivi', sub: `${active.length} attivi`,
      node: h('div.stack',
        h('section.card.nw-strip',
          h('div.stat', h('div.stat-label', 'Messo da parte'), h('div.stat-value', money(saved))),
          h('div.stat', h('div.stat-label', 'Da raggiungere'), h('div.stat-value', money(tot))),
          h('div.stat', h('div.stat-label', 'Serve al mese'), h('div.stat-value', money(monthly)), h('div.stat-extra', 'per stare nei tempi'))),
        h('div.goal-grid', goals.map(g => goalCard(ctx, g))),
        archivedN ? h('button.btn.btn-ghost', { type: 'button', onclick: () => { showArchived = !showArchived; ctx.rerender(); } }, icon('archive', 18), showArchived ? 'Nascondi archiviati' : `Mostra archiviati (${archivedN})`) : null),
      actions: [h('button.btn.btn-soft', { type: 'button', onclick: () => goalEditor(ctx) }, icon('plus', 18), h('span', 'Obiettivo'))],
    };
  },
};
