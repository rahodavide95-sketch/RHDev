/* Avvisi: ogni invio, modifica e firma degli artisti (e quando aprono il link). */

import { h, swap, icon, fmtDateTime, ago } from '../../ui/dom.js';
import { fieldById } from '../../core/schema.js';
import { A, go, formOf } from '../state.js';
import { btn, toast, friendly, empty } from '../ui.js';

const KIND = {
  submitted: { ic: 'send', tone: 'green', text: 'ha inviato i materiali' },
  updated: { ic: 'edit', tone: 'blue', text: 'ha modificato il suo invio' },
  signed: { ic: 'pen', tone: 'violet', text: 'ha firmato il contratto' },
  opened: { ic: 'eye', tone: 'muted', text: 'ha aperto il link' },
};

export async function render(el) {
  const [events, invites, releases] = await Promise.all([A.api.listEvents(300), A.api.listInvites(), A.api.listReleases()]);
  const inv = new Map(invites.map(i => [i.id, i]));
  const rel = new Map(releases.map(r => [r.id, r]));
  await Promise.all([...new Set(invites.map(i => i.form_id))].map(id => formOf(id).catch(() => null)));
  const unread = events.filter(e => !e.read_at && e.kind !== 'opened');
  const markAll = btn('Segna tutti come letti', async () => {
    try { await A.api.markRead(events.filter(e => !e.read_at).map(e => e.id)); A.refreshBadge(); render(el); } catch (x) { toast(friendly(x), { type: 'error' }); }
  }, { ic: 'check', kind: 'ghost' });
  const head = h('div.page-head', h('div', h('h1', 'Avvisi'), h('p.muted', unread.length ? `${unread.length} da leggere` : 'Tutto letto')), unread.length ? markAll : null);
  if (!events.length) { swap(el, head, empty('bell', 'Nessun avviso', 'Qui trovi ogni invio, modifica e firma degli artisti. Se attivi le email, ti arrivano anche per posta.')); return; }

  const groups = new Map();
  for (const e of events) {
    const d = new Date(e.created_at);
    const key = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const row = e => {
    const i = inv.get(e.invite_id);
    if (!i) return null;
    const r = rel.get(i.release_id);
    const f = A.forms.get(i.form_id);
    const k = KIND[e.kind] || KIND.opened;
    const changed = (e.changed || []).map(id => (f && fieldById(f.schema, id) || { label: id }).label);
    return h('a.ev' + (!e.read_at && e.kind !== 'opened' ? '.unread' : '') + (e.kind === 'opened' ? '.quiet' : ''), { href: e.kind === 'opened' || !i.version ? '#/release/' + i.release_id : '#/invio/' + i.id },
      h('span.ev-ic.' + k.tone, icon(k.ic, 18)),
      h('span.ev-t', h('b', i.artist_name), ' ', k.text, r ? h('span.muted', ` · ${r.title}`) : null,
        changed.length ? h('small', 'Cambiati: ' + changed.join(', ')) : null),
      h('span.ev-time', { title: fmtDateTime(e.created_at) }, ago(e.created_at)));
  };
  swap(el, head, ...[...groups].map(([day, list]) => h('section.ev-day', h('h2.sub-h', day), h('div.card.ev-list', list.map(row)))));
}
