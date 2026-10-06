/* Dal contenuto dei file al risultato: unisce importazione, motore, imposta e RW. Usato dall'interfaccia. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { Kind, taxDate } = CT;

  const parseCache = new Map();

  function parseFile(f) {
    const key = `${f.id}|${f.type}|${f.account || ''}|${f.text.length}`;
    if (parseCache.has(key)) return parseCache.get(key);
    let out;
    try {
      const t = CT.importers.TYPES[f.type];
      if (!t) throw new Error('Tipo di file non selezionato');
      out = { file: f, ok: true, result: t.parse(f.text, f.name, f.account || undefined) };
    } catch (e) {
      out = { file: f, ok: false, error: e.message };
    }
    parseCache.set(key, out);
    return out;
  }

  function manualToEvents(manual) {
    if (!manual || !manual.length) return [];
    const head = CT.importers.GENERIC_HEADERS;
    const csv = head.join(';') + '\n' + manual.map((m) => head.map((h) => String(m[h] ?? '').replace(/;/g, ',')).join(';')).join('\n');
    return CT.importers.TYPES.generic.parse(csv, 'inserimento manuale').events;
  }

  function analyze(input) {
    const { files = [], manual = [], resolutions = {}, prices = {}, settings = {} } = input;
    const year = settings.year || 2025;
    const parsed = [];
    const events = [];
    const seen = new Set();
    let duplicates = 0;
    const all = files.filter((f) => !f.disabled).map(parseFile);
    for (const p of all) {
      parsed.push(p);
      if (!p.ok) continue;
      for (const e of p.result.events) {
        if (seen.has(e.uid)) { duplicates++; continue; }
        seen.add(e.uid);
        events.push(e);
      }
    }
    for (const e of manualToEvents(manual)) { if (!seen.has(e.uid)) { seen.add(e.uid); events.push(e); } }

    const pb = new CT.PriceBook();
    for (const [k, v] of Object.entries(prices)) { const [sym, day] = k.split('|'); if (v !== '' && v !== null) pb.setManual(sym, day, v); }
    const engine = new CT.Engine({ rebase2025: !!settings.rebase2025, resolutions, prices: pb }).run(events);
    if (duplicates) engine.issue('info', 'duplicates', '', `${duplicates} righe presenti in più file (periodi sovrapposti) sono state contate una sola volta.`);
    apiIssues(engine, parsed, resolutions);
    const years = CT.tax.computeYears(engine, { toYear: year, useCarry: settings.useCarry !== false });
    const y = years[year];
    const rw = CT.computeRW(engine, year, y.rule);
    return { year, parsed, events, engine, years, y, rw, groups: groupIssues(engine), balances: balancesAt(engine, `${year}-12-31`) };
  }

  /** Problemi propri dei dati da API: copertura incompleta e fonti sovrapposte (API + file). */
  function apiIssues(engine, parsed, resolutions) {
    const PL = CT.PLATFORMS || {};
    const name = (k) => (PL[k] && PL[k].name) || k;
    for (const x of parsed) {
      const f = x.file;
      if (!f.api || !Array.isArray(f.api.coverage)) continue;
      for (const c of f.api.coverage) {
        if (c.complete !== false) continue;
        const key = `api_cov:${f.platform}:${c.what}`;
        const ack = resolutions[key] && resolutions[key].action === 'ack';
        engine.issue(ack ? 'info' : 'block', 'api_incomplete', key,
          `${name(f.platform)} (API): ${c.what}${c.note ? ' - ' + c.note : ': non scaricato o storico possibilmente incompleto'}`,
          { platform: f.platform, what: c.what, note: c.note || '' });
      }
    }
    const byPlat = new Map();
    for (const x of parsed) {
      if (!x.ok || !x.result.from) continue;
      const k = x.file.platform || (CT.platformOfType && CT.platformOfType(x.file.type));
      if (!k) continue;
      if (!byPlat.has(k)) byPlat.set(k, { api: [], files: [] });
      byPlat.get(k)[String(x.file.type).startsWith('api_') ? 'api' : 'files'].push(x);
    }
    for (const [k, g] of byPlat) {
      const apiIds = new Set(), fileIds = new Set();
      for (const a of g.api) for (const b of g.files) {
        const day = (d) => CT.taxDate(d);   // i periodi si confrontano per giorno: basta un giorno in comune
        if (day(a.result.from) <= day(b.result.to) && day(b.result.from) <= day(a.result.to)) { apiIds.add(a.file.id); fileIds.add(b.file.id); }
      }
      if (apiIds.size) {
        engine.issue('block', 'source_overlap', `overlap:${k}`,
          `${name(k)}: i dati da API e i file coprono lo stesso periodo, quindi le operazioni verrebbero contate due volte.`,
          { platform: k, apiIds: [...apiIds], fileIds: [...fileIds] });
      }
    }
  }

  /** Raggruppa i problemi per la schermata "Da controllare". */
  function groupIssues(engine) {
    const g = { transferOut: [], transferIn: [], history: [], unknown: new Map(), prices: new Map(), outOfScope: [], notes: [], apiIncomplete: [], overlap: [], blockCount: 0 };
    const seenPrice = new Set();
    for (const i of engine.issues) {
      if (i.level === 'block') {
        if (i.code === 'transfer_out_unmatched') g.transferOut.push(i);
        else if (i.code === 'transfer_in_unmatched') g.transferIn.push(i);
        else if (i.code === 'missing_history') g.history.push(i);
        else if (i.code === 'api_incomplete') g.apiIncomplete.push(i);
        else if (i.code === 'source_overlap') g.overlap.push(i);
        else if (i.code === 'unrecognized_row') {
          const k = i.data.key || 'Riga non riconosciuta';
          if (!g.unknown.has(k)) g.unknown.set(k, { key: k, items: [] });
          g.unknown.get(k).items.push(i);
        } else if (i.code === 'missing_price' || i.code === 'missing_value') {
          const k = `${i.data.symbol}|${i.data.day}`;
          if (!seenPrice.has(k)) { seenPrice.add(k); g.prices.set(k, i); }
        } else g.notes.push(i);
      } else if (i.code === 'out_of_scope') g.outOfScope.push(i);
      else g.notes.push(i);
    }
    g.blockCount = g.transferOut.length + g.transferIn.length + g.history.length + g.apiIncomplete.length + g.overlap.length +
      [...g.unknown.values()].length + (g.prices.size ? 1 : 0) + g.notes.filter((i) => i.level === 'block').length;
    return g;
  }

  function balancesAt(engine, dayEnd) {
    const m = new Map();
    for (const mv of engine.movements) {
      if (mv.account === '(rete)' || mv.day > dayEnd) continue;
      const k = mv.account + '\u0000' + mv.asset;
      m.set(k, (m.get(k) || CT.ZERO).plus(mv.delta));
    }
    return [...m].map(([k, q]) => { const [account, asset] = k.split('\u0000'); return { account, asset, qty: q }; })
      .filter((b) => b.qty.abs().gt('1e-9')).sort((a, b) => (a.account + a.asset < b.account + b.asset ? -1 : 1));
  }

  CT.analyze = analyze;
  CT.groupIssues = groupIssues;
  if (typeof module !== 'undefined') module.exports = { analyze, groupIssues };
})();
