/* Registro dei collegamenti API: li collega al catalogo piattaforme e ai tipi di file.
   Un collegamento mancante (file non presente) viene semplicemente ignorato: la piattaforma resta "in arrivo". */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  CT.api = CT.api || {};

  const ids = () => Object.keys(CT.api).filter((k) => k !== 'common' && CT.api[k] && typeof CT.api[k].sync === 'function' && typeof CT.api[k].parse === 'function');

  function register() {
    for (const id of ids()) {
      const c = CT.api[id];
      const type = 'api_' + id;
      if (!CT.importers.TYPES[type]) {
        CT.importers.TYPES[type] = { label: `${c.label} · dati da API`, parse: (text, fileName) => c.parse(JSON.parse(text), fileName) };
      }
      const p = CT.PLATFORMS && CT.PLATFORMS[c.platform];
      if (p && !p.types.includes(type)) p.types.push(type);
    }
  }

  CT.api.ids = ids;
  CT.api.register = register;
  CT.api.forPlatform = (platformKey) => { const id = CT.PLATFORMS[platformKey] && CT.PLATFORMS[platformKey].api && CT.PLATFORMS[platformKey].api.connector; return id && CT.api[id] && typeof CT.api[id].sync === 'function' ? CT.api[id] : null; };
  register();
  if (typeof module !== 'undefined') module.exports = CT.api;
})();
