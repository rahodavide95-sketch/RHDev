/* Come si mostrano gli importi, rispettando la "modalità privacy" (importi nascosti). */

import { h } from './dom.js';
import { formatMoney, formatCompact, formatPercent } from '../core/money.js';

export const ui = { privacy: false, base: 'EUR' };

const MASK = '••••';

/** Testo dell'importo (o i pallini se gli importi sono nascosti). */
export function moneyText(cents, cur = ui.base, opts) {
  return ui.privacy ? MASK : formatMoney(cents, cur, opts);
}
export const compactText = (cents, cur = ui.base) => (ui.privacy ? MASK : formatCompact(cents, cur));

/** Importo come elemento: colore per entrate/uscite se richiesto. opts: {sign, tone:'auto'|'pos'|'neg', cls} */
export function money(cents, cur = ui.base, opts = {}) {
  const tone = opts.tone === 'auto' ? (cents > 0 ? 'pos' : cents < 0 ? 'neg' : '') : opts.tone || '';
  return h('span.amt', { class: [tone && 'amt-' + tone, opts.cls, ui.privacy && 'masked'].filter(Boolean).join(' ') }, moneyText(cents, cur, opts));
}

/** Variazione percentuale con freccia. */
export function delta(pct, { invert = false } = {}) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const good = invert ? pct < 0 : pct > 0;
  const tone = Math.abs(pct) < 0.05 ? '' : good ? 'pos' : 'neg';
  return h('span.delta', { class: tone ? 'delta-' + tone : '' }, (pct > 0 ? '↑ ' : pct < 0 ? '↓ ' : '') + formatPercent(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0));
}

/** Formattatore per gli assi dei grafici (valori in centesimi). */
export const axisMoney = cents => (ui.privacy ? MASK : formatCompact(cents, ui.base).replace(/^(−?)\S+\s/, '$1'));
export const tipMoney = cents => moneyText(Math.round(cents));
