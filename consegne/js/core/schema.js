/* Struttura di un modulo (come Google Moduli): sezioni, campi, contratto, aspetto.
   sanitizeForm() è la difesa: qualsiasi cosa arrivi (dal database, da un file, da un errore)
   esce come modulo valido, con id unici e limiti di lunghezza. */

import { sanitizeRich, fromPlain } from './richtext.js';
import { sanitizeTheme, DEFAULT_THEME } from './theme.js';
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
};
/** Tipi che si possono mettere dentro un elenco ripetibile. */
export const SUB_TYPES = ['short', 'long', 'email', 'phone', 'number', 'date', 'link', 'choice', 'checks', 'select', 'split', 'iban', 'taxid'];
/** Tipi che di solito sono dati riservati (nascosti nelle email). */
export const SENSITIVE_TYPES = ['iban', 'taxid'];

export const MUSIC_KEYS = ['Am (8A)', 'C (8B)', 'Em (9A)', 'G (9B)', 'Bm (10A)', 'D (10B)', 'F#m (11A)', 'A (11B)', 'C#m (12A)', 'E (12B)',
  'G#m (1A)', 'B (1B)', 'D#m (2A)', 'F# (2B)', 'A#m (3A)', 'C# (3B)', 'Fm (4A)', 'G# (4B)', 'Cm (5A)', 'D# (5B)', 'Gm (6A)', 'A# (6B)', 'Dm (7A)', 'F (7B)'];
export const SPLIT_ROLES = ['Autore', 'Compositore', 'Produttore', 'Remixer', 'Featuring', 'Editore'];

/** Segnaposto del contratto che non sono campi del modulo. */
export const SYSTEM_PLACEHOLDERS = {
  $label: 'Nome dell\'etichetta',
  $release: 'Titolo della release',
  $catalog: 'Numero di catalogo',
  $artist: 'Nome dell\'artista (dall\'invito)',
  $artistPct: '% all\'artista',
  $labelPct: '% all\'etichetta',
  $tracks: 'Titoli delle tracce',
  $date: 'Data della firma',
};

export const LIMITS = { sections: 30, fieldsPerSection: 80, fields: 300, options: 100, subFields: 20 };

const str = (v, max, d = '') => typeof v === 'string' ? v.slice(0, max) : d;
const bool = (v, d = false) => typeof v === 'boolean' ? v : d;
const numOrNull = v => v === '' || v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

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
    label: str(f.label, 300).trim() || (f.type === 'info' ? '' : FIELD_TYPES[f.type].label),
    help: sanitizeRich(f.help),
  };
  if (f.type === 'info') return o;
  o.required = bool(f.required);
  o.placeholder = str(f.placeholder, 200);
  o.half = bool(f.half);
  o.sensitive = bool(f.sensitive, SENSITIVE_TYPES.includes(f.type));
  if (!sub) o.checklist = bool(f.checklist, o.required);
  switch (f.type) {
    case 'short': o.maxLength = Math.min(2000, Math.max(1, Math.round(Number(f.maxLength) || 300))); break;
    case 'long': o.maxLength = Math.min(20000, Math.max(1, Math.round(Number(f.maxLength) || 5000))); break;
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
        o.fields = [{ id: sid, type: 'short', label: 'Titolo', help: [], required: true, placeholder: '', half: false, sensitive: false, maxLength: 300 }];
      }
      if (o.required && o.min < 1) o.min = 1;
      break;
    }
    default: break;
  }
  return o;
}

function cleanContract(c) {
  c = c && typeof c === 'object' ? c : {};
  return {
    enabled: bool(c.enabled),
    required: bool(c.required, true),
    title: str(c.title, 300).trim() || 'Contratto',
    body: sanitizeRich(c.body),
    labelSigns: bool(c.labelSigns, true),
    accept: str(c.accept, 300).trim() || 'Ho letto il contratto e lo accetto.',
  };
}

/** Modulo pulito e valido, qualunque cosa arrivi. */
export function sanitizeForm(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
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
    contract: cleanContract(f.contract),
    done: sanitizeRich(f.done),
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
export const answerFields = form => allFields(form).filter(x => x.field.type !== 'info');
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
  const base = { id: newId('f'), type, label: type === 'info' ? 'Titolo' : '', help: [], required: false };
  if (type === 'choice' || type === 'checks' || type === 'select') base.options = ['Opzione 1', 'Opzione 2'];
  if (type === 'group') { base.itemLabel = 'Elemento'; base.fields = [{ id: newId('f'), type: 'short', label: 'Titolo', required: true }]; base.min = 0; base.max = 20; }
  if (type === 'link') base.linkKind = 'files';
  return base;
}

/* ─── Contratto predefinito (lo stesso di Label Finance, con i segnaposto) ─── */
const P = (...c) => ({ t: 'p', a: 'j', c });
const T = x => ({ x });
const B = x => ({ x, b: 1 });
const F = f => ({ f });
function defaultContract(fullNameId) {
  return [
    { t: 'p', a: 'c', c: [{ x: 'This document is intended to clearly and transparently define the terms of the collaboration between the Artist and the Label.', i: 1 }] },
    { t: 'h2', c: [T('1. Declaration of ownership of rights')] },
    P(T('The Artist declares that they are the sole owner, or that they have obtained full authorization from all entitled parties, of the '), B('copyright and related rights necessary for the exploitation and release'), T(' of the track(s) covered by this agreement: '), F('$tracks'), T('.')),
    { t: 'h2', c: [T('2. Grant of rights')] },
    P(T('The Artist grants '), { f: '$label', b: 1 }, T(', as an independent project, the '), B('exclusive right'), T(', free of charge, with '), B('worldwide validity'), T(' and '), B('no time limitation'), T(', to release, distribute, communicate to the public and promote the track(s), in any format and on any digital platform, including as part of compilations (VA), EPs, singles or similar releases.')),
    P(T('This grant does '), B('not'), T(' constitute a transfer of authorship of the work, which shall remain with the Artist.')),
    { t: 'h2', c: [T('3. Warranties and indemnification')] },
    P(T('The Artist warrants that the track(s) is/are original and do not infringe the rights of third parties, including, by way of example, copyright, related rights or image rights.')),
    P(T('The Artist agrees to indemnify and hold the Label harmless from any claim, demand or damage arising from any breach of the above warranties.')),
    { t: 'h2', c: [T('4. Compensation and revenue split')] },
    P(T('Any proceeds derived from the exploitation of the released track(s) (including, by way of example and not limitation, digital sales and streaming) shall be considered '), B('net revenues'), T(', meaning revenues net of distribution platform fees, taxes and any refunds.')),
    P(T('Such net revenues shall first be applied to the '), B('recoupment of costs incurred by the Label'), T(', including, by way of example but not limited to: mastering, artwork, promotion, marketing and distribution.')),
    P(T('Once such costs have been fully recouped, the subsequent net revenues shall be split as follows: '), F('$artistPct'), B('% to the Artist and '), F('$labelPct'), B('% to the Label'), T(', unless otherwise agreed in writing by the parties.')),
    P(T('The methods and timing of accounting and payments shall depend on the distribution platform used. The Artist acknowledges that any compensation received may be subject to taxation and that the Label shall not be responsible for the Artist\'s personal tax obligations.')),
    { t: 'h2', c: [T('5. Nature of the project')] },
    P(T('The parties acknowledge that '), { f: '$label', b: 1 }, T(' operates as an independent project and is not structured as a company. This agreement constitutes a private authorization and an artistic collaboration.')),
    { t: 'h2', c: [T('6. Final provisions')] },
    P(T('This document constitutes the entire agreement between the parties with respect to the track(s) covered herein. Any amendments or additions must be agreed upon in writing.')),
    P(T('The submission and signature of this document shall constitute full acceptance of the terms set forth above.')),
    { t: 'h2', c: [T('7. Personal Data Processing')] },
    P(T('Pursuant to article 13 of the Regulation (EU) 2016/679 (GDPR), the Artist acknowledges that their personal data will be processed by '), F('$label'), T(', acting as Data Controller, exclusively for purposes related to the negotiation, execution and performance of this contract, as well as to the publication, distribution, promotion and administrative management of any revenues that may derive from the exploitation of the recordings.')),
    P(T('The processing of personal data is necessary for the performance of this contract (Art. 6(1)(b) GDPR). Personal data will be retained for the time strictly necessary and will not be disclosed to third parties except parties involved in digital distribution, promotion, rights management and technical/accounting/administrative services. The Artist may exercise their rights of access, rectification, erasure, restriction, portability and objection, and lodge a complaint with the competent Authority.')),
    { t: 'h2', c: [T('Label copy information')] },
    P(B('Release: '), F('$release'), T(' '), F('$catalog')),
    P(B('Artist / project name: '), F('$artist')),
    P(B('Full name: '), F(fullNameId)),
  ];
}

/** Il modulo di partenza: "Consegna release", con i campi concordati con l'etichetta. */
export function defaultForm() {
  const id = p => newId(p);
  const fullName = id('f');
  const form = {
    title: 'Consegna release',
    intro: fromPlain('Ciao! Qui ci mandi tutto quello che serve per la release: dati, bio, press kit, tracce, artwork e contratto.\nPuoi lasciare il modulo e riprenderlo: la bozza resta su questo dispositivo (tranne i dati bancari e fiscali, per sicurezza).'),
    shareWith: '',
    sections: [
      {
        id: id('s'), title: 'Artista', desc: [], contract: false, fields: [
          { id: id('f'), type: 'short', label: 'Nome d\'arte', required: true, checklist: true },
          { id: id('f'), type: 'email', label: 'Email', required: true, checklist: false, half: true },
          { id: id('f'), type: 'phone', label: 'Telefono', required: false, half: true },
          { id: id('f'), type: 'long', label: 'Bio', required: true, checklist: true, help: fromPlain('In inglese, 80–150 parole. Scrivi in terza persona.'), maxLength: 4000 },
          { id: id('f'), type: 'link', label: 'Instagram', linkKind: 'social', half: true },
          { id: id('f'), type: 'link', label: 'SoundCloud', linkKind: 'social', half: true },
          { id: id('f'), type: 'link', label: 'Spotify', linkKind: 'music', half: true },
          { id: id('f'), type: 'link', label: 'Resident Advisor', linkKind: 'social', half: true },
        ],
      },
      {
        id: id('s'), title: 'Press kit', desc: [], contract: false, fields: [
          { id: id('f'), type: 'link', label: 'Cartella press (foto e logo)', linkKind: 'files', required: true, checklist: true,
            help: fromPlain('Foto in alta risoluzione (almeno 3000 px) e logo in PNG trasparente, in una cartella condivisa.') },
        ],
      },
      {
        id: id('s'), title: 'Tracce', desc: [], contract: false, fields: [
          {
            id: id('f'), type: 'group', label: 'Tracce', itemLabel: 'Traccia', required: true, checklist: true, min: 1, max: 20,
            fields: [
              { id: id('f'), type: 'short', label: 'Titolo', required: true, half: true },
              { id: id('f'), type: 'short', label: 'Versione / mix', placeholder: 'Original Mix', half: true },
              { id: id('f'), type: 'link', label: 'Link al WAV', linkKind: 'audio', required: true, help: fromPlain('WAV 24 bit, 44,1 kHz o superiore.') },
              { id: id('f'), type: 'number', label: 'BPM', required: true, min: 60, max: 220, decimals: true, half: true },
              { id: id('f'), type: 'select', label: 'Tonalità', options: MUSIC_KEYS, half: true },
              { id: id('f'), type: 'split', label: 'Crediti e split', total100: true, required: true },
            ],
          },
        ],
      },
      {
        id: id('s'), title: 'Artwork', desc: [], contract: false, fields: [
          { id: id('f'), type: 'link', label: 'Artwork', linkKind: 'files', required: false, checklist: true, help: fromPlain('3000 × 3000 px, JPG o PNG. Se lo prepara l\'etichetta lascia vuoto.') },
        ],
      },
      {
        id: id('s'), title: 'Dati per il contratto', contract: true,
        desc: fromPlain('Questi dati finiscono nel contratto: dopo la firma non si possono più modificare.'),
        fields: [
          { id: fullName, type: 'short', label: 'Nome e cognome', required: true, checklist: false },
          { id: id('f'), type: 'date', label: 'Data di nascita', required: true, half: true, sensitive: true, checklist: false },
          { id: id('f'), type: 'taxid', label: 'Codice fiscale / Tax ID', required: true, half: true, checklist: false },
          { id: id('f'), type: 'short', label: 'Indirizzo di residenza', required: true, sensitive: true, checklist: false },
          { id: id('f'), type: 'iban', label: 'IBAN per i pagamenti', required: false, half: true },
          { id: id('f'), type: 'short', label: 'Intestatario del conto', required: false, half: true },
        ],
      },
    ],
    contract: {
      enabled: true, required: true, labelSigns: true,
      title: 'Authorization to release and collaboration agreement',
      body: defaultContract(fullName),
      accept: 'I have read, understood and accepted the terms of this agreement.',
    },
    done: fromPlain('Grazie! Abbiamo ricevuto tutto. Ti scriviamo noi se manca qualcosa.'),
    theme: DEFAULT_THEME,
  };
  return sanitizeForm(form);
}

export function blankForm() {
  return sanitizeForm({ title: 'Nuovo modulo', sections: [{ id: newId('s'), title: '', fields: [blankField('short')] }], theme: DEFAULT_THEME });
}
