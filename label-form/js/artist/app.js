/* Pagina dell'artista (invio.html#k=…): compila il modulo dell'etichetta, firma il contratto,
   invia tutto cifrato e, se ha scelto una password, può tornare a vedere e modificare. */

import { h, icon, clear, append, fmtDateTime, todayYmd, guardFrame, debounce } from '../ui/dom.js';
import { applyTheme, formHeader, sectionBlock, focusFirstError, textOf, shown } from '../ui/form-view.js';
import { richBlock } from '../ui/rich.js';
import { attachSignature } from '../ui/signature.js';
import { contractDoc, copyDocument, savePdf, pdfName } from '../ui/pdf.js';
import { sanitizeForm, hasContract, SENSITIVE_TYPES, isStatic } from '../core/schema.js';
import * as C from '../core/crypto.js';
import { sectionProblems, formProblems, splitAnswers, filledIds, changedIds, summaryRows, formatValue, EMAIL_RE } from '../core/answers.js';
import { contractSnapshot, contractHash } from '../core/contract.js';
import { isEmptyRich } from '../core/richtext.js';
import { setLang, tr } from '../core/i18n.js';

guardFrame();
const root = document.getElementById('app');
const params = new URLSearchParams(location.hash.slice(1));
const previewToken = params.get('p') || '';
const PREVIEW = !!previewToken;           // link di anteprima dell'etichetta: si vede tutto, non si invia niente
const token = PREVIEW ? previewToken : (params.get('k') || '');
const demo = params.get('demo') === '1';
let api = null;

const S = {
  data: null, form: null, label: {}, release: {}, invite: {},
  mode: 'new', step: 0, steps: [], errors: {}, answers: {},
  signature: null, signedFor: '', skipSign: false,
  dek: null, verifier: null, version: 0, before: null,
  contractSigned: false, contractSnap: null, contractHash: null, signedAt: null,
  emailOn: false, wantPw: true, pw: '', pw2: '', wantPdf: false, wantMail: false, mailTo: '',
  draftKey: '', busy: false,
};

/* ─── utilità ─── */
let toastTimer = null;
function toast(msg, ms = 3200) {
  document.querySelectorAll('.f-toast').forEach(t => t.remove());
  const t = h('div.f-toast', { role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}
const ERRS = {
  not_found: ['Link non valido. Controlla di averlo copiato tutto, oppure chiedi all\'etichetta un link nuovo.', 'Invalid link. Check you copied all of it, or ask the label for a new link.'],
  revoked: ['Questo link non è più attivo. Chiedi all\'etichetta quello nuovo.', 'This link is no longer active. Ask the label for the new one.'],
  expired: ['Questo link è scaduto. Chiedi all\'etichetta di rinnovarlo.', 'This link has expired. Ask the label to renew it.'],
  not_ready: ['Il modulo non è ancora pronto. Riprova più tardi.', 'The form is not ready yet. Please try again later.'],
  closed: ['La raccolta per questa release è chiusa: per cambiare qualcosa scrivi all\'etichetta.', 'Submissions for this release are closed: to change something, write to the label.'],
  already_submitted: ['Risulta già un invio con questo link. Ricarica la pagina.', 'Something was already submitted with this link. Reload the page.'],
  conflict: ['Il tuo invio è stato cambiato da un\'altra finestra o da un altro dispositivo. Ricarica la pagina e riprova.', 'Your submission was changed from another window or device. Reload the page and try again.'],
  contract_locked: ['Il contratto è già firmato e non si può più modificare.', 'The contract is already signed and can no longer be changed.'],
  invalid: ['Qualcosa nei dati non va. Ricarica la pagina e riprova.', 'Something is wrong with the data. Reload the page and try again.'],
  network: ['Connessione non riuscita. Controlla internet e riprova.', 'Connection failed. Check your internet and try again.'],
  no_password: ['Questo invio non ha una password: per vederlo o modificarlo scrivi all\'etichetta.', 'This submission has no password: to see or change it, write to the label.'],
  too_many_versions: ['Hai raggiunto il numero massimo di modifiche: scrivi all\'etichetta.', 'You have reached the maximum number of edits: write to the label.'],
};
const ERR = new Proxy(ERRS, { get: (o, k) => (o[k] ? tr(o[k][0], o[k][1]) : undefined) });
function errText(r) {
  if (!r) return ERR.network;
  if (r.error === 'wrong_password') return r.left > 0 ? tr(`Password sbagliata. Ancora ${r.left} ${r.left === 1 ? 'tentativo' : 'tentativi'}, poi dovrai aspettare 15 minuti.`, `Wrong password. ${r.left} ${r.left === 1 ? 'attempt' : 'attempts'} left, then you'll have to wait 15 minutes.`) : tr('Password sbagliata. Troppi tentativi: riprova tra 15 minuti.', 'Wrong password. Too many attempts: try again in 15 minutes.');
  if (r.error === 'locked') { const t = new Date(r.retry_at).toLocaleTimeString(tr('it-IT', 'en-GB'), { hour: '2-digit', minute: '2-digit' }); return tr(`Troppi tentativi sbagliati: riprova dopo le ${t}.`, `Too many wrong attempts: try again after ${t}.`); }
  return ERR[r.error] || ERR[r.code] || tr('Qualcosa non ha funzionato. Riprova tra poco.', 'Something went wrong. Please try again shortly.');
}
const labelName = () => S.label.name || tr('l\'etichetta', 'the label');
const ctxContract = () => ({ label: S.label.name, signer: S.label.signer, release: S.release.title, catalog: S.release.catalog, artist: S.invite.artist, artistPct: S.invite.artist_pct });
const tx = (key, vars) => textOf(S.form, key, vars);
const hasContractPart = () => S.form.sections.some(s => s.contract) || hasContract(S.form);

/* ─── struttura della pagina ─── */
const wrap = h('div.f-wrap');
const main = h('main#main');
function frame() {
  clear(root).append(wrap);
  clear(wrap);
  if (PREVIEW) wrap.append(previewBar());
  else if (demo) wrap.append(h('div.f-banner.warn', icon('info', 18), h('span', tr('Modalità prova: questo invio resta solo in questo browser, non arriva a nessuno.', 'Demo mode: this submission stays in this browser only and reaches no one.'))));
  wrap.append(formHeader({ form: S.form, label: S.label, release: S.release, artist: S.invite.artist }), main,
    shown(S.form, 'foot') ? h('p.f-foot', icon('lock', 14), h('span', tx('foot', { etichetta: labelName() }))) : null);
}
function screen(...kids) { clear(main); append(main, kids); }
function message({ ic = 'info', tone = '', title, text, actions = [] }) {
  return h('div.f-card.f-msg', h('div.f-bigicon' + (tone ? '.' + tone : ''), icon(ic, 30)), h('h2', title), text ? h('p', text) : null, actions.length ? h('div.f-actions', actions) : null);
}
function fatal(title, text, retry = false) {
  document.title = 'Label Form';
  clear(root);
  const w = h('div.f-wrap');
  w.append(message({ ic: 'alert', tone: 'bad', title, text, actions: retry ? [h('button.f-btn', { type: 'button', onclick: () => location.reload() }, icon('refresh', 18), 'Riprova')] : [] }));
  root.append(w);
}

/* ─── bozza sul dispositivo (mai i dati riservati) ─── */
function draftable(answers) {
  const out = {};
  for (const s of S.form.sections) for (const f of s.fields) {
    if (isStatic(f) || f.sensitive || SENSITIVE_TYPES.includes(f.type)) continue;
    let v = answers[f.id];
    if (f.type === 'group' && Array.isArray(v)) v = v.map(item => Object.fromEntries(Object.entries(item || {}).filter(([k]) => { const sf = f.fields.find(x => x.id === k); return sf && !sf.sensitive && !SENSITIVE_TYPES.includes(sf.type); })));
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}
const saveDraft = debounce(() => {
  if (S.mode !== 'new' || !S.draftKey || PREVIEW) return;
  try { localStorage.setItem(S.draftKey, JSON.stringify({ at: Date.now(), answers: draftable(S.answers) })); } catch { /* */ }
}, 600);
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(S.draftKey) || 'null');
    if (d && d.answers && Date.now() - d.at < 60 * 864e5) return d.answers;
  } catch { /* */ }
  return null;
}
function dropDraft() { try { localStorage.removeItem(S.draftKey); } catch { /* */ } }

/* ─── avvio ─── */
async function boot() {
  setLang('en');
  if (!C.isTokenShape(token)) { fatal(tr('Link non valido', 'Invalid link'), ERR.not_found); return; }
  if (PREVIEW) { bootPreview(); return; }
  try {
    api = demo ? (await import('../api/demo.js')).artistApi : (await import('../api/supabase.js')).artistApi;
  } catch { fatal(tr('Connessione non riuscita', 'Connection failed'), ERR.network, true); return; }
  let r;
  try { r = await api.open(token); } catch (e) { fatal(tr('Connessione non riuscita', 'Connection failed'), ERR.network, true); return; }
  if (!r || r.error) { fatal(r && r.error === 'not_ready' ? tr('Quasi pronto', 'Almost ready') : tr('Link non valido', 'Invalid link'), errText(r), r && r.error === 'not_ready'); return; }
  S.data = r;
  S.form = sanitizeForm(r.form);
  setLang(S.form.lang);
  document.documentElement.lang = S.form.lang;
  S.label = r.label || {};
  S.release = r.release || {};
  S.invite = r.invite || {};
  S.version = S.invite.version || 0;
  S.contractSigned = !!S.invite.contract_signed_at;
  S.signedAt = S.invite.contract_signed_at;
  S.draftKey = 'labelform-draft:' + (await C.sha256hex(token)).slice(0, 24);
  document.title = `${S.form.title}${S.label.name ? ' — ' + S.label.name : ''}`;
  const theme = applyTheme(document.body, S.form.theme);
  document.documentElement.style.backgroundColor = theme.bg;
  document.body.classList.add('fx');
  api.mailPing().then(on => { S.emailOn = on; }).catch(() => {});
  frame();
  if (S.version > 0) { showLocked(); return; }
  if (S.release.closed) { screen(message({ ic: 'lock', title: tr('Raccolta chiusa', 'Submissions closed'), text: ERR.closed })); return; }
  S.mode = 'new';
  const d = loadDraft();
  if (d) S.answers = d;
  startWizard(0);
}

/* ─── già inviato: serve la password ─── */
function showLocked(errMsg = '') {
  const sub = fmtDateTime(S.invite.submitted_at), upd = fmtDateTime(S.invite.updated_at);
  const when = S.invite.updated_at && S.invite.updated_at !== S.invite.submitted_at ? tr(`Inviato il ${sub}, ultima modifica il ${upd}.`, `Sent on ${sub}, last changed on ${upd}.`) : tr(`Inviato il ${sub}.`, `Sent on ${sub}.`);
  if (!S.invite.has_password) {
    screen(message({ ic: 'checkCircle', tone: 'ok', title: tr('Hai già inviato tutto', 'You already sent everything'), text: when + ' ' + tr(`Hai scelto di non mettere una password, quindi per vedere o cambiare qualcosa scrivi a ${labelName()}.`, `You chose not to set a password, so to see or change something write to ${labelName()}.`) }));
    return;
  }
  const pw = h('input.f-input', { type: 'password', autocomplete: 'current-password', placeholder: tr('La tua password', 'Your password'), 'aria-label': 'Password', id: 'unlock-pw' });
  const err = h('div.f-err', { role: 'alert' }, errMsg);
  const btn = h('button.f-btn', { type: 'submit' }, icon('unlock', 18), tr('Apri il mio invio', 'Open my submission'));
  const form = h('form.f-pw', { onsubmit: async e => {
    e.preventDefault();
    if (!pw.value) { err.textContent = tr('Scrivi la password.', 'Enter your password.'); return; }
    btn.disabled = true; btn.textContent = tr('Apro…', 'Opening…');
    try { await unlock(pw.value); } catch (x) { btn.disabled = false; clear(btn).append(icon('unlock', 18), tr('Apri il mio invio', 'Open my submission')); err.textContent = x.message || ERR.network; }
  } }, pw, err, btn);
  screen(h('div.f-card.f-msg', h('div.f-bigicon.ok', icon('checkCircle', 30)), h('h2', tr('Hai già inviato', 'Already sent')), h('p', when),
    h('p', S.release.closed ? tr('La release è chiusa: puoi rivedere il tuo invio, ma non modificarlo.', 'The release is closed: you can review your submission, but not change it.') : tr('Con la tua password puoi rivedere e modificare quello che hai mandato.', 'With your password you can review and change what you sent.')), form));
  setTimeout(() => pw.focus(), 50);
}

async function unlock(password) {
  const { kek, verifier } = await C.artistSecret(password, S.invite.pw_salt, S.invite.pw_iter);
  let r;
  try { r = await api.unlock(token, verifier); } catch { throw new Error(ERR.network); }
  if (!r || r.error) throw new Error(errText(r));
  const dek = await C.unwrapDataKeyForArtist(kek, r.dek_artist);
  const mainPart = await C.openJson(dek, r.main, C.partAad('main', S.invite.id));
  const cPart = r.contract ? await C.openJson(dek, r.contract, C.partAad('contract', S.invite.id)) : null;
  S.answers = { ...(mainPart.answers || {}), ...((cPart && cPart.answers) || {}) };
  S.before = structuredClone(S.answers);
  S.contractSnap = (cPart && cPart.snapshot) || null;
  S.contractSigned = !!r.contract_signed_at;
  S.signedAt = r.contract_signed_at;
  S.contractHash = r.contract_hash;
  S.dek = dek; S.verifier = verifier; S.version = r.version;
  S.mode = 'view';
  showView();
}

/* ─── vista dell'invio (dopo la password) ─── */
function summary(answers, { editable = false } = {}) {
  const out = h('div');
  S.form.sections.forEach((s, si) => {
    const fields = s.fields.filter(f => !isStatic(f));
    if (!fields.length) return;
    const stepIdx = S.steps.findIndex(x => x.kind === 'section' && x.section.id === s.id);
    out.append(h('div.f-sum-sec',
      h('div.f-sum-head', h('h3', s.title || tr(`Parte ${si + 1}`, `Part ${si + 1}`)),
        editable && stepIdx >= 0 && !(s.contract && S.contractSigned) ? h('button.f-link', { type: 'button', onclick: () => go(stepIdx) }, icon('edit', 15), tr('Modifica', 'Edit')) : null,
        s.contract && S.contractSigned ? h('span.f-lock', icon('lock', 13), tr('Firmato', 'Signed')) : null),
      h('dl', fields.map(f => { const v = formatValue(f, answers[f.id]); return h('div.f-sum-row', h('dt', f.label), h('dd' + (v ? '' : '.empty'), v || '—')); }))));
  });
  return out;
}
function copyButtons() {
  const pdf = h('button.f-btn.ghost.small', { type: 'button', onclick: () => doPdf(pdf) }, icon('download', 17), tr('Scarica copia PDF', 'Download PDF copy'));
  const mail = S.emailOn ? h('button.f-btn.ghost.small', { type: 'button', onclick: () => askMail() }, icon('mail', 17), tr('Mandamela via email', 'Email it to me')) : null;
  return [pdf, mail];
}
function showView() {
  S.steps = buildSteps();
  const editBtn = S.release.closed ? null : h('button.f-btn', { type: 'button', onclick: () => { S.mode = 'edit'; startWizard(0); } }, icon('edit', 18), tr('Modifica', 'Edit'));
  screen(
    S.release.closed ? h('div.f-banner', icon('lock', 18), h('span', tr('La release è chiusa: puoi rivedere il tuo invio ma non modificarlo.', 'The release is closed: you can review your submission but not change it.'))) : null,
    h('section.f-card', h('h2.f-stitle', tr('Il tuo invio', 'Your submission')), h('p.f-note', tr('Versione ', 'Version ') + S.version + (S.invite.updated_at ? tr(' · ultima modifica ', ' · last changed ') + fmtDateTime(S.invite.updated_at) : '')), summary(S.answers),
      h('div.f-actions', copyButtons(), h('span.f-spacer'), editBtn)),
    S.contractSnap ? h('section.f-card', h('h2.f-stitle', tr('Contratto firmato', 'Signed contract')), contractDoc(S.contractSnap, { label: S.label, signedAt: S.signedAt, hash: S.contractHash })) : null,
    hasContract(S.form) && !S.contractSigned && !S.release.closed ? h('div.f-banner.warn', icon('pen', 18), h('span', tr('Il contratto non è ancora firmato: tocca "Modifica" per firmarlo.', 'The contract is not signed yet: tap "Edit" to sign it.'))) : null);
}

/* ─── procedura a passi ─── */
function buildSteps() {
  const st = [];
  for (const s of S.form.sections) if (s.fields.length) st.push({ kind: 'section', section: s });
  if (hasContract(S.form) && !S.contractSigned) st.push({ kind: 'contract' });
  st.push({ kind: 'final' });
  return st;
}
function startWizard(step) { S.steps = buildSteps(); S.errors = {}; go(step); }
function go(i) {
  S.step = Math.max(0, Math.min(S.steps.length - 1, i));
  renderStep();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function progress() {
  const st = S.steps[S.step];
  if (!shown(S.form, 'progress')) return null;
  const name = st.kind === 'section' ? (st.section.title || tr(`Parte ${S.step + 1}`, `Part ${S.step + 1}`)) : st.kind === 'contract' ? tr('Contratto', 'Contract') : (S.mode === 'edit' ? tr('Salva', 'Save') : tr('Invio', 'Submit'));
  const pct = Math.round(((S.step + 1) / S.steps.length) * 100);
  return h('div.f-progress', h('div.f-progress-row', h('span', tx('step', { n: S.step + 1, tot: S.steps.length })), h('span', name)), h('div.f-bar', h('i', { style: { width: pct + '%' } })));
}
function nav({ next = tx('next'), onNext, back = true }) {
  return h('div.f-actions',
    back && S.step > 0 ? h('button.f-btn.ghost', { type: 'button', onclick: () => go(S.step - 1) }, icon('back', 18), tx('back'))
      : S.mode === 'edit' ? h('button.f-btn.ghost', { type: 'button', onclick: () => { if (dirty() && !confirm(tr('Uscire senza salvare le modifiche?', 'Leave without saving your changes?'))) return; S.answers = structuredClone(S.before); S.signature = null; S.mode = 'view'; showView(); } }, tr('Annulla', 'Cancel')) : h('span'),
    h('button.f-btn', { type: 'button', onclick: onNext }, next, icon('arrowR', 18)));
}
const dirty = () => S.mode === 'edit' && changedIds(S.form, S.before, S.answers).length > 0;

function renderStep() {
  const st = S.steps[S.step];
  if (st.kind === 'section') return renderSection(st.section);
  if (st.kind === 'contract') return renderContract();
  return renderFinal();
}

function renderSection(section) {
  const locked = section.contract && S.contractSigned;
  const ctx = { errors: S.errors, live: true, showRequired: shown(S.form, 'required'), shareWith: S.label.share_with || S.form.shareWith, onChange: () => { saveDraft(); if (section.contract && S.signature) invalidateSignatureIfChanged(); }, lockContract: S.contractSigned };
  const card = sectionBlock(section, S.answers, ctx);
  const draftInfo = S.mode === 'new' && !PREVIEW && shown(S.form, 'draft') ? h('div.f-draft', h('span', tr('La bozza si salva da sola su questo dispositivo (tranne i dati bancari e fiscali).', 'Your draft is saved automatically on this device (except bank and tax details).')),
    h('button.f-link', { type: 'button', onclick: () => { if (confirm(tr('Cancellare tutto quello che hai scritto?', 'Delete everything you wrote?'))) { dropDraft(); S.answers = {}; S.signature = null; renderStep(); } } }, tr('Ricomincia', 'Start over'))) : null;
  screen(progress(), S.step === 0 ? draftInfo : null,
    locked ? h('div.f-banner', icon('lock', 18), h('span', tr('Questi dati sono nel contratto che hai firmato: non si possono più modificare.', 'These details are in the contract you signed: they can no longer be changed.'))) : null,
    card,
    nav({ onNext: () => {
      if (!locked && !PREVIEW) {
        const errs = sectionProblems(section, S.answers);
        if (Object.keys(errs).length) { S.errors = errs; renderStep(); focusFirstError(main); toast(tr('Controlla i campi segnati in rosso', 'Check the fields marked in red')); return; }
      }
      S.errors = {};
      go(S.step + 1);
    } }));
}

/* ─── contratto ─── */
function contractKey() { return C.canonical(splitAnswers(S.form, S.answers).contract); }
function invalidateSignatureIfChanged() {
  if (S.signature && S.signedFor !== contractKey()) { S.signature = null; toast(tr('Hai cambiato dei dati del contratto: dovrai firmarlo di nuovo.', 'You changed some contract details: you will need to sign it again.')); }
}
function provisionalSnapshot(signature) {
  return contractSnapshot({ form: S.form, answers: S.answers, ctx: ctxContract(), inviteId: S.invite.id, labelSignature: S.form.contract.labelSigns ? (S.label.signature || '') : '',
    signature: signature || { name: '', place: '', date: todayYmd(), time: '', png: '' } });
}
function renderContract() {
  const bad = {};
  for (const s of S.form.sections) if (s.contract) Object.assign(bad, sectionProblems(s, S.answers));
  if (Object.keys(bad).length) {
    const idx = S.steps.findIndex(x => x.kind === 'section' && x.section.contract);
    screen(progress(), message({ ic: 'alert', title: tr('Mancano dei dati', 'Some details are missing'), text: tr('Prima di firmare completa i dati per il contratto.', 'Before signing, complete the contract details.'), actions: [h('button.f-btn', { type: 'button', onclick: () => { S.errors = bad; go(idx); } }, tr('Completa i dati', 'Complete the details'))] }));
    return;
  }
  const c = S.form.contract;
  const nameField = S.form.sections.filter(s => s.contract).flatMap(s => s.fields).find(f => f.type === 'short');
  const signed = S.signature && S.signedFor === contractKey();
  const doc = contractDoc(provisionalSnapshot(signed ? S.signature : null), { label: S.label });

  const name = h('input.f-input', { type: 'text', maxlength: 120, value: (S.signature && S.signature.name) || (nameField ? S.answers[nameField.id] || '' : '') || S.invite.artist || '', autocomplete: 'name' });
  const place = h('input.f-input', { type: 'text', maxlength: 120, placeholder: tr('Es. Milano', 'E.g. London'), value: (S.signature && S.signature.place) || '' });
  const canvas = h('canvas', { 'aria-label': tr('Riquadro per la firma', 'Signature box') });
  const fileMsg = h('p.f-note');
  const accept = h('input', { type: 'checkbox', checked: !!signed });
  const err = h('div.f-err', { role: 'alert' });
  let pad = null;
  const sign = () => {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = tr('Scrivi nome e cognome.', 'Enter your full name.'); return; }
    if (!pad || pad.isEmpty()) { err.textContent = tr('Firma nel riquadro (con il dito, il mouse o la penna) oppure carica una foto della tua firma.', 'Sign in the box (with your finger, mouse or pen) or upload a photo of your signature.'); return; }
    if (!accept.checked) { err.textContent = tr('Spunta la casella per accettare il contratto.', 'Tick the box to accept the contract.'); return; }
    const now = new Date();
    S.signature = { name: name.value.trim().slice(0, 120), place: place.value.trim().slice(0, 120), png: pad.png(), date: todayYmd(), time: now.toTimeString().slice(0, 5) };
    S.signedFor = contractKey();
    S.skipSign = false;
    toast(tr('Firma pronta ✓ Il contratto si registra quando invii.', 'Signature ready ✓ The contract is recorded when you submit.'));
    go(S.step + 1);
  };
  const panel = h('section.f-card',
    h('h2.f-stitle', signed ? tr('Firma pronta', 'Signature ready') : tx('signTitle')),
    h('div.f-fields',
      h('div.f-field.half', h('label.f-q', tr('Nome e cognome', 'Full name')), name),
      h('div.f-field.half', h('label.f-q', tr('Luogo', 'Place')), place),
      h('div.f-field', h('label.f-q', tr('La tua firma', 'Your signature')), h('p.f-help', tr('Disegna con il dito, il mouse o la penna. Oppure carica una foto della firma su un foglio bianco.', 'Draw with your finger, mouse or pen. Or upload a photo of your signature on white paper.')),
        h('div.f-sigpad', canvas),
        h('div.f-sigtools',
          h('button.f-btn.ghost.small', { type: 'button', onclick: () => { pad && pad.clear(); fileMsg.textContent = ''; } }, icon('x', 16), tr('Cancella', 'Clear')),
          h('button.f-btn.ghost.small', { type: 'button', onclick: () => fileIn.click() }, icon('image', 16), tr('Carica da foto', 'Upload a photo'))),
        fileMsg),
      h('div.f-field', h('label.f-check', accept, h('span', c.accept)))),
    err,
    h('div.f-actions',
      h('button.f-btn.ghost', { type: 'button', onclick: () => go(S.step - 1) }, icon('back', 18), tx('back')),
      !c.required || PREVIEW ? h('button.f-link', { type: 'button', onclick: () => { S.signature = null; S.skipSign = true; go(S.step + 1); } }, PREVIEW ? tr('Salta (anteprima)', 'Skip (preview)') : tr('Firma più tardi', 'Sign later')) : null,
      h('button.f-btn', { type: 'button', onclick: sign }, icon('pen', 18), tx('signBtn'))));
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !pad) return;
    try { await pad.loadFile(f); fileMsg.textContent = tr('Firma caricata ✓ Controlla l\'anteprima.', 'Signature uploaded ✓ Check the preview.'); }
    catch (x) { fileMsg.textContent = x.message === 'too_big' ? tr('Immagine troppo grande (massimo 15 MB).', 'Image too large (15 MB max).') : x.message === 'empty_image' ? tr('Non vedo una firma: prova con una foto più nitida su sfondo chiaro.', 'No signature found: try a sharper photo on a light background.') : tr('Scegli un\'immagine (PNG o JPG).', 'Choose an image (PNG or JPG).'); }
  } });
  screen(progress(), h('section.f-card', h('h2.f-stitle', tx('contractTitle')), tx('contractNote') ? h('p.f-note', tx('contractNote')) : null, doc), panel, fileIn);
  requestAnimationFrame(() => {
    pad = attachSignature(canvas);
    if (signed && S.signature.png) {
      const img = new Image();
      img.onload = () => { const ctx = canvas.getContext('2d'); const W = canvas.width / 2, H = canvas.height / 2; const k = Math.min(1, (W - 16) / img.width, (H - 16) / img.height); ctx.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k); };
      img.src = S.signature.png;
      // la firma già pronta resta valida finché non si cancella
      const orig = pad.isEmpty; pad.isEmpty = () => orig() && !(S.signature && S.signature.png);
      const origPng = pad.png; pad.png = () => (orig() ? S.signature.png : origPng());
      const origClear = pad.clear; pad.clear = () => { origClear(); S.signature = null; pad.isEmpty = orig; pad.png = origPng; };
    }
  });
}

/* ─── ultimo passo: riepilogo, password, copie, invio ─── */
function firstEmail() {
  for (const s of S.form.sections) for (const f of s.fields) if (f.type === 'email' && S.answers[f.id]) return S.answers[f.id];
  return '';
}
function renderFinal() {
  invalidateSignatureIfChanged();
  if (!S.mailTo) S.mailTo = firstEmail();
  const needSign = hasContract(S.form) && !S.contractSigned;
  const signedNow = S.signature && S.signedFor === contractKey();
  const isNew = S.mode === 'new';

  const contractLine = !hasContract(S.form) ? null : S.contractSigned ? h('div.f-banner', icon('lock', 18), h('span', tr('Contratto già firmato.', 'Contract already signed.')))
    : signedNow ? h('div.f-banner', icon('checkCircle', 18), h('span', tr(`Contratto firmato da ${S.signature.name}: si registra quando ${isNew ? 'invii' : 'salvi'}.`, `Contract signed by ${S.signature.name}: it is recorded when you ${isNew ? 'submit' : 'save'}.`)))
    : h('div.f-banner.warn', icon('pen', 18), h('span', S.form.contract.required ? tr('Manca la firma del contratto.', 'The contract still needs your signature.') : tr('Il contratto non è firmato: potrai firmarlo più tardi con la tua password.', 'The contract is not signed: you can sign it later with your password.')),
      h('button.f-link', { type: 'button', onclick: () => go(S.steps.findIndex(x => x.kind === 'contract')) }, tr('Firma ora', 'Sign now')));

  // password
  const pw = h('input.f-input', { type: 'password', autocomplete: 'new-password', placeholder: tr('Almeno 10 caratteri', 'At least 10 characters'), value: S.pw, oninput: e => { S.pw = e.target.value; meter(); } });
  const pw2 = h('input.f-input', { type: 'password', autocomplete: 'new-password', placeholder: tr('Ripeti la password', 'Repeat the password'), value: S.pw2, oninput: e => { S.pw2 = e.target.value; } });
  const meterEl = h('div.f-meter', h('div.f-bar', h('i')), h('span'));
  const meter = () => { const s = C.passwordStrength(S.pw); meterEl.dataset.s = s.score; meterEl.querySelector('i').style.width = (s.score * 25) + '%'; meterEl.querySelector('span').textContent = s.label; };
  const pwSub = h('div.f-sub', pw, pw2, meterEl, h('p.f-note', tr('Scrivila da qualche parte: non la conosciamo nemmeno noi e non si può recuperare. Se la perdi, i tuoi dati restano comunque al sicuro presso l\'etichetta.', 'Write it down somewhere: not even we know it, and it cannot be recovered. If you lose it, your data stays safe with the label anyway.')));
  pwSub.hidden = !S.wantPw;
  const pwBox = isNew ? h('div.f-choice',
    h('label.f-check', h('input', { type: 'checkbox', checked: S.wantPw, onchange: e => { S.wantPw = e.target.checked; pwSub.hidden = !S.wantPw; } }),
      h('span', tr('Voglio poter rivedere e modificare quello che invio (consigliato)', 'I want to be able to review and change what I send (recommended)'))),
    pwSub,
    h('p.f-note', tr('Senza password il tuo invio resta al sicuro, ma non potrai più vederlo né cambiarlo: dovrai scrivere all\'etichetta.', 'Without a password your submission stays safe, but you won\'t be able to see or change it: you\'ll have to write to the label.'))) : null;

  // copie
  const mailIn = h('input.f-input', { type: 'email', value: S.mailTo, placeholder: tr('La tua email', 'Your email'), oninput: e => { S.mailTo = e.target.value.trim(); } });
  const mailSub = h('div.f-sub', mailIn, h('p.f-note', tr('Nell\'email i dati riservati (IBAN, codice fiscale…) sono nascosti.', 'In the email, private details (IBAN, tax ID…) are hidden.')));
  mailSub.hidden = !S.wantMail;
  const copyBox = h('div.f-choice',
    h('p.f-q', icon('copy', 17), tr('Vuoi una copia per te?', 'Do you want a copy?')),
    h('label.f-check', h('input', { type: 'checkbox', checked: S.wantPdf, onchange: e => { S.wantPdf = e.target.checked; } }), h('span', tr('Scarica una copia in PDF', 'Download a PDF copy'))),
    S.emailOn ? h('label.f-check', h('input', { type: 'checkbox', checked: S.wantMail, onchange: e => { S.wantMail = e.target.checked; mailSub.hidden = !S.wantMail; } }), h('span', tr('Mandamela via email', 'Email it to me'))) : null,
    S.emailOn ? mailSub : null);

  const err = h('div.f-err', { role: 'alert' });
  const send = h('button.f-btn', { type: 'button', onclick: () => PREVIEW ? toast(tr('Anteprima: qui l\'artista invia. Nell\'anteprima non parte niente.', 'Preview: here the artist submits. Nothing is sent from the preview.')) : submit(send, err) }, icon('send', 18), isNew ? tx('send') : tx('saveEdit'));
  screen(progress(),
    h('section.f-card', h('h2.f-stitle', isNew ? tx('reviewTitle') : tr('Controlla le modifiche', 'Review your changes')), contractLine, summary(S.answers, { editable: true })),
    h('section.f-card', pwBox, copyBox, err,
      h('div.f-actions', h('button.f-btn.ghost', { type: 'button', onclick: () => go(S.step - 1) }, icon('back', 18), tx('back')), send)),
    PREVIEW ? h('div.f-banner', icon('eye', 18), h('span', tr('Anteprima: dopo l\'invio l\'artista vede questo messaggio.', 'Preview: after submitting, the artist sees this message.')), h('button.f-link', { type: 'button', onclick: () => showDone(true) }, tr('Mostra', 'Show'))) : null);
  meter();
  if (needSign && S.form.contract.required && !signedNow) send.title = tr('Prima firma il contratto', 'Sign the contract first');
}

async function submit(btn, err) {
  if (S.busy) return;
  err.textContent = '';
  const isNew = S.mode === 'new';
  // 1. tutto compilato?
  const probs = formProblems(S.form, S.answers, { skipContract: S.contractSigned });
  if (Object.keys(probs).length) {
    const first = Object.keys(probs)[0].split('.')[0];
    const idx = S.steps.findIndex(x => x.kind === 'section' && x.section.fields.some(f => f.id === first));
    S.errors = probs;
    toast(tr('Manca qualcosa: controlla i campi segnati in rosso', 'Something is missing: check the fields marked in red'));
    go(idx >= 0 ? idx : 0);
    setTimeout(() => focusFirstError(main), 60);
    return;
  }
  invalidateSignatureIfChanged();
  const signedNow = S.signature && S.signedFor === contractKey();
  if (hasContract(S.form) && !S.contractSigned && S.form.contract.required && !signedNow) { toast(tr('Prima firma il contratto', 'Sign the contract first')); go(S.steps.findIndex(x => x.kind === 'contract')); return; }
  if (isNew && S.wantPw) {
    const p = C.passwordProblem(S.pw);
    if (p) { err.textContent = 'Password: ' + p; return; }
    if (S.pw !== S.pw2) { err.textContent = tr('Le due password non sono uguali.', 'The two passwords don\'t match.'); return; }
  }
  if (isNew && !S.wantPw && hasContract(S.form) && !signedNow) { err.textContent = tr('Per firmare più tardi serve una password (altrimenti non potresti più riaprire l\'invio).', 'To sign later you need a password (otherwise you couldn\'t reopen your submission).'); return; }
  if (S.wantMail && S.emailOn && !EMAIL_RE.test(S.mailTo)) { err.textContent = tr('Controlla l\'email per la copia.', 'Check the email for the copy.'); return; }
  if (!isNew && !dirty() && !signedNow) { toast(tr('Non hai cambiato niente', 'You didn\'t change anything')); S.mode = 'view'; showView(); return; }

  S.busy = true;
  btn.disabled = true;
  clear(btn).append(h('span.f-spinner', { style: { width: '18px', height: '18px', borderWidth: '2px', margin: '0' } }), isNew ? tr('Cifro e invio…', 'Encrypting and sending…') : tr('Cifro e salvo…', 'Encrypting and saving…'));
  try {
    const parts = splitAnswers(S.form, S.answers);
    const filled = filledIds(S.form, S.answers);
    const snap = signedNow ? provisionalSnapshot(S.signature) : null;
    let dek, payload;
    if (isNew) {
      const pub = await C.importLabelPublic(S.label.pub);
      const dk = await C.newDataKey();
      dek = dk.key;
      payload = { dek_label: await C.wrapDataKeyForLabel(pub, dk.raw), filled };
      if (S.wantPw) {
        const salt = C.newSalt();
        const { kek, verifier } = await C.artistSecret(S.pw, salt);
        payload.password = { salt, iter: C.PBKDF2_ITER, verifier, dek: await C.wrapDataKeyForArtist(kek, dk.raw) };
        S.verifier = verifier;
      }
      dk.raw.fill(0);
    } else {
      dek = S.dek;
      payload = { base_version: S.version, filled, changed: changedIds(S.form, S.before, S.answers) };
    }
    payload.main = await C.sealJson(dek, { v: 1, answers: parts.main }, C.partAad('main', S.invite.id));
    if (hasContractPart() && !S.contractSigned) {
      const part = { v: 1, answers: parts.contract, snapshot: snap };
      payload.contract = { ct: await C.sealJson(dek, part, C.partAad('contract', S.invite.id)), sign: !!snap };
      if (snap) payload.contract.hash = await contractHash(snap);
    }
    let r;
    try { r = isNew ? await api.submit(token, payload) : await api.update(token, S.verifier, payload); }
    catch { throw new Error(ERR.network); }
    if (!r || r.error) throw new Error(errText(r));

    // fatto
    if (isNew) dropDraft();
    api.mailFlush();
    S.dek = dek;
    S.version = r.version;
    S.before = structuredClone(S.answers);
    S.invite.has_password = S.invite.has_password || !!payload.password;
    S.invite.submitted_at = S.invite.submitted_at || r.submitted_at;
    S.invite.updated_at = r.updated_at || r.submitted_at;
    if (snap) { S.contractSigned = true; S.contractSnap = snap; S.signedAt = r.contract_signed_at; S.contractHash = payload.contract.hash; }
    S.signature = null;
    S.busy = false;
    showDone(isNew);
  } catch (e) {
    S.busy = false;
    btn.disabled = false;
    clear(btn).append(icon('send', 18), isNew ? tx('send') : tx('saveEdit'));
    err.textContent = e.message || tr('Qualcosa non ha funzionato. Riprova.', 'Something went wrong. Please try again.');
  }
}

function showDone(isNew) {
  if (PREVIEW) {
    screen(h('div.f-card.f-msg', h('div.f-bigicon.ok', icon('checkCircle', 30)), h('h2', tx('doneTitle')),
      !isEmptyRich(S.form.done) ? richBlock(S.form.done, {}, 'f-intro') : h('p', tr(`${labelName()} ha ricevuto tutto.`, `${labelName()} received everything.`)),
      h('div.f-actions', h('button.f-btn.ghost.small', { type: 'button', onclick: () => go(0) }, icon('back', 17), tr('Torna all\'inizio', 'Back to the start')))));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const canEdit = !!S.invite.has_password;
  const actions = [...copyButtons()];
  if (canEdit && !S.release.closed) actions.push(h('button.f-btn.ghost.small', { type: 'button', onclick: () => { S.mode = 'view'; showView(); } }, icon('eye', 17), tr('Rivedi il tuo invio', 'Review your submission')));
  screen(h('div.f-card.f-msg',
    h('div.f-bigicon.ok', icon('checkCircle', 30)),
    h('h2', isNew ? tx('doneTitle') : tr('Modifiche salvate', 'Changes saved')),
    isNew && !isEmptyRich(S.form.done) ? richBlock(S.form.done, {}, 'f-intro') : h('p', isNew ? tr(`${labelName()} ha ricevuto tutto.`, `${labelName()} received everything.`) : tr(`${labelName()} riceve un avviso con quello che hai cambiato.`, `${labelName()} gets a notice with what you changed.`)),
    canEdit ? h('p', tr('Per rivedere o modificare usa lo stesso link e la tua password.', 'To review or change it, use the same link and your password.')) : h('p', tr('Hai scelto di non mettere una password: per cambiare qualcosa scrivi all\'etichetta.', 'You chose not to set a password: to change something, write to the label.')),
    h('div.f-actions', actions)));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (S.wantPdf) { S.wantPdf = false; doPdf(null); }
  if (S.wantMail && S.emailOn) { S.wantMail = false; sendMail(S.mailTo); }
}

/* ─── copie ─── */
async function doPdf(btn) {
  if (btn) btn.disabled = true;
  toast(tr('Preparo il PDF…', 'Preparing the PDF…'));
  try {
    const doc = copyDocument({ form: S.form, answers: S.answers, label: S.label, release: S.release, artist: S.invite.artist, when: S.invite.updated_at || new Date().toISOString(), version: S.version,
      contract: S.contractSnap ? { snap: S.contractSnap, signedAt: S.signedAt, hash: S.contractHash } : null });
    await savePdf(doc, pdfName(S.release.title, S.invite.artist, tr('copia', 'copy')));
  } catch (e) { toast(e.message || tr('PDF non riuscito', 'PDF failed')); }
  if (btn) btn.disabled = false;
}
function askMail() {
  const to = prompt(tr('A quale email mando la copia?', 'Which email should I send the copy to?'), S.mailTo || firstEmail());
  if (to === null) return;
  if (!EMAIL_RE.test(to.trim())) { toast(tr('Email non valida', 'Invalid email')); return; }
  S.mailTo = to.trim();
  sendMail(S.mailTo);
}
async function sendMail(to) {
  const rows = summaryRows(S.form, S.answers, { mask: true, skipEmpty: true }).map(r => ({ s: r.section, l: r.label, v: r.value }));
  const r = await api.mailCopy({ token, verifier: S.verifier, to, title: S.form.title, rows, lang: S.form.lang }).catch(() => null);
  if (r && r.ok) toast(tr(`Copia mandata a ${to} ✓`, `Copy sent to ${to} ✓`));
  else toast(r && r.error === 'too_many' ? tr('Hai già chiesto troppe copie oggi.', 'You already asked for too many copies today.') : tr('Email non partita. Puoi scaricare il PDF.', 'The email was not sent. You can download the PDF.'));
}

/* ─── anteprima dell'etichetta (anteprima.html#p=…) ───
   Mostra il modulo esattamente come lo vede l'artista, con dati d'esempio, e si aggiorna da solo
   quando l'etichetta lo modifica (controllo ogni pochi secondi + aggiornamento immediato se il
   costruttore è aperto in un'altra finestra dello stesso browser). Non si può inviare niente. */
let pvSince = null, pvTimer = null, pvPending = null, pvBusy = false, pvLast = null;
const PV_ZOOM_KEY = 'labelform-pv-zoom';
let pvZoom = (() => { try { return Math.min(2, Math.max(0.5, Number(localStorage.getItem(PV_ZOOM_KEY)) || 1)); } catch { return 1; } })();
function setZoom(z) {
  pvZoom = Math.round(Math.min(2, Math.max(0.5, z)) * 10) / 10;
  root.style.zoom = String(pvZoom);
  const lab = document.querySelector('.pv-zoom-v'); if (lab) lab.textContent = Math.round(pvZoom * 100) + '%';
  try { localStorage.setItem(PV_ZOOM_KEY, String(pvZoom)); } catch { /* */ }
}
function previewBar() {
  return h('div.f-banner.pv-bar', h('span.pv-dot'), h('span', h('b', 'Anteprima'), ' · si aggiorna da sola quando modifichi il modulo. Qui non si invia niente.'),
    h('span.pv-when', pvLast ? 'Aggiornata alle ' + pvLast.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''));
}
function zoomBar() {
  const b = (ic, title, fn) => h('button.pv-zb', { type: 'button', title, 'aria-label': title, onclick: fn }, icon(ic, 18));
  return h('div.pv-zoom', b('zoomOut', 'Rimpicciolisci', () => setZoom(pvZoom - 0.1)), h('button.pv-zoom-v', { type: 'button', title: 'Dimensione normale', onclick: () => setZoom(1) }, Math.round(pvZoom * 100) + '%'), b('zoomIn', 'Ingrandisci', () => setZoom(pvZoom + 0.1)));
}
function applyPreview(r) {
  S.form = sanitizeForm(r.form);
  setLang(S.form.lang);
  document.documentElement.lang = S.form.lang;
  S.label = r.label || {};
  pvLast = new Date();
  document.title = `Anteprima — ${S.form.title}`;
  const theme = applyTheme(document.body, S.form.theme);
  document.documentElement.style.backgroundColor = theme.bg;
  const y = window.scrollY;
  const keep = S.step;
  frame();
  S.steps = buildSteps();
  S.step = Math.max(0, Math.min(S.steps.length - 1, keep));
  renderStep();
  window.scrollTo(0, y);
}
async function pollPreview() {
  if (pvBusy || document.visibilityState !== 'visible') return;
  pvBusy = true;
  try {
    const r = await api.preview(token, pvSince);
    if (r && !r.error && !r.same) {
      pvSince = r.updated_at;
      if (document.activeElement && document.activeElement.matches('input, textarea, select, [contenteditable]')) pvPending = r;
      else applyPreview(r);
    } else if (r && r.error) { clearInterval(pvTimer); fatal('Anteprima non disponibile', 'Questo link di anteprima non è più attivo: creane uno nuovo dal costruttore del modulo.'); }
  } catch { /* rete assente: riprova al prossimo giro */ }
  pvBusy = false;
}
async function bootPreview() {
  try { api = demo ? (await import('../api/demo.js')).artistApi : (await import('../api/supabase.js')).artistApi; }
  catch { fatal('Connessione non riuscita', ERR.network, true); return; }
  let r;
  try { r = await api.preview(token, null); } catch { fatal('Connessione non riuscita', ERR.network, true); return; }
  if (!r || r.error) { fatal('Anteprima non disponibile', 'Questo link di anteprima non è attivo: creane uno nuovo dal costruttore del modulo.'); return; }
  pvSince = r.updated_at;
  S.mode = 'new';
  setLang(sanitizeForm(r.form).lang);
  S.invite = { id: 'anteprima', artist: tr('Nome artista', 'Artist name'), artist_pct: 50, version: 0 };
  S.release = { title: tr('Esempio EP', 'Example EP'), catalog: 'CAT001' };
  document.body.classList.add('fx', 'pv');
  document.body.append(zoomBar());
  setZoom(pvZoom);
  applyPreview(r);
  pvTimer = setInterval(pollPreview, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollPreview(); });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (pvPending && !(document.activeElement && document.activeElement.matches('input, textarea, select, [contenteditable]'))) { const x = pvPending; pvPending = null; applyPreview(x); }
  }, 50));
  // aggiornamento immediato dal costruttore aperto nello stesso browser
  const mine = (await C.sha256hex(token)).slice(0, 16);
  try {
    const ch = new BroadcastChannel('labelform-preview');
    ch.onmessage = e => {
      const m = e.data;
      if (!m || m.k !== mine || !m.form) return;
      const x = { form: m.form, label: m.label || S.label, updated_at: pvSince };
      if (document.activeElement && document.activeElement.matches('input, textarea, select, [contenteditable]')) pvPending = x; else applyPreview(x);
    };
  } catch { /* browser senza BroadcastChannel: basta il controllo periodico */ }
}

boot();
