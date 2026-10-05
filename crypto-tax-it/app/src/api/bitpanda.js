/* Collegamento API Bitpanda (sola lettura): scarica lo storico delle operazioni e lo converte in eventi.

   ======================================================================================================
   STATO DELLA VERIFICA (leggere prima di fidarsi dei dati)
   ======================================================================================================
   Il sito della documentazione ufficiale (docs.public.bitpanda.com, developers.bitpanda.com) NON e' raggiungibile
   dal sandbox di sviluppo. La struttura delle risposte di /operations si basa percio' su:
     - repository ufficiale Bitpanda (README e OpenAPI): autenticazione, URL, endpoint, paginazione;
     - una estensione open source di terzi provata su risposte REALI (settembre-ottobre 2026): forma di /operations.
   Il collegamento NON e' stato provato da noi con un conto reale. Per questo ogni dubbio viene trasformato in un
   blocco visibile (evento UNRESOLVED, errore 'format', coverage.complete = false) e MAI in un'ipotesi silenziosa.

   FONTI
   [F1] https://github.com/bitpanda-labs/bitpanda-public-api  (ufficiale: README.md, docs/openapi.yaml, docs/mcp-tools.md)
   [F2] https://github.com/bitpanda-labs/bitpanda-public-api/issues/6  (ufficiale, discussione)
   [F3] https://docs.public.bitpanda.com/api-key-generation  (ufficiale; NON raggiungibile: letto solo tramite un
        riassunto di un motore di ricerca)
   [F4] https://docs.public.bitpanda.com/migrating-from-the-legacy-api  (ufficiale; NON raggiungibile: idem)
   [F5] https://github.com/navimike/MoneyMoney-Bitpanda-PublicAPI  (NON ufficiale, licenza MIT, versione 2.03 del
        2026-10-04: codice e test provati su risposte reali dell'API pubblica; usato solo come riferimento sui fatti,
        nessun codice copiato)
   [F6] https://github.com/matteoantoci/mcp-bitpanda, file docs/bitpanda-api.md  (copia della documentazione ufficiale
        dell'API "legacy" https://developers.bitpanda.com/platform, usata solo per oro/metalli e commissioni)
   [F7] https://github.com/bitpanda-labs/agent-skills, skills/bitpanda/references/api_reference.md  (ufficiale: tipi
        di asset "cryptocoin", "metal", "stock", "commodity", "etf")

   ELENCO DEI FATTI  (V = verificato sulla fonte citata; O = osservato da terzi su dati reali [F5]; A = ASSUNTO)
   URL base https://api.public.bitpanda.com/v1 ................ V [F1] (server di produzione) e [F2] (le risorse stanno
                                                                  sotto /v1; i percorsi senza /v1 danno 404)
   Intestazione di autenticazione "x-api-key" ................. V [F1] (README e securityScheme dell'OpenAPI)
   Dove si crea la chiave ..................................... V [F1] app.bitpanda.com/my-account/apikey, scheda "Bitpanda"
   Permessi della chiave ...................................... V [F3 via riassunto]: Trade (Read), Trade (Write), Balances,
                                                                  Transaction, Earn (Read), Earn (Write). "Transaction" =
                                                                  storico di depositi, prelievi e scambi; "Trade (Read)" =
                                                                  asset, valute e prezzi. Qui servono SOLO questi due.
   Le API "legacy" (trades, wallets/transactions,
   fiatwallets/transactions, assets/transactions/commodity)
   sono sostituite da un unico GET /v1/operations ............. V [F4 via riassunto]
   Paginazione a cursore: parametri "cursor" e "page_size" .... O [F5] (l'OpenAPI ufficiale [F1] scrive "pageSize" in camelCase,
                                                                  ma l'API risponde e accetta snake_case: si accettano
                                                                  entrambe le grafie nelle RISPOSTE; nelle richieste
                                                                  si usa quella osservata)
   page_size massimo 100 ...................................... V [F1] docs/mcp-tools.md (1-100, predefinito 25) e O [F5]
   Risposta: { data:[...], has_next_page, next_cursor } ....... O [F5]
   Anomalie dell'API: l'ultima pagina riporta ancora un
   next_cursor con has_next_page=false; un cursore sconosciuto
   fa ripartire dalla pagina 1 (nessun errore) ................ O [F5] -> si usa SOLO has_next_page e si riconosce il riavvio
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
   Catalogo asset: GET /assets?id=<uuid> -> { data:[{ id, name,
   symbol, isin, type, group }] } ............................. V [F1] (filtro "id" uuid singolo) e O [F5] (forma). Si
                                                                  chiede un asset per volta (solo il caso documentato).
   Valori di type/group: cryptocoin/coin|token; commodity/metal;
   index/index; equity_security|security / stock|etf|etc|
   equity_stock|equity_etf|...|fiat_earn ...................... O [F5]; tipi "cryptocoin", "metal", "stock", "etf" anche in [F7]
   Valute: GET /currencies -> { data:[{ id, symbol }] } ....... V [F1] (endpoint) e O [F5] (forma)
   ORO: asset con type commodity e group metal, simbolo XAU ... V [F6] (wallet "Gold Wallet", cryptocoin_symbol "XAU",
                                                                  gruppo commodity>metal) e O [F5]. Nel CSV e' "Asset class = Metal".
   Unita' dell'oro = GRAMMI ................................... A (dedotta da [F6]: 24,7636 unita' per 1000 EUR a 40,38 EUR
                                                                  nel luglio 2019 = prezzo dell'oro al grammo; non dichiarata).
                                                                  Si usa XAU come nel file CSV; l'unita' resta quella di Bitpanda.
   Importo fiat di buy/sell = totale pagato/incassato ......... A. Come nel CSV (Amount Fiat) il valore e' preso cosi' com'e'.
   Commissioni come movimenti "fee" separati ................... A: se presenti, si SOMMANO al costo (acquisto) o si
                                                                  sottraggono dall'incasso (vendita) perche' il saldo del conto
                                                                  scende anche di quelle ([F5] riconcilia i saldi cosi').
                                                                  Se l'importo fiat gia' le includesse, il costo sarebbe
                                                                  sovrastimato: per questo viene sempre emesso un avviso.
   Storico completo dall'apertura del conto senza "from" ....... A. Si VERIFICA dopo lo scarico con la continuita' dei saldi
                                                                  (asset_balance_after, O [F5]): senza esito positivo
                                                                  coverage.complete = false.
   Limiti di frequenza ........................................ non documentati: si rispettano 429/Retry-After (common.js)
   CORS dal browser ........................................... non verificato: un blocco appare come errore 'network'

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
  const PAGE_SIZE = 100;          // massimo accettato dall'API (V [F1] mcp-tools.md, O [F5])
  const MAX_PAGES = 2000;         // 200.000 operazioni: oltre, la sincronizzazione si ferma invece di girare all'infinito
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
    const base = { account: env.account, ts: stamps.length ? stamps[0] : null, ref: opId, src: `${env.src}:${opId}`, raw: op };
    const U = (key, note) => { env.stats.unresolved++; return [I.unresolved({ ...base, uid }, `Bitpanda API · ${key}`, `Operazione ${opId} (${opType || 'tipo mancante'}): ${note}`)]; };
    const INFO = (note) => [mkEvent({ ...base, uid, kind: Kind.INFO, note })];
    const typeKey = `tipo "${opType}"`;

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

  /** Acquisto/vendita di cripto o metalli: un movimento in valuta + uno in asset (+ commissioni 'fee'). */
  function convertTrade(opType, legs, base, uid, env, U) {
    const typeKey = `tipo "${opType}"`;
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

  function analyze(raw, fileName) {
    if (!validRaw(raw)) throw new ApiError('format', 'I dati Bitpanda salvati non hanno il formato atteso (versione 1): rifai la sincronizzazione.');
    const { currencies, assets } = mapsOf(raw);
    const stats = { ops: 0, unresolved: 0, voided: 0, stock: 0, earn: 0, index: 0, fees: 0, metals: 0 };
    const env = { account: accountName(), src: fileName || 'API Bitpanda', currencies, assets, stats };
    const events = [];
    const seen = new Map();
    raw.operations.forEach((op, i) => {
      if (!isObj(op) || !nonEmpty(op.operation_id) || !Array.isArray(op.transactions)) {
        stats.unresolved++;
        events.push(I.unresolved({ uid: `${UID_PREFIX}?#${i}`, ts: null, account: env.account, src: `${env.src}:#${i}`, raw: op === undefined ? null : op }, 'Bitpanda API · operazione in formato inatteso',
          `L'operazione n. ${i + 1} non ha operation_id o transactions nella forma attesa.`));
        return;
      }
      const sig = stable(op);
      if (seen.has(op.operation_id)) {
        if (seen.get(op.operation_id) !== sig) {
          stats.unresolved++;
          events.push(I.unresolved({ uid: `${UID_PREFIX}${op.operation_id}#conflitto${i}`, ts: null, account: env.account, src: `${env.src}:${op.operation_id}`, raw: op }, 'Bitpanda API · operazione duplicata con contenuto diverso',
            `L'operazione ${op.operation_id} compare due volte con contenuto diverso: scarica di nuovo i dati.`));
        }
        return;                                                     // stessa operazione letta due volte (finestre sovrapposte): conta una volta
      }
      seen.set(op.operation_id, sig);
      stats.ops++;
      events.push(...convertOperation(op, env));
    });
    // ordine cronologico, a parità di istante per uid: il risultato non dipende dall'ordine delle pagine (l'API parte dalle più recenti)
    events.sort((a, b) => (a.ts && b.ts ? a.ts - b.ts : (a.ts ? -1 : b.ts ? 1 : 0)) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
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

  /**
   * Legge TUTTE le pagine di un elenco a cursore. Si ferma con un errore (mai dati parziali) se la paginazione non si puo' esaurire.
   * o = { idOf(item) -> id (lancia 'format' se l'elemento non e' valido), pageSize (null = non inviarlo), progress(n, pagina) }
   */
  async function getAll(get, path, params, o) {
    const items = [], seen = new Map();
    let cursor = null, pages = 0;
    for (;;) {
      if (++pages > MAX_PAGES) throw new ApiError('incomplete', `Troppe pagine da leggere (oltre ${MAX_PAGES}): sincronizzazione interrotta per evitare dati parziali.`);
      const p = { ...params };
      if (o.pageSize) p.page_size = o.pageSize;
      if (cursor !== null) p.cursor = cursor;
      const body = await get(path, p);
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
        if (o.pageSize && body.data.length >= o.pageSize) throw new ApiError('format', 'La risposta di Bitpanda non dice se ci sono altre pagine: non posso sapere se lo storico è completo.', { path });
        break;
      }
      if (typeof hasNext !== 'boolean') throw new ApiError('format', 'La risposta di Bitpanda ha un indicatore di pagina successiva non valido.', { path });
      if (!hasNext) break;                                          // NB: l'ultima pagina puo' avere ancora un next_cursor: si ignora
      if (typeof next !== 'string' || next === '') throw new ApiError('incomplete', 'Bitpanda annuncia altre pagine ma non indica come leggerle (pagina troncata): lo storico è incompleto.', { path });
      if (next === cursor) throw new ApiError('incomplete', 'Il cursore di Bitpanda non avanza: lo storico non può essere letto per intero.', { path });
      cursor = next;
      if (o.progress) o.progress(items.length, pages);
    }
    return items;
  }

  const AUTH_MSG = 'Bitpanda ha rifiutato la chiave: controlla che sia copiata per intero e attiva, e che abbia i permessi di sola lettura «Transaction» e «Trade (Read)» (il permesso «Balances» non serve).';

  async function sync(creds, opts) {
    opts = opts || {};
    const key = creds && typeof creds.apiKey === 'string' ? creds.apiKey.trim() : '';
    if (!key) throw new ApiError('config', 'Inserisci la chiave API di Bitpanda.');
    if (!/^[\x21-\x7e]+$/.test(key)) throw new ApiError('config', 'La chiave API contiene spazi o caratteri non validi: copiala di nuovo per intero.');
    const fetchImpl = opts.fetch || ((u, i) => globalThis.fetch(u, i));
    const now = opts.now || (() => new Date());
    const progress = opts.onProgress || (() => {});
    const ropts = { sleep: opts.sleep || C.sleep, secrets: [key] };
    const init = { method: 'GET', headers: { 'x-api-key': key, Accept: 'application/json' } };

    const get = async (path, params) => {
      try { return await C.request(fetchImpl, BASE_URL + path + qs(params || {}), init, ropts); }
      catch (e) { if (e instanceof ApiError && e.code === 'auth') throw new ApiError('auth', AUTH_MSG, e.detail); throw e; }
    };
    const idField = (what) => (it) => {
      if (!isObj(it) || !nonEmpty(it.id)) throw new ApiError('format', `Un elemento di "${what}" non ha l'identificativo atteso.`, { what });
      return it.id;
    };

    // 1) operazioni: tutte le pagine, senza finestre di date (nessun filtro "from")
    progress('Bitpanda: scarico le operazioni…');
    const operations = await getAll(get, '/operations', {}, {
      pageSize: PAGE_SIZE,
      idOf: (op) => {
        if (!isObj(op) || !nonEmpty(op.operation_id) || !Array.isArray(op.transactions)) throw new ApiError('format', 'Una operazione di Bitpanda non ha la forma attesa (operation_id e transactions).', { what: 'operations' });
        return op.operation_id;
      },
      progress: (n, page) => progress(`Bitpanda: scarico le operazioni (pagina ${page + 1}, ${n} finora)…`),
    });

    // 2) valute
    progress('Bitpanda: scarico l\'elenco delle valute…');
    const currencies = await getAll(get, '/currencies', {}, { pageSize: null, idOf: idField('currencies') });

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
      // elenco vuoto = asset non in catalogo (risposta documentata): le sue operazioni diventano "non riconosciute"; qualunque errore di rete/HTTP ferma tutto
      const list = await getAll(get, '/assets', { id: ids[i] }, { pageSize: null, idOf: idField('assets') });
      const found = list.find((a) => a.id.toLowerCase() === ids[i].toLowerCase());
      if (found) assets.push(found); else missing.push(ids[i]);
    }

    const raw = { version: 1, fetchedAt: now().toISOString(), currencies, operations, assets };

    // 4) analisi: conteggi per la copertura e controllo di continuita' dello storico
    progress('Bitpanda: controllo la completezza dello storico…');
    const A = analyze(raw, 'API Bitpanda');
    const stats = A.stats;
    const res = I.finish('Bitpanda · dati da API', stats.ops, A.events);
    const cont = checkContinuity(operations, A.env);
    const warnings = [];

    const complete = cont.problems.length === 0 && cont.unverifiable === 0 && cont.verified > 0;
    let opsNote;
    if (!operations.length) opsNote = 'Bitpanda non ha restituito nessuna operazione: controlla che la chiave abbia il permesso «Transaction». Se il conto è vuoto, usa il file.';
    else if (complete) opsNote = `Lette tutte le pagine (${stats.ops} operazioni). Controllo dei saldi superato su ${cont.verified} portafogli: lo storico parte da saldo zero e non ha buchi.`;
    else if (cont.problems.length) opsNote = `Letture complete ma lo storico non risulta completo: ${cont.problems[0]}${cont.problems.length > 1 ? ` (e altri ${cont.problems.length - 1} portafogli)` : ''} Integra con il file CSV dello storico completo.`;
    else opsNote = `Lette tutte le pagine (${stats.ops} operazioni), ma Bitpanda non ha fornito i saldi necessari per verificare che lo storico parta dall'apertura del conto. Controlla il primo movimento o integra con il file CSV.`;
    for (const p of cont.problems.slice(0, 10)) warnings.push(`Storico possibilmente incompleto: ${p}`);
    if (cont.problems.length > 10) warnings.push(`…e altri ${cont.problems.length - 10} portafogli con lo stesso problema.`);

    const coverage = [
      { what: COV.ops, count: stats.ops, from: res.from ? res.from.toISOString() : null, to: res.to ? res.to.toISOString() : null, complete, note: opsNote },
      { what: COV.stock, count: stats.stock, from: null, to: null, complete: false, note: 'Azioni, ETF, ETC e Cash Plus vengono scaricati ma NON calcolati dall\'app (vengono ignorati con un avviso): se ne hai, i relativi redditi vanno dichiarati a parte.' },
      { what: COV.earn, count: stats.earn, from: null, to: null, complete: false, note: 'Premi, interessi, dividendi e staking/Earn non vengono interpretati: se compaiono diventano operazioni da controllare. Integra con il file se ne hai.' },
      { what: COV.index, count: stats.index, from: null, to: null, complete: false, note: 'Indici cripto (Bitpanda Crypto Index), token a leva e scambi tra cripto non vengono calcolati in automatico: compaiono come operazioni da controllare.' },
      { what: COV.other, count: 0, from: null, to: null, complete: false, note: 'Bitpanda Pro / Exchange (One Trading), carta Bitpanda e altri conti sono prodotti separati e non vengono scaricati: usa i loro file.' },
    ];

    warnings.push('Questo collegamento non è ancora stato provato con un conto reale: controlla a campione alcune operazioni (data, quantità, importo in euro) confrontandole con l\'app Bitpanda prima di usare il risultato.');
    if (stats.unresolved) warnings.push(`${stats.unresolved} operazioni non sono state riconosciute e richiedono una decisione (vengono segnalate in "Da controllare"): non sono mai indovinate.`);
    if (missing.length) warnings.push(`${missing.length} asset citati nelle operazioni non risultano nel catalogo di Bitpanda: le operazioni relative sono segnalate come non riconosciute.`);
    if (stats.metals) warnings.push('Oro e metalli preziosi: la quantità è espressa nell\'unità usata da Bitpanda (si assume il grammo, come nel file CSV; non è dichiarato dall\'API). Verifica con un acquisto reale.');
    if (stats.fees) warnings.push(`${stats.fees} operazioni hanno commissioni come movimenti separati: sono sommate al costo (acquisti) o sottratte dall'incasso (vendite). Se l'importo in euro di Bitpanda le includesse già, il costo risulterebbe più alto del reale: confronta con l'estratto.`);
    if (stats.voided) warnings.push(`${stats.voided} depositi/prelievi annullati sono stati ignorati.`);

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
      'Viene letto lo storico delle operazioni che l\'API pubblica di Bitpanda mette a disposizione. L\'app controlla che parta da saldo zero e non abbia buchi; se il controllo non riesce, integra con il file CSV dello storico completo.',
      'Azioni, ETF, ETC e Cash Plus vengono scaricati ma non calcolati dall\'app.',
      'Premi, interessi, staking/Earn, indici cripto (Bitpanda Crypto Index), token a leva, scambi tra cripto e depositi/prelievi di metalli non vengono interpretati: compaiono come operazioni da controllare, mai indovinate.',
      'L\'oro è registrato come XAU in grammi (unità assunta, non dichiarata dall\'API); le commissioni indicate come movimenti separati sono sommate al costo.',
      'Bitpanda Pro / Exchange (One Trading), carta Bitpanda e altri conti sono prodotti separati: non sono inclusi.',
      'Se il browser blocca il collegamento (succede con alcune piattaforme) usa il file CSV.',
    ],
    sync,
    parse,
    // esposti per i test
    _internal: { analyze, checkContinuity, classOfAsset, readLeg, BASE_URL, PAGE_SIZE, COV },
  };
  if (typeof module !== 'undefined') module.exports = CT.api.bitpanda;
})();
