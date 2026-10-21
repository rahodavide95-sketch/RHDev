/* Altri redditi e detrazioni che non vengono dai file (musica, spese sanitarie): dove si scrivono nel modello Redditi PF e stima
   dell'IRPEF in piu' da versare. E' una STIMA: l'IRPEF esatta dipende da tutti i redditi, dalle detrazioni e dalle addizionali del
   proprio Comune e della propria Regione, e la calcola il software di compilazione (precompilata o commercialista).

   REGOLE (anno d'imposta 2025, controllate in ottobre 2026 su piu' fonti):
   - Lavoro autonomo occasionale (es. serate da DJ con ricevuta di prestazione occasionale): redditi diversi, art. 67, c. 1, lett. l) TUIR.
     Quadro RL, rigo RL15: col. 1 compensi lordi, col. 2 spese documentate e inerenti. Ritenuta del 20% del committente a scomputo.
     Nella Certificazione Unica: causale M.
   - Diritti d'autore (SIAE, edizioni, royalties da autore o compositore): art. 53, c. 2, lett. b) TUIR. Quadro RL, sezione III, rigo RL25.
     Deduzione forfettaria delle spese del 25% (40% se l'autore ha meno di 35 anni). Ritenuta del 20% sulla parte imponibile.
     Nella Certificazione Unica: causale B.
   - Spese sanitarie: quadro RP, rigo RP1. Detrazione del 19% sulla parte che supera 129,11 euro.
   - IRPEF 2025: 23% fino a 28.000 euro, 35% fino a 50.000, 43% oltre (L. 207/2024). Se non ci sono redditi di lavoro dipendente o
     pensione, spetta la detrazione per redditi di lavoro autonomo e diversi (art. 13, c. 5 TUIR): 1.265 euro fino a 5.500 euro di reddito,
     poi decrescente fino a 55.000.
   - Lavoro dipendente (quadro RC, dati della Certificazione Unica del datore di lavoro). Detrazione art. 13, c. 1 TUIR (2025): 1.955 euro
     fino a 15.000 euro di reddito complessivo; 1.910 + 1.190 x (28.000 - R) / 13.000 fino a 28.000; 1.910 x (50.000 - R) / 22.000 fino
     a 50.000; +65 euro tra 25.000 e 35.000; in proporzione ai giorni di lavoro. Taglio del cuneo (L. 207/2024, art. 1, c. 4-9): somma esente
     del 7,1% / 5,3% / 4,8% del reddito di lavoro (fino a 8.500 / 15.000 / 20.000) se il reddito complessivo non supera 20.000; ulteriore
     detrazione di 1.000 euro tra 20.000 e 32.000, decrescente fino a 40.000. Trattamento integrativo di 1.200 euro fino a 15.000 euro.
     Il datore di lavoro le applica in busta paga guardando solo lo stipendio: se altri redditi fanno salire il reddito complessivo,
     in dichiarazione una parte si restituisce. Per questo la stima confronta l'IRPEF "solo stipendio" con quella "stipendio + altri redditi".
   - Addizionali (quadro RV): si calcolano sul reddito imponibile con l'aliquota della Regione (RV2) e del Comune (RV10). Quelle
     trattenute dal datore di lavoro sono nella CU: punto 22 la regionale (rigo RV3), punti 26 e 27 la comunale del 2025 (rigo RV11).
     Acconto dell'addizionale comunale per l'anno dopo: 30%. L'utente puo' scrivere l'importo dovuto; se manca si stima con
     l'aliquota media della sua CU (trattenuta / reddito) o, senza CU, con un'aliquota media.
   - Fino a 12 euro per ciascun tributo non si versa e non si rimborsa (art. 1, c. 137, L. 266/2005).
   - F24: 4001 IRPEF saldo, 4033 e 4034 acconti IRPEF, 3801 addizionale regionale, 3844 addizionale comunale (saldo), 3843 acconto
     addizionale comunale. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO } = CT;

  const num = (v) => {
    const t = String(v === undefined || v === null ? '' : v).trim().replace(/\s/g, '').replace(/€/g, '');
    if (!t) return ZERO;
    // 1.234,56 · 1234,56 · 1234.56 · 2.000 (punto delle migliaia, come si scrive in Italia)
    const c = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
    return /^-?\d+(\.\d+)?$/.test(c) ? D(c).abs() : ZERO;
  };
  const max0 = (x) => (x.gt(0) ? x : ZERO);
  const itf = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (x) => `${itf.format(Number(D(x).toFixed(2)))} €`;
  const cents = (x) => x.toDecimalPlaces(2);
  const pct = (r) => `${r.times(100).toDecimalPlaces(2).toString().replace('.', ',')}%`;
  const opt = (v) => (String(v === undefined || v === null ? '' : v).trim() === '' ? null : num(v));
  // aliquote medie usate solo se l'utente non scrive l'importo e non ha la CU dello stipendio (variano per Regione e Comune)
  const DEF_RATE = { reg: D('0.015'), com: D('0.008') };
  const MIN_VERS = D(12);

  function irpef(R) {
    let t = ZERO;
    const band = (from, to, rate) => { if (R.gt(from)) t = t.plus((to === null || R.lt(to) ? R : D(to)).minus(from).times(rate)); };
    band(0, 28000, '0.23'); band(28000, 50000, '0.35'); band(50000, null, '0.43');
    return t;
  }
  /** Detrazione per redditi di lavoro autonomo e diversi (art. 13, c. 5 TUIR), quando non ci sono lavoro dipendente o pensione. */
  function detrAutonomo(R) {
    if (R.lte(5500)) return D(1265);
    if (R.lte(28000)) return D(500).plus(D(765).times(D(28000).minus(R)).div(22500));
    if (R.lte(55000)) return D(500).times(D(55000).minus(R)).div(27000);
    return ZERO;
  }

  function detrLavoro(R) {
    let d = ZERO;
    if (R.lte(15000)) d = D(1955);
    else if (R.lte(28000)) d = D(1910).plus(D(1190).times(D(28000).minus(R)).div(13000));
    else if (R.lte(50000)) d = D(1910).times(D(50000).minus(R)).div(22000);
    if (R.gt(25000) && R.lte(35000)) d = d.plus(65);
    return d;
  }
  function cuneoDetr(R) {
    if (R.gt(20000) && R.lte(32000)) return D(1000);
    if (R.gt(32000) && R.lte(40000)) return D(1000).times(D(40000).minus(R)).div(8000);
    return ZERO;
  }
  const sommaPct = (lav) => (lav.lte(8500) ? D('0.071') : lav.lte(15000) ? D('0.053') : lav.lte(20000) ? D('0.048') : ZERO);

  /** IRPEF dell'anno per un insieme di redditi. lav = reddito di lavoro dipendente, extra = altri redditi netti (musica), ded = oneri deducibili. */
  function irpefParts({ lav, days, extra, ded, det19 }) {
    const RC = lav.plus(extra);
    const imp = max0(RC.minus(ded));
    const lorda = irpef(imp);
    const p = lav.gt(0) ? D(days).div(365) : ZERO;
    const detLav = lav.gt(0) ? detrLavoro(RC).times(p) : ZERO;
    const detAut = lav.isZero() && extra.gt(0) ? detrAutonomo(RC) : ZERO;          // non cumulabile con quella da lavoro dipendente
    const detCuneo = lav.gt(0) ? cuneoDetr(RC).times(p) : ZERO;
    const netta = max0(lorda.minus(detLav).minus(detAut).minus(detCuneo).minus(det19));
    const somma = lav.gt(0) && RC.lte(20000) ? lav.times(sommaPct(lav)) : ZERO;    // non tassata, pagata in busta paga
    const trattInt = lav.gt(0) && RC.lte(15000) && irpef(lav).gt(detrLavoro(RC).minus(75).times(p)) ? D(1200).times(p) : ZERO;
    return { RC, imp, lorda, detLav, detAut, detCuneo, det19, netta, somma, trattInt };
  }

  function compute(o) {
    o = o || {};
    const occ = (o.occ || []).map((r) => ({ ...r, lordo: num(r.lordo), rit: num(r.rit), spese: num(r.spese) }));
    const dir = (o.dir || []).map((r) => ({ ...r, lordo: num(r.lordo), rit: num(r.rit) }));
    const sum = (l, k) => l.reduce((s, r) => s.plus(r[k]), ZERO);
    const occLordo = sum(occ, 'lordo'), occSpese = sum(occ, 'spese'), occRit = sum(occ, 'rit');
    const dirLordo = sum(dir, 'lordo'), dirRit = sum(dir, 'rit');
    const dedRate = o.under35 ? D('0.40') : D('0.25');
    const dirDed = dirLordo.times(dedRate);
    const occNet = max0(occLordo.minus(occSpese)), dirNet = dirLordo.minus(dirDed);
    const extra = occNet.plus(dirNet);
    const altri = num(o.altri);                                   // reddito di lavoro dipendente o pensione (CU)
    const days = Math.min(365, Math.max(0, parseInt(o.giorni, 10) || 365));
    const ritCU = String(o.ritCU || '').trim() === '' ? null : num(o.ritCU);
    const ded = num(o.deducibili), altreDetr = num(o.altreDetr);
    const sanTot = num(o.san);
    const detrSan = max0(sanTot.minus('129.11')).times('0.19');
    const det19 = detrSan.plus(altreDetr);
    const ritenute = occRit.plus(dirRit);
    // con lo stipendio: "prima" = come l'ha calcolata il datore di lavoro (solo stipendio); "dopo" = in dichiarazione, con tutto
    const base = irpefParts({ lav: altri, days, extra: ZERO, ded: ZERO, det19: ZERO });
    const full = irpefParts({ lav: altri, days, extra, ded, det19 });
    let diff, mode;
    if (altri.gt(0) && ritCU === null) {
      mode = 'differenza';
      diff = full.netta.minus(base.netta).plus(base.somma.minus(full.somma)).plus(base.trattInt.minus(full.trattInt)).minus(ritenute);
    } else {
      mode = 'completo';   // senza stipendio, o con le ritenute della CU: si confronta l'imposta con tutte le ritenute
      diff = full.netta.minus(ritCU || ZERO).minus(ritenute).plus(base.somma.minus(full.somma)).plus(base.trattInt.minus(full.trattInt));
    }
    // addizionali: dovuta (scritta dall'utente o stimata) meno quella trattenuta in busta paga; non dovute se l'IRPEF e' zero
    const addOne = (kind, man, trat) => {
      const src = man !== null ? 'man' : trat !== null && altri.gt(0) && base.imp.gt(0) ? 'cu' : 'def';
      const rate = src === 'man' ? (full.imp.gt(0) ? man.div(full.imp) : ZERO) : src === 'cu' ? trat.div(base.imp) : DEF_RATE[kind];
      const dovuta = src === 'man' ? man : full.netta.isZero() ? ZERO : full.imp.times(rate);
      // senza la CU si suppone, come per l'IRPEF, che il datore abbia trattenuto il giusto sullo stipendio
      const guess = trat === null && altri.gt(0) && !base.netta.isZero();
      const tratt = trat !== null ? trat : guess ? base.imp.times(rate) : ZERO;
      return { man, trat, src, rate, guess, dovuta: cents(dovuta), tratt: cents(tratt), saldo: cents(dovuta).minus(cents(tratt)) };
    };
    const reg = addOne('reg', opt(o.addRegMan), opt(o.addRegTr));
    const com = addOne('com', opt(o.addComMan), opt(o.addComTr));
    // acconto dell'addizionale comunale per l'anno dopo (30%): quello sullo stipendio lo trattiene il datore (CU punto 29)
    com.acconto = full.netta.isZero() ? ZERO : cents(max0(full.imp.minus(altri.gt(0) ? base.imp : ZERO)).times(com.rate).times('0.3'));
    const addiz = max0(reg.saldo).plus(max0(com.saldo));
    const accBase = max0(full.netta.minus(base.netta).minus(ritenute));   // base dell'acconto IRPEF (imposta in piu' dell'anno)
    const r2 = (x) => cents(x);
    return {
      any: occ.length + dir.length > 0 || sanTot.gt(0) || altri.gt(0) || ded.gt(0) || altreDetr.gt(0) || reg.man !== null || com.man !== null,
      occ, dir, occLordo, occSpese, occRit, occNet, dirLordo, dirRit, dirDed, dirNet, dedRate, extra, altri, days, ritCU, ded, altreDetr, mode,
      sanTot, detrSan: r2(detrSan), det19: r2(det19), ritenute,
      base: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, r2(v)])), full: Object.fromEntries(Object.entries(full).map(([k, v]) => [k, r2(v)])),
      lordaExtra: r2(full.lorda.minus(base.lorda)), detrAut: r2(full.detAut), netta: r2(full.netta),
      lostBonus: r2(base.somma.minus(full.somma).plus(base.trattInt.minus(full.trattInt))),
      addiz: r2(addiz), reg, com, accBase: r2(accBase), irpefDue: r2(max0(diff)), irpefCredit: r2(max0(diff.neg())),
    };
  }

  /** Dove si scrive ogni voce nel modello Redditi PF: [rigo, cosa, importo (Decimal) o testo]. */
  function where(c) {
    const rows = [];
    if (c.altri.gt(0)) rows.push(['RC1 col. 3', 'Reddito di lavoro dipendente o pensione (col. 1: codice 2 lavoro dipendente, 3 pensione)', c.altri], ['RC6 col. 1', 'Giorni di lavoro dipendente', String(c.days)]);
    if (c.ritCU) rows.push(['RC10 col. 1', 'Ritenute IRPEF della CU', c.ritCU]);
    if (c.occ.length) rows.push(['RL15 col. 1', 'Compensi lordi da lavoro occasionale', c.occLordo], ['RL15 col. 2', 'Spese documentate e inerenti', c.occSpese], ['Ritenute sez. II-A', 'Ritenute subite sui compensi occasionali', c.occRit]);
    if (c.dir.length) rows.push(['RL25', 'Proventi lordi da diritti d\'autore', c.dirLordo], ['Riepilogo sez. III', `Deduzione forfettaria ${c.dedRate.times(100).toFixed(0)}% (la calcola il software)`, c.dirDed], ['Ritenute sez. III', 'Ritenute subite sui diritti d\'autore', c.dirRit]);
    if (c.sanTot.gt(0)) rows.push(['RP1', 'Spese sanitarie', c.sanTot]);
    if (c.altreDetr.gt(0)) rows.push(['Quadro RP', 'Altre detrazioni (sezioni I e III)', c.altreDetr]);
    if (c.ded.gt(0)) rows.push(['Quadro RP sez. II', 'Oneri deducibili', c.ded]);
    if (c.reg.man !== null) rows.push(['RV2', 'Addizionale regionale dovuta', c.reg.man]);
    if (c.reg.trat !== null) rows.push(['RV3', 'Addizionale regionale trattenuta dal datore di lavoro (CU punto 22)', c.reg.trat]);
    if (c.com.man !== null) rows.push(['RV10', 'Addizionale comunale dovuta', c.com.man]);
    if (c.com.trat !== null) rows.push(['RV11', 'Addizionale comunale trattenuta dal datore di lavoro (CU punti 26 e 27)', c.com.trat]);
    return rows;
  }
  /** Passaggi della stima: [voce, importo con segno]. */
  function steps(c) {
    const F = c.full, B = c.base, neg = (x) => x.neg();
    return [
      ['Reddito complessivo', F.RC],
      c.ded.gt(0) ? ['Reddito imponibile (dopo gli oneri deducibili)', F.imp] : null,
      ['IRPEF lorda (23% / 35% / 43%)', F.lorda],
      F.detLav.gt(0) ? ['Detrazione per lavoro dipendente', neg(F.detLav)] : null,
      F.detCuneo.gt(0) ? ['Ulteriore detrazione «taglio del cuneo»', neg(F.detCuneo)] : null,
      F.detAut.gt(0) ? ['Detrazione per redditi di lavoro autonomo e occasionali', neg(F.detAut)] : null,
      c.det19.gt(0) ? ['Detrazioni per spese (sanitarie e altre)', neg(c.det19)] : null,
      ['IRPEF netta dell\'anno', F.netta],
      c.mode === 'differenza' ? ['Già trattenuta in busta paga (IRPEF calcolata dal datore sul solo stipendio)', neg(B.netta)] : c.ritCU ? ['Ritenute IRPEF della CU', neg(c.ritCU)] : null,
      c.ritenute.gt(0) ? ['Ritenute su serate e diritti d\'autore', neg(c.ritenute)] : null,
      c.lostBonus.gt(0) ? ['Bonus in busta paga da restituire (somma esente del cuneo o trattamento integrativo)', c.lostBonus] : null,
      c.irpefDue.gt(0) ? [`IRPEF da versare (stima)${c.irpefDue.lte(MIN_VERS) ? ': fino a 12 € non si versa' : ''}`, c.irpefDue]
        : [`IRPEF a credito (stima${c.irpefCredit.gt(0) && c.irpefCredit.lte(MIN_VERS) ? ': fino a 12 € non si rimborsa' : ': rimborso o compensazione'})`, c.irpefCredit],
    ].filter(Boolean);
  }
  /** Passaggi delle addizionali regionale e comunale: [voce, importo con segno]. */
  function addizSteps(c) {
    const out = [];
    for (const [a, name, pts] of [[c.reg, 'regionale', 'punto 22'], [c.com, 'comunale', 'punti 26 e 27']]) {
      const how = a.src === 'man' ? 'scritta da te' : a.src === 'cu' ? `stima con l'aliquota della tua CU: ${pct(a.rate)}` : `stima con un'aliquota media: ${pct(a.rate)}`;
      out.push([`Addizionale ${name} dovuta (${how})`, a.dovuta]);
      if (a.tratt.gt(0)) out.push([a.guess ? `Già trattenuta in busta paga (stima: scrivi la CU, ${pts})` : `Già trattenuta in busta paga (CU, ${pts})`, a.tratt.neg()]);
      const s = a.saldo;
      out.push(s.lt(0) ? [`Addizionale ${name} a credito${s.neg().lte(MIN_VERS) ? ': fino a 12 € non si rimborsa' : ''}`, s.neg()]
        : [`Addizionale ${name} da versare${s.gt(0) && s.lte(MIN_VERS) ? ': fino a 12 € non si versa' : ''}`, s]);
    }
    if (c.com.acconto.gt(0)) out.push([`Acconto addizionale comunale dell'anno dopo (30%)${c.com.acconto.lte(MIN_VERS) ? ': fino a 12 € non si versa' : ''}`, c.com.acconto]);
    return out;
  }

  /** Voci da aggiungere al piano dei pagamenti (stime), per l'anno `Y`. */
  function paymentItems(c, Y, dl) {
    if (!c || !c.any) return [];
    const items = [];
    const est = 'Stima: l\'importo esatto lo calcola il software della dichiarazione (precompilata o commercialista).';
    if (c.irpefDue.gt(MIN_VERS)) items.push({ key: 'irpef', code: '4001', estimate: true, title: 'IRPEF a saldo (stima)',
      why: `${c.extra.gt(0) ? `IRPEF sui redditi extra (${eur(c.extra)} netti tra DJ e diritti d'autore)` : 'IRPEF dell\'anno'}${c.lostBonus.gt(0) ? `, più ${eur(c.lostBonus)} di bonus in busta paga da restituire perché il reddito sale oltre la soglia` : ''}, meno ritenute (${eur(c.ritenute)})${c.det19.gt(0) ? ` e detrazioni (${eur(c.det19)})` : ''}.`,
      quadro: 'Quadri RC, RL e RP, risultato nel quadro RN', amount: c.irpefDue, due: dl.saldo, note: est });
    const why = (a) => `${a.src === 'man' ? `Dovuta ${eur(a.dovuta)} (importo scritto da te)` : `Dovuta circa ${eur(a.dovuta)} (${pct(a.rate)} di ${eur(c.full.imp)} di reddito imponibile)`}${a.tratt.gt(0) ? `, meno ${eur(a.tratt)} già trattenuti in busta paga${a.guess ? ' (stima: scrivi i dati della CU)' : ''}` : ''}.`;
    if (c.reg.saldo.gt(MIN_VERS)) items.push({ key: 'addreg', code: '3801', estimate: c.reg.src !== 'man', title: `Addizionale regionale all'IRPEF · saldo${c.reg.src !== 'man' ? ' (stima)' : ''}`,
      why: why(c.reg), quadro: 'Quadro RV, righi RV2-RV4', amount: c.reg.saldo, due: dl.saldo, note: c.reg.src !== 'man' ? est : '' });
    if (c.com.saldo.gt(MIN_VERS)) items.push({ key: 'addcom', code: '3844', estimate: c.com.src !== 'man', title: `Addizionale comunale all'IRPEF · saldo${c.com.src !== 'man' ? ' (stima)' : ''}`,
      why: why(c.com), quadro: 'Quadro RV, righi RV10-RV12', amount: c.com.saldo, due: dl.saldo, note: c.com.src !== 'man' ? est : '' });
    if (c.com.acconto.gt(MIN_VERS)) items.push({ key: 'addcomacc', code: '3843', estimate: true, advance: true, title: `Acconto addizionale comunale ${Y + 1} (30%, stima)`,
      why: `30% dell'addizionale comunale sulla parte di reddito su cui il datore di lavoro non l'ha trattenuta.`, quadro: 'Quadro RV, rigo RV17', amount: c.com.acconto, due: dl.saldo, note: est });
    if (c.irpefCredit.gt(MIN_VERS)) items.push({ key: 'irpefcred', code: '—', estimate: true, credit: true, title: 'IRPEF a credito (stima): non si paga, ti viene restituita',
      why: 'Le ritenute e le detrazioni superano l\'imposta: il credito si chiede a rimborso o si usa in compensazione nell\'F24.', quadro: 'Quadro RX', amount: ZERO, creditAmount: c.irpefCredit, due: dl.saldo });
    // acconto IRPEF dell'anno dopo: 100% dell'imposta a debito (metodo storico), niente fino a 51,65 €, una rata fino a 257,52 €
    if (c.accBase.gt('51.65')) {
      const a = c.accBase;
      const list = a.gt('257.52') ? [['4033', 'prima rata (40%)', a.times('0.4'), dl.saldo], ['4034', 'seconda rata (60%)', a.times('0.6'), dl.acconto2]] : [['4034', 'rata unica', a, dl.acconto2]];
      for (const [code, what, amount, due] of list) items.push({ key: 'irpefacc' + code, code, estimate: true, advance: true, title: `Acconto IRPEF ${Y + 1} · ${what} (stima)`,
        why: `Anticipo dell'IRPEF ${Y + 1}, calcolato su quella in più del ${Y}. Se nel ${Y + 1} guadagni molto meno con la musica il commercialista può ridurlo.`, quadro: 'Quadro RN', amount: amount.toDecimalPlaces(2), due });
    }
    return items;
  }

  CT.others = { compute, paymentItems, where, steps, addizSteps, irpef, detrAutonomo, detrLavoro, cuneoDetr, irpefParts, num };
  if (typeof module !== 'undefined') module.exports = CT.others;
})();
