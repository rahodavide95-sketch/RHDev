/* Tabelle che entrano tutte nello schermo (Net Worth ed Entrate e uscite). D: "far entrare tutto…
   anche senza comprimere la barra", "cerca di far entrare tutto anche nelle entrate/uscite".
   Su computer le colonne (15) sono uguali e riempiono la pagina; carattere, decimali e simbolo €
   si scelgono misurando con un canvas l'importo e la percentuale più lunghi: prima si rimpicciolisce
   il carattere, poi si toglie "€" (che va nell'intestazione). I centesimi restano SEMPRE
   (D: "non devi MAI arrotondare nulla, voglio le cifre esatte"): se non c'entrano, la tabella scorre.
   Su telefono la tabella scorre. Cambiando la larghezza (anche aprendo o chiudendo la barra) la
   pagina si ridisegna se la scelta cambia. */

import { formatNumber } from '../core/money.js';

const measure = (txt, px) => {
  const c = measure.c || (measure.c = document.createElement('canvas').getContext('2d'));
  c.font = `700 ${px}px Inter, system-ui, sans-serif`;
  return c.measureText(txt).width;
};
const TRIES = [[14, 2, true], [13.5, 2, true], [13, 2, true], [12.5, 2, true], [12, 2, true], [13, 2, false], [12.5, 2, false], [12, 2, false], [11.5, 2, false], [11, 2, false], [10.5, 2, false]];

/** { first, per, dec, font, euro, pdec, short } o null (telefono: la tabella scorre). */
export function fitTable({ cols = 15, maxAbs = 0, maxPct = 0 } = {}) {
  const W = (document.getElementById('view')?.clientWidth || innerWidth) - 50;
  if (innerWidth < 760 || W < 820) return null;
  const first = W > 1700 ? 240 : W > 1350 ? 210 : W > 1000 ? 190 : 160;
  const per = (W - first) / cols - 12;      // spazio per il testo (tolti i margini della cella)
  // il numero più lungo scritto con zeri (cifre tutte larghe uguali), col segno
  const big = Math.floor(Math.abs(maxAbs) / 100) || 1;
  const sample = (dec, euro) => '+' + formatNumber(Number('9'.repeat(String(big).length)), dec, dec).replace(/\d/g, '0') + (euro ? ' €' : '');
  const bigPct = Math.floor(Math.abs(maxPct)) || 1;
  const pctSample = pd => '+' + formatNumber(Number('9'.repeat(String(bigPct).length)), pd, pd).replace(/\d/g, '0') + '%';
  const pick = TRIES.find(([f, dd, e]) => measure(sample(dd, e), f) <= per && measure(pctSample(0), f) <= per);
  // se nemmeno il carattere più piccolo basta (schermo stretto e numeri molto lunghi) la tabella
  // scorre di lato invece di tagliare le cifre
  if (!pick) return null;
  const [font, dec, euro] = pick;
  const pdec = [2, 1, 0].find(pd => measure(pctSample(pd), font) <= per) ?? 0;
  return { first, per: per + 12, dec, font, euro, pdec, short: measure('31/12/2025', font * 0.86) > per - 10 };    // con margine: le date intere solo se c'entrano larghe
}
export const fitSig = f => (f ? `${f.dec}|${f.font}|${f.first}|${f.euro}|${f.short}|${f.pdec}` : 'scroll');

/** La pagina `route` mostra una tabella adattata con la scelta `fit`; `again()` la rifà con la larghezza nuova. */
let watch = null, timer = 0;
export function watchFit(route, fit, again) { watch = { route, key: fitSig(fit), again }; }
addEventListener('resize', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!watch || !location.hash.startsWith(watch.route)) return;
    if (fitSig(watch.again()) !== watch.key) dispatchEvent(new CustomEvent('rhf-rerender'));
  }, 200);
});

/** Importo per le celle, sempre coi centesimi: senza "€" se non c'entra (resta nell'intestazione). */
export function fitMoney(fit, moneyText, base, privacy) {
  const noEuro = fit && !fit.euro;
  return (v, sign = false) => {
    if (v == null) return '';
    return noEuro && !privacy ? (sign && v > 0 ? '+' : '') + formatNumber(v / 100, 2, 2) : moneyText(v, base, { sign, decimals: 2 });
  };
}
