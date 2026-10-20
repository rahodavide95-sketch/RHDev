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
   - F24: 4001 IRPEF saldo, 4033 e 4034 acconti IRPEF, 3801 addizionale regionale, 3844 addizionale comunale (saldo). */
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
  const cents = (x) => x.toDecimalPlaces(2);

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
    const addRate = o.addiz === undefined || String(o.addiz).trim() === '' ? D('0.02') : num(o.addiz).div(100);
    // addizionali sulla parte di reddito in piu' (quelle sullo stipendio le trattiene il datore); non dovute se l'IRPEF e' zero
    const addiz = full.netta.isZero() ? ZERO : max0(full.imp.minus(base.imp)).times(addRate);
    const accBase = max0(full.netta.minus(base.netta).minus(ritenute));   // base dell'acconto IRPEF (imposta in piu' dell'anno)
    const r2 = (x) => cents(x);
    return {
      any: occ.length + dir.length > 0 || sanTot.gt(0) || altri.gt(0) || ded.gt(0) || altreDetr.gt(0),
      occ, dir, occLordo, occSpese, occRit, occNet, dirLordo, dirRit, dirDed, dirNet, dedRate, extra, altri, days, ritCU, ded, altreDetr, mode,
      sanTot, detrSan: r2(detrSan), det19: r2(det19), ritenute,
      base: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, r2(v)])), full: Object.fromEntries(Object.entries(full).map(([k, v]) => [k, r2(v)])),
      lordaExtra: r2(full.lorda.minus(base.lorda)), detrAut: r2(full.detAut), netta: r2(full.netta),
      lostBonus: r2(base.somma.minus(full.somma).plus(base.trattInt.minus(full.trattInt))),
      addiz: r2(addiz), addRate, accBase: r2(accBase), irpefDue: r2(max0(diff)), irpefCredit: r2(max0(diff.neg())),
    };
  }

  /** Voci da aggiungere al piano dei pagamenti (stime), per l'anno `Y`. */
  function paymentItems(c, Y, dl) {
    if (!c || !c.any) return [];
    const items = [];
    const est = 'Stima: l\'importo esatto lo calcola il software della dichiarazione (precompilata o commercialista).';
    if (c.irpefDue.gt(0)) items.push({ key: 'irpef', code: '4001', estimate: true, title: 'IRPEF a saldo (stima)',
      why: `${c.extra.gt(0) ? `IRPEF sui redditi extra (${c.extra.toFixed(0)} € netti tra DJ e diritti d'autore)` : 'IRPEF dell\'anno'}${c.lostBonus.gt(0) ? `, più ${c.lostBonus.toFixed(0)} € di bonus in busta paga da restituire perché il reddito sale oltre la soglia` : ''}, meno ritenute (${c.ritenute.toFixed(2)} €)${c.det19.gt(0) ? ` e detrazioni (${c.det19.toFixed(2)} €)` : ''}.`,
      quadro: 'Quadri RC, RL e RP, risultato nel quadro RN', amount: c.irpefDue, due: dl.saldo, note: est });
    if (c.addiz.gt(0)) items.push({ key: 'addiz', code: '3801 / 3844', estimate: true, title: 'Addizionali regionale e comunale sui redditi della musica (stima)',
      why: `Circa il ${c.addRate.times(100).toFixed(1).replace('.', ',')}% dei ${c.extra.toFixed(0)} € netti (dipende da Regione e Comune: 3801 regionale, 3844 comunale).`,
      quadro: 'Quadro RV', amount: c.addiz, due: dl.saldo, note: est });
    if (c.irpefCredit.gt(0)) items.push({ key: 'irpefcred', code: '—', estimate: true, credit: true, title: 'IRPEF a credito (stima): non si paga, ti viene restituita',
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

  CT.others = { compute, paymentItems, irpef, detrAutonomo, detrLavoro, cuneoDetr, irpefParts, num };
  if (typeof module !== 'undefined') module.exports = CT.others;
})();
