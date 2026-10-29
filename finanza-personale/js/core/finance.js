/* Calcoli delle simulazioni. Funzioni pure (stessi dati → stesso risultato), in euro
   con decimali: si arrotonda solo quando si mostra il numero.
   Regole fiscali italiane per persone fisiche (2026):
   - plusvalenze e interessi: 26% (titoli di Stato e simili: 12,5%);
   - ETF e fondi: la tassa si paga solo quando si vende, sul guadagno (non ogni anno);
   - imposta di bollo: conto corrente 34,20 €/anno se la giacenza media supera 5.000 €;
     conto deposito e dossier titoli 0,20% annuo sul valore. */

export const TAX_STANDARD = 26;
export const TAX_GOV = 12.5;
export const BOLLO_CC = 34.2;
export const BOLLO_PCT = 0.2;

const clampNum = (v, min, max, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

/** Tasso interno di rendimento per flussi periodici (flows[0] al tempo 0). null se non esiste. */
export function irr(flows, guess = 0.01) {
  if (!flows.length || !flows.some(f => f > 0) || !flows.some(f => f < 0)) return null;
  const npv = r => flows.reduce((a, f, t) => a + f / Math.pow(1 + r, t), 0);
  const dnpv = r => flows.reduce((a, f, t) => a - t * f / Math.pow(1 + r, t + 1), 0);
  let r = guess;
  for (let i = 0; i < 60; i++) {
    const v = npv(r), d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const nr = r - v / d;
    if (!Number.isFinite(nr) || nr <= -0.9999) break;
    if (Math.abs(nr - r) < 1e-12) return nr;
    r = nr;
  }
  // ripiego: bisezione
  let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-10 || hi - lo < 1e-13) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/* ═══ PAC / interesse composto (ETF, fondi) ═══════════════════════════════ */
export function simPAC(input) {
  const p = {
    initial: clampNum(input.initial, 0, 1e10, 0),
    contribution: clampNum(input.contribution, 0, 1e9, 0),
    freq: [1, 2, 4, 12, 26, 52].includes(Number(input.freq)) ? Number(input.freq) : 12,
    years: Math.round(clampNum(input.years, 1, 80, 10)),
    annualReturn: clampNum(input.annualReturn, -50, 50, 6),
    ter: clampNum(input.ter, 0, 10, 0.2),
    inflation: clampNum(input.inflation, -10, 50, 2),
    taxRate: clampNum(input.taxRate, 0, 100, TAX_STANDARD),
    bollo: input.bollo !== false,
    contribGrowth: clampNum(input.contribGrowth, -50, 100, 0),
    entryFee: clampNum(input.entryFee, 0, 1e6, 0),
  };
  const run = R => {
    const gp = Math.pow(1 + R / 100, 1 / p.freq);                          // crescita lorda per periodo
    const fp = Math.pow((1 + R / 100) * (1 - p.ter / 100), 1 / p.freq);    // al netto dei costi del fondo
    let value = p.initial, invested = p.initial, ter = 0, bollo = 0, fees = 0;
    const rows = [{ year: 0, invested, value, gain: 0, tax: 0, net: value, real: value, bollo: 0, ter: 0, contributed: p.initial }];
    const flows = [-p.initial];                                           // un flusso per periodo, per il rendimento effettivo
    for (let y = 1; y <= p.years; y++) {
      const c = p.contribution * Math.pow(1 + p.contribGrowth / 100, y - 1);
      let terY = 0, contributedY = 0;
      for (let j = 0; j < p.freq; j++) {
        const t = (y - 1) * p.freq + j;
        if (c > 0) {
          const fee = Math.min(p.entryFee, c);
          value += c - fee; invested += c; fees += fee; contributedY += c;   // versamento a inizio periodo
          flows[t] = (flows[t] || 0) - c;
        } else if (flows[t] === undefined) flows[t] = 0;
        terY += value * (gp - fp);
        value *= fp;
      }
      const bolloY = p.bollo ? value * BOLLO_PCT / 100 : 0;                // pagato dalla liquidità, non vendendo quote
      bollo += bolloY; ter += terY;
      if (bolloY) { const t = y * p.freq; flows[t] = (flows[t] || 0) - bolloY; }
      const gain = value - invested;
      const tax = Math.max(0, gain) * p.taxRate / 100;
      const net = value - tax - bollo;
      rows.push({ year: y, invested, value, gain, tax, net, real: net / Math.pow(1 + p.inflation / 100, y), bollo: bolloY, ter: terY, contributed: contributedY });
    }
    const last = rows[rows.length - 1];
    const N = p.years * p.freq;
    for (let t = 0; t <= N; t++) if (flows[t] === undefined) flows[t] = 0;
    flows[N] += last.value - last.tax;   // si vende tutto alla fine (il bollo è già tra i flussi)
    return { rows, last, ter, bollo, fees, flows };
  };
  const base = run(p.annualReturn);
  const spread = clampNum(input.spread, 0, 20, 2);
  const low = run(p.annualReturn - spread), high = run(p.annualReturn + spread);
  const last = base.last;
  const deflator = Math.pow(1 + p.inflation / 100, p.years);
  // rendimento annuo netto effettivo (TIR), tenendo conto di quando sono stati versati i soldi
  const pIrr = irr(base.flows, 0.004);
  const netIrr = pIrr == null ? null : Math.pow(1 + pIrr, p.freq) - 1;
  return {
    params: p,
    rows: base.rows,
    low: low.rows, high: high.rows,
    totals: {
      invested: last.invested,
      value: last.value,
      gain: last.gain,
      tax: last.tax,
      bollo: base.bollo,
      ter: base.ter,
      fees: base.fees,
      net: last.net,
      real: last.real,
      netGain: last.net - last.invested,
      multiple: last.invested > 0 ? last.net / last.invested : 0,
      netIrr: netIrr == null ? null : netIrr * 100,
      cashReal: last.invested / deflator,                                 // stessi soldi lasciati fermi
      lowNet: low.last.net, highNet: high.last.net,
    },
  };
}

/* ═══ Conto corrente / conto deposito ═════════════════════════════════════ */
export function simInterest(input) {
  const p = {
    capital: clampNum(input.capital, 0, 1e10, 0),
    rate: clampNum(input.rate, -5, 50, 2),
    months: Math.round(clampNum(input.months, 1, 600, 12)),
    period: Math.round(clampNum(input.period, 0, 600, 12)),       // ogni quanti mesi si liquidano gli interessi (0 = a scadenza)
    compound: input.compound !== false,                           // interessi aggiunti al conto (si sommano)
    taxRate: clampNum(input.taxRate, 0, 100, TAX_STANDARD),
    bollo: ['percent', 'fixed', 'none'].includes(input.bollo) ? input.bollo : 'none',
    monthlyFee: clampNum(input.monthlyFee, 0, 1e5, 0),
    monthlyDeposit: clampNum(input.monthlyDeposit, 0, 1e8, 0),
  };
  const period = p.period <= 0 || p.period >= p.months ? p.months : p.period;
  let balance = p.capital, accrued = 0, paidOut = 0, deposits = 0;
  let gross = 0, tax = 0, bollo = 0, fees = 0, bolloAcc = 0;
  let yearBalSum = 0, yearMonths = 0;
  const rows = [], years = [];
  let yr = { year: 1, gross: 0, tax: 0, bollo: 0, fees: 0, net: 0 };
  const flows = [-p.capital];
  for (let m = 1; m <= p.months; m++) {
    accrued += balance * p.rate / 100 / 12;
    yearBalSum += balance; yearMonths++;
    if (p.bollo === 'percent') bolloAcc += balance * BOLLO_PCT / 100 / 12;
    if (p.monthlyFee) { balance -= p.monthlyFee; fees += p.monthlyFee; yr.fees += p.monthlyFee; }
    const endYear = m % 12 === 0 || m === p.months;
    if (endYear && p.bollo === 'fixed') {
      // 34,20 € all'anno (in proporzione ai mesi) solo se la giacenza media supera 5.000 €
      if (yearBalSum / yearMonths > 5000) bolloAcc += BOLLO_CC * yearMonths / 12;
    }
    if (m % period === 0 || m === p.months) {
      const g = accrued, t = Math.max(0, g) * p.taxRate / 100, n = g - t;
      gross += g; tax += t; accrued = 0;
      yr.gross += g; yr.tax += t;
      const b = bolloAcc; bolloAcc = 0; bollo += b; yr.bollo += b;
      if (p.compound) balance += n - b; else paidOut += n - b;   // senza capitalizzazione il bollo si paga dal conto collegato
      yr.net += n - b;
      rows.push({ month: m, gross: g, tax: t, net: n, bollo: b, balance, paidOut });
    }
    if (endYear) {
      years.push({ ...yr, balance, paidOut, months: yearMonths, avgBalance: yearBalSum / yearMonths });
      yr = { year: yr.year + 1, gross: 0, tax: 0, bollo: 0, fees: 0, net: 0 };
      yearBalSum = 0; yearMonths = 0;
    }
    if (m < p.months && p.monthlyDeposit) { balance += p.monthlyDeposit; deposits += p.monthlyDeposit; flows.push(-p.monthlyDeposit); }
    else if (m < p.months) flows.push(0);
  }
  const final = balance + paidOut;
  flows.push(final);
  const mIrr = irr(flows, 0.002);
  const netGain = final - p.capital - deposits;
  return {
    params: p, rows, years,
    totals: {
      gross, tax, bollo, fees, deposits,
      net: gross - tax,
      netGain,
      final,
      balance, paidOut,
      netYield: mIrr == null ? (p.capital > 0 ? (netGain / p.capital) / (p.months / 12) * 100 : 0) : (Math.pow(1 + mIrr, 12) - 1) * 100,
      netRate: p.rate * (1 - p.taxRate / 100),
    },
  };
}

/* ═══ Mutuo / prestito ════════════════════════════════════════════════════ */
export function simLoan(input) {
  const p = {
    principal: clampNum(input.principal, 0, 1e10, 0),
    tan: clampNum(input.tan, 0, 50, 3),
    months: Math.round(clampNum(input.months, 1, 600, 240)),
    type: input.type === 'italiano' ? 'italiano' : 'francese',
    upfront: clampNum(input.upfront, 0, 1e8, 0),
    monthlyExtra: clampNum(input.monthlyExtra, 0, 1e6, 0),
    prepayments: Array.isArray(input.prepayments) ? input.prepayments
      .map(x => ({ month: Math.round(Number(x.month)), amount: Number(x.amount) || 0, mode: x.mode === 'rata' ? 'rata' : 'durata' }))
      .filter(x => x.month >= 1 && x.amount > 0) : [],
  };
  const i = p.tan / 100 / 12;
  const annuity = (bal, n) => (n <= 0 ? bal : i === 0 ? bal / n : bal * i / (1 - Math.pow(1 + i, -n)));
  let bal = p.principal, rata = annuity(bal, p.months), capShare = p.principal / p.months;
  let plannedEnd = p.months;
  const rows = [];
  let totInterest = 0, totPaid = 0, totPrepaid = 0;
  const flows = [p.principal - p.upfront];
  for (let k = 1; bal > 0.004 && k <= 1200; k++) {
    const interest = bal * i;
    let capital = p.type === 'francese' ? rata - interest : capShare;
    if (capital > bal || k >= plannedEnd) capital = bal;
    const pay = capital + interest;
    bal -= capital;
    totInterest += interest; totPaid += pay;
    let prepaid = 0;
    for (const pp of p.prepayments) {
      if (pp.month === k && bal > 0) {
        const a = Math.min(pp.amount, bal);
        bal -= a; prepaid += a;
        const left = plannedEnd - k;
        if (pp.mode === 'rata' && left > 0) {
          rata = annuity(bal, left); capShare = bal / left;
        } else if (left > 0 && bal > 0) {
          // stessa rata, meno mesi
          if (p.type === 'francese') {
            const n = i === 0 ? Math.ceil(bal / rata) : Math.ceil(-Math.log(1 - bal * i / rata) / Math.log(1 + i));
            plannedEnd = k + (Number.isFinite(n) ? n : left);
          } else {
            plannedEnd = k + Math.ceil(bal / capShare - 1e-9);
          }
        }
      }
    }
    totPrepaid += prepaid;
    rows.push({ k, rata: pay, interest, capital, prepaid, extra: p.monthlyExtra, balance: Math.max(0, bal) });
    flows.push(-(pay + p.monthlyExtra + prepaid));
  }
  const years = [];
  rows.forEach(r => {
    const y = Math.ceil(r.k / 12);
    const Y = years[y - 1] || (years[y - 1] = { year: y, paid: 0, interest: 0, capital: 0, prepaid: 0, balance: 0 });
    Y.paid += r.rata; Y.interest += r.interest; Y.capital += r.capital; Y.prepaid += r.prepaid; Y.balance = r.balance;
  });
  const mIrr = irr(flows, i || 0.003);
  return {
    params: p, rows, years,
    totals: {
      firstRata: rows[0]?.rata || 0,
      lastRata: rows[rows.length - 1]?.rata || 0,
      interest: totInterest,
      paid: totPaid + totPrepaid + p.upfront + p.monthlyExtra * rows.length,
      prepaid: totPrepaid,
      months: rows.length,
      taeg: mIrr == null ? null : (Math.pow(1 + mIrr, 12) - 1) * 100,
      costRatio: p.principal > 0 ? (totInterest + p.upfront + p.monthlyExtra * rows.length) / p.principal * 100 : 0,
    },
  };
}

/** Debito residuo di un piano dopo `paidCount` rate (per i conti "mutuo/prestito"). */
export function loanResidual(plan, paidCount) {
  if (!plan || !(plan.principal > 0)) return 0;
  if (paidCount <= 0) return plan.principal;
  const r = simLoan({ principal: plan.principal, tan: plan.tan, months: plan.months, type: plan.type });
  if (paidCount >= r.rows.length) return 0;
  return r.rows[paidCount - 1].balance;
}

/* ═══ Indipendenza finanziaria (FIRE) ═════════════════════════════════════ */
export function simFIRE(input) {
  const p = {
    annualExpenses: clampNum(input.annualExpenses, 0, 1e9, 24000),
    assets: clampNum(input.assets, 0, 1e11, 0),
    monthlySaving: clampNum(input.monthlySaving, 0, 1e8, 500),
    realReturn: clampNum(input.realReturn, -20, 30, 4),
    swr: clampNum(input.swr, 0.5, 15, 3.5),
    savingGrowth: clampNum(input.savingGrowth, -50, 50, 0),
    age: input.age ? Math.round(clampNum(input.age, 0, 120, 0)) : null,
  };
  const target = p.annualExpenses / (p.swr / 100);
  const run = saving => {
    const g = Math.pow(1 + p.realReturn / 100, 1 / 12);
    let a = p.assets, months = 0, s = saving;
    const series = [{ year: 0, assets: a }];
    while (a < target && months < 100 * 12) {
      a = a * g + s; months++;
      if (months % 12 === 0) { series.push({ year: months / 12, assets: a }); s *= 1 + p.savingGrowth / 100; }
    }
    if (months % 12 !== 0) series.push({ year: months / 12, assets: a });
    return { months: a >= target ? months : null, series };
  };
  const base = run(p.monthlySaving);
  const sens = [100, 250, 500].map(extra => ({ extra, months: run(p.monthlySaving + extra).months }));
  return {
    params: p,
    target,
    progress: target > 0 ? Math.min(1, p.assets / target) : 0,
    months: base.months,
    years: base.months == null ? null : base.months / 12,
    fiAge: base.months != null && p.age != null ? p.age + base.months / 12 : null,
    series: base.series,
    sensitivity: sens,
    monthlyIncomeAtFI: target * p.swr / 100 / 12,
  };
}

/* ═══ Inflazione ══════════════════════════════════════════════════════════ */
export function simInflation(input) {
  const amount = clampNum(input.amount, 0, 1e11, 1000);
  const years = Math.round(clampNum(input.years, 1, 100, 10));
  const rate = clampNum(input.rate, -10, 100, 2);
  const nominalReturn = clampNum(input.nominalReturn, -50, 100, 0);
  const rows = [];
  for (let y = 0; y <= years; y++) {
    const f = Math.pow(1 + rate / 100, y);
    rows.push({ year: y, futureCost: amount * f, purchasingPower: amount / f, invested: amount * Math.pow(1 + nominalReturn / 100, y) / f });
  }
  const last = rows[rows.length - 1];
  return {
    params: { amount, years, rate, nominalReturn }, rows,
    totals: {
      futureCost: last.futureCost,
      purchasingPower: last.purchasingPower,
      lossPct: (1 - last.purchasingPower / amount) * 100,
      realReturn: ((1 + nominalReturn / 100) / (1 + rate / 100) - 1) * 100,
      investedReal: last.invested,
    },
  };
}

/* ═══ Quanto costa davvero una spesa fissa ═════════════════════════════════ */
export function simTrueCost(input) {
  const monthly = clampNum(input.monthly, 0, 1e8, 15);
  const years = Math.round(clampNum(input.years, 1, 80, 10));
  const ret = clampNum(input.annualReturn, -20, 30, 5);
  const taxRate = clampNum(input.taxRate, 0, 100, TAX_STANDARD);
  const g = Math.pow(1 + ret / 100, 1 / 12);
  let v = 0;
  const rows = [];
  for (let m = 1; m <= years * 12; m++) {
    v = (v + monthly) * g;
    if (m % 12 === 0) {
      const spent = monthly * m;
      rows.push({ year: m / 12, spent, value: v, net: v - Math.max(0, v - spent) * taxRate / 100 });
    }
  }
  const last = rows[rows.length - 1];
  return { params: { monthly, years, annualReturn: ret, taxRate }, rows, totals: { spent: last.spent, invested: last.net, yearly: monthly * 12 } };
}

/* ═══ Obbligazione / BTP: rendimento a scadenza ═══════════════════════════ */
export function simBond(input) {
  const price = clampNum(input.price, 1, 1000, 100);         // prezzo per 100 di nominale
  const coupon = clampNum(input.coupon, 0, 50, 3);            // cedola annua %
  const freq = Number(input.freq) === 1 ? 1 : 2;
  const years = clampNum(input.years, 0.1, 100, 5);
  const taxRate = clampNum(input.taxRate, 0, 100, TAX_GOV);
  const amount = clampNum(input.amount, 0, 1e10, 10000);
  const feePct = clampNum(input.feePct, 0, 10, 0);
  const n = Math.max(1, Math.round(years * freq));
  const cost = price * (1 + feePct / 100);
  const c = coupon / freq;
  const gross = [-cost], net = [-cost];
  for (let k = 1; k <= n; k++) {
    const last = k === n;
    gross.push(c + (last ? 100 : 0));
    const gain = last ? Math.max(0, 100 - price) : 0;         // la tassa sullo scarto si paga a scadenza
    net.push(c * (1 - taxRate / 100) + (last ? 100 - gain * taxRate / 100 : 0));
  }
  const ig = irr(gross, 0.01), inet = irr(net, 0.01);
  const nominal = amount / cost * 100;
  return {
    params: { price, coupon, freq, years, taxRate, amount, feePct },
    totals: {
      grossYtm: ig == null ? null : (Math.pow(1 + ig, freq) - 1) * 100,
      netYtm: inet == null ? null : (Math.pow(1 + inet, freq) - 1) * 100,
      nominal,
      couponNetYear: nominal * coupon / 100 * (1 - taxRate / 100),
      finalNet: nominal / 100 * net.slice(1).reduce((a, b) => a + b, 0),
      profitNet: nominal / 100 * net.slice(1).reduce((a, b) => a + b, 0) - amount,
      periods: n,
    },
  };
}
