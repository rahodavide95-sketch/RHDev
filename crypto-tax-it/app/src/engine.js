/* Motore di calcolo: eventi -> cessioni, proventi, movimenti per conto, problemi.
   Un dato mancante o ambiguo NON viene mai risolto in silenzio: genera un problema "block" e il calcolo
   prosegue con l'ipotesi piu' prudente (costo zero / valore zero), cosi' l'impatto resta visibile. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO, Kind, classify, taxDate, STABLE, FIAT } = CT;

  const REBASE_DAY = '2025-01-01';
  const NEW_REGIME_DAY = '2023-01-01'; // dal 2023 le permute cripto-cripto sono realizzi imponibili
  const WALLET = 'Wallet personale';
  const it = (day) => day.split('-').reverse().join('/'); // 2025-03-07 -> 07/03/2025 (solo nei messaggi)

  // ------------------------------------------------------------ prezzi
  class PriceBook {
    constructor() { this.manual = new Map(); this.implied = new Map(); this.impliedDays = new Map(); }
    key(sym, day) { return `${sym.toUpperCase()}|${day}`; }
    setManual(sym, day, price) { this.manual.set(this.key(sym, day), D(price)); }
    clearManual(sym, day) { this.manual.delete(this.key(sym, day)); }
    addImplied(sym, day, price) {
      const k = this.key(sym, day);
      const cur = this.implied.get(k) || { sum: ZERO, n: 0 };
      cur.sum = cur.sum.plus(price); cur.n += 1;
      this.implied.set(k, cur);
      const s = sym.toUpperCase();
      if (!this.impliedDays.has(s)) this.impliedDays.set(s, new Set());
      this.impliedDays.get(s).add(day);
    }
    /** {price, src:'manuale'|'dedotto'} oppure null */
    get(sym, day) {
      const k = this.key(sym, day);
      if (this.manual.has(k)) return { price: this.manual.get(k), src: 'manuale' };
      const i = this.implied.get(k);
      if (i) return { price: i.sum.div(i.n), src: 'dedotto' };
      return null;
    }
    /** Prezzo noto piu' vicino (per suggerimenti), cercando tra le operazioni dell'utente. */
    nearest(sym, day) {
      const days = this.impliedDays.get(sym.toUpperCase());
      if (!days) return null;
      let best = null, bestDiff = Infinity;
      const t0 = Date.parse(day + 'T00:00:00Z');
      for (const d of days) {
        const diff = Math.abs(Date.parse(d + 'T00:00:00Z') - t0);
        if (diff < bestDiff) { bestDiff = diff; best = d; }
      }
      if (!best) return null;
      return { day: best, price: this.get(sym, best).price, daysApart: Math.round(bestDiff / 86400000) };
    }
  }

  // ------------------------------------------------------------ lotti LIFO
  class LotPool {
    constructor(asset) { this.asset = asset; this.lots = []; }
    get balance() { return this.lots.reduce((s, l) => s.plus(l.qty), ZERO); }
    add(lot) {
      this.lots.push(lot);
      this.lots.sort((a, b) => a.ts - b.ts); // stabile: a pari data resta l'ordine di inserimento
    }
    /** LIFO: ritorna { uses, short } */
    consume(qty) {
      let remaining = qty;
      const uses = [];
      while (remaining.gt(0) && this.lots.length) {
        const lot = this.lots[this.lots.length - 1];
        const take = lot.qty.lt(remaining) ? lot.qty : remaining;
        uses.push({ lotId: lot.id, ts: lot.ts, day: taxDate(lot.ts), qty: take, cost: take.times(lot.unitCost), documented: lot.documented, rebased: lot.rebased, origin: lot.origin });
        lot.qty = lot.qty.minus(take);
        remaining = remaining.minus(take);
        if (lot.qty.isZero()) this.lots.pop();
      }
      return { uses, short: remaining };
    }
  }

  // ------------------------------------------------------------ motore
  class Engine {
    constructor(opts) {
      this.opts = Object.assign({ rebase2025: false, resolutions: {}, transferWindowH: 72, transferFeeTol: D('0.10'), prices: new PriceBook() }, opts || {});
      this.prices = this.opts.prices;
      this.pools = new Map();
      this.disposals = []; this.incomes = []; this.movements = []; this.issues = [];
      this.missingPrices = new Map(); // "SYM|day" -> {symbol, day}
      this.stats = {};
      this.rebaseTotal = ZERO;
      this._classes = new Map();
      this._seq = 0;
      this._rebased = false;
    }

    issue(level, code, uid, message, data) { this.issues.push({ level, code, uid, message, data: data || {} }); }
    pool(a) { if (!this.pools.has(a)) this.pools.set(a, new LotPool(a)); return this.pools.get(a); }
    cls(asset, hint) {
      if (hint) this._classes.set(asset, classify(asset, hint));
      if (!this._classes.has(asset)) this._classes.set(asset, classify(asset));
      return this._classes.get(asset);
    }
    need(sym, ts) { const day = taxDate(ts); this.missingPrices.set(`${sym.toUpperCase()}|${day}`, { symbol: sym.toUpperCase(), day }); }

    toEur(amount, ccy, e) {
      if (ccy === 'EUR') return amount;
      const p = this.prices.get(ccy, taxDate(e.ts));
      if (p) return amount.times(p.price);
      this.need(ccy, e.ts);
      this.issue('block', 'missing_price', e.uid, `Manca il cambio ${ccy}/EUR del ${it(taxDate(e.ts))}`, { symbol: ccy, day: taxDate(e.ts) });
      return null;
    }

    /** Controvalore EUR della gamba principale: valore dalla fonte > prezzo del giorno x quantita'. */
    valueEur(e) {
      if (e.value !== null && e.value !== undefined) {
        const v = this.toEur(e.value, e.valueCcy, e);
        if (v !== null) return { v, src: 'dal file' };
      }
      const day = taxDate(e.ts);
      if (e.asset) {
        const p = this.prices.get(e.asset, day);
        if (p) return { v: p.price.times(e.qty), src: p.src === 'manuale' ? 'prezzo inserito' : 'prezzo dedotto dalle tue operazioni' };
      }
      if (e.counterAsset && !e.counterQty.isZero()) {
        const p = this.prices.get(e.counterAsset, day);
        if (p) return { v: p.price.times(e.counterQty), src: p.src === 'manuale' ? 'prezzo inserito' : 'prezzo dedotto dalle tue operazioni' };
      }
      this.need(e.asset || e.counterAsset, e.ts);
      this.issue('block', 'missing_value', e.uid, `Impossibile valorizzare in euro ${e.qty.toFixed()} ${e.asset} del ${it(day)}: manca il prezzo`, { symbol: e.asset, day });
      return { v: ZERO, src: 'MANCANTE' };
    }

    feeEur(e) {
      if (e.feeQty.isZero() && (e.feeValue === null || e.feeValue === undefined)) return ZERO;
      if (e.feeValue !== null && e.feeValue !== undefined) { const v = this.toEur(e.feeValue, e.feeValueCcy, e); return v === null ? ZERO : v; }
      if (e.feeAsset === 'EUR') return e.feeQty;
      if (classify(e.feeAsset) === 'fiat') { const v = this.toEur(e.feeQty, e.feeAsset, e); return v === null ? ZERO : v; }
      const p = this.prices.get(e.feeAsset, taxDate(e.ts));
      if (!p) {
        this.need(e.feeAsset, e.ts);
        this.issue('block', 'missing_price', e.uid, `Manca il prezzo di ${e.feeAsset} per valorizzare la commissione del ${it(taxDate(e.ts))}`, { symbol: e.feeAsset, day: taxDate(e.ts) });
        return ZERO;
      }
      return p.price.times(e.feeQty);
    }

    /** Valore in EUR dichiarato dal file per un trasferimento (se c'e'): serve solo al prospetto RW. */
    hint(e) { return e.value !== null && e.value !== undefined && e.valueCcy === 'EUR' ? e.value : null; }
    move(e, account, asset, delta, eur) { this.movements.push({ ts: e.ts, day: taxDate(e.ts), account, asset, delta, eur: eur === undefined ? null : eur, uid: e.uid }); }

    acquire(e, asset, qty, cost, documented = true, ts = null) {
      if (qty.isZero()) return;
      this.pool(asset).add({ id: `L${String(++this._seq).padStart(6, '0')}`, asset, ts: ts || e.ts, qty, unitCost: cost.div(qty), origin: e.uid, documented, rebased: false });
    }

    dispose(e, uid, asset, qty, proceeds, fee, kind, source, note) {
      const pool = this.pool(asset);
      let { uses, short } = pool.consume(qty);
      if (short.gt(0)) {
        const res = this.opts.resolutions[uid];
        if (res && res.action === 'cover_cost') {
          const when = res.acquired ? new Date(res.acquired + 'T00:00:00Z') : new Date(e.ts.getTime() - 1000);
          pool.add({ id: `L${String(++this._seq).padStart(6, '0')}`, asset, ts: when, qty: short, unitCost: D(res.cost_eur).div(short), origin: 'manuale', documented: true, rebased: false });
          const more = pool.consume(short);
          uses = uses.concat(more.uses);
          short = more.short;
          this.issue('info', 'resolved_cover_cost', uid, `Costo del mancante impostato manualmente: ${res.cost_eur} €`);
        }
        if (short.gt(0)) {
          this.issue('block', 'missing_history', uid,
            `Vendita/uso di ${CT.fq(qty)} ${asset} del ${it(taxDate(e.ts))}, ma dai file risultano solo ${CT.fq(qty.minus(short))} disponibili: mancano ${CT.fq(short)}.`,
            { asset, qty: short, day: taxDate(e.ts), account: e.account });
          uses.push({ lotId: 'MANCANTE', ts: e.ts, day: taxDate(e.ts), qty: short, cost: ZERO, documented: false, rebased: false, origin: '' });
        }
      }
      const cost = uses.reduce((s, u) => s.plus(u.cost), ZERO);
      const d = { uid, ts: e.ts, day: taxDate(e.ts), year: CT.yearOf(taxDate(e.ts)), account: e.account, asset, cls: this.cls(asset, asset === e.asset ? e.assetHint : null),
        kind, qty, proceeds, fee, cost, gain: proceeds.minus(cost), uses, source, src: e.src, note: note || '' };
      this.disposals.push(d);
      return d;
    }

    feeDisposal(e, feeEur) {
      if (!e.feeAsset || e.feeQty.isZero() || classify(e.feeAsset) === 'fiat') return;
      this.move(e, e.account, e.feeAsset, e.feeQty.neg(), feeEur);
      this.dispose(e, e.uid + '#fee', e.feeAsset, e.feeQty, feeEur, ZERO, 'fee', 'commissione');
    }

    // -------------------------------------------------------- preparazione
    prepare(events) {
      const out = [];
      const sorted = events.map((e, i) => [e, i]).sort((a, b) => (a[0].ts - b[0].ts) || (a[1] - b[1]));
      for (let [e] of sorted) {
        const r = this.opts.resolutions[e.uid];
        if (r) {
          if (r.action === 'ignore') { this.issue('info', 'resolved_ignore', e.uid, 'Riga ignorata su tua richiesta'); continue; }
          if (r.action === 'set_value') { e = Object.assign({}, e, { value: D(r.value_eur), valueCcy: 'EUR' }); this.issue('info', 'resolved_value', e.uid, `Valore impostato manualmente: ${r.value_eur} €`); }
        }
        out.push(e);
      }
      return out;
    }

    collectImplied(events) {
      for (const e of events) {
        if (e.value === null || e.value === undefined || e.valueCcy !== 'EUR') continue;
        const day = taxDate(e.ts);
        if ((e.kind === Kind.BUY || e.kind === Kind.SELL || e.kind === Kind.INCOME || e.kind === Kind.SPEND) && e.asset && e.qty.gt(0) && !FIAT.has(e.asset)) {
          this.prices.addImplied(e.asset, day, e.value.div(e.qty));
        } else if (e.kind === Kind.SWAP) {
          if (e.qty.gt(0)) this.prices.addImplied(e.asset, day, e.value.div(e.qty));
          if (e.counterQty.gt(0)) this.prices.addImplied(e.counterAsset, day, e.value.div(e.counterQty));
        }
      }
    }

    matchTransfers(evs) {
      const outs = evs.filter((e) => e.kind === Kind.TRANSFER_OUT);
      const ins = evs.filter((e) => e.kind === Kind.TRANSFER_IN);
      const win = this.opts.transferWindowH * 3600000;
      const used = new Set();
      const pair = new Map();
      for (const o of outs) {
        let best = null;
        for (const i of ins) {
          if (used.has(i.uid) || i.account === o.account || i.asset !== o.asset) continue;
          const dt = Math.abs(i.ts - o.ts);
          if (dt > win || i.qty.gt(o.qty)) continue;
          const fee = o.qty.minus(i.qty);
          if (fee.gt(o.qty.times(this.opts.transferFeeTol))) continue;
          if (!best || dt < best.dt || (dt === best.dt && fee.lt(best.fee))) best = { i, dt, fee };
        }
        if (best) { used.add(best.i.uid); pair.set(o.uid, best.i); pair.set(best.i.uid, o); }
      }
      return pair;
    }

    rebase() {
      this._rebased = true;
      for (const [asset, pool] of this.pools) {
        if (this.cls(asset) !== 'crypto' || pool.balance.isZero()) continue;
        const p = this.prices.get(asset, REBASE_DAY);
        if (!p) {
          this.missingPrices.set(`${asset.toUpperCase()}|${REBASE_DAY}`, { symbol: asset.toUpperCase(), day: REBASE_DAY });
          this.issue('block', 'missing_price', '', `Per la rideterminazione serve il prezzo di ${asset} al 1/1/2025`, { symbol: asset.toUpperCase(), day: REBASE_DAY });
          continue;
        }
        for (const lot of pool.lots) { lot.unitCost = p.price; lot.rebased = true; lot.documented = true; }
        this.rebaseTotal = this.rebaseTotal.plus(pool.balance.times(p.price));
      }
    }

    // -------------------------------------------------------- ciclo principale
    run(events) {
      this.collectImplied(events);
      const evs = this.prepare(events);
      const pair = this.matchTransfers(evs);
      for (const e of evs) {
        if (this.opts.rebase2025 && !this._rebased && taxDate(e.ts) >= REBASE_DAY) this.rebase();
        this.stats[e.kind] = (this.stats[e.kind] || 0) + 1;
        this.handle(e, pair);
      }
      if (this.opts.rebase2025 && !this._rebased) this.rebase();
      return this;
    }

    handle(e, pair) {
      const k = e.kind;
      if (k === Kind.INFO || k === Kind.FIAT_IN || k === Kind.FIAT_OUT) return;
      if (k === Kind.UNRESOLVED) { this.issue('block', 'unrecognized_row', e.uid, e.note || 'Riga non riconosciuta', { key: e.unkKey, src: e.src }); return; }
      const cls = e.asset ? this.cls(e.asset, e.assetHint) : 'other';
      if (k !== Kind.TRANSFER_IN && k !== Kind.TRANSFER_OUT && (cls === 'other' || cls === 'fiat')) {
        this.issue('warn', 'out_of_scope', e.uid, `Operazione su ${e.asset} (${cls === 'other' ? 'azioni/ETF o altro' : 'valuta'}) fuori dal perimetro di questa versione: ignorata`, { asset: e.asset });
        return;
      }
      if (k === Kind.BUY) {
        const { v } = this.valueEur(e); const fee = this.feeEur(e);
        this.acquire(e, e.asset, e.qty, v.plus(fee));
        this.move(e, e.account, e.asset, e.qty, v.plus(fee));
        this.feeDisposal(e, fee);
      } else if (k === Kind.SELL || k === Kind.SPEND) {
        const { v, src } = this.valueEur(e); const fee = this.feeEur(e);
        this.move(e, e.account, e.asset, e.qty.neg(), v);
        this.dispose(e, e.uid, e.asset, e.qty, v.minus(fee), fee, k, src, e.note);
        this.feeDisposal(e, fee);
      } else if (k === Kind.SWAP) {
        if (!e.counterAsset || classify(e.counterAsset) === 'fiat') { this.issue('block', 'unrecognized_row', e.uid, 'Permuta senza asset di destinazione valido'); return; }
        const { v, src } = this.valueEur(e); const fee = this.feeEur(e);
        if (STABLE.has(e.asset) && STABLE.has(e.counterAsset)) {
          this.issue('info', 'stable_swap', e.uid, `Scambio tra stablecoin ${e.asset}→${e.counterAsset}: trattato come permuta imponibile (scelta prudenziale).`);
        }
        this.move(e, e.account, e.asset, e.qty.neg(), v);
        // conversione di saldo (cambio di nome o migrazione di un token): dal 2023 serve una scelta dell'utente
        const convChoice = e.conv ? (this.opts.resolutions[e.uid] || {}).action : null;
        if (e.conv && taxDate(e.ts) >= NEW_REGIME_DAY && convChoice !== 'migration' && convChoice !== 'swap') {
          this.issue('block', 'conversion_pending', e.uid,
            `Conversione di saldo del ${it(taxDate(e.ts))}: ${CT.fq(e.qty)} ${e.asset} → ${CT.fq(e.counterQty)} ${e.counterAsset}`,
            { asset: e.asset, counter: e.counterAsset, qty: e.qty, counterQty: e.counterQty, day: taxDate(e.ts), account: e.account });
        }
        if (taxDate(e.ts) < NEW_REGIME_DAY || convChoice === 'migration') {
          // Prima del 2023 la permuta cripto-cripto non era un realizzo (e una migrazione di token non lo e'): il costo si trasferisce al nuovo asset.
          const { uses, short } = this.pool(e.asset).consume(e.qty);
          let cost = uses.reduce((s, u) => s.plus(u.cost), ZERO);
          if (short.gt(0)) this.issue('block', 'missing_history', e.uid, `Permuta di ${CT.fq(e.qty)} ${e.asset} del ${it(taxDate(e.ts))}: mancano ${CT.fq(short)} negli acquisti caricati.`, { asset: e.asset, qty: short, day: taxDate(e.ts), account: e.account });
          this.acquire(e, e.counterAsset, e.counterQty, cost, short.isZero());
        } else {
          this.dispose(e, e.uid, e.asset, e.qty, v.minus(fee), fee, 'swap', src, e.note);
          this.acquire(e, e.counterAsset, e.counterQty, v);
        }
        this.move(e, e.account, e.counterAsset, e.counterQty, v);
        this.feeDisposal(e, fee);
      } else if (k === Kind.INCOME) {
        const { v, src } = this.valueEur(e);
        this.acquire(e, e.asset, e.qty, v);
        this.move(e, e.account, e.asset, e.qty, v);
        this.incomes.push({ uid: e.uid, ts: e.ts, day: taxDate(e.ts), year: CT.yearOf(taxDate(e.ts)), account: e.account, asset: e.asset, cls, qty: e.qty, value: v, type: e.incomeType || 'other', source: src, src: e.src });
      } else if (k === Kind.FEE) {
        const { v } = this.valueEur(e);
        this.move(e, e.account, e.asset, e.qty.neg(), v);
        this.dispose(e, e.uid, e.asset, e.qty, v, ZERO, 'fee', 'commissione');
      } else if (k === Kind.TRANSFER_OUT) this.transferOut(e, pair.get(e.uid));
      else if (k === Kind.TRANSFER_IN) this.transferIn(e, pair.get(e.uid));
    }

    transferOut(e, other) {
      if (other) {
        this.move(e, e.account, e.asset, e.qty.neg(), this.hint(e));
        const feeQty = e.qty.minus(other.qty);
        if (feeQty.gt(0)) {
          const fe = Object.assign({}, e, { kind: Kind.FEE, qty: feeQty, value: e.value !== null ? e.value.times(feeQty).div(e.qty) : null });
          const { v } = this.valueEur(fe);
          this.dispose(fe, e.uid + '#netfee', e.asset, feeQty, v, ZERO, 'transfer_fee', 'commissione di rete');
          this.move(e, '(rete)', e.asset, feeQty);
        }
        return;
      }
      const res = this.opts.resolutions[e.uid] || {};
      if (res.action === 'disposal') {
        const fe = Object.assign({}, e, { kind: Kind.SELL, value: D(res.value_eur), valueCcy: 'EUR' });
        const { v, src } = this.valueEur(fe);
        this.move(e, e.account, e.asset, e.qty.neg(), v);
        this.dispose(fe, e.uid, e.asset, e.qty, v, ZERO, 'sell', 'inserito da te', 'uscita trattata come vendita');
        this.issue('info', 'resolved_disposal', e.uid, 'Uscita trattata come vendita su tua indicazione');
        return;
      }
      const wallet = res.wallet || WALLET;
      this.move(e, e.account, e.asset, e.qty.neg(), this.hint(e));
      this.move(e, wallet, e.asset, e.qty, this.hint(e));
      if (res.action === 'self_custody') this.issue('info', 'resolved_self_custody', e.uid, `Uscita verso ${wallet}: nessuna vendita`);
      else this.issue('block', 'transfer_out_unmatched', e.uid,
        `Il ${it(taxDate(e.ts))} sono usciti ${CT.fq(e.qty)} ${e.asset} da ${e.account}, ma non risultano arrivati su un altro tuo conto.`,
        { asset: e.asset, qty: e.qty, day: taxDate(e.ts), account: e.account });
    }

    transferIn(e, other) {
      if (other) { this.move(e, e.account, e.asset, e.qty, this.hint(e) ?? this.hint(other)); return; }
      const res = this.opts.resolutions[e.uid] || {};
      if (res.action === 'from_self_custody') {
        const wallet = res.wallet || WALLET;
        this.move(e, wallet, e.asset, e.qty.neg(), this.hint(e));
        this.move(e, e.account, e.asset, e.qty, this.hint(e));
        this.issue('info', 'resolved_from_self_custody', e.uid, `Ingresso da ${wallet}: nessun nuovo acquisto`);
        return;
      }
      if (res.action === 'set_cost') {
        const when = res.acquired ? new Date(res.acquired + 'T00:00:00Z') : e.ts;
        this.acquire(e, e.asset, e.qty, D(res.cost_eur), true, when);
        this.move(e, e.account, e.asset, e.qty, null);
        this.issue('info', 'resolved_cost', e.uid, `Costo impostato manualmente: ${res.cost_eur} €`);
        return;
      }
      this.acquire(e, e.asset, e.qty, ZERO, false);
      this.move(e, e.account, e.asset, e.qty, this.hint(e));
      this.issue('block', 'transfer_in_unmatched', e.uid,
        `Il ${it(taxDate(e.ts))} sono arrivati ${CT.fq(e.qty)} ${e.asset} su ${e.account} da un'origine che non conosco.`,
        { asset: e.asset, qty: e.qty, day: taxDate(e.ts), account: e.account });
    }
  }

  CT.PriceBook = PriceBook; CT.Engine = Engine; CT.LotPool = LotPool; CT.WALLET = WALLET;
  if (typeof module !== 'undefined') module.exports = { PriceBook, Engine, LotPool };
})();
