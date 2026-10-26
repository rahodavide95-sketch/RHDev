/* ============================================================================
   share.js — condividi un viaggio via email (sola lettura o modifica)
   L'accesso è legato all'email: solo chi entra con QUELL'indirizzo (verificato)
   vede il viaggio. Il link da solo non basta.
   ============================================================================ */
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import { esc, icon, toast, openModal, confirmDialog, initials } from '../util.js';
import { openAuth } from './auth.js';

export function openShare(trip) {
  if (!cloud.isConfigured()) { toast('Per condividere serve il cloud: vedi Profilo → Attiva il cloud.'); return; }
  if (!cloud.getUser()) { openAuth({ mode: 'signin', message: 'Accedi per invitare i tuoi compagni di viaggio.' }); return; }
  let role = 'viewer';
  const m = openModal({
    title: 'Condividi',
    body: `<div class="row" style="gap:14px;margin-bottom:18px">
        <span class="trip-emoji" style="--tc:${esc(trip.color)}">${esc(trip.emoji)}</span>
        <div class="grow"><div class="headline ellipsis">${esc(trip.title)}</div><div class="footnote secondary">Invita chi era con te, o chi vuoi far sognare.</div></div>
      </div>
      <form class="stack" data-invite novalidate>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="amica@esempio.it" required></label>
        <div class="seg" role="group" aria-label="Permessi">
          <button type="button" data-role="viewer" aria-pressed="true">${icon('eye')} Può vedere</button>
          <button type="button" data-role="editor" aria-pressed="false">${icon('edit')} Può modificare</button>
        </div>
        <div class="form-msg err" hidden></div>
        <button class="btn btn-prominent btn-block" type="submit">${icon('mail')}Invia invito</button>
      </form>
      <div data-fallback></div>
      <div class="list-header">Persone con accesso</div>
      <div class="list" data-people><div class="list-row"><span class="secondary">Carico…</span></div></div>
      <p class="list-footer">${icon('shield', 'ic-xs')} Solo chi accede a Orbita con l'email invitata (e verificata) può aprire il viaggio. Puoi togliere l'accesso quando vuoi.</p>`,
  });
  const $ = s => m.body.querySelector(s);

  async function loadPeople() {
    try {
      const rows = await cloud.listShares(trip.id);
      $('[data-people]').innerHTML = rows.length ? rows.map(r => `<div class="list-row share-row">
          <span class="av">${esc(initials('', r.email) || '?')}</span>
          <span class="grow ellipsis">${esc(r.email)}</span>
          <select class="select" data-role-of="${esc(r.email)}" aria-label="Permessi di ${esc(r.email)}">
            <option value="viewer" ${r.role === 'viewer' ? 'selected' : ''}>Vede</option>
            <option value="editor" ${r.role === 'editor' ? 'selected' : ''}>Modifica</option>
          </select>
          <button class="icon-btn" type="button" data-remove="${esc(r.email)}" aria-label="Togli accesso a ${esc(r.email)}">${icon('x')}</button>
        </div>`).join('') : `<div class="list-row"><span class="secondary">Solo tu, per ora.</span></div>`;
    } catch (x) {
      $('[data-people]').innerHTML = `<div class="list-row"><span class="secondary">${esc(cloud.friendlyError(x))}</span></div>`;
    }
  }

  function fallback(email) {
    const link = cloud.inviteLink(trip.id);
    const me = store.get().profile.name || 'Un amico';
    const subject = `${me} ti ha invitato a vedere "${trip.title}" su Orbita`;
    const text = `Ciao! Ti ho invitato a vedere il mio viaggio "${trip.title}" su Orbita.\n\nApri questo link ed entra (o registrati) con questa email: ${email}\n${link}\n\nPer la tua privacy, il viaggio si apre solo con l'indirizzo invitato.`;
    $('[data-fallback]').innerHTML = `<div class="list" style="margin-top:16px;padding:14px 16px">
        <div class="headline">Invito salvato ✓</div>
        <p class="footnote secondary" style="margin:4px 0 12px">Il server email non è ancora attivo: manda tu il link a ${esc(email)}.</p>
        <div class="row row-wrap">
          <a class="btn btn-sm btn-prominent" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}">${icon('mail')}Apri email</a>
          <button class="btn btn-sm" type="button" data-copy>${icon('copy')}Copia link</button>
          ${navigator.share ? `<button class="btn btn-sm" type="button" data-native>${icon('share')}Condividi…</button>` : ''}
        </div></div>`;
    $('[data-fallback]').onclick = async e => {
      if (e.target.closest('[data-copy]')) { try { await navigator.clipboard.writeText(link); toast('Link copiato', { type: 'ok' }); } catch { toast(link, { ms: 8000 }); } }
      if (e.target.closest('[data-native]')) { try { await navigator.share({ title: subject, text, url: link }); } catch { /* annullato */ } }
    };
  }

  m.body.addEventListener('click', async e => {
    const r = e.target.closest('[data-role]');
    if (r) { role = r.dataset.role; m.body.querySelectorAll('[data-role]').forEach(b => b.setAttribute('aria-pressed', String(b === r))); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const email = rm.dataset.remove;
      if (!(await confirmDialog({ title: 'Togliere l\'accesso?', text: `${email} non potrà più vedere questo viaggio.`, ok: 'Togli accesso', danger: true }))) return;
      try { await cloud.removeShare(trip.id, email); toast('Accesso tolto'); loadPeople(); }
      catch (x) { toast(cloud.friendlyError(x), { type: 'error' }); }
    }
  });
  m.body.addEventListener('change', async e => {
    const s = e.target.closest('[data-role-of]');
    if (!s) return;
    try { await cloud.setShareRole(trip.id, s.dataset.roleOf, s.value); toast('Permessi aggiornati', { type: 'ok', ms: 1600 }); }
    catch (x) { toast(cloud.friendlyError(x), { type: 'error' }); }
  });
  $('[data-invite]').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const msg = $('.form-msg');
    const email = e.target.email.value.trim().toLowerCase();
    msg.hidden = true;
    btn.disabled = true;
    try {
      const r = await cloud.invite(trip.id, email, role);
      if (!r.ok) { msg.textContent = r.error; msg.hidden = false; return; }
      e.target.email.value = '';
      if (r.emailed) { toast(`Invito inviato a ${email} ✉️`, { type: 'ok' }); $('[data-fallback]').innerHTML = ''; }
      else fallback(email);
      loadPeople();
    } finally { btn.disabled = false; }
  });
  loadPeople();
}
