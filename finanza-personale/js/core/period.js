/* Periodo a scelta, uguale in ogni pagina (D: "anche nella panoramica, ovunque, devo avere la possibilità
   di mettere il range periodo che voglio").
   Valore: 6 | 12 | 24 | 36 (ultimi N mesi) | 'ytd' (quest'anno) | 'py' (l'anno scorso) | 'all' (da quando ci sono dati)
   | { from: 'AAAA-MM', to: 'AAAA-MM' } (da un mese a un altro). */
import { addMonthKey, diffMonths } from './dates.js';

const PRESETS = [6, 12, 24, 36, 'ytd', 'py', 'all'];
const MK = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isCustom = v => !!v && typeof v === 'object';

/** Un valore valido, altrimenti `def` (per quello letto dal dispositivo). */
export function cleanPeriod(v, def = 12) {
  if (PRESETS.includes(v)) return v;
  if (isCustom(v) && MK.test(v.from) && MK.test(v.to)) return { from: v.from, to: v.to };
  return def;
}

/**
 * I mesi del periodo, dentro i dati che ci sono: { from, to } (chiavi AAAA-MM) e `months` (dal più vecchio).
 * `last` è l'ultimo mese con dati (o quello di oggi), `first` il primo (se c'è).
 * Se il periodo cade tutto fuori dai dati, `months` è vuoto.
 */
export function resolvePeriod(v, last, first = null) {
  const Y = Number(last.slice(0, 4));
  let from, to = last;
  if (v === 'ytd') from = `${Y}-01`;
  else if (v === 'py') { from = `${Y - 1}-01`; to = `${Y - 1}-12`; }
  else if (v === 'all') from = first || last;
  else if (isCustom(v)) { from = v.from; to = v.to; if (from > to) [from, to] = [to, from]; }
  else from = addMonthKey(last, -((Number(v) || 12) - 1));
  if (first && from < first) from = first;
  if (to > last) to = last;
  const months = [];
  if (from <= to) for (let k = from; k <= to; k = addMonthKey(k, 1)) months.push(k);
  return { from, to, months };
}

/** I mesi da `from` a `to` compresi. */
export function monthsBetween(from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  for (let k = from; k <= to; k = addMonthKey(k, 1)) out.push(k);
  return out;
}

/** Lo stesso numero di mesi subito prima (per "rispetto al periodo prima"). */
export function previousPeriod({ from, to }) {
  const n = diffMonths(from + '-01', to + '-01') + 1;
  return { from: addMonthKey(from, -n), to: addMonthKey(from, -1) };
}
