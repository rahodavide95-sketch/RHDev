/* Imposta sostitutiva per anno e per paniere: cripto (art. 67 c.1 lett. c-sexies) e metalli preziosi (c-ter).
   Le regole sono marcate "da verificare": valori raccolti da fonti secondarie (vedi docs/SPECIFICA.md). */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO, roundEuro, EMT_EUR } = CT;

  // threshold: franchigia (art. 67, c. 1, lett. c-sexies: imponibili le plusvalenze e i proventi "non inferiori complessivamente a 2.000 euro").
  // lossMin: nel 2023-2024 la minusvalenza netta cripto si riporta solo se "superiore a 2.000 euro" (art. 68, c. 9-bis TUIR, testo in vigore
  // fino al 2024); dal 2025 la soglia non c'e' piu' (L. 207/2024, art. 1, c. 25, lett. b).
  const BASE = { metalsRate: D('0.26'), ivcaRate: D('0.002'), lossYears: 4, status: 'da verificare' };
  const RULES = {
    2023: { ...BASE, year: 2023, cryptoRate: D('0.26'), threshold: D(2000), lossMin: D(2000), emtRate: null, note: 'Franchigia 2.000 € sulle plusvalenze cripto (da 2.000 € in su si tassa tutto); minusvalenza netta riportabile solo se superiore a 2.000 €.' },
    2024: { ...BASE, year: 2024, cryptoRate: D('0.26'), threshold: D(2000), lossMin: D(2000), emtRate: null, note: 'Franchigia 2.000 € sulle plusvalenze cripto (da 2.000 € in su si tassa tutto); minusvalenza netta riportabile solo se superiore a 2.000 €.' },
    2025: { ...BASE, year: 2025, cryptoRate: D('0.26'), threshold: null, lossMin: null, emtRate: null, note: 'Aliquota 26%, nessuna franchigia (abolita dal 2025, anche per il riporto delle minusvalenze).' },
    2026: { ...BASE, year: 2026, cryptoRate: D('0.33'), threshold: null, lossMin: null, emtRate: D('0.26'), note: 'Aliquota 33%; 26% per le stablecoin in euro conformi a MiCA (E-money token).' },
  };
  const YEARS = Object.keys(RULES).map(Number);

  function computeBasket(kind, year, rule, ds, incs, carry, useCarry) {
    const isCrypto = kind === 'crypto';
    const r = {
      kind, year, name: isCrypto ? 'Cripto-attività' : 'Oro e metalli preziosi',
      law: isCrypto ? 'art. 67, c. 1, lett. c-sexies TUIR' : 'art. 67, c. 1, lett. c-ter TUIR',
      rate: isCrypto ? rule.cryptoRate : rule.metalsRate,
      nDisposals: ds.length, proceeds: ZERO, costs: ZERO, gains: ZERO, losses: ZERO, net: ZERO, income: ZERO,
      carryUsed: [], carryUnused: [], carryExpired: [], newLoss: ZERO, lossNotCarried: ZERO, taxable: ZERO, tax: ZERO, thresholdExempt: false, emtShare: ZERO, nonDeductible: ZERO,
    };
    for (const d of ds) {
      r.proceeds = r.proceeds.plus(d.proceeds); r.costs = r.costs.plus(d.cost);
      // taxGain: risultato fiscale, se diverso da corrispettivo - costo (perdita non deducibile su lotti rideterminati al 1/1/2025)
      const g = d.taxGain !== undefined ? d.taxGain : d.gain;
      if (g.gt(0)) r.gains = r.gains.plus(g); else r.losses = r.losses.minus(g);
      if (d.taxGain !== undefined) r.nonDeductible = r.nonDeductible.plus(d.taxGain.minus(d.gain));
    }
    r.income = incs.reduce((s, i) => s.plus(i.value), ZERO);
    if (r.income.lt(0)) r.income = ZERO;   // gli storni riducono i proventi dell'anno, mai sotto zero (non diventano una perdita)
    r.net = r.gains.minus(r.losses);

    const usable = carry.filter((c) => c.year >= year - rule.lossYears && c.year < year).sort((a, b) => a.year - b.year);
    r.carryExpired = carry.filter((c) => c.year < year - rule.lossYears);

    let cap = r.net.gt(0) ? roundEuro(r.net) : ZERO;
    const exempt = isCrypto && rule.threshold && r.net.plus(r.income).lt(rule.threshold);   // "non inferiori a 2.000": esattamente 2.000 si tassa
    if (exempt && (r.net.gt(0) || r.income.gt(0))) {
      r.thresholdExempt = true; cap = ZERO; r.carryUnused = usable.map((c) => ({ ...c }));
      r.taxable = ZERO; r.tax = ZERO;
    } else {
      for (const c of usable) {
        const take = useCarry ? (c.amount.lt(cap) ? c.amount : cap) : ZERO;
        if (take.gt(0)) { r.carryUsed.push({ year: c.year, amount: take }); cap = cap.minus(take); }
        if (c.amount.minus(take).gt(0)) r.carryUnused.push({ year: c.year, amount: c.amount.minus(take) });
      }
      r.taxable = roundEuro(cap.plus(r.income));
      let tax = r.taxable.times(r.rate);
      if (isCrypto && rule.emtRate) {
        const emtNet = ds.filter((d) => EMT_EUR.has(d.asset)).reduce((s, d) => s.plus(d.taxGain !== undefined ? d.taxGain : d.gain), ZERO);
        const share = emtNet.gt(0) ? (emtNet.lt(cap) ? emtNet : cap) : ZERO;
        r.emtShare = roundEuro(share);
        tax = r.taxable.minus(r.emtShare).times(r.rate).plus(r.emtShare.times(rule.emtRate));
      }
      r.tax = roundEuro(tax);
    }
    if (r.net.lt(0)) {
      const loss = roundEuro(r.net.neg());
      if (isCrypto && rule.lossMin && loss.lte(rule.lossMin)) r.lossNotCarried = loss;   // 2023-2024: fino a 2.000 € non si riporta
      else r.newLoss = loss;
    }
    return r;
  }

  /** Calcola dal 2023 fino a `toYear` riportando automaticamente le minusvalenze (se useCarry). */
  function computeYears(engine, opts) {
    const { toYear, useCarry = true, manualCarry = {} } = opts;
    const carry = { crypto: (manualCarry.crypto || []).map((c) => ({ year: +c.year, amount: D(c.amount) })), metals: (manualCarry.metals || []).map((c) => ({ year: +c.year, amount: D(c.amount) })) };
    const out = {};
    for (const y of YEARS.filter((y) => y <= toYear)) {
      const rule = RULES[y];
      const ds = engine.disposals.filter((d) => d.year === y);
      const incs = engine.incomes.filter((i) => i.year === y);
      const crypto = computeBasket('crypto', y, rule, ds.filter((d) => d.cls === 'crypto'), incs.filter((i) => i.cls === 'crypto'), carry.crypto, useCarry);
      const metals = computeBasket('metal', y, rule, ds.filter((d) => d.cls === 'metal'), incs.filter((i) => i.cls === 'metal'), carry.metals, useCarry);
      if (crypto.newLoss.gt(0)) carry.crypto.push({ year: y, amount: crypto.newLoss });
      if (metals.newLoss.gt(0)) carry.metals.push({ year: y, amount: metals.newLoss });
      // le minusvalenze usate o scadute escono dalla lista (aggiornamento in sede di riporto)
      for (const [list, b] of [[carry.crypto, crypto], [carry.metals, metals]]) {
        for (const u of b.carryUsed) { const c = list.find((x) => x.year === u.year); if (c) c.amount = c.amount.minus(u.amount); }
        for (let i = list.length - 1; i >= 0; i--) if (list[i].amount.lte(0)) list.splice(i, 1);
      }
      out[y] = { year: y, rule, crypto, metals, totalTax: crypto.tax.plus(metals.tax) };
    }
    return out;
  }

  CT.tax = { RULES, YEARS, computeYears, computeBasket };
  if (typeof module !== 'undefined') module.exports = CT.tax;
})();
