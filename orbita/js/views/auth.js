/* ============================================================================
   auth.js — accesso, registrazione, password, verifica in due passaggi
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import { esc, icon, toast, openModal, confirmDialog } from '../util.js';

// Robustezza della password: lunghezza, varietà, niente sequenze ovvie
export function passwordScore(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (classes >= 3) s++;
  if (classes === 4 && pw.length >= 12) s++;
  if (/^(.)\1+$/.test(pw) || /(password|qwerty|123456|abcdef|orbita|iloveyou)/i.test(pw)) s = Math.min(s, 1);
  return Math.min(4, s);
}
const SCORE = [['Troppo debole', '#FF453A', '8%'], ['Debole', '#FF453A', '30%'], ['Discreta', '#FF9F0A', '55%'], ['Buona', '#30D158', '80%'], ['Ottima', '#30D158', '100%']];

const pendingInviteKey = 'orbita.invite';
export function rememberInvite(tripId) { try { sessionStorage.setItem(pendingInviteKey, tripId); } catch { /* niente */ } }
function takeInvite() { try { const v = sessionStorage.getItem(pendingInviteKey); sessionStorage.removeItem(pendingInviteKey); return v; } catch { return null; } }

export function openAuth(opts = {}) {
  if (!cloud.isConfigured()) { app.go('#/account'); toast('Il cloud non è ancora attivo: vedi la guida nel Profilo.'); return; }
  let mode = opts.mode || 'signin';
  const m = openModal({ title: '', body: '<div></div>' });
  const head = m.el.querySelector('.modal-head h2');

  function view() {
    head.textContent = { signin: 'Accedi', signup: 'Crea account', reset: 'Password dimenticata', mfa: 'Verifica in due passaggi', sent: 'Controlla la posta' }[mode];
    let html = '';
    if (mode === 'sent') {
      html = `<div class="auth-hero"><div class="orb">📬</div><h2 class="title2">Controlla la tua email</h2>
        <p class="secondary" style="margin-top:8px">${esc(m.sentText || '')}</p></div>
        <button class="btn btn-prominent btn-block" type="button" data-close-m>Ho capito</button>`;
    } else if (mode === 'mfa') {
      html = `<div class="auth-hero"><div class="orb">🔐</div><p class="secondary">Apri l'app di autenticazione e inserisci il codice a 6 cifre di Orbita.</p></div>
        <form class="stack" data-form="mfa" novalidate>
          <input class="input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-label="Codice a 6 cifre" autofocus>
          <div class="form-msg err" hidden></div>
          <button class="btn btn-prominent btn-block" type="submit">Verifica</button>
          <button class="btn btn-plain btn-block" type="button" data-act="mfa-out">Esci da questo account</button>
        </form>`;
    } else {
      html = `<div class="auth-hero"><div class="orb">🌍</div>
          <h2 class="title2">${mode === 'signup' ? 'Il tuo mondo, ovunque' : mode === 'reset' ? 'Nessun problema' : 'Bentornato'}</h2>
          <p class="secondary" style="margin-top:6px">${esc(opts.message || (mode === 'signup' ? 'Sincronizza i viaggi su tutti i dispositivi e condividili con chi vuoi.' : mode === 'reset' ? 'Ti mandiamo un link per sceglierne una nuova.' : 'Accedi per ritrovare i tuoi viaggi.'))}</p></div>`;
      if (mode !== 'reset') html += `<div class="seg" role="group" style="margin-bottom:16px"><button type="button" data-mode="signin" aria-pressed="${mode === 'signin'}">Accedi</button><button type="button" data-mode="signup" aria-pressed="${mode === 'signup'}">Registrati</button></div>`;
      html += `<form class="stack" data-form="${mode}" novalidate>
        ${mode === 'signup' ? '<label class="field"><span>Nome</span><input class="input" name="name" autocomplete="name" maxlength="80" placeholder="Come ti chiami?" required></label>' : ''}
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="nome@esempio.it" required value="${esc(opts.email || '')}"></label>
        ${mode !== 'reset' ? `<label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" required placeholder="${mode === 'signup' ? 'Almeno 10 caratteri' : ''}"></label>` : ''}
        ${mode === 'signup' ? '<div class="pw-meter"><i></i></div><div class="caption secondary" data-pw-label style="margin:4px 4px 0">Usa almeno 10 caratteri, meglio una frase.</div>' : ''}
        <div class="form-msg err" hidden></div>
        <button class="btn btn-prominent btn-block" type="submit">${mode === 'signup' ? 'Crea account' : mode === 'reset' ? 'Invia il link' : 'Accedi'}</button>
      </form>`;
      if (mode === 'signin') html += `<div class="row between" style="margin-top:14px"><button class="link-btn" type="button" data-mode="reset">Password dimenticata?</button><button class="link-btn" type="button" data-act="magic">Link via email</button></div>`;
      if (mode === 'reset') html += `<button class="btn btn-plain btn-block" type="button" data-mode="signin" style="margin-top:8px">Torna all'accesso</button>`;
      if (mode === 'signup') html += `<p class="caption tertiary" style="margin-top:14px;text-align:center">${icon('lock', 'ic-xs')} I tuoi dati sono protetti: cifrati in transito, visibili solo a te e a chi inviti.</p>`;
    }
    m.body.innerHTML = html;
    const f = m.body.querySelector('form input');
    if (f) setTimeout(() => f.focus(), 100);
  }

  const err = msg => { const e = m.body.querySelector('.form-msg'); if (e) { e.textContent = msg; e.hidden = !msg; } };
  const busy = (form, on) => { const b = form.querySelector('[type="submit"]'); if (b) { b.disabled = on; b.style.opacity = on ? '.6' : ''; } };

  m.body.addEventListener('input', e => {
    if (e.target.name === 'password' && mode === 'signup') {
      const [label, color, w] = SCORE[passwordScore(e.target.value)];
      const bar = m.body.querySelector('.pw-meter i');
      bar.style.width = e.target.value ? w : '0'; bar.style.background = color;
      m.body.querySelector('[data-pw-label]').textContent = e.target.value ? `Robustezza: ${label}` : 'Usa almeno 10 caratteri, meglio una frase.';
    }
    if (e.target.name === 'code') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  m.body.addEventListener('click', async e => {
    const md = e.target.closest('[data-mode]');
    if (md) { mode = md.dataset.mode; view(); return; }
    if (e.target.closest('[data-close-m]')) { m.close(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'magic') {
      const email = m.body.querySelector('[name="email"]').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err('Scrivi prima la tua email.'); return; }
      try { await cloud.magicLink(email); m.sentText = `Se ${email} ha un account, ti è arrivato un link per entrare senza password. Aprilo su questo dispositivo.`; mode = 'sent'; view(); }
      catch (x) { err(cloud.friendlyError(x)); }
    }
    if (a.dataset.act === 'mfa-out') { await cloud.signOut(); m.close(); }
  });

  m.body.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim().toLowerCase();
    const password = String(fd.get('password') || '');
    err('');
    if (form.dataset.form !== 'mfa' && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { err('Controlla l\'indirizzo email.'); return; }
    busy(form, true);
    try {
      if (form.dataset.form === 'signin') {
        const r = await cloud.signIn(email, password);
        if (r.mfa) { mode = 'mfa'; view(); return; }
        m.close();
      } else if (form.dataset.form === 'signup') {
        const name = String(fd.get('name') || '').trim();
        if (!name) { err('Dicci come ti chiami.'); return; }
        if (password.length < 10) { err('La password deve avere almeno 10 caratteri.'); return; }
        if (passwordScore(password) < 2) { err('Password troppo facile da indovinare: allungala o aggiungi numeri e simboli.'); return; }
        if (!store.get().profile.name) store.updateProfile({ name });
        const r = await cloud.signUp(email, password, name);
        if (r.needsConfirm) { m.sentText = `Ti abbiamo scritto a ${email}. Apri il link di conferma per attivare l'account (guarda anche nello spam).`; mode = 'sent'; view(); }
        else m.close();
      } else if (form.dataset.form === 'reset') {
        await cloud.resetPassword(email);
        m.sentText = `Se ${email} ha un account, riceverai un link per scegliere una nuova password.`;
        mode = 'sent'; view();
      } else if (form.dataset.form === 'mfa') {
        const code = String(fd.get('code') || '');
        if (!/^\d{6}$/.test(code)) { err('Il codice ha 6 cifre.'); return; }
        await cloud.mfaChallenge(code);
        m.close();
        toast('Verifica completata 🔐', { type: 'ok' });
        await afterLogin();
      }
    } catch (x) {
      err(cloud.friendlyError(x));
    } finally {
      if (form.isConnected) busy(form, false);
    }
  });
  view();
}

export function openNewPassword() {
  const m = openModal({
    title: 'Nuova password',
    body: `<form class="stack" novalidate>
      <p class="secondary">Scegli una nuova password per il tuo account.</p>
      <label class="field"><span>Nuova password</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
      <div class="form-msg err" hidden></div>
      <button class="btn btn-prominent btn-block" type="submit">Salva password</button></form>`,
  });
  m.body.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = e.target.password.value;
    const msg = m.body.querySelector('.form-msg');
    if (pw.length < 10 || passwordScore(pw) < 2) { msg.textContent = 'Serve una password più robusta (almeno 10 caratteri, con numeri o simboli).'; msg.hidden = false; return; }
    try { await cloud.updatePassword(pw); m.close(); toast('Password aggiornata', { type: 'ok' }); }
    catch (x) { msg.textContent = cloud.friendlyError(x); msg.hidden = false; }
  });
}

async function afterLogin() {
  await cloud.sync();
  app.refresh();
  const inv = takeInvite();
  if (inv) {
    if (store.findTrip(inv)) app.go(`#/viaggio/${encodeURIComponent(inv)}`);
    else toast('Questo invito non è per questo account: entra con l\'email a cui è arrivato.', { type: 'error', ms: 7000 });
  }
}

// Viaggi creati senza account su questo dispositivo: proponi di portarli nell'account
export async function offerGuestAdoption() {
  const g = store.guestData();
  const n = Object.keys(g.trips).length;
  if (!n && !g.marks.visited.length) return;
  const ok = await confirmDialog({ title: 'Portare i viaggi nel tuo account?', text: `Su questo dispositivo ci sono ${n} ${n === 1 ? 'viaggio salvato' : 'viaggi salvati'} senza account. Vuoi aggiungerli al tuo account, così li ritrovi ovunque?`, ok: 'Sì, aggiungili' });
  if (ok) store.adoptGuestData();
}

export async function checkMfaOnBoot() {
  try {
    if (await cloud.needsMfa()) { openAuth({ mode: 'mfa' }); return true; }
  } catch { /* niente */ }
  return false;
}

export async function onAuthEvent({ event, prev, user }) {
  if (event === 'PASSWORD_RECOVERY') { openNewPassword(); return; }
  if (event === 'SIGNED_IN' && user && (!prev || prev.id !== user.id)) {
    store.load(user.id);
    await offerGuestAdoption();
    toast(`Ciao${store.get().profile.name ? ' ' + store.get().profile.name.split(' ')[0] : ''}! Sei dentro ✨`, { type: 'ok' });
    if (await cloud.needsMfa()) { openAuth({ mode: 'mfa' }); return; }
    await afterLogin();
    return;
  }
  if (event === 'SIGNED_OUT') {
    if (prev) store.wipe(prev.id);   // niente dati dell'account lasciati sul dispositivo
    store.load('guest');
    app.refresh();
    if (app.route.name === 'account' || app.route.name === 'trips') app.go('#/');
    return;
  }
  app.refresh();
}
