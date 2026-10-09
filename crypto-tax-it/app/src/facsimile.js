/* Moduli fac-simile: Quadro RW (Redditi PF 2026) e Quadro W (Modello 730/2026), periodo d'imposta 2025, compilati con i calcoli del programma.
   Sono le pagine del modello dell'Agenzia delle Entrate (immagine di sfondo con la scritta FACSIMILE) con i valori scritti nelle caselle:
   servono al commercialista per ricopiare i dati nel suo software, NON si inviano all'Agenzia.

   Geometria (punti PDF, y dall'alto) misurata sui due fac-simile di riferimento forniti dall'utente: coordinate delle caselle e dei valori.
   Lo stesso elenco di operazioni di disegno ("ops") alimenta l'anteprima su canvas e il PDF, cosi' coincidono.
   Il codice 21 (cripto-attivita'), il titolo di possesso 1, la quota 100,00 e il criterio 1 (valore di mercato) sono quelli del fac-simile di riferimento. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO } = CT;
  const PW = 595.28, PH = 841.89;
  const YEAR = 2025;     // il fac-simile esiste solo per il periodo d'imposta 2025 (Redditi PF 2026)

  // ---------------------------------------------------------------- geometria
  const RW = {
    tpl: 'rw', rowsPerPage: 5, size: 8.3, labelSize: 9,
    // coordinate (basi dei testi) per riga: alto della casella A; per RW1 il blocco e' piu' alto (ci sono le intestazioni)
    baseA: [165.7, 296.9, 392.8, 488.7, 584.7], baseB: [200.9, 319.4, 415.3, 511.2, 607.2], baseD: [273.7, 368.9, 464.8, 560.7, 656.7],
    right: { 1: 163.5, 3: 249.0, 5: 336.0, 6: 377.26, 7: 454.75, 8: 550.0, 10: 240.0, 33: 473.5, 34: 549.25 },
    labelBase1: [210.5, 319.2, 415.1, 511.0, 607.0], labelBase2: [225.5, 334.2, 430.1, 526.0, 622.0], labelBase3: [240.5, 349.2, 445.1, 541.0, 637.0], labelX: 7.5,
    cf: { x0: 250.9, step: 14.4, base: 68.6, size: 11 }, mod: { right: 565.0, base: 115.9, size: 18.75 },
    tot: { base: 764.2, right: { 1: 182.5, 4: 397.9, 5: 469.75, 6: 541.6 }, ph: { x: 371.25, y1: 759.4, y2: 765.4 } },
    banner: { x: 40, y: 26 },
  };
  const W = {
    tpl: 'w', rowsPerPage: 5, size: 7.5, labelSize: 9,
    baseA: [204.9, 300.1, 372.1, 444.1, 516.1], baseB: [240.1, 322.6, 394.6, 466.6, 538.6],
    right: { 1: 90.0, 3: 198.75, 5: 311.26, 6: 371.25, 7: 456.25, 8: 550.75, 10: 187.5 },
    labelCenter: [225.3, 314.5, 386.5, 458.5, 530.5], labelX1: 10.3, labelX2: 21.5, labelX3: 32.7,
    cf: { x0: 345.1, step: 9.775, base: 24.6, size: 9 }, mod: { right: 565.0, base: 25.8, size: 12.75 },
    ph: { x: 322.2, y1: 699.4, y2: 706.0 }, adv: { right: 359.8, base: 706.0 },
    banner: { x: 40, y: 10 },
  };

  // ---------------------------------------------------------------- dati
  const sep = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const eur = (x) => sep(CT.roundEuro(x).toFixed(0));
  const upper = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 _.\-]/g, ' ').trim().replace(/\s+/g, '_');
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + '...' : s);
  const latin = (s) => String(s).replace(/[^\x20-\x7EÀ-ÿ]/g, '?');

  /** Righe del quadro: una per piattaforma (conto) e numero di giorni di detenzione, come nel fac-simile di riferimento. */
  function rows(res, state) {
    // una riga per piattaforma (e per tipo: cripto / oro hanno codici diversi); dentro la riga si sommano le attivita'
    const g = new Map();
    for (const r of res.rw) {
      if (r.cls !== 'crypto' && r.cls !== 'metal') continue;
      const key = [r.account, r.cls].join('|');
      if (!g.has(key)) g.set(key, { account: r.account, cls: r.cls, parts: [], vi: ZERO, vf: ZERO, ic: ZERO, estimated: false, incomplete: false });
      const x = g.get(key);
      x.parts.push({ days: r.days, vf: r.valueFinal || ZERO });
      if (r.valueInitial === null || r.valueInitial === undefined || r.valueFinal === null || r.valueFinal === undefined) x.incomplete = true;
      x.vi = x.vi.plus(r.valueInitial || ZERO); x.vf = x.vf.plus(r.valueFinal || ZERO);
      x.ic = x.ic.plus(r.cls === 'crypto' ? r.ivca || ZERO : ZERO);
      if (r.estimated) x.estimated = true;
    }
    const list = [...g.values()].sort((a, b) => (a.account + a.cls < b.account + b.cls ? -1 : a.account + a.cls > b.account + b.cls ? 1 : 0));
    // giorni di detenzione: se tutte le attivita' della piattaforma hanno gli stessi giorni, quelli; altrimenti la media pesata sul valore finale
    // (cosi' valore finale x giorni/365 x 0,2% resta uguale all'imposta calcolata attivita' per attivita')
    for (const x of list) {
      const days = [...new Set(x.parts.map((p) => p.days))];
      x.mixedDays = days.length > 1;
      if (!x.mixedDays) x.days = days[0];
      else if (x.vf.gt(0)) x.days = Math.round(x.parts.reduce((a, p) => a.plus(p.vf.times(p.days)), ZERO).div(x.vf).toNumber());
      else x.days = Math.max(...days);
    }
    const cu = (state && state.custodians) || {};
    for (const x of list) {
      x.icDue = x.cls === 'crypto' ? CT.roundEuro(x.ic) : null;
      const c = cu[x.account] || {};
      x.label1 = upper(x.account);
      x.label2 = c.name ? upper(c.name) + (c.country ? ' ' + upper(c.country) : '') : '';      // societa' che custodisce, se indicata
      const flags = [];
      if (x.cls === 'metal') flags.push('ORO: VERIFICA CODICE');
      if (x.incomplete) flags.push('DA COMPLETARE'); else if (x.estimated) flags.push('VALORI STIMATI');
      if (x.mixedDays) flags.push('GIORNI MEDI');
      x.label3 = flags.join(' - ');                                                              // in rosso
    }
    return list;
  }

  // ---------------------------------------------------------------- costruzione delle pagine
  const txt = (s, x, y, size, o) => Object.assign({ s: latin(s), x, y, size }, o || {});

  function header(ops, G, n, cf, draft) {
    const code = String(cf || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    for (let i = 0; i < code.length; i++) ops.push(txt(code[i], G.cf.x0 + G.cf.step * (i + 0.5), G.cf.base, G.cf.size, { align: 'center' }));
    ops.push(txt(String(n), G.mod.right, G.mod.base, G.mod.size, { align: 'right' }));
    if (draft) ops.push(txt('BOZZA: ci sono ancora punti da controllare nel programma. Non usare questi dati per la dichiarazione.', G.banner.x, G.banner.y, 8, { color: '#b00020', bold: true }));
  }

  function rwPage(list, n, first, totals, cf, draft, adv) {
    const ops = []; header(ops, RW, n, cf, draft);
    const put = (col, s, base) => ops.push(txt(s, RW.right[col], base, RW.size, { align: 'right' }));
    list.forEach((r, i) => {
      if (r.cls === 'crypto') put(3, '21', RW.baseA[i]);
      put(1, '1', RW.baseA[i]); put(5, '100,00', RW.baseA[i]); put(6, '1', RW.baseA[i]);
      if (!r.incomplete) { put(7, eur(r.vi), RW.baseA[i]); put(8, eur(r.vf), RW.baseA[i]); }
      put(10, String(r.days), RW.baseB[i]);
      if (r.cls === 'crypto' && !r.incomplete) { put(33, eur(r.ic), RW.baseD[i]); put(34, sep(r.icDue.toFixed(0)), RW.baseD[i]); }
      const grey = { color: '#7a7a7a', size: RW.labelSize }, red = { color: '#b00020', size: RW.labelSize };
      ops.push(txt(cut(r.label1, 16), RW.labelX, RW.labelBase1[i], RW.labelSize, grey));
      if (r.label2) ops.push(txt(cut(r.label2, 20), RW.labelX, RW.labelBase2[i], RW.labelSize, grey));
      if (r.label3) ops.push(txt(cut(r.label3, 20), RW.labelX, RW.labelBase3[i], RW.labelSize, red));
    });
    if (first) {
      const T = RW.tot;
      ops.push(txt(sep(totals.toFixed(0)), T.right[1], T.base, RW.size, { align: 'right' }));
      if (adv === null) {
        // gli acconti versati non si possono ricavare dai file: casella lasciata al commercialista (oppure scritta dall'utente)
        ops.push(txt(sep(totals.toFixed(0)), T.right[5], T.base, RW.size, { align: 'right' }));
        const red = { align: 'center', color: '#c00000', bold: true };
        ops.push(txt('INSERIRE ACCONTI', T.ph.x, T.ph.y1, 5.6, red), txt('VERSATI', T.ph.x, T.ph.y2, 5.6, red));
      } else {
        const due = totals.minus(adv);
        ops.push(txt(sep(adv.toFixed(0)), T.right[4], T.base, RW.size, { align: 'right' }));
        ops.push(txt(sep((due.gt(0) ? due : ZERO).toFixed(0)), T.right[5], T.base, RW.size, { align: 'right' }));
        if (due.lt(0)) ops.push(txt(sep(due.neg().toFixed(0)), T.right[6], T.base, RW.size, { align: 'right' }));
      }
    }
    return { tpl: RW.tpl, ops };
  }

  function wPage(list, n, first, cf, draft, adv) {
    const ops = []; header(ops, W, n, cf, draft);
    const put = (col, s, base) => ops.push(txt(s, W.right[col], base, W.size, { align: 'right' }));
    list.forEach((r, i) => {
      if (r.cls === 'crypto') put(3, '21', W.baseA[i]);
      put(1, '1', W.baseA[i]); put(5, '100,00', W.baseA[i]); put(6, '1', W.baseA[i]);
      if (!r.incomplete) { put(7, eur(r.vi), W.baseA[i]); put(8, eur(r.vf), W.baseA[i]); }
      put(10, String(r.days), W.baseB[i]);
      const grey = { color: '#7a7a7a', size: W.labelSize, rot: 90, align: 'center' }, red = Object.assign({}, grey, { color: '#b00020' });
      const lim = i === 0 ? 14 : 11;
      ops.push(txt(cut(r.label1, lim), W.labelX1, W.labelCenter[i], W.labelSize, grey));
      if (r.label2) ops.push(txt(cut(r.label2, lim), W.labelX2, W.labelCenter[i], W.labelSize, grey));
      if (r.label3) ops.push(txt(cut(r.label3, lim), W.labelX3, W.labelCenter[i], W.labelSize, red));
    });
    if (first) {
      if (adv === null) {
        const red = { align: 'center', color: '#c00000', bold: true };
        ops.push(txt('INSERIRE ACCONTI', W.ph.x, W.ph.y1, 5.6, red), txt('VERSATI', W.ph.x, W.ph.y2, 5.6, red));
      } else ops.push(txt(sep(adv.toFixed(0)), W.adv.right, W.adv.base, W.size, { align: 'right' }));
    }
    return { tpl: W.tpl, ops };
  }

  /** Acconti versati scritti dall'utente (euro, anche con la virgola): null se non indicati o non validi. */
  function advance(state) {
    const raw = state && state.taxpayer && state.taxpayer.advance;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const t = String(raw).trim().replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    return CT.roundEuro(D(t));
  }

  /** Pagine dei due moduli. Ritorna { available, reason, rw: [pagine], w: [pagine], rows, total } */
  function build(res, state) {
    if (!res || res.year !== YEAR) return { available: false, reason: `I moduli fac-simile esistono per il periodo d'imposta ${YEAR} (Redditi PF 2026). Per il ${res ? res.year : ''} restano i PDF con i calcoli.` };
    const list = rows(res, state);
    const cf = state && state.taxpayer && state.taxpayer.cf;
    const draft = res.groups.blockCount > 0;
    const adv = advance(state);
    const total = list.reduce((s, r) => s.plus(r.icDue || ZERO), ZERO);
    const chunks = [];
    for (let i = 0; i < Math.max(list.length, 1); i += 5) chunks.push(list.slice(i, i + 5));
    return {
      available: true, rows: list, total,
      rw: chunks.map((c, i) => rwPage(c, i + 1, i === 0, total, cf, draft, adv)),
      w: chunks.map((c, i) => wPage(c, i + 1, i === 0, cf, draft, adv)),
    };
  }

  // ---------------------------------------------------------------- disegno
  const FONT = '"Times New Roman", Times, "Liberation Serif", serif';
  const imgCache = new Map();
  function loadImage(src) {
    if (!imgCache.has(src)) imgCache.set(src, new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => { imgCache.delete(src); ko(new Error('immagine del modulo non caricata')); }; im.src = src; }));
    return imgCache.get(src);
  }
  /** Disegna una pagina su un canvas (anteprima). */
  async function renderCanvas(page, canvas, widthPx) {
    const im = await loadImage(CT.fxAssets[page.tpl]);
    const k = widthPx / PW;
    canvas.width = Math.round(PW * k); canvas.height = Math.round(PH * k);
    const c = canvas.getContext('2d');
    c.drawImage(im, 0, 0, canvas.width, canvas.height);
    for (const o of page.ops) {
      c.save();
      c.font = `${o.bold ? 'bold ' : ''}${o.size * k}px ${FONT}`;
      c.fillStyle = o.color || '#000';
      c.textAlign = o.align === 'right' ? 'right' : o.align === 'center' ? 'center' : 'left';
      c.translate(o.x * k, o.y * k);
      if (o.rot) c.rotate((-o.rot * Math.PI) / 180);
      c.fillText(o.s, 0, 0);
      c.restore();
    }
  }
  /** PDF (jsPDF) con le stesse operazioni di disegno: ritorna un ArrayBuffer. */
  function toPdf(pages, title) {
    const JS = globalThis.jspdf && globalThis.jspdf.jsPDF;
    if (!JS) throw new Error('Libreria PDF non disponibile');
    const doc = new JS({ unit: 'pt', format: 'a4', compress: true });
    doc.setProperties({ title: title || 'Fac-simile', creator: 'Dichiarazione Crypto' });
    pages.forEach((pg, i) => {
      if (i) doc.addPage();
      doc.addImage(CT.fxAssets[pg.tpl], 'JPEG', 0, 0, PW, PH, pg.tpl, 'FAST');
      for (const o of pg.ops) {
        doc.setFont('times', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size);
        const col = (o.color || '#000000').replace('#', '');
        doc.setTextColor(parseInt(col.slice(0, 2), 16), parseInt(col.slice(2, 4), 16), parseInt(col.slice(4, 6), 16));
        if (o.rot) {
          const w = doc.getTextWidth(o.s);
          doc.text(o.s, o.x, o.align === 'center' ? o.y + w / 2 : o.y, { angle: o.rot });
        } else doc.text(o.s, o.x, o.y, { align: o.align || 'left' });
      }
    });
    return doc.output('arraybuffer');
  }

  CT.facsimile = { YEAR, build, rows, renderCanvas, toPdf, PW, PH, _geo: { RW, W } };
  if (typeof module !== 'undefined') module.exports = CT.facsimile;
})();
