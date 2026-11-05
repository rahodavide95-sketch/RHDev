/* Pagina dell'artista (invio.html#k=…): compila il modulo dell'etichetta, firma il contratto,
   invia tutto cifrato e, se ha scelto una password, può tornare a vedere e modificare. */

import { h, icon, clear, append, fmtDateTime, todayYmd, guardFrame, debounce } from '../ui/dom.js';
import { applyTheme, formHeader, sectionBlock, focusFirstError } from '../ui/form-view.js';
import { richBlock } from '../ui/rich.js';
import { attachSignature } from '../ui/signature.js';
import { contractDoc, copyDocument, savePdf, pdfName } from '../ui/pdf.js';
import { sanitizeForm, hasContract, SENSITIVE_TYPES } from '../core/schema.js';
import * as C from '../core/crypto.js';
import { sectionProblems, formProblems, splitAnswers, filledIds, changedIds, summaryRows, formatValue, EMAIL_RE } from '../core/answers.js';
import { contractSnapshot, contractHash } from '../core/contract.js';
import { isEmptyRich } from '../core/richtext.js';

guardFrame();
const root = document.getElementById('app');
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('k') || '';
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
const ERR = {
  not_found: 'Link non valido. Controlla di averlo copiato tutto, oppure chiedi all\'etichetta un link nuovo.',
  revoked: 'Questo link non è più attivo. Chiedi all\'etichetta quello nuovo.',
  expired: 'Questo link è scaduto. Chiedi all\'etichetta di rinnovarlo.',
  not_ready: 'Il modulo non è ancora pronto. Riprova più tardi.',
  closed: 'La raccolta per questa release è chiusa: per cambiare qualcosa scrivi all\'etichetta.',
  already_submitted: 'Risulta già un invio con questo link. Ricarica la pagina.',
  conflict: 'Il tuo invio è stato cambiato da un\'altra finestra o da un altro dispositivo. Ricarica la pagina e riprova.',
  contract_locked: 'Il contratto è già firmato e non si può più modificare.',
  invalid: 'Qualcosa nei dati non va. Ricarica la pagina e riprova.',
  network: 'Connessione non riuscita. Controlla internet e riprova.',
  no_password: 'Questo invio non ha una password: per vederlo o modificarlo scrivi all\'etichetta.',
  too_many_versions: 'Hai raggiunto il numero massimo di modifiche: scrivi all\'etichetta.',
};
function errText(r) {
  if (!r) return ERR.network;
  if (r.error === 'wrong_password') return r.left > 0 ? `Password sbagliata. Ancora ${r.left} ${r.left === 1 ? 'tentativo' : 'tentativi'}, poi dovrai aspettare 15 minuti.` : 'Password sbagliata. Troppi tentativi: riprova tra 15 minuti.';
  if (r.error === 'locked') return `Troppi tentativi sbagliati: riprova dopo le ${new Date(r.retry_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`;
  return ERR[r.error] || ERR[r.code] || 'Qualcosa non ha funzionato. Riprova tra poco.';
}
const labelName = () => S.label.name || 'l\'etichetta';
const ctxContract = () => ({ label: S.label.name, release: S.release.title, catalog: S.release.catalog, artist: S.invite.artist, artistPct: S.invite.artist_pct });
const hasContractPart = () => S.form.sections.some(s => s.contract) || hasContract(S.form);

/* ─── struttura della pagina ─── */
const wrap = h('div.f-wrap');
const main = h('main#main');
function frame() {
  clear(root).append(wrap);
  clear(wrap);
  if (demo) wrap.append(h('div.f-banner.warn', icon('info', 18), h('span', 'Modalità prova: questo invio resta solo in questo browser, non arriva a nessuno.')));
  wrap.append(formHeader({ form: S.form, label: S.label, release: S.release, artist: S.invite.artist }), main,
    h('p.f-foot', icon('lock', 14), h('span', `I tuoi dati vengono cifrati in questo browser prima di partire: li può leggere solo ${labelName()}${S.wantPw ? ' (e tu, con la tua password)' : ''}.`)));
}
function screen(...kids) { clear(main); append(main, kids); }
function message({ ic = 'info', tone = '', title, text, actions = [] }) {
  return h('div.f-card.f-msg', h('div.f-bigicon' + (tone ? '.' + tone : ''), icon(ic, 30)), h('h2', title), text ? h('p', text) : null, actions.length ? h('div.f-actions', actions) : null);
}
function fatal(title, text, retry = false) {
  document.title = 'Consegne';
  clear(root);
  const w = h('div.f-wrap');
  w.append(message({ ic: 'alert', tone: 'bad', title, text, actions: retry ? [h('button.f-btn', { type: 'button', onclick: () => location.reload() }, icon('refresh', 18), 'Riprova')] : [] }));
  root.append(w);
}

/* ─── bozza sul dispositivo (mai i dati riservati) ─── */
function draftable(answers) {
  const out = {};
  for (const s of S.form.sections) for (const f of s.fields) {
    if (f.type === 'info' || f.sensitive || SENSITIVE_TYPES.includes(f.type)) continue;
    let v = answers[f.id];
    if (f.type === 'group' && Array.isArray(v)) v = v.map(item => Object.fromEntries(Object.entries(item || {}).filter(([k]) => { const sf = f.fields.find(x => x.id === k); return sf && !sf.sensitive && !SENSITIVE_TYPES.includes(sf.type); })));
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}
const saveDraft = debounce(() => {
  if (S.mode !== 'new' || !S.draftKey) return;
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
  if (!C.isTokenShape(token)) { fatal('Link non valido', ERR.not_found); return; }
  try {
    api = demo ? (await import('../api/demo.js')).artistApi : (await import('../api/supabase.js')).artistApi;
  } catch { fatal('Connessione non riuscita', ERR.network, true); return; }
  let r;
  try { r = await api.open(token); } catch (e) { fatal('Connessione non riuscita', ERR.network, true); return; }
  if (!r || r.error) { fatal(r && r.error === 'not_ready' ? 'Quasi pronto' : 'Link non valido', errText(r), r && r.error === 'not_ready'); return; }
  S.data = r;
  S.form = sanitizeForm(r.form);
  S.label = r.label || {};
  S.release = r.release || {};
  S.invite = r.invite || {};
  S.version = S.invite.version || 0;
  S.contractSigned = !!S.invite.contract_signed_at;
  S.signedAt = S.invite.contract_signed_at;
  S.draftKey = 'consegne-draft:' + (await C.sha256hex(token)).slice(0, 24);
  document.title = `${S.form.title}${S.label.name ? ' — ' + S.label.name : ''}`;
  const theme = applyTheme(document.body, S.form.theme);
  document.documentElement.style.backgroundColor = theme.bg;
  document.body.classList.add('fx');
  api.mailPing().then(on => { S.emailOn = on; }).catch(() => {});
  frame();
  if (S.version > 0) { showLocked(); return; }
  if (S.release.closed) { screen(message({ ic: 'lock', title: 'Raccolta chiusa', text: ERR.closed })); return; }
  S.mode = 'new';
  const d = loadDraft();
  if (d) S.answers = d;
  startWizard(0);
}

/* ─── già inviato: serve la password ─── */
function showLocked(errMsg = '') {
  const when = S.invite.updated_at && S.invite.updated_at !== S.invite.submitted_at ? `Inviato il ${fmtDateTime(S.invite.submitted_at)}, ultima modifica il ${fmtDateTime(S.invite.updated_at)}.` : `Inviato il ${fmtDateTime(S.invite.submitted_at)}.`;
  if (!S.invite.has_password) {
    screen(message({ ic: 'checkCircle', tone: 'ok', title: 'Hai già inviato tutto', text: `${when} Hai scelto di non mettere una password, quindi per vedere o cambiare qualcosa scrivi a ${labelName()}.` }));
    return;
  }
  const pw = h('input.f-input', { type: 'password', autocomplete: 'current-password', placeholder: 'La tua password', 'aria-label': 'Password', id: 'unlock-pw' });
  const err = h('div.f-err', { role: 'alert' }, errMsg);
  const btn = h('button.f-btn', { type: 'submit' }, icon('unlock', 18), 'Apri il mio invio');
  const form = h('form.f-pw', { onsubmit: async e => {
    e.preventDefault();
    if (!pw.value) { err.textContent = 'Scrivi la password.'; return; }
    btn.disabled = true; btn.textContent = 'Apro…';
    try { await unlock(pw.value); } catch (x) { btn.disabled = false; clear(btn).append(icon('unlock', 18), 'Apri il mio invio'); err.textContent = x.message || ERR.network; }
  } }, pw, err, btn);
  screen(h('div.f-card.f-msg', h('div.f-bigicon.ok', icon('checkCircle', 30)), h('h2', 'Hai già inviato'), h('p', when),
    h('p', S.release.closed ? 'La release è chiusa: puoi rivedere il tuo invio, ma non modificarlo.' : 'Con la tua password puoi rivedere e modificare quello che hai mandato.'), form));
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
    const fields = s.fields.filter(f => f.type !== 'info');
    if (!fields.length) return;
    const stepIdx = S.steps.findIndex(x => x.kind === 'section' && x.section.id === s.id);
    out.append(h('div.f-sum-sec',
      h('div.f-sum-head', h('h3', s.title || `Parte ${si + 1}`),
        editable && stepIdx >= 0 && !(s.contract && S.contractSigned) ? h('button.f-link', { type: 'button', onclick: () => go(stepIdx) }, icon('edit', 15), 'Modifica') : null,
        s.contract && S.contractSigned ? h('span.f-lock', icon('lock', 13), 'Firmato') : null),
      h('dl', fields.map(f => { const v = formatValue(f, answers[f.id]); return h('div.f-sum-row', h('dt', f.label), h('dd' + (v ? '' : '.empty'), v || '—')); }))));
  });
  return out;
}
function copyButtons() {
  const pdf = h('button.f-btn.ghost.small', { type: 'button', onclick: () => doPdf(pdf) }, icon('download', 17), 'Scarica copia PDF');
  const mail = S.emailOn ? h('button.f-btn.ghost.small', { type: 'button', onclick: () => askMail() }, icon('mail', 17), 'Mandamela via email') : null;
  return [pdf, mail];
}
function showView() {
  S.steps = buildSteps();
  const editBtn = S.release.closed ? null : h('button.f-btn', { type: 'button', onclick: () => { S.mode = 'edit'; startWizard(0); } }, icon('edit', 18), 'Modifica');
  screen(
    S.release.closed ? h('div.f-banner', icon('lock', 18), h('span', 'La release è chiusa: puoi rivedere il tuo invio ma non modificarlo.')) : null,
    h('section.f-card', h('h2.f-stitle', 'Il tuo invio'), h('p.f-note', `Versione ${S.version}${S.invite.updated_at ? ' · ultima modifica ' + fmtDateTime(S.invite.updated_at) : ''}`), summary(S.answers),
      h('div.f-actions', copyButtons(), h('span.f-spacer'), editBtn)),
    S.contractSnap ? h('section.f-card', h('h2.f-stitle', 'Contratto firmato'), contractDoc(S.contractSnap, { label: S.label, signedAt: S.signedAt, hash: S.contractHash })) : null,
    hasContract(S.form) && !S.contractSigned && !S.release.closed ? h('div.f-banner.warn', icon('pen', 18), h('span', 'Il contratto non è ancora firmato: tocca "Modifica" per firmarlo.')) : null);
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
  const name = st.kind === 'section' ? (st.section.title || `Parte ${S.step + 1}`) : st.kind === 'contract' ? 'Contratto' : (S.mode === 'edit' ? 'Salva' : 'Invio');
  const pct = Math.round(((S.step + 1) / S.steps.length) * 100);
  return h('div.f-progress', h('div.f-progress-row', h('span', `Passo ${S.step + 1} di ${S.steps.length}`), h('span', name)), h('div.f-bar', h('i', { style: { width: pct + '%' } })));
}
function nav({ next = 'Avanti', onNext, back = true }) {
  return h('div.f-actions',
    back && S.step > 0 ? h('button.f-btn.ghost', { type: 'button', onclick: () => go(S.step - 1) }, icon('back', 18), 'Indietro')
      : S.mode === 'edit' ? h('button.f-btn.ghost', { type: 'button', onclick: () => { if (dirty() && !confirm('Uscire senza salvare le modifiche?')) return; S.answers = structuredClone(S.before); S.signature = null; S.mode = 'view'; showView(); } }, 'Annulla') : h('span'),
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
  const ctx = { errors: S.errors, live: true, shareWith: S.label.share_with || S.form.shareWith, onChange: () => { saveDraft(); if (section.contract && S.signature) invalidateSignatureIfChanged(); }, lockContract: S.contractSigned };
  const card = sectionBlock(section, S.answers, ctx);
  const draftInfo = S.mode === 'new' ? h('div.f-draft', h('span', 'La bozza si salva da sola su questo dispositivo (tranne i dati bancari e fiscali).'),
    h('button.f-link', { type: 'button', onclick: () => { if (confirm('Cancellare tutto quello che hai scritto?')) { dropDraft(); S.answers = {}; S.signature = null; renderStep(); } } }, 'Ricomincia')) : null;
  screen(progress(), S.step === 0 ? draftInfo : null,
    locked ? h('div.f-banner', icon('lock', 18), h('span', 'Questi dati sono nel contratto che hai firmato: non si possono più modificare.')) : null,
    card,
    nav({ onNext: () => {
      if (!locked) {
        const errs = sectionProblems(section, S.answers);
        if (Object.keys(errs).length) { S.errors = errs; renderStep(); focusFirstError(main); toast('Controlla i campi segnati in rosso'); return; }
      }
      S.errors = {};
      go(S.step + 1);
    } }));
}

/* ─── contratto ─── */
function contractKey() { return C.canonical(splitAnswers(S.form, S.answers).contract); }
function invalidateSignatureIfChanged() {
  if (S.signature && S.signedFor !== contractKey()) { S.signature = null; toast('Hai cambiato dei dati del contratto: dovrai firmarlo di nuovo.'); }
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
    screen(progress(), message({ ic: 'alert', title: 'Mancano dei dati', text: 'Prima di firmare completa i dati per il contratto.', actions: [h('button.f-btn', { type: 'button', onclick: () => { S.errors = bad; go(idx); } }, 'Completa i dati')] }));
    return;
  }
  const c = S.form.contract;
  const nameField = S.form.sections.filter(s => s.contract).flatMap(s => s.fields).find(f => f.type === 'short');
  const signed = S.signature && S.signedFor === contractKey();
  const doc = contractDoc(provisionalSnapshot(signed ? S.signature : null), { label: S.label });

  const name = h('input.f-input', { type: 'text', maxlength: 120, value: (S.signature && S.signature.name) || (nameField ? S.answers[nameField.id] || '' : '') || S.invite.artist || '', autocomplete: 'name' });
  const place = h('input.f-input', { type: 'text', maxlength: 120, placeholder: 'Es. Milano', value: (S.signature && S.signature.place) || '' });
  const canvas = h('canvas', { 'aria-label': 'Riquadro per la firma' });
  const fileMsg = h('p.f-note');
  const accept = h('input', { type: 'checkbox', checked: !!signed });
  const err = h('div.f-err', { role: 'alert' });
  let pad = null;
  const sign = () => {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Scrivi nome e cognome.'; return; }
    if (!pad || pad.isEmpty()) { err.textContent = 'Firma nel riquadro (con il dito, il mouse o la penna) oppure carica una foto della tua firma.'; return; }
    if (!accept.checked) { err.textContent = 'Spunta la casella per accettare il contratto.'; return; }
    const now = new Date();
    S.signature = { name: name.value.trim().slice(0, 120), place: place.value.trim().slice(0, 120), png: pad.png(), date: todayYmd(), time: now.toTimeString().slice(0, 5) };
    S.signedFor = contractKey();
    S.skipSign = false;
    toast('Firma pronta ✓ Il contratto si registra quando invii.');
    go(S.step + 1);
  };
  const panel = h('section.f-card',
    h('h2.f-stitle', signed ? 'Firma pronta' : 'Firma'),
    h('div.f-fields',
      h('div.f-field.half', h('label.f-q', 'Nome e cognome'), name),
      h('div.f-field.half', h('label.f-q', 'Luogo'), place),
      h('div.f-field', h('label.f-q', 'La tua firma'), h('p.f-help', 'Disegna con il dito, il mouse o la penna. Oppure carica una foto della firma su un foglio bianco.'),
        h('div.f-sigpad', canvas),
        h('div.f-sigtools',
          h('button.f-btn.ghost.small', { type: 'button', onclick: () => { pad && pad.clear(); fileMsg.textContent = ''; } }, icon('x', 16), 'Cancella'),
          h('button.f-btn.ghost.small', { type: 'button', onclick: () => fileIn.click() }, icon('image', 16), 'Carica da foto')),
        fileMsg),
      h('div.f-field', h('label.f-check', accept, h('span', c.accept)))),
    err,
    h('div.f-actions',
      h('button.f-btn.ghost', { type: 'button', onclick: () => go(S.step - 1) }, icon('back', 18), 'Indietro'),
      !c.required ? h('button.f-link', { type: 'button', onclick: () => { S.signature = null; S.skipSign = true; go(S.step + 1); } }, 'Firma più tardi') : null,
      h('button.f-btn', { type: 'button', onclick: sign }, icon('pen', 18), 'Firmo e continuo')));
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !pad) return;
    try { await pad.loadFile(f); fileMsg.textContent = 'Firma caricata ✓ Controlla l\'anteprima.'; }
    catch (x) { fileMsg.textContent = x.message === 'too_big' ? 'Immagine troppo grande (massimo 15 MB).' : x.message === 'empty_image' ? 'Non vedo una firma: prova con una foto più nitida su sfondo chiaro.' : 'Scegli un\'immagine (PNG o JPG).'; }
  } });
  screen(progress(), h('section.f-card', h('h2.f-stitle', 'Leggi il contratto'), h('p.f-note', 'Dentro ci sono già i tuoi dati. Dopo la firma non si potrà più cambiare.'), doc), panel, fileIn);
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

  const contractLine = !hasContract(S.form) ? null : S.contractSigned ? h('div.f-banner', icon('lock', 18), h('span', 'Contratto già firmato.'))
    : signedNow ? h('div.f-banner', icon('checkCircle', 18), h('span', `Contratto firmato da ${S.signature.name}: si registra quando ${isNew ? 'invii' : 'salvi'}.`))
    : h('div.f-banner.warn', icon('pen', 18), h('span', S.form.contract.required ? 'Manca la firma del contratto.' : 'Il contratto non è firmato: potrai firmarlo più tardi con la tua password.'),
      h('button.f-link', { type: 'button', onclick: () => go(S.steps.findIndex(x => x.kind === 'contract')) }, 'Firma ora'));

  // password
  const pw = h('input.f-input', { type: 'password', autocomplete: 'new-password', placeholder: 'Almeno 10 caratteri', value: S.pw, oninput: e => { S.pw = e.target.value; meter(); } });
  const pw2 = h('input.f-input', { type: 'password', autocomplete: 'new-password', placeholder: 'Ripeti la password', value: S.pw2, oninput: e => { S.pw2 = e.target.value; } });
  const meterEl = h('div.f-meter', h('div.f-bar', h('i')), h('span'));
  const meter = () => { const s = C.passwordStrength(S.pw); meterEl.dataset.s = s.score; meterEl.querySelector('i').style.width = (s.score * 25) + '%'; meterEl.querySelector('span').textContent = s.label; };
  const pwSub = h('div.f-sub', pw, pw2, meterEl, h('p.f-note', 'Scrivila da qualche parte: non la conosciamo nemmeno noi e non si può recuperare. Se la perdi, i tuoi dati restano comunque al sicuro presso l\'etichetta.'));
  pwSub.hidden = !S.wantPw;
  const pwBox = isNew ? h('div.f-choice',
    h('label.f-check', h('input', { type: 'checkbox', checked: S.wantPw, onchange: e => { S.wantPw = e.target.checked; pwSub.hidden = !S.wantPw; } }),
      h('span', 'Voglio poter rivedere e modificare quello che invio (consigliato)')),
    pwSub,
    h('p.f-note', 'Senza password il tuo invio resta al sicuro, ma non potrai più vederlo né cambiarlo: dovrai scrivere all\'etichetta.')) : null;

  // copie
  const mailIn = h('input.f-input', { type: 'email', value: S.mailTo, placeholder: 'La tua email', oninput: e => { S.mailTo = e.target.value.trim(); } });
  const mailSub = h('div.f-sub', mailIn, h('p.f-note', 'Nell\'email i dati riservati (IBAN, codice fiscale…) sono nascosti.'));
  mailSub.hidden = !S.wantMail;
  const copyBox = h('div.f-choice',
    h('p.f-q', icon('copy', 17), 'Vuoi una copia per te?'),
    h('label.f-check', h('input', { type: 'checkbox', checked: S.wantPdf, onchange: e => { S.wantPdf = e.target.checked; } }), h('span', 'Scarica una copia in PDF')),
    S.emailOn ? h('label.f-check', h('input', { type: 'checkbox', checked: S.wantMail, onchange: e => { S.wantMail = e.target.checked; mailSub.hidden = !S.wantMail; } }), h('span', 'Mandamela via email')) : null,
    S.emailOn ? mailSub : null);

  const err = h('div.f-err', { role: 'alert' });
  const send = h('button.f-btn', { type: 'button', onclick: () => submit(send, err) }, icon('send', 18), isNew ? 'Invia' : 'Salva le modifiche');
  screen(progress(),
    h('section.f-card', h('h2.f-stitle', isNew ? 'Controlla e invia' : 'Controlla le modifiche'), contractLine, summary(S.answers, { editable: true })),
    h('section.f-card', pwBox, copyBox, err,
      h('div.f-actions', h('button.f-btn.ghost', { type: 'button', onclick: () => go(S.step - 1) }, icon('back', 18), 'Indietro'), send)));
  meter();
  if (needSign && S.form.contract.required && !signedNow) send.title = 'Prima firma il contratto';
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
    toast('Manca qualcosa: controlla i campi segnati in rosso');
    go(idx >= 0 ? idx : 0);
    setTimeout(() => focusFirstError(main), 60);
    return;
  }
  invalidateSignatureIfChanged();
  const signedNow = S.signature && S.signedFor === contractKey();
  if (hasContract(S.form) && !S.contractSigned && S.form.contract.required && !signedNow) { toast('Prima firma il contratto'); go(S.steps.findIndex(x => x.kind === 'contract')); return; }
  if (isNew && S.wantPw) {
    const p = C.passwordProblem(S.pw);
    if (p) { err.textContent = 'Password: ' + p; return; }
    if (S.pw !== S.pw2) { err.textContent = 'Le due password non sono uguali.'; return; }
  }
  if (isNew && !S.wantPw && hasContract(S.form) && !signedNow) { err.textContent = 'Per firmare più tardi serve una password (altrimenti non potresti più riaprire l\'invio).'; return; }
  if (S.wantMail && S.emailOn && !EMAIL_RE.test(S.mailTo)) { err.textContent = 'Controlla l\'email per la copia.'; return; }
  if (!isNew && !dirty() && !signedNow) { toast('Non hai cambiato niente'); S.mode = 'view'; showView(); return; }

  S.busy = true;
  btn.disabled = true;
  clear(btn).append(h('span.f-spinner', { style: { width: '18px', height: '18px', borderWidth: '2px', margin: '0' } }), isNew ? 'Cifro e invio…' : 'Cifro e salvo…');
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
    clear(btn).append(icon('send', 18), isNew ? 'Invia' : 'Salva le modifiche');
    err.textContent = e.message || 'Qualcosa non ha funzionato. Riprova.';
  }
}

function showDone(isNew) {
  const canEdit = !!S.invite.has_password;
  const actions = [...copyButtons()];
  if (canEdit && !S.release.closed) actions.push(h('button.f-btn.ghost.small', { type: 'button', onclick: () => { S.mode = 'view'; showView(); } }, icon('eye', 17), 'Rivedi il tuo invio'));
  screen(h('div.f-card.f-msg',
    h('div.f-bigicon.ok', icon('checkCircle', 30)),
    h('h2', isNew ? 'Inviato!' : 'Modifiche salvate'),
    isNew && !isEmptyRich(S.form.done) ? richBlock(S.form.done, {}, 'f-intro') : h('p', isNew ? `${labelName()} ha ricevuto tutto.` : `${labelName()} riceve un avviso con quello che hai cambiato.`),
    canEdit ? h('p', 'Per rivedere o modificare usa lo stesso link e la tua password.') : h('p', 'Hai scelto di non mettere una password: per cambiare qualcosa scrivi all\'etichetta.'),
    h('div.f-actions', actions)));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (S.wantPdf) { S.wantPdf = false; doPdf(null); }
  if (S.wantMail && S.emailOn) { S.wantMail = false; sendMail(S.mailTo); }
}

/* ─── copie ─── */
async function doPdf(btn) {
  if (btn) btn.disabled = true;
  toast('Preparo il PDF…');
  try {
    const doc = copyDocument({ form: S.form, answers: S.answers, label: S.label, release: S.release, artist: S.invite.artist, when: S.invite.updated_at || new Date().toISOString(), version: S.version,
      contract: S.contractSnap ? { snap: S.contractSnap, signedAt: S.signedAt, hash: S.contractHash } : null });
    await savePdf(doc, pdfName(S.release.title, S.invite.artist, 'copia'));
  } catch (e) { toast(e.message || 'PDF non riuscito'); }
  if (btn) btn.disabled = false;
}
function askMail() {
  const to = prompt('A quale email mando la copia?', S.mailTo || firstEmail());
  if (to === null) return;
  if (!EMAIL_RE.test(to.trim())) { toast('Email non valida'); return; }
  S.mailTo = to.trim();
  sendMail(S.mailTo);
}
async function sendMail(to) {
  const rows = summaryRows(S.form, S.answers, { mask: true, skipEmpty: true }).map(r => ({ s: r.section, l: r.label, v: r.value }));
  const r = await api.mailCopy({ token, verifier: S.verifier, to, title: S.form.title, rows }).catch(() => null);
  if (r && r.ok) toast(`Copia mandata a ${to} ✓`);
  else toast(r && r.error === 'too_many' ? 'Hai già chiesto troppe copie oggi.' : 'Email non partita. Puoi scaricare il PDF.');
}

boot();
