/* Collegamento API Bitpanda (sola lettura): scarica lo storico delle operazioni e lo converte in eventi.

   ======================================================================================================
   STATO DELLA VERIFICA (leggere prima di fidarsi dei dati)
   ======================================================================================================
   Il sito della documentazione ufficiale (docs.public.bitpanda.com, developers.bitpanda.com) NON e' raggiungibile
   dal sandbox di sviluppo. La struttura delle risposte di /operations si basa percio' su:
     - repository ufficiale Bitpanda (README, OpenAPI, esempi, skill per agenti): autenticazione, host, percorsi;
     - estensioni open source di terzi provate su risposte REALI (settembre-ottobre 2026): forma di /operations,
       prefisso /v1 e nomi snake_case della paginazione.
   Il collegamento NON e' stato provato da noi con un conto reale. Per questo ogni dubbio viene trasformato in un
   blocco visibile (evento UNRESOLVED, errore 'format', coverage.complete = false) e MAI in un'ipotesi silenziosa.

   FONTI
   [F1] https://github.com/bitpanda-labs/bitpanda-public-api  (ufficiale: README.md, docs/openapi.yaml, docs/mcp-tools.md,
        examples/rest-api.md; riletti il 2026-10-06 da raw.githubusercontent.com)
   [F2] https://github.com/bitpanda-labs/bitpanda-public-api/issues/6  (ufficiale, discussione; NON rilegibile dal sandbox:
        github.com risponde 403. Riferito da chi ha verificato il modulo: segnala percorsi dell'OpenAPI che in produzione
        danno 404 e che la documentazione ospitata usa il prefisso /v1. Non cita /operations. Usarlo solo come indizio.)
   [F3] https://docs.public.bitpanda.com/api-key-generation  (ufficiale; NON raggiungibile: letto solo tramite un
        riassunto di un motore di ricerca)
   [F4] https://docs.public.bitpanda.com/migrating-from-the-legacy-api  (ufficiale; NON raggiungibile: idem)
   [F5] https://github.com/navimike/MoneyMoney-Bitpanda-PublicAPI  (NON ufficiale, licenza MIT, versione 2.03 del
        2026-10-04: codice e test provati su risposte reali dell'API pubblica; riletto il file bitpanda-api.lua;
        usato solo come riferimento sui fatti, nessun codice copiato)
   [F6] https://github.com/matteoantoci/mcp-bitpanda, file docs/bitpanda-api.md  (copia della documentazione ufficiale
        dell'API "legacy" https://developers.bitpanda.com/platform, usata solo per oro/metalli e commissioni)
   [F7] https://github.com/bitpanda-labs/agent-skills  (ufficiale, ma descrive un'ALTRA API: base https://developer.bitpanda.com,
        GET /v1/transactions con cursori before/after e page_size). skills/bitpanda/SKILL.md elenca i tipi di asset
        "cryptocoin, metal, stock, commodity, etf" e i campi "compensates" e "trade_id"; skills/bitpanda/references/api_reference.md
        contiene il campo "fee_amount" e, tra i tipi di asset, solo "cryptocoin". Non descrive /operations.
   [F8] https://github.com/pneumann1980/portfolia, README.md  (NON ufficiale; l'autore dichiara di aver letto la referenza
        ufficiale docs.public.bitpanda.com/list-operations e di NON aver provato risposte reali: riletto il README)

   ELENCO DEI FATTI  (V = verificato sulla fonte citata; O = osservato da terzi su dati reali [F5]/[F8]; A = ASSUNTO)
   Host https://api.public.bitpanda.com ........................ V [F1] (servers dell'OpenAPI, README ed esempi)
   Prefisso /v1 dei percorsi (BASE_URL = host + /v1) ........... O [F5] (e [F8]). NON verificato: README, OpenAPI ed esempi
                                                                  di [F1] usano i percorsi SENZA /v1 (/assets, /operations);
                                                                  [F2] segnala disallineamenti tra l'OpenAPI e la produzione.
                                                                  Un percorso sbagliato darebbe 404 (errore rumoroso, mai
                                                                  dati parziali).
   Intestazione di autenticazione "x-api-key" ................. V [F1] (README e securityScheme dell'OpenAPI)
   Dove si crea la chiave ..................................... V [F1] app.bitpanda.com/my-account/apikey, scheda "Bitpanda"
   Permessi della chiave ...................................... V [F3 via riassunto]: Trade (Read), Trade (Write), Balances,
                                                                  Transaction, Earn (Read), Earn (Write). "Transaction" =
                                                                  storico di depositi, prelievi e scambi; "Trade (Read)" =
                                                                  asset, valute e prezzi. Qui servono SOLO questi due.
   Le API "legacy" (trades, wallets/transactions,
   fiatwallets/transactions, assets/transactions/commodity)
   sono sostituite da un unico GET /v1/operations ............. V [F4 via riassunto]
   Esistenza di GET /operations, /assets (filtro "id"),
   /currencies (filtro "id") ................................... V [F1] (OpenAPI)
   Paginazione a cursore: parametri "cursor" e "page_size" .... O [F5]. L'OpenAPI ufficiale [F1] scrive "pageSize" (camelCase)
                                                                  e descrive la risposta come { data, cursor } ("cursor" assente
                                                                  quando non ci sono altre pagine): NON usa has_next_page.
                                                                  [F8] riferisce che la referenza ufficiale OSPITATA (non
                                                                  raggiungibile) usa page_size, cursor, next_cursor e
                                                                  has_next_page: non riverificato. Nelle RISPOSTE si accettano
                                                                  entrambe le grafie; nelle richieste si usa quella osservata.
   page_size = 100 ............................................ O [F5] (MoneyMoney usa 100). L'intervallo 1-100 e' scritto in
                                                                  [F1] docs/mcp-tools.md ma per il parametro pageSize dei TOOL
                                                                  MCP, non per la REST (l'OpenAPI REST dice solo "minimum 1").
                                                                  Se Bitpanda risponde 400 alla prima pagina si riprova UNA volta
                                                                  senza page_size (predefinito 25, [F1] mcp-tools.md).
   Risposta: { data:[...], has_next_page, next_cursor } ....... O [F5] (e [F8]). La fine dell'elenco e' confermata SOLO da
                                                                  has_next_page === false; senza, coverage.complete = false.
   Anomalie dell'API: l'ultima pagina riporta ancora un
   next_cursor con has_next_page=false; un cursore sconosciuto
   fa ripartire dalla pagina 1 (nessun errore) ................ O [F5] -> si usa SOLO has_next_page e si riconosce il riavvio
   Corpi di errore { errors:[{status,code,title}] } oppure
   { error:{code,status} } .................................... O [F5] (osservati con codici HTTP di errore; con HTTP 200 NON
                                                                  osservati). Per difesa un corpo cosi' e' sempre un errore,
                                                                  anche con HTTP 200 e anche se contiene "data": mai "dati".
   Filtro "from" su /operations ............................... esiste in [F1]; il confronto con credited_at NON e' noto.
                                                                  NON viene usato: si legge tutto lo storico senza finestre.
   Forma dell'operazione { operation_id, operation_type,
   transactions:[ ... ] } ..................................... O [F5]. ATTENZIONE: lo schema "Operation" dell'OpenAPI ufficiale
                                                                  [F1] ({id,type,assetId,amount,timestamp}) e' DIVERSO e non
                                                                  contiene importi in euro ne' commissioni: non e' usabile per
                                                                  il calcolo delle tasse. Si segue [F5].
   Movimento (transactions[i]): transaction_id,
   transaction_type, flow = INCOMING|OUTGOING, currency_id
   (movimento in valuta) oppure asset_id (movimento in asset),
   index_asset_id, asset_amount = { value:"..." }, credited_at
   (ISO 8601, UTC), asset_balance_after = { value }, wallet_id . O [F5]
   Importi come STRINGHE decimali ............................. O [F5]. Un importo non stringa o non numerico rende
                                                                  l'operazione "non riconosciuta" (mai arrotondamenti float).
   Tipi di operazione visti: deposit, withdrawal, buy, sell,
   savings_plan, "*_reserve" (prenotazione fondi per ordini
   di borsa); tipi di movimento: buy, sell, deposit, withdrawal,
   transfer, fee, tax, dividend, reward, interest ............. O [F5]. Ogni altro tipo -> UNRESOLVED.
   Deposito annullato: asset_balance_after = -1 ............... O [F5] (un solo osservatore) -> solo per deposit/withdrawal
                                                                  interamente negativi, altrimenti UNRESOLVED
   Campi "fee_amount" (movimento), "trade" { trade_id, fee,
   rate, rate_with_fee } e "compensates" ...................... citati da [F8] come campi di /operations (non riletti sulla
                                                                  referenza ufficiale, non raggiungibile); "fee_amount" e
                                                                  "compensates" esistono in [F7] per l'ALTRA API (/v1/transactions:
                                                                  "compensates = Links to a reversed/corrected transaction ID").
                                                                  "compensates_info": segnalato solo da chi ha verificato il modulo,
                                                                  NON ritrovato in [F7] ne' [F8]: per prudenza vale come "compensates"
                                                                  (qualunque valore non vuoto blocca; nessun effetto se assente).
                                                                  La SEMANTICA e' NON documentata: la commissione e' gia' compresa
                                                                  in asset_amount o si aggiunge? Cosa stornano compensates? ->
                                                                  nessuna ipotesi: ogni commissione diversa da zero in questi campi
                                                                  e ogni storno (sia lo storno sia l'operazione stornata) diventano
                                                                  UNRESOLVED con il motivo.
   Catalogo asset: GET /assets?id=<uuid> -> { data:[{ id, name,
   symbol, isin, type, group }] } ............................. V [F1] (filtro "id" uuid singolo) e O [F5] (forma). Si
                                                                  chiede un asset per volta (solo il caso documentato).
                                                                  Un id sconosciuto -> elenco vuoto: O [F5], NESSUNA fonte
                                                                  ufficiale lo documenta (le operazioni relative diventano
                                                                  "non riconosciute").
   Valori di type/group: cryptocoin/coin|token; commodity/metal;
   index/index; equity_security|security / stock|etf|etc|
   equity_stock|equity_etf|...|fiat_earn ...................... O [F5]. I tipi "cryptocoin", "metal", "stock", "commodity", "etf"
                                                                  compaiono anche in [F7] SKILL.md (altra API); l'OpenAPI [F1]
                                                                  scrive per Asset.type solo l'esempio "CRYPTO".
   Valute: GET /currencies -> { data:[{ id, symbol }] } ....... V [F1] (endpoint) e O [F5] (forma)
   ORO: asset con type commodity e group metal, simbolo XAU ... V [F6] (wallet "Gold Wallet", cryptocoin_symbol "XAU",
                                                                  gruppo commodity>metal) e O [F5]. Nel CSV e' "Asset class = Metal".
   Unita' dell'oro = GRAMMI ................................... A (dedotta da [F6]: 24,7636 unita' per 1000 EUR a 40,38 EUR
                                                                  nel luglio 2019 = prezzo dell'oro al grammo; non dichiarata).
                                                                  Si usa XAU come nel file CSV; l'unita' resta quella di Bitpanda.
   Importo fiat di buy/sell = totale pagato/incassato ......... A. Come nel CSV (Amount Fiat) il valore e' preso cosi' com'e'.
   Commissioni come movimenti "fee" separati ................... A: se presenti (buy/sell), si SOMMANO al costo (acquisto) o si
                                                                  sottraggono dall'incasso (vendita) perche' il saldo del conto
                                                                  scende anche di quelle ([F5] riconcilia i saldi cosi' per gli
                                                                  ordini di borsa). Nei PRELIEVI di cripto la commissione di rete
                                                                  "fee" nello stesso asset e' sommata alla quantita' in uscita
                                                                  (il motore la ricava abbinando l'arrivo). Per cripto e oro questa
                                                                  forma NON e' documentata da nessuna fonte: per questo sync emette
                                                                  sempre un avviso quando la incontra (acquisti, vendite e prelievi).
                                                                  Se l'importo fiat gia' le includesse, il costo sarebbe
                                                                  sovrastimato.
   Storico completo dall'apertura del conto senza "from" ....... A. Si VERIFICA dopo lo scarico con la continuita' dei saldi
                                                                  (asset_balance_after, O [F5]): e' un RILEVATORE di incoerenze,
                                                                  non una prova (non vede operazioni mancanti che si compensano,
                                                                  storia precedente con saldi a zero al confine, portafogli
                                                                  assenti). Senza esito positivo coverage.complete = false.
   Operazione senza credited_at ............................... ('pending' per [F5]): diventa UNRESOLVED; il suo evento porta la
                                                                  data dello scarico (raw.fetchedAt) perche' il motore non accetta
                                                                  date nulle, e la nota dice che la data manca.
   Limiti di frequenza ........................................ non documentati: si rispettano 429/Retry-After (common.js)
   CORS dal browser ........................................... non verificato: un blocco appare come errore 'network'
   Reindirizzamenti e tempo massimo ........................... DIFESA (non osservata): redirect 'error' (la chiave resta nell'intestazione
                                                                  personalizzata, che fetch NON toglie nei redirect verso un'altra
                                                                  origine) e interruzione dopo 30 s per richiesta.

   COSA NON VIENE SCARICATO / CALCOLATO (dichiarato in coverage e limits)
   - Azioni, ETF, ETC, Cash Plus: scaricati ma ignorati dal motore (assetHint "Stock"/"ETF"/"ETC"/"Cash Plus").
   - Earn, staking, interessi, premi, dividendi: non interpretati -> UNRESOLVED.
   - Indici cripto (Bitpanda Crypto Index), token a leva, scambi tra cripto (swap), tipi sconosciuti: UNRESOLVED.
   - Bitpanda Pro / Exchange (One Trading), carta e altri conti: prodotti separati, non inclusi.

   SICUREZZA: la chiave viaggia solo nell'intestazione x-api-key (mai nell'URL), e' passata a common.request come segreto da
   oscurare e non compare in raw, errori, avvisi. Si consiglia una chiave con SOLI i permessi di lettura indicati.
   ====================================================================================================== */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  CT.api = CT.api || {};
  const C = CT.api.common;
  if (!C) throw new Error('Bitpanda: caricare prima api/common.js');
  const { D, Kind, mkEvent, METAL_ALIASES } = CT;
  const I = CT.importers;
  const { ApiError } = C;

  const ID = 'bitpanda';
  const BASE_URL = 'https://api.public.bitpanda.com/v1';
  const PAGE_SIZE = 100;          // O [F5]; per la REST il massimo NON e' documentato (vedi il commento di testa): su HTTP 400 si riprova senza
  const MAX_PAGES = 2000;         // 200.000 operazioni: oltre, la sincronizzazione si ferma invece di girare all'infinito
  const MAX_EMPTY_PAGES = 3;      // pagine vuote consecutive con "ci sono altre pagine": oltre, ci si ferma invece di fare migliaia di richieste
  const MAX_BODY_RETRIES = 4;     // ripetizioni per un errore transitorio scritto nel corpo di una risposta HTTP 200
  const REQUEST_TIMEOUT_MS = 30000;
  const CURSOR_KEYS = ['next_cursor', 'nextCursor', 'cursor', 'end_cursor'];   // campi che indicano come proseguire
  // campi dell'operazione e del movimento che il modulo interpreta (o che sono solo identificativi): gli altri sono elencati in un avviso
  const KNOWN_OP_KEYS = new Set(['operation_id', 'operation_type', 'transactions', 'compensates', 'compensates_info']);
  const KNOWN_TX_KEYS = new Set(['transaction_id', 'transaction_type', 'flow', 'currency_id', 'asset_id', 'index_asset_id', 'asset_amount',
    'credited_at', 'asset_balance_after', 'wallet_id', 'fee_amount', 'compensates', 'compensates_info', 'trade', 'account_id', 'operation_id']);
  const UID_PREFIX = 'api:bitpanda:';
  const METALS = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
  const COV = {
    ops: 'Operazioni (acquisti, vendite, depositi, prelievi)',
    stock: 'Azioni, ETF, ETC e Cash Plus',
    earn: 'Earn, staking, interessi e premi',
    index: 'Indici cripto e token a leva',
    other: 'Bitpanda Pro / Exchange, carta e altri conti',
  };

  // ---------------------------------------------------------------- utilita'
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const nonEmpty = (x) => typeof x === 'string' && x.trim() !== '';
  const low = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');
  const show = (x) => String(x === undefined ? '(assente)' : typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 40);
  const short = (id) => String(id).slice(0, 8);
  const pickKey = (o, a, b) => (o[a] !== undefined ? o[a] : o[b]);
  const accountName = () => (CT.PLATFORMS && CT.PLATFORMS.bitpanda && CT.PLATFORMS.bitpanda.account) || 'Bitpanda';

  /** Il campo contiene qualcosa? (undefined, null, '', false, [] e {} = vuoto). */
  function isSet(v) {
    if (v === undefined || v === null || v === false || v === '') return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (isObj(v)) return Object.keys(v).length > 0;
    return true;
  }

  /** Tutte le stringhe contenute in un valore (profondita' limitata): servono a ritrovare gli identificativi citati da "compensates". */
  function collectStrings(v, out, depth) {
    if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); return out; }
    if ((depth || 0) >= 4) return out;
    if (Array.isArray(v)) for (const x of v) collectStrings(x, out, (depth || 0) + 1);
    else if (isObj(v)) for (const k of Object.keys(v)) collectStrings(v[k], out, (depth || 0) + 1);
    return out;
  }

  /** JSON con chiavi in ordine: serve a confrontare due copie dello stesso record. */
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (isObj(x)) return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
    return JSON.stringify(x);
  }

  /** Importo decimale da { value: "0.5" } (o stringa nuda). Solo stringhe: un numero JS ha gia' perso precisione. */
  function amountOf(m) {
    const v = isObj(m) ? m.value : m;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    return D(s);
  }

  /**
   * Commissione indicata in un campo (fee_amount o trade.fee): 'none' = nessuna commissione (assente, vuota o zero),
   * { amount } = commissione diversa da zero, 'bad' = presente ma non interpretabile (mai ignorata).
   */
  function feeField(v) {
    if (!isSet(v)) return 'none';
    const a = amountOf(v);
    if (a === null || a.isNegative()) return 'bad';
    return a.isZero() ? 'none' : { amount: a };
  }

  /** Campi con significato fiscale ma semantica NON documentata: elenco (testo) di quelli presenti con un valore. */
  function feeFlags(tx) {
    const out = [];
    const note = (name, f) => { if (f === 'bad') out.push(`${name} (valore non leggibile)`); else if (f !== 'none') out.push(`${name} = ${f.amount.toFixed()}`); };
    note('fee_amount', feeField(tx.fee_amount));
    if (isObj(tx.trade)) {
      note('trade.fee', feeField(tx.trade.fee));
      // tariffa con commissione diversa dalla tariffa semplice: c'e' una commissione anche se "fee" manca o e' zero
      if (isSet(tx.trade.rate) && isSet(tx.trade.rate_with_fee)) {
        const r = amountOf(tx.trade.rate), rf = amountOf(tx.trade.rate_with_fee);
        if (r === null || rf === null) out.push('trade.rate / trade.rate_with_fee (valore non leggibile)');
        else if (!r.eq(rf)) out.push(`trade.rate_with_fee (${rf.toFixed()}) diverso da trade.rate (${r.toFixed()})`);
      }
    }
    return out;
  }

  /** Storno o correzione dichiarati da un'operazione (campi compensates / compensates_info sull'operazione o sui movimenti). */
  function compensationOf(op) {
    const holders = [op, ...(Array.isArray(op.transactions) ? op.transactions.filter(isObj) : [])];
    let set = false;
    const refs = [];
    for (const h of holders) {
      for (const k of ['compensates', 'compensates_info']) if (isSet(h[k])) { set = true; collectStrings(h[k], refs, 0); }
    }
    return set ? { refs: [...new Set(refs)] } : null;
  }

  function tsOf(s) {
    if (typeof s !== 'string') return null;
    try { const d = I.parseTs(s); return Number.isNaN(d.getTime()) ? null : d; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- classificazione degli asset
  /** { cls: 'crypto'|'metal'|'other'|'index'|'unknown', label?: nome per l'utente / assetHint dei non calcolati } */
  function classOfAsset(a) {
    const t = low(a.type), g = low(a.group);
    const word = (s, w) => new RegExp('(^|_)' + w + '($|_)').test(s);
    if (g === 'fiat_earn' || g.includes('cash')) return { cls: 'other', label: 'Cash Plus' };
    if (t === 'index' || g === 'index') return { cls: 'index' };
    if (t === 'metal' || g === 'metal') return { cls: 'metal' };
    if (t === 'cryptocoin' || t === 'crypto') return g === '' || g === 'coin' || g === 'token' ? { cls: 'crypto' } : { cls: 'unknown' };
    if (word(g, 'etf') || t === 'etf') return { cls: 'other', label: 'ETF' };
    if (word(g, 'etc') || t === 'etc') return { cls: 'other', label: 'ETC' };
    if (word(g, 'stock') || t === 'stock') return { cls: 'other', label: 'Stock' };
    return { cls: 'unknown' };
  }

  /** Dati utili di un asset: { cls, sym, hint, label } oppure { err }. */
  function assetInfo(env, id) {
    const a = env.assets.get(id);
    if (!a) return { err: `asset sconosciuto (${short(id)}…): non compare tra i dati scaricati da Bitpanda` };
    const c = classOfAsset(a);
    const raw = typeof a.symbol === 'string' ? a.symbol.trim().toUpperCase() : '';
    const where = `${show(a.type)}/${show(a.group)}`;
    if (c.cls === 'metal') {
      const sym = METAL_ALIASES[raw] || raw;
      if (!METALS.has(sym)) return { err: `metallo non riconosciuto (simbolo "${show(a.symbol)}", ${where})` };
      return { cls: 'metal', sym, hint: 'Metal', label: 'metallo prezioso' };
    }
    if (c.cls === 'crypto') {
      if (!raw) return { err: `criptovaluta senza simbolo (${where})` };
      return { cls: 'crypto', sym: raw, hint: 'Cryptocurrency', label: 'criptovaluta' };
    }
    if (c.cls === 'other') {
      const sym = (typeof a.isin === 'string' && a.isin.trim() ? a.isin.trim() : raw).toUpperCase();   // l'ISIN non puo' scontrarsi con un simbolo cripto
      if (!sym) return { err: `strumento senza simbolo né ISIN (${where})` };
      return { cls: 'other', sym, hint: c.label, label: c.label };
    }
    return { cls: c.cls, sym: raw, hint: null, label: `${where}` };
  }

  // ---------------------------------------------------------------- lettura dei movimenti
  /** Un movimento (gamba) di un'operazione, validato. { leg } oppure { why } con il motivo in italiano. */
  function readLeg(tx, index, opId) {
    if (!isObj(tx)) return { why: 'movimento non valido (non è un oggetto)' };
    const txType = low(tx.transaction_type);
    if (!txType) return { why: 'movimento senza tipo (transaction_type)' };
    const flow = typeof tx.flow === 'string' ? tx.flow.trim().toUpperCase() : '';
    if (flow !== 'INCOMING' && flow !== 'OUTGOING') return { why: `direzione non riconosciuta (flow = "${show(tx.flow)}")` };
    const hasCur = nonEmpty(tx.currency_id), hasAsset = nonEmpty(tx.asset_id);
    if (hasCur === hasAsset) return { why: 'il movimento deve riferirsi a una valuta (currency_id) oppure a un asset (asset_id), non a entrambi o a nessuno' };
    const amount = amountOf(tx.asset_amount);
    if (amount === null) return { why: 'importo mancante o non numerico (asset_amount.value deve essere una stringa decimale)' };
    if (amount.isNegative()) return { why: 'importo negativo (la direzione è data da flow)' };
    if (isObj(tx.asset_amount)) {
      const a = tx.asset_amount;
      if ((hasCur && nonEmpty(a.currency_id) && a.currency_id !== tx.currency_id) || (hasAsset && nonEmpty(a.asset_id) && a.asset_id !== tx.asset_id)) {
        return { why: "la valuta o l'asset dell'importo non coincidono con quelli del movimento" };
      }
    }
    const after = tx.asset_balance_after === undefined ? null : amountOf(tx.asset_balance_after);
    return {
      leg: {
        id: nonEmpty(tx.transaction_id) ? tx.transaction_id : `${opId}:${index}`,
        txType, flow, fiat: hasCur, refId: hasCur ? tx.currency_id : tx.asset_id,
        indexId: nonEmpty(tx.index_asset_id) ? tx.index_asset_id : '',
        amount, after, ts: tsOf(tx.credited_at), wallet: nonEmpty(tx.wallet_id) ? tx.wallet_id : '',
        feeFlags: feeFlags(tx),
        sym: '', asset: null,
      },
    };
  }

  const EARN_TYPES = /^(reward|interest|dividend|staking)/;
  const isEarnLike = (opType, legs) => /staking|earn|reward|interest|dividend/.test(opType) || legs.some((l) => EARN_TYPES.test(l.txType));

  // ---------------------------------------------------------------- operazione -> eventi
  /** Converte UNA operazione in eventi. Tutto cio' che non e' un caso noto e certo diventa UNRESOLVED. */
  function convertOperation(op, env) {
    const opId = op.operation_id;
    const opType = low(op.operation_type);
    const uid = UID_PREFIX + opId;
    const parsed = op.transactions.map((tx, i) => readLeg(tx, i, opId));
    const bad = parsed.find((p) => p.why);
    const legs = parsed.filter((p) => p.leg).map((p) => p.leg);
    const stamps = legs.map((l) => l.ts).filter(Boolean).sort((a, b) => a - b);
    // base.ts e' la data REALE dell'operazione (null se nessun movimento ha credited_at): serve alla logica ("senza data" = non riconosciuta).
    // Gli eventi UNRESOLVED/INFO non hanno mai ts nullo (il motore e il PDF non lo accettano): senza data portano quella dello scarico.
    const base = { account: env.account, ts: stamps.length ? stamps[0] : null, ref: opId, src: `${env.src}:${opId}`, raw: op };
    const evTs = base.ts || env.fallbackTs;
    const noDate = base.ts ? '' : ' (Bitpanda non indica la data di questa operazione: come data è usata quella dello scarico)';
    if (!base.ts) env.undated.add(uid);
    const U = (key, note) => { env.stats.unresolved++; return [I.unresolved({ ...base, uid, ts: evTs }, `Bitpanda API · ${key}`, `Operazione ${opId} (${opType || 'tipo mancante'}): ${note}${noDate}`)]; };
    const INFO = (note) => [mkEvent({ ...base, uid, ts: evTs, kind: Kind.INFO, note: note + noDate })];
    const typeKey = `tipo "${opType}"`;

    // storni e correzioni (campo "compensates"): sia lo storno sia l'operazione stornata, mai contati come operazioni normali
    const comp = env.comp.get(opId), stornedBy = env.compensatedBy.get(opId);
    if (comp || stornedBy) {
      env.stats.compensated++;
      const parts = [];
      if (comp) parts.push(`è uno storno o una correzione: contiene il campo "compensates" (${comp.refs.length ? 'fa riferimento a ' + comp.refs.map(short).join(', ') + '…' : 'senza riferimenti leggibili'})`);
      if (stornedBy) parts.push(`è stata stornata o corretta dall'operazione ${stornedBy.map(short).join(', ')}…`);
      return U('storno o correzione (compensates)', `${parts.join(' ed ')}. Non indovino l'effetto: decidi come trattare questa operazione insieme alla sua correzione.`);
    }

    if (!opType) return U('operazione senza tipo', 'manca operation_type.');
    if (bad) return U('movimento in formato inatteso', `${bad.why}.`);
    if (!legs.length) return U(`${typeKey} senza movimenti`, 'non contiene nessun movimento.');
    if (/_reserve$/.test(opType)) return INFO('Prenotazione di fondi per un ordine: nessun effetto fiscale (l\'esecuzione è un\'altra operazione).');

    const voided = legs.filter((l) => l.after && l.after.isNegative());
    if (voided.length === legs.length && (opType === 'deposit' || opType === 'withdrawal')) {
      env.stats.voided++;
      return INFO('Operazione annullata (saldo dopo l\'operazione negativo): nessun effetto.');
    }
    if (voided.length) return U(`${typeKey} con saldo negativo`, 'ha movimenti con saldo finale negativo che non so interpretare.');

    // risolve valute e asset
    if (legs.some((l) => l.indexId)) { env.stats.index++; return U('indice cripto (Bitpanda Crypto Index)', 'riguarda un indice cripto: serve una decisione, non viene calcolato in automatico.'); }
    for (const l of legs) {
      if (l.fiat) {
        const sym = env.currencies.get(l.refId);
        if (!sym) return U('valuta sconosciuta', `valuta non presente nell'elenco di Bitpanda (${short(l.refId)}…).`);
        l.sym = sym;
      } else {
        const info = assetInfo(env, l.refId);
        if (info.err) return U('asset sconosciuto o non gestito', `${info.err}.`);
        l.asset = info; l.sym = info.sym;
      }
    }
    const assetLegs = legs.filter((l) => !l.fiat);
    if (assetLegs.some((l) => l.asset.cls === 'index')) { env.stats.index++; return U('indice cripto (Bitpanda Crypto Index)', 'riguarda un indice cripto: serve una decisione, non viene calcolato in automatico.'); }
    const unknown = assetLegs.find((l) => l.asset.cls === 'unknown');
    if (unknown) { env.stats.index++; return U(`asset di tipo non gestito (${unknown.asset.label})`, `lo strumento ${unknown.sym || short(unknown.refId)} è di un tipo che non so trattare (${unknown.asset.label}).`); }
    const computed = assetLegs.filter((l) => l.asset.cls === 'crypto' || l.asset.cls === 'metal');
    const others = assetLegs.filter((l) => l.asset.cls === 'other');
    if (computed.length && others.length) return U(`${typeKey} con strumenti di tipo diverso`, 'mescola criptovalute/metalli con azioni o ETF.');

    // azioni, ETF, ETC, Cash Plus: non calcolati dall'app (il motore li ignora con un avviso)
    if (others.length) {
      env.stats.stock++;
      const trades = others.filter((l) => l.txType === 'buy' || l.txType === 'sell');
      if (trades.length === 1 && (trades[0].ts || base.ts) && trades[0].flow === (trades[0].txType === 'buy' ? 'INCOMING' : 'OUTGOING')) {
        const t = trades[0];
        const fiat = legs.filter((l) => l.fiat && l.txType === t.txType);
        return [mkEvent({ ...base, uid, ts: t.ts || base.ts, kind: t.txType === 'buy' ? Kind.BUY : Kind.SELL, asset: t.sym, qty: t.amount, assetHint: t.asset.hint,
          value: fiat.length === 1 ? fiat[0].amount : null, valueCcy: fiat.length === 1 ? fiat[0].sym : 'EUR', note: `${t.asset.label}: non calcolato dall'app` })];
      }
      return INFO(`Operazione su ${others[0].asset.label} (${opType}): non calcolata dall'app.`);
    }

    if (isEarnLike(opType, legs)) {
      env.stats.earn++;
      return U('premio, interesse o staking', 'è un premio, un interesse, un dividendo o un movimento di staking/Earn: serve una decisione sul trattamento fiscale.');
    }

    // solo movimenti in valuta: depositi e prelievi in euro (o altra valuta)
    if (!assetLegs.length) {
      if (opType !== 'deposit' && opType !== 'withdrawal') return U(typeKey, 'tipo di operazione in valuta non riconosciuto.');
      const mains = legs.filter((l) => l.txType === opType);
      const extra = legs.filter((l) => l.txType !== opType && l.txType !== 'fee');
      if (extra.length || !mains.length) return U(`${typeKey} con movimenti inattesi`, `contiene movimenti di tipo "${(extra[0] || {}).txType || '-'}" che non so interpretare.`);
      if (mains.some((l) => l.flow !== (opType === 'deposit' ? 'INCOMING' : 'OUTGOING'))) return U(`${typeKey} con direzione inattesa`, 'la direzione dei movimenti non corrisponde al tipo di operazione.');
      if (legs.some((l) => l.txType === 'fee' && l.flow !== 'OUTGOING')) return U(`${typeKey} con commissione inattesa`, 'una commissione ha direzione in entrata.');
      if (mains.some((l) => !(l.ts || base.ts))) return U(`${typeKey} senza data`, 'manca la data (credited_at).');
      return mains.map((l) => mkEvent({ ...base, uid: mains.length === 1 ? uid : `${uid}#${l.id}`, ts: l.ts || base.ts, ref: l.id, kind: opType === 'deposit' ? Kind.FIAT_IN : Kind.FIAT_OUT, asset: l.sym, qty: l.amount }));
    }

    // da qui: criptovalute e metalli
    if (opType === 'buy' || opType === 'sell' || opType === 'savings_plan') return convertTrade(opType, legs, base, uid, env, U);
    if (opType === 'deposit' || opType === 'withdrawal') return convertTransfer(opType, legs, base, uid, env, U);
    return U(typeKey, 'tipo di operazione non riconosciuto.');
  }

  /**
   * Se un movimento riporta una commissione nei campi fee_amount / trade.fee / rate_with_fee: motivo (testo) per bloccare l'operazione.
   * Bitpanda NON documenta se questa commissione e' gia' compresa nell'importo o si aggiunge: sbagliare significa sbagliare costo,
   * incasso o quantita' trasferita. Nessuna ipotesi: serve una decisione.
   */
  function feeFlagged(legs) {
    const list = [];
    for (const l of legs) for (const f of l.feeFlags) list.push(f);
    if (!list.length) return null;
    return `Bitpanda indica una commissione in un campo dell'operazione (${[...new Set(list)].join('; ')}) ma non documenta se è già compresa nell'importo o se si aggiunge. Non la indovino: servono costo, incasso o quantità esatti dall'estratto.`;
  }

  /** Acquisto/vendita di cripto o metalli: un movimento in valuta + uno in asset (+ commissioni 'fee'). */
  function convertTrade(opType, legs, base, uid, env, U) {
    const typeKey = `tipo "${opType}"`;
    const flagged = feeFlagged(legs);
    if (flagged) { env.stats.feeFields++; return U(`${typeKey} con commissione in un campo`, flagged); }
    const want = opType === 'sell' ? 'sell' : 'buy';          // il piano di accumulo ("savings_plan") compra soltanto
    const fiatMain = legs.filter((l) => l.fiat && l.txType === want);
    const assetMain = legs.filter((l) => !l.fiat && l.txType === want);
    const fees = legs.filter((l) => l.txType === 'fee');
    const other = legs.find((l) => l.txType !== want && l.txType !== 'fee');
    if (other) return U(`${typeKey} con movimenti "${other.txType}"`, `contiene un movimento "${other.txType}" che non so interpretare (imposte, trasferimenti interni…).`);
    if (fiatMain.length !== 1 || assetMain.length !== 1) return U(`${typeKey} con struttura diversa dall'atteso`, `mi aspettavo un movimento in valuta e uno in asset, ne ho trovati ${fiatMain.length} e ${assetMain.length} (scambio tra cripto?).`);
    const f = fiatMain[0], a = assetMain[0];
    if (a.flow !== (want === 'buy' ? 'INCOMING' : 'OUTGOING') || f.flow === a.flow) return U(`${typeKey} con direzione inattesa`, 'la direzione dei movimenti non corrisponde a un acquisto/vendita.');
    if (a.amount.isZero() || f.amount.isZero()) return U(`${typeKey} con importo zero`, 'la quantità o l\'importo in valuta è zero.');
    const ts = a.ts || f.ts;
    if (!ts) return U(`${typeKey} senza data`, 'manca la data (credited_at).');
    const feeP = {};
    if (fees.length) {
      if (fees.some((x) => x.flow !== 'OUTGOING')) return U(`${typeKey} con commissione inattesa`, 'una commissione ha direzione in entrata.');
      if (new Set(fees.map((x) => `${x.fiat ? 'c' : 'a'}:${x.refId}`)).size > 1) return U(`${typeKey} con commissioni in più valute`, 'le commissioni sono in più valute/asset diversi.');
      feeP.feeAsset = fees[0].sym;
      feeP.feeQty = fees.reduce((s, x) => s.plus(x.amount), D(0));
      env.stats.fees++;
    }
    if (a.asset.cls === 'metal') env.stats.metals++;
    return [mkEvent({ ...base, ...feeP, uid, ts, ref: a.id, kind: want === 'buy' ? Kind.BUY : Kind.SELL, asset: a.sym, qty: a.amount, assetHint: a.asset.hint, value: f.amount, valueCcy: f.sym,
      note: fees.length ? 'Commissione separata: sommata al costo / sottratta dall\'incasso' : '' })];
  }

  /** Depositi e prelievi di criptovalute (e di valuta) -> trasferimenti. Il prelievo include la commissione di rete. */
  function convertTransfer(opType, legs, base, uid, env, U) {
    const typeKey = `tipo "${opType}"`;
    const flagged = feeFlagged(legs);
    if (flagged) { env.stats.feeFields++; return U(`${typeKey} con commissione in un campo`, flagged); }
    const mains = legs.filter((l) => l.txType === opType);
    const fees = legs.filter((l) => l.txType === 'fee');
    const extra = legs.find((l) => l.txType !== opType && l.txType !== 'fee');
    if (extra) return U(`${typeKey} con movimenti "${extra.txType}"`, `contiene un movimento "${extra.txType}" che non so interpretare.`);
    if (!mains.length) return U(`${typeKey} senza movimento principale`, 'non contiene il movimento di deposito/prelievo.');
    const dir = opType === 'deposit' ? 'INCOMING' : 'OUTGOING';
    if (mains.some((l) => l.flow !== dir)) return U(`${typeKey} con direzione inattesa`, 'la direzione dei movimenti non corrisponde al tipo di operazione.');
    if (mains.some((l) => !l.fiat && l.asset.cls === 'metal')) return U(`${typeKey} di metalli`, 'deposito/prelievo di metalli preziosi: serve una decisione (non è né un acquisto né una vendita).');
    if (fees.length) {
      const assetMains = mains.filter((l) => !l.fiat);
      if (opType !== 'withdrawal' || assetMains.length !== 1 || fees.some((x) => x.fiat || x.refId !== assetMains[0].refId || x.flow !== 'OUTGOING')) {
        return U(`${typeKey} con commissioni`, 'ha commissioni in una forma che non so interpretare (solo la commissione di rete nello stesso asset di un prelievo è gestita).');
      }
    }
    const events = [];
    for (const l of mains) {
      const evUid = mains.length === 1 ? uid : `${uid}#${l.id}`;
      const ts = l.ts || base.ts;
      if (!ts) return U(`${typeKey} senza data`, 'manca la data (credited_at).');
      if (l.fiat) { events.push(mkEvent({ ...base, uid: evUid, ts, ref: l.id, kind: opType === 'deposit' ? Kind.FIAT_IN : Kind.FIAT_OUT, asset: l.sym, qty: l.amount })); continue; }
      if (opType === 'deposit') events.push(mkEvent({ ...base, uid: evUid, ts, ref: l.id, kind: Kind.TRANSFER_IN, asset: l.sym, assetHint: l.asset.hint, qty: l.amount }));
      else {
        const total = fees.reduce((s, x) => s.plus(x.amount), l.amount);   // quantita' totale addebitata = prelievo + commissione di rete
        if (fees.length) env.stats.transferFees++;
        events.push(mkEvent({ ...base, uid: evUid, ts, ref: l.id, kind: Kind.TRANSFER_OUT, asset: l.sym, assetHint: l.asset.hint, qty: total, note: fees.length ? 'La quantità include la commissione di rete' : '' }));
      }
    }
    return events;
  }

  // ---------------------------------------------------------------- raw -> eventi (puro, nessuna rete)
  function validRaw(raw) {
    return isObj(raw) && raw.version === 1 && Array.isArray(raw.operations) && Array.isArray(raw.currencies) && Array.isArray(raw.assets);
  }

  function mapsOf(raw) {
    const currencies = new Map(), assets = new Map();
    for (const c of raw.currencies) if (isObj(c) && nonEmpty(c.id) && nonEmpty(c.symbol)) currencies.set(c.id, c.symbol.trim().toUpperCase());
    for (const a of raw.assets) if (isObj(a) && nonEmpty(a.id)) assets.set(a.id, a);
    return { currencies, assets };
  }

  /** Data da usare per gli eventi senza data: quella dello scarico (raw.fetchedAt); se manca, l'ultima data nota; ultima risorsa: 1/1/1970. Mai l'orologio. */
  function fallbackInstant(raw) {
    const f = tsOf(raw.fetchedAt);
    if (f) return f;
    let best = null;
    for (const op of raw.operations) {
      if (!isObj(op) || !Array.isArray(op.transactions)) continue;
      for (const tx of op.transactions) {
        const d = isObj(tx) ? tsOf(tx.credited_at) : null;
        if (d && (!best || d > best)) best = d;
      }
    }
    return best || new Date(0);
  }

  function analyze(raw, fileName) {
    if (!validRaw(raw)) throw new ApiError('format', 'I dati Bitpanda salvati non hanno il formato atteso (versione 1): rifai la sincronizzazione.');
    const { currencies, assets } = mapsOf(raw);
    const stats = { ops: 0, unresolved: 0, voided: 0, stock: 0, earn: 0, index: 0, fees: 0, metals: 0, compensated: 0, feeFields: 0, transferFees: 0 };
    const fallbackTs = fallbackInstant(raw);
    const env = { account: accountName(), src: fileName || 'API Bitpanda', currencies, assets, stats, fallbackTs, undated: new Set(), comp: new Map(), compensatedBy: new Map() };
    const events = [];
    const seen = new Map();
    const valid = [];
    // 1) validazione e deduplica (finestre sovrapposte: la stessa operazione conta una volta)
    raw.operations.forEach((op, i) => {
      if (!isObj(op) || !nonEmpty(op.operation_id) || !Array.isArray(op.transactions)) {
        stats.unresolved++;
        const uid = `${UID_PREFIX}?#${i}`;
        env.undated.add(uid);
        events.push(I.unresolved({ uid, ts: fallbackTs, account: env.account, src: `${env.src}:#${i}`, raw: op === undefined ? null : op }, 'Bitpanda API · operazione in formato inatteso',
          `L'operazione n. ${i + 1} non ha operation_id o transactions nella forma attesa (senza data: usata quella dello scarico).`));
        return;
      }
      const sig = stable(op);
      if (seen.has(op.operation_id)) {
        if (seen.get(op.operation_id) !== sig) {
          stats.unresolved++;
          const uid = `${UID_PREFIX}${op.operation_id}#conflitto${i}`;
          env.undated.add(uid);
          events.push(I.unresolved({ uid, ts: fallbackTs, account: env.account, src: `${env.src}:${op.operation_id}`, raw: op }, 'Bitpanda API · operazione duplicata con contenuto diverso',
            `L'operazione ${op.operation_id} compare due volte con contenuto diverso: scarica di nuovo i dati (senza data: usata quella dello scarico).`));
        }
        return;                                                     // stessa operazione letta due volte (finestre sovrapposte): conta una volta
      }
      seen.set(op.operation_id, sig);
      valid.push(op);
    });
    // 2) storni e correzioni ("compensates"): si segnano lo storno e l'operazione che contiene la transazione stornata
    const idToOp = new Map();
    for (const op of valid) {
      idToOp.set(op.operation_id, op.operation_id);
      for (const tx of op.transactions) if (isObj(tx) && nonEmpty(tx.transaction_id) && !idToOp.has(tx.transaction_id)) idToOp.set(tx.transaction_id, op.operation_id);
    }
    for (const op of valid) {
      const c = compensationOf(op);
      if (!c) continue;
      env.comp.set(op.operation_id, c);
      for (const ref of c.refs) {
        const target = idToOp.get(ref);
        if (target === undefined) continue;
        if (!env.compensatedBy.has(target)) env.compensatedBy.set(target, []);
        if (!env.compensatedBy.get(target).includes(op.operation_id)) env.compensatedBy.get(target).push(op.operation_id);
      }
    }
    // 3) conversione
    for (const op of valid) {
      stats.ops++;
      events.push(...convertOperation(op, env));
    }
    // ordine cronologico, a parità di istante per uid: il risultato non dipende dall'ordine delle pagine (l'API parte dalle più recenti)
    events.sort((a, b) => (a.ts - b.ts) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    return { events, stats, env };
  }

  function parse(raw, fileName) {
    const { events, stats } = analyze(raw, fileName);
    return I.finish('Bitpanda · dati da API', stats.ops, events);
  }

  // ---------------------------------------------------------------- controllo di continuita' dei saldi
  /**
   * Per ogni portafoglio (wallet_id) confronta le operazioni scaricate con i saldi riportati da Bitpanda (asset_balance_after):
   *  - coerenza: saldo finale - saldo iniziale = somma dei movimenti (manca qualcosa in mezzo/in fondo se no);
   *  - inizio: il primo movimento deve partire da saldo zero (se no, manca lo storico precedente).
   * Per non dare falsi allarmi con movimenti nello stesso istante si accetta qualsiasi candidato tra quelli a pari data.
   * Ritorna { verified, unverifiable, problems[] }.
   */
  function checkContinuity(ops, env) {
    const wallets = new Map();
    for (const op of ops) {
      op.transactions.forEach((tx, i) => {
        const w = isObj(tx) && nonEmpty(tx.wallet_id) ? tx.wallet_id : '';
        const key = w || `senza-portafoglio:${op.operation_id}:${i}`;
        if (!wallets.has(key)) wallets.set(key, { legs: [], bad: !w, label: '' });
        const W = wallets.get(key);
        const r = readLeg(tx, i, op.operation_id);
        if (!r.leg || !r.leg.after || !r.leg.ts) { W.bad = true; return; }
        const l = r.leg;
        if (!W.label) W.label = l.fiat ? (env.currencies.get(l.refId) || '') : ((env.assets.get(l.refId) || {}).symbol || '');
        if (l.after.isNegative()) return;                           // movimento annullato: non ha toccato il saldo
        W.legs.push({ signed: l.flow === 'INCOMING' ? l.amount : l.amount.neg(), after: l.after, t: l.ts.getTime() });
      });
    }
    const out = { verified: 0, unverifiable: 0, problems: [] };
    for (const [key, W] of wallets) {
      if (W.bad || !W.legs.length) { if (W.bad) out.unverifiable++; continue; }
      const name = `${W.label || 'portafoglio'} (${short(key)}…)`;
      const total = W.legs.reduce((s, l) => s.plus(l.signed), D(0));
      const tMin = Math.min(...W.legs.map((l) => l.t)), tMax = Math.max(...W.legs.map((l) => l.t));
      const starts = W.legs.filter((l) => l.t === tMin).map((l) => l.after.minus(l.signed));
      const ends = W.legs.filter((l) => l.t === tMax).map((l) => l.after);
      const consistent = starts.some((b) => ends.some((e) => e.minus(b).eq(total)));
      out.verified++;
      if (!consistent) out.problems.push(`${name}: i movimenti scaricati non sono coerenti con i saldi indicati da Bitpanda (mancano operazioni).`);
      else if (!starts.some((b) => b.isZero())) out.problems.push(`${name}: il primo movimento parte da un saldo di ${starts[0].toFixed()} invece che da zero (manca lo storico precedente).`);
    }
    return out;
  }

  // ---------------------------------------------------------------- rete
  const qs = (o) => {
    const parts = Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null).map((k) => `${k}=${encodeURIComponent(String(o[k]))}`);
    return parts.length ? '?' + parts.join('&') : '';
  };

  const AUTH_MSG = 'Bitpanda ha rifiutato la chiave: controlla che sia copiata per intero e attiva, e che abbia i permessi di sola lettura «Transaction» e «Trade (Read)» (il permesso «Balances» non serve).';

  /**
   * Errore scritto nel CORPO di una risposta (anche con HTTP 200): { errors:[{status,code,title}] } oppure { error:{code,status} }.
   * Ritorna null se il corpo non e' un errore, altrimenti { kind: 'auth'|'transient'|'other', status, code }.
   * Non si copiano mai testi del server (potrebbero ripetere la chiave): solo stato e codice, ripuliti dalla chiave.
   */
  function bodyError(body, key) {
    if (!isObj(body)) return null;
    let e;
    if (Array.isArray(body.errors) && body.errors.length) e = body.errors[0];
    else if (isSet(body.error)) e = body.error;
    else return null;
    const rawStatus = isObj(e) && e.status !== undefined ? e.status : body.status;
    const n = Number(rawStatus);
    const status = Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
    const codeRaw = isObj(e) ? (typeof e.code === 'string' ? e.code : '') : (typeof e === 'string' ? e : '');
    const code = C.redact(codeRaw, [key]).slice(0, 60);
    const lc = code.toLowerCase();
    let kind = 'other';
    if (status === 401 || status === 403 || ['unauthorized', 'unauthenticated', 'invalid_api_key', 'invalid_token', 'forbidden'].includes(lc)) kind = 'auth';
    else if (status === 429 || (status !== null && status >= 500) || /rate.?limit|too.?many/.test(lc)) kind = 'transient';
    return { kind, status, code };
  }

  /** Il campo ha un valore (non assente, non null, non vuoto). */
  const hasValue = (v) => v !== undefined && v !== null && v !== '';

  /**
   * Legge TUTTE le pagine di un elenco a cursore. Si ferma con un errore (mai dati parziali) se la paginazione non si puo' esaurire.
   * o = { idOf(item) -> id (lancia 'format' se l'elemento non e' valido), pageSize (null = non inviarlo), progress(n, pagina) }
   * Ritorna { items, endConfirmed, fellBack }: endConfirmed e' true SOLO se Bitpanda ha detto has_next_page === false;
   * fellBack e' true se la prima richiesta e' stata rifiutata (HTTP 400) e si e' ripartiti senza page_size.
   */
  async function getAll(get, path, params, o) {
    const items = [], seen = new Map();
    let pageSize = o.pageSize, fellBack = false, endConfirmed = false;
    let cursor = null, pages = 0, emptyRun = 0;
    for (;;) {
      if (++pages > MAX_PAGES) throw new ApiError('incomplete', `Troppe pagine da leggere (oltre ${MAX_PAGES}): sincronizzazione interrotta per evitare dati parziali.`);
      const p = { ...params };
      if (pageSize) p.page_size = pageSize;
      if (cursor !== null) p.cursor = cursor;
      let body;
      try { body = await get(path, p); }
      catch (e) {
        const first400 = e instanceof ApiError && e.code === 'http' && e.detail && e.detail.status === 400 && cursor === null && pages === 1;
        if (first400 && pageSize) { pageSize = null; fellBack = true; pages = 0; continue; }       // la dimensione di pagina potrebbe non essere accettata: una sola ripetizione
        if (first400 && fellBack) throw new ApiError('http', 'Bitpanda ha rifiutato la richiesta delle operazioni (errore 400) anche senza la dimensione di pagina: non posso scaricare lo storico. Usa il file CSV dello storico completo.', e.detail);
        throw e;
      }
      if (!isObj(body) || !Array.isArray(body.data)) throw new ApiError('format', 'La risposta di Bitpanda non ha la forma attesa (manca l\'elenco "data").', { path });
      let fresh = 0;
      for (const it of body.data) {
        const id = o.idOf(it);
        if (seen.has(id)) {
          if (stable(seen.get(id)) !== stable(it)) throw new ApiError('incomplete', `I dati sono cambiati durante lo scarico (l'elemento ${short(id)}… è stato letto due volte con contenuto diverso): ripeti la sincronizzazione.`, { path });
          continue;                                                 // stesso elemento in due pagine: si conta una volta
        }
        seen.set(id, it); items.push(it); fresh++;
      }
      if (body.data.length > 0 && fresh === 0) throw new ApiError('incomplete', 'La paginazione di Bitpanda è ripartita dall\'inizio (cursore non accettato): lo storico non può essere letto per intero.', { path });
      const hasNext = pickKey(body, 'has_next_page', 'hasNextPage');
      const next = pickKey(body, 'next_cursor', 'nextCursor');
      if (hasNext === undefined) {
        // Senza "ci sono altre pagine" un cursore presente vuol dire che CE NE SONO (forma { data, cursor } dell'OpenAPI ufficiale): mai accettare una pagina corta come ultima.
        const stray = CURSOR_KEYS.find((k) => hasValue(body[k]));
        if (stray) throw new ApiError('incomplete', `Bitpanda indica come proseguire (campo «${stray}») ma non dice se ci sono altre pagine: lo storico potrebbe essere incompleto.`, { path });
        if (pageSize && body.data.length >= pageSize) throw new ApiError('format', 'La risposta di Bitpanda non dice se ci sono altre pagine: non posso sapere se lo storico è completo.', { path });
        break;                                                      // fine NON confermata da Bitpanda (endConfirmed resta false)
      }
      if (typeof hasNext !== 'boolean') throw new ApiError('format', 'La risposta di Bitpanda ha un indicatore di pagina successiva non valido.', { path });
      if (!hasNext) { endConfirmed = true; break; }                 // NB: l'ultima pagina puo' avere ancora un next_cursor: si ignora
      if (typeof next !== 'string' || next === '') throw new ApiError('incomplete', 'Bitpanda annuncia altre pagine ma non indica come leggerle (pagina troncata): lo storico è incompleto.', { path });
      if (next === cursor) throw new ApiError('incomplete', 'Il cursore di Bitpanda non avanza: lo storico non può essere letto per intero.', { path });
      if (body.data.length === 0) {
        if (++emptyRun >= MAX_EMPTY_PAGES) throw new ApiError('incomplete', `Bitpanda continua a restituire pagine vuote annunciando altre pagine (${MAX_EMPTY_PAGES} di fila): lo storico non può essere letto per intero.`, { path });
      } else emptyRun = 0;
      cursor = next;
      if (o.progress) o.progress(items.length, pages);
    }
    return { items, endConfirmed, fellBack };
  }

  /** Nomi (mai valori) dei campi di operazioni e movimenti che il modulo non interpreta: potrebbero avere un significato fiscale. */
  function unknownKeys(operations) {
    const names = new Set();
    for (const op of operations) {
      if (!isObj(op)) continue;
      for (const k of Object.keys(op)) if (!KNOWN_OP_KEYS.has(k)) names.add(k);
      for (const tx of Array.isArray(op.transactions) ? op.transactions : []) {
        if (isObj(tx)) for (const k of Object.keys(tx)) if (!KNOWN_TX_KEYS.has(k)) names.add(k);
      }
    }
    return [...names].sort();
  }

  async function sync(creds, opts) {
    opts = opts || {};
    const key = creds && typeof creds.apiKey === 'string' ? creds.apiKey.trim() : '';
    if (!key) throw new ApiError('config', 'Inserisci la chiave API di Bitpanda.');
    if (!/^[\x21-\x7e]+$/.test(key)) throw new ApiError('config', 'La chiave API contiene spazi o caratteri non validi: copiala di nuovo per intero.');
    const fetchImpl = opts.fetch || ((u, i) => globalThis.fetch(u, i));
    const now = opts.now || (() => new Date());
    const progress = opts.onProgress || (() => {});
    const sleepFn = opts.sleep || C.sleep;
    const ropts = { sleep: sleepFn, secrets: [key] };
    // redirect 'error': un reindirizzamento inatteso non deve portare la chiave (intestazione personalizzata) su un'altra origine; il tempo massimo
    // vale per ogni singola richiesta (un segnale nuovo per ogni tentativo, perche' un segnale scaduto resta scaduto)
    const init = { method: 'GET', headers: { 'x-api-key': key, Accept: 'application/json' }, redirect: 'error' };
    const timeoutSignal = () => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined);
    const guardedFetch = (u, i) => { const sig = timeoutSignal(); return fetchImpl(u, sig ? { ...i, signal: sig } : i); };

    const get = async (path, params) => {
      const url = BASE_URL + path + qs(params || {});
      for (let attempt = 0; ; attempt++) {
        let body;
        try { body = await C.request(guardedFetch, url, init, ropts); }
        catch (e) { if (e instanceof ApiError && e.code === 'auth') throw new ApiError('auth', AUTH_MSG, e.detail); throw e; }
        const err = bodyError(body, key);
        if (!err) return body;
        const detail = { status: err.status, code: err.code, path };
        if (err.kind === 'auth') throw new ApiError('auth', AUTH_MSG, detail);
        if (err.kind === 'transient') {
          if (attempt < MAX_BODY_RETRIES) { await sleepFn(Math.min(30000, 1000 * 2 ** (attempt + 1))); continue; }
          throw err.status !== null && err.status >= 500
            ? new ApiError('http', `Bitpanda risponde con un errore (${err.status}).`, detail)
            : new ApiError('rate', 'Troppe richieste: Bitpanda ha limitato l\'accesso. Riprova tra qualche minuto.', detail);
        }
        throw new ApiError('http', `Bitpanda ha risposto con un errore${err.status !== null ? ` (${err.status})` : ''}${err.code ? ` «${err.code}»` : ''}.`, detail);
      }
    };
    const idField = (what) => (it) => {
      if (!isObj(it) || !nonEmpty(it.id)) throw new ApiError('format', `Un elemento di "${what}" non ha l'identificativo atteso.`, { what });
      return it.id;
    };

    // 1) operazioni: tutte le pagine, senza finestre di date (nessun filtro "from")
    progress('Bitpanda: scarico le operazioni…');
    const opsRes = await getAll(get, '/operations', {}, {
      pageSize: PAGE_SIZE,
      idOf: (op) => {
        if (!isObj(op) || !nonEmpty(op.operation_id) || !Array.isArray(op.transactions)) throw new ApiError('format', 'Una operazione di Bitpanda non ha la forma attesa (operation_id e transactions).', { what: 'operations' });
        return op.operation_id;
      },
      progress: (n, page) => progress(`Bitpanda: scarico le operazioni (pagina ${page + 1}, ${n} finora)…`),
    });
    const operations = opsRes.items;

    // 2) valute
    progress('Bitpanda: scarico l\'elenco delle valute…');
    const currencies = (await getAll(get, '/currencies', {}, { pageSize: null, idOf: idField('currencies') })).items;

    // 3) asset citati nelle operazioni (uno per richiesta: e' il caso documentato del filtro "id")
    const ids = [];
    const idSeen = new Set();
    for (const op of operations) {
      for (const tx of op.transactions) {
        if (!isObj(tx)) continue;
        for (const id of [tx.asset_id, tx.index_asset_id]) if (nonEmpty(id) && !idSeen.has(id)) { idSeen.add(id); ids.push(id); }
      }
    }
    const assets = [];
    const missing = [];
    for (let i = 0; i < ids.length; i++) {
      progress(`Bitpanda: leggo i dati degli asset (${i + 1} di ${ids.length})…`);
      // elenco vuoto = asset non in catalogo (comportamento OSSERVATO da terzi [F5], non documentato): le sue operazioni diventano "non riconosciute"; qualunque errore di rete/HTTP ferma tutto
      const list = (await getAll(get, '/assets', { id: ids[i] }, { pageSize: null, idOf: idField('assets') })).items;
      const found = list.find((a) => a.id.toLowerCase() === ids[i].toLowerCase());
      if (found) assets.push(found); else missing.push(ids[i]);
    }

    const raw = { version: 1, fetchedAt: now().toISOString(), currencies, operations, assets };

    // 4) analisi: conteggi per la copertura e controllo di continuita' dello storico
    progress('Bitpanda: controllo la completezza dello storico…');
    const A = analyze(raw, 'API Bitpanda');
    const stats = A.stats;
    // intervallo delle date REALI: gli eventi senza data (che portano quella dello scarico) non lo allargano
    let from = null, to = null;
    for (const e of A.events) {
      if (!e.ts || A.env.undated.has(e.uid)) continue;
      if (!from || e.ts < from) from = e.ts;
      if (!to || e.ts > to) to = e.ts;
    }
    const cont = checkContinuity(operations, A.env);
    const warnings = [];

    const complete = opsRes.endConfirmed && cont.problems.length === 0 && cont.unverifiable === 0 && cont.verified > 0;
    let opsNote;
    if (!operations.length) opsNote = 'Bitpanda non ha restituito nessuna operazione: controlla che la chiave abbia il permesso «Transaction». Se il conto è vuoto, usa il file.';
    else if (!opsRes.endConfirmed) opsNote = `Bitpanda non ha confermato la fine dell'elenco (manca l'indicatore «has_next_page»): ${stats.ops} operazioni lette, ma non posso garantire che siano tutte. Integra con il file CSV dello storico completo.`;
    else if (complete) opsNote = `Lette tutte le pagine (${stats.ops} operazioni, fine confermata da Bitpanda). Controllo di coerenza dei saldi: nessuna incoerenza rilevata su ${cont.verified} portafogli (lo storico parte da saldo zero e i saldi tornano). È un controllo di coerenza, non una garanzia: non può escludere ogni buco (per esempio operazioni mancanti che si compensano).`;
    else if (cont.problems.length) opsNote = `Letture complete ma lo storico non risulta completo: ${cont.problems[0]}${cont.problems.length > 1 ? ` (e altri ${cont.problems.length - 1} portafogli)` : ''} Integra con il file CSV dello storico completo.`;
    else opsNote = `Lette tutte le pagine (${stats.ops} operazioni), ma Bitpanda non ha fornito i saldi necessari per verificare che lo storico parta dall'apertura del conto. Controlla il primo movimento o integra con il file CSV.`;
    for (const p of cont.problems.slice(0, 10)) warnings.push(`Storico possibilmente incompleto: ${p}`);
    if (cont.problems.length > 10) warnings.push(`…e altri ${cont.problems.length - 10} portafogli con lo stesso problema.`);

    const coverage = [
      { what: COV.ops, count: stats.ops, from: from ? from.toISOString() : null, to: to ? to.toISOString() : null, complete, note: opsNote },
      { what: COV.stock, count: stats.stock, from: null, to: null, complete: false, note: 'Azioni, ETF, ETC e Cash Plus vengono scaricati ma NON calcolati dall\'app (vengono ignorati con un avviso): se ne hai, i relativi redditi vanno dichiarati a parte.' },
      { what: COV.earn, count: stats.earn, from: null, to: null, complete: false, note: 'Premi, interessi, dividendi e staking/Earn non vengono interpretati: se compaiono diventano operazioni da controllare. Integra con il file se ne hai.' },
      { what: COV.index, count: stats.index, from: null, to: null, complete: false, note: 'Indici cripto (Bitpanda Crypto Index), token a leva e scambi tra cripto non vengono calcolati in automatico: compaiono come operazioni da controllare.' },
      { what: COV.other, count: 0, from: null, to: null, complete: false, note: 'Bitpanda Pro / Exchange (One Trading), carta Bitpanda e altri conti sono prodotti separati e non vengono scaricati: usa i loro file.' },
    ];

    warnings.push('Questo collegamento non è ancora stato provato con un conto reale: controlla a campione alcune operazioni (data, quantità, importo in euro) confrontandole con l\'app Bitpanda prima di usare il risultato.');
    if (!opsRes.endConfirmed && operations.length) warnings.push('Bitpanda non ha confermato la fine dell\'elenco delle operazioni (manca l\'indicatore «has_next_page»): lo storico potrebbe essere incompleto. Integra con il file CSV.');
    if (opsRes.fellBack) warnings.push('Bitpanda ha rifiutato la dimensione di pagina richiesta (100): lo storico è stato scaricato con la dimensione predefinita (25), con più richieste. Il risultato non cambia.');
    if (stats.unresolved) warnings.push(`${stats.unresolved} operazioni non sono state riconosciute e richiedono una decisione (vengono segnalate in "Da controllare"): non sono mai indovinate.`);
    if (stats.compensated) warnings.push(`${stats.compensated} operazioni sono storni o correzioni (campo "compensates") oppure sono state stornate: richiedono una decisione, insieme alla loro correzione.`);
    if (stats.feeFields) warnings.push(`${stats.feeFields} operazioni riportano una commissione in un campo (fee_amount o trade.fee) di cui Bitpanda non documenta il significato (già compresa nell'importo o aggiuntiva): sono segnalate come da controllare, non le indovino.`);
    if (missing.length) warnings.push(`${missing.length} asset citati nelle operazioni non risultano nel catalogo di Bitpanda: le operazioni relative sono segnalate come non riconosciute.`);
    if (stats.metals) warnings.push('Oro e metalli preziosi: la quantità è espressa nell\'unità usata da Bitpanda (si assume il grammo, come nel file CSV; non è dichiarato dall\'API). Verifica con un acquisto reale.');
    if (stats.fees) warnings.push(`${stats.fees} operazioni hanno commissioni come movimenti separati: sono sommate al costo (acquisti) o sottratte dall'incasso (vendite). Questa forma non è documentata per cripto e oro: se l'importo in euro di Bitpanda le includesse già, il costo risulterebbe più alto del reale. Confronta con l'estratto.`);
    if (stats.transferFees) warnings.push(`${stats.transferFees} prelievi di criptovalute hanno la commissione di rete come movimento separato: la quantità in uscita la include (serve per abbinare l'arrivo sull'altro tuo conto). Questa forma non è documentata da Bitpanda: confronta con l'estratto.`);
    if (stats.voided) warnings.push(`${stats.voided} depositi/prelievi annullati sono stati ignorati.`);
    const unknown = unknownKeys(operations);
    if (unknown.length) warnings.push(`Bitpanda ha inviato campi che questa app non interpreta (${unknown.slice(0, 15).join(', ')}${unknown.length > 15 ? ', …' : ''}): se indicano stati, annullamenti o commissioni, i dati potrebbero non essere esatti. Controlla a campione le operazioni con l'app Bitpanda.`);

    return { raw, coverage, warnings };
  }

  CT.api[ID] = {
    id: ID,
    label: 'Bitpanda',
    platform: 'bitpanda',
    fields: [{ key: 'apiKey', label: 'Chiave API di Bitpanda (sola lettura)', secret: true, placeholder: 'Incolla qui la chiave' }],
    options: [],
    help: [
      'Accedi a Bitpanda dal sito, apri le impostazioni dell\'account → sezione «Chiavi API» (indirizzo diretto: app.bitpanda.com/my-account/apikey) e scegli la scheda «Bitpanda». I nomi dei menu possono cambiare.',
      'Crea una nuova chiave e dalle un nome riconoscibile, per esempio «Dichiarazione».',
      'Spunta SOLO i permessi di lettura «Transaction» (storico delle operazioni) e «Trade (Read)» (elenco di asset e valute). Non spuntare mai «Trade (Write)», «Earn (Write)» né altri permessi di scrittura: «Balances» non serve.',
      'Copia la chiave (di solito viene mostrata una sola volta) e incollala qui. Resta nel tuo browser e viene inviata solo a Bitpanda.',
      'Finita la sincronizzazione puoi eliminare la chiave dalle impostazioni di Bitpanda.',
    ],
    limits: [
      'Viene letto lo storico delle operazioni che l\'API pubblica di Bitpanda mette a disposizione. L\'app controlla la coerenza dei saldi riportati da Bitpanda (partenza da saldo zero, nessuna incoerenza): è un controllo di coerenza, non una garanzia, e non può escludere ogni buco. Se il controllo non riesce, integra con il file CSV dello storico completo.',
      'Azioni, ETF, ETC e Cash Plus vengono scaricati ma non calcolati dall\'app.',
      'Premi, interessi, staking/Earn, indici cripto (Bitpanda Crypto Index), token a leva, scambi tra cripto e depositi/prelievi di metalli non vengono interpretati: compaiono come operazioni da controllare, mai indovinate.',
      'Storni e correzioni (campo «compensates») e commissioni indicate in campi propri (fee_amount, trade.fee) non vengono interpretati: l\'operazione compare tra quelle da controllare.',
      'L\'oro è registrato come XAU in grammi (unità assunta, non dichiarata dall\'API); le commissioni indicate come movimenti separati sono sommate al costo (forma non documentata: confrontala con l\'estratto).',
      'Bitpanda Pro / Exchange (One Trading), carta Bitpanda e altri conti sono prodotti separati: non sono inclusi.',
      'Se il browser blocca il collegamento (succede con alcune piattaforme) usa il file CSV.',
    ],
    sync,
    parse,
    // esposti per i test
    _internal: { analyze, checkContinuity, classOfAsset, readLeg, bodyError, unknownKeys, BASE_URL, PAGE_SIZE, COV },
  };
  if (typeof module !== 'undefined') module.exports = CT.api.bitpanda;
})();
