/* Elenco delle release, con l'avanzamento di ogni release (quanti artisti hanno mandato tutto). */

import { h, swap, icon, fmtDay } from '../../ui/dom.js';
import { A, go, formOf, isComplete } from '../state.js';
import { modal, btn, field, input, toast, friendly, empty, chip } from '../ui.js';

export function releaseModal(existing = null, onSaved) {
  const m = modal({ title: existing ? 'Modifica release' : 'Nuova release' });
  const title = input({ type: 'text', maxlength: 200, placeholder: 'Es. Night Visions EP', value: existing ? existing.title : '' });
  const catalog = input({ type: 'text', maxlength: 60, placeholder: 'Es. SSSCLTR005', value: existing ? existing.catalog : '' });
  const date = input({ type: 'date', value: existing && existing.release_date ? existing.release_date : '' });
  const notes = h('textarea.inp', { rows: 3, maxlength: 5000, placeholder: 'Note solo per te (facoltative)' }, existing ? existing.notes : '');
  const err = h('div.err');
  const save = btn(existing ? 'Salva' : 'Crea release', async () => {
    if (!title.value.trim()) { err.textContent = 'Scrivi il titolo.'; return; }
    save.disabled = true;
    try {
      const row = { title: title.value.trim(), catalog: catalog.value.trim(), release_date: date.value || null, notes: notes.value };
      const r = existing ? await A.api.updateRelease(existing.id, row) : await A.api.createRelease(row);
      m.close();
      onSaved && onSaved(r);
    } catch (x) { err.textContent = friendly(x); save.disabled = false; }
  }, { ic: existing ? 'check' : 'plus' });
  m.body.append(h('div.stack', field('Titolo', title), h('div.row2', field('Catalogo', catalog), field('Data di uscita', date)), field('Note', notes), err));
  m.foot.append(btn('Annulla', () => m.close(), { kind: 'ghost' }), save);
}

export async function render(el) {
  const [releases, invites] = await Promise.all([A.api.listReleases(), A.api.listInvites()]);
  const byRel = new Map();
  for (const i of invites) { if (!byRel.has(i.release_id)) byRel.set(i.release_id, []); byRel.get(i.release_id).push(i); }
  const formIds = [...new Set(invites.map(i => i.form_id))];
  await Promise.all(formIds.map(id => formOf(id).catch(() => null)));

  const create = () => releaseModal(null, r => { toast('Release creata', { type: 'ok' }); go('#/release/' + r.id); });
  const add = btn('Nuova release', create, { ic: 'plus' });
  const head = h('div.page-head', h('div', h('h1', 'Release'), h('p.muted', 'Per ogni release aggiungi gli artisti: ognuno riceve il suo link segreto.')), add);
  if (!releases.length) {
    swap(el, head, empty('disc', 'Nessuna release', 'Crea la prima release, poi aggiungi gli artisti e mandagli il link.', btn('Nuova release', create, { ic: 'plus' })));
    return;
  }
  const open = releases.filter(r => !r.closed_at), closed = releases.filter(r => r.closed_at);
  const card = r => {
    const list = byRel.get(r.id) || [];
    const done = list.filter(i => { const f = A.forms.get(i.form_id); return f && isComplete(i, f.schema); }).length;
    const sent = list.filter(i => i.version > 0).length;
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    const changedRecently = list.some(i => i.updated_at && Date.now() - new Date(i.updated_at).getTime() < 3 * 864e5);
    return h('a.card.rel-card', { href: '#/release/' + r.id },
      h('div.rel-top', h('div.rel-ic', icon('disc', 22)),
        h('div.rel-t', h('h3', r.title), h('p.muted', [r.catalog, r.release_date ? fmtDay(r.release_date) : ''].filter(Boolean).join(' · ') || 'Senza catalogo')),
        r.closed_at ? chip('Chiusa', 'muted', 'lock') : changedRecently ? chip('Novità', 'blue', 'bell') : null),
      h('div.rel-stats',
        h('span', icon('users', 15), `${list.length} ${list.length === 1 ? 'artista' : 'artisti'}`),
        h('span', icon('send', 15), `${sent} ${sent === 1 ? 'inviato' : 'inviati'}`),
        h('span', icon('checkCircle', 15), `${done} ${done === 1 ? 'completo' : 'completi'}`)),
      h('div.bar', h('i', { style: { width: pct + '%' } })));
  };
  swap(el, head,
    open.length ? h('div.grid', open.map(card)) : h('p.muted', 'Nessuna release aperta.'),
    closed.length ? h('h2.sub-h', 'Chiuse') : null,
    closed.length ? h('div.grid', closed.map(card)) : null);
}
