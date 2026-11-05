/* Contratto: testo del modulo + segnaposto riempiti con i dati dell'invio.
   Alla firma si "congela" una copia completa (testo, valori, firme) con la sua impronta SHA-256:
   chiunque la ricalcoli può verificare che il contratto firmato non sia stato cambiato. */

import { sanitizeRich, richToText } from './richtext.js';
import { fieldById, SYSTEM_PLACEHOLDERS } from './schema.js';
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
    $tracks: trackTitles(form, answers).join(', '),
    $date: date ? formatDate(date) : '',
  };
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (f.type === 'info') continue;
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
export function fillContract(doc, values) {
  const fill = list => list.map(p => {
    if (p.f === undefined) return p;
    const { f, ...style } = p;
    const x = String(values[f] ?? '').trim();
    return x ? { ...style, x } : { ...style, x: '________', k: undefined };
  }).map(p => { if (p.k === undefined) delete p.k; return p; });
  return sanitizeRich(sanitizeRich(doc).map(b => b.li ? { ...b, li: b.li.map(fill) } : { ...b, c: fill(b.c) }));
}

/** Copia congelata del contratto firmato. */
export function contractSnapshot({ form, answers, ctx, signature, labelSignature = '', inviteId }) {
  const values = contractValues(form, answers, ctx, signature.date);
  const doc = fillContract(form.contract.body, values);
  return {
    v: 1,
    inviteId,
    title: form.contract.title,
    doc,
    text: richToText(doc),
    accept: form.contract.accept,
    label: String(ctx.label || ''),
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
