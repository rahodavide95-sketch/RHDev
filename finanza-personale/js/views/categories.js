/* Gestione libera delle categorie: gruppi (le "categorie" dei fogli, es. LAVORO, MUSICA) con il
   loro colore e le sottocategorie (es. STIPENDIO, DJ, PRODUZIONE). Si creano, rinominano,
   colorano, riordinano, nascondono, uniscono ed eliminano. */

import { h, icon } from '../ui/dom.js';
import { openSheet, field, textInput, segmented, toast } from '../ui/components.js';
import { S } from '../session.js';
import * as A from '../actions.js';
import { categoryEditor, undoToast } from './editors.js';

/** Colore del gruppo: quello scelto, altrimenti uno fisso ricavato dal nome. */
export function groupColor(st, kind, group) {
  const n = st.settings.groupColors?.[`${kind}:${group}`];
  if (n) return `var(--c${n})`;
  // senza un colore scelto: uno diverso per ogni categoria, nell'ordine in cui compaiono
  const groups = [...new Set(st.categories.filter(c => c.kind === kind && !c.archived).map(c => c.group))];
  const i = groups.indexOf(group);
  if (i >= 0) return `var(--c${(i % 8) + 1})`;
  let x = 0;
  for (const ch of String(group)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--c${(x % 8) + 1})`;
}

function groupEditor(kind, group, onDone) {
  const st = S.state;
  const name = textInput({ value: group, max: 40, autofocus: true });
  let color = st.settings.groupColors?.[`${kind}:${group}`] || 0;
  const sw = h('div.swatches', Array.from({ length: 8 }, (_, i) => {
    const b = h('button.swatch', { type: 'button', 'aria-label': `Colore ${i + 1}`, 'aria-pressed': String(color === i + 1), style: { background: `var(--c${i + 1})` }, onclick: () => {
      color = i + 1;
      sw.querySelectorAll('.swatch').forEach((x, j) => x.setAttribute('aria-pressed', String(j === i)));
    } });
    return b;
  }));
  const save = () => {
    const nm = name.value.trim();
    if (!nm) return;
    if (nm !== group) {
      const clash = st.categories.some(c => c.kind === kind && c.group === nm);
      A.renameGroup(kind, group, nm);
      if (clash) toast(`Unite in "${nm}"`);
    }
    if (color) A.setGroupColor(kind, nm, color);
    s.close(true);
    onDone();
  };
  const s = openSheet({
    title: 'Modifica categoria', subtitle: 'Il nome e il colore valgono per tutte le sue sottocategorie', size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, field('Nome', name, { hint: 'Se scrivi il nome di un\'altra categoria, le due si uniscono' }), field('Colore', sw), h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Salva')],
  });
}

function newGroup(kind, onDone) {
  const g = textInput({ placeholder: kind === 'income' ? 'Es. Musica' : 'Es. Studio', max: 40, autofocus: true });
  const c = textInput({ placeholder: kind === 'income' ? 'Es. DJ' : 'Es. Strumenti', max: 50 });
  const save = () => {
    const gn = g.value.trim(), cn = c.value.trim();
    if (!gn) return;
    A.saveCategory({ name: cn || gn, emoji: '🏷️', kind, group: gn });
    s.close(true);
    onDone();
  };
  const s = openSheet({
    title: 'Nuova categoria', size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); save(); } }, field('Categoria', g), field('Prima sottocategoria', c, { hint: 'Potrai aggiungerne altre dopo' }), h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: save }, 'Crea')],
  });
}

/** Finestra con tutte le categorie di entrata o di uscita. */
export function categoryManager(ctx, kind = 'income') {
  let k = kind;
  const list = h('div.catman');
  const draw = () => {
    const st = S.state;
    const cats = st.categories.filter(c => c.kind === k);
    const groups = [...new Set(cats.map(c => c.group))];
    const used = new Map();
    for (const t of st.transactions) if (t.category) used.set(t.category, (used.get(t.category) || 0) + 1);
    list.replaceChildren(...groups.map((g, gi) => {
      const col = groupColor(st, k, g);
      const items = cats.filter(c => c.group === g);
      return h('div.catman-group',
        h('div.catman-head',
          h('span.grp-chip', { style: { '--chip': col } }, g),
          h('span.catman-tools',
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Sposta ${g} su`, disabled: gi === 0, onclick: () => { A.moveGroup(k, g, -1); draw(); } }, icon('chevU', 16)),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Sposta ${g} giù`, disabled: gi === groups.length - 1, onclick: () => { A.moveGroup(k, g, 1); draw(); } }, icon('chevD', 16)),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Modifica ${g}`, onclick: () => groupEditor(k, g, draw) }, icon('edit', 16)))),
        h('div.rows', items.map((c, ci) => h('div.row.catman-row', { class: c.archived ? 'off' : '' },
          h('button.row-main', { type: 'button', onclick: () => categoryEditor(c, k, draw) },
            h('span.row-title', h('span.sub-chip', { style: { '--chip': col } }, c.emoji && c.emoji !== '•' ? c.emoji + ' ' : '', c.name), c.archived ? h('span.pill', 'nascosta') : null),
            h('span.row-sub', used.get(c.id) ? `${used.get(c.id)} movimenti` : 'nessun movimento')),
          h('span.catman-tools',
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Sposta ${c.name} su`, disabled: ci === 0, onclick: () => { A.moveCategory(c.id, -1); draw(); } }, icon('chevU', 16)),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Sposta ${c.name} giù`, disabled: ci === items.length - 1, onclick: () => { A.moveCategory(c.id, 1); draw(); } }, icon('chevD', 16)))))),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => categoryEditor(null, k, draw, { group: g }) }, icon('plus', 16), 'Sottocategoria'));
    }), h('button.btn.btn-soft.btn-block', { type: 'button', onclick: () => newGroup(k, draw) }, icon('plus', 18), 'Nuova categoria'));
  };
  draw();
  const sh = openSheet({
    title: 'Categorie', subtitle: 'Crea, rinomina, colora e riordina come vuoi', size: 'md',
    body: h('div.stack', segmented([{ value: 'income', label: 'Entrate' }, { value: 'expense', label: 'Uscite' }], k, v => { k = v; draw(); }, { small: true }), list),
    footer: [h('button.btn.btn-primary', { type: 'button', onclick: () => sh.close(true) }, 'Fatto')],
    onClose: () => ctx.rerender(),
  });
}

export { undoToast };
