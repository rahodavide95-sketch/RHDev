/* Struttura di un modulo (come Google Moduli): sezioni, campi, contratto, aspetto.
   sanitizeForm() è la difesa: qualsiasi cosa arrivi (dal database, da un file, da un errore)
   esce come modulo valido, con id unici e limiti di lunghezza. */

import { sanitizeRich, fromPlain, placeholdersIn, richToText } from './richtext.js';
import { sanitizeTheme, DEFAULT_THEME, sanitizeContractStyle, CONTRACT_STYLE, safeImage } from './theme.js';
import { LINK_KINDS } from './links.js';

export const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
export function newId(prefix = 'f') {
  const a = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return prefix + '_' + [...a].map(b => (b % 36).toString(36)).join('');
}

export const FIELD_TYPES = {
  short: { label: 'Risposta breve', icon: 'text' },
  long: { label: 'Paragrafo', icon: 'para' },
  email: { label: 'Email', icon: 'mail' },
  phone: { label: 'Telefono', icon: 'phone' },
  number: { label: 'Numero', icon: 'hash' },
  date: { label: 'Data', icon: 'calendar' },
  link: { label: 'Link (Drive, Dropbox, social…)', icon: 'link' },
  choice: { label: 'Scelta singola', icon: 'radio' },
  checks: { label: 'Caselle (più scelte)', icon: 'check' },
  select: { label: 'Menu a tendina', icon: 'chevron' },
  group: { label: 'Elenco ripetibile (es. tracce)', icon: 'list' },
  split: { label: 'Crediti e split %', icon: 'pie' },
  iban: { label: 'IBAN', icon: 'bank' },
  taxid: { label: 'Codice fiscale / Tax ID', icon: 'id' },
  info: { label: 'Testo o titolo (senza risposta)', icon: 'info' },
  image: { label: 'Immagine', icon: 'image' },
  divider: { label: 'Separatore o spazio', icon: 'divider' },
};
/** Elementi che si vedono ma non hanno una risposta. */
export const STATIC_TYPES = ['info', 'image', 'divider'];
export const isStatic = f => !!f && STATIC_TYPES.includes(f.type);
/** Larghezze possibili di un campo, in percentuale della riga. */
export const WIDTHS = [25, 33, 50, 67, 75, 100];
export const widthOf = f => WIDTHS.includes(Number(f && f.w)) ? Number(f.w) : (f && f.half ? 50 : 100);
export const nearestWidth = pct => WIDTHS.reduce((a, b) => Math.abs(b - pct) < Math.abs(a - pct) ? b : a, 100);
/** Tipi che si possono mettere dentro un elenco ripetibile. */
export const SUB_TYPES = ['short', 'long', 'email', 'phone', 'number', 'date', 'link', 'choice', 'checks', 'select', 'split', 'iban', 'taxid'];
/** Tipi che di solito sono dati riservati (nascosti nelle email). */
export const SENSITIVE_TYPES = ['iban', 'taxid'];

export const MUSIC_KEYS = ['Am (8A)', 'C (8B)', 'Em (9A)', 'G (9B)', 'Bm (10A)', 'D (10B)', 'F#m (11A)', 'A (11B)', 'C#m (12A)', 'E (12B)',
  'G#m (1A)', 'B (1B)', 'D#m (2A)', 'F# (2B)', 'A#m (3A)', 'C# (3B)', 'Fm (4A)', 'G# (4B)', 'Cm (5A)', 'D# (5B)', 'Gm (6A)', 'A# (6B)', 'Dm (7A)', 'F (7B)'];
export const SPLIT_ROLES = ['Autore', 'Compositore', 'Produttore', 'Remixer', 'Featuring', 'Editore'];
export const SPLIT_ROLES_EN = ['Author', 'Composer', 'Producer', 'Remixer', 'Featuring', 'Publisher'];

/** Segnaposto del contratto che non sono campi del modulo. */
export const SYSTEM_PLACEHOLDERS = {
  $label: 'Nome dell\'etichetta',
  $release: 'Titolo della release',
  $catalog: 'Numero di catalogo',
  $artist: 'Nome dell\'artista (dall\'invito)',
  $artistPct: '% all\'artista',
  $labelPct: '% all\'etichetta',
  $artistPctWords: '% all\'artista in lettere (fifty)',
  $labelPctWords: '% all\'etichetta in lettere (fifty)',
  $tracks: 'Titoli delle tracce',
  $writers: 'Autori (dai crediti)',
  $date: 'Data della firma',
};

/* Testi della pagina dell'artista: tutti modificabili dal costruttore, nella lingua del modulo. */
export const TEXTS = {
  it: {
    release: '{release} · {catalogo}',
    hello: 'Ciao {artista}!',
    next: 'Avanti', back: 'Indietro', send: 'Invia', saveEdit: 'Salva le modifiche',
    step: 'Passo {n} di {tot}',
    reviewTitle: 'Controlla e invia',
    contractTitle: 'Leggi il contratto',
    contractNote: 'Dentro ci sono già i tuoi dati. Dopo la firma non si potrà più cambiare.',
    signTitle: 'Firma', signBtn: 'Firmo e continuo',
    doneTitle: 'Inviato!',
    foot: 'I tuoi dati vengono cifrati in questo browser prima di partire: li può leggere solo {etichetta}.',
  },
  en: {
    release: '{release} · {catalogo}',
    hello: 'Hi {artista}!',
    next: 'Next', back: 'Back', send: 'Submit', saveEdit: 'Save changes',
    step: 'Step {n} of {tot}',
    reviewTitle: 'Review and submit',
    contractTitle: 'Read the contract',
    contractNote: 'Your details are already in it. Once signed, it can no longer be changed.',
    signTitle: 'Signature', signBtn: 'Sign and continue',
    doneTitle: 'Sent!',
    foot: 'Your data is encrypted in this browser before it is sent: only {etichetta} can read it.',
  },
};
export const TEXT_DEFAULTS = TEXTS.it;
export const textDefaults = lang => TEXTS[lang === 'it' ? 'it' : 'en'];
export const TEXT_LABELS = {
  release: 'Riga della release (in alto)',
  hello: 'Saluto (sotto il titolo)', next: 'Pulsante "Avanti"', back: 'Pulsante "Indietro"', send: 'Pulsante di invio', saveEdit: 'Pulsante per salvare le modifiche',
  step: 'Avanzamento', reviewTitle: 'Titolo del riepilogo', contractTitle: 'Titolo prima del contratto', contractNote: 'Nota prima del contratto',
  signTitle: 'Titolo della firma', signBtn: 'Pulsante della firma', doneTitle: 'Titolo dopo l\'invio', foot: 'Nota in fondo alla pagina',
};
export const SHOW_DEFAULTS = { hello: true, release: true, labelName: true, progress: true, foot: true, draft: true, required: true };
export const SHOW_LABELS = {
  labelName: 'Nome dell\'etichetta in alto', release: 'Titolo della release in alto', hello: 'Saluto all\'artista', progress: 'Barra di avanzamento',
  required: 'Asterisco sulle domande obbligatorie', draft: 'Avviso della bozza salvata', foot: 'Nota in fondo alla pagina',
};
const ALIAS = { artist: 'artista', name: 'nome', label: 'etichetta', catalog: 'catalogo', total: 'tot' };
export const fillText = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : vars[ALIAS[k]] !== undefined ? String(vars[ALIAS[k]]) : m);

export const LIMITS = { sections: 30, fieldsPerSection: 80, fields: 300, options: 100, subFields: 20 };

const str = (v, max, d = '') => typeof v === 'string' ? v.slice(0, max) : d;
const bool = (v, d = false) => typeof v === 'boolean' ? v : d;
const numOrNull = v => v === '' || v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const pick = (v, allowed, d) => allowed.includes(v) ? v : d;
const intIn = (v, min, max, d) => { const n = Number(v); return v !== '' && v !== null && v !== undefined && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };

function cleanOptions(list) {
  const seen = new Set();
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const label = str(typeof o === 'string' ? o : o && o.label, 200).trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= LIMITS.options) break;
  }
  return out;
}

function cleanField(f, ids, sub = false) {
  if (!f || typeof f !== 'object' || !FIELD_TYPES[f.type]) return null;
  if (sub && !SUB_TYPES.includes(f.type)) return null;
  let id = typeof f.id === 'string' && ID_RE.test(f.id) && !ids.has(f.id) ? f.id : newId('f');
  while (ids.has(id)) id = newId('f');
  ids.add(id);
  const o = {
    id, type: f.type,
    label: str(f.label, 300).trim() || (isStatic(f) ? '' : FIELD_TYPES[f.type].label),
    help: sanitizeRich(f.help),
    w: widthOf(f),
  };
  if (f.type === 'image') {
    o.src = safeImage(f.src);
    o.alt = str(f.alt, 200);
    o.align = pick(f.align, ['l', 'c', 'r'], 'c');
    o.radius = intIn(f.radius, 0, 60, 0);
    o.maxH = intIn(f.maxH, 0, 1600, 0);
    o.caption = str(f.caption, 300);
    return o;
  }
  if (f.type === 'divider') {
    o.style = pick(f.style, ['line', 'space', 'dots'], 'line');
    o.size = intIn(f.size, 0, 200, 24);
    return o;
  }
  if (f.type === 'info') return o;
  o.required = bool(f.required);
  o.placeholder = str(f.placeholder, 200);
  o.hideLabel = bool(f.hideLabel);
  o.sensitive = bool(f.sensitive, SENSITIVE_TYPES.includes(f.type));
  if (!sub) o.checklist = bool(f.checklist, o.required);
  switch (f.type) {
    case 'short': o.maxLength = Math.min(2000, Math.max(1, Math.round(Number(f.maxLength) || 300))); break;
    case 'long':
      o.maxLength = Math.min(20000, Math.max(1, Math.round(Number(f.maxLength) || 5000)));
      o.rows = intIn(f.rows, 2, 30, 4);
      break;
    case 'number': {
      o.min = numOrNull(f.min); o.max = numOrNull(f.max);
      if (o.min !== null && o.max !== null && o.min > o.max) [o.min, o.max] = [o.max, o.min];
      o.decimals = bool(f.decimals);
      o.unit = str(f.unit, 20);
      break;
    }
    case 'link': o.linkKind = LINK_KINDS[f.linkKind] ? f.linkKind : 'any'; break;
    case 'choice': case 'checks': case 'select':
      o.options = cleanOptions(f.options);
      if (!o.options.length) o.options = ['Opzione 1'];
      o.other = f.type !== 'select' && bool(f.other);
      break;
    case 'split':
      o.total100 = bool(f.total100, true);
      o.roles = cleanOptions(f.roles && f.roles.length ? f.roles : SPLIT_ROLES).slice(0, 20);
      break;
    case 'group': {
      o.itemLabel = str(f.itemLabel, 60).trim() || 'Elemento';
      o.min = Math.min(50, Math.max(0, Math.round(Number(f.min) || 0)));
      o.max = Math.min(100, Math.max(1, Math.round(Number(f.max) || 20)));
      if (o.min > o.max) o.min = o.max;
      o.fields = (Array.isArray(f.fields) ? f.fields : []).map(x => cleanField(x, ids, true)).filter(Boolean).slice(0, LIMITS.subFields);
      if (!o.fields.length) {
        const sid = newId('f'); ids.add(sid);
        o.fields = [{ id: sid, type: 'short', label: 'Titolo', help: [], w: 100, required: true, placeholder: '', hideLabel: false, sensitive: false, maxLength: 300 }];
      }
      if (o.required && o.min < 1) o.min = 1;
      break;
    }
    default: break;
  }
  return o;
}

export const CONTRACT_TEXT = {
  title: 'AUTHORIZATION TO RELEASE AND COLLABORATION AGREEMENT',
  copyTitle: 'LABEL COPY INFORMATION',
  confirm: 'I confirm that I have read, understood, and accepted the terms of this Release Authorization.',
  dateLabel: 'Date of this agreement:',
  labelRole: 'For the Label — {label}',
  artistRole: 'For the Artist — {name}',
  blank: 'Date / Signature',
  accept: 'I have read, understood and accepted the terms of this agreement.',
};

/** Il primo campo "nome e cognome" fra i dati del contratto (va nella pagina dei dati). */
function fullNameGuess(sections) {
  const fs = sections.filter(s => s.contract).flatMap(s => s.fields).filter(f => f.type === 'short');
  return (fs.find(f => /nome e cognome|full ?name|nome completo/i.test(f.label)) || fs[0] || {}).id || '';
}

function cleanContract(c, sections) {
  c = c && typeof c === 'object' ? c : {};
  const T = CONTRACT_TEXT;
  const out = {
    layout: 2,
    enabled: bool(c.enabled),
    required: bool(c.required, true),
    labelSigns: bool(c.labelSigns, true),
    title: str(c.title, 300).trim() || T.title,
    intro: sanitizeRich(c.intro),
    body: sanitizeRich(c.body),
    copyPage: bool(c.copyPage, true),
    copyTitle: str(c.copyTitle, 300).trim() || T.copyTitle,
    copy: sanitizeRich(c.copy),
    confirm: typeof c.confirm === 'string' ? c.confirm.slice(0, 600).trim() : T.confirm,
    dateLabel: typeof c.dateLabel === 'string' ? c.dateLabel.slice(0, 120).trim() : T.dateLabel,
    labelRole: str(c.labelRole, 200).trim() || T.labelRole,
    artistRole: str(c.artistRole, 200).trim() || T.artistRole,
    blank: str(c.blank, 80).trim() || T.blank,
    accept: str(c.accept, 300).trim() || T.accept,
    style: sanitizeContractStyle(c.style),
  };
  if (c.layout !== 2) {
    // contratto salvato prima della nuova impaginazione: il testo predefinito diventa quello completo,
    // un testo scritto dall'etichetta resta com'era (e riceve la pagina dei dati)
    const fullId = placeholdersIn(out.body).filter(id => id[0] !== '$').pop() || fullNameGuess(sections);
    const d = labelContract(fullId);
    const wasDefault = !out.body.length || /Declaration of ownership of rights/.test(JSON.stringify(out.body));
    if (wasDefault) { out.title = d.title; out.intro = d.intro; out.body = d.body; }
    out.copy = d.copy;
    if (!c.confirm) out.confirm = T.confirm;
    if (!c.dateLabel) out.dateLabel = T.dateLabel;
  }
  return out;
}

/** Testo, impaginazione e formattazione originali del contratto (per "Ripristina"). */
export function restoreContract(contract, sections) {
  const d = labelContract(fullNameGuess(sections));
  return { ...contract, ...d, layout: 2, copyPage: true, style: { ...CONTRACT_STYLE },
    confirm: CONTRACT_TEXT.confirm, dateLabel: CONTRACT_TEXT.dateLabel, labelRole: CONTRACT_TEXT.labelRole, artistRole: CONTRACT_TEXT.artistRole, blank: CONTRACT_TEXT.blank };
}

/** Modulo pulito e valido, qualunque cosa arrivi. */
export function sanitizeForm(raw) {
  let f = raw && typeof raw === 'object' ? raw : {};
  // lingua della pagina dell'artista. I moduli salvati prima non l'avevano: quello di partenza mai
  // ritoccato passa all'inglese (solo i testi di partenza si traducono), gli altri restano in italiano.
  let lang = f.lang === 'it' || f.lang === 'en' ? f.lang : null;
  if (!lang) {
    if (String(f.title || '').trim() === DEF.title[0]) { f = translateForm(f, 'it', 'en'); lang = 'en'; } else lang = 'it';
  }
  const ids = new Set(Object.keys(SYSTEM_PLACEHOLDERS));
  const sids = new Set();
  let total = 0;
  const sections = [];
  for (const s of Array.isArray(f.sections) ? f.sections.slice(0, LIMITS.sections) : []) {
    if (!s || typeof s !== 'object') continue;
    let id = typeof s.id === 'string' && ID_RE.test(s.id) && !sids.has(s.id) ? s.id : newId('s');
    while (sids.has(id)) id = newId('s');
    sids.add(id);
    const fields = [];
    for (const x of Array.isArray(s.fields) ? s.fields : []) {
      if (fields.length >= LIMITS.fieldsPerSection || total >= LIMITS.fields) break;
      const c = cleanField(x, ids);
      if (c) { fields.push(c); total++; }
    }
    sections.push({ id, title: str(s.title, 200).trim(), desc: sanitizeRich(s.desc), contract: bool(s.contract), fields });
  }
  if (!sections.length) sections.push({ id: newId('s'), title: '', desc: [], contract: false, fields: [] });
  return {
    v: 1,
    title: str(f.title, 200).trim() || 'Modulo senza titolo',
    intro: sanitizeRich(f.intro),
    sections,
    contract: cleanContract(f.contract, sections),
    done: sanitizeRich(f.done),
    lang,
    // un testo uguale a quello di partenza (in qualsiasi lingua) segue la lingua del modulo
    texts: Object.fromEntries(Object.keys(TEXTS.it).map(k => { const v = str(f.texts && f.texts[k], 300).trim(); return [k, !v || v === TEXTS.it[k] || v === TEXTS.en[k] ? TEXTS[lang][k] : v]; })),
    show: Object.fromEntries(Object.entries(SHOW_DEFAULTS).map(([k, d]) => [k, bool(f.show && f.show[k], d)])),
    shareWith: typeof f.shareWith === 'string' && /^[^@\s<>"]{1,64}@[^@\s<>"]{1,190}\.[a-z]{2,}$/i.test(f.shareWith.trim()) ? f.shareWith.trim().toLowerCase() : '',
    theme: sanitizeTheme(f.theme || DEFAULT_THEME),
  };
}

/* ─── Aiuti per chi naviga il modulo ─── */
export function allFields(form) {
  const out = [];
  for (const s of form.sections) for (const f of s.fields) out.push({ field: f, section: s });
  return out;
}
export const answerFields = form => allFields(form).filter(x => !isStatic(x.field));
export function fieldById(form, id) {
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (f.id === id) return f;
      if (f.type === 'group') for (const g of f.fields) if (g.id === id) return g;
    }
  }
  return null;
}
export const contractSections = form => form.sections.filter(s => s.contract);
export const hasContract = form => !!form.contract.enabled;

/** Nuovo campo vuoto di un tipo. */
export function blankField(type) {
  const base = { id: newId('f'), type, label: type === 'info' ? 'Titolo' : '', help: [], required: false, w: 100 };
  if (type === 'image') { base.label = ''; base.src = ''; base.align = 'c'; }
  if (type === 'divider') { base.label = ''; base.style = 'line'; base.size = 24; }
  if (type === 'choice' || type === 'checks' || type === 'select') base.options = ['Opzione 1', 'Opzione 2'];
  if (type === 'group') { base.itemLabel = 'Elemento'; base.fields = [{ id: newId('f'), type: 'short', label: 'Titolo', required: true }]; base.min = 0; base.max = 20; }
  if (type === 'link') base.linkKind = 'files';
  return base;
}

/* ─── Contratto dell'etichetta, con i segnaposto ───
   Stesso testo e stessa impaginazione del contratto che l'etichetta usa già: pagina dell'accordo
   (titolo, introduzione, 7 articoli) e pagina dei dati "Label copy information" con le firme. */
const P = (...c) => ({ t: 'p', c });
const H = x => ({ t: 'h2', c: [{ x }] });
const T = x => ({ x });
const B = x => ({ x, b: 1 });
const F = f => ({ f });
const FB = f => ({ f, b: 1 });
export function labelContract(fullNameId) {
  return {
    title: CONTRACT_TEXT.title,
    intro: [{ t: 'p', a: 'c', c: [{ x: 'This document is intended to clearly and transparently define the terms of the collaboration between the Artist and the Label.', i: 1 }] }],
    body: [
      H('1. Declaration of ownership of rights'),
      P(T('The Artist declares that they are the sole owner, or that they have obtained full authorization from all entitled parties, of the '), B('copyright and related rights necessary for the exploitation and release'), T(' of the track(s) covered by this agreement.')),
      H('2. Grant of rights'),
      P(T('The Artist grants '), FB('$label'), T(', as an independent project, the '), B('exclusive right'), T(', free of charge, with '), B('worldwide validity'), T(' and '), B('no time limitation'), T(', to release, distribute, communicate to the public and promote the track(s), in any format and on any digital platform, including as part of compilations (VA), EPs, singles or similar releases.')),
      P(T('This grant does '), B('not'), T(' constitute a transfer of authorship of the work, which shall remain with the Artist.')),
      H('3. Warranties and indemnification'),
      P(T('The Artist warrants that the track(s) is/are original and do not infringe the rights of third parties, including, by way of example, copyright, related rights or image rights.')),
      P(T('The Artist agrees to indemnify and hold the Label harmless from any claim, demand or damage arising from any breach of the above warranties.')),
      H('4. Compensation and revenue split'),
      P(T('Any proceeds derived from the exploitation of the released track(s) (including, by way of example and not limitation, digital sales and streaming) shall be considered '), B('net revenues'), T(', meaning revenues net of distribution platform fees, taxes and any refunds.')),
      P(T('Such net revenues shall first be applied to the '), B('recoupment of costs incurred by the Label'), T(', including, by way of example but not limited to: mastering, artwork, promotion, marketing and distribution.')),
      P(T('Once such costs have been fully recouped, the subsequent net revenues shall be split as follows: '), FB('$artistPct'), B('% ('), FB('$artistPctWords'), B(' percent) to the Artist and '), FB('$labelPct'), B('% ('), FB('$labelPctWords'), B(' percent) to the Label'), T(', unless otherwise agreed in writing by the parties.')),
      P(T('The methods and timing of accounting and payments shall depend on the distribution platform used. The Artist acknowledges that any compensation received may be subject to taxation and that the Label shall not be responsible for the Artist\'s personal tax obligations.')),
      H('5. Nature of the project'),
      P(T('The parties acknowledge that '), FB('$label'), T(' operates as an independent project and is not structured as a company. This agreement constitutes a private authorization and an artistic collaboration.')),
      H('6. Final provisions'),
      P(T('This document constitutes the entire agreement between the parties with respect to the track(s) covered herein. Any amendments or additions must be agreed upon in writing.')),
      P(T('The submission and signature of this document shall constitute full acceptance of the terms set forth above.')),
      H('7. Personal Data Processing'),
      P(T('Pursuant to article 13 of the Regulation (EU) 2016/679 (GDPR), the Artist acknowledges that their personal data will be processed by '), F('$label'), T(', acting as Data Controller, exclusively for purposes related to the negotiation, execution and performance of this contract, as well as to the publication, distribution, promotion and administrative management of any revenues that may derive from the exploitation of the recordings.')),
      P(T('The processing of personal data is necessary for the performance of this contract, in accordance with Article 6(1)(b) of the Regulation (EU) 2016/679 (GDPR). Personal data will be retained for the time strictly necessary for the management of the contractual relationship and for the protection of the rights relating to the recordings. Personal data will not be disclosed to third parties nor used for purposes other than those stated above, except for disclosure to parties involved in digital distribution, promotion, rights management, and technical, accounting and administrative services, who will act as data processors. Where necessary, personal data may be transferred to countries outside the European Union in compliance with applicable data protection laws.')),
      P(T('The Artist may at any time exercise their rights of access, rectification, erasure, restriction of processing, data portability and objection to processing, as well as lodge a complaint with the competent Data Protection Authority.')),
    ],
    copyTitle: CONTRACT_TEXT.copyTitle,
    copy: [
      H('The Company:'), P(F('$label')),
      H('Track(s) Information'),
      P(B('Title(s):'), T(' '), F('$tracks')),
      P(B('Artist Name(s):'), T(' '), F('$artist')),
      P(B('Written by:'), T(' '), F('$writers')),
      H('Artist Details'),
      P(B('Full Name:'), T(' '), ...(fullNameId ? [F(fullNameId)] : [])),
      P(B('Artist / Project Name:'), T(' '), F('$artist')),
      H('Signature'),
    ],
  };
}

/* Testi del modulo di partenza in italiano e in inglese: servono a crearlo nella lingua giusta e a
   tradurre quelli rimasti come all'inizio quando si cambia lingua (quelli riscritti non si toccano). */
const DEF = {
  title: ['Consegna release', 'Release delivery'],
  intro: ['Ciao! Qui ci mandi tutto quello che serve per la release: dati, bio, press kit, tracce, artwork e contratto.\nPuoi lasciare il modulo e riprenderlo: la bozza resta su questo dispositivo (tranne i dati bancari e fiscali, per sicurezza).',
    'Hi! Here you can send us everything we need for the release: details, bio, press kit, tracks, artwork and contract.\nYou can leave the form and come back later: the draft stays on this device (except bank and tax details, for safety).'],
  sArtist: ['Artista', 'Artist'], artistName: ['Nome d\'arte', 'Artist name'], phone: ['Telefono', 'Phone'],
  bioHelp: ['In inglese, 80–150 parole. Scrivi in terza persona.', 'In English, 80–150 words, written in the third person.'],
  pressFolder: ['Cartella press (foto e logo)', 'Press folder (photos and logo)'],
  pressHelp: ['Foto in alta risoluzione (almeno 3000 px) e logo in PNG trasparente, in una cartella condivisa.', 'High-resolution photos (at least 3000 px) and logo as a transparent PNG, in a shared folder.'],
  sTracks: ['Tracce', 'Tracks'], track: ['Traccia', 'Track'], tTitle: ['Titolo', 'Title'], version: ['Versione / mix', 'Version / mix'],
  wav: ['Link al WAV', 'WAV link'], wavHelp: ['WAV 24 bit, 44,1 kHz o superiore.', 'WAV 24-bit, 44.1 kHz or higher.'],
  key: ['Tonalità', 'Key'], credits: ['Crediti e split', 'Credits and splits'],
  artHelp: ['3000 × 3000 px, JPG o PNG. Se lo prepara l\'etichetta lascia vuoto.', '3000 × 3000 px, JPG or PNG. Leave it empty if the label is making it.'],
  sContract: ['Dati per il contratto', 'Contract details'],
  contractDesc: ['Questi dati finiscono nel contratto: dopo la firma non si possono più modificare.', 'These details go into the contract: once signed, they can no longer be changed.'],
  fullName: ['Nome e cognome', 'Full name'], birth: ['Data di nascita', 'Date of birth'], tax: ['Codice fiscale / Tax ID', 'Tax ID / Codice fiscale'],
  address: ['Indirizzo di residenza', 'Home address'], iban: ['IBAN per i pagamenti', 'IBAN for payments'], holder: ['Intestatario del conto', 'Account holder'],
  done: ['Grazie! Abbiamo ricevuto tutto. Ti scriviamo noi se manca qualcosa.', 'Thank you! We received everything. We will get in touch if anything is missing.'],
  blank: ['Nuovo modulo', 'New form'],
};
const DEF_PAIRS = Object.values(DEF);
const tStr = (v, fi, ti) => { if (typeof v !== 'string') return v; const t = v.trim(); const p = DEF_PAIRS.find(x => x[fi] === t); return p ? p[ti] : v; };
const tRich = (doc, fi, ti) => { const t = richToText(sanitizeRich(doc)).trim(); const p = t && DEF_PAIRS.find(x => x[fi] === t); return p ? fromPlain(p[ti]) : doc; };
const tRoles = (r, fi, ti) => { const a = [SPLIT_ROLES, SPLIT_ROLES_EN]; return Array.isArray(r) && r.join('|') === a[fi].join('|') ? [...a[ti]] : r; };
/** Traduce i testi rimasti come nel modulo di partenza (da 'it' a 'en' o viceversa). */
export function translateForm(raw, from, to) {
  const fi = from === 'en' ? 1 : 0, ti = to === 'en' ? 1 : 0;
  if (fi === ti || !raw || typeof raw !== 'object') return raw;
  const f = JSON.parse(JSON.stringify(raw));
  const field = x => {
    if (!x || typeof x !== 'object') return x;
    x.label = tStr(x.label, fi, ti); x.placeholder = tStr(x.placeholder, fi, ti); x.itemLabel = tStr(x.itemLabel, fi, ti);
    if (x.help) x.help = tRich(x.help, fi, ti);
    if (x.roles) x.roles = tRoles(x.roles, fi, ti);
    if (Array.isArray(x.fields)) x.fields = x.fields.map(field);
    return x;
  };
  f.title = tStr(f.title, fi, ti);
  if (f.intro) f.intro = tRich(f.intro, fi, ti);
  if (f.done) f.done = tRich(f.done, fi, ti);
  if (Array.isArray(f.sections)) for (const s of f.sections) { if (!s) continue; s.title = tStr(s.title, fi, ti); if (s.desc) s.desc = tRich(s.desc, fi, ti); if (Array.isArray(s.fields)) s.fields = s.fields.map(field); }
  if (f.texts && typeof f.texts === 'object') for (const k of Object.keys(TEXTS.it)) if (f.texts[k] === TEXTS[from === 'en' ? 'en' : 'it'][k]) f.texts[k] = TEXTS[to === 'en' ? 'en' : 'it'][k];
  f.lang = to;
  return f;
}

/** Il modulo di partenza: "Consegna release" / "Release delivery", con i campi concordati con l'etichetta. */
export function defaultForm(lang = 'en') {
  const L = lang === 'it' ? 0 : 1;
  const d = k => DEF[k][L];
  const id = p => newId(p);
  const fullName = id('f');
  const form = {
    lang: L ? 'en' : 'it',
    title: d('title'),
    intro: fromPlain(d('intro')),
    shareWith: '',
    sections: [
      {
        id: id('s'), title: d('sArtist'), desc: [], contract: false, fields: [
          { id: id('f'), type: 'short', label: d('artistName'), required: true, checklist: true },
          { id: id('f'), type: 'email', label: 'Email', required: true, checklist: false, half: true },
          { id: id('f'), type: 'phone', label: d('phone'), required: false, half: true },
          { id: id('f'), type: 'long', label: 'Bio', required: true, checklist: true, help: fromPlain(d('bioHelp')), maxLength: 4000 },
          { id: id('f'), type: 'link', label: 'Instagram', linkKind: 'social', half: true },
          { id: id('f'), type: 'link', label: 'SoundCloud', linkKind: 'social', half: true },
          { id: id('f'), type: 'link', label: 'Spotify', linkKind: 'music', half: true },
          { id: id('f'), type: 'link', label: 'Resident Advisor', linkKind: 'social', half: true },
        ],
      },
      {
        id: id('s'), title: 'Press kit', desc: [], contract: false, fields: [
          { id: id('f'), type: 'link', label: d('pressFolder'), linkKind: 'files', required: true, checklist: true, help: fromPlain(d('pressHelp')) },
        ],
      },
      {
        id: id('s'), title: d('sTracks'), desc: [], contract: false, fields: [
          {
            id: id('f'), type: 'group', label: d('sTracks'), itemLabel: d('track'), required: true, checklist: true, min: 1, max: 20,
            fields: [
              { id: id('f'), type: 'short', label: d('tTitle'), required: true, half: true },
              { id: id('f'), type: 'short', label: d('version'), placeholder: 'Original Mix', half: true },
              { id: id('f'), type: 'link', label: d('wav'), linkKind: 'audio', required: true, help: fromPlain(d('wavHelp')) },
              { id: id('f'), type: 'number', label: 'BPM', required: true, min: 60, max: 220, decimals: true, half: true },
              { id: id('f'), type: 'select', label: d('key'), options: MUSIC_KEYS, half: true },
              { id: id('f'), type: 'split', label: d('credits'), total100: true, required: true, roles: L ? SPLIT_ROLES_EN : SPLIT_ROLES },
            ],
          },
        ],
      },
      {
        id: id('s'), title: 'Artwork', desc: [], contract: false, fields: [
          { id: id('f'), type: 'link', label: 'Artwork', linkKind: 'files', required: false, checklist: true, help: fromPlain(d('artHelp')) },
        ],
      },
      {
        id: id('s'), title: d('sContract'), contract: true,
        desc: fromPlain(d('contractDesc')),
        fields: [
          { id: fullName, type: 'short', label: d('fullName'), required: true, checklist: false },
          { id: id('f'), type: 'date', label: d('birth'), required: true, half: true, sensitive: true, checklist: false },
          { id: id('f'), type: 'taxid', label: d('tax'), required: true, half: true, checklist: false },
          { id: id('f'), type: 'short', label: d('address'), required: true, sensitive: true, checklist: false },
          { id: id('f'), type: 'iban', label: d('iban'), required: false, half: true },
          { id: id('f'), type: 'short', label: d('holder'), required: false, half: true },
        ],
      },
    ],
    contract: { layout: 2, enabled: true, required: true, labelSigns: true, copyPage: true, ...labelContract(fullName), accept: CONTRACT_TEXT.accept, style: { ...CONTRACT_STYLE } },
    done: fromPlain(d('done')),
    theme: DEFAULT_THEME,
  };
  return sanitizeForm(form);
}

export function blankForm(lang = 'en') {
  return sanitizeForm({ lang: lang === 'it' ? 'it' : 'en', title: DEF.blank[lang === 'it' ? 0 : 1], sections: [{ id: newId('s'), title: '', fields: [blankField('short')] }], theme: DEFAULT_THEME });
}
