/* Lingua della pagina dell'artista. L'area dell'etichetta resta in italiano (lingua "it");
   la pagina dell'artista e l'anteprima del modulo usano la lingua del modulo (predefinita: inglese). */

let current = 'it';
export const LANGS = { en: 'English', it: 'Italiano' };
export function setLang(l) { current = l === 'en' ? 'en' : 'it'; return current; }
export const getLang = () => current;
/** tr('testo italiano', 'English text') → quello della lingua attiva. */
export const tr = (it, en) => (current === 'en' ? en : it);
