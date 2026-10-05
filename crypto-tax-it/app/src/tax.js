/* Imposta sostitutiva per anno e per paniere: cripto (art. 67 c.1 lett. c-sexies) e metalli preziosi (c-ter).
   Le regole sono marcate "da verificare": valori raccolti da fonti secondarie (vedi docs/SPECIFICA.md). */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO, roundEuro, EMT_EUR } = CT;

  const BASE = { metalsRate: D('0.26'), ivcaRate: D('0.002'), lossYears: 4, status: 'da verificare' };
  const RULES = {
    2023: { ...BASE, year: 2023, cryptoRate: D('0.26'), threshold: D(2000), emtRate: null, note: 'Franchigia 2.000 € sulle plusvalenze cripto (se il totale supera 2.000 € si tassa tutto).' },
    2024: { ...BASE, year: 2024, cryptoRate: D('0.26'), threshold: D(2000), emtRate: null, note: 'Franchigia 2.000 € sulle plusvalenze cripto (se il totale supera 2.000 € si tassa tutto).' },
    2025: { ...BASE, year: 2025, cryptoRate: D('0.26'), threshold: null, emtRate: null, note: 'Aliquota 26%, nessuna franchigia (abolita dal 2025).' },
    2026: { ...BASE, year: 2026, cryptoRate: D('0.33'), threshold: null, emtRate: D('0.26'), note: 'Aliquota 33%; 26% per le stablecoin in euro conformi a MiCA (E-money token).' },
  };
  const YEARS = Object.keys(RULES).map(Number);

  function computeBasket(kind, year, rule, ds, incs, carry, useCarry) {
    const isCrypto = kind === 'crypto';
    const r = {
      kind, year, name: isCrypto ? 'Cripto-attività' : 'Oro e metalli preziosi',
      law: isCrypto ? 'art. 67, c. 1, lett. c-sexies TUIR' : 'art. 67, c. 1, lett. c-ter TUIR',
      rate: isCrypto ? rule.cryptoRate : rule.metalsRate,
      nDisposals: ds.length, proceeds: ZERO, costs: ZERO, gains: ZERO, losses: ZERO, net: ZERO, income: ZERO,
      carryUsed: [], carryUnused: [], carryExpired: [], newLoss: ZERO, taxable: ZERO, tax: ZERO, thresholdExempt: false, emtShare: ZERO,
    };
    for (const d of ds) {
      r.proceeds = r.proceeds.plus(d.proceeds); r.costs = r.costs.plus(d.cost);
      if (d.gain.gt(0)) r.gains = r.gains.plus(d.gain); else r.losses = r.losses.minus(d.gain);
    }
    r.income = incs.reduce((s, i) => s.plus(i.value), ZERO);
    r.net = r.gains.minus(r.losses);

    const usable = carry.filter((c) => c.year >= year - rule.lossYears && c.year < year).sort((a, b) => a.year - b.year);
    r.carryExpired = carry.filter((c) => c.year < year - rule.lossYears);

    let cap = r.net.gt(0) ? roundEuro(r.net) : ZERO;
    const exempt = isCrypto && rule.threshold && r.net.plus(r.income).lte(rule.threshold);
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
        const emtNet = ds.filter((d) => EMT_EUR.has(d.asset)).reduce((s, d) => s.plus(d.gain), ZERO);
        const share = emtNet.gt(0) ? (emtNet.lt(cap) ? emtNet : cap) : ZERO;
        r.emtShare = roundEuro(share);
        tax = r.taxable.minus(r.emtShare).times(r.rate).plus(r.emtShare.times(rule.emtRate));
      }
      r.tax = roundEuro(tax);
    }
    if (r.net.lt(0)) r.newLoss = roundEuro(r.net.neg());
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
