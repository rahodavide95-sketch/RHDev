/* Una release: gli artisti invitati, il loro stato, la checklist di cosa manca e i link. */

import { h, swap, icon, fmtDay, fmtDateTime, ago } from '../../ui/dom.js';
import { A, go, formOf, newToken, tokenOf, linkFor, inviteState, checklist, isComplete } from '../state.js';
import { modal, btn, iconBtn, field, input, selectEl, toast, friendly, empty, chip, confirmBox, copyText } from '../ui.js';
import { releaseModal } from './releases.js';

const EXPIRY = [['90', '90 giorni'], ['30', '30 giorni'], ['60', '60 giorni'], ['180', '6 mesi'], ['0', 'Nessuna scadenza']];
const plusDays = d => Number(d) ? new Date(Date.now() + Number(d) * 864e5).toISOString() : null;

export async function shareModal(invite, release, token) {
  const link = linkFor(token);
  const m = modal({ title: `Link per ${invite.artist_name}` });
  const msg = h('textarea.inp', { rows: 5 }, `Ciao ${invite.artist_name}! Ecco il link per mandarci tutto il materiale per "${release.title}" (dati, bio, press kit, tracce, artwork e contratto):\n\n${link}\n\nIl link è personale: per favore non inoltrarlo.`);
  const linkIn = input({ type: 'text', readOnly: true, value: link, onfocus: e => e.target.select() });
  m.body.append(h('div.stack',
    h('p.muted', 'Il link è segreto e personale: chi lo ha può compilare il modulo, ma non può leggere quello che l\'artista ha già mandato (per quello serve anche la sua password).'),
    h('div.copyrow', linkIn, btn('Copia', () => copyText(link, 'Link copiato'), { ic: 'copy' })),
    field('Messaggio', msg),
    h('div.share-btns',
      navigator.share ? btn('Condividi…', () => navigator.share({ text: msg.value }).catch(() => {}), { ic: 'share', kind: 'ghost' }) : null,
      btn('Email', () => { location.href = `mailto:${encodeURIComponent(invite.artist_email || '')}?subject=${encodeURIComponent(`Materiali per ${release.title}`)}&body=${encodeURIComponent(msg.value)}`; }, { ic: 'mail', kind: 'ghost' }),
      btn('WhatsApp', () => window.open('https://wa.me/?text=' + encodeURIComponent(msg.value), '_blank', 'noopener,noreferrer'), { ic: 'send', kind: 'ghost' }),
      btn('Copia messaggio', () => copyText(msg.value, 'Messaggio copiato'), { ic: 'copy', kind: 'ghost' })),
    A.demo ? h('p.note', 'Modalità prova: il link funziona solo in questo browser.') : null));
  m.foot.append(btn('Apri il link', () => window.open(link, '_blank', 'noopener'), { ic: 'external', kind: 'ghost' }), btn('Fatto', () => m.close()));
}

function inviteModal(release, forms, existing, onSaved) {
  const m = modal({ title: existing ? 'Modifica artista' : 'Aggiungi artista' });
  const name = input({ type: 'text', maxlength: 120, placeholder: 'Nome d\'arte', value: existing ? existing.artist_name : '' });
  const email = input({ type: 'email', maxlength: 254, placeholder: 'Facoltativa (solo per mandargli il link)', value: existing ? existing.artist_email : '' });
  const pct = input({ type: 'number', min: 0, max: 100, step: 1, value: existing ? existing.artist_pct : 50, disabled: existing && !!existing.contract_signed_at });
  let formId = existing ? existing.form_id : (forms.find(f => !f.archived) || forms[0] || {}).id;
  let exp = existing ? null : '90';
  const err = h('div.err');
  const save = btn(existing ? 'Salva' : 'Crea il link', async () => {
    if (!name.value.trim()) { err.textContent = 'Scrivi il nome dell\'artista.'; return; }
    if (email.value && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.value.trim())) { err.textContent = 'Email non valida.'; return; }
    const p = Math.round(Number(pct.value));
    if (!(p >= 0 && p <= 100)) { err.textContent = 'La percentuale va da 0 a 100.'; return; }
    if (!formId) { err.textContent = 'Crea prima un modulo.'; return; }
    save.disabled = true;
    try {
      const row = { artist_name: name.value.trim(), artist_email: email.value.trim().toLowerCase(), ...(existing && existing.contract_signed_at ? {} : { artist_pct: p }) };
      if (existing) {
        if (exp !== null) row.expires_at = plusDays(exp);
        const r = await A.api.updateInvite(existing.id, row);
        m.close(); onSaved(r, null);
      } else {
        const t = await newToken();
        const r = await A.api.createInvite({ ...row, release_id: release.id, form_id: formId, token_hash: t.token_hash, token_enc: t.token_enc, expires_at: plusDays(exp) });
        m.close(); onSaved(r, t.token);
      }
    } catch (x) { err.textContent = friendly(x); save.disabled = false; }
  }, { ic: existing ? 'check' : 'link' });
  m.body.append(h('div.stack',
    field('Artista', name), field('Email', email),
    existing ? null : field('Modulo', selectEl(forms.map(f => [f.id, f.title + (f.archived ? ' (archiviato)' : '')]), formId, v => { formId = v; })),
    h('div.row2',
      field('% all\'artista (contratto)', pct, existing && existing.contract_signed_at ? 'Contratto firmato: non si cambia più' : 'Il resto va all\'etichetta'),
      field('Scadenza del link', selectEl(existing ? [['', 'Non cambiare'], ...EXPIRY] : EXPIRY, existing ? '' : exp, v => { exp = v === '' ? null : v; }),
        existing && existing.expires_at ? `Ora scade il ${fmtDay(existing.expires_at)}` : '')),
    err));
  m.foot.append(btn('Annulla', () => m.close(), { kind: 'ghost' }), save);
}

export async function render(el, id) {
  const releases = await A.api.listReleases();
  const release = releases.find(r => r.id === id);
  if (!release) { swap(el, empty('disc', 'Release non trovata', 'Forse è stata eliminata.', btn('Torna alle release', () => go('#/release')))); return; }
  const [invites, forms] = await Promise.all([A.api.listInvites(id), A.api.listForms()]);
  await Promise.all([...new Set(invites.map(i => i.form_id))].map(fid => formOf(fid).catch(() => null)));
  const reload = () => render(el, id);

  const addArtist = () => {
    if (!forms.length) { toast('Crea prima un modulo', { type: 'error' }); go('#/moduli'); return; }
    inviteModal(release, forms, null, (inv, token) => { toast('Link creato', { type: 'ok' }); reload().then(() => shareModal(inv, release, token)); });
  };
  const head = h('div.page-head',
    h('div', h('a.back', { href: '#/release' }, icon('back', 16), 'Release'),
      h('h1', release.title, release.closed_at ? chip('Chiusa', 'muted', 'lock') : null),
      h('p.muted', [release.catalog, release.release_date ? 'esce il ' + fmtDay(release.release_date) : ''].filter(Boolean).join(' · '))),
    h('div.head-actions',
      release.closed_at ? null : btn('Aggiungi artista', addArtist, { ic: 'plus' }),
      iconBtn('edit', 'Modifica release', () => releaseModal(release, () => { toast('Salvato', { type: 'ok' }); reload(); })),
      iconBtn(release.closed_at ? 'unlock' : 'lock', release.closed_at ? 'Riapri la release' : 'Chiudi la release', async () => {
        const closing = !release.closed_at;
        if (!(await confirmBox({ title: closing ? 'Chiudere la release?' : 'Riaprire la release?', text: closing ? 'Gli artisti potranno ancora rivedere il loro invio, ma non modificarlo né inviare.' : 'Gli artisti potranno di nuovo inviare e modificare.', ok: closing ? 'Chiudi' : 'Riapri' }))) return;
        try { await A.api.updateRelease(release.id, { closed_at: closing ? new Date().toISOString() : null }); toast(closing ? 'Release chiusa' : 'Release riaperta', { type: 'ok' }); reload(); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }),
      iconBtn('trash', 'Elimina release', async () => {
        if (!(await confirmBox({ title: 'Eliminare la release?', text: `Spariscono per sempre gli artisti, i loro invii, i contratti firmati e lo storico di "${release.title}". Se ti servono, scarica prima i PDF.`, ok: 'Elimina tutto', danger: true }))) return;
        try { await A.api.deleteRelease(release.id); toast('Release eliminata'); go('#/release'); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }, 'danger')));

  if (!invites.length) {
    swap(el, head, empty('users', 'Nessun artista', 'Aggiungi un artista: ricevi un link da mandargli (WhatsApp, email…).', release.closed_at ? null : btn('Aggiungi artista', addArtist, { ic: 'plus' })));
    return;
  }

  const complete = invites.filter(i => { const f = A.forms.get(i.form_id); return f && isComplete(i, f.schema); }).length;
  const card = inv => {
    const f = A.forms.get(inv.form_id);
    const st = inviteState(inv);
    const items = f ? checklist(inv, f.schema) : [];
    const missing = items.filter(x => !x.ok);
    const menu = h('div.menu-wrap');
    const doShare = async () => { try { shareModal(inv, release, await tokenOf(inv)); } catch (x) { toast(friendly(x), { type: 'error' }); } };
    const actions = [
      ['link', 'Link', doShare],
      ['edit', 'Modifica', () => inviteModal(release, forms, inv, () => { toast('Salvato', { type: 'ok' }); reload(); })],
      ['refresh', 'Nuovo link (il vecchio smette di funzionare)', async () => {
        if (!(await confirmBox({ title: 'Nuovo link?', text: 'Il link attuale smette subito di funzionare. Se l\'artista ha già inviato con una password, la password resta la stessa.', ok: 'Crea nuovo link' }))) return;
        try { const t = await newToken(); const r = await A.api.updateInvite(inv.id, { token_hash: t.token_hash, token_enc: t.token_enc, revoked_at: null }); await reload(); shareModal(r, release, t.token); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }],
      [inv.revoked_at ? 'unlock' : 'x', inv.revoked_at ? 'Riattiva il link' : 'Revoca il link', async () => {
        try { await A.api.updateInvite(inv.id, { revoked_at: inv.revoked_at ? null : new Date().toISOString() }); toast(inv.revoked_at ? 'Link riattivato' : 'Link revocato', { type: 'ok' }); reload(); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }],
      ['trash', 'Elimina artista', async () => {
        if (!(await confirmBox({ title: `Eliminare ${inv.artist_name}?`, text: 'Spariscono il suo invio, il contratto firmato e lo storico. Il link smette di funzionare.', ok: 'Elimina', danger: true }))) return;
        try { await A.api.deleteInvite(inv.id); toast('Eliminato'); reload(); } catch (x) { toast(friendly(x), { type: 'error' }); }
      }],
    ];
    const pop = h('div.menu', { hidden: true }, actions.map(([ic, label, fn]) => h('button.menu-i', { type: 'button', onclick: () => { pop.hidden = true; fn(); } }, icon(ic, 17), label)));
    menu.append(iconBtn('more', 'Altre azioni', e => { e.stopPropagation(); document.querySelectorAll('.menu').forEach(x => { if (x !== pop) x.hidden = true; }); pop.hidden = !pop.hidden; }), pop);
    return h('div.card.inv-card',
      h('div.inv-top',
        h('div.avatar', inv.artist_name.slice(0, 1).toUpperCase()),
        h('div.inv-t', h('h3', inv.artist_name), h('p.muted', [inv.artist_email, `${inv.artist_pct}% artista`, f ? f.title : ''].filter(Boolean).join(' · '))),
        chip(st.text, st.tone, st.ic), menu),
      items.length ? h('div.checks', items.map(x => h('span.ck' + (x.ok ? '.ok' : ''), icon(x.ok ? 'check' : x.contract ? 'pen' : 'minus', 14), x.ok ? x.label : `manca ${x.label.toLowerCase()}`))) : null,
      h('div.inv-foot',
        h('span.muted.small', inv.updated_at && inv.version > 1 ? `Modificato ${ago(inv.updated_at)}` : inv.submitted_at ? `Inviato ${ago(inv.submitted_at)}` : inv.opened_at ? `Aperto ${ago(inv.opened_at)}` : `Creato ${ago(inv.created_at)}`,
          inv.expires_at && !inv.version ? ` · scade il ${fmtDay(inv.expires_at)}` : ''),
        h('span.spacer'),
        inv.version ? btn('Vedi invio', () => go('#/invio/' + inv.id), { ic: 'eye', kind: missing.length ? 'ghost small' : 'small' }) : btn('Link', doShare, { ic: 'link', kind: 'ghost small' })));
  };
  swap(el, head,
    h('div.summary-bar', h('span', h('b', `${complete}/${invites.length}`), ' completi'), h('div.bar', h('i', { style: { width: Math.round(complete / invites.length * 100) + '%' } })),
      h('span.muted.small', `${invites.filter(i => i.version).length} inviati · ${invites.filter(i => i.contract_signed_at).length} contratti firmati`)),
    h('div.list', invites.map(card)),
    release.notes ? h('div.card.notes', h('h3', 'Note'), h('p', release.notes)) : null);
  return () => {};
}
