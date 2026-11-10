/* Contratto: testo del modulo + segnaposto riempiti con i dati dell'invio.
   Alla firma si "congela" una copia completa (testo, valori, firme) con la sua impronta SHA-256:
   chiunque la ricalcoli può verificare che il contratto firmato non sia stato cambiato. */

import { sanitizeRich, richToText } from './richtext.js';
import { fieldById, SYSTEM_PLACEHOLDERS, isStatic, fillText } from './schema.js';
import { sanitizeContractStyle } from './theme.js';
import { formatValue, formatDate } from './answers.js';
import { canonical, sha256hex } from './crypto.js';

export function clampPct(p) {
  const n = Math.round(Number(p));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
}

/** Titoli delle tracce: dal primo elenco ripetibile, primo campo di testo di ogni elemento. */
export function trackTitles(form, answers) {
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (f.type !== 'group') continue;
      const tf = f.fields.find(x => x.type === 'short');
      const vf = f.fields.find(x => x.type === 'short' && x !== tf && /vers|mix/i.test(x.label));
      if (!tf || !Array.isArray(answers[f.id])) continue;
      return answers[f.id].map(it => {
        const t = String((it && it[tf.id]) || '').trim();
        const v = vf ? String((it && it[vf.id]) || '').trim() : '';
        return t ? (v ? `${t} (${v})` : t) : '';
      }).filter(Boolean);
    }
  }
  return [];
}

/** Numero in lettere, in inglese come il contratto (0–100): 50 → "fifty", 66 → "sixty-six". */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numWord(n) {
  n = clampPct(n);
  if (n === 100) return 'one hundred';
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

/** Autori: i nomi nei crediti (split) con un ruolo da autore; se nessuno ha quel ruolo, tutti i nomi. */
export function writers(form, answers) {
  const rows = [];
  const take = (f, v) => { if (f.type === 'split' && Array.isArray(v)) rows.push(...v.filter(r => r && String(r.name || '').trim())); };
  for (const s of form.sections) for (const f of s.fields) {
    if (f.type === 'group' && Array.isArray(answers[f.id])) { for (const it of answers[f.id]) for (const sf of f.fields) take(sf, it && it[sf.id]); }
    else take(f, answers[f.id]);
  }
  const authors = rows.filter(r => /autor|compos|writer|author|lyric|testo|paroli/i.test(String(r.role || '')));
  const names = (authors.length ? authors : rows).map(r => String(r.name).trim());
  return [...new Set(names)].join(', ');
}

/** Valori dei segnaposto. ctx = { label, release, catalog, artist, artistPct }, date = 'AAAA-MM-GG'. */
export function contractValues(form, answers, ctx = {}, date = '') {
  const pct = clampPct(ctx.artistPct ?? 50);
  const v = {
    $label: String(ctx.label || ''),
    $release: String(ctx.release || ''),
    $catalog: ctx.catalog ? `(${ctx.catalog})` : '',
    $artist: String(ctx.artist || ''),
    $artistPct: String(pct),
    $labelPct: String(100 - pct),
    $artistPctWords: numWord(pct),
    $labelPctWords: numWord(100 - pct),
    $tracks: trackTitles(form, answers).join(', '),
    $writers: writers(form, answers),
    $date: date ? formatDate(date) : '',
  };
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (isStatic(f)) continue;
      v[f.id] = formatValue(f, answers[f.id]);
    }
  }
  return v;
}

/** Nome leggibile di un segnaposto (per l'editor). */
export function placeholderLabel(form, id) {
  if (SYSTEM_PLACEHOLDERS[id]) return SYSTEM_PLACEHOLDERS[id];
  const f = fieldById(form, id);
  return f ? f.label : 'campo eliminato';
}

/** Documento del contratto con i segnaposto sostituiti dal loro valore (stesso stile). */
export function fillContract(doc, values, blank = '________') {
  const fill = list => list.map(p => {
    if (p.f === undefined) return p;
    const { f, ...style } = p;
    const x = String(values[f] ?? '').trim();
    return x ? { ...style, x } : { ...style, x: blank, k: undefined };
  }).map(p => { if (p.k === undefined) delete p.k; return p; });
  return sanitizeRich(sanitizeRich(doc).map(b => b.li ? { ...b, li: b.li.map(fill) } : { ...b, c: fill(b.c) }));
}

/** Copia congelata del contratto firmato: testo, impaginazione, formattazione, valori e firme.
    Tutto quello che si vede è dentro la copia, quindi anche la forma è coperta dall'impronta. */
export function contractSnapshot({ form, answers, ctx, signature, labelSignature = '', inviteId }) {
  const c = form.contract;
  const values = contractValues(form, answers, ctx, signature.date);
  const doc = fillContract(c.body, values);
  const intro = fillContract(c.intro || [], values);
  const copy = c.copyPage === false ? [] : fillContract(c.copy || [], values, '—');
  const fullName = String(signature.name || '').trim();
  const vars = { label: String(ctx.label || ''), name: fullName || String(ctx.artist || '') };
  return {
    v: 2,
    inviteId,
    title: c.title,
    intro,
    doc,
    copyPage: c.copyPage !== false,
    copyTitle: c.copyTitle || '',
    copy,
    confirm: c.confirm || '',
    dateLabel: c.dateLabel || '',
    dateText: signature.date ? formatDate(signature.date) : '',
    labelRole: fillText(c.labelRole, vars),
    artistRole: fillText(c.artistRole, vars),
    blank: c.blank || '',
    style: sanitizeContractStyle(c.style),
    text: [richToText(intro), richToText(doc), richToText(copy)].filter(Boolean).join('\n\n'),
    accept: c.accept,
    label: String(ctx.label || ''),
    labelSigner: String(ctx.signer || ''),
    labelSignature: labelSignature || '',
    signature: {
      name: String(signature.name || '').slice(0, 120),
      place: String(signature.place || '').slice(0, 120),
      date: String(signature.date || ''),
      time: String(signature.time || ''),
      png: String(signature.png || ''),
    },
  };
}

export const contractHash = snap => sha256hex(canonical(snap));

export async function verifyContract(snap, hash) {
  if (!snap || !hash) return false;
  return (await contractHash(snap)) === hash;
}
