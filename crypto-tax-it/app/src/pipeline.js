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
    const fileOf = new Map();
    for (const p of all) {
      parsed.push(p);
      if (!p.ok) continue;
      for (const e of p.result.events) {
        const k = e.dupKey || e.uid;
        if (seen.has(k) || seen.has(e.uid)) { duplicates++; continue; }
        seen.add(k); seen.add(e.uid);
        events.push(e);
        fileOf.set(e, p.file);
      }
    }
    const near = nearDuplicates(events, fileOf, resolutions);
    if (near.skip.size) { for (let i = events.length - 1; i >= 0; i--) if (near.skip.has(events[i])) { events.splice(i, 1); duplicates++; } }
    for (const e of manualToEvents(manual)) { if (!seen.has(e.uid)) { seen.add(e.uid); events.push(e); } }

    const pb = new CT.PriceBook();
    for (const [k, v] of Object.entries(prices)) { const [sym, day] = k.split('|'); if (v !== '' && v !== null) pb.setManual(sym, day, v); }
    const engine = new CT.Engine({ rebase2025: !!settings.rebase2025, resolutions, prices: pb }).run(events);
    if (duplicates) engine.issue('info', 'duplicates', '', `${duplicates} righe presenti in più file (periodi sovrapposti) sono state contate una sola volta.`);
    apiIssues(engine, parsed, resolutions);
    for (const g of near.issues) engine.issue('block', 'possible_duplicate', g.key, g.message, g.data);
    const years = CT.tax.computeYears(engine, { toYear: year, useCarry: settings.useCarry !== false });
    const y = years[year];
    const rw = CT.computeRW(engine, year, y.rule);
    return { year, parsed, events, engine, years, y, rw, groups: groupIssues(engine), balances: balancesAt(engine, `${year}-12-31`) };
  }

  /**
   * Operazioni che sembrano la stessa ma arrivano da file diversi con righe non identiche (esempio: i due export dell'App Crypto.com).
   * Stesso conto, stesso tipo, stesso asset, stesse quantita', orario entro 5 minuti. Non si decide da soli: si chiede all'utente.
   * Risposte: 'dup_skip' = sono le stesse, si tengono quelle del primo file; 'ack' = sono diverse.
   */
  function nearDuplicates(events, fileOf, resolutions) {
    const WATCH = new Set([Kind.BUY, Kind.SELL, Kind.SWAP, Kind.INCOME, Kind.SPEND, Kind.TRANSFER_IN, Kind.TRANSFER_OUT]);
    const buckets = new Map();
    for (const e of events) {
      const f = fileOf.get(e);
      if (!f || !WATCH.has(e.kind) || !e.ts) continue;
      const key = [e.account, e.kind, e.asset, e.qty.toFixed(), e.counterAsset, e.counterQty.toFixed()].join('|');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }
    const order = new Map(); [...new Set([...fileOf.values()])].forEach((f, i) => order.set(f.id, i));
    const groups = new Map();
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const taken = new Set();
      for (const b of list) {
        const fb = fileOf.get(b);
        for (const a of list) {
          const fa = fileOf.get(a);
          if (a === b || taken.has(a) || taken.has(b) || fa.id === fb.id || order.get(fa.id) > order.get(fb.id)) continue;
          if (Math.abs(a.ts - b.ts) > 300000) continue;
          taken.add(a); taken.add(b);
          const key = `neardup:${fa.id}|${fb.id}`;
          if (!groups.has(key)) groups.set(key, { key, fileA: fa, fileB: fb, pairs: [] });
          groups.get(key).pairs.push({ a, b });
          break;
        }
      }
    }
    const skip = new Set(), issues = [];
    for (const g of groups.values()) {
      const res = resolutions[g.key] && resolutions[g.key].action;
      if (res === 'dup_skip') { g.pairs.forEach((p) => skip.add(p.b)); continue; }
      if (res === 'ack') continue;
      const ex = g.pairs.slice(0, 3).map((p) => `${p.b.asset} ${CT.fq(p.b.qty)} del ${CT.taxDate(p.b.ts)}`);
      issues.push({ key: g.key, message: `${g.pairs.length} operazioni compaiono sia in «${g.fileA.name}» sia in «${g.fileB.name}» con date e quantità uguali (${ex.join('; ')}${g.pairs.length > 3 ? '…' : ''}).`,
        data: { fileA: g.fileA.id, fileB: g.fileB.id, nameA: g.fileA.name, nameB: g.fileB.name, count: g.pairs.length, examples: ex } });
    }
    return { skip, issues };
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
    const g = { transferOut: [], transferIn: [], history: [], unknown: new Map(), prices: new Map(), outOfScope: [], notes: [], apiIncomplete: [], overlap: [], nearDup: [], conversions: [], blockCount: 0 };
    const seenPrice = new Set();
    for (const i of engine.issues) {
      if (i.level === 'block') {
        if (i.code === 'transfer_out_unmatched') g.transferOut.push(i);
        else if (i.code === 'transfer_in_unmatched') g.transferIn.push(i);
        else if (i.code === 'missing_history') g.history.push(i);
        else if (i.code === 'api_incomplete') g.apiIncomplete.push(i);
        else if (i.code === 'source_overlap') g.overlap.push(i);
        else if (i.code === 'possible_duplicate') g.nearDup.push(i);
        else if (i.code === 'conversion_pending') g.conversions.push(i);
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
    g.blockCount = g.transferOut.length + g.transferIn.length + g.history.length + g.apiIncomplete.length + g.overlap.length + g.nearDup.length + g.conversions.length +
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
