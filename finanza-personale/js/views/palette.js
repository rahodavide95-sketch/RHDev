/* Ricerca rapida (⌘K / Ctrl K): pagine, azioni, conti, categorie, titoli e movimenti. */

import { h, icon } from '../ui/dom.js';
import { openSheet } from '../ui/components.js';
import { moneyText } from '../ui/fmt.js';
import { txEditor, accountEditor, recurringEditor, goalEditor, holdingEditor } from './editors.js';
import { openImporter } from './importer.js';
import { checkInEditor } from './networth.js';
import * as session from '../session.js';
import { formatDate } from '../core/dates.js';
import { parseAmount } from '../core/money.js';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function openPalette(ctx) {
  const { st, d, go } = ctx;
  const pages = [
    ['Panoramica', '', 'home'], ['Movimenti', 'movimenti', 'list'], ['Conti', 'conti', 'wallet'], ['Patrimonio', 'patrimonio', 'layers'], ['Investimenti', 'investimenti', 'trend'],
    ['Budget', 'budget', 'pie'], ['Scadenze', 'scadenze', 'calendar'], ['Obiettivi', 'obiettivi', 'target'], ['Analisi', 'analisi', 'chart'],
    ['Simulazioni', 'simulazioni', 'calc'], ['Mercati', 'mercati', 'globe'], ['Impostazioni', 'impostazioni', 'settings'],
    ['Simulazione PAC', 'simulazioni/pac', 'calc'], ['Simulazione mutuo', 'simulazioni/mutuo', 'calc'], ['Simulazione conto deposito', 'simulazioni/deposito', 'calc'], ['Indipendenza finanziaria', 'simulazioni/fire', 'calc'],
  ].map(([t, p, ic]) => ({ t, s: 'Vai a', ic, run: () => go(p) }));
  const actions = [
    { t: 'Nuovo movimento', s: 'Azione · N', ic: 'plus', run: () => txEditor(ctx) },
    { t: 'Nuova spesa', s: 'Azione', ic: 'out', run: () => txEditor(ctx, null, { kind: 'expense' }) },
    { t: 'Nuova entrata', s: 'Azione', ic: 'in', run: () => txEditor(ctx, null, { kind: 'income' }) },
    { t: 'Nuovo giroconto', s: 'Azione', ic: 'transfer', run: () => txEditor(ctx, null, { kind: 'transfer' }) },
    { t: 'Nuovo conto', s: 'Azione', ic: 'wallet', run: () => accountEditor(ctx) },
    { t: 'Aggiorna i valori (casa, auto, fondi…)', s: 'Azione', ic: 'edit', run: () => checkInEditor(ctx) },
    { t: 'Nuova scadenza o abbonamento', s: 'Azione', ic: 'calendar', run: () => recurringEditor(ctx) },
    { t: 'Nuovo obiettivo', s: 'Azione', ic: 'target', run: () => goalEditor(ctx) },
    { t: 'Nuovo titolo', s: 'Azione', ic: 'trend', run: () => holdingEditor(ctx) },
    { t: 'Importa estratto conto (CSV)', s: 'Azione', ic: 'upload', run: () => openImporter(ctx) },
    { t: 'Scarica backup cifrato', s: 'Azione', ic: 'download', run: () => go('impostazioni?backup=1') },
    { t: 'Blocca l\'app', s: 'Azione · L', ic: 'lock', run: () => session.lock() },
  ];
  const accounts = st.accounts.map(a => ({ t: a.name, s: 'Conto · ' + moneyText(d.balances.get(a.id) || 0, a.currency), ic: 'wallet', run: () => go('conti/' + a.id) }));
  const cats = st.categories.filter(c => !c.archived).map(c => ({ t: `${c.emoji} ${c.name}`, s: 'Categoria · movimenti di quest\'anno', ic: 'tag', run: () => go(`movimenti?cat=${c.id}&anno=${d.refDate.slice(0, 4)}`) }));
  const holds = st.holdings.map(x => ({ t: x.name, s: `Titolo · ${x.symbol}`, ic: 'trend', run: () => go('investimenti/' + x.id) }));
  const goals = st.goals.map(g => ({ t: `${g.emoji} ${g.name}`, s: 'Obiettivo', ic: 'target', run: () => go('obiettivi') }));
  const base = [...actions, ...pages, ...accounts, ...cats, ...holds, ...goals];

  const input = h('input.input.palette-input', { type: 'search', placeholder: 'Cerca pagine, azioni, conti, movimenti…', autofocus: true, 'aria-label': 'Cerca' });
  const list = h('div.palette-list', { role: 'listbox' });
  let items = [], active = 0;
  const draw = () => {
    const q = norm(input.value.trim());
    if (!q) items = [...actions.slice(0, 5), ...pages.slice(0, 11)];
    else {
      const words = q.split(/\s+/);
      const match = x => words.every(w => norm(x.t + ' ' + x.s).includes(w));
      items = base.filter(match).slice(0, 20);
      const amt = parseAmount(input.value.trim());
      const txs = [];
      for (let i = st.transactions.length - 1; i >= 0 && txs.length < 12; i--) {
        const t = st.transactions[i];
        const hay = norm(`${t.payee} ${t.note} ${t.tags.join(' ')}`);
        if (words.every(w => hay.includes(w)) || (amt && Math.abs(amt) === t.amount)) txs.push(t);
      }
      txs.sort((a, b) => (a.date < b.date ? 1 : -1));
      items.push(...txs.map(t => ({ t: t.payee || 'Movimento', s: `${formatDate(t.date, { year: true })} · ${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${moneyText(t.amount, d.accById.get(t.account)?.currency)}`, ic: t.kind === 'income' ? 'in' : t.kind === 'expense' ? 'out' : 'transfer', run: () => txEditor(ctx, t) })));
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren(...(items.length ? items.map((x, i) => h('button.palette-item', { type: 'button', role: 'option', 'aria-selected': String(i === active), onclick: () => pick(i), onmousemove: () => { if (active !== i) { active = i; mark(); } } },
      h('span.palette-ic', icon(x.ic, 18)), h('span.row-main', h('span.row-title', x.t), h('span.row-sub', x.s)), i === active ? h('kbd', '↵') : null)) : [h('p.muted.pad', 'Nessun risultato')]));
  };
  const mark = () => [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
  const pick = i => { const x = items[i]; if (!x) return; s.close(true); setTimeout(() => x.run(), 30); };
  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
  });
  draw();
  const s = openSheet({ title: 'Cerca', size: 'md', className: 'palette', body: h('div.stack-sm', h('div.search-wrap', icon('search', 18), input), list) });
}
