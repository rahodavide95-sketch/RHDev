/* Crypto.com Exchange: collegamento API REST v1 (sola lettura) chiamata direttamente dal browser.

   FONTI (le pagine ufficiali sono state lette tramite il mirror GitHub che le riproduce byte per byte, perche' dal
   sandbox exchange-developer.crypto.com / exchange-docs.crypto.com non sono raggiungibili):
   [D0] https://exchange-developer.crypto.com/exchange/v1/docs/api/rest-common-api-reference  (ufficiale)
   [D1] .../docs/api/rest/private-get-trades                  [D2] .../docs/api/rest/private-get-deposit-history
   [D3] .../docs/api/rest/private-get-withdrawal-history      [D4] .../docs/api/rest/private-create-withdrawal
   [D5] .../docs/api/rest/private-get-currency-networks       [D6] .../docs/api/rest/private-staking-get-reward-history
   [D7] .../docs/api/rest/private-fiat-fiat-deposit-history   [D8] .../docs/api/rest/private-get-transactions
   [M]  https://github.com/justrhoto/crypto-com-exchange-docs (mirror NON ufficiale, aggiornato ogni notte)
   [C]  https://github.com/ccxt/ccxt/blob/master/ts/src/cryptocom.ts (libreria open source molto diffusa)

   VERIFICATO sulla fonte
   - Radice REST di produzione https://api.crypto.com/exchange/v1/{metodo}; richieste POST con Content-Type: application/json [D0].
   - Corpo: id, method, api_key, params, nonce (ms), sig; "tutti i numeri devono essere stringhe tra virgolette" [D0].
   - Firma: HMAC-SHA256 esadecimale con il segreto come chiave sul testo  method + id + api_key + stringaParametri + nonce;
     la stringa dei parametri si ottiene ordinando le chiavi in ordine crescente e concatenando chiave + valore, senza spazi,
     con ricorsione per oggetti e liste e "null" per i valori nulli [D0, esempi JavaScript e Python]. Conferma in [C] sign().
     La documentazione NON pubblica un vettore con l'hash atteso: i test usano vettori calcolati con l'algoritmo ufficiale.
   - Risposta: code 0 = successo; i codici 40101/40103/40104 (401), 40102 (nonce oltre 60 secondi), 42901 (429) [D0].
     Il codice di errore compare nel corpo e coincide con lo stato HTTP: qui si gestisce comunque anche code != 0 con HTTP 200.
   - Limiti: private/get-trades 1 richiesta al secondo; "tutti gli altri" 3 richieste ogni 100 ms, per metodo e per chiave [D0].
   - private/get-trades [D1]: start_time (incluso) / end_time (escluso) in ms o ns, "nanosecondi consigliati per una paginazione
     accurata"; limit predefinito e massimo 100; senza start_time si legge solo 1 giorno; campi traded_quantity, traded_price,
     fees ("segno negativo = addebito sul saldo, al netto dei crediti commissione"), fee_instrument_name, trade_id, side,
     instrument_name, create_time, create_time_ns, transact_time_ns, isolation_id/isolation_type (margine isolato).
     L'ordine delle righe NON e' dichiarato.
   - private/get-deposit-history [D2]: start_ts/end_ts in ms (predefinito: ultimi 90 giorni), page (da 0) e page_size
     (predefinito 20, massimo 200). Campi di deposit_list DOCUMENTATI in [D2]: address, amount, create_time (ms), currency, fee,
     id, status (0 non arrivato, 1 arrivato, 2 fallito, 3 in attesa), update_time. txid NON e' tra i campi documentati di [D2]
     (compare solo nell'esempio di deposito di [C]): si legge come facoltativo e serve solo come riferimento.
   - private/get-withdrawal-history [D3]: stessi parametri di [D2]. Campi di withdrawal_list DOCUMENTATI in [D3]: address, amount,
     client_wid, create_time, currency, fee, id, network_id (solo se la valuta ha piu' reti), status (0 in attesa, 1 in
     elaborazione, 2 rifiutato, 3 pagamento in corso, 4 pagamento fallito, 5 completato, 6 annullato), txid, update_time.
     In [D3] create_time e' descritto solo come "Creation timestamp" (senza unita'): l'esempio e [C] mostrano millisecondi.
   - Codici di errore transitori elencati in [D0]: 408 / 40801 REQUEST_TIMEOUT, 400 / 50001 ERR_INTERNAL, 429 / 42901
     TOO_MANY_REQUESTS; 400 / 40005 INVALID_DATE, 40004 MISSING_OR_INVALID_ARGUMENT, 40001 BAD_REQUEST.
   - private/staking/get-reward-history [D6]: "Min: end_time - 180 giorni": per lo staking la profondita' e' limitata.
   - private/fiat/fiat-deposit-history [D7]: la risposta 200 NON e' descritta nella documentazione (quindi non si scarica).
   - private/get-transactions [D8] elenca journal_type come AUTO_CONVERSION, MANUAL_CONVERSION, ADJUSTMENT, SUBACCOUNT_TX: private/get-trades
     dichiara solo journal_type TRADING, quindi conversioni, rettifiche e sottoconti NON sono in questo elenco (non scaricati).

   ASSUNTO (non confermato da una fonte ufficiale: dichiarato anche negli avvisi)
   - Finestra massima di 24 ore per private/get-trades: [C] scrive "maximum date range is one day" e la documentazione indica
     solo "predefinito: end_time - 1 giorno". Si usano finestre di 23h59m59s: se il limite non esiste si e' solo piu' lenti.
   - Finestra massima di 90 giorni per i depositi e i prelievi: [C] scrive "90 days date range", [D2/D3] "predefinito 90 giorni".
     Si usano finestre di 89 giorni con 1 ora di sovrapposizione (i doppioni si eliminano con l'id).
   - Profondita' dello storico offerta dalla piattaforma: NON dichiarata ([D1] dice anzi che private/get-trades "should primarily
     be used for recovery"). Si parte da una data di inizio (predefinita 01/10/2019, prima dell'apertura in beta di novembre 2019
     riportata da fonti di stampa non verificabili da qui), ma NON si puo' sapere se il server restituisce tutto cio' che e'
     piu' vecchio: per questo coverage.complete e' SEMPRE false per operazioni, depositi e prelievi (anche con zero righe, che
     non distingue un conto vuoto da uno storico non raggiungibile). L'utente confronta la prima data scaricata con la propria
     prima operazione e conferma con il meccanismo di conferma dell'interfaccia.
   - Prelievi: la documentazione NON dice se "amount" comprende gia' la commissione di rete ([D3]: "Withdrawal amount" e
     "Withdrawal fee"; l'esempio di [D4] mostra amount "1" e fee "0.0004" senza chiarire il saldo). Nessun indizio e' affidabile:
     in [D5] withdrawal_fee puo' essere null (AGLD) e min_withdrawal_amount non e' sempre il doppio della commissione. Percio'
     NON c'e' un valore predefinito: finche' l'utente non sceglie l'opzione "feeIncluded" (si/no) ogni prelievo con commissione
     diversa da zero (o senza commissione indicata) diventa "non riconosciuto", come per i depositi (mai ipotesi). La scelta
     dell'utente si applica a tutti i prelievi ed e' dichiarata negli avvisi come scelta, non come fatto documentato.
   - Depositi: se fee != 0 non e' documentato se amount sia lordo o netto: la riga diventa "non riconosciuta" (mai ipotesi).
   - Ripetizione degli errori transitori: 408/40801, 50001 e 42901 (anche se consegnato con HTTP 200) vengono ripetuti fino a 4
     volte con attese di 2, 4, 8, 16 secondi (la firma si rifa a ogni tentativo); che siano davvero transitori e' un'interpretazione
     prudente dei nomi dei codici in [D0]. Dopo i tentativi la sincronizzazione si ferma con errore (nessun dato parziale).
   - Il campo su cui i depositi/prelievi (create_time o update_time) e le operazioni (create_time_ns o transact_time_ns) vengono
     filtrati per tempo non e' dichiarato: la scansione per finestre sovrapposte e la divisione delle pagine piene
     prendono i confini in modo prudente su tutti i campi.
   - I numeri possono arrivare come numeri JSON invece che come stringhe (esempi di [C]): si accettano solo se esatti
     (al massimo 15 cifre significative), altrimenti errore 'format'.
   - Il margine su coppie spot non e' distinguibile in private/get-trades (solo l'isolato ha isolation_id).

   UNITA': le quantita' sono quelle della piattaforma (cripto: unita' dell'asset). Nessun metallo prezioso su questo conto. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  CT.api = CT.api || {};
  const { D, FIAT, Kind, mkEvent } = CT;

  const ID = 'cryptocom_exchange';
  const PLATFORM = 'cryptocom_exchange';
  const LABEL = 'Crypto.com Exchange';
  const ROOT = 'https://api.crypto.com/exchange/v1/';
  const common = () => CT.api.common;
  const ApiError = (...a) => new (CT.api.common.ApiError)(...a);

  // ---------------------------------------------------------------- costanti
  const DAY = 86400000;
  const NS = 1000000n;                       // ns per ms
  const FLOOR = '2019-10-01';                // data di inizio predefinita (vedi ASSUNTO)
  const HARD_FLOOR = '2018-01-01';
  const TRADE_LIMIT = 100;                   // massimo documentato di righe per richiesta
  const TRADE_WINDOW_MS = DAY - 1000;        // sotto il massimo (assunto) di 24 ore
  const TRADE_OVERLAP_MS = 1000;
  const TRADE_STEP_MS = TRADE_WINDOW_MS - TRADE_OVERLAP_MS;
  const TRADE_PACE_MS = 1050;                // limite documentato: 1 richiesta al secondo
  const TRADE_TOL_NS = 1000000000n;          // tolleranza (1 s) sul controllo "riga dentro la finestra"
  const TRADE_MAX_REQ_PER_WINDOW = 200;
  const WALLET_WINDOW_MS = 89 * DAY;         // sotto il massimo (assunto) di 90 giorni
  const WALLET_OVERLAP_MS = 3600000;
  const WALLET_PAGE = 200;                   // massimo documentato di page_size
  const WALLET_PACE_MS = 150;                // limite documentato: 3 richieste ogni 100 ms
  const WALLET_MAX_PAGES = 500;
  const NONCE_TOL_MS = 60000;
  const NET_RETRIES = 4;                     // errori di rete (dopo almeno una risposta) e codici transitori: si riprova (2, 4, 8, 16 s)

  const DEPOSIT_STATUS_OK = '1';
  const DEPOSIT_STATUS_IGNORED = { 0: 'non ancora arrivato', 2: 'fallito', 3: 'in attesa' };
  const WITHDRAWAL_STATUS_OK = '5';
  const WITHDRAWAL_STATUS_IGNORED = { 2: 'rifiutato', 4: 'pagamento fallito', 6: 'annullato' };
  const WITHDRAWAL_STATUS_PENDING = { 0: 'in attesa', 1: 'in elaborazione', 3: 'pagamento in corso' };

  const K_TRADES = 'private/get-trades';
  const K_DEPOSITS = 'private/get-deposit-history';
  const K_WITHDRAWALS = 'private/get-withdrawal-history';

  // ---------------------------------------------------------------- firma
  /** Stringa dei parametri come nell'esempio JavaScript ufficiale: chiavi ordinate, chiave + valore, ricorsione, null -> "null". */
  function paramsToString(obj) {
    const isObj = (o) => o !== undefined && o !== null && o.constructor === Object;
    const isArr = (o) => Array.isArray(o);
    const arr = (a) => a.reduce((s, b) => s + (isObj(b) ? objStr(b) : (isArr(b) ? arr(b) : String(b))), '');
    function objStr(o) {
      return Object.keys(o).sort().reduce((s, k) => s + k + (isArr(o[k]) ? arr(o[k]) : (isObj(o[k]) ? objStr(o[k]) : String(o[k]))), '');
    }
    return obj === undefined || obj === null ? '' : objStr(obj);
  }

  /** Aggiunge `sig` a {id, method, api_key, params, nonce}. */
  async function signRequest(req, secret) {
    const payload = req.method + req.id + req.api_key + paramsToString(req.params) + req.nonce;
    return Object.assign({}, req, { sig: await common().hmacHex(secret, payload) });
  }

  // ---------------------------------------------------------------- lettura sicura dei campi
  const DEC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  /** Decimale esatto come stringa, oppure null. I numeri JSON si accettano solo se hanno al massimo 15 cifre significative. */
  function decStr(v) {
    if (typeof v === 'string') { const t = v.trim(); return DEC_RE.test(t) ? t : null; }
    if (typeof v === 'number') return Number.isFinite(v) && Number(v.toPrecision(15)) === v ? String(v) : null;
    return null;
  }
  function idStr(v) {
    if (typeof v === 'string') { const t = v.trim(); return /^[A-Za-z0-9_.:-]{1,64}$/.test(t) ? t : null; }
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
    return null;
  }
  /** Millisecondi Unix (13 cifre) oppure null. */
  function msVal(v) {
    if (typeof v === 'string' && /^\d{13}$/.test(v.trim())) return Number(v.trim());
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1e12 && v < 1e13) return v;
    return null;
  }
  /** Nanosecondi Unix (19 cifre, solo come stringa: un numero JSON perderebbe precisione) oppure null. */
  function nsVal(v) { return typeof v === 'string' && /^\d{19}$/.test(v.trim()) ? BigInt(v.trim()) : null; }
  /** Commissione presente e uguale a zero (se manca o non e' leggibile NON e' zero). */
  function feeIsZero(v) { const t = decStr(v); return t !== null && D(t).isZero(); }
  const isObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const upper = (s) => String(s).trim().toUpperCase();
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const cmpBig = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const cmpId = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? cmpBig(BigInt(a), BigInt(b)) : (a < b ? -1 : a > b ? 1 : 0));

  // ---------------------------------------------------------------- forma delle righe
  /** Analizza una riga di private/get-trades. problems = cio' che manca o non e' interpretabile. */
  function tradeInfo(r) {
    const p = [];
    if (!isObject(r)) return { problems: ['la riga non e\' un oggetto'] };
    const id = idStr(r.trade_id); if (!id) p.push('trade_id');
    const inst = typeof r.instrument_name === 'string' ? r.instrument_name.trim() : ''; if (!inst) p.push('instrument_name');
    const side = typeof r.side === 'string' ? r.side.trim().toUpperCase() : ''; if (side !== 'BUY' && side !== 'SELL') p.push('side');
    const qty = decStr(r.traded_quantity); if (qty === null) p.push('traded_quantity');
    const price = decStr(r.traded_price); if (price === null) p.push('traded_price');
    const fees = decStr(r.fees); if (fees === null) p.push('fees');
    const c = nsVal(r.create_time_ns), ms = msVal(r.create_time), t = nsVal(r.transact_time_ns);
    const k = c !== null ? c : (ms !== null ? BigInt(ms) * NS : null);
    if (k === null) p.push('create_time_ns/create_time');
    const m = ms !== null ? BigInt(ms) * NS : (k !== null ? (k / NS) * NS : null);
    const times = [k, m, t].filter((x) => x !== null);
    const min = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null, max = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
    return { problems: p, id, inst, side, qty, price, fees, keyNs: k, k, m, t, minNs: min, maxNs: max };
  }

  /** Analizza una riga di deposito o prelievo. */
  function walletInfo(r) {
    const p = [];
    if (!isObject(r)) return { problems: ['la riga non e\' un oggetto'] };
    const id = idStr(r.id); if (!id) p.push('id');
    const cur = typeof r.currency === 'string' ? upper(r.currency) : ''; if (!cur) p.push('currency');
    const amount = decStr(r.amount); if (amount === null) p.push('amount');
    let fee = null;
    if (r.fee !== undefined && r.fee !== null) { fee = decStr(r.fee); if (fee === null) p.push('fee'); }
    const status = typeof r.status === 'string' || typeof r.status === 'number' ? String(r.status).trim() : ''; if (!/^\d+$/.test(status)) p.push('status');
    const ms = msVal(r.create_time); if (ms === null) p.push('create_time');
    return { problems: p, id, cur, amount, fee, status, ms };
  }

  const formatErr = (method, what, detail) => ApiError('format', `La risposta della piattaforma (${method}) non ha la forma documentata: ${what}.`, Object.assign({ method }, detail || {}));

  // ---------------------------------------------------------------- chiamate
  const AUTH_HELP = ' Se le chiavi sono giuste, la chiave potrebbe non poter leggere depositi e prelievi: NON abilitare il permesso di prelievo, usa invece il file di depositi e prelievi.';
  const isWalletMethod = (m) => m === K_DEPOSITS || m === K_WITHDRAWALS;

  /** Messaggi chiari per i codici documentati [D0]. */
  function codeError(code, message, method, secrets) {
    const detail = { method, platformCode: code };
    if (code === 40102) return ApiError('config', 'L\'orologio del computer non è allineato: la piattaforma accetta uno scarto massimo di 60 secondi. Sincronizza data e ora del computer e riprova.', detail);
    if (code === 40103) return ApiError('auth', 'Questa chiave è limitata ad alcuni indirizzi IP e quello da cui stai usando la pagina non è tra quelli. Aggiungi il tuo indirizzo IP alla chiave oppure togli la limitazione.', detail);
    if (code === 40104) return ApiError('auth', 'La piattaforma non permette l\'accesso API con il livello del tuo account.', detail);
    if (code === 40101) return ApiError('auth', 'La piattaforma ha rifiutato le chiavi: controlla che siano corrette, attive e abilitate alla lettura.' + (isWalletMethod(method) ? AUTH_HELP : ''), detail);
    if (code === 42901) return ApiError('rate', 'Troppe richieste: la piattaforma ha limitato l\'accesso. Riprova tra qualche minuto.', detail);
    if (code === 40005) return ApiError('http', 'La piattaforma ha rifiutato l\'intervallo di date richiesto (codice 40005, data non valida). Può dipendere da una data di inizio troppo lontana nel passato (prova con una data più recente) oppure da limiti sugli intervalli che non sono documentati: in quel caso usa i file.', detail);
    if (code === 40004) return ApiError('http', 'La piattaforma ha rifiutato la richiesta perché manca un parametro obbligatorio o ha un valore non valido (codice 40004).', detail);
    if (code === 40001) return ApiError('http', 'La piattaforma ha rifiutato la richiesta perché non valida (codice 40001).', detail);
    const msg = common().redact(String(message === undefined || message === null ? '' : message), secrets).slice(0, 120);
    return ApiError('http', `La piattaforma ha risposto con un errore (codice ${code}${msg ? ': ' + msg : ''}).`, detail);
  }

  /** Dal corpo (gia' ripulito dalle chiavi) di una risposta HTTP non riuscita, il codice della piattaforma. */
  function platformCodeOf(bodyText) {
    const m = /"code"\s*:\s*"?(-?\d+)"?/.exec(String(bodyText || ''));
    return m ? Number(m[1]) : null;
  }
  /** Dal corpo (ripulito e troncato) il testo del campo message, se c'e'. */
  function messageOf(bodyText) {
    const m = /"message"\s*:\s*"([^"]*)"/.exec(String(bodyText || ''));
    return m ? m[1] : '';
  }

  // codici documentati [D0] che si ripetono (vedi ASSUNTO): REQUEST_TIMEOUT, ERR_INTERNAL, TOO_MANY_REQUESTS
  const TRANSIENT_CODES = new Set([40801, 50001, 42901]);

  function makeCaller(o) {
    let seq = 0;
    return async function call(method, params) {
      const id = String(++seq);
      const url = ROOT + method;
      const secrets = [o.apiKey, o.apiSecret];
      let signError = null;
      // la firma si rifa ad ogni tentativo: dopo le attese per i limiti il nonce vecchio supererebbe i 60 secondi
      const signed = async () => {
        let body;
        try {
          const nonce = String(o.now().getTime());
          body = JSON.stringify(await signRequest({ id, method, api_key: o.apiKey, params, nonce }, o.apiSecret));
        } catch (e) {
          // common.request trasforma ogni eccezione della funzione di rete in 'network': l'errore vero si conserva qui e si rilancia sotto
          signError = ApiError('config', 'Il browser non permette di calcolare la firma (serve una pagina in contesto sicuro, https o file locale).', { method });
          throw signError;
        }
        // fetch si chiama come funzione "nuda": il fetch del browser, invocato come metodo di un altro oggetto, lancia "Illegal invocation"
        const doFetch = o.fetch;
        return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'omit' });
      };
      for (let attempt = 0; ; attempt++) {
        let json = null, failure = null;
        try {
          json = await common().request(signed, url, {}, { sleep: o.sleep, secrets });
          o.reached = true;
        } catch (e) {
          if (signError) throw signError;
          if (!(e instanceof CT.api.common.ApiError)) throw e;
          failure = e;
        }
        if (failure) {
          const pc = platformCodeOf(failure.detail && failure.detail.body);
          // un'interruzione di rete a meta' di uno scaricamento lungo non deve far perdere tutto: si riprova.
          // Se la piattaforma non e' mai stata raggiunta (rete assente, collegamento bloccato dal browser) ci si ferma subito.
          const wasReached = o.reached;
          if (failure.code !== 'network') o.reached = true;          // ha risposto qualcuno: la piattaforma e' raggiungibile
          const transient = failure.code === 'network'
            ? wasReached
            : failure.code === 'http' && ((failure.detail && failure.detail.status === 408) || TRANSIENT_CODES.has(pc));
          if (transient && attempt < NET_RETRIES) { await o.sleep(2000 * 2 ** attempt); continue; }
          if (pc === 40102 || pc === 40103 || pc === 40104) throw codeError(pc, '', method, secrets);
          if (failure.code === 'auth' && isWalletMethod(method)) throw ApiError('auth', failure.message + AUTH_HELP, Object.assign({ method }, failure.detail));
          if (failure.code === 'http' && pc !== null) {
            // il codice della piattaforma deve comparire nel messaggio (es. 40005 = date non accettate)
            const err = codeError(pc, messageOf(failure.detail.body), method, secrets);
            err.detail = Object.assign({}, failure.detail, err.detail);
            throw err;
          }
          failure.detail = Object.assign({ method }, failure.detail);
          throw failure;
        }
        if (!isObject(json)) throw formatErr(method, 'la risposta non è un oggetto');
        const code = typeof json.code === 'string' && /^-?\d+$/.test(json.code.trim()) ? Number(json.code.trim()) : json.code;
        if (!Number.isInteger(code)) throw formatErr(method, 'manca il campo code');
        if (code !== 0) {
          // anche con HTTP 200 il corpo puo' portare un errore transitorio (es. 42901): stesse attese e stesso numero di tentativi
          if (TRANSIENT_CODES.has(code) && attempt < NET_RETRIES) { await o.sleep(2000 * 2 ** attempt); continue; }
          throw codeError(code, json.message, method, secrets);
        }
        if (json.method !== undefined && json.method !== method) throw formatErr(method, 'la risposta riguarda un altro metodo');
        if (!isObject(json.result)) throw formatErr(method, 'manca il campo result');
        return json.result;
      }
    };
  }

  /** Attesa tra richieste dello stesso tipo (limiti per metodo): conta anche il tempo gia' trascorso. */
  function makePacer(ms, now, sleep, signal) {
    let last = null;
    return async () => {
      if (signal && signal.aborted) throw ApiError('incomplete', 'Scaricamento interrotto: i dati ricevuti finora non sono stati salvati.');
      if (last !== null) { const w = ms - (now().getTime() - last); if (w > 0) await sleep(w); }
      last = now().getTime();
    };
  }

  // ---------------------------------------------------------------- scansione
  /** Operazioni spot: finestre di meno di 24 ore; una pagina piena (100 righe) si divide senza presumere l'ordine. */
  async function scanTrades(call, startMs, endMs, ctx) {
    const rows = new Map();
    const total = Math.max(1, Math.ceil((endMs - startMs) / TRADE_STEP_MS));
    let k = 0;

    async function scanWindow(sNs, eNs) {
      const stack = [[sNs, eNs]];
      let requests = 0;
      while (stack.length) {
        const [s, e] = stack.pop();
        if (++requests > TRADE_MAX_REQ_PER_WINDOW) { ctx.problems.push(`Operazioni del ${isoDay(Number(sNs / NS))}: troppe richieste per esaurire il giorno.`); return; }
        await ctx.pace();
        const result = await call(K_TRADES, { start_time: String(s), end_time: String(e), limit: TRADE_LIMIT });
        if (!Array.isArray(result.data)) throw formatErr(K_TRADES, 'data non è un elenco');
        if (result.data.length > TRADE_LIMIT) throw formatErr(K_TRADES, `la pagina contiene più di ${TRADE_LIMIT} righe`);
        const infos = result.data.map((r) => {
          const i = tradeInfo(r);
          if (i.problems.length) throw formatErr(K_TRADES, `operazione senza ${i.problems.join(', ')}`);
          if (i.minNs < s - TRADE_TOL_NS || i.maxNs >= e + TRADE_TOL_NS) throw formatErr(K_TRADES, 'operazione fuori dall\'intervallo richiesto');
          return i;
        });
        result.data.forEach((r, n) => { const id = infos[n].id; if (!rows.has(id)) rows.set(id, r); });
        if (infos.length < TRADE_LIMIT) continue;
        // pagina piena: potrebbero mancare righe da un lato o dall'altro (l'ordine non e' dichiarato) e il campo
        // su cui la piattaforma filtra per tempo non e' dichiarato: i confini si prendono prudenzialmente su tutti i campi
        const keys = infos.map((i) => i.k);
        const nonInc = keys.every((x, n) => n === 0 || x <= keys[n - 1]);
        const nonDec = keys.every((x, n) => n === 0 || x >= keys[n - 1]);
        const fields = infos.every((i) => i.t !== null) ? ['k', 'm', 't'] : ['k', 'm'];
        const mins = fields.map((f) => infos.reduce((a, i) => (i[f] < a ? i[f] : a), infos[0][f]));
        const maxs = fields.map((f) => infos.reduce((a, i) => (i[f] > a ? i[f] : a), infos[0][f]));
        const lo = mins.reduce((a, b) => (a > b ? a : b));      // le righe mancanti piu' vecchie hanno tempo <= lo
        const hi = maxs.reduce((a, b) => (a < b ? a : b));      // le righe mancanti piu' nuove hanno tempo >= hi
        const day = isoDay(Number(lo / NS));
        if (!nonInc && !nonDec) { ctx.problems.push(`Operazioni del ${day}: la piattaforma le restituisce in un ordine non interpretabile, non posso garantire di averle tutte.`); continue; }
        if (lo >= hi) { ctx.problems.push(`Operazioni del ${day}: più di ${TRADE_LIMIT} operazioni nello stesso istante, non posso scaricarle tutte con certezza.`); continue; }
        if (lo + 1n >= e || hi <= s) { ctx.problems.push(`Operazioni del ${day}: pagina piena che non si riesce a dividere, non posso garantire di averle tutte.`); continue; }
        stack.push([hi, e]);          // se la pagina e' la piu' vecchia: restano le piu' nuove
        stack.push([s, lo + 1n]);     // se la pagina e' la piu' nuova: restano le piu' vecchie
      }
    }

    for (let s = startMs; s < endMs; s += TRADE_STEP_MS) {
      const e = Math.min(s + TRADE_WINDOW_MS, endMs);
      k++;
      ctx.say(`Operazioni di trading: giorno ${k} di ${total} (${isoDay(s)}), ${rows.size} trovate…`);
      await scanWindow(BigInt(s) * NS, BigInt(e) * NS);
      if (e >= endMs) break;
    }
    return rows;
  }

  /** Depositi o prelievi: finestre di 89 giorni sovrapposte, pagine da 200 fino alla prima pagina non piena. */
  async function scanWallet(call, method, listKey, label, startMs, endMs, ctx) {
    const rows = new Map();
    const total = Math.max(1, Math.ceil((endMs - startMs) / (WALLET_WINDOW_MS - WALLET_OVERLAP_MS)));
    let k = 0;
    let s = startMs;
    for (;;) {
      const e = Math.min(s + WALLET_WINDOW_MS, endMs);
      k++;
      ctx.say(`${label}: periodo ${k} di ${total} (dal ${isoDay(s)}), ${rows.size} trovati…`);
      for (let page = 0; ; page++) {
        await ctx.pace();
        const result = await call(method, { start_ts: String(s), end_ts: String(e), page_size: String(WALLET_PAGE), page: String(page) });
        const list = result[listKey];
        if (!Array.isArray(list)) throw formatErr(method, `${listKey} non è un elenco`);
        if (list.length > WALLET_PAGE) throw formatErr(method, `la pagina contiene più di ${WALLET_PAGE} righe`);
        let fresh = 0;
        for (const r of list) {
          const i = walletInfo(r);
          if (i.problems.length) throw formatErr(method, `riga senza ${i.problems.join(', ')}`);
          if (i.ms > e + NONCE_TOL_MS) throw formatErr(method, 'riga oltre la fine dell\'intervallo richiesto');
          if (!rows.has(i.id)) { rows.set(i.id, r); fresh++; }
        }
        if (list.length < WALLET_PAGE) break;
        if (fresh === 0) { ctx.problems.push(`${label} del periodo dal ${isoDay(s)}: la paginazione non avanza, non posso garantire di averli tutti.`); break; }
        if (page + 1 >= WALLET_MAX_PAGES) { ctx.problems.push(`${label} del periodo dal ${isoDay(s)}: troppe pagine, non posso garantire di averli tutti.`); break; }
      }
      if (e >= endMs) break;
      s = e - WALLET_OVERLAP_MS;
    }
    return rows;
  }

  // ---------------------------------------------------------------- opzioni
  function readOptions(options, nowDate) {
    const o = options || {};
    const startDate = String(o.startDate === undefined || o.startDate === null ? '' : o.startDate).trim() || FLOOR;
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? Date.parse(startDate + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(ms) || isoDay(ms) !== startDate) throw ApiError('config', 'La data di inizio non è valida: scrivila come AAAA-MM-GG (per esempio 2020-03-15).');
    if (ms < Date.parse(HARD_FLOOR + 'T00:00:00Z')) throw ApiError('config', `La data di inizio è troppo lontana: usa una data dal ${HARD_FLOOR} in poi.`);
    if (ms >= nowDate.getTime()) throw ApiError('config', 'La data di inizio è nel futuro: indica la data da cui vuoi scaricare lo storico.');
    const f = String(o.feeIncluded === undefined || o.feeIncluded === null ? '' : o.feeIncluded).trim().toLowerCase();
    let feeIncluded = null;                  // null = l'utente non ha scelto: nessuna ipotesi (vedi ASSUNTO)
    if (['si', 'sì', 's', 'yes', 'true'].includes(f)) feeIncluded = true;
    else if (['no', 'n', 'false'].includes(f)) feeIncluded = false;
    else if (f !== '') throw ApiError('config', 'L\'opzione sulla commissione dei prelievi accetta solo «si» oppure «no» (oppure vuota).');
    return { startDate, startMs: ms, feeIncluded };
  }

  // ---------------------------------------------------------------- sincronizzazione
  async function sync(creds, opts) {
    opts = opts || {};
    // il fetch del browser va chiamato come globalThis.fetch(...): estratto e invocato come metodo di un altro oggetto lancia "Illegal invocation"
    const fetchImpl = opts.fetch || (typeof globalThis.fetch === 'function' ? (u, i) => globalThis.fetch(u, i) : null);
    if (typeof fetchImpl !== 'function') throw ApiError('config', 'Questo browser non permette di collegarsi alla piattaforma.');
    const sleep = opts.sleep || common().sleep;
    const now = opts.now || (() => new Date());
    const say = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    const apiKey = String((creds && creds.apiKey) || '').trim();
    const apiSecret = String((creds && creds.apiSecret) || '').trim();
    if (!apiKey || !apiSecret) throw ApiError('config', 'Inserisci sia la chiave API sia la chiave segreta.');
    const t0 = now();
    const settings = readOptions(opts.options, t0);
    const endMs = t0.getTime();
    const call = makeCaller({ apiKey, apiSecret, fetch: fetchImpl, now, sleep });
    const wctx = { problems: [], say, pace: makePacer(WALLET_PACE_MS, now, sleep, opts.signal) };
    const tctx = { problems: [], say, pace: makePacer(TRADE_PACE_MS, now, sleep, opts.signal) };

    // prima i depositi e i prelievi (veloci): un problema di permessi emerge subito, non dopo ore di operazioni
    const dep = await scanWallet(call, K_DEPOSITS, 'deposit_list', 'Depositi', settings.startMs, endMs, wctx);
    const wdr = await scanWallet(call, K_WITHDRAWALS, 'withdrawal_list', 'Prelievi', settings.startMs, endMs, wctx);
    const trd = await scanTrades(call, settings.startMs, endMs, tctx);
    say('Scaricamento terminato: preparo il riepilogo…');

    const trades = [...trd.values()].sort((a, b) => cmpBig(tradeInfo(a).keyNs, tradeInfo(b).keyNs) || cmpId(idStr(a.trade_id), idStr(b.trade_id)));
    const byTime = (a, b) => (msVal(a.create_time) - msVal(b.create_time)) || cmpId(idStr(a.id), idStr(b.id));
    const deposits = [...dep.values()].sort(byTime);
    const withdrawals = [...wdr.values()].sort(byTime);

    const raw = {
      version: 1,
      fetchedAt: t0.toISOString(),
      settings: { startDate: settings.startDate, feeIncluded: settings.feeIncluded },
      [K_TRADES]: trades,
      [K_DEPOSITS]: deposits,
      [K_WITHDRAWALS]: withdrawals,
    };

    const fromIso = new Date(settings.startMs).toISOString(), toIso = t0.toISOString();
    const startOk = settings.startDate <= FLOOR;
    const first = (rows, f) => (rows.length ? isoDay(f(rows[0])) : null), last = (rows, f) => (rows.length ? isoDay(f(rows[rows.length - 1])) : null);
    const tradeMs = (r) => Number(tradeInfo(r).keyNs / NS), walMs = (r) => msVal(r.create_time);
    const range = (rows, f) => (rows.length ? ` Prima: ${first(rows, f)}, ultima: ${last(rows, f)}.` : ' Nessun dato nel periodo: se ti aspettavi delle operazioni, lo storico potrebbe non essere raggiungibile con questa chiave.');
    const lateStart = `Hai scelto di partire dal ${settings.startDate}: ciò che è precedente non è stato scaricato.`;
    const note = (problems, extra) => [startOk ? '' : lateStart, ...problems, extra].filter(Boolean).join(' ');
    // La profondita' dello storico non e' dichiarata: complete e' SEMPRE false (anche con zero righe), l'utente conferma di aver controllato.
    const DEPTH = 'La piattaforma non dichiara quanto indietro arriva lo storico via API, quindi non si può garantire che sia completo. Confronta la prima data scaricata con quella della tua prima operazione sull\'Exchange: se il conto è più vecchio, integra con il file; se coincide, conferma.';

    const coverage = [
      { what: 'Operazioni di trading spot', count: trades.length, from: fromIso, to: toIso, complete: false, note: note(tctx.problems, DEPTH + range(trades, tradeMs)) },
      { what: 'Depositi di criptovalute', count: deposits.length, from: fromIso, to: toIso, complete: false, note: note(wctx.problems.filter((p) => p.startsWith('Depositi')), DEPTH + range(deposits, walMs)) },
      { what: 'Prelievi di criptovalute', count: withdrawals.length, from: fromIso, to: toIso, complete: false, note: note(wctx.problems.filter((p) => p.startsWith('Prelievi')), DEPTH + range(withdrawals, walMs)) },
      { what: 'Margine e derivati (futures, perpetui)', count: 0, from: null, to: null, complete: false, note: 'Non scaricati. Se li hai usati, integra con il file dell\'Exchange: senza, plusvalenze e minusvalenze possono essere sbagliate.' },
      { what: 'Staking, interessi e premi', count: 0, from: null, to: null, complete: false, note: 'Non scaricati (per lo staking la piattaforma permette di leggere solo gli ultimi 180 giorni). Premi e interessi possono avere effetto fiscale: se ne hai ricevuti, integra con il file.' },
      { what: 'Conversioni, airdrop, rettifiche e sottoconti', count: 0, from: null, to: null, complete: false, note: 'Non scaricati: la piattaforma li registra in un altro elenco, non documentato in modo sufficiente per questo programma. Se hai usato conversioni, airdrop o sottoconti, integra con il file.' },
      { what: 'Depositi e prelievi in valuta (fiat)', count: 0, from: null, to: null, complete: false, note: 'Non scaricati: il formato della risposta non è descritto nella documentazione. Non hanno effetto fiscale diretto, ma servono a verificare i saldi.' },
    ];

    const warnings = [];
    if (!startOk) warnings.push(lateStart);
    for (const p of [...wctx.problems, ...tctx.problems]) warnings.push(p);
    warnings.push('La piattaforma non dichiara quanto indietro arriva lo storico via API: operazioni, depositi e prelievi risultano «da integrare» finché non confermi di aver confrontato la prima data scaricata con la tua prima operazione sull\'Exchange.');
    const nonSpot = trades.filter((r) => { const i = tradeInfo(r); return !/^[A-Z0-9]+_[A-Z0-9]+$/.test(i.inst) || (r.isolation_id && String(r.isolation_id) !== '0') || r.isolation_type; }).length;
    if (nonSpot) warnings.push(`${nonSpot} operazioni riguardano derivati o margine isolato: verranno segnalate come «non riconosciute» e vanno integrate dal file.`);
    const pend = (rows, table) => rows.filter((r) => String(r.status) in table).length;
    const pendDep = pend(deposits, DEPOSIT_STATUS_IGNORED), pendWdr = pend(withdrawals, WITHDRAWAL_STATUS_PENDING);
    if (pendDep) warnings.push(`${pendDep} depositi non risultano arrivati (in attesa, non arrivati o falliti): non sono conteggiati. Se arrivano dopo, scarica di nuovo lo storico.`);
    if (pendWdr) warnings.push(`${pendWdr} prelievi non sono ancora completati: verranno segnalati come «non riconosciuti» finché non sono conclusi. Poi scarica di nuovo lo storico.`);
    const feeWdr = withdrawals.filter((r) => String(r.status) === WITHDRAWAL_STATUS_OK && !feeIsZero(r.fee)).length;
    if (settings.feeIncluded === null) {
      if (feeWdr) warnings.push(`${feeWdr} prelievi con commissione verranno segnalati come «non riconosciuti»: la documentazione non dice se l'importo comprende già la commissione di rete e non hai indicato la tua scelta. Controlla un prelievo nel saldo dell'Exchange (scende dell'importo oppure di importo + commissione?), poi scarica di nuovo lo storico indicando «si» o «no» nell'opzione dei prelievi.`);
    } else if (settings.feeIncluded) {
      warnings.push('Prelievi: la documentazione non dice se l\'importo comprende già la commissione di rete. Per tua scelta l\'importo è ciò che esce dal conto (la commissione è già compresa). Se nell\'Exchange il saldo scende di importo + commissione, scarica di nuovo lo storico con l\'opzione dei prelievi = no.');
    } else {
      warnings.push('Prelievi: la documentazione non dice se l\'importo comprende già la commissione di rete. Per tua scelta la commissione è stata aggiunta all\'importo (esce importo + commissione). Se nell\'Exchange il saldo scende solo dell\'importo, scarica di nuovo lo storico con l\'opzione dei prelievi = si.');
    }
    warnings.push('Su private/get-trades le operazioni a margine su coppie spot non sono distinguibili dalle altre: se hai usato il margine verrebbero trattate come operazioni spot normali.');
    warnings.push('Il valore in euro di ogni operazione è calcolato come quantità × prezzo nella valuta della coppia; le commissioni sono quelle addebitate (già al netto degli eventuali crediti commissione).');
    warnings.push('Controlla i saldi finali (scheda Dettaglio, Giacenze) e confrontali con quelli dell\'Exchange.');
    return { raw, coverage, warnings };
  }

  // ---------------------------------------------------------------- conversione in eventi
  function accountName() {
    const p = CT.PLATFORMS && CT.PLATFORMS[PLATFORM];
    return (p && p.account) || LABEL;
  }

  /** Puro e deterministico: nessuna rete. `raw` e' l'oggetto prodotto da sync (o il suo JSON come testo). */
  function parse(raw, fileName) {
    const imp = CT.importers;
    let data = raw;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { throw ApiError('format', 'I dati scaricati dall\'API non sono leggibili (JSON non valido).'); } }
    if (!isObject(data) || data.version !== 1) throw ApiError('format', 'I dati scaricati dall\'API hanno una versione non supportata.');
    const list = (k) => { const v = data[k]; if (v === undefined || v === null) return []; if (!Array.isArray(v)) throw ApiError('format', `I dati scaricati dall'API non sono nel formato atteso (${k}).`); return v; };
    const settings = isObject(data.settings) ? data.settings : {};
    // true / false = scelta dell'utente; qualsiasi altro valore = nessuna scelta (nessuna ipotesi)
    const feeIncluded = settings.feeIncluded === true ? true : settings.feeIncluded === false ? false : null;
    const account = accountName();
    const where = fileName || 'API Crypto.com Exchange';
    const events = [];
    const orphan = imp.uidFactory(`api:${ID}:senza-id`);
    let rows = 0;

    // ---- operazioni spot
    const seenT = new Set();
    for (const r of list(K_TRADES)) {
      const i = tradeInfo(r);
      const id = i.id || null;
      if (id && seenT.has(id)) continue;
      if (id) seenT.add(id);
      rows++;
      const uid = id ? `api:${ID}:trade:${id}` : orphan(isObject(r) ? r : { v: String(r) });
      const ts = i.keyNs === null || i.keyNs === undefined ? null : new Date(Number(i.keyNs / NS));
      const base = { uid, ts, account, ref: id || '', src: `${where} · operazione ${id || '?'}`, raw: r };
      const bad = (key, note) => imp.unresolved(base, `Crypto.com Exchange (API) · ${key}`, note);
      if (i.problems.length) { events.push(bad('operazione non interpretabile', `Operazione senza ${i.problems.join(', ')}: non interpretabile.`)); continue; }
      if (r.journal_type !== undefined && r.journal_type !== null && String(r.journal_type).toUpperCase() !== 'TRADING') { events.push(bad('operazione non di trading', `Movimento di tipo "${r.journal_type}" in private/get-trades: non gestito.`)); continue; }
      if ((r.isolation_id && String(r.isolation_id) !== '0') || r.isolation_type) { events.push(bad('margine isolato', `Operazione a margine isolato su ${i.inst}: non supportata.`)); continue; }
      if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(i.inst)) { events.push(bad('strumento non spot', `Operazione su ${i.inst} (derivati o strumento non spot): non supportata.`)); continue; }
      const [baseA, quote] = imp.splitPair(i.inst);
      const qty = D(i.qty), price = D(i.price);
      if (FIAT.has(baseA)) { events.push(bad('coppia con valuta base', `Coppia ${i.inst} con valuta come asset principale: non interpretabile.`)); continue; }
      if (qty.lte(0) || price.lte(0)) { events.push(bad('operazione non valida', `Quantità o prezzo non positivi (${i.side} ${i.qty} @ ${i.price} su ${i.inst}).`)); continue; }
      const feeAmt = D(i.fees);
      const feeAsset = typeof r.fee_instrument_name === 'string' ? upper(r.fee_instrument_name) : '';
      if (feeAmt.gt(0)) { events.push(bad('commissione positiva', `Commissione positiva (${i.fees}): sarebbe un accredito, non un costo. Serve una decisione.`)); continue; }
      if (feeAmt.lt(0) && !feeAsset) { events.push(bad('commissione senza valuta', 'Commissione senza valuta.')); continue; }
      const feeP = feeAmt.lt(0) ? { feeAsset, feeQty: feeAmt.abs() } : {};
      let credits = '';
      const fc = decStr(r.fee_credits);
      if (fc !== null && !D(fc).isZero()) credits = ` Crediti commissione usati: ${D(fc).abs().toFixed()} (la commissione registrata è già al netto).`;
      const note = `${i.side === 'BUY' ? 'Acquisto' : 'Vendita'} ${i.inst} sull'Exchange (ordine ${r.order_id === undefined ? 'n.d.' : r.order_id}).${credits}`;
      const quoteAmt = qty.times(price);
      let ev;
      if (i.side === 'BUY') {
        ev = FIAT.has(quote)
          ? mkEvent({ ...base, ...feeP, note, kind: Kind.BUY, asset: baseA, qty, value: quoteAmt, valueCcy: quote })
          : mkEvent({ ...base, ...feeP, note, kind: Kind.SWAP, asset: quote, qty: quoteAmt, counterAsset: baseA, counterQty: qty });
      } else {
        ev = FIAT.has(quote)
          ? mkEvent({ ...base, ...feeP, note, kind: Kind.SELL, asset: baseA, qty, value: quoteAmt, valueCcy: quote })
          : mkEvent({ ...base, ...feeP, note, kind: Kind.SWAP, asset: baseA, qty, counterAsset: quote, counterQty: quoteAmt });
      }
      events.push(ev);
    }

    // ---- depositi e prelievi
    const transfers = (key, isDeposit) => {
      const seen = new Set();
      for (const r of list(key)) {
        const i = walletInfo(r);
        const id = i.id || null;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        rows++;
        const tag = isDeposit ? 'deposito' : 'prelievo';
        const uid = id ? `api:${ID}:${tag}:${id}` : orphan(isObject(r) ? r : { v: String(r) });
        const txid = isObject(r) && typeof r.txid === 'string' && r.txid.trim() ? r.txid.trim() : '';
        const base = { uid, ts: i.ms ? new Date(i.ms) : null, account, asset: i.cur || '', ref: txid || id || '', src: `${where} · ${tag} ${id || '?'}`, raw: r };
        const bad = (k, n) => imp.unresolved(base, `Crypto.com Exchange (API) · ${k}`, n);
        if (i.problems.length) { events.push(bad(`${tag} non interpretabile`, `${isDeposit ? 'Deposito' : 'Prelievo'} senza ${i.problems.join(', ')}: non interpretabile.`)); continue; }
        const amount = D(i.amount);
        if (amount.lte(0)) { events.push(bad(`${tag} con importo non valido`, `Importo non positivo (${i.amount} ${i.cur}).`)); continue; }
        const fiat = FIAT.has(i.cur);
        if (isDeposit) {
          if (i.status === DEPOSIT_STATUS_OK) {
            if (i.fee === null || !D(i.fee).isZero()) { events.push(bad('deposito con commissione', `Deposito di ${i.amount} ${i.cur} con commissione ${i.fee === null ? 'non indicata' : i.fee}: non è documentato se l'importo sia lordo o netto. Serve una decisione.`)); continue; }
            events.push(mkEvent({ ...base, kind: fiat ? Kind.FIAT_IN : Kind.TRANSFER_IN, qty: amount, note: `Deposito sull'Exchange (rete ${isObject(r) && r.network_id ? r.network_id : 'n.d.'}).` }));
          } else if (i.status in DEPOSIT_STATUS_IGNORED) {
            events.push(mkEvent({ ...base, kind: Kind.INFO, note: `Deposito ${DEPOSIT_STATUS_IGNORED[i.status]} (stato ${i.status}): non conteggiato.` }));
          } else events.push(bad(`stato deposito "${i.status}"`, `Stato di deposito non riconosciuto: "${i.status}" (${i.amount} ${i.cur}).`));
        } else if (i.status === WITHDRAWAL_STATUS_OK) {
          const feeTxt = i.fee === null ? 'non indicata' : i.fee;
          const noFee = i.fee !== null && D(i.fee).isZero();         // senza commissione la semantica non conta: esce l'importo
          if (!noFee && feeIncluded === null) {
            events.push(bad('prelievo con commissione (semantica non documentata)', `Prelievo di ${i.amount} ${i.cur} con commissione ${feeTxt}: la documentazione non dice se l'importo comprende già la commissione di rete e non hai indicato la tua scelta. Controlla un prelievo nel saldo dell'Exchange, poi scarica di nuovo lo storico indicando «si» o «no» nell'opzione dei prelievi.`));
            continue;
          }
          let qty = amount;
          if (feeIncluded === false) {
            if (i.fee === null) { events.push(bad('prelievo senza commissione', `Prelievo di ${i.amount} ${i.cur} senza commissione indicata: non posso calcolare quanto è uscito.`)); continue; }
            qty = amount.plus(D(i.fee).abs());
          }
          const how = noFee ? 'nessuna commissione' : feeIncluded ? 'già compresa nell\'importo' : 'aggiunta all\'importo';
          events.push(mkEvent({ ...base, kind: fiat ? Kind.FIAT_OUT : Kind.TRANSFER_OUT, qty, note: `Prelievo dall'Exchange: importo ${i.amount} ${i.cur}, commissione ${feeTxt} (${how}).` }));
        } else if (i.status in WITHDRAWAL_STATUS_IGNORED) {
          events.push(mkEvent({ ...base, kind: Kind.INFO, note: `Prelievo ${WITHDRAWAL_STATUS_IGNORED[i.status]} (stato ${i.status}): non conteggiato.` }));
        } else if (i.status in WITHDRAWAL_STATUS_PENDING) {
          events.push(bad('prelievo non concluso', `Prelievo di ${i.amount} ${i.cur} non ancora concluso (${WITHDRAWAL_STATUS_PENDING[i.status]}): scarica di nuovo lo storico a prelievo concluso, oppure ignoralo se non è andato a buon fine.`));
        } else events.push(bad(`stato prelievo "${i.status}"`, `Stato di prelievo non riconosciuto: "${i.status}" (${i.amount} ${i.cur}).`));
      }
    };
    transfers(K_DEPOSITS, true);
    transfers(K_WITHDRAWALS, false);

    return imp.finish(`${LABEL} (API)`, rows, events);
  }

  CT.api.cryptocom_exchange = {
    id: ID,
    label: LABEL,
    platform: PLATFORM,
    fields: [
      { key: 'apiKey', label: 'Chiave API (API Key)', secret: false, placeholder: 'Incolla qui la API Key' },
      { key: 'apiSecret', label: 'Chiave segreta (Secret Key)', secret: true, placeholder: 'Incolla qui la Secret Key' },
    ],
    options: [
      { key: 'startDate', label: 'Scarica a partire dal (AAAA-MM-GG)', placeholder: FLOOR, default: FLOOR,
        help: 'La piattaforma ammette una richiesta al secondo e, per prudenza, il programma legge un giorno di operazioni per volta: partire da ottobre 2019 richiede circa 45 minuti. Se sai da quando usi l\'Exchange puoi indicare una data più recente per far prima, ma ciò che è precedente non viene scaricato (e andrà integrato con il file).' },
      { key: 'feeIncluded', label: 'Prelievi: la commissione è già compresa nell\'importo? (si/no)', placeholder: 'si oppure no',
        help: 'La documentazione non lo chiarisce, quindi il programma non fa ipotesi. Controlla un prelievo nel saldo dell\'Exchange: se è sceso solo dell\'importo scrivi «si»; se è sceso di importo + commissione scrivi «no». Se lasci vuoto, i prelievi con commissione compaiono come «da controllare» finché non scegli.' },
    ],
    help: [
      'Accedi a Crypto.com Exchange dal sito e apri User Center (Centro utente) → API.',
      'Crea una nuova chiave API. La chiave nasce in sola lettura («Can Read»): lasciala così e NON attivare mai il permesso di trading né quello di prelievo.',
      'Facoltativo: puoi limitare la chiave a certi indirizzi IP. In quel caso inserisci l\'indirizzo IP da cui stai usando questa pagina, altrimenti la piattaforma rifiuta le richieste.',
      'Copia la Chiave API e la Chiave segreta (Secret Key) e incollale nei campi qui sotto.',
      'Premi «Collega e scarica lo storico» e lascia questa scheda aperta e in primo piano: il primo scaricamento può durare a lungo (circa un secondo per ogni giorno di storico), perché la piattaforma ammette una richiesta al secondo.',
      'A scaricamento finito elimina la chiave dall\'Exchange.',
    ],
    limits: [
      'Margine, futures e perpetui non vengono scaricati. Le operazioni a margine su coppie spot non sono distinguibili e sarebbero trattate come spot.',
      'Staking, interessi, premi, airdrop, conversioni, rettifiche e sottoconti non vengono scaricati (per lo staking la piattaforma permette di leggere solo gli ultimi 180 giorni): integra con il file dell\'Exchange.',
      'Depositi e prelievi in valuta (euro, dollari…) non vengono scaricati: la loro risposta non è documentata.',
      'Dei depositi e dei prelievi in cripto si usano solo quelli conclusi. I depositi con commissione, i prelievi con commissione (finché non scegli l\'opzione dei prelievi) e i prelievi non ancora conclusi vengono segnalati come righe da controllare.',
      'La piattaforma non dichiara quanto indietro arriva lo storico via API: operazioni, depositi e prelievi restano «da integrare» finché non confronti la prima data scaricata con la tua prima operazione e confermi.',
      'I trasferimenti da e verso l\'App Crypto.com compaiono se la piattaforma li riporta tra i depositi e i prelievi: servono per abbinarli all\'App.',
      'Se il browser blocca il collegamento diretto alla piattaforma (succede spesso) usa i file.',
    ],
    sync,
    parse,
    signRequest,
    paramsToString,
  };
  if (typeof module !== 'undefined') module.exports = CT.api.cryptocom_exchange;
})();
