/* Base comune dei collegamenti API: errori, firma HMAC, richieste con ripetizioni, attese.
   Regole di progetto:
   - le chiavi non compaiono MAI in errori, log, avvisi o dati scaricati;
   - se una richiesta fallisce dopo le ripetizioni la sincronizzazione si ferma: mai dati parziali spacciati per completi;
   - una risposta diversa dal previsto e' un errore 'format' (nessuna ipotesi). */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  CT.api = CT.api || {};

  class ApiError extends Error {
    /** code: 'network' | 'auth' | 'rate' | 'http' | 'format' | 'incomplete' | 'config' */
    constructor(code, message, detail) { super(message); this.name = 'ApiError'; this.code = code; this.detail = detail || {}; }
  }

  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  /** HMAC (default SHA-256) in esadecimale minuscolo, con Web Crypto (browser e Node >= 20). */
  async function hmacHex(secret, message, hash) {
    const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: hash || 'SHA-256' }, false, ['sign']);
    return hex(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message)));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Toglie da un URL/testo tutto cio' che somiglia a chiavi o firme. */
  function redact(text, secrets) {
    let t = String(text);
    for (const sec of secrets || []) if (sec && String(sec).length >= 4) t = t.split(String(sec)).join('***');   // valori delle chiavi note
    return t
      .replace(/([?&](?:signature|sig|api[_-]?key|apikey|key|secret|token)=)[^&\s]*/gi, '$1***')
      .replace(/("(?:api_key|apikey|sig|signature|secret|token)"\s*:\s*")[^"]*/gi, '$1***');
  }

  const NETWORK_MSG = 'Collegamento non riuscito: il browser ha bloccato la richiesta oppure manca la rete. Le piattaforme spesso non permettono il collegamento diretto da una pagina web, e dentro claude.ai la pagina non può contattare siti esterni: in quel caso usa i file.';

  /**
   * Esegue una richiesta e ritorna il JSON. `fetchImpl` e' iniettabile (test). Ripete su 429/418/5xx con attesa crescente.
   * o = { retries = 4, sleep, maxWaitMs = 30000, secrets: [chiave, segreto, ...] (rimossi da ogni messaggio d'errore) }
   */
  async function request(fetchImpl, url, init, o) {
    o = o || {};
    const wait = o.sleep || sleep;
    const retries = o.retries === undefined ? 4 : o.retries;
    let attempt = 0;
    for (;;) {
      let res;
      try { res = await fetchImpl(url, init || {}); }
      catch (e) { throw new ApiError('network', NETWORK_MSG, { url: redact(url, o.secrets) }); }
      if (res.status === 429 || res.status === 418 || res.status >= 500) {
        if (attempt < retries) {
          attempt++;
          const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
          await wait(ra > 0 ? Math.min(ra * 1000, o.maxWaitMs || 30000) : Math.min(o.maxWaitMs || 30000, 1000 * 2 ** attempt));
          continue;
        }
        throw new ApiError(res.status >= 500 ? 'http' : 'rate', res.status >= 500 ? `La piattaforma risponde con un errore (${res.status}).` : 'Troppe richieste: la piattaforma ha limitato l\'accesso. Riprova tra qualche minuto.', { status: res.status, url: redact(url, o.secrets) });
      }
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
      if (res.status === 401 || res.status === 403) throw new ApiError('auth', 'La piattaforma ha rifiutato le chiavi: controlla che siano corrette, attive e abilitate alla sola lettura (e che l\'accesso non sia limitato a un altro indirizzo IP).', { status: res.status, body: redact(text, o.secrets).slice(0, 300) });
      if (!res.ok) throw new ApiError('http', `La piattaforma ha risposto con un errore (${res.status}).`, { status: res.status, body: redact(text, o.secrets).slice(0, 300), url: redact(url, o.secrets) });
      if (body === null) throw new ApiError('format', 'La risposta della piattaforma non è nel formato atteso (non è JSON).', { text: redact(text, o.secrets).slice(0, 200), url: redact(url, o.secrets) });
      return body;
    }
  }

  CT.api.common = { ApiError, hmacHex, sleep, request, redact, NETWORK_MSG };
  CT.ApiError = ApiError;
  if (typeof module !== 'undefined') module.exports = CT.api.common;
})();
