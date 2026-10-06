/* Binance: collegamento API REST (sola lettura) chiamato direttamente dal browser, chiave HMAC-SHA256.

   FONTI (dal sandbox api.binance.com e developers.binance.com NON sono raggiungibili: si e' letto solo cio' che e' su GitHub
   e, per le pagine di developers.binance.com, i riassunti restituiti da una ricerca web che le cita)
   [S]  https://github.com/binance/binance-spot-api-docs  rest-api.md, enums.md, errors.md, faqs/api_key_types.md  (ufficiale)
   [W]  https://github.com/binance/binance-connector-js  clients/wallet (capital-api.ts, asset-api.ts e tipi di risposta),
        clients/convert (trade-api.ts), clients/fiat (api.ts) - SDK ufficiale generato dalla specifica OpenAPI di Binance
   [H]  https://github.com/binance/binance-skills-hub  skills/binance/fiat/references/sapi-endpoints.md  (ufficiale)
   [D]  https://developers.binance.com/docs/wallet/... , /convert/... , /fiat/...  (ufficiale; solo via ricerca web: i campi
        "limit/rows" predefiniti e massimi sotto citati vengono da qui)
   [C]  https://github.com/ccxt/ccxt  ts/src/binance.ts  (libreria open source molto diffusa: esempi di risposta e pesi SAPI)

   VERIFICATO sulla fonte
   - Radice https://api.binance.com; intestazione X-MBX-APIKEY; firma HMAC-SHA256 esadecimale (chiave = segreto) della query
     string (parametro "signature" aggiunto in coda); "timestamp" (ms) obbligatorio; recvWindow predefinito 5000, massimo
     60000; regola: timestamp < serverTime + 1 s e serverTime - timestamp <= recvWindow [S]. Il vettore di firma della
     documentazione e' in test/api-common.test.js e in test/api-binance.test.js.
   - GET /api/v3/time (peso 1, pubblico) -> {serverTime}; GET /api/v3/exchangeInfo (peso 20) -> symbols[] con symbol,
     status, baseAsset, quoteAsset, e rateLimits[] con REQUEST_WEIGHT (esempio 6000 al minuto); parametro showPermissionSets;
     senza "permissions" restituisce i simboli con permesso SPOT, MARGIN o LEVERAGED [S].
   - GET /api/v3/account (peso 20), omitZeroBalances; balances[] {asset, free, locked} [S].
   - GET /api/v3/myTrades (peso 20 senza orderId) [S]: limit predefinito 500, massimo 1000; "se fromId e' indicato restituisce
     le operazioni con id >= fromId"; "il tempo tra startTime ed endTime non puo' superare 24 ore"; combinazioni ammesse:
     symbol, symbol+fromId, symbol+startTime+endTime ...: fromId NON si combina con startTime/endTime (si usa solo fromId).
     Campi: symbol, id, orderId, price, qty, quoteQty, commission, commissionAsset, time (ms), isBuyer, isMaker, isBestMatch.
   - Limiti: 429 = superamento, 418 = ban dell'IP, intestazione Retry-After in secondi; i limiti sono per IP; 403 = regola WAF;
     i 5XX NON sono necessariamente fallimenti [S].
   - GET /sapi/v1/capital/deposit/hisrec (peso IP 1) [W][D]: finestra startTime..endTime "inferiore a 90 giorni", predefinito
     ultimi 90 giorni; offset e limit (predefinito 1000, massimo 1000); stato: 0 in attesa, 1 accreditato, 2 respinto, 6
     accreditato ma non prelevabile, 7 deposito errato, 8 in attesa di conferma utente; campi id, amount, coin, network,
     status, address, txId, insertTime (ms), completeTime, transferType (0 esterno, 1 interno [C]), walletType.
   - GET /sapi/v1/capital/withdraw/history (peso UID 18000, "10 richieste al secondo") [W][D]: stessa finestra < 90 giorni,
     offset/limit (1000/1000); campi id, amount, transactionFee, coin, status, address, txId, applyTime (testo
     "aaaa-MM-gg HH:mm:ss"), network, transferType, completeTime. Stati: 0 mail inviata, 2 attesa approvazione, 3 respinto,
     4 in elaborazione, 6 completato [W]; 1 annullato e 5 fallito [C].
   - GET /sapi/v1/convert/tradeFlow (peso UID 3000) [W][D]: startTime ed endTime OBBLIGATORI, intervallo massimo 30 giorni,
     limit predefinito 100 e massimo 1000; risposta {list[], startTime, endTime, limit, moreData}; campi quoteId, orderId,
     orderStatus, fromAsset, fromAmount, toAsset, toAmount, ratio, inverseRatio, createTime.
   - GET /sapi/v1/asset/assetDividend (peso IP 10) [W][D]: "non piu' di 180 giorni tra startTime ed endTime"; limit
     predefinito 20, massimo 500; nessun offset; risposta {rows[], total}; campi id, amount, asset, divTime, enInfo, tranId.
   - GET /sapi/v1/asset/dribblet (peso IP 1) [W][D]: "restituisce solo le ultime 100 registrazioni" e "solo quelle dopo il
     01/12/2020"; senza paginazione; risposta {total, userAssetDribblets[{operateTime, totalTransferedAmount,
     totalServiceChargeAmount, transId, userAssetDribbletDetails[{transId, serviceChargeAmount, amount, operateTime,
     transferedAmount, fromAsset, targetAsset?}]}]}; "totalTransferedAmount" e' l'importo in BNB trasferito [D].
   - GET /sapi/v1/fiat/payments (peso IP 1) [W][H][D]: transactionType 0 acquisto / 1 vendita, beginTime, endTime, page
     (predefinito 1), rows (predefinito 100, massimo 500); senza date restituisce gli ultimi 30 giorni; risposta
     {code, message, data[], total, success}; campi orderNo, sourceAmount, fiatCurrency, obtainAmount, cryptoCurrency,
     totalFee, price, status (Processing, Completed, Failed, Refunded [D]), paymentMethod, createTime, updateTime.
   - GET /sapi/v1/fiat/orders [W][H][D]: peso UID 45000 [W] (90000 secondo [C]): meno di 3 richieste al minuto.

   ASSUNTO (non confermato da una fonte ufficiale: dichiarato anche in avvisi e note)
   - fromId = 0 equivale a "dalla prima operazione": e' la lettura letterale di "id >= fromId", ma non e' mostrato in un esempio.
   - Prelievi: se "amount" comprenda gia' la commissione di rete NON e' documentato. Predefinito: NON la comprende, quindi
     quantita' uscita = amount + transactionFee (indizio negli esempi di [C]: amount 20 con transactionFee 20 per USDT su ETH,
     impossibile se la comprendesse). L'opzione "withdrawFee" = si' usa amount cosi' com'e'. Un errore qui sposta solo la
     commissione di rete (il motore la ricava abbinando l'arrivo sull'altro conto).
   - Acquisti con carta: "sourceAmount" = fiat realmente pagato, commissione "totalFee" gia' compresa: non viene sommata.
     (se la commissione fosse in piu', il costo risulta sottostimato di quella cifra: la plusvalenza e' sovrastimata, mai il contrario).
     Le vendite con carta/bonifico (transactionType 1) hanno campi non documentati: ogni registrazione e' "non riconosciuta".
   - Dust: "transferedAmount" e' l'importo accreditato al netto di "serviceChargeAmount"; senza "targetAsset" l'asset e' BNB [D].
   - Finestre non documentate per fiat/payments e dribblet: si usano 29 e 30 giorni (non oltre il periodo "predefinito di 30 giorni").
   - Limiti SAPI per IP 12000/min e per UID 180000/min (commenti in [C]): le pause tra le richieste sono calcolate su questi valori.
   - applyTime dei prelievi e' in UTC (come in [C]); orderId di Convert puo' superare 2^53: in quel caso si usa quoteId.
   - Profondita' dello storico conservata da Binance per depositi/prelievi/convert/dividendi: NON dichiarata. Si parte da
     "startDate" (predefinito 01/07/2017, mese di avvio di Binance: dato di cronaca non verificabile da qui).
   - Il collegamento diretto dal browser (CORS) non e' verificabile da qui: se Binance lo blocca si ottiene l'errore 'network'.
   - Una coppia non presente in exchangeInfo (ritirata dal listino) non e' interrogabile: lo scrive il compito, ma nessuna
     fonte letta lo dichiara esplicitamente; la coppia viene saltata e segnalata, mai ipotizzata.

   UNITA': quantita' nell'unita' di ciascun asset cosi' come le restituisce la piattaforma. Nessun metallo prezioso su questo conto. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  CT.api = CT.api || {};
  const { D, ZERO, FIAT, Kind, mkEvent } = CT;

  const ID = 'binance';
  const PLATFORM = 'binance';
  const LABEL = 'Binance';
  const ROOT = 'https://api.binance.com';
  const common = () => CT.api.common;
  const apiError = (...a) => new (CT.api.common.ApiError)(...a);

  // ---------------------------------------------------------------- costanti
  const DAY = 86400000;
  const HOUR = 3600000;
  const RECV_WINDOW = 5000;                       // predefinito documentato e consigliato (<= 5000)
  const SKEW_SAFETY_MS = 1000;                    // il timestamp resta 1 s indietro rispetto all'ora stimata del server
  const WIN = {
    wallet: { len: 89 * DAY, overlap: HOUR },     // depositi e prelievi: finestra < 90 giorni
    convert: { len: 29 * DAY, overlap: HOUR },    // Convert: massimo 30 giorni
    dividend: { len: 170 * DAY, overlap: HOUR },  // dividendi: massimo 180 giorni
    fiat: { len: 29 * DAY, overlap: HOUR },       // acquisti con carta: assunto (<= 30 giorni)
    dust: { len: 30 * DAY, overlap: HOUR },       // piccoli saldi: assunto
  };
  const PACE = { ip: 120, dividend: 150, withdraw: 400, convert: 1100 };   // ms tra due richieste (vedi ASSUNTO sui pesi)
  const LIM = { wallet: 1000, trades: 1000, convert: 1000, dividend: 500, fiatRows: 500, dust: 100 };
  const MAX_PAGES = 2000;
  const MAX_ATTEMPTS = 6;                         // tentativi per richiesta su 429/418/5xx (ogni tentativo viene firmato di nuovo)
  const MAX_WAIT_S = 300;                         // attesa massima accettata per un Retry-After
  const DEFAULT_QUOTES = 'EUR,USDT,USDC,BTC,ETH,BNB,FDUSD';
  const DEFAULT_START = '2017-07-01';
  const MIN_START = '2017-01-01';
  const DUST_FLOOR = Date.UTC(2020, 11, 1);       // il dribblet restituisce solo registrazioni successive
  const FALLBACK_WEIGHT_PER_MIN = 1200;           // se exchangeInfo non indica il limite: valore prudente
  const SPOT_BUDGET = 0.5;                        // si usa al massimo meta' del limite di peso

  const PAYMENT_OK = 'completed', PAYMENT_IGNORED = new Set(['failed', 'refunded']), PAYMENT_PENDING = new Set(['processing']);
  const DEPOSIT_OK = new Set([1, 6]), DEPOSIT_IGNORED = new Set([2]), DEPOSIT_PENDING = { 0: 'in attesa', 7: 'deposito errato', 8: 'in attesa di conferma' };
  const WITHDRAW_OK = 6, WITHDRAW_IGNORED = new Set([1, 3, 5]), WITHDRAW_PENDING = { 0: 'mail di conferma inviata', 2: 'in attesa di approvazione', 4: 'in elaborazione' };

  // ---------------------------------------------------------------- lettura sicura dei campi
  const isObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const upper = (s) => String(s).trim().toUpperCase();
  const DEC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  /** Decimale esatto come stringa oppure null. I numeri JSON solo se esatti (al massimo 15 cifre significative). */
  function decStr(v) {
    if (typeof v === 'string') { const t = v.trim(); return DEC_RE.test(t) ? t : null; }
    if (typeof v === 'number') return Number.isFinite(v) && Number(v.toPrecision(15)) === v ? String(v) : null;
    return null;
  }
  const dec = (v) => { const s = decStr(v); return s === null ? null : D(s); };
  /** Millisecondi Unix a 13 cifre oppure null. */
  function msVal(v) {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1e12 && v < 1e13) return v;
    if (typeof v === 'string' && /^\d{13}$/.test(v.trim())) return Number(v.trim());
    return null;
  }
  /** Identificativo come testo (testo non vuoto o intero sicuro) oppure null. */
  function idStr(v) {
    if (typeof v === 'string') { const t = v.trim(); return t && t.length <= 128 ? t : null; }
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
    return null;
  }
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const toMs = (d) => (d instanceof Date ? d.getTime() : Number(d));
  const iso = (ms) => new Date(ms).toISOString();
  const dmy = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
  /** "aaaa-MM-gg HH:mm:ss" (UTC) oppure millisecondi -> ms, altrimenti null. */
  function applyTimeMs(v) {
    const ms = msVal(v);
    if (ms !== null) return ms;
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(v.trim()) : null;
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isFinite(t) ? t : null;
  }
  const formatErr = (path, what, detail) => apiError('format', `La risposta di Binance (${path}) non ha la forma documentata: ${what}.`, Object.assign({ path }, detail || {}));

  // ---------------------------------------------------------------- chiavi dei record (stesse in sync e parse)
  const depositKey = (r) => {
    if (!isObject(r)) return null;
    const id = idStr(r.id);
    if (id) return id;
    const tx = idStr(r.txId), coin = str(r.coin), t = msVal(r.insertTime), a = decStr(r.amount);
    return tx && coin && t !== null && a !== null ? `${coin}|${tx}|${t}|${a}` : null;
  };
  const withdrawKey = (r) => {
    if (!isObject(r)) return null;
    const id = idStr(r.id);
    if (id) return id;
    const tx = idStr(r.txId), coin = str(r.coin), t = applyTimeMs(r.applyTime), a = decStr(r.amount);
    return tx && coin && t !== null && a !== null ? `${coin}|${tx}|${t}|${a}` : null;
  };
  /** orderId (se e' un intero sicuro: JSON.parse perde precisione oltre 2^53) altrimenti quoteId. */
  const convertKey = (r) => {
    if (!isObject(r)) return null;
    if (typeof r.orderId === 'number' && Number.isSafeInteger(r.orderId) && r.orderId >= 0) return String(r.orderId);
    if (typeof r.orderId === 'string' && /^\d{1,30}$/.test(r.orderId.trim())) return r.orderId.trim();
    const q = idStr(r.quoteId);
    return q ? 'q' + q : null;
  };
  const dividendKey = (r) => (isObject(r) ? (idStr(r.id) || (idStr(r.tranId) ? 't' + idStr(r.tranId) : null)) : null);
  const dustKey = (r) => (isObject(r) ? idStr(r.transId) : null);
  const paymentKey = (r) => (isObject(r) ? idStr(r.orderNo) : null);
  const tradeKey = (r) => (isObject(r) && typeof r.id === 'number' && Number.isSafeInteger(r.id) && r.id >= 0 ? String(r.id) : null);

  const tsOf = {
    deposit: (r) => msVal(r.insertTime),
    withdrawal: (r) => applyTimeMs(r.applyTime),
    convert: (r) => msVal(r.createTime),
    dividend: (r) => msVal(r.divTime),
    dust: (r) => msVal(r.operateTime),
    payment: (r) => msVal(r.createTime),
    trade: (r) => msVal(r.time),
  };

  // ---------------------------------------------------------------- finestre temporali
  /** Finestre consecutive [s, e] di al massimo `len` ms che coprono [from, to] con `overlap` ms di sovrapposizione
      (i confini inclusi/esclusi non sono dichiarati: la sovrapposizione evita buchi, i doppioni si eliminano con la chiave). */
  function makeWindows(from, to, len, overlap) {
    const out = [];
    if (!(to > from) || len <= overlap) return out;
    let s = from;
    for (;;) {
      const e = Math.min(s + len, to);
      out.push({ s, e });
      if (e >= to) break;
      s = e - overlap;
    }
    return out;
  }

  // ---------------------------------------------------------------- opzioni
  function splitList(v) { return [...new Set(String(v === undefined || v === null ? '' : v).split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))]; }
  const YES = new Set(['SI', 'SÌ', 'S', 'YES', 'Y', 'TRUE', '1']), NO = new Set(['NO', 'N', 'FALSE', '0', '']);

  function parseOptions(options, nowMs) {
    const o = options || {};
    const cfg = (msg) => apiError('config', msg);
    let quotes = splitList(o.quotes);
    if (!quotes.length) quotes = splitList(DEFAULT_QUOTES);
    for (const q of quotes) if (!/^[A-Z0-9]{2,12}$/.test(q)) throw cfg(`Valuta di quotazione non valida: "${q}". Scrivi i codici separati da virgole, per esempio EUR,USDT,BTC.`);
    const extra = splitList(String(o.extraSymbols === undefined || o.extraSymbols === null ? '' : o.extraSymbols).replace(/[/_-]/g, ''));
    for (const s of extra) if (!/^[A-Z0-9]{4,24}$/.test(s)) throw cfg(`Coppia non valida: "${s}". Scrivi le coppie come le chiama Binance, per esempio BTCEUR, separate da virgole.`);
    const startDate = String(o.startDate === undefined || o.startDate === null || String(o.startDate).trim() === '' ? DEFAULT_START : o.startDate).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
    const startMs = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    if (!m || !Number.isFinite(startMs) || new Date(startMs).toISOString().slice(0, 10) !== startDate) throw cfg('La data di inizio non è valida: scrivila come aaaa-mm-gg, per esempio 2019-03-15.');
    if (startMs < Date.parse(MIN_START)) throw cfg('La data di inizio non può essere anteriore al 01/01/2017: Binance non esisteva ancora.');
    if (startMs >= nowMs) throw cfg('La data di inizio è nel futuro.');
    const wf = String(o.withdrawFee === undefined || o.withdrawFee === null ? '' : o.withdrawFee).trim().toUpperCase();
    if (!YES.has(wf) && !NO.has(wf)) throw cfg('L\'opzione sulla commissione dei prelievi accetta solo «sì» oppure «no».');
    return { quotes, extraSymbols: extra, startDate, startMs, withdrawFeeIncluded: YES.has(wf) };
  }

  // ---------------------------------------------------------------- richieste
  function makeCtx(creds, opts) {
    const key = creds && typeof creds.apiKey === 'string' ? creds.apiKey.trim() : '';
    const secret = creds && typeof creds.apiSecret === 'string' ? creds.apiSecret.trim() : '';
    if (!key || !secret) throw apiError('config', 'Servono la chiave API e la chiave segreta di Binance.');
    const f = opts.fetch || ((...a) => globalThis.fetch(...a));
    const nowFn = opts.now || (() => new Date());
    const say = (m) => { try { if (typeof opts.onProgress === 'function') opts.onProgress(m); } catch (e) { /* un errore dell'interfaccia non deve fermare lo scarico */ } };
    const ctx = { key, secret, fetch: f, sleep: opts.sleep || ((ms) => common().sleep(ms)), nowFn, offset: 0, lastRetryAfter: null, say, spotPace: PACE.ip, warnings: [] };
    ctx.localMs = () => toMs(nowFn());
    ctx.nowMs = () => ctx.localMs() + ctx.offset;
    // la risposta passa da qui per leggere Retry-After (common.request non lo espone)
    ctx.fetchSeen = async (url, init) => {
      const res = await f(url, init);
      try { ctx.lastRetryAfter = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null; } catch (e) { ctx.lastRetryAfter = null; }
      return res;
    };
    return ctx;
  }

  const enc = (v) => encodeURIComponent(String(v));
  /** Query string nell'ordine dato (la firma copre esattamente questo testo). */
  function queryOf(params) { return Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null).map((k) => `${k}=${enc(params[k])}`).join('&'); }

  /** Traduce gli errori di Binance in messaggi per l'utente (i testi di common.request restano per il resto). */
  function translate(e) {
    if (!(e instanceof common().ApiError)) return e;
    const d = e.detail || {};
    if (e.code === 'http' && d.status === 400) {
      const m = /"code"\s*:\s*(-?\d+)/.exec(String(d.body || ''));
      const code = m ? Number(m[1]) : null;
      if (code === -1021) return apiError('config', 'L\'orologio del computer non è allineato con quello di Binance (la richiesta è fuori dal margine di tempo). Sincronizza data e ora del computer e riprova.', { status: 400, platformCode: code });
      if (code === -1022) return apiError('auth', 'Binance dice che la firma non è valida: la chiave segreta non corrisponde alla chiave API. Ricopiale entrambe per intero, senza spazi, e usa una chiave «generata dal sistema».', { status: 400, platformCode: code });
      if (code === -2014) return apiError('auth', 'Il formato della chiave API non è valido: ricopiala per intero, senza spazi.', { status: 400, platformCode: code });
    }
    if (e.code === 'auth' && d.status === 403) return apiError('auth', 'Binance ha bloccato la richiesta (errore 403, regola di sicurezza). Può dipendere da troppe richieste o dal tuo indirizzo IP: riprova più tardi.', { status: 403 });
    return e;
  }

  /** Una richiesta GET. `signed`: chiave + firma. Su 429/418/5xx attende e RIFIRMA con un timestamp nuovo (un Retry-After lungo
      renderebbe scaduto il vecchio). `paceMs`: pausa dopo la risposta, per restare sotto i limiti di frequenza. */
  async function call(ctx, path, params, paceMs, signed) {
    const isSigned = signed !== false;
    let attempt = 0;
    for (;;) {
      const p = Object.assign({}, params);
      if (isSigned) { p.recvWindow = RECV_WINDOW; p.timestamp = ctx.nowMs() - SKEW_SAFETY_MS; }
      let qs = queryOf(p);
      if (isSigned) qs += (qs ? '&' : '') + 'signature=' + await common().hmacHex(ctx.secret, qs);
      const url = `${ROOT}${path}${qs ? '?' + qs : ''}`;
      const init = isSigned ? { method: 'GET', headers: { 'X-MBX-APIKEY': ctx.key } } : { method: 'GET' };
      ctx.lastRetryAfter = null;
      let body;
      try {
        body = await common().request(ctx.fetchSeen, url, init, { sleep: ctx.sleep, secrets: [ctx.key, ctx.secret], retries: 0 });
      } catch (e) {
        const d = e instanceof common().ApiError ? (e.detail || {}) : {};
        const retryable = e instanceof common().ApiError && (e.code === 'rate' || (e.code === 'http' && d.status >= 500));
        if (!retryable) throw translate(e);
        attempt++;
        const ra = Number(ctx.lastRetryAfter);
        if (ra > MAX_WAIT_S) throw apiError('rate', `Binance ha limitato l'accesso per circa ${Math.ceil(ra / 60)} minuti (troppe richieste dallo stesso indirizzo IP). Riprova più tardi.`, { status: d.status });
        if (attempt >= MAX_ATTEMPTS) throw translate(e);
        await ctx.sleep((ra > 0 ? ra : Math.min(2 ** attempt, 60)) * 1000);
        continue;
      }
      if (paceMs) await ctx.sleep(paceMs);
      return body;
    }
  }

  // ---------------------------------------------------------------- scarico: schemi di paginazione
  /** Elenco con offset/limit (depositi e prelievi). */
  async function pagedOffset(ctx, path, params, limit, paceMs, keyFn) {
    const rows = [], seen = new Set();
    for (let offset = 0, page = 0; ; page++) {
      if (page >= MAX_PAGES) throw apiError('incomplete', `Binance (${path}): troppe pagine, l'elenco non si riesce a esaurire.`, { path });
      const body = await call(ctx, path, Object.assign({}, params, { offset, limit }), paceMs);
      if (!Array.isArray(body)) throw formatErr(path, 'attesa una lista');
      if (body.length > limit) throw formatErr(path, `la pagina ha più righe del massimo richiesto (${limit})`);
      let fresh = 0;
      for (const r of body) {
        const k = keyFn(r);
        if (k === null) throw formatErr(path, 'una riga non ha un identificativo riconoscibile');
        if (!seen.has(k)) { seen.add(k); rows.push(r); fresh++; }
      }
      if (body.length < limit) return rows;
      if (page > 0 && fresh === 0) throw formatErr(path, 'la pagina successiva ripete righe già lette (offset ignorato)');
      offset += body.length;
    }
  }

  /** Raccoglie in `map` (chiave -> riga) le righe di tutte le finestre. */
  async function scanWindows(ctx, wins, label, fn) {
    for (let i = 0; i < wins.length; i++) {
      ctx.say(`${label}: periodo ${i + 1} di ${wins.length}…`);
      await fn(wins[i]);
    }
  }
  function addRows(map, rows, keyFn, path) {
    for (const r of rows) {
      const k = keyFn(r);
      if (k === null) throw formatErr(path, 'una riga non ha un identificativo riconoscibile');
      if (!map.has(k)) map.set(k, r);
    }
  }
  const sortedRows = (map, tsFn) => [...map.entries()].sort((a, b) => ((tsFn(a[1]) || 0) - (tsFn(b[1]) || 0)) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((x) => x[1]);

  /** Se la finestra e' troppo piena per la richiesta la si divide a meta' (si riparte dai due lati), fino a 2 secondi. */
  async function bisect(ctx, s, e, fetchOne, path) {
    const r = await fetchOne(s, e);
    if (!r.truncated) return r.rows;
    if (e - s < 2000) throw apiError('incomplete', `Binance (${path}): troppe registrazioni in un intervallo di pochi secondi, non si riesce a scaricarle tutte.`, { path });
    const mid = Math.floor((s + e) / 2);
    return (await bisect(ctx, s, mid, fetchOne, path)).concat(await bisect(ctx, mid, e, fetchOne, path));
  }

  // ---------------------------------------------------------------- scarico: singoli prodotti
  async function fetchDeposits(ctx, wins) {
    const map = new Map();
    await scanWindows(ctx, wins, 'Depositi di cripto', async (w) => {
      addRows(map, await pagedOffset(ctx, '/sapi/v1/capital/deposit/hisrec', { startTime: w.s, endTime: w.e }, LIM.wallet, PACE.ip, depositKey), depositKey, '/sapi/v1/capital/deposit/hisrec');
    });
    return sortedRows(map, tsOf.deposit);
  }
  async function fetchWithdrawals(ctx, wins) {
    const map = new Map();
    await scanWindows(ctx, wins, 'Prelievi di cripto', async (w) => {
      addRows(map, await pagedOffset(ctx, '/sapi/v1/capital/withdraw/history', { startTime: w.s, endTime: w.e }, LIM.wallet, PACE.withdraw, withdrawKey), withdrawKey, '/sapi/v1/capital/withdraw/history');
    });
    return sortedRows(map, tsOf.withdrawal);
  }
  async function fetchConvert(ctx, wins) {
    const path = '/sapi/v1/convert/tradeFlow', map = new Map();
    const one = async (s, e) => {
      const body = await call(ctx, path, { startTime: s, endTime: e, limit: LIM.convert }, PACE.convert);
      if (!isObject(body) || !Array.isArray(body.list) || typeof body.moreData !== 'boolean') throw formatErr(path, 'attesi "list" e "moreData"');
      if (body.list.length > LIM.convert) throw formatErr(path, 'più righe del massimo richiesto');
      return { rows: body.list, truncated: body.moreData };
    };
    await scanWindows(ctx, wins, 'Conversioni Convert', async (w) => addRows(map, await bisect(ctx, w.s, w.e, one, path), convertKey, path));
    return sortedRows(map, tsOf.convert);
  }
  async function fetchDividends(ctx, wins) {
    const path = '/sapi/v1/asset/assetDividend', map = new Map();
    const one = async (s, e) => {
      const body = await call(ctx, path, { startTime: s, endTime: e, limit: LIM.dividend }, PACE.dividend);
      if (!isObject(body) || !Array.isArray(body.rows)) throw formatErr(path, 'attesa la lista "rows"');
      if (body.rows.length > LIM.dividend) throw formatErr(path, 'più righe del massimo richiesto');
      return { rows: body.rows, truncated: body.rows.length >= LIM.dividend };   // senza offset: pagina piena = si divide la finestra
    };
    await scanWindows(ctx, wins, 'Dividendi e airdrop', async (w) => addRows(map, await bisect(ctx, w.s, w.e, one, path), dividendKey, path));
    return sortedRows(map, tsOf.dividend);
  }
  async function fetchDust(ctx, wins) {
    const path = '/sapi/v1/asset/dribblet', map = new Map();
    const one = async (s, e) => {
      const body = await call(ctx, path, { startTime: s, endTime: e }, PACE.ip);
      if (!isObject(body) || !Array.isArray(body.userAssetDribblets)) throw formatErr(path, 'attesa la lista "userAssetDribblets"');
      let details = 0;
      for (const x of body.userAssetDribblets) {
        if (!isObject(x)) throw formatErr(path, 'una registrazione non è un oggetto');
        if (x.userAssetDribbletDetails !== undefined && !Array.isArray(x.userAssetDribbletDetails)) throw formatErr(path, '"userAssetDribbletDetails" non è una lista');
        details += (x.userAssetDribbletDetails || []).length;
      }
      return { rows: body.userAssetDribblets, truncated: body.userAssetDribblets.length >= LIM.dust || details >= LIM.dust };   // "solo le ultime 100"
    };
    await scanWindows(ctx, wins, 'Piccoli saldi convertiti', async (w) => addRows(map, await bisect(ctx, w.s, w.e, one, path), dustKey, path));
    return sortedRows(map, tsOf.dust);
  }
  async function fetchPayments(ctx, wins, type) {
    const path = '/sapi/v1/fiat/payments', map = new Map();
    await scanWindows(ctx, wins, type === 0 ? 'Acquisti con carta o bonifico' : 'Vendite verso carta o bonifico', async (w) => {
      let collected = 0, total = null;
      for (let page = 1; ; page++) {
        if (page > MAX_PAGES) throw apiError('incomplete', `Binance (${path}): troppe pagine, l'elenco non si riesce a esaurire.`, { path });
        const body = await call(ctx, path, { transactionType: type, beginTime: w.s, endTime: w.e, page, rows: LIM.fiatRows }, PACE.ip);
        if (!isObject(body)) throw formatErr(path, 'attesa una risposta con "data"');
        if (body.success === false || (typeof body.code === 'string' && body.code !== '000000')) {
          throw apiError('http', `Binance ha risposto con un errore (${path}, codice ${common().redact(String(body.code), [ctx.key, ctx.secret]).slice(0, 20)}).`, { path, platformCode: body.code });
        }
        let data = body.data;
        if ((data === null || data === undefined) && body.success === true && !(Number(body.total) > 0)) data = [];
        if (!Array.isArray(data)) throw formatErr(path, 'attesa la lista "data"');
        if (data.length > LIM.fiatRows) throw formatErr(path, 'più righe del massimo richiesto');
        if (typeof body.total === 'number' && Number.isFinite(body.total)) total = body.total;
        else if (typeof body.total === 'string' && /^\d+$/.test(body.total.trim())) total = Number(body.total.trim());
        let fresh = 0;
        for (const r of data) {
          const k = paymentKey(r);
          if (k === null) throw formatErr(path, 'una riga non ha un identificativo riconoscibile');
          if (!map.has(k)) { map.set(k, r); fresh++; }
        }
        collected += data.length;
        if (data.length === 0) break;
        const more = data.length >= LIM.fiatRows || (total !== null && collected < total);
        if (!more) break;
        if (page > 1 && fresh === 0) throw formatErr(path, 'la pagina successiva ripete righe già lette');
      }
      if (total !== null && collected < total) throw apiError('incomplete', `Binance (${path}) dichiara ${total} registrazioni nel periodo ma ne ha consegnate ${collected}.`, { path });
    });
    return sortedRows(map, tsOf.payment);
  }

  /** Tutte le operazioni spot di un simbolo: fromId (da 0), 1000 per volta, "pagina piena = si continua". */
  async function fetchTrades(ctx, symbol) {
    const path = '/api/v3/myTrades', rows = [], seen = new Set();
    let fromId = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await call(ctx, path, { symbol, fromId, limit: LIM.trades }, ctx.spotPace);
      if (!Array.isArray(body)) throw formatErr(path, 'attesa una lista', { symbol });
      if (body.length > LIM.trades) throw formatErr(path, 'più righe del massimo richiesto', { symbol });
      let maxId = -1;
      for (const r of body) {
        const k = tradeKey(r);
        if (k === null) throw formatErr(path, 'un\'operazione non ha un id numerico valido', { symbol });
        const id = r.id;
        if (id < fromId) throw formatErr(path, `l'elenco contiene operazioni precedenti a fromId (${fromId}): il parametro non è stato rispettato`, { symbol });
        if (typeof r.symbol === 'string' && r.symbol !== symbol) throw formatErr(path, 'una riga è di un\'altra coppia', { symbol });
        if (!seen.has(id)) { seen.add(id); rows.push(r); }
        if (id > maxId) maxId = id;
      }
      if (body.length < LIM.trades) return rows;
      fromId = maxId + 1;
    }
    throw apiError('incomplete', `Binance (${path}): troppe pagine per la coppia ${symbol}, l'elenco non si riesce a esaurire.`, { path, symbol });
  }

  // ---------------------------------------------------------------- sync
  function readExchangeInfo(body) {
    const path = '/api/v3/exchangeInfo';
    if (!isObject(body) || !Array.isArray(body.symbols)) throw formatErr(path, 'attesa la lista "symbols"');
    const symbols = new Map();
    for (const s of body.symbols) {
      if (!isObject(s) || !str(s.symbol) || !str(s.baseAsset) || !str(s.quoteAsset)) throw formatErr(path, 'un simbolo non ha symbol, baseAsset e quoteAsset');
      symbols.set(str(s.symbol), { symbol: str(s.symbol), baseAsset: upper(s.baseAsset), quoteAsset: upper(s.quoteAsset), status: str(s.status) });
    }
    // limite di peso al minuto dichiarato da Binance (REQUEST_WEIGHT): serve a regolare le pause
    let perMin = null;
    for (const r of Array.isArray(body.rateLimits) ? body.rateLimits : []) {
      if (!isObject(r) || r.rateLimitType !== 'REQUEST_WEIGHT' || !(Number(r.limit) > 0) || !(Number(r.intervalNum) > 0)) continue;
      const mins = { SECOND: 1 / 60, MINUTE: 1, HOUR: 60, DAY: 1440 }[r.interval];
      if (!mins) continue;
      const v = Number(r.limit) / (Number(r.intervalNum) * mins);
      if (perMin === null || v < perMin) perMin = v;
    }
    return { symbols, weightPerMin: perMin };
  }

  function readAccount(body) {
    const path = '/api/v3/account';
    if (!isObject(body) || !Array.isArray(body.balances)) throw formatErr(path, 'attesa la lista "balances"');
    const balances = body.balances.map((b) => {
      if (!isObject(b) || !str(b.asset) || decStr(b.free) === null || decStr(b.locked) === null) throw formatErr(path, 'un saldo non ha asset, free e locked');
      return { asset: upper(b.asset), free: decStr(b.free), locked: decStr(b.locked) };
    }).filter((b) => !D(b.free).isZero() || !D(b.locked).isZero()).sort((a, b) => (a.asset < b.asset ? -1 : 1));
    return { accountType: str(body.accountType), updateTime: msVal(body.updateTime), balances };
  }

  function spanOf(rows, tsFn) {
    let from = null, to = null;
    for (const r of rows) { const t = tsFn(r); if (t === null) continue; if (from === null || t < from) from = t; if (to === null || t > to) to = t; }
    return { from: from === null ? null : iso(from), to: to === null ? null : iso(to) };
  }

  async function sync(creds, opts) {
    opts = opts || {};
    const ctx = makeCtx(creds, opts);
    const startedAt = ctx.localMs();
    const cfg = parseOptions(opts.options, startedAt);
    const say = ctx.say;
    const warnings = [];

    say('Controllo l\'orologio di Binance…');
    const t0 = ctx.localMs();
    const tm = await call(ctx, '/api/v3/time', {}, PACE.ip, false);
    const t1 = ctx.localMs();
    if (!isObject(tm) || !Number.isSafeInteger(tm.serverTime) || tm.serverTime < 1e12) throw formatErr('/api/v3/time', 'atteso "serverTime" in millisecondi');
    ctx.offset = tm.serverTime - Math.round((t0 + t1) / 2);
    const toMsEnd = ctx.nowMs();
    const from = cfg.startMs - 1;

    say('Leggo l\'elenco delle coppie di Binance…');
    const info = readExchangeInfo(await call(ctx, '/api/v3/exchangeInfo', { showPermissionSets: 'false' }, PACE.ip, false));
    const perMin = info.weightPerMin || FALLBACK_WEIGHT_PER_MIN;
    ctx.spotPace = Math.max(150, Math.ceil((20 * 60000) / (perMin * SPOT_BUDGET)));   // peso 20 per ogni myTrades

    say('Leggo i saldi del conto spot…');
    const account = readAccount(await call(ctx, '/api/v3/account', { omitZeroBalances: 'true' }, ctx.spotPace));

    const deposits = await fetchDeposits(ctx, makeWindows(from, toMsEnd, WIN.wallet.len, WIN.wallet.overlap));
    const withdrawals = await fetchWithdrawals(ctx, makeWindows(from, toMsEnd, WIN.wallet.len, WIN.wallet.overlap));
    const convert = await fetchConvert(ctx, makeWindows(from, toMsEnd, WIN.convert.len, WIN.convert.overlap));
    const dividends = await fetchDividends(ctx, makeWindows(from, toMsEnd, WIN.dividend.len, WIN.dividend.overlap));
    const dustFrom = Math.max(from, DUST_FLOOR - 1);
    const dust = await fetchDust(ctx, makeWindows(dustFrom, toMsEnd, WIN.dust.len, WIN.dust.overlap));
    const payFrom = makeWindows(from, toMsEnd, WIN.fiat.len, WIN.fiat.overlap);
    const payBuy = await fetchPayments(ctx, payFrom, 0);
    const paySell = await fetchPayments(ctx, payFrom, 1);

    // ---- elenco delle coppie spot da interrogare
    const seen = new Set();
    for (const b of account.balances) seen.add(b.asset);
    for (const r of deposits) if (str(r.coin)) seen.add(upper(r.coin));
    for (const r of withdrawals) if (str(r.coin)) seen.add(upper(r.coin));
    for (const r of convert) { if (str(r.fromAsset)) seen.add(upper(r.fromAsset)); if (str(r.toAsset)) seen.add(upper(r.toAsset)); }
    for (const r of dividends) if (str(r.asset)) seen.add(upper(r.asset));
    for (const r of dust) for (const x of r.userAssetDribbletDetails || []) { if (isObject(x) && str(x.fromAsset)) seen.add(upper(x.fromAsset)); if (isObject(x) && str(x.targetAsset)) seen.add(upper(x.targetAsset)); }
    for (const r of payBuy.concat(paySell)) if (str(r.cryptoCurrency)) seen.add(upper(r.cryptoCurrency));

    const quoteSet = new Set(cfg.quotes);
    quoteSet.add('EUR');                                        // le coppie in euro si interrogano sempre
    const candidates = [...info.symbols.values()].filter((s) => quoteSet.has(s.quoteAsset)).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
    const extras = [];
    for (const s of cfg.extraSymbols) {
      if (info.symbols.has(s)) extras.push(info.symbols.get(s));
      else warnings.push(`La coppia «${s}» che hai indicato non è nell'elenco attuale di Binance (ritirata dal listino o scritta in modo diverso): non posso interrogarla. Le sue operazioni vanno aggiunte con il file.`);
    }
    const queried = new Set(), trades = {};
    let tradeCount = 0, round = 0;
    for (;;) {
      const todo = new Map();
      for (const s of candidates) if (!queried.has(s.symbol) && (s.quoteAsset === 'EUR' || seen.has(s.baseAsset))) todo.set(s.symbol, s);
      if (round === 0) for (const s of extras) if (!queried.has(s.symbol)) todo.set(s.symbol, s);
      round++;
      if (!todo.size) break;
      const list = [...todo.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        queried.add(s.symbol);
        say(`Operazioni spot: coppia ${i + 1} di ${list.length} (${s.symbol}), trovate finora ${tradeCount}…`);
        const rows = await fetchTrades(ctx, s.symbol);
        if (!rows.length) continue;
        trades[s.symbol] = rows.sort((a, b) => a.id - b.id);
        tradeCount += rows.length;
        // le coppie scoperte allargano la ricerca: l'altra gamba e la valuta della commissione contano come "viste"
        seen.add(s.baseAsset); seen.add(s.quoteAsset);
        for (const r of rows) if (str(r.commissionAsset)) seen.add(upper(r.commissionAsset));
      }
    }
    const withTrades = Object.keys(trades).sort();

    // ---- avvisi
    const nPay = payBuy.length + paySell.length;
    warnings.push(`Operazioni spot: Binance non dice con quali coppie hai operato. Ho interrogato ${queried.size} coppie (tutte quelle in euro e quelle con ${[...quoteSet].filter((q) => q !== 'EUR').join(', ') || 'nessun\'altra valuta'} il cui asset risulta nel tuo conto, nei depositi, nei prelievi, nelle conversioni o nelle operazioni già trovate): ne hanno dato operazioni ${withTrades.length}. Le coppie ritirate dal listino non si possono interrogare e un asset venduto per intero e mai depositato può sfuggire: controlla i saldi finali con quelli di Binance e, se manca qualcosa, aggiungi le coppie nell'opzione «Coppie aggiuntive» oppure integra con il file.`);
    const pendDep = deposits.filter((r) => DEPOSIT_PENDING[Number(r.status)] !== undefined).length;
    const pendWd = withdrawals.filter((r) => WITHDRAW_PENDING[Number(r.status)] !== undefined).length;
    if (pendDep) warnings.push(`${pendDep} deposit${pendDep === 1 ? 'o non è' : 'i non sono'} ancora completat${pendDep === 1 ? 'o' : 'i'} (in attesa, errat${pendDep === 1 ? 'o' : 'i'} o da confermare): vengono segnalat${pendDep === 1 ? 'o' : 'i'} come da controllare.`);
    if (pendWd) warnings.push(`${pendWd} prelievo${pendWd === 1 ? '' : 'i'} non ancora completat${pendWd === 1 ? 'o' : 'i'}: ${pendWd === 1 ? 'viene segnalato' : 'vengono segnalati'} come da controllare. Riesegui lo scarico a prelievo concluso.`);
    if (withdrawals.some((r) => dec(r.transactionFee) && dec(r.transactionFee).gt(0))) {
      warnings.push(cfg.withdrawFeeIncluded
        ? 'Prelievi: Binance non documenta se l\'importo comprende la commissione di rete. Come da tua opzione, è considerato comprensivo: la quantità uscita è l\'importo indicato.'
        : 'Prelievi: Binance non documenta se l\'importo comprende la commissione di rete. È considerato senza commissione: la quantità uscita è importo + commissione. Se i trasferimenti verso un altro tuo conto risultano con una commissione doppia, rifai lo scarico con l\'opzione «L\'importo dei prelievi comprende già la commissione» impostata su «sì».');
    }
    if (paySell.length) warnings.push(`Ci sono ${paySell.length} vendite verso carta o bonifico: Binance non documenta i campi di queste registrazioni, quindi vengono segnalate come da controllare.`);
    if (account.balances.some((b) => /^LD[A-Z0-9]{2,}$/.test(b.asset))) warnings.push('Il conto contiene asset con prefisso «LD» (Risparmio flessibile): gli interessi di Earn non vengono scaricati e vanno aggiunti con il file.');
    if (!nPay && !deposits.length && !withdrawals.length && !convert.length && !dividends.length && !dust.length && !tradeCount) warnings.push('Non ho trovato nessuna operazione. Controlla di aver usato la chiave del conto giusto (non di un sotto-conto) e che la data di inizio sia corretta.');

    // ---- copertura
    const cov = (what, rows, tsFn, complete, note) => Object.assign({ what, count: rows.length }, spanOf(rows, tsFn), { complete, note });
    const scanNote = `Scansione per periodi dal ${dmy(cfg.startMs)} a oggi. Binance non dichiara per quanto tempo conserva lo storico: se prima del ${dmy(cfg.startMs)} avevi già operato, integra con il file.`;
    const tradeRows = withTrades.reduce((a, s) => a.concat(trades[s]), []);
    const coverage = [
      cov('Operazioni spot (acquisti, vendite e scambi)', tradeRows, tsOf.trade, false,
        `Interrogate ${queried.size} coppie, ${withTrades.length} con operazioni. Binance non permette di elencare le coppie usate: quelle ritirate dal listino non sono interrogabili e un asset venduto per intero e mai depositato può sfuggire. Controlla i saldi finali e integra con il file se manca qualcosa.`),
      cov('Depositi di cripto', deposits, tsOf.deposit, true, scanNote),
      cov('Prelievi di cripto', withdrawals, tsOf.withdrawal, true, scanNote),
      cov('Conversioni (Binance Convert)', convert, tsOf.convert, true, scanNote),
      cov('Dividendi, airdrop e premi (Asset Dividend)', dividends, tsOf.dividend, true, scanNote + ' Il tipo di premio è un testo libero di Binance: tutti sono trattati come proventi.'),
      cov('Conversioni di piccoli saldi in BNB', dust, tsOf.dust, cfg.startMs >= DUST_FLOOR,
        'Binance restituisce solo le registrazioni successive al 01/12/2020 (e le ultime 100 per richiesta, gestite dividendo i periodi). Le conversioni di piccoli saldi precedenti vanno aggiunte con il file. Il conto margine non è compreso.'),
      cov('Acquisti con carta o bonifico (Compra cripto)', payBuy, tsOf.payment, true, `${scanNote} La commissione è considerata già compresa nell'importo pagato.`),
      { what: 'Depositi e prelievi in euro (bonifico, carta, SEPA)', complete: false, note: 'Non scaricati: non sono acquisti né vendite e non cambiano il calcolo delle plusvalenze; la richiesta di Binance è molto lenta (meno di 3 richieste al minuto). Gli acquisti fatti con quei fondi compaiono tra le operazioni spot.' },
      { what: 'Simple Earn (Risparmio flessibile e bloccato)', complete: false, note: 'Non scaricato: interessi e premi di Earn vanno aggiunti con il file (Binance → Ordini → Cronologia transazioni, oppure il modello universale).' },
      { what: 'Staking, Launchpool, Megadrop e altri premi', complete: false, note: 'Non scaricati (alcuni premi possono comparire tra i dividendi, ma non c\'è modo di saperlo con certezza). Integra con il file.' },
      { what: 'Margine (cross e isolato)', complete: false, note: 'Non scaricato: se hai operato a margine, aggiungi le operazioni con il file.' },
      { what: 'Futures (USDⓈ-M e COIN-M) e opzioni', complete: false, note: 'Non scaricati e non gestiti dal programma: i derivati vanno valutati a parte.' },
      { what: 'P2P', complete: false, note: 'Non scaricato (Binance non offre uno storico P2P in questo collegamento): aggiungi gli scambi P2P con il file.' },
      { what: 'Binance Pay e Carta Binance', complete: false, note: 'Non scaricati: pagamenti, regali e cashback vanno aggiunti con il file.' },
      { what: 'Acquisti ricorrenti (Auto-Invest) e altri prodotti', complete: false, note: 'Non scaricati: non è verificabile che compaiano tra le operazioni spot. Vale anche per prestiti, mining, NFT, Alpha e sotto-conti (ogni sotto-conto ha le sue chiavi).' },
    ];

    const symbolsOut = withTrades.map((s) => { const x = info.symbols.get(s); return { symbol: x.symbol, baseAsset: x.baseAsset, quoteAsset: x.quoteAsset, status: x.status }; });
    const raw = {
      version: 1,
      fetchedAt: iso(startedAt),
      range: { from: iso(cfg.startMs), to: iso(toMsEnd) },
      options: { quotes: cfg.quotes, extraSymbols: cfg.extraSymbols, startDate: cfg.startDate, withdrawFeeIncluded: cfg.withdrawFeeIncluded },
      queriedSymbols: [...queried].sort(),
      symbols: symbolsOut,
      account,
      spotTrades: trades,
      deposits,
      withdrawals,
      convert,
      dividends,
      dust,
      fiatPayments: { buy: payBuy, sell: paySell },
    };
    say('Scarico completato.');
    return { raw, coverage, warnings };
  }

  // ---------------------------------------------------------------- parse: dai dati grezzi agli eventi
  const FormatError = () => (CT.csv && CT.csv.FormatError) || Error;
  const listOf = (v, name) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new (FormatError())(`Dati Binance non validi: "${name}" non è una lista.`);
    return v;
  };

  /** Evento per uno scambio in cui si cede (give) e si riceve (get): fiat -> cripto = BUY, cripto -> fiat = SELL, cripto -> cripto = SWAP. */
  function exchangeEvent(base, give, giveQty, get, getQty, fee) {
    const gf = FIAT.has(give), tf = FIAT.has(get);
    if (gf && tf) return mkEvent({ ...base, kind: Kind.INFO, note: `${base.note ? base.note + ' · ' : ''}Cambio tra valute (${give} → ${get}): nessun effetto sulle cripto` });
    if (gf) return mkEvent({ ...base, ...fee, kind: Kind.BUY, asset: get, qty: getQty, value: giveQty, valueCcy: give });
    if (tf) return mkEvent({ ...base, ...fee, kind: Kind.SELL, asset: give, qty: giveQty, value: getQty, valueCcy: get });
    return mkEvent({ ...base, ...fee, kind: Kind.SWAP, asset: give, qty: giveQty, counterAsset: get, counterQty: getQty });
  }

  function parse(raw, fileName) {
    const imp = CT.importers;
    const FE = FormatError();
    if (!isObject(raw) || raw.version !== 1) throw new FE('Dati Binance non riconosciuti: manca la versione 1 del formato.');
    const account = (CT.PLATFORMS && CT.PLATFORMS[PLATFORM] && CT.PLATFORMS[PLATFORM].account) || 'Binance';
    const file = fileName || 'Binance API';
    const fetched = Date.parse(raw.fetchedAt);
    const fallbackTs = new Date(Number.isFinite(fetched) ? fetched : 0);   // per i record senza data valida (restano "non riconosciuti")
    const opt = isObject(raw.options) ? raw.options : {};
    const feeIncluded = opt.withdrawFeeIncluded === true;
    const events = [];
    let rows = 0;
    const hashUid = imp.uidFactory(`api:${ID}:?`);
    const unres = (base, key, note) => events.push(imp.unresolved(base, key, note));
    const mkBase = (uid, ts, o) => ({ uid, ts: ts === null ? fallbackTs : new Date(ts), account, ...o });
    const dupe = new Set();
    const first = (k) => { if (dupe.has(k)) return false; dupe.add(k); rows++; return true; };

    // ---- operazioni spot
    const sym = new Map();
    for (const s of listOf(raw.symbols, 'symbols')) if (isObject(s) && str(s.symbol)) sym.set(str(s.symbol), { base: upper(s.baseAsset || ''), quote: upper(s.quoteAsset || '') });
    if (raw.spotTrades !== undefined && !isObject(raw.spotTrades)) throw new FE('Dati Binance non validi: "spotTrades" non è un oggetto.');
    for (const symbol of Object.keys(raw.spotTrades || {}).sort()) {
      const info = sym.get(symbol);
      for (const r of listOf(raw.spotTrades[symbol], `spotTrades.${symbol}`)) {
        const k = tradeKey(r);
        const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:trade:${symbol}:${k}`;
        if (!first(uid)) continue;
        const ts = isObject(r) ? tsOf.trade(r) : null;
        const base = mkBase(uid, ts, { ref: isObject(r) && idStr(r.orderId) ? idStr(r.orderId) : '', src: `${file}:${symbol}#${k}`, raw: r, note: `Spot ${symbol}` });
        const bad = (why) => unres(base, `Binance · operazione spot non interpretabile (${symbol})`, `Operazione spot ${symbol} non interpretabile: ${why}`);
        if (!isObject(r)) { bad('la riga non è un oggetto'); continue; }
        if (!info || !info.base || !info.quote) { unres(base, `Binance · coppia ${symbol} sconosciuta`, `Per la coppia ${symbol} mancano le valute (base/quota): non si può dire cosa è stato acquistato o venduto.`); continue; }
        const qty = dec(r.qty), quoteQty = dec(r.quoteQty), fee = dec(r.commission);
        const feeAsset = str(r.commissionAsset) ? upper(r.commissionAsset) : '';
        if (k === null || ts === null || !qty || !qty.gt(0) || !quoteQty || !quoteQty.gt(0) || typeof r.isBuyer !== 'boolean' || !fee || fee.lt(0)) { bad('mancano o non sono validi id, data, qty, quoteQty, isBuyer o commission'); continue; }
        if (fee.gt(0) && !feeAsset) { bad('commissione senza valuta'); continue; }
        const feeP = fee.gt(0) ? { feeAsset, feeQty: fee } : {};
        events.push(r.isBuyer
          ? exchangeEvent(base, info.quote, quoteQty, info.base, qty, feeP)
          : exchangeEvent(base, info.base, qty, info.quote, quoteQty, feeP));
      }
    }

    // ---- depositi
    for (const r of listOf(raw.deposits, 'deposits')) {
      const k = depositKey(r);
      const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:dep:${k}`;
      if (!first(uid)) continue;
      const ts = isObject(r) ? tsOf.deposit(r) : null;
      const coin = isObject(r) && str(r.coin) ? upper(r.coin) : '';
      const base = mkBase(uid, ts, { ref: isObject(r) ? str(r.txId) : '', src: `${file}:deposito`, raw: r, asset: coin, note: `Deposito${isObject(r) && str(r.network) ? ' ' + str(r.network) : ''}` });
      const qty = isObject(r) ? dec(r.amount) : null;
      const status = isObject(r) && (typeof r.status === 'number' || typeof r.status === 'string') && /^\d+$/.test(String(r.status)) ? Number(r.status) : null;
      if (!coin || ts === null || !qty || !qty.gt(0) || status === null) { unres(base, 'Binance · deposito non interpretabile', 'Deposito non interpretabile: mancano o non sono validi valuta, data, importo o stato.'); continue; }
      if (DEPOSIT_OK.has(status)) events.push(mkEvent({ ...base, kind: FIAT.has(coin) ? Kind.FIAT_IN : Kind.TRANSFER_IN, qty }));
      else if (DEPOSIT_IGNORED.has(status)) events.push(mkEvent({ ...base, kind: Kind.INFO, note: `Deposito respinto da Binance (stato ${status}): ignorato` }));
      else if (DEPOSIT_PENDING[status] !== undefined) unres(base, `Binance · deposito ${DEPOSIT_PENDING[status]} (stato ${status})`, `Deposito di ${qty.toFixed()} ${coin} non ancora completato (stato ${status}: ${DEPOSIT_PENDING[status]}). Rifai lo scarico a deposito accreditato, oppure ignoralo.`);
      else unres(base, `Binance · deposito con stato ${status}`, `Deposito di ${qty.toFixed()} ${coin} con uno stato sconosciuto (${status}).`);
    }

    // ---- prelievi
    for (const r of listOf(raw.withdrawals, 'withdrawals')) {
      const k = withdrawKey(r);
      const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:wd:${k}`;
      if (!first(uid)) continue;
      const ts = isObject(r) ? tsOf.withdrawal(r) : null;
      const coin = isObject(r) && str(r.coin) ? upper(r.coin) : '';
      const base = mkBase(uid, ts, { ref: isObject(r) ? str(r.txId) : '', src: `${file}:prelievo`, raw: r, asset: coin, note: `Prelievo${isObject(r) && str(r.network) ? ' ' + str(r.network) : ''}` });
      const amount = isObject(r) ? dec(r.amount) : null;
      const fee = isObject(r) && r.transactionFee !== undefined && r.transactionFee !== null ? dec(r.transactionFee) : ZERO;
      const status = isObject(r) && (typeof r.status === 'number' || typeof r.status === 'string') && /^\d+$/.test(String(r.status)) ? Number(r.status) : null;
      if (!coin || ts === null || !amount || !amount.gt(0) || !fee || fee.lt(0) || status === null) { unres(base, 'Binance · prelievo non interpretabile', 'Prelievo non interpretabile: mancano o non sono validi valuta, data, importo, commissione o stato.'); continue; }
      if (status === WITHDRAW_OK) {
        // la quantita' deve comprendere la commissione di rete: il motore la ricava abbinando l'arrivo sull'altro conto
        const qty = feeIncluded ? amount : amount.plus(fee);
        events.push(mkEvent({ ...base, kind: FIAT.has(coin) ? Kind.FIAT_OUT : Kind.TRANSFER_OUT, qty }));
      } else if (WITHDRAW_IGNORED.has(status)) events.push(mkEvent({ ...base, kind: Kind.INFO, note: `Prelievo non eseguito (stato ${status}): ignorato` }));
      else if (WITHDRAW_PENDING[status] !== undefined) unres(base, `Binance · prelievo ${WITHDRAW_PENDING[status]} (stato ${status})`, `Prelievo di ${amount.toFixed()} ${coin} non ancora concluso (stato ${status}: ${WITHDRAW_PENDING[status]}). Rifai lo scarico a prelievo concluso, oppure ignoralo.`);
      else unres(base, `Binance · prelievo con stato ${status}`, `Prelievo di ${amount.toFixed()} ${coin} con uno stato sconosciuto (${status}).`);
    }

    // ---- Convert
    for (const r of listOf(raw.convert, 'convert')) {
      const k = convertKey(r);
      const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:convert:${k}`;
      if (!first(uid)) continue;
      const ts = isObject(r) ? tsOf.convert(r) : null;
      const base = mkBase(uid, ts, { ref: isObject(r) ? (idStr(r.quoteId) || '') : '', src: `${file}:convert`, raw: r, note: 'Binance Convert' });
      const from = isObject(r) && str(r.fromAsset) ? upper(r.fromAsset) : '', to = isObject(r) && str(r.toAsset) ? upper(r.toAsset) : '';
      const fromQty = isObject(r) ? dec(r.fromAmount) : null, toQty = isObject(r) ? dec(r.toAmount) : null;
      const status = isObject(r) ? str(r.orderStatus).toUpperCase() : '';
      if (status === 'FAIL') { events.push(mkEvent({ ...base, kind: Kind.INFO, note: 'Conversione fallita: ignorata' })); continue; }
      if (k === null || !from || !to || ts === null || !fromQty || !fromQty.gt(0) || !toQty || !toQty.gt(0)) { unres(base, 'Binance · conversione non interpretabile', 'Conversione non interpretabile: mancano o non sono validi id, valute, importi o data.'); continue; }
      if (status !== 'SUCCESS') { unres(base, `Binance · conversione con stato "${status}"`, `Conversione ${fromQty.toFixed()} ${from} → ${toQty.toFixed()} ${to} con stato "${status || 'mancante'}": non è chiaro se sia stata eseguita.`); continue; }
      events.push(exchangeEvent(base, from, fromQty, to, toQty, {}));
    }

    // ---- dividendi, airdrop, premi
    for (const r of listOf(raw.dividends, 'dividends')) {
      const k = dividendKey(r);
      const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:div:${k}`;
      if (!first(uid)) continue;
      const ts = isObject(r) ? tsOf.dividend(r) : null;
      const asset = isObject(r) && str(r.asset) ? upper(r.asset) : '';
      const qty = isObject(r) ? dec(r.amount) : null;
      const info = isObject(r) ? str(r.enInfo).slice(0, 120) : '';
      const base = mkBase(uid, ts, { ref: isObject(r) && idStr(r.tranId) ? idStr(r.tranId) : '', src: `${file}:dividendo`, raw: r, asset, note: info ? `Binance: ${info}` : 'Binance: dividendo/premio' });
      if (k === null || !asset || ts === null || !qty || !qty.gt(0)) { unres(base, 'Binance · dividendo non interpretabile', `Dividendo/premio non interpretabile: mancano o non sono validi id, asset, data o importo positivo${info ? ` ("${info}")` : ''}.`); continue; }
      events.push(mkEvent({ ...base, kind: Kind.INCOME, qty, incomeType: 'other' }));
    }

    // ---- conversioni di piccoli saldi (dust): ogni asset ceduto e' uno scambio verso BNB
    for (const r of listOf(raw.dust, 'dust')) {
      const k = dustKey(r);
      const outerTs = isObject(r) ? tsOf.dust(r) : null;
      const outer = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:dust:${k}`;
      if (!first(outer)) continue;
      const details = isObject(r) && Array.isArray(r.userAssetDribbletDetails) ? r.userAssetDribbletDetails : null;
      if (k === null || !details || !details.length) {
        unres(mkBase(outer, outerTs, { src: `${file}:dust`, raw: r, note: 'Binance: conversione di piccoli saldi' }), 'Binance · conversione di piccoli saldi non interpretabile', 'Conversione di piccoli saldi senza identificativo o senza dettagli.');
        continue;
      }
      details.forEach((x, i) => {
        const dts = isObject(x) && msVal(x.operateTime) !== null ? msVal(x.operateTime) : outerTs;
        const dk = isObject(x) && idStr(x.transId) ? idStr(x.transId) : `i${i}`;
        const uid = `${outer}:${dk}:${isObject(x) && str(x.fromAsset) ? upper(x.fromAsset) : '?'}`;
        const base = mkBase(uid, dts, { ref: dk, src: `${file}:dust`, raw: x, note: 'Binance: conversione di piccoli saldi in BNB' });
        const from = isObject(x) && str(x.fromAsset) ? upper(x.fromAsset) : '', to = isObject(x) && str(x.targetAsset) ? upper(x.targetAsset) : 'BNB';
        const qty = isObject(x) ? dec(x.amount) : null, got = isObject(x) ? dec(x.transferedAmount) : null;
        if (!from || dts === null || !qty || !qty.gt(0) || !got || !got.gt(0)) { unres(base, 'Binance · conversione di piccoli saldi non interpretabile', 'Conversione di piccoli saldi: mancano o non sono validi asset, importi o data.'); return; }
        events.push(exchangeEvent(base, from, qty, to, got, {}));
      });
    }

    // ---- acquisti con carta o bonifico
    const pay = isObject(raw.fiatPayments) ? raw.fiatPayments : {};
    for (const r of listOf(pay.buy, 'fiatPayments.buy')) {
      const k = paymentKey(r);
      const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:pay:${k}`;
      if (!first(uid)) continue;
      const ts = isObject(r) ? tsOf.payment(r) : null;
      const asset = isObject(r) && str(r.cryptoCurrency) ? upper(r.cryptoCurrency) : '';
      const fiat = isObject(r) && str(r.fiatCurrency) ? upper(r.fiatCurrency) : '';
      const paid = isObject(r) ? dec(r.sourceAmount) : null, qty = isObject(r) ? dec(r.obtainAmount) : null;
      const status = isObject(r) ? str(r.status).toLowerCase() : '';
      const base = mkBase(uid, ts, { ref: k || '', src: `${file}:acquisto`, raw: r, note: `Acquisto${isObject(r) && str(r.paymentMethod) ? ' con ' + str(r.paymentMethod) : ''}` });
      if (PAYMENT_IGNORED.has(status)) { events.push(mkEvent({ ...base, kind: Kind.INFO, note: `Acquisto non andato a buon fine (${str(r.status)}): ignorato` })); continue; }
      if (k === null || !asset || !fiat || ts === null || !paid || !paid.gt(0) || !qty || !qty.gt(0)) { unres(base, 'Binance · acquisto con carta non interpretabile', 'Acquisto con carta/bonifico non interpretabile: mancano o non sono validi ordine, valute, importi o data.'); continue; }
      if (PAYMENT_PENDING.has(status)) { unres(base, `Binance · acquisto con carta in corso (${str(r.status)})`, `Acquisto di ${qty.toFixed()} ${asset} ancora in elaborazione: rifai lo scarico a operazione conclusa, oppure ignoralo.`); continue; }
      if (status !== PAYMENT_OK) { unres(base, `Binance · acquisto con carta con stato "${str(r.status)}"`, `Acquisto di ${qty.toFixed()} ${asset} con uno stato sconosciuto ("${str(r.status)}").`); continue; }
      if (FIAT.has(asset)) { unres(base, 'Binance · acquisto con carta non interpretabile', `Acquisto con carta in cui l'asset ottenuto (${asset}) è una valuta.`); continue; }
      // importo pagato = sourceAmount, commissione gia' compresa (ASSUNTO, vedi intestazione): nessuna commissione separata
      events.push(mkEvent({ ...base, kind: Kind.BUY, asset, qty, value: paid, valueCcy: fiat }));
    }
    for (const r of listOf(pay.sell, 'fiatPayments.sell')) {
      const k = paymentKey(r);
      const uid = k === null ? hashUid(isObject(r) ? r : { v: String(r) }) : `api:${ID}:paysell:${k}`;
      if (!first(uid)) continue;
      const ts = isObject(r) ? tsOf.payment(r) : null;
      const status = isObject(r) ? str(r.status).toLowerCase() : '';
      const base = mkBase(uid, ts, { ref: k || '', src: `${file}:vendita`, raw: r, note: 'Vendita verso carta o bonifico' });
      if (PAYMENT_IGNORED.has(status)) { events.push(mkEvent({ ...base, kind: Kind.INFO, note: `Vendita non andata a buon fine (${str(r.status)}): ignorata` })); continue; }
      unres(base, 'Binance · vendita verso carta o bonifico', `Vendita verso carta/bonifico${isObject(r) && str(r.cryptoCurrency) ? ` (${str(r.cryptoCurrency)})` : ''}: Binance non documenta quale campo sia la cripto venduta e quale il fiat incassato. Aggiungila con il file.`);
    }

    return imp.finish('Binance · dati da API', rows, events);
  }

  // ---------------------------------------------------------------- connettore
  CT.api[ID] = {
    id: ID,
    label: LABEL,
    platform: PLATFORM,
    fields: [
      { key: 'apiKey', label: 'Chiave API', secret: true, placeholder: 'Incolla qui la chiave API (circa 64 caratteri)' },
      { key: 'apiSecret', label: 'Chiave segreta', secret: true, placeholder: 'Incolla qui la chiave segreta' },
    ],
    options: [
      { key: 'quotes', label: 'Valute di quotazione da cercare nelle operazioni spot', placeholder: DEFAULT_QUOTES, default: DEFAULT_QUOTES, help: 'Binance non elenca le coppie in cui hai operato. Vengono cercate le coppie quotate in queste valute il cui asset compare nel tuo conto, più sempre tutte quelle in euro. Se hai usato altre valute (per esempio BUSD o TRY) aggiungile qui, separate da virgole.' },
      { key: 'extraSymbols', label: 'Coppie aggiuntive da cercare', placeholder: 'Per esempio: BTCBUSD, ADAEUR', help: 'Coppie scritte come le chiama Binance (senza trattini), separate da virgole. Servono per operazioni su coppie che il programma non cerca da solo. Le coppie ritirate da Binance non si possono interrogare.' },
      { key: 'startDate', label: 'Data di inizio della ricerca', placeholder: DEFAULT_START, default: DEFAULT_START, help: 'Binance non dice da quando conserva lo storico. Si parte dal 1 luglio 2017 (avvio di Binance). Se hai aperto il conto dopo, indica qui la data di apertura (aaaa-mm-gg): lo scarico sarà molto più veloce.' },
      { key: 'withdrawFee', label: 'L\'importo dei prelievi comprende già la commissione di rete? (sì/no)', placeholder: 'no', default: 'no', help: 'Binance non lo documenta. Con «no» la quantità uscita è importo + commissione. Cambia in «sì» solo se i trasferimenti verso un altro tuo conto risultano con una commissione doppia.' },
    ],
    help: [
      'Accedi a Binance dal sito web e apri Profilo → Gestione API (API Management).',
      'Crea una nuova chiave: scegli «Generata dal sistema» (HMAC), dalle un nome (per esempio «Dichiarazione») e completa la verifica di sicurezza.',
      'Tra le autorizzazioni lascia attiva SOLO «Abilita lettura» (Enable Reading). NON abilitare il trading spot e margine, i futures, né i prelievi.',
      'Se hai limitato la chiave a certi indirizzi IP, aggiungi quello da cui stai usando questa pagina (cerca «il mio IP» sul web), altrimenti Binance rifiuterà le richieste.',
      'Copia la chiave API e la chiave segreta (la segreta compare una volta sola, subito dopo la creazione) e incollale nei campi qui sotto.',
      'A scarico finito, elimina la chiave da Binance.',
    ],
    limits: [
      'Operazioni spot: Binance non permette di sapere con quali coppie hai operato. Il programma cerca le coppie in euro e quelle quotate nelle valute scelte il cui asset risulta nel tuo conto, nei depositi, nei prelievi o nelle conversioni. Le coppie ritirate da Binance non si possono interrogare e un asset venduto per intero e mai depositato può sfuggire: confronta i saldi finali con quelli di Binance e integra con il file se manca qualcosa.',
      'Non vengono scaricati: Simple Earn (interessi del Risparmio flessibile e bloccato), staking, Launchpool e Megadrop, margine, futures e opzioni, P2P, Binance Pay e Carta Binance, acquisti ricorrenti (Auto-Invest), prestiti, mining, NFT e sotto-conti. Vanno aggiunti con il file o con il modello universale.',
      'Depositi e prelievi in euro (bonifico, carta) non vengono scaricati: non cambiano le plusvalenze e la richiesta di Binance è lentissima.',
      'Le conversioni di piccoli saldi in BNB sono disponibili solo dal 1 dicembre 2020.',
      'Binance non dichiara quanto indietro conserva lo storico di depositi, prelievi e conversioni: per gli anni più vecchi il file con lo storico completo resta la via più sicura.',
      'Prelievi: Binance non documenta se l\'importo comprende la commissione di rete; per impostazione predefinita si considera esclusa (vedi l\'opzione dedicata).',
      'Acquisti con carta: la commissione è considerata già compresa nell\'importo pagato; le vendite verso carta o bonifico vengono segnalate come da controllare.',
      'Lo scarico può durare diversi minuti (Binance limita il numero di richieste): non chiudere la pagina.',
      'Sono supportate solo chiavi «generate dal sistema» (HMAC), non quelle Ed25519 o RSA.',
    ],
    sync,
    parse,
    _internal: { makeWindows, parseOptions, applyTimeMs, depositKey, withdrawKey, convertKey, dividendKey, dustKey, paymentKey, tradeKey, readExchangeInfo, constants: { WIN, PACE, LIM, RECV_WINDOW, DUST_FLOOR } },
  };
  if (typeof module !== 'undefined') module.exports = CT.api.binance;
})();
