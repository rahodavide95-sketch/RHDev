/* Area dell'etichetta: accesso (password + verifica in due passaggi), proprietario, chiave di
   cifratura, poi l'app con release, moduli, avvisi e impostazioni. */

import { h, icon, clear, append, guardFrame, download } from '../ui/dom.js';
import * as C from '../core/crypto.js';
import { defaultForm } from '../core/schema.js';
import { A, go } from './state.js';
import * as K from './keys.js';
import { toast, btn, field, input, friendly, spinner, toggle, copyText } from './ui.js';

guardFrame();
const root = document.getElementById('app');
const qs = new URLSearchParams(location.search);
if (qs.get('demo') === '1') { try { localStorage.setItem('labelform-mode', 'demo'); } catch { /* */ } history.replaceState(null, '', location.pathname + location.hash); }
A.demo = (() => { try { return localStorage.getItem('labelform-mode') === 'demo'; } catch { return false; } })();

const VIEWS = {
  release: () => import('./views/releases.js'),
  releaseOne: () => import('./views/release.js'),
  invio: () => import('./views/submission.js'),
  moduli: () => import('./views/forms.js'),
  modulo: () => import('./views/builder.js'),
  avvisi: () => import('./views/events.js'),
  impostazioni: () => import('./views/settings.js'),
};

/* ─── schermate d'accesso ─── */
function gateScreen(title, sub, ...kids) {
  clear(root);
  document.body.className = 'gate-body';
  root.append(h('div.gate',
    h('div.gate-card',
      h('div.gate-brand', h('img', { src: 'icons/mark-192.png', alt: '' }), h('span', 'Label Form')),
      h('h1', title), sub ? h('p.muted', sub) : null, ...kids),
    A.demo ? h('p.gate-foot', 'Modalità prova · ', h('button.linkbtn', { type: 'button', onclick: leaveDemo }, 'esci dalla prova')) :
      h('p.gate-foot', icon('lock', 14), ' Dati degli artisti cifrati: li apri solo tu, con la tua chiave.')));
}
function errBox() { return h('div.err', { role: 'alert' }); }
function leaveDemo() { try { localStorage.removeItem('labelform-mode'); } catch { /* */ } location.href = location.pathname; }
function busy(b, on, label) { b.disabled = on; if (label) { append(clear(b), [on ? spinner() : null, h('span', label)]); } }

const MAIL_TIPS = [
  'Può arrivare dopo qualche minuto: guarda anche in Spam e, su Gmail, in Promozioni o Aggiornamenti.',
  'Il mittente è "Supabase Auth" (noreply@mail.app.supabase.io), non l\'etichetta.',
  'Il servizio email gratuito di Supabase manda al massimo un paio di email all\'ora, e solo all\'email con cui sei iscritto a Supabase (quella del tuo account sul sito supabase.com). Con un altro indirizzo l\'email non parte.',
];
function mailErrText(x) {
  if (x.code === 'rate') return 'Supabase ha già mandato troppe email da poco: aspetta un\'ora e riprova (è un limite del servizio gratuito).';
  if (x.code === 'closed') return 'Le iscrizioni sono chiuse: l\'area dell\'etichetta ha già il suo proprietario. Entra con quell\'account.';
  return friendly(x);
}
/** Schermata "controlla la posta" con consigli e pulsante per rimandare l'email (dopo 60 secondi). */
function showMailSent(kind, email, resend) {
  const err = errBox();
  const again = btn('Rimanda l\'email', null, { kind: 'ghost block', ic: 'refresh' });
  let left = 60, timer = null;
  const tick = () => {
    if (left <= 0) { clearInterval(timer); again.disabled = false; again.lastChild.textContent = 'Rimanda l\'email'; return; }
    again.disabled = true; again.lastChild.textContent = `Rimanda l'email (tra ${left--} s)`;
  };
  tick(); timer = setInterval(tick, 1000);
  again.onclick = async () => {
    err.textContent = '';
    again.disabled = true;
    try { await resend(); toast('Email rimandata', { type: 'ok' }); left = 60; tick(); clearInterval(timer); timer = setInterval(tick, 1000); }
    catch (x) { err.textContent = mailErrText(x); again.disabled = false; }
  };
  gateScreen('Controlla la posta', kind === 'signup'
    ? `Ho chiesto a Supabase di mandare a ${email} il link per confermare l'indirizzo. Aprilo da questo dispositivo, poi accedi.`
    : `Se ${email} ha un account, arriva un link per scegliere una nuova password. Aprilo da questo dispositivo.`,
    h('ul.tips', MAIL_TIPS.map(t => h('li', t))), err, again,
    btn('Torna all\'accesso', () => { clearInterval(timer); showAuth(); }, { kind: 'ghost block' }));
}

function showAuth(mode = 'signin', prefill = '') {
  const email = input({ type: 'email', autocomplete: 'username', placeholder: 'nome@esempio.com', required: true, value: prefill });
  const pw = input({ type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: mode === 'signup' ? 'Almeno 10 caratteri' : 'Password' });
  const err = errBox();
  const main = btn(mode === 'signin' ? 'Accedi' : mode === 'signup' ? 'Crea account' : 'Mandami il link', null, { type: 'submit', kind: 'block' });
  const here = location.href.replace(/[?#].*$/, '');
  const form = h('form.stack', { onsubmit: async e => {
    e.preventDefault(); clear(err);
    const mail = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) { err.textContent = 'Controlla l\'email.'; return; }
    busy(main, true);
    try {
      if (mode === 'signin') { await A.api.auth.signIn(mail, pw.value); await gate(); return; }
      if (mode === 'signup') {
        const p = C.passwordProblem(pw.value);
        if (p) { err.textContent = p; busy(main, false); return; }
        const data = await A.api.auth.signUp(mail, pw.value, here);
        if (data && data.session) { toast('Account creato', { type: 'ok' }); await gate(); return; }
        // Supabase non rivela se l'email esiste già: in quel caso restituisce un utente senza "identità" e non manda nulla
        if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          gateScreen('Hai già un account', `Con ${mail} c'è già un account di Label Form: non serve crearne un altro e non arriva nessuna email. Accedi con la sua password. Se non la ricordi, usa "Password dimenticata".`,
            btn('Accedi', () => showAuth('signin', mail), { kind: 'block' }), btn('Password dimenticata', () => showAuth('reset', mail), { kind: 'ghost block' }));
          return;
        }
        showMailSent('signup', mail, () => A.api.auth.resendSignup(mail, here));
        return;
      }
      await A.api.auth.reset(mail, here);
      showMailSent('reset', mail, () => A.api.auth.reset(mail, here));
    } catch (x) {
      if (x.code === 'confirm') {
        append(err, ['L\'email non è ancora confermata: apri il link che ti ha mandato Supabase. ',
          h('button.linkbtn', { type: 'button', onclick: async () => {
            try { await A.api.auth.resendSignup(mail, here); showMailSent('signup', mail, () => A.api.auth.resendSignup(mail, here)); }
            catch (y) { err.textContent = mailErrText(y); }
          } }, 'Rimandami l\'email')]);
      } else err.textContent = x.code === 'invalid' ? 'Email o password sbagliate.' : mailErrText(x);
      busy(main, false);
    }
  } }, field('Email', email), mode !== 'reset' ? field('Password', pw) : null, err, main);
  const links = h('div.gate-links',
    mode !== 'signin' ? h('button.linkbtn', { type: 'button', onclick: () => showAuth('signin', email.value.trim()) }, 'Ho già un account') : h('button.linkbtn', { type: 'button', onclick: () => showAuth('signup', email.value.trim()) }, 'Prima volta? Crea un account'),
    mode !== 'reset' ? h('button.linkbtn', { type: 'button', onclick: () => showAuth('reset', email.value.trim()) }, 'Password dimenticata') : null);
  gateScreen(mode === 'signin' ? 'Area dell\'etichetta' : mode === 'signup' ? 'Crea l\'account' : 'Password dimenticata',
    mode === 'signin' ? 'Entra con la tua mail e la tua password. La prima volta tocca "Crea un account".'
      : mode === 'signup' ? 'Scegli la mail e la password che vuoi (almeno 10 caratteri). Non serve nessuna email di conferma.'
      : 'Ti arriva un link per sceglierne una nuova (solo se l\'indirizzo è quello del tuo account Supabase; altrimenti scrivi a chi gestisce il sito).',
    form, links,
    h('div.gate-demo', h('p.muted', 'Vuoi solo provare? La prova tiene tutto in questo browser, senza account.'), btn('Prova senza account', () => { localStorage.setItem('labelform-mode', 'demo'); location.reload(); }, { kind: 'ghost block', ic: 'sparkle' })));
}

function showNewPassword() {
  const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Almeno 10 caratteri' });
  const err = errBox();
  const b = btn('Salva la nuova password', null, { type: 'submit', kind: 'block' });
  gateScreen('Nuova password', 'Scegli la nuova password dell\'account.', h('form.stack', { onsubmit: async e => {
    e.preventDefault();
    const p = C.passwordProblem(pw.value);
    if (p) { err.textContent = p; return; }
    busy(b, true);
    try { await A.api.auth.setPassword(pw.value); toast('Password cambiata', { type: 'ok' }); history.replaceState(null, '', location.pathname); gate(); }
    catch (x) { err.textContent = friendly(x); busy(b, false); }
  } }, field('Password', pw), err, b));
}

async function showEnroll() {
  let en;
  try { en = await A.api.auth.enroll(); } catch (x) { gateScreen('Errore', friendly(x), btn('Riprova', () => gate(), { kind: 'block' })); return; }
  const code = input({ type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456', maxlength: 6 });
  const err = errBox();
  const b = btn('Attiva', null, { type: 'submit', kind: 'block' });
  gateScreen('Verifica in due passaggi', 'Per proteggere i dati degli artisti serve un secondo passaggio: un codice che cambia ogni 30 secondi.',
    h('ol.steps',
      h('li', 'Installa un\'app di autenticazione (es. Google Authenticator, Microsoft Authenticator, 1Password, Authy o "Password" di iPhone).'),
      h('li', 'Inquadra questo codice QR (o copia il codice segreto).'),
      h('li', 'Scrivi qui il numero di 6 cifre che vedi nell\'app.')),
    h('div.qr', h('img', { src: en.qr, alt: 'Codice QR per l\'app di autenticazione', width: 180, height: 180 })),
    h('div.secret', h('code', en.secret), btn('', () => copyText(en.secret, 'Codice segreto copiato'), { ic: 'copy', kind: 'ghost small', title: 'Copia' })),
    h('form.stack', { onsubmit: async e => {
      e.preventDefault(); busy(b, true);
      try { await A.api.auth.verify(en.id, code.value); toast('Verifica in due passaggi attiva 🔐', { type: 'ok' }); gate(); }
      catch (x) { err.textContent = 'Codice non valido: controlla l\'ora del telefono e riprova.'; busy(b, false); }
    } }, field('Codice', code), err, b),
    btn('Esci', async () => { await A.api.auth.signOut(); gate(); }, { kind: 'ghost block' }));
}

function showChallenge() {
  const code = input({ type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456', maxlength: 6 });
  const err = errBox();
  const b = btn('Conferma', null, { type: 'submit', kind: 'block' });
  gateScreen('Codice di verifica', 'Scrivi il codice di 6 cifre dell\'app di autenticazione.',
    h('form.stack', { onsubmit: async e => {
      e.preventDefault(); busy(b, true);
      try { const f = (await A.api.auth.mfa()).factors[0]; await A.api.auth.verify(f.id, code.value); gate(); }
      catch (x) { err.textContent = 'Codice non valido.'; busy(b, false); code.select(); }
    } }, field('Codice', code), err, b),
    btn('Esci', async () => { await A.api.auth.signOut(); gate(); }, { kind: 'ghost block' }));
}

function showClaim() {
  const code = input({ type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', maxlength: 40 });
  const err = errBox();
  const b = btn('Attiva', null, { type: 'submit', kind: 'block' });
  gateScreen('Codice di attivazione', 'Serve solo la prima volta: scrivi il codice che ti è stato dato. Da quel momento questo account è l\'unico che può aprire l\'area dell\'etichetta e nessun altro potrà più iscriversi.',
    h('form.stack', { onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (!code.value.trim()) { err.textContent = 'Scrivi il codice.'; return; }
      busy(b, true);
      try {
        const r = await A.api.claim(code.value.trim());
        if (r === 'ok' || r === 'already') { toast('Area dell\'etichetta pronta', { type: 'ok' }); gate(); return; }
        err.textContent = { bad_code: 'Codice sbagliato: controlla di averlo copiato tutto.', taken: 'Questo spazio è già di un altro account.', not_allowed: 'Questo account non è autorizzato.', need_mfa: 'Serve la verifica in due passaggi.', need_email: 'L\'email dell\'account non risulta confermata.' }[r] || 'Non riuscito.';
      } catch (x) { err.textContent = friendly(x); }
      busy(b, false);
    } }, field('Codice', code), err, b),
    btn('Esci', async () => { await A.api.auth.signOut(); gate(); }, { kind: 'ghost block' }));
}
function showNotOwner(st) {
  gateScreen('Accesso non consentito', st.claimed ? 'Questo spazio appartiene a un altro account. Entra con l\'account dell\'etichetta.' : !st.email_ok ? 'Conferma prima l\'email dell\'account (guarda nella posta).' : 'Questo account non è autorizzato ad aprire l\'area dell\'etichetta.',
    btn('Esci', async () => { await A.api.auth.signOut(); gate(); }, { kind: 'block' }));
}

/* ─── chiave di cifratura ─── */
function strengthMeter(inp) {
  const m = h('div.meter', h('div.meter-bar', h('i')), h('span'));
  const upd = () => { const s = C.passwordStrength(inp.value); m.dataset.s = s.score; m.querySelector('i').style.width = s.score * 25 + '%'; m.querySelector('span').textContent = s.label; };
  inp.addEventListener('input', upd); upd();
  return m;
}
function showKeySetup() {
  const name = input({ type: 'text', maxlength: 120, placeholder: 'Nome dell\'etichetta', value: (A.settings && A.settings.label_name) || 'SUBCONSCIOUS Culture' });
  const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Almeno 10 caratteri (meglio una frase)' });
  const pw2 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Ripetila' });
  const err = errBox();
  const b = btn('Crea la chiave', null, { type: 'submit', kind: 'block' });
  gateScreen('La tua chiave di cifratura', 'Gli artisti chiudono i loro dati con la chiave dell\'etichetta: si aprono solo con questa password, che resta nel tuo browser e non arriva mai al server. È diversa dalla password dell\'account.',
    h('form.stack', { onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const p = C.passwordProblem(pw.value);
      if (p) { err.textContent = p; return; }
      if (pw.value !== pw2.value) { err.textContent = 'Le due password non sono uguali.'; return; }
      busy(b, true, 'Creo la chiave…');
      try {
        const { record, privateKey, recoveryCode } = await C.createLabelKey(pw.value);
        A.settings = await A.api.saveSettings({ label_name: name.value.trim().slice(0, 120), label_key: record });
        await K.setUnlocked(privateKey, record, false);
        if (!(await A.api.listForms()).length) await A.api.createForm('Consegna release', defaultForm());
        showRecovery(recoveryCode, () => startShell());
      } catch (x) { err.textContent = friendly(x); busy(b, false, 'Crea la chiave'); }
    } }, field('Etichetta', name), field('Password di cifratura', pw), strengthMeter(pw), field('Ripeti la password', pw2), err, b));
}
export function showRecovery(code, next, { inShell = false } = {}) {
  const ok = h('input', { type: 'checkbox' });
  const go2 = btn('Continua', () => { if (!ok.checked) { toast('Spunta la casella: senza il codice, perdendo la password perderesti tutti i dati'); return; } next(); }, { kind: 'block' });
  const kids = [
    h('div.recovery', h('code', code)),
    h('div.row', btn('Copia', () => copyText(code, 'Codice copiato'), { ic: 'copy', kind: 'ghost' }),
      btn('Scarica', () => download(new Blob([`Label Form — codice di recupero della chiave dell'etichetta\n\n${code}\n\nServe se dimentichi la password di cifratura. Tienilo al sicuro (stampato o in un gestore di password).\nCreato il ${new Date().toLocaleString('it-IT')}\n`], { type: 'text/plain' }), 'Label-Form-codice-di-recupero.txt'), { ic: 'download', kind: 'ghost' })),
    h('label.check', ok, h('span', 'Ho salvato il codice in un posto sicuro (stampato o in un gestore di password)')),
    go2,
  ];
  if (inShell) return kids;
  gateScreen('Codice di recupero', 'Se dimentichi la password di cifratura, questo codice è l\'unico modo per aprire di nuovo i dati. Mostrato solo adesso.', ...kids);
}
function showUnlock(useCode = false) {
  const secret = input({ type: useCode ? 'text' : 'password', autocomplete: useCode ? 'off' : 'current-password', placeholder: useCode ? 'XXXX-XXXX-…' : 'Password di cifratura' });
  const newPw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Nuova password di cifratura' });
  const remember = h('input', { type: 'checkbox' });
  const err = errBox();
  const b = btn('Sblocca', null, { type: 'submit', kind: 'block' });
  gateScreen('Sblocca i dati', useCode ? 'Scrivi il codice di recupero e scegli una nuova password di cifratura.' : 'Scrivi la password di cifratura dell\'etichetta.',
    h('form.stack', { onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      busy(b, true, 'Sblocco…');
      try {
        const rec = A.settings.label_key;
        let key;
        if (useCode) {
          const p = C.passwordProblem(newPw.value);
          if (p) { err.textContent = 'Nuova password: ' + p; busy(b, false, 'Sblocca'); return; }
          key = await C.unlockLabelKeyWithRecovery(rec, secret.value);
          const next = await C.changeLabelPassphrase(rec, secret.value, newPw.value, { useRecovery: true });
          A.settings = await A.api.saveSettings({ label_key: next });
          toast('Nuova password di cifratura salvata', { type: 'ok' });
        } else key = await C.unlockLabelKey(rec, secret.value);
        await K.setUnlocked(key, A.settings.label_key, remember.checked);
        startShell();
      } catch (x) {
        err.textContent = x instanceof C.WrongSecret ? (useCode ? 'Codice di recupero sbagliato.' : 'Password sbagliata.') : friendly(x);
        busy(b, false, 'Sblocca');
      }
    } }, field(useCode ? 'Codice di recupero' : 'Password di cifratura', secret), useCode ? field('Nuova password di cifratura', newPw) : null,
      h('label.check', remember, h('span', 'Ricorda su questo dispositivo (solo se è tuo e protetto)')), err, b),
    h('div.gate-links', h('button.linkbtn', { type: 'button', onclick: () => showUnlock(!useCode) }, useCode ? 'Uso la password' : 'Ho dimenticato la password: uso il codice di recupero'),
      A.demo ? null : h('button.linkbtn', { type: 'button', onclick: async () => { await A.api.auth.signOut(); gate(); } }, 'Esci')));
}

/* ─── percorso d'ingresso ─── */
let gating = false;
export async function gate() {
  if (!A.demo && A.notReady) {
    gateScreen('Quasi pronto', 'Sto preparando lo spazio di Label Form. Ti avviso io quando puoi entrare.',
      btn('Intanto prova senza account', () => { localStorage.setItem('labelform-mode', 'demo'); location.reload(); }, { kind: 'ghost block', ic: 'sparkle' }));
    return;
  }
  if (gating) return;
  gating = true;
  try {
    if (!A.demo) {
      const s = await A.api.auth.session();
      if (!s) { showAuth(); return; }
      if (/type=recovery/.test(location.hash)) { showNewPassword(); return; }
      const mfa = await A.api.auth.mfa();
      if (!mfa.factors.length) { await showEnroll(); return; }
      if (mfa.level !== 'aal2') { showChallenge(); return; }
      const st = await A.api.status();
      if (!st.owner) { if (st.can_claim) showClaim(); else showNotOwner(st); return; }
      A.user = await A.api.auth.user();
    }
    A.settings = await A.api.getSettings();
    if (!A.settings || !A.settings.label_key) { showKeySetup(); return; }
    if (!K.isUnlocked() && !(await K.restore(A.settings.label_key))) { showUnlock(); return; }
    startShell();
  } catch (x) {
    gateScreen('Connessione non riuscita', friendly(x), btn('Riprova', () => gate(), { kind: 'block', ic: 'refresh' }));
  } finally { gating = false; }
}

/* ─── app ─── */
const NAV = [
  ['release', 'Release', 'disc'],
  ['moduli', 'Moduli', 'layers'],
  ['avvisi', 'Avvisi', 'bell'],
  ['impostazioni', 'Impostazioni', 'settings'],
];
let viewEl = null, cleanup = null, shellOn = false, badgeTimer = null;

function startShell() {
  shellOn = true;
  clear(root);
  document.body.className = 'app-body';
  const navItem = ([key, label, ic]) => h('a.nav-i', { href: '#/' + key, dataset: { nav: key } }, icon(ic, 20), h('span', label), key === 'avvisi' ? h('b.badge', { hidden: true }) : null);
  const side = h('aside.side',
    h('a.brand', { href: '#/release' }, h('img', { src: 'icons/mark-192.png', alt: '' }), h('span', 'Label Form'), A.demo ? h('em.demo-tag', 'prova') : null),
    h('nav.nav', NAV.map(navItem)),
    h('div.side-foot',
      h('div.side-label', (A.settings && A.settings.label_name) || ''),
      h('button.nav-i.ghost', { type: 'button', onclick: async () => { await K.lock(); toast('Dati bloccati'); gate(); } }, icon('lock', 20), h('span', 'Blocca')),
      A.demo ? h('button.nav-i.ghost', { type: 'button', onclick: leaveDemo }, icon('logout', 20), h('span', 'Esci dalla prova'))
        : h('button.nav-i.ghost', { type: 'button', onclick: async () => { await K.lock(); await A.api.auth.signOut(); gate(); } }, icon('logout', 20), h('span', 'Esci'))));
  viewEl = h('main.view#view');
  const tabbar = h('nav.tabbar', NAV.map(navItem));
  root.append(h('div.shell', side, h('div.main-col', A.demo ? h('div.demo-bar', icon('sparkle', 16), h('span', 'Modalità prova: tutto resta in questo browser. I link per gli artisti funzionano solo qui.')) : null, viewEl), tabbar));
  A.refreshBadge = refreshBadge;
  refreshBadge();
  clearInterval(badgeTimer);
  badgeTimer = setInterval(refreshBadge, 60000);
  route();
}

async function refreshBadge() {
  try {
    const ev = await A.api.listEvents(200);
    A.unread = ev.filter(e => !e.read_at && e.kind !== 'opened').length;
  } catch { return; }
  document.querySelectorAll('.badge').forEach(b => { b.hidden = !A.unread; b.textContent = A.unread > 99 ? '99+' : String(A.unread); });
  document.title = (A.unread ? `(${A.unread}) ` : '') + 'Label Form';
}

async function route() {
  if (!shellOn) return;
  if (!K.isUnlocked()) { shellOn = false; gate(); return; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let key = parts[0] || 'release';
  const param = parts[1] ? decodeURIComponent(parts[1]) : '';
  if (key === 'release' && param) key = 'releaseOne';
  if (!VIEWS[key]) key = 'release';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (key === 'releaseOne' || key === 'invio' ? 'release' : key === 'modulo' ? 'moduli' : key)));
  if (typeof cleanup === 'function') { try { await cleanup(); } catch { /* */ } }
  cleanup = null;
  clear(viewEl).append(h('div.loading', spinner(), h('span', 'Carico…')));
  try {
    const mod = await VIEWS[key]();
    cleanup = await mod.render(viewEl, param);
  } catch (x) {
    clear(viewEl).append(h('div.empty', h('div.empty-ic', icon('alert', 28)), h('h3', 'Non riesco a caricare'), h('p.muted', friendly(x)), btn('Riprova', () => route(), { ic: 'refresh' })));
    if (/Sessione/.test(friendly(x))) { shellOn = false; gate(); }
  }
  viewEl.scrollTo && viewEl.scrollTo(0, 0);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
// i menu a tendina si chiudono toccando altrove
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) document.querySelectorAll('.menu').forEach(x => { x.hidden = true; }); });

/* ─── avvio ─── */
async function boot() {
  try { A.notReady = !(await import('../config.js')).CONFIG.ready; } catch { A.notReady = true; }
  try {
    A.api = A.demo ? (await import('../api/demo.js')).adminApi : (await import('../api/supabase.js')).adminApi;
  } catch (x) { gateScreen('Connessione non riuscita', 'Non riesco a caricare i componenti. Ricarica la pagina.'); return; }
  if (!A.demo) {
    A.api.auth.onChange((ev) => {
      if (ev === 'SIGNED_OUT') { shellOn = false; K.lock(); gate(); }
      if (ev === 'PASSWORD_RECOVERY') { shellOn = false; showNewPassword(); }
    });
  }
  gate();
}
boot();
