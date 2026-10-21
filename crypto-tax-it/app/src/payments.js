/* Cosa pagare per l'anno d'imposta: imposte, codici tributo F24, scadenze e, se la scadenza e' passata, stima del ravvedimento operoso.
   Usato dalla sezione «Cosa pagare» e dal PDF ("Cosa pagare e cosa fare").

   FONTI (controllate in ottobre 2026 su piu' fonti, da confermare con il commercialista: il sito dell'Agenzia non era raggiungibile):
   - 1715: imposta sostitutiva su plusvalenze e altri proventi da cripto-attivita', regime dichiarativo (Ris. AdE 36/E del 26/6/2023).
     Non rateizzabile. Quadro RT, sezione V-A del modello Redditi PF 2026.
   - 1727 saldo, 1728 acconto prima rata, 1729 acconto seconda rata: imposta sul valore delle cripto-attivita' (IVCA, 2 per mille)
     (Ris. AdE 36/E/2023 e 10/E del 6/2/2024). Quadro RW, rigo RW8.
   - 1100: imposta sostitutiva sulle plusvalenze dei redditi diversi di natura finanziaria (oro e metalli, quadro RT sezione II): da confermare.
   - Saldo entro il 30 giugno dell'anno successivo (30 luglio con la maggiorazione dello 0,40%); invio del Redditi PF entro il 31 ottobre
     (se festivo o sabato, il primo giorno lavorativo dopo: 2 novembre 2026); 730 entro il 30 settembre.
   - Ravvedimento (art. 13 D.Lgs. 472/1997 e D.Lgs. 87/2024, violazioni dal 1/9/2024): sanzione per omesso versamento 25%, dimezzata entro
     90 giorni; ridotta a 1/10 entro 30 giorni, 1/9 entro 90, 1/8 entro il termine della dichiarazione dell'anno della violazione,
     1/7 entro quello dell'anno dopo, 1/6 oltre. Interessi al tasso legale giorno per giorno (2% nel 2025, 1,6% dal 2026). */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO, roundEuro } = CT;

  const LEGAL_RATE = { 2023: '0.05', 2024: '0.025', 2025: '0.02', 2026: '0.016' };
  const rateOf = (y) => D(LEGAL_RATE[y] || LEGAL_RATE[Math.max(...Object.keys(LEGAL_RATE).map(Number))]);
  const DAY = 86400000;
  const ms = (day) => Date.parse(day + 'T00:00:00Z');
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const dmy = (day) => (day ? day.split('-').reverse().join('/') : '');
  const itf = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
  const eur = (x) => `${itf.format(Number(D(x).toFixed(2)))} €`;
  // festivita' nazionali a data fissa (la Pasquetta non cade mai vicino alle scadenze fiscali usate qui)
  const HOLIDAYS = new Set(['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26']);
  /** Scadenza che cade di sabato, domenica o festivo: primo giorno lavorativo dopo (es. 31/10/2027 domenica -> 2/11/2027, perche' l'1/11 e' festivo). */
  function workday(day) {
    let t = ms(day);
    while ([0, 6].includes(new Date(t).getUTCDay()) || HOLIDAYS.has(iso(t).slice(5))) t += DAY;
    return iso(t);
  }
  function deadlines(Y) {
    return {
      saldo: workday(`${Y + 1}-06-30`), saldoMagg: workday(`${Y + 1}-07-30`), m730: workday(`${Y + 1}-09-30`),
      filing: workday(`${Y + 1}-10-31`), acconto2: workday(`${Y + 1}-11-30`), filingNext: workday(`${Y + 2}-10-31`), filingNext2: workday(`${Y + 3}-10-31`),
    };
  }
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);

  /** Stima del ravvedimento per un importo non versato alla scadenza `due` e pagato il giorno `pay`. */
  function ravvedimento(amount, due, pay, dl) {
    const days = daysBetween(due, pay);
    if (days <= 0 || !amount.gt(0)) return null;
    let rate, label;
    if (days <= 15) { rate = D('0.25').div(2).times(days).div(15).div(10); label = `${days} ${days === 1 ? 'giorno' : 'giorni'} di ritardo: 1/10 di 1/15 al giorno del 12,5%`; }
    else if (days <= 30) { rate = D('0.25').div(2).div(10); label = 'entro 30 giorni: 1/10 del 12,5%'; }
    else if (days <= 90) { rate = D('0.25').div(2).div(9); label = 'entro 90 giorni: 1/9 del 12,5%'; }
    else if (pay <= dl.filingNext) { rate = D('0.25').div(8); label = `oltre 90 giorni, entro il ${dmy(dl.filingNext)}: 1/8 del 25%`; }
    else if (pay <= dl.filingNext2) { rate = D('0.25').div(7); label = `entro il ${dmy(dl.filingNext2)}: 1/7 del 25%`; }
    else { rate = D('0.25').div(6); label = 'oltre: 1/6 del 25%'; }
    // interessi legali giorno per giorno, con il tasso di ciascun anno
    let interest = ZERO;
    for (let t = ms(due) + DAY; t <= ms(pay); t += DAY) interest = interest.plus(amount.times(rateOf(new Date(t).getUTCFullYear())).div(365));
    const sanction = amount.times(rate).toDecimalPlaces(2);
    interest = interest.toDecimalPlaces(2);
    return { days, rate, label, sanction, interest, total: amount.plus(sanction).plus(interest) };
  }

  /** Acconti gia' versati per l'IVCA, scritti dall'utente (euro, anche con la virgola): null se non indicati o non validi. */
  function advance(state) {
    const raw = state && state.taxpayer && state.taxpayer.advance;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const t = String(raw).trim().replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    return roundEuro(D(t));
  }

  /** IVCA dovuta: come nel quadro RW, una riga per piattaforma con l'imposta arrotondata all'euro, poi la somma (RW8 col. 1). */
  function ivcaTotal(res) {
    const by = new Map();
    for (const r of res.rw) if (r.cls === 'crypto') by.set(r.account, (by.get(r.account) || ZERO).plus(r.ivca || ZERO));
    return [...by.values()].reduce((s, x) => s.plus(roundEuro(x)), ZERO);
  }

  /**
   * Piano dei pagamenti dell'anno `res.year`. `opts.payDay` (AAAA-MM-GG) = giorno in cui si pensa di pagare (per la stima del ravvedimento;
   * di norma oggi). Importi in euro (Decimal).
   */
  function plan(res, state, opts) {
    const Y = res.year, y = res.y;
    const dl = deadlines(Y);
    const payDay = (opts && opts.payDay) || iso(Date.now());
    const items = [];
    const add = (o) => {
      const late = !o.credit && payDay > o.due;   // un credito non scade e non ha ravvedimento
      let r = late ? ravvedimento(o.amount, o.due, payDay, dl) : null;
      // dal 1° al 30 luglio il saldo si paga con lo 0,40% in piu' (conviene rispetto al ravvedimento); dopo, ravvedimento dal 30 giugno
      if (late && o.due === dl.saldo && payDay <= dl.saldoMagg) {
        const extra = o.amount.times('0.004').toDecimalPlaces(2);
        r = { days: daysBetween(o.due, payDay), label: `entro il ${dmy(dl.saldoMagg)} con la maggiorazione dello 0,40%`, sanction: extra, interest: ZERO, total: o.amount.plus(extra), magg: true };
      }
      items.push(Object.assign({ group: 'inv', late, ravv: r, payAmount: r ? r.total : o.amount }, o));
    };
    if (y.crypto.tax.gt(0)) {
      add({ key: 'crypto', code: '1715', title: `Imposta sulle plusvalenze delle cripto (${(y.crypto.rate.times(100)).toFixed(0)}%)`,
        why: `Guadagni netti e premi del ${Y} sulle cripto: imponibile ${eur(y.crypto.taxable)} × ${(y.crypto.rate.times(100)).toFixed(0)}%.`,
        quadro: 'Quadro RT, sezione V-A (cripto-attività)', amount: y.crypto.tax, due: dl.saldo, note: 'In un\'unica soluzione: per questo codice non è prevista la rateazione.' });
    }
    if (y.metals.tax.gt(0)) {
      add({ key: 'metals', code: '1100', codeCheck: true, title: 'Imposta sulle plusvalenze di oro e metalli preziosi (26%)',
        why: `Guadagni netti del ${Y} su oro e metalli: imponibile ${eur(y.metals.taxable)} × 26%.`,
        quadro: 'Quadro RT, sezione II (plusvalenze al 26%)', amount: y.metals.tax, due: dl.saldo, note: 'Codice tributo da far confermare al commercialista.' });
    }
    const ivca = ivcaTotal(res);
    const adv = advance(state);
    const ivcaDue = adv === null ? ivca : ivca.minus(adv);
    if (ivcaDue.gt(0)) {
      add({ key: 'ivca', code: '1727', title: 'Imposta sul valore delle cripto (IVCA, 2 per mille) · saldo',
        why: `0,2% del valore delle cripto che avevi, in proporzione ai giorni in cui le hai tenute nel ${Y}${adv !== null && adv.gt(0) ? `, meno ${eur(adv)} di acconti già versati` : ''}.`,
        quadro: 'Quadro RW, rigo RW8', amount: ivcaDue, due: dl.saldo, note: adv === null ? 'Se nel ' + Y + ' hai già versato acconti per questa imposta vanno tolti (scrivili in «Documenti», riquadro «Completa i dati per i moduli»).' : '' });
    }
    // acconto IVCA per l'anno dopo (metodo storico, regole degli acconti IRPEF: niente sotto 51,65 €, una rata fino a 257,52 €, altrimenti 40% + 60%)
    const acc = [];
    if (ivca.gt(D('51.65'))) {
      if (ivca.gt(D('257.52'))) {
        acc.push({ key: 'acc1', code: '1728', title: `Acconto IVCA ${Y + 1} · prima rata (40%)`, amount: ivca.times('0.4').toDecimalPlaces(2), due: dl.saldo });
        acc.push({ key: 'acc2', code: '1729', title: `Acconto IVCA ${Y + 1} · seconda rata (60%)`, amount: ivca.times('0.6').toDecimalPlaces(2), due: dl.acconto2 });
      } else acc.push({ key: 'acc2', code: '1729', title: `Acconto IVCA ${Y + 1} · rata unica`, amount: ivca, due: dl.acconto2 });
      for (const a of acc) add(Object.assign(a, { advance: true, quadro: 'Quadro RW (acconto dell\'anno dopo)',
        why: `Acconto per l'IVCA del ${Y + 1}, calcolato sull'IVCA del ${Y} (metodo storico). Se nel ${Y + 1} hai venduto tutto o hai molte meno cripto, il commercialista può ridurlo (metodo previsionale).` }));
    }
    // altri redditi inseriti a mano (musica, spese sanitarie): stima dell'IRPEF in piu', in una sezione a parte
    const others = CT.others && state && state.others ? CT.others.compute(state.others) : null;
    if (others) for (const it of CT.others.paymentItems(others, Y, dl)) add(Object.assign({ group: 'other' }, it));
    const sum = (list, k) => list.reduce((s, i) => s.plus(i[k]), ZERO);
    const now = items.filter((i) => !i.credit && (i.late || i.due <= dl.saldo));   // da pagare adesso: scadute o con la scadenza del saldo (30 giugno)
    const balance = items.filter((i) => !i.advance);
    const late = items.filter((i) => i.late);
    const draft = res.groups.blockCount > 0;
    // obblighi di dichiarazione, anche se non c'e' niente da pagare
    const hasRT = y.crypto.nDisposals + y.metals.nDisposals > 0 || y.crypto.income.gt(0) || y.metals.income.gt(0) || y.crypto.carryUsed.length > 0 || y.metals.carryUsed.length > 0;
    const hasRW = res.rw.length > 0;
    return {
      year: Y, payDay, deadlines: dl, items, now, draft, hasRT, hasRW, ivca, ivcaAdvance: adv, ivcaCredit: ivcaDue.lt(0) ? ivcaDue.neg() : ZERO, others,
      invNow: sum(now.filter((i) => i.group === 'inv'), 'payAmount'), otherNow: sum(now.filter((i) => i.group === 'other'), 'payAmount'),
      taxTotal: sum(balance, 'amount'),                          // imposte dell'anno (senza acconti dell'anno dopo e senza sanzioni)
      lateTotal: sum(late, 'payAmount'), lateExtra: late.reduce((s, i) => s.plus(i.ravv ? i.ravv.sanction.plus(i.ravv.interest) : ZERO), ZERO),
      payNow: sum(now, 'payAmount'),                             // da pagare adesso, con l'eventuale ravvedimento
      grandTotal: sum(items, 'payAmount'),
      filingLate: payDay > dl.filing, m730Passed: payDay > dl.m730,
    };
  }

  CT.payments = { plan, ravvedimento, deadlines, workday, advance, ivcaTotal, LEGAL_RATE };
  if (typeof module !== 'undefined') module.exports = CT.payments;
})();
