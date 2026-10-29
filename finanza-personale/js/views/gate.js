/* Schermate prima dell'app: benvenuto, creazione della cassaforte, codice di recupero,
   sblocco, password dimenticata, ripristino da backup. */

import { h, icon, download, pickFile, readText } from '../ui/dom.js';
import { toast, confirmDialog, promptDialog } from '../ui/components.js';
import { passwordStrength, isRecoveryCodeShape, WrongSecret } from '../core/crypto.js';
import { demoState } from '../demo.js';

const G = { step: 'welcome', code: '', finish: null, busy: false, fails: 0, waitUntil: 0 };

const mark = () => h('img.gate-mark', { src: 'icons/icon.svg', alt: '', width: 76, height: 76 });

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
  if (S.mode === 'locked') return lockScreen(ctx);
  if (G.step === 'create') return createScreen(ctx);
  if (G.step === 'recovery') return recoveryScreen(ctx);
  return welcome(ctx);
}

/* ─── Benvenuto ─── */
function welcome(ctx) {
  return h('div.gate',
    h('div.gate-hero',
      mark(),
      h('h1.gate-title', 'Tutte le tue finanze.', h('br'), h('span.gate-title-soft', 'Solo tue.')),
      h('p.gate-lead', 'Conti, spese, budget, scadenze, investimenti e simulazioni in un\'unica app. I dati restano cifrati su questo dispositivo: nessun server, nessun account, nessuno che possa leggerli.'),
      h('ul.gate-points',
        h('li', icon('shield', 18), h('span', h('b', 'Cifratura AES-256'), ' con la tua password')),
        h('li', icon('offline', 18), h('span', h('b', 'Funziona offline'), ', anche come app sul telefono')),
        h('li', icon('eyeOff', 18), h('span', h('b', 'Zero tracciamento'), ': niente pubblicità, niente analisi'))),
      ctx.S.vaultWarning ? h('p.gate-warn', icon('alert', 16), ctx.S.vaultWarning) : null,
      h('div.gate-actions',
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => { G.step = 'create'; document.dispatchEvent(new Event('rhf-gate')); } }, 'Crea la tua cassaforte', icon('chevR', 18)),
        h('button.btn.btn-soft.btn-lg', { type: 'button', onclick: () => ctx.session.startDemo(demoState()) }, icon('sparkle', 18), 'Prova con dati di esempio'),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => restoreFlow(ctx) }, icon('upload', 18), 'Ho un file di backup'))),
    h('p.gate-foot', 'Sviluppato con cura da Davide Raho · © 2026'));
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
    h('div.gate-step', 'Passo 1 di 2'),
    h('h2', 'Scegli la password'),
    h('p.muted', 'Apre l\'app e cifra i dati. Non esce mai dal dispositivo: nessuno può recuperarla per te, nemmeno noi.'),
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
    h('div.gate-step', 'Passo 2 di 2'),
    h('h2', 'Il tuo codice di recupero'),
    h('p.muted', 'Se dimentichi la password, solo questo codice apre i tuoi dati. Salvalo fuori da questo dispositivo: stampalo, scrivilo o mettilo in un password manager.'),
    h('div.code-box', { 'aria-label': 'Codice di recupero' }, G.code.split('-').map(g => h('span', g))),
    h('div.row-2',
      h('button.btn.btn-soft', { type: 'button', onclick: save }, icon('download', 18), 'Scarica'),
      h('button.btn.btn-soft', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(G.code); toast('Codice copiato. Incollalo in un posto sicuro.', { kind: 'ok' }); } catch { toast('Copia non riuscita: scrivilo a mano', { kind: 'err' }); } } }, icon('copy', 18), 'Copia')),
    h('label.check', ok, h('span', 'Ho salvato il codice in un posto sicuro')),
    go));
}

/* ─── Sblocco ─── */
function lockScreen(ctx) {
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
    h('h2.center-text', 'Bentornato'),
    h('p.muted.center-text', ctx.S.lockReason || 'I tuoi dati sono cifrati. Inserisci la password per aprirli.'),
    h('input', { type: 'text', name: 'username', autocomplete: 'username', value: '[RH] Finance', hidden: true, readonly: true }),
    pw, err, btn,
    h('div.gate-links',
      h('button.link', { type: 'button', onclick: () => forgotFlow(ctx) }, 'Password dimenticata?'),
      h('button.link', { type: 'button', onclick: () => restoreFlow(ctx) }, 'Ripristina un backup'),
      h('button.link', { type: 'button', onclick: () => ctx.session.startDemo(demoState()) }, 'Prova con dati di esempio')));
  return h('div.gate', card, h('button.gate-wipe', { type: 'button', onclick: () => wipeFlow(ctx) }, 'Cancella i dati da questo dispositivo'));
}

/* ─── Password dimenticata: codice di recupero + nuova password ─── */
async function forgotFlow(ctx) {
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
