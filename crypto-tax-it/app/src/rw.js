/* Prospetto per il monitoraggio (quadro RW) e IVCA: BOZZA DI LAVORO.
   Per ogni coppia (custode, asset): giorni di detenzione, valore iniziale/finale, IVCA indicativa.
   Mappatura su righi/codici e criterio di valorizzazione da verificare sulle istruzioni ufficiali dell'anno. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO } = CT;
  const DUST = D('1e-9');

  function addDays(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function countDays(intervals, start, end) {
    const held = new Set();
    for (const [a, b] of intervals) {
      let x = a < start ? start : a; const stop = b > end ? end : b;
      while (x <= stop) { held.add(x); x = addDays(x, 1); }
    }
    return held.size;
  }

  function computeRW(engine, year, rule) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const series = new Map();
    for (const m of engine.movements) {
      if (m.account === '(rete)') continue;
      const k = m.account + '\u0000' + m.asset;
      if (!series.has(k)) series.set(k, []);
      series.get(k).push(m);
    }
    const rows = [];
    for (const [k, moves] of [...series].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const [account, asset] = k.split('\u0000');
      moves.sort((a, b) => a.ts - b.ts);
      const cls = engine.cls(asset);
      let bal = ZERO, curStart = null, firstIn = null, lastOut = null;
      const intervals = [];
      for (const m of moves) {
        if (m.day > end) break;
        const before = bal; bal = bal.plus(m.delta);
        if (before.lte(DUST) && bal.gt(DUST)) { curStart = m.day; if (m.day >= start && firstIn === null) firstIn = { day: m.day, qty: bal, eur: m.eur }; }
        else if (before.gt(DUST) && bal.lte(DUST)) { intervals.push([curStart || m.day, m.day]); curStart = null; if (m.day >= start) lastOut = { day: m.day, qty: before, eur: m.eur }; }
      }
      // valore di un ingresso/uscita: importo dell'operazione se noto, altrimenti prezzo di mercato del giorno
      const notes = [];
      const valueAt = (pt) => {
        if (!pt) return null;
        if (pt.eur !== null && pt.eur !== undefined) return pt.eur;
        const p = engine.prices.get(asset, pt.day);
        if (p) return p.price.times(pt.qty);
        need(engine, asset, pt.day, account, notes, `prezzo del ${pt.day.split('-').reverse().join('/')}`);
        return null;
      };
      if (curStart !== null) intervals.push([curStart, end]);
      const qtyStart = moves.filter((m) => m.day < start).reduce((s, m) => s.plus(m.delta), ZERO);
      const qtyEnd = moves.filter((m) => m.day <= end).reduce((s, m) => s.plus(m.delta), ZERO);
      const days = countDays(intervals, start, end);
      if (days === 0 && qtyStart.lte(DUST)) continue;

      let v0, v1;
      if (qtyStart.gt(DUST)) {
        const p = engine.prices.get(asset, start);
        if (p) v0 = qtyStart.times(p.price);
        else { v0 = null; need(engine, asset, start, account, notes, 'prezzo al 1/1'); }
      } else v0 = valueAt(firstIn);
      if (qtyEnd.gt(DUST)) {
        const p = engine.prices.get(asset, end);
        if (p) v1 = qtyEnd.times(p.price);
        else { v1 = null; need(engine, asset, end, account, notes, 'prezzo al 31/12'); }
      } else v1 = valueAt(lastOut);
      let ivca = ZERO;
      if (cls === 'crypto' && v1 !== null && v1 !== undefined) ivca = rule.ivcaRate.times(v1).times(days).div(365);
      if (cls === 'metal') notes.push('metallo: IVCA/IVAFE non calcolate (verificare con il commercialista)');
      if (account === CT.WALLET || account.startsWith('Wallet')) notes.push('wallet personale: verificare obbligo e codice RW');
      rows.push({ account, asset, cls, qtyStart, qtyEnd, days, valueInitial: v0, valueFinal: v1, ivca, notes });
    }
    return rows;
  }

  function need(engine, asset, day, account, notes, label) {
    engine.missingPrices.set(`${asset.toUpperCase()}|${day}`, { symbol: asset.toUpperCase(), day });
    engine.issue('block', 'missing_price', '', `Per il prospetto RW serve il ${label} di ${asset} (${day})`, { symbol: asset.toUpperCase(), day, forRW: true });
    notes.push('manca ' + label);
  }

  CT.computeRW = computeRW;
  if (typeof module !== 'undefined') module.exports = { computeRW };
})();
