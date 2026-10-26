/* ============================================================================
   ctx.js — contesto condiviso tra le schermate (riempito da app.js)
   Evita import circolari: le viste leggono e chiamano tutto da qui.
   ============================================================================ */
export const app = {
  globe: null,          // istanza del globo (globe.js)
  stats: null,          // statistiche correnti (stats.js)
  today: '',            // 'AAAA-MM-GG'
  route: { name: 'home', params: [] },
  refresh: () => {},    // ricalcola statistiche, aggiorna globo e vista
  render: () => {},     // ridisegna solo la vista corrente
  go: () => {},         // naviga (hash)
  setSheet: () => {},   // 'peek' | 'half' | 'full'
  openEditor: () => {},
  openCountry: () => {},
  openAuth: () => {},
  openShare: () => {},
  startRecap: () => {},
  pickOnGlobe: null,    // callback attiva quando si sceglie un punto sul globo
};
