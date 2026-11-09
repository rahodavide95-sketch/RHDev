/* I moduli: come in Google Moduli, ne puoi avere quanti vuoi e cambiarli quando vuoi. */

import { h, swap, icon, ago } from '../../ui/dom.js';
import { defaultForm, blankForm, sanitizeForm } from '../../core/schema.js';
import { A, go } from '../state.js';
import { modal, btn, iconBtn, toast, friendly, empty, chip, confirmBox } from '../ui.js';

function newFormModal(onCreated) {
  const m = modal({ title: 'Nuovo modulo' });
  const pick = async (kind) => {
    try {
      const f = kind === 'release' ? defaultForm() : blankForm();
      const r = await A.api.createForm(f.title, f);
      m.close(); onCreated(r);
    } catch (x) { toast(friendly(x), { type: 'error' }); }
  };
  m.body.append(h('div.pick-grid',
    h('button.pick', { type: 'button', onclick: () => pick('release') }, h('div.pick-ic', icon('disc', 24)), h('b', 'Release delivery'), h('span.muted', 'Dati, bio, press kit, tracce con BPM, tonalità e split, artwork e contratto. In inglese (si può passare all\'italiano in Testi). Pronto da usare, modificabile.')),
    h('button.pick', { type: 'button', onclick: () => pick('blank') }, h('div.pick-ic', icon('file', 24)), h('b', 'Modulo vuoto'), h('span.muted', 'Parti da zero e aggiungi le domande che vuoi (pagina dell\'artista in inglese).'))));
  m.foot.append(btn('Annulla', () => m.close(), { kind: 'ghost' }));
}

export async function render(el) {
  const [forms, invites] = await Promise.all([A.api.listForms(), A.api.listInvites()]);
  const uses = new Map();
  for (const i of invites) uses.set(i.form_id, (uses.get(i.form_id) || 0) + 1);
  const reload = () => render(el);
  const create = () => newFormModal(r => { toast('Modulo creato', { type: 'ok' }); go('#/modulo/' + r.id); });
  const add = btn('Nuovo modulo', create, { ic: 'plus' });
  const head = h('div.page-head', h('div', h('h1', 'Moduli'), h('p.muted', 'Cambia domande, testi, colori e contratto quando vuoi: gli artisti vedono sempre la versione aggiornata.')), add);
  if (!forms.length) { swap(el, head, empty('layers', 'Nessun modulo', 'Crea il modulo "Release delivery" con un tocco.', btn('Nuovo modulo', create, { ic: 'plus' }))); return; }

  const card = f => h('div.card.form-card' + (f.archived ? '.archived' : ''),
    h('a.form-main', { href: '#/modulo/' + f.id },
      h('div.rel-ic', icon('layers', 22)),
      h('div', h('h3', f.title), h('p.muted', `Modificato ${ago(f.updated_at)} · usato da ${uses.get(f.id) || 0} ${(uses.get(f.id) || 0) === 1 ? 'artista' : 'artisti'}`)),
      f.archived ? chip('Archiviato', 'muted', 'archive') : null),
    h('div.form-actions',
      btn('Modifica', () => go('#/modulo/' + f.id), { ic: 'edit', kind: 'ghost small' }),
      iconBtn('copy', 'Duplica', async () => {
        try { const full = await A.api.getForm(f.id); const s = sanitizeForm(full.schema); s.title = s.title + ' (copia)'; await A.api.createForm(s.title, s); toast('Modulo duplicato', { type: 'ok' }); reload(); }
        catch (x) { toast(friendly(x), { type: 'error' }); }
      }),
      iconBtn('archive', f.archived ? 'Togli dall\'archivio' : 'Archivia (non lo proponi più per i nuovi artisti)', async () => {
        try { await A.api.updateForm(f.id, { archived: !f.archived }); A.forms.delete(f.id); reload(); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }),
      iconBtn('trash', 'Elimina', async () => {
        if (uses.get(f.id)) { toast('È usato da qualche artista: puoi archiviarlo, non eliminarlo', { type: 'error' }); return; }
        if (!(await confirmBox({ title: 'Eliminare il modulo?', text: `"${f.title}" sparisce per sempre.`, ok: 'Elimina', danger: true }))) return;
        try { await A.api.deleteForm(f.id); A.forms.delete(f.id); toast('Modulo eliminato'); reload(); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }, 'danger')));
  swap(el, head, h('div.list', forms.filter(f => !f.archived).map(card)),
    forms.some(f => f.archived) ? h('h2.sub-h', 'Archiviati') : null, h('div.list', forms.filter(f => f.archived).map(card)));
}
