/* Importatori: file -> eventi normalizzati. Principio: formato sconosciuto => riga "non riconosciuta" (blocca
   il risultato definitivo), mai un'ipotesi silenziosa.
   ATTENZIONE: i formati di Crypto.com e Bitpanda sono ricostruiti da fonti secondarie e vanno validati sui
   file reali (vedi "Copia diagnostica" nell'app). */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO, FIAT, Kind, classify, mkEvent, METAL_ALIASES, STABLE } = CT;
  const { readTable, FormatError } = CT.csv;

  // ---------------------------------------------------------------- utilita'
  function parseNum(s) {
    if (s === undefined || s === null) return null;
    let t = String(s).trim().replace(/[\s ]/g, '');
    if (t === '' || t === '-' || /^n\/?a$/i.test(t)) return null;
    if (t.includes(',') && t.includes('.')) {
      t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (t.includes(',')) t = t.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) throw new FormatError(`Numero non interpretabile: "${s}"`);
    return D(t);
  }
  const absN = (x) => (x === null ? null : x.abs());

  function parseTs(s) {
    let t = String(s).trim();
    if (!t) throw new FormatError('Data mancante');
    let m;
    if ((m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/))) {
      return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    }
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/))) {
      const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      let off = 0;
      if (m[7] && m[7] !== 'Z') {
        const sign = m[7][0] === '-' ? -1 : 1;
        const hh = +m[7].slice(1, 3), mm = +m[7].replace(':', '').slice(3, 5);
        off = sign * (hh * 60 + mm) * 60000;
      }
      return new Date(base - off);
    }
    throw new FormatError(`Data/ora non interpretabile: "${s}"`);
  }

  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
  }
  function uidFactory(prefix) {
    const seen = new Map();
    return (row) => {
      const key = Object.keys(row).filter((k) => k !== '__line').sort().map((k) => `${k}=${row[k]}`).join('|');
      const h = hash(key);
      const n = (seen.get(h) || 0) + 1;
      seen.set(h, n);
      return `${prefix}:${h}${n > 1 ? '#' + n : ''}`;
    };
  }

  function pick(headers, aliases) {
    const low = new Map(headers.map((h) => [h.toLowerCase(), h]));
    for (const a of aliases) if (low.has(a)) return low.get(a);
    return null;
  }
  const norm = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  function finish(label, rows, events) {
    let from = null, to = null;
    for (const e of events) {
      if (!e.ts) continue;
      if (!from || e.ts < from) from = e.ts;
      if (!to || e.ts > to) to = e.ts;
    }
    const unknown = new Map();
    for (const e of events) if (e.kind === Kind.UNRESOLVED) unknown.set(e.unkKey, (unknown.get(e.unkKey) || 0) + 1);
    return { label, rows, events, from, to, unknown: [...unknown].map(([key, count]) => ({ key, count })) };
  }
  const unresolved = (base, key, note) => mkEvent(Object.assign({}, base, { kind: Kind.UNRESOLVED, unkKey: key, note }));

  // ---------------------------------------------------------------- Crypto.com App
  // Tipi di "Transaction Kind" verificati confrontando la struttura con parser open source collaudati (BittyTax),
  // usati solo come riferimento sui fatti del formato: nessun codice copiato.
  const APP = {
    // scambi: Currency/Amount = gamba ceduta, To Currency/To Amount = gamba ricevuta
    trade: new Set(['viban_purchase', 'van_purchase', 'crypto_viban_exchange', 'crypto_exchange', 'crypto_to_van_sell_order',
      'trading.limit_order.fiat_wallet.sell_commit', 'trading.limit_order.cash_account.purchase_commit',
      'trading.limit_order.crypto_wallet.exchange', 'recurring_buy_order']),
    // acquisto/vendita contro il valore in valuta nativa: Amount > 0 = acquisto, Amount < 0 = vendita
    nativeTrade: new Set(['crypto_purchase', 'trading.crypto_purchase.google_pay', 'dust_conversion_debited', 'dust_conversion_credited']),
    out: new Set(['crypto_withdrawal', 'crypto_to_exchange_transfer']),
    in: new Set(['exchange_to_crypto_transfer', 'crypto_deposit']),
    spend: new Set(['crypto_payment', 'card_top_up', 'card_cashback_reverted', 'reimbursement_reverted']),
    income: {
      crypto_earn_interest_paid: 'interest', crypto_earn_extra_interest_paid: 'interest', supercharger_reward_to_app_credited: 'interest',
      'finance.lockup.dpos_compound_interest.crypto_wallet': 'interest', 'finance.dpos.non_compound_interest.crypto_wallet': 'interest',
      'finance.dpos.compound_interest.crypto_wallet': 'interest', 'finance.crypto_earn.loyalty_program_extra_interest_paid.crypto_wallet': 'interest',
      mco_stake_reward: 'staking', rewards_platform_deposit_credited: 'other',
      referral_bonus: 'referral', referral_gift: 'referral', referral_card_cashback: 'cashback', transfer_cashback: 'cashback',
      reimbursement: 'cashback', gift_card_reward: 'other', admin_wallet_credited: 'other', campaign_reward: 'other',
    },
    // spostamenti interni (blocco/sblocco, Earn, ordini limite): la proprieta' non cambia
    info: new Set(['crypto_earn_program_created', 'crypto_earn_program_withdrawn', 'crypto_earn_program_extended', 'lockup_lock', 'lockup_unlock', 'lockup_upgrade',
      'lockup_swap_credited', 'lockup_swap_debited', 'dynamic_coin_swap_credited', 'dynamic_coin_swap_debited', 'dynamic_coin_swap_bonus_exchange_deposit',
      'interest_swap_credited', 'interest_swap_debited', 'crypto_wallet_swap_credited', 'crypto_wallet_swap_debited', 'supercharger_deposit', 'supercharger_withdrawal',
      'council_node_deposit_created', 'trading.limit_order.fiat_wallet.purchase_lock', 'trading.limit_order.fiat_wallet.purchase_unlock',
      'trading.limit_order.fiat_wallet.sell_lock', 'trading.limit_order.fiat_wallet.sell_unlock', 'trading.limit_order.cash_account.purchase_lock',
      'trading.limit_order.cash_account.purchase_unlock', 'trading.limit_order.cash_account.sell_unlock', 'trading.limit_order.cash_account.sell_lock',
      'trading.limit_order.crypto_wallet.fund_lock', 'trading.limit_order.crypto_wallet.fund_unlock', 'finance.lockup.dpos_lock.crypto_wallet',
      'finance.dpos.staking.crypto_wallet', 'finance.dpos.unstaking.crypto_wallet', 'viban_deposit_precredit', 'viban_deposit_precredit_repayment']),
    fiatIn: new Set(['viban_deposit', 'fiat_deposit']),
    fiatOut: new Set(['viban_withdrawal', 'fiat_withdrawal']),
  };

  function parseCryptocomApp(text, fileName, account) {
    account = account || 'Crypto.com App';
    const { headers, rows } = readTable(text);
    const req = ['Timestamp (UTC)', 'Currency', 'Amount', 'Native Currency', 'Native Amount', 'Transaction Kind'];
    const miss = req.filter((h) => !headers.includes(h));
    if (miss.length) throw new FormatError(`Crypto.com App: colonne mancanti ${miss.join(', ')}`);
    const mkUid = uidFactory(account);
    const events = [];
    for (const row of rows) {
      const uid = mkUid(row);
      const src = `${fileName}:${row.__line}`;
      const ts = parseTs(row['Timestamp (UTC)']);
      const kind = row['Transaction Kind'].trim().toLowerCase();
      const cur = row['Currency'].trim().toUpperCase();
      const rawAmt = parseNum(row['Amount']) || ZERO;
      const amt = rawAmt.abs();
      const toCur = (row['To Currency'] || '').trim().toUpperCase();
      const toAmt = absN(parseNum(row['To Amount'])) || ZERO;
      const nCcy = (row['Native Currency'] || '').trim().toUpperCase() || 'EUR';
      const nAmt = absN(parseNum(row['Native Amount']));
      const desc = row['Transaction Description'] || '';
      const base = { uid, ts, account, ref: row['Transaction Hash'] || '', src, note: desc, raw: row };
      let ev;
      if (APP.trade.has(kind)) {
        if (FIAT.has(cur) && toCur && !FIAT.has(toCur)) ev = mkEvent({ ...base, kind: Kind.BUY, asset: toCur, qty: toAmt, value: amt, valueCcy: cur });
        else if (FIAT.has(toCur) && !FIAT.has(cur)) ev = mkEvent({ ...base, kind: Kind.SELL, asset: cur, qty: amt, value: toAmt, valueCcy: toCur });
        else if (toCur && !FIAT.has(cur) && !FIAT.has(toCur)) ev = mkEvent({ ...base, kind: Kind.SWAP, asset: cur, qty: amt, counterAsset: toCur, counterQty: toAmt, value: nAmt, valueCcy: nCcy });
        else ev = unresolved(base, `Crypto.com App · tipo "${kind}" (valute ${cur}/${toCur || '-'})`, `Scambio con valute non interpretabili (${cur} → ${toCur || '-'})`);
      } else if (APP.nativeTrade.has(kind)) {
        ev = rawAmt.gt(0)
          ? mkEvent({ ...base, kind: Kind.BUY, asset: cur, qty: amt, value: nAmt, valueCcy: nCcy })
          : mkEvent({ ...base, kind: Kind.SELL, asset: cur, qty: amt, value: nAmt, valueCcy: nCcy });
      } else if (APP.out.has(kind)) ev = mkEvent({ ...base, kind: Kind.TRANSFER_OUT, asset: cur, qty: amt, value: nAmt, valueCcy: nCcy });
      else if (APP.in.has(kind)) ev = mkEvent({ ...base, kind: Kind.TRANSFER_IN, asset: cur, qty: amt, value: nAmt, valueCcy: nCcy });
      else if (APP.spend.has(kind)) ev = mkEvent({ ...base, kind: Kind.SPEND, asset: cur, qty: amt, value: nAmt, valueCcy: nCcy });
      else if (kind in APP.income) {
        ev = rawAmt.gt(0)
          ? mkEvent({ ...base, kind: Kind.INCOME, asset: cur, qty: amt, value: nAmt, valueCcy: nCcy, incomeType: APP.income[kind] })
          : unresolved(base, `Crypto.com App · tipo "${kind}" con importo negativo`, `Provento con importo negativo (storno?): "${kind}" (${cur} ${rawAmt.toFixed()})`);
      } else if (kind === 'crypto_transfer') {
        ev = unresolved(base, `Crypto.com App · "crypto_transfer" (${rawAmt.gt(0) ? 'ricevuto' : 'inviato'} tra utenti)`,
          `Trasferimento tra utenti Crypto.com (regalo ${rawAmt.gt(0) ? 'ricevuto' : 'inviato'}): ${cur} ${amt.toFixed()}. Serve una decisione: non è né un acquisto né una vendita.`);
      } else if (APP.info.has(kind)) ev = mkEvent({ ...base, kind: Kind.INFO });
      else if (APP.fiatIn.has(kind)) ev = mkEvent({ ...base, kind: Kind.FIAT_IN, asset: cur, qty: amt });
      else if (APP.fiatOut.has(kind)) ev = mkEvent({ ...base, kind: Kind.FIAT_OUT, asset: cur, qty: amt });
      else if (kind === '') {
        // riga senza tipo: nei file veri sono movimenti in euro (deposito/prelievo)
        if (/deposit/i.test(desc)) ev = mkEvent({ ...base, kind: Kind.FIAT_IN, asset: cur, qty: amt });
        else if (/withdraw/i.test(desc)) ev = mkEvent({ ...base, kind: Kind.FIAT_OUT, asset: cur, qty: amt });
        else ev = unresolved(base, 'Crypto.com App · riga senza tipo', `Riga senza tipo e senza descrizione riconoscibile: "${desc}" (${cur} ${rawAmt.toFixed()})`);
      } else ev = unresolved(base, `Crypto.com App · tipo "${kind}"`, `Tipo di transazione non riconosciuto: "${kind}" (${cur} ${rawAmt.toFixed()})`);
      events.push(ev);
    }
    return finish('Crypto.com App', rows.length, events);
  }

  // ---------------------------------------------------------------- Crypto.com Exchange
  const TRADE_ALIASES = {
    time: ['trade date', 'create time (utc)', 'time (utc)', 'trade time', 'create time', 'timestamp', 'date'],
    instrument: ['instrument', 'instrument name', 'symbol', 'pair', 'market'],
    side: ['side'],
    qty: ['traded quantity', 'quantity', 'qty', 'filled quantity', 'executed quantity'],
    price: ['traded price', 'price', 'avg price', 'average price', 'executed price'],
    fee: ['fee', 'fees', 'trading fee'],
    feeCcy: ['fee currency', 'fees currency', 'fee asset', 'fee currency/instrument'],
    id: ['trade id', 'order id'],
    margin: ['margin order'],
  };
  const XFER_ALIASES = {
    time: ['time (utc)', 'create time (utc)', 'timestamp', 'date', 'time', 'create time'],
    asset: ['currency', 'asset', 'coin', 'instrument'],
    amount: ['amount', 'quantity', 'qty'],
    type: ['type', 'transaction type', 'direction', 'side'],
    id: ['id', 'txid', 'tx id', 'transaction id', 'hash'],
  };
  const QUOTES = [...FIAT, ...STABLE, 'BTC', 'ETH', 'CRO', 'BNB'].sort((a, b) => b.length - a.length);

  function splitPair(s) {
    const t = String(s).trim().toUpperCase().replace(/-/g, '_').replace(/\//g, '_');
    if (t.includes('_')) { const i = t.indexOf('_'); return [t.slice(0, i), t.slice(i + 1)]; }
    for (const q of QUOTES) if (t.endsWith(q) && t.length > q.length) return [t.slice(0, -q.length), q];
    throw new FormatError(`Coppia di trading non interpretabile: "${s}"`);
  }
  // Se nessun alias esatto corrisponde, si cerca per parola chiave (prima corrispondenza non ambigua con la commissione).
  const FUZZY = {
    time: (h) => /(date|time)/.test(h) && !/(update|expire|cancel)/.test(h),
    instrument: (h) => /(instrument|symbol|pair|market)/.test(h) && !/fee/.test(h),
    side: (h) => h === 'side',
    qty: (h) => /quantity|qty/.test(h) && !/(cumulative|order|fee)/.test(h),
    price: (h) => /price/.test(h) && !/(order|stop|trigger|avg)/.test(h),
    fee: (h) => /^fees?$|^fee /.test(h) && !/(currency|instrument|asset|coin|ccy)/.test(h),
    feeCcy: (h) => /fee/.test(h) && /(currency|instrument|asset|coin|ccy)/.test(h),
    margin: (h) => /margin/.test(h),
    asset: (h) => /(currency|asset|coin)/.test(h) && !/fee/.test(h),
    amount: (h) => /(amount|quantity|qty)/.test(h) && !/fee/.test(h),
    type: (h) => /(type|direction)/.test(h) && !/instrument/.test(h),
    id: (h) => /(txid|tx id|hash|trade id|transaction id|^id$)/.test(h),
  };
  function mapCols(headers, aliases, required, label) {
    const m = {};
    for (const k of Object.keys(aliases)) {
      m[k] = pick(headers, aliases[k]);
      if (!m[k] && FUZZY[k]) m[k] = headers.find((h) => FUZZY[k](h.toLowerCase())) || null;
    }
    const miss = required.filter((k) => !m[k]);
    if (miss.length) throw new FormatError(`${label}: campi non riconosciuti (${miss.join(', ')})`);
    return m;
  }

  function parseExchangeTrades(text, fileName, account) {
    account = account || 'Crypto.com Exchange';
    const { headers, rows } = readTable(text);
    const m = mapCols(headers, TRADE_ALIASES, ['time', 'instrument', 'side', 'qty', 'price'], 'Crypto.com Exchange (trade)');
    const mkUid = uidFactory(account + ':trade');
    const events = [];
    for (const row of rows) {
      const uid = mkUid(row);
      const src = `${fileName}:${row.__line}`;
      const ts = parseTs(row[m.time]);
      const base = { uid, ts, account, ref: m.id ? row[m.id] : '', src, raw: row };
      if (m.margin && ['true', '1', 'yes'].includes((row[m.margin] || '').toLowerCase())) {
        events.push(unresolved(base, 'Crypto.com Exchange · trade a margine', 'Trade a margine/derivati: non supportato')); continue;
      }
      let baseA, quote;
      try { [baseA, quote] = splitPair(row[m.instrument]); } catch (e) { events.push(unresolved(base, 'Crypto.com Exchange · coppia', e.message)); continue; }
      const side = (row[m.side] || '').trim().toUpperCase();
      const qty = absN(parseNum(row[m.qty])), price = absN(parseNum(row[m.price]));
      if (!['BUY', 'SELL'].includes(side) || !qty || !price) { events.push(unresolved(base, 'Crypto.com Exchange · trade', `Trade non valido (${side} ${row[m.qty]} @ ${row[m.price]})`)); continue; }
      const quoteAmt = qty.times(price);
      const fee = m.fee ? absN(parseNum(row[m.fee])) || ZERO : ZERO;
      const feeCcy = m.feeCcy ? (row[m.feeCcy] || '').trim().toUpperCase() : '';
      if (fee.gt(0) && !feeCcy) { events.push(unresolved(base, 'Crypto.com Exchange · commissione', 'Commissione senza valuta')); continue; }
      const feeP = fee.gt(0) ? { feeAsset: feeCcy, feeQty: fee } : {};
      let ev;
      if (side === 'BUY') {
        ev = FIAT.has(quote)
          ? mkEvent({ ...base, ...feeP, kind: Kind.BUY, asset: baseA, qty, value: quoteAmt, valueCcy: quote })
          : mkEvent({ ...base, ...feeP, kind: Kind.SWAP, asset: quote, qty: quoteAmt, counterAsset: baseA, counterQty: qty });
      } else {
        ev = FIAT.has(quote)
          ? mkEvent({ ...base, ...feeP, kind: Kind.SELL, asset: baseA, qty, value: quoteAmt, valueCcy: quote })
          : mkEvent({ ...base, ...feeP, kind: Kind.SWAP, asset: baseA, qty, counterAsset: quote, counterQty: quoteAmt });
      }
      events.push(ev);
    }
    return finish('Crypto.com Exchange · trade', rows.length, events);
  }

  function parseExchangeTransfers(text, fileName, account) {
    account = account || 'Crypto.com Exchange';
    const { headers, rows } = readTable(text);
    const m = mapCols(headers, XFER_ALIASES, ['time', 'asset', 'amount'], 'Crypto.com Exchange (depositi/prelievi)');
    const mkUid = uidFactory(account + ':xfer');
    const events = [];
    for (const row of rows) {
      const uid = mkUid(row);
      const src = `${fileName}:${row.__line}`;
      const ts = parseTs(row[m.time]);
      const asset = (row[m.asset] || '').trim().toUpperCase();
      const amt = parseNum(row[m.amount]);
      const base = { uid, ts, account, asset, ref: m.id ? row[m.id] : '', src, raw: row };
      if (amt === null) { events.push(unresolved(base, 'Crypto.com Exchange · movimento', 'Importo mancante')); continue; }
      const typ = m.type ? (row[m.type] || '').trim().toLowerCase() : '';
      let outgoing;
      if (typ.includes('deposit')) outgoing = false;
      else if (typ.includes('withdraw')) outgoing = true;
      else if (!typ) outgoing = amt.lt(0);
      else { events.push(unresolved(base, `Crypto.com Exchange · movimento "${typ}"`, `Tipo di movimento non riconosciuto: "${typ}"`)); continue; }
      const qty = amt.abs();
      if (FIAT.has(asset)) events.push(mkEvent({ ...base, kind: outgoing ? Kind.FIAT_OUT : Kind.FIAT_IN, qty }));
      else events.push(mkEvent({ ...base, kind: outgoing ? Kind.TRANSFER_OUT : Kind.TRANSFER_IN, qty }));
    }
    return finish('Crypto.com Exchange · depositi/prelievi', rows.length, events);
  }

  // ---------------------------------------------------------------- Bitpanda
  // Due varianti di file (verificate sulla struttura di parser open source collaudati, usati solo come riferimento):
  //  - recente: Transaction ID, Timestamp, Transaction Type, In/Out, Amount Fiat, Fiat, Amount Asset, Asset, Asset market price,
  //    Asset market price currency, Asset class, Product ID, Fee, Fee asset, Spread, Spread Currency, Tax Fiat
  //  - precedente: ID, Type, In/Out, Amount Fiat, Fee, Fiat, Amount Asset, Asset, Status, Created at (si contano solo le "finished")
  // Il file puo' avere righe di testo prima dell'intestazione, titoli di sezione e intestazioni ripetute tra una tabella e l'altra.
  const isFiatMove = (amtAsset) => amtAsset === null || amtAsset.isZero();

  function parseBitpanda(text, fileName, account) {
    account = account || 'Bitpanda';
    const marker = /transaction id/i.test(text) ? 'Transaction ID' : 'Amount Fiat';
    const { headers, rows } = readTable(text, marker);
    const recent = headers.includes('Transaction ID');
    const req = recent ? ['Transaction ID', 'Timestamp', 'Transaction Type', 'Amount Fiat', 'Fiat', 'Amount Asset', 'Asset']
      : ['ID', 'Type', 'Amount Fiat', 'Fiat', 'Amount Asset', 'Asset', 'Created at'];
    const miss = req.filter((h) => !headers.includes(h));
    if (miss.length) throw new FormatError(`Bitpanda: colonne mancanti ${miss.join(', ')}`);
    const idCol = recent ? 'Transaction ID' : 'ID', tsCol = recent ? 'Timestamp' : 'Created at', typeCol = recent ? 'Transaction Type' : 'Type';
    const mkUid = uidFactory(account);
    const events = [];
    let dataRows = 0;
    for (const row of rows) {
      if (row[idCol] === idCol) continue;                                   // intestazione ripetuta tra due tabelle
      const others = Object.keys(row).filter((k) => k !== idCol && k !== '__line' && row[k] !== '');
      if (!others.length) continue;                                         // riga di titolo o separatore
      dataRows++;
      const uid = mkUid(row);
      const src = `${fileName}:${row.__line}`;
      const ts = parseTs(row[tsCol]);
      const typ = (row[typeCol] || '').trim().toLowerCase();
      const dir = (row['In/Out'] || '').trim().toLowerCase();
      const assetClass = (row['Asset class'] || '').trim();
      let asset = (row['Asset'] || '').trim().toUpperCase();
      asset = METAL_ALIASES[asset] || asset;
      const qty = absN(parseNum(row['Amount Asset'])) || ZERO;
      const fiatAmt = absN(parseNum(row['Amount Fiat']));
      const fiat = (row['Fiat'] || '').trim().toUpperCase() || 'EUR';
      const fee = absN(parseNum(row['Fee'])) || ZERO;
      const cls = assetClass ? classify(asset, assetClass) : classify(asset);
      const base = { uid, ts, account, ref: row[idCol], src, raw: row, assetHint: assetClass || null };
      let ev;
      if (!recent && (row['Status'] || '').trim().toLowerCase() !== 'finished') {
        ev = mkEvent({ ...base, kind: Kind.INFO, note: `Operazione non completata (stato "${row['Status']}"): ignorata` });
      } else if (typ === 'buy') ev = mkEvent({ ...base, kind: Kind.BUY, asset, qty, value: fiatAmt, valueCcy: fiat });
      else if (typ === 'sell') ev = mkEvent({ ...base, kind: Kind.SELL, asset, qty, value: fiatAmt, valueCcy: fiat });
      else if (typ === 'deposit' || typ === 'withdrawal') {
        const fiatMove = isFiatMove(parseNum(row['Amount Asset'])) || cls === 'fiat' || FIAT.has(asset);
        if (fiatMove) ev = mkEvent({ ...base, kind: typ === 'deposit' ? Kind.FIAT_IN : Kind.FIAT_OUT, asset: fiat, qty: fiatAmt || ZERO });
        else if (typ === 'deposit') ev = mkEvent({ ...base, kind: Kind.TRANSFER_IN, asset, qty });
        else ev = mkEvent({ ...base, kind: Kind.TRANSFER_OUT, asset, qty: qty.plus(fee) });   // la commissione esce in aggiunta alla quantita' inviata
      } else ev = unresolved(base, `Bitpanda · tipo "${typ}" (${assetClass || 'classe n.d.'})`,
        `Tipo di transazione non riconosciuto: "${typ}" (In/Out="${dir}", classe="${assetClass}", ${asset} ${qty.toFixed()})`);
      events.push(ev);
    }
    return finish('Bitpanda', dataRows, events);
  }

  // ---------------------------------------------------------------- Modello universale (qualsiasi piattaforma / wallet)
  const GENERIC_TYPES = {
    acquisto: Kind.BUY, vendita: Kind.SELL, permuta: Kind.SWAP, provento: Kind.INCOME, pagamento: Kind.SPEND,
    trasferimento_uscita: Kind.TRANSFER_OUT, trasferimento_entrata: Kind.TRANSFER_IN, commissione: Kind.FEE,
  };
  const GENERIC_HEADERS = ['data', 'tipo', 'conto', 'asset', 'quantita', 'valore_eur', 'asset_ricevuto', 'quantita_ricevuta',
    'commissione_asset', 'commissione_quantita', 'commissione_eur', 'tipo_provento', 'nota'];

  function parseGeneric(text, fileName, account) {
    const { headers, rows } = readTable(text);
    const map = {};
    for (const h of headers) map[norm(h)] = h;
    for (const need of ['data', 'tipo', 'asset', 'quantita']) if (!map[need]) throw new FormatError(`Modello universale: manca la colonna "${need}"`);
    const g = (row, k) => (map[k] ? row[map[k]] : '');
    const mkUid = uidFactory('manuale');
    const events = [];
    for (const row of rows) {
      const uid = mkUid(row);
      const src = `${fileName}:${row.__line}`;
      const ts = parseTs(g(row, 'data'));
      const acc = g(row, 'conto').trim() || account || 'Altro conto';
      const tipo = norm(g(row, 'tipo'));
      const base = { uid, ts, account: acc, src, raw: row, note: g(row, 'nota') };
      const kind = GENERIC_TYPES[tipo];
      if (!kind) { events.push(unresolved(base, `Modello universale · tipo "${tipo}"`, `Tipo non valido: "${g(row, 'tipo')}"`)); continue; }
      const asset = g(row, 'asset').trim().toUpperCase();
      const qty = absN(parseNum(g(row, 'quantita'))) || ZERO;
      const value = absN(parseNum(g(row, 'valore_eur')));
      const feeQty = absN(parseNum(g(row, 'commissione_quantita'))) || ZERO;
      const feeAsset = g(row, 'commissione_asset').trim().toUpperCase();
      const feeEur = absN(parseNum(g(row, 'commissione_eur')));
      const fee = {};
      if (feeQty.gt(0)) { fee.feeAsset = feeAsset; fee.feeQty = feeQty; }
      if (feeEur) { fee.feeValue = feeEur; fee.feeAsset = fee.feeAsset || 'EUR'; }
      const ev = { ...base, ...fee, kind, asset, qty, value, valueCcy: 'EUR', incomeType: g(row, 'tipo_provento').trim().toLowerCase() || 'other' };
      if (kind === Kind.SWAP) { ev.counterAsset = g(row, 'asset_ricevuto').trim().toUpperCase(); ev.counterQty = absN(parseNum(g(row, 'quantita_ricevuta'))) || ZERO; }
      events.push(mkEvent(ev));
    }
    return finish('Modello universale', rows.length, events);
  }

  const GENERIC_TEMPLATE = GENERIC_HEADERS.join(';') + '\n' +
    '2025-03-01 12:00;acquisto;Il mio wallet;BTC;0.01;600;;;;;;;esempio\n' +
    '2025-04-01 12:00;vendita;Il mio wallet;BTC;0.005;400;;;;;;;esempio\n' +
    '2025-05-01 12:00;permuta;Il mio wallet;ETH;1;2500;BTC;0.04;;;;;esempio\n' +
    '2025-06-01 12:00;provento;Il mio wallet;ADA;50;25;;;;;;staking;esempio\n';

  // ---------------------------------------------------------------- riconoscimento automatico
  const TYPES = {
    cryptocom_app: { label: 'Crypto.com App', parse: parseCryptocomApp },
    cryptocom_exchange_trades: { label: 'Crypto.com Exchange · operazioni (trade)', parse: parseExchangeTrades },
    cryptocom_exchange_transfers: { label: 'Crypto.com Exchange · depositi/prelievi', parse: parseExchangeTransfers },
    bitpanda: { label: 'Bitpanda', parse: parseBitpanda },
    generic: { label: 'Modello universale (altre piattaforme / wallet)', parse: parseGeneric },
  };

  function detectType(text) {
    const t = String(text).replace(/^﻿/, '');
    if (/transaction id/i.test(t) && /asset class/i.test(t)) return 'bitpanda';
    if (/amount fiat/i.test(t) && /amount asset/i.test(t) && /created at/i.test(t)) return 'bitpanda';
    let tbl;
    try { tbl = readTable(t); } catch (e) { return null; }
    const H = tbl.headers.map((h) => h.toLowerCase());
    const has = (x) => H.includes(x);
    if (has('transaction kind') && has('native amount')) return 'cryptocom_app';
    const n = new Set(tbl.headers.map(norm));
    if (n.has('tipo') && n.has('asset') && n.has('quantita') && n.has('data')) return 'generic';
    if (pick(tbl.headers, TRADE_ALIASES.side) && pick(tbl.headers, TRADE_ALIASES.price) && pick(tbl.headers, TRADE_ALIASES.instrument)) return 'cryptocom_exchange_trades';
    return null;
  }

  /** Struttura del file senza importi: intestazioni e valori delle colonne categoriali. */
  function describeFile(text) {
    const t = String(text).replace(/^﻿/, '');
    let tbl;
    try { tbl = readTable(t, /transaction id/i.test(t) ? 'Transaction ID' : (/amount fiat/i.test(t) && /amount asset/i.test(t) ? 'Amount Fiat' : undefined)); } catch (e) { return { error: e.message }; }
    const cats = {};
    for (const h of tbl.headers) {
      const c = new Map();
      for (const r of tbl.rows) c.set(r[h], (c.get(r[h]) || 0) + 1);
      const vals = [...c.keys()];
      const numeric = vals.every((v) => v === '' || !Number.isNaN(Number(String(v).replace(',', '.'))));
      const timey = vals.every((v) => v === '' || /^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{2}\/\d{2}\/\d{4}/.test(v));
      if (vals.length > 0 && vals.length <= 40 && !numeric && !timey) cats[h] = [...c].sort((a, b) => b[1] - a[1]);
    }
    return { headers: tbl.headers, headerLine: tbl.headerLine, rows: tbl.rows.length, categorical: cats };
  }

  CT.importers = { TYPES, detectType, describeFile, parseNum, parseTs, splitPair, GENERIC_TEMPLATE, GENERIC_HEADERS, uidFactory };
  if (typeof module !== 'undefined') module.exports = CT.importers;
})();
