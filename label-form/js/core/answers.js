/* Risposte di un artista: controllo, completezza (per la checklist), differenze tra due
   versioni (per gli avvisi di modifica) e testo leggibile (riepilogo, PDF, email). */

import { checkLink } from './links.js';
import { canonical } from './crypto.js';
import { tr } from './i18n.js';

/** Elementi senza risposta (testi, immagini, separatori): stessa lista di schema.js, senza importarla qui. */
const STATIC = new Set(['info', 'image', 'divider']);
const isStaticField = f => !!f && STATIC.has(f.type);

export const EMAIL_RE = /^[^@\s<>"]{1,64}@[^@\s<>"]{1,190}\.[a-z]{2,}$/i;

/* ─── IBAN e codici fiscali ─── */
export const compactIban = s => String(s || '').replace(/[\s.-]/g, '').toUpperCase();
const IBAN_LEN = { IT: 27, SM: 27, DE: 22, FR: 27, ES: 24, GB: 22, NL: 18, BE: 16, CH: 21, AT: 20, PT: 25, IE: 22, PL: 28, SE: 24, DK: 18, NO: 15, FI: 18, GR: 27, LU: 20, HR: 21, SI: 19, CZ: 24, SK: 24, HU: 28, RO: 24, BG: 22, LT: 20, LV: 21, EE: 20, MT: 31, CY: 28 };
export function ibanOk(s) {
  const v = compactIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  if (IBAN_LEN[v.slice(0, 2)] && IBAN_LEN[v.slice(0, 2)] !== v.length) return false;
  const r = v.slice(4) + v.slice(0, 4);
  let m = 0;
  for (const ch of r) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) m = (m * 10 + Number(d)) % 97;
  }
  return m === 1;
}
export const formatIban = s => compactIban(s).replace(/(.{4})/g, '$1 ').trim();

const CF_ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
export function italianCfOk(s) {
  const v = String(s || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = v[i];
    if (i % 2 === 0) sum += CF_ODD[c];
    else sum += /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === v[15];
}
export function partitaIvaOk(s) {
  const v = String(s || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(v) || /^0{11}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = Number(v[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
/** Codice fiscale italiano, partita IVA italiana o codice estero (formato libero ma sensato). */
export function taxIdProblem(s) {
  const raw = String(s || '').trim();
  const v = raw.replace(/[\s.-]/g, '').toUpperCase();
  const iv = v.replace(/^IT(?=\d{11}$)/, '');
  if (/^[A-Z]{6}[0-9LMNPQRSTUV]{2}/.test(v) && v.length === 16) return italianCfOk(v) ? '' : tr('Il codice fiscale non è corretto: controlla le lettere e i numeri.', 'The Italian tax code is not correct: check the letters and numbers.');
  if (/^\d{11}$/.test(iv)) return partitaIvaOk(iv) ? '' : tr('La partita IVA non è corretta.', 'The VAT number is not correct.');
  if (!/^[A-Z0-9/]{4,30}$/.test(v)) return tr('Scrivi il codice fiscale (o il codice equivalente del tuo paese).', 'Enter your tax ID (or your country\'s equivalent).');
  return '';
}

/* ─── Valori ─── */
const isStr = v => typeof v === 'string';
const trimmed = v => isStr(v) ? v.trim() : '';
export function isFilled(field, v) {
  if (isStaticField(field)) return false;
  switch (field.type) {
    case 'checks': return Array.isArray(v) && v.some(x => trimmed(x));
    case 'group': {
      if (!Array.isArray(v) || !v.length) return false;
      const req = field.fields.filter(sf => sf.required);
      return v.some(item => req.length ? req.every(sf => isFilled(sf, item && item[sf.id])) : field.fields.some(sf => isFilled(sf, item && item[sf.id])));
    }
    case 'split': return Array.isArray(v) && v.some(r => r && trimmed(r.name));
    default: return !!trimmed(typeof v === 'number' ? String(v) : v);
  }
}

export function parseNumber(v) {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (!/^-?\d{1,12}([.,]\d{1,6})?$/.test(s)) return NaN;
  return Number(s.replace(',', '.'));
}
const fmtNum = n => String(n).replace('.', ',');

/** Errore di un campo (stringa vuota = va bene). */
export function fieldProblem(field, v) {
  if (isStaticField(field)) return '';
  if (!isFilled(field, v)) {
    if (field.type === 'group' && field.required) return Array.isArray(v) && v.length ? tr('Completa i campi obbligatori qui sotto.', 'Fill in the required fields below.') : tr(`Aggiungi almeno ${Math.max(1, field.min || 1)} ${field.itemLabel.toLowerCase()}.`, `Add at least ${Math.max(1, field.min || 1)} ${field.itemLabel.toLowerCase()}.`);
    return field.required ? tr('Campo obbligatorio.', 'This field is required.') : '';
  }
  switch (field.type) {
    case 'short': case 'long':
      return v.length > field.maxLength ? tr(`Massimo ${field.maxLength} caratteri.`, `Maximum ${field.maxLength} characters.`) : '';
    case 'email': return EMAIL_RE.test(v.trim()) ? '' : tr('Indirizzo email non valido.', 'Invalid email address.');
    case 'phone': return /^\+?[\d\s().-]{6,24}$/.test(v.trim()) && (v.match(/\d/g) || []).length >= 6 ? '' : tr('Numero di telefono non valido.', 'Invalid phone number.');
    case 'number': {
      const n = parseNumber(v);
      if (n === null || Number.isNaN(n)) return tr('Scrivi un numero.', 'Enter a number.');
      if (!field.decimals && !Number.isInteger(n)) return tr('Scrivi un numero intero.', 'Enter a whole number.');
      if (field.min !== null && n < field.min) return tr(`Il minimo è ${fmtNum(field.min)}.`, `The minimum is ${field.min}.`);
      if (field.max !== null && n > field.max) return tr(`Il massimo è ${fmtNum(field.max)}.`, `The maximum is ${field.max}.`);
      return '';
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return tr('Data non valida.', 'Invalid date.');
      const d = new Date(v + 'T12:00:00');
      return Number.isNaN(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2200 ? tr('Data non valida.', 'Invalid date.') : '';
    }
    case 'link': { const r = checkLink(v, field.linkKind); return r.ok ? '' : r.error; }
    case 'choice': case 'select': return v.length > 300 ? tr('Risposta troppo lunga.', 'Answer too long.') : '';
    case 'checks': return v.length > 100 ? tr('Troppe scelte.', 'Too many choices.') : '';
    case 'iban': return ibanOk(v) ? '' : tr('IBAN non valido: controlla di averlo copiato tutto.', 'Invalid IBAN: check you copied all of it.');
    case 'taxid': return taxIdProblem(v);
    case 'split': {
      const rows = v.filter(r => r && (trimmed(r.name) || trimmed(String(r.pct ?? ''))));
      for (const r of rows) {
        if (!trimmed(r.name)) return tr('Scrivi il nome di ogni persona.', 'Enter the name of each person.');
        const p = parseNumber(r.pct);
        if (p === null || Number.isNaN(p) || p < 0 || p > 100) return tr(`Percentuale non valida per ${r.name.trim()}.`, `Invalid percentage for ${r.name.trim()}.`);
      }
      if (field.total100) {
        const tot = rows.reduce((a, r) => a + (parseNumber(r.pct) || 0), 0);
        if (Math.abs(tot - 100) > 0.01) return tr(`Le percentuali devono fare 100 (ora fanno ${fmtNum(Math.round(tot * 100) / 100)}).`, `Percentages must add up to 100 (now ${Math.round(tot * 100) / 100}).`);
      }
      return '';
    }
    case 'group': {
      if (v.length < (field.min || 0)) return tr(`Servono almeno ${field.min} ${field.itemLabel.toLowerCase()}.`, `At least ${field.min} ${field.itemLabel.toLowerCase()} needed.`);
      if (v.length > field.max) return tr(`Massimo ${field.max} ${field.itemLabel.toLowerCase()}.`, `Maximum ${field.max} ${field.itemLabel.toLowerCase()}.`);
      return '';
    }
    default: return '';
  }
}

/** Errori di una sezione: { idCampo: msg, 'idGruppo.n.idSottocampo': msg } */
export function sectionProblems(section, answers) {
  const out = {};
  for (const f of section.fields) {
    const v = answers[f.id];
    const p = fieldProblem(f, v);
    if (p) out[f.id] = p;
    if (f.type === 'group' && Array.isArray(v)) {
      v.forEach((item, i) => {
        for (const sf of f.fields) {
          const sp = fieldProblem(sf, item && item[sf.id]);
          if (sp) out[`${f.id}.${i}.${sf.id}`] = sp;
        }
      });
    }
  }
  return out;
}
export function formProblems(form, answers, { skipContract = false } = {}) {
  const out = {};
  for (const s of form.sections) if (!(skipContract && s.contract)) Object.assign(out, sectionProblems(s, answers));
  return out;
}

/** Pulizia delle risposte prima di salvarle: solo i campi del modulo, tipi giusti, lunghezze massime. */
function cleanValue(field, v) {
  const s = (x, max) => (isStr(x) ? x : x == null ? '' : String(x)).slice(0, max);
  if (isStaticField(field)) return undefined;
  switch (field.type) {
    case 'checks': return Array.isArray(v) ? v.filter(isStr).map(x => x.slice(0, 300)).slice(0, 100) : [];
    case 'split': return Array.isArray(v) ? v.slice(0, 30).map(r => ({ name: s(r && r.name, 120), role: s(r && r.role, 60), pct: s(r && r.pct, 12) })) : [];
    case 'group': return Array.isArray(v) ? v.slice(0, field.max).map(item => {
      const o = {};
      for (const sf of field.fields) { const c = cleanValue(sf, item && item[sf.id]); if (c !== undefined) o[sf.id] = c; }
      return o;
    }) : [];
    case 'iban': return compactIban(v).slice(0, 40);
    case 'long': return s(v, field.maxLength);
    case 'short': return s(v, field.maxLength);
    default: return s(v, 2000);
  }
}
export function cleanAnswers(form, answers, sectionFilter = () => true) {
  const out = {};
  for (const s of form.sections) {
    if (!sectionFilter(s)) continue;
    for (const f of s.fields) {
      const c = cleanValue(f, answers ? answers[f.id] : undefined);
      if (c !== undefined) out[f.id] = c;
    }
  }
  return out;
}
/** Divide le risposte tra la parte "contratto" (bloccata dopo la firma) e il resto. */
export function splitAnswers(form, answers) {
  return {
    main: cleanAnswers(form, answers, s => !s.contract),
    contract: cleanAnswers(form, answers, s => s.contract),
  };
}

/** Campi compilati (solo gli id, per la checklist dell'etichetta: nessun valore). */
export function filledIds(form, answers) {
  const out = [];
  for (const s of form.sections) for (const f of s.fields) if (!isStaticField(f) && isFilled(f, answers[f.id])) out.push(f.id);
  return out;
}

/** Campi principali cambiati tra due versioni. */
export function changedIds(form, before, after) {
  const out = [];
  for (const s of form.sections) for (const f of s.fields) {
    if (isStaticField(f)) continue;
    const a = before ? before[f.id] : undefined, b = after ? after[f.id] : undefined;
    const ea = !isFilled(f, a), eb = !isFilled(f, b);
    if (ea && eb) continue;
    if (canonical(a ?? null) !== canonical(b ?? null)) out.push(f.id);
  }
  return out;
}

/* ─── Testo leggibile ─── */
export function maskValue(field, text) {
  const t = String(text || '');
  if (!t) return '';
  if (field.type === 'iban') { const v = compactIban(t); return v.slice(0, 2) + '•• •••• ' + v.slice(-4); }
  if (t.length <= 4) return '••••';
  return t.slice(0, 1) + '•'.repeat(Math.min(8, Math.max(3, t.length - 3))) + t.slice(-2);
}

export function formatDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '');
}

/** Valore come testo. opts.mask = nasconde i dati riservati. */
export function formatValue(field, v, opts = {}) {
  if (!isFilled(field, v)) return '';
  let out;
  switch (field.type) {
    case 'checks': out = v.filter(x => trimmed(x)).join(', '); break;
    case 'date': out = formatDate(v); break;
    case 'iban': out = formatIban(v); break;
    case 'number': { const n = parseNumber(v); out = (Number.isNaN(n) || n === null ? String(v) : fmtNum(n)) + (field.unit ? ' ' + field.unit : ''); break; }
    case 'split': out = v.filter(r => r && trimmed(r.name)).map(r => `${r.name.trim()}${r.role ? ' (' + r.role + ')' : ''} ${fmtNum(parseNumber(r.pct) ?? 0)}%`).join(' · '); break;
    case 'group': out = v.map((item, i) => `${field.itemLabel} ${i + 1}: ` + field.fields.map(sf => {
      const t = formatValue(sf, item && item[sf.id], opts);
      return t ? `${sf.label}: ${t}` : '';
    }).filter(Boolean).join(' · ')).join('\n'); break;
    default: out = String(v).trim();
  }
  if (opts.mask && field.sensitive && field.type !== 'group') out = maskValue(field, out);
  return out;
}

/** Riepilogo come lista di righe { section, label, value } (per email e copie). */
export function summaryRows(form, answers, opts = {}) {
  const rows = [];
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (isStaticField(f)) continue;
      const value = formatValue(f, answers[f.id], opts);
      if (!value && opts.skipEmpty) continue;
      rows.push({ section: s.title, label: f.label, value });
    }
  }
  return rows;
}
