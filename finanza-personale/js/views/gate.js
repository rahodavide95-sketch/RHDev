/* Schermate prima dell'app: benvenuto, accesso con email e password, nuovo account,
   uso senza account, codice di recupero, sblocco, password dimenticata, backup. */

import { h, icon, download, pickFile, readText } from '../ui/dom.js';
import { toast, confirmDialog, promptDialog, openSheet } from '../ui/components.js';
import { passwordStrength, isRecoveryCodeShape, WrongSecret } from '../core/crypto.js';
import { demoState } from '../demo.js';
import * as cloud from '../cloud.js';

const G = { step: 'welcome', code: '', finish: null, busy: false, fails: 0, waitUntil: 0, notice: '', email: '', pw: '', reset: null };
const go = step => { G.step = step; document.dispatchEvent(new Event('rhf-gate')); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tornando dal link di un'email di Supabase (conferma, password dimenticata, errori). */
export function handleAuthLanding() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error|error_description)=/.test(raw)) return;
  const p = new URLSearchParams(raw);
  if (p.get('error_description') || p.get('error')) {
    G.notice = /expired|invalid/i.test(p.get('error_description') || '') ? 'Il link dell\'email è scaduto o è già stato usato: richiedine un altro.' : 'Il link dell\'email non è valido: ' + (p.get('error_description') || p.get('error'));
    G.step = 'login';
  } else if (p.get('type') === 'recovery' && p.get('access_token')) {
    G.reset = { access: p.get('access_token'), refresh: p.get('refresh_token') || '' };
    G.step = 'reset';
  } else {
    G.notice = 'Email confermata. Ora accedi con email e password.';
    G.step = 'login';
  }
  history.replaceState(null, '', location.pathname + location.search + '#/');
}

// il logo [RH] con Finance sotto (D: "al logo devi aggiungere Finance sotto ad RH")
const mark = () => h('img.gate-mark', { src: 'icons/icon-512.png', alt: '[RH] Finance', width: 112, height: 112 });

function pwField(placeholder, autocomplete, autofocus) {
  const inp = h('input.input.pw-input', { type: 'password', placeholder, autocomplete, autofocus, spellcheck: 'false', autocapitalize: 'off' });
  const eye = h('button.pw-eye', { type: 'button', 'aria-label': 'Mostra la password', onclick: () => {
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 18));
    eye.setAttribute('aria-label', show ? 'Nascondi la password' : 'Mostra la password');
  } }, icon('eye', 18));
  const wrap = h('div.pw-wrap', inp, eye);
  wrap.input = inp;
  return wrap;
}

function strengthMeter(inp) {
  const bar = h('div.meter', [1, 2, 3, 4].map(() => h('span')));
  const label = h('span.meter-label');
  const el = h('div.meter-row', bar, label);
  const upd = () => {
    const s = passwordStrength(inp.value);
    bar.dataset.score = s.score;
    label.textContent = inp.value ? s.label : '';
  };
  inp.addEventListener('input', upd);
  upd();
  return el;
}

export function renderGate(ctx) {
  const { S } = ctx;
  if (S.mode === 'boot') return h('div.gate', h('div.gate-card.center', mark(), h('div.spinner', { 'aria-label': 'Caricamento' })));
  if (G.step === 'reset' && G.reset) return resetScreen(ctx);
  if (G.step === 'recovery') return recoveryScreen(ctx);
  if (S.mode === 'locked') return G.step === 'old' ? oldScreen(ctx) : lockScreen(ctx);
  if (G.step === 'create') return createScreen(ctx);
  if (G.step === 'login') return loginScreen(ctx);
  if (G.step === 'signup') return signupScreen(ctx);
  if (G.step === 'old') return oldScreen(ctx);
  return welcome(ctx);
}

const notice = () => (G.notice ? h('p.gate-note', icon('info', 16), h('span', G.notice)) : null);
const back = (to = 'welcome') => h('button.gate-back', { type: 'button', onclick: () => { G.notice = ''; go(to); } }, icon('chevL', 18), 'Indietro');
function emailField(value = '') {
  return h('input.input', { type: 'email', placeholder: 'Email', autocomplete: 'username', value, autocapitalize: 'off', spellcheck: 'false', inputmode: 'email' });
}
function fail(err, btn, label, e2) {
  btn.disabled = false; btn.textContent = label;
  err.textContent = e2?.message || String(e2); err.hidden = false;
}

/* ─── Accesso con email e password ─── */
function loginScreen(ctx) {
  const em = emailField(G.email);
  const pw = pwField('Password', 'current-password', false);
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Accedi');
  const form = h('form.gate-card', { onsubmit: async e => {
    e.preventDefault();
    const email = em.value.trim(), password = pw.input.value;
    if (!EMAIL.test(email) || !password) { err.textContent = 'Scrivi email e password.'; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Accedo e apro i dati cifrati…';
    G.email = email;
    try {
      const r = await ctx.session.loginNewDevice(email, password);
      G.notice = '';
      if (r.needOld) { G.pw = password; go('old'); return; }
      if (r.recoveryCode) { G.code = r.recoveryCode; G.finish = r.finish; go('recovery'); return; }
      G.step = 'welcome';
      toast('Bentornato! Dati scaricati e sincronizzati.', { kind: 'ok' });
    } catch (e2) { fail(err, btn, 'Accedi', e2); }
  } },
    back(),
    h('h2', 'Accedi'),
    h('p.muted', 'Con il tuo account [RH] (email e password). I dati arrivano cifrati e si aprono solo qui, con la tua password.'),
    notice(),
    h('div.stack-sm', em, pw), err, btn,
    h('div.gate-links',
      h('button.link', { type: 'button', onclick: () => resetRequest(em.value) }, 'Password dimenticata?'),
      h('button.link', { type: 'button', onclick: () => { G.notice = ''; go('signup'); } }, 'Non hai un account? Crealo')));
  setTimeout(() => (G.email ? pw.input : em).focus(), 80);
  return h('div.gate', form);
}

async function resetRequest(prefill) {
  const email = await promptDialog({
    title: 'Password dimenticata', label: 'Email dell\'account', type: 'email', confirm: 'Mandami il link',
    message: 'Ti mando un\'email: apri il link (vale un\'ora), scegli una nuova password e i tuoi dati si riaprono.',
    validate: async v => {
      if (!EMAIL.test(v.trim())) return 'Scrivi un\'email valida.';
      try { await cloud.requestReset(v); return ''; } catch (e) { return e?.message || String(e); }
    },
  });
  if (email) toast('Email inviata: apri il link (vale un\'ora) e scegli una nuova password.', { kind: 'ok' });
  void prefill;
}

/* ─── Nuovo account ─── */
function signupScreen(ctx) {
  const em = emailField(G.email);
  const p1 = pwField('Password o frase segreta', 'new-password');
  const p2 = pwField('Ripetila', 'new-password');
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Crea l\'account');
  const form = h('form.gate-card', { onsubmit: async e => {
    e.preventDefault();
    const email = em.value.trim(), a = p1.input.value, b = p2.input.value;
    let msg = '';
    if (!EMAIL.test(email)) msg = 'Scrivi un\'email valida.';
    else if (a.length < 10) msg = 'Usa almeno 10 caratteri (meglio una frase di 4 parole).';
    else if (passwordStrength(a).score < 2 && a.length < 14) msg = 'Questa password è troppo facile da indovinare.';
    else if (a !== b) msg = 'Le due password non sono uguali.';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Creo l\'account…';
    G.email = email;
    try {
      const r = await ctx.session.signUp(email, a);
      if (r === 'confirm') { G.notice = `Ti ho mandato un'email a ${email}: apri il link per confermare, poi torna qui e accedi.`; go('login'); return; }
      const r2 = await ctx.session.loginNewDevice(email, a);
      if (r2.recoveryCode) { G.code = r2.recoveryCode; G.finish = r2.finish; go('recovery'); }
    } catch (e2) { fail(err, btn, 'Crea l\'account', e2); }
  } },
    back(),
    h('div.gate-step', 'Passo 1 di 2'),
    h('h2', 'Crea il tuo account'),
    h('p.muted', 'La password serve ad accedere e a cifrare i dati prima che partano: online arriva solo testo illeggibile. Nessuno può recuperarla per te.'),
    h('div.stack-sm', em, p1, strengthMeter(p1.input), p2),
    h('p.tip', icon('sparkle', 16), h('span', 'Consiglio: una frase di 4 o più parole che solo tu conosci, es. «ombrello viola corre al mare».')),
    err, btn);
  return h('div.gate', form);
}

/* ─── I dati online sono chiusi con la password di prima ─── */
function oldScreen(ctx) {
  const inp = pwField('Password di prima o codice di recupero', 'off', true);
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Apri i dati');
  const form = h('form.gate-card', { onsubmit: async e => {
    e.preventDefault();
    if (!inp.input.value) return;
    btn.disabled = true; btn.textContent = 'Apro…';
    try {
      if (ctx.S.mode === 'locked') await ctx.session.rekey(inp.input.value, G.pw);
      else await ctx.session.loginWithOld(inp.input.value, G.pw);
      G.pw = ''; G.step = 'welcome';
      toast('Dati aperti e richiusi con la password nuova', { kind: 'ok' });
    } catch (e2) { fail(err, btn, 'Apri i dati', e2 instanceof WrongSecret ? new Error('Non è la password di prima né il codice di recupero.') : e2); }
  } },
    back(ctx.S.mode === 'locked' ? 'welcome' : 'login'),
    h('h2', 'La password è cambiata'),
    h('p.muted', 'Hai cambiato la password dell\'account (anche da [RH] Documents), ma i dati sono ancora chiusi con quella di prima. Scrivila qui, o usa il codice di recupero: li richiudo con quella nuova.'),
    inp, err, btn);
  return h('div.gate', form);
}

/* ─── Dal link "password dimenticata" (D: "la password dimenticata facciamola tramite email") ───
   Basta la nuova password: i dati si riaprono con la chiave di riserva che il server dà a chi arriva dal link.
   Il codice di recupero si chiede solo se questi dati non hanno ancora la chiave di riserva. */
function resetScreen(ctx) {
  const code = h('input.input', { type: 'text', placeholder: 'Codice di recupero (32 caratteri)', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' });
  const codeWrap = h('div.stack-sm', { hidden: !G.reset.needCode }, code);
  const p1 = pwField('Nuova password', 'new-password', true);
  const p2 = pwField('Ripetila', 'new-password');
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const label = 'Salva e apri i miei dati';
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, label);
  const intro = h('p.muted', G.reset.needCode ? 'Scrivi anche il codice di recupero che hai salvato quando hai creato la cassaforte.' : 'Scegli una nuova password: i tuoi dati si riaprono da soli e la password vale da ora su tutti i dispositivi.');
  const form = h('form.gate-card', { onsubmit: async e => {
    e.preventDefault();
    const a = p1.input.value;
    let msg = '';
    if (G.reset.needCode && !isRecoveryCodeShape(code.value)) msg = 'Il codice di recupero è di 32 caratteri tra lettere e numeri.';
    else if (a.length < 10) msg = 'Usa almeno 10 caratteri.';
    else if (passwordStrength(a).score < 2 && a.length < 14) msg = 'Troppo facile da indovinare.';
    else if (a !== p2.input.value) msg = 'Le due password non sono uguali.';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Apro i dati…';
    try {
      const r = await ctx.session.resetFromLink(G.reset.access, G.reset.refresh, G.reset.needCode ? code.value : '', a);
      G.reset = null;
      if (r?.empty) { G.notice = 'Password cambiata. Ora accedi con la nuova password.'; G.email = cloud.session()?.email || ''; go('login'); return; }
      G.step = 'welcome';
      toast('Password cambiata: i tuoi dati sono aperti. Da ora usa la nuova password.', { kind: 'ok' });
    } catch (e2) {
      if (e2?.code === 'needCode') {
        G.reset.needCode = true; codeWrap.hidden = false;
        intro.textContent = 'Scrivi anche il codice di recupero che hai salvato quando hai creato la cassaforte.';
        fail(err, btn, label, e2); code.focus();
        return;
      }
      fail(err, btn, label, e2 instanceof WrongSecret ? new Error('Il codice di recupero non è corretto.') : e2);
    }
  } },
    h('h2', 'Nuova password'),
    intro,
    h('div.stack-sm', codeWrap, p1, strengthMeter(p1.input), p2), err, btn,
    h('button.link', { type: 'button', onclick: () => { G.reset = null; go('welcome'); } }, 'Annulla'));
  return h('div.gate', form);
}

/* ─── Benvenuto ─── */
function welcome(ctx) {
  return h('div.gate',
    h('div.gate-hero',
      mark(),
      h('h1.gate-title', 'Tutte le tue finanze.', h('br'), h('span.gate-title-soft', 'Solo tue.')),
      h('p.gate-lead', 'Conti, spese, budget, scadenze, investimenti e simulazioni in un\'unica app, sul telefono e sul computer. I dati vengono cifrati qui, con la tua password, prima di partire: online nessuno può leggerli.'),
      h('ul.gate-points',
        h('li', icon('shield', 18), h('span', h('b', 'Cifratura AES-256'), ' con la tua password')),
        h('li', icon('refresh', 18), h('span', h('b', 'Sincronizzati'), ' su tutti i tuoi dispositivi')),
        h('li', icon('offline', 18), h('span', h('b', 'Funziona offline'), ', anche come app')),
        h('li', icon('eyeOff', 18), h('span', h('b', 'Zero tracciamento'), ', zero pubblicità'))),
      ctx.S.vaultWarning ? h('p.gate-warn', icon('alert', 16), ctx.S.vaultWarning) : null,
      notice(),
      h('div.gate-actions',
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => go('login') }, 'Accedi con email e password', icon('chevR', 18)),
        h('button.btn.btn-soft.btn-lg', { type: 'button', onclick: () => go('signup') }, 'Crea un account'),
        h('button.btn.btn-soft.btn-lg', { type: 'button', onclick: () => ctx.session.startDemo(demoState()) }, icon('sparkle', 18), 'Prova con dati di esempio'),
        h('div.gate-more',
          h('button.link', { type: 'button', onclick: () => go('create') }, 'Usa senza account, solo su questo dispositivo'),
          h('button.link', { type: 'button', onclick: () => restoreFlow(ctx) }, 'Ho un file di backup')))),
    h('p.gate-foot', 'Sviluppato con cura da Davide Raho · © 2026 · Tutti i diritti riservati'));
}

/* ─── Creazione ─── */
function createScreen(ctx) {
  const p1 = pwField('Password o frase segreta', 'new-password', true);
  const p2 = pwField('Ripetila', 'new-password');
  const err = h('p.field-err', { hidden: true });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Crea la cassaforte');
  const form = h('form.gate-card', { onsubmit: async e => {
    e.preventDefault();
    const a = p1.input.value, b = p2.input.value;
    const st = passwordStrength(a);
    let msg = '';
    if (a.length < 8) msg = 'Usa almeno 8 caratteri (meglio una frase di 4 parole).';
    else if (st.score < 2 && a.length < 14) msg = 'Questa password è troppo facile da indovinare: aggiungi parole o caratteri.';
    else if (a !== b) msg = 'Le due password non sono uguali.';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    err.hidden = true;
    btn.disabled = true; btn.textContent = 'Creo la cassaforte cifrata…';
    try {
      const res = await ctx.session.create(a);
      G.code = res.recoveryCode; G.finish = res.finish; G.step = 'recovery';
      document.dispatchEvent(new Event('rhf-gate'));
    } catch (e2) {
      btn.disabled = false; btn.textContent = 'Crea la cassaforte';
      err.textContent = 'Non sono riuscito a creare la cassaforte: ' + (e2?.message || e2); err.hidden = false;
    }
  } },
    h('button.gate-back', { type: 'button', onclick: () => { G.step = 'welcome'; document.dispatchEvent(new Event('rhf-gate')); } }, icon('chevL', 18), 'Indietro'),
    h('div.gate-step', 'Senza account · passo 1 di 2'),
    h('h2', 'Scegli la password'),
    h('p.muted', 'Apre l\'app e cifra i dati, che restano solo su questo dispositivo. Potrai collegare un account più avanti dalle Impostazioni.'),
    h('input', { type: 'text', name: 'username', autocomplete: 'username', value: '[RH] Finance', hidden: true, readonly: true }),
    h('div.stack-sm', p1, strengthMeter(p1.input), p2),
    h('p.tip', icon('sparkle', 16), h('span', 'Consiglio: una frase di 4 o più parole che solo tu conosci, es. «ombrello viola corre al mare». È lunga ma facile da ricordare.')),
    err, btn);
  return h('div.gate', form);
}

/* ─── Codice di recupero ─── */
function recoveryScreen(ctx) {
  const ok = h('input', { type: 'checkbox' });
  const go = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'button', disabled: true, onclick: () => {
    const fin = G.finish;
    G.step = 'welcome'; G.code = ''; G.finish = null;
    fin?.();
    toast('Cassaforte pronta. Benvenuto!', { kind: 'ok' });
  } }, 'Entra nell\'app');
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  const save = () => {
    const text = `[RH] Finance — codice di recupero\n\n${G.code}\n\nServe solo se dimentichi la password. Conservalo offline (carta, cassaforte, password manager).\nCreato il ${new Date().toLocaleString('it-IT')}.\n`;
    download(new Blob([text], { type: 'text/plain' }), 'RH-Finance-codice-di-recupero.txt');
  };
  return h('div.gate', h('div.gate-card',
    h('div.gate-step', 'Ultimo passo'),
    h('h2', 'Il tuo codice di recupero'),
    h('p.muted', 'Se dimentichi la password e hai l\'account, basta l\'email: ti arriva un link per sceglierne una nuova. Questo codice è la strada di riserva (e l\'unica se usi l\'app senza account): salvalo fuori da questo dispositivo, stampalo, scrivilo o mettilo in un password manager.'),
    h('div.code-box', { 'aria-label': 'Codice di recupero' }, G.code.split('-').map(g => h('span', g))),
    h('div.row-2',
      h('button.btn.btn-soft', { type: 'button', onclick: save }, icon('download', 18), 'Scarica'),
      h('button.btn.btn-soft', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(G.code); toast('Codice copiato. Incollalo in un posto sicuro.', { kind: 'ok' }); } catch { toast('Copia non riuscita: scrivilo a mano', { kind: 'err' }); } } }, icon('copy', 18), 'Copia')),
    h('label.check', ok, h('span', 'Ho salvato il codice in un posto sicuro')),
    go));
}

/* ─── Sblocco ─── */
function lockScreen(ctx) {
  const acct = ctx.S.cloud.email || ctx.session.lastAccount();
  const pw = pwField('Password', 'current-password', true);
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, icon('unlock', 18), 'Sblocca');
  const card = h('form.gate-card.center', { onsubmit: async e => {
    e.preventDefault();
    if (Date.now() < G.waitUntil) { err.textContent = `Troppi tentativi: riprova tra ${Math.ceil((G.waitUntil - Date.now()) / 1000)} secondi.`; err.hidden = false; return; }
    if (!pw.input.value) { pw.input.focus(); return; }
    btn.disabled = true; btn.lastChild.textContent = 'Apro…';
    try {
      await ctx.session.unlock(pw.input.value);
      G.fails = 0;
    } catch (e2) {
      btn.disabled = false; btn.lastChild.textContent = 'Sblocca';
      if (e2?.code === 'needOld') { G.pw = pw.input.value; go('old'); return; }
      if (e2 instanceof WrongSecret) {
        G.fails++;
        if (G.fails >= 5) G.waitUntil = Date.now() + Math.min(300, 15 * 2 ** (G.fails - 5)) * 1000;
        err.textContent = 'Password non corretta.';
      } else err.textContent = e2?.message || String(e2);
      err.hidden = false;
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      pw.input.select();
    }
  } },
    mark(),
    // chi sei (D: "il tool deve sapere che sono io, cioè quale account era connesso prima")
    h('h2.center-text', ctx.session.lastName() ? `Bentornato, ${ctx.session.lastName()}` : 'Bentornato'),
    acct ? h('p.gate-email', icon('refresh', 15), acct, !ctx.S.cloud.linked ? h('small', ' · ti ricollego appena sblocchi') : null)
      : h('p.gate-email.muted', icon('lock', 15), 'Senza account: i dati sono solo su questo dispositivo'),
    h('p.muted.center-text', ctx.S.lockReason || 'I tuoi dati sono cifrati. Inserisci la password per aprirli.'),
    h('input', { type: 'text', name: 'username', autocomplete: 'username', value: acct || '[RH] Finance', hidden: true, readonly: true }),
    pw, err, btn,
    h('div.gate-links',
      acct ? h('button.link', { type: 'button', onclick: () => otherAccount(ctx, acct) }, 'Non sei tu? Accedi con un altro account') : null,
      h('button.link', { type: 'button', onclick: () => forgotFlow(ctx) }, 'Password dimenticata?'),
      h('button.link', { type: 'button', onclick: () => restoreFlow(ctx) }, 'Ripristina un backup'),
      h('button.link', { type: 'button', onclick: () => ctx.session.startDemo(demoState()) }, 'Prova con dati di esempio')));
  return h('div.gate', card, h('button.gate-wipe', { type: 'button', onclick: () => wipeFlow(ctx) }, 'Cancella i dati da questo dispositivo'));
}

/* ─── Cambiare account (D: "a meno che non si vuole cambiare account e quindi chiederà di fare l'accesso con
   un altro"): i dati di questo account restano online; da questo dispositivo si toglie la copia e si accede
   con l'altro account. ─── */
async function otherAccount(ctx, acct) {
  const ok = await confirmDialog({
    title: 'Accedere con un altro account?',
    message: `I dati di ${acct} restano online, cifrati: li ritrovi accedendo di nuovo con quell'account. Da questo dispositivo tolgo la copia e ti chiedo email e password dell'altro account.`,
    confirm: 'Cambia account', danger: true,
  });
  if (!ok) return;
  try { await ctx.session.wipeAll(); } catch (e) { toast('Non ci sono riuscito: ' + (e?.message || e), { kind: 'err' }); return; }
  G.notice = ''; go('login');
}

/* ─── Password dimenticata dallo sblocco: con l'account, un'email al suo indirizzo (D: "la password dimenticata
   facciamola tramite email"); il codice di recupero resta come seconda strada (e l'unica senza account). ─── */
function forgotFlow(ctx) {
  const acct = ctx.S.cloud.email || ctx.session.lastAccount();
  if (!acct) { codeFlow(ctx); return; }
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const send = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
    send.disabled = true; send.textContent = 'Mando l\'email…'; err.hidden = true;
    try {
      await cloud.requestReset(acct);
      sh.close(true);
      toast(`Email mandata a ${acct}: apri il link (vale un'ora) e scegli una nuova password.`, { kind: 'ok', ms: 9000 });
    } catch (e) { send.disabled = false; send.textContent = 'Mandami l\'email'; err.textContent = e?.message || String(e); err.hidden = false; }
  } }, 'Mandami l\'email');
  const sh = openSheet({
    title: 'Password dimenticata', size: 'sm',
    body: h('div.stack', h('p', 'Ti mando un\'email a ', h('b', acct), ': apri il link, scegli una nuova password e i tuoi dati si riaprono. Il link vale un\'ora.'), err),
    footer: [h('button.btn.btn-ghost', { type: 'button', onclick: () => { sh.close(true); codeFlow(ctx); } }, 'Ho il codice di recupero'), send],
  });
}

/* ─── Password dimenticata: codice di recupero + nuova password ─── */
async function codeFlow(ctx) {
  const code = await promptDialog({
    title: 'Codice di recupero', label: 'Codice (32 caratteri)', message: 'Scrivi il codice che hai salvato quando hai creato la cassaforte. Maiuscole, spazi e trattini non contano.',
    validate: v => (isRecoveryCodeShape(v) ? '' : 'Il codice è di 32 caratteri tra lettere e numeri.'),
  });
  if (!code) return;
  const np = await promptDialog({
    title: 'Nuova password', label: 'Nuova password', type: 'password', autocomplete: 'new-password', confirm: 'Sblocca',
    message: 'Scegli una nuova password (almeno 8 caratteri).',
    validate: async v => {
      if (v.length < 8) return 'Almeno 8 caratteri.';
      if (passwordStrength(v).score < 2 && v.length < 14) return 'Troppo facile da indovinare.';
      try { await ctx.session.unlockWithRecovery(code, v); return ''; }
      catch (e) { return e instanceof WrongSecret ? 'Il codice di recupero non è corretto.' : (e?.message || String(e)); }
    },
  });
  if (np) toast('Password cambiata. Il codice di recupero resta lo stesso.', { kind: 'ok' });
}

/* ─── Ripristino da backup (sostituisce i dati di questo dispositivo) ─── */
async function restoreFlow(ctx) {
  const f = await pickFile('.json,.rhfin,application/json');
  if (!f) return;
  let parsed;
  try { parsed = ctx.session.parseBackup(await readText(f)); }
  catch (e) { toast(e?.message || 'File non valido', { kind: 'err' }); return; }
  if (parsed.kind === 'plain') {
    if (!(await confirmDialog({ title: 'Backup non cifrato', message: 'Questo file non è cifrato. Per usarlo crea prima una cassaforte con una password: poi importalo dalle Impostazioni.', confirm: 'Ho capito' }))) return;
    return;
  }
  if (ctx.S.hasVault && !(await confirmDialog({ title: 'Sostituire i dati di questo dispositivo?', message: 'I dati che ci sono ora su questo dispositivo verranno sostituiti da quelli del backup.', confirm: 'Sostituisci', danger: true }))) return;
  let opened = null;
  const ok = await promptDialog({
    title: 'Apri il backup', label: 'Password del backup (o codice di recupero)', type: 'password', autocomplete: 'current-password', confirm: 'Ripristina',
    message: `File del ${new Date(parsed.vault.updated || parsed.vault.exported || Date.now()).toLocaleDateString('it-IT')}. Usa la password che avevi quando l'hai creato.`,
    validate: async v => {
      try { opened = await ctx.session.openBackup(parsed.vault, v); return ''; }
      catch (e) { return e instanceof WrongSecret ? 'Password o codice non corretti.' : (e?.message || String(e)); }
    },
  });
  if (!ok || !opened) return;
  await ctx.session.replaceState(opened.state, { vault: parsed.vault, key: opened.key });
  toast('Backup ripristinato', { kind: 'ok' });
}

async function wipeFlow(ctx) {
  const ok = await promptDialog({
    title: 'Cancellare tutto?', label: 'Scrivi CANCELLA per confermare', confirm: 'Cancella tutto',
    message: 'Toglie dal dispositivo la cassaforte, le copie automatiche e le impostazioni. Senza un backup i dati sono persi per sempre.',
    validate: v => (v.trim().toUpperCase() === 'CANCELLA' ? '' : 'Scrivi CANCELLA'),
  });
  if (!ok) return;
  await ctx.session.wipeAll();
  G.step = 'welcome';
  toast('Dati cancellati da questo dispositivo');
}
