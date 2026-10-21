/* Lettore della Certificazione Unica (CU) in PDF. Tutto avviene nel browser: il file non viene inviato a nessuno e non viene
   conservato; restano solo i numeri che l'utente conferma.

   Come funziona: pdf.js (Mozilla, incluso nella pagina e avviato solo qui) estrae il testo con la posizione di ogni scritta. Nei
   modelli CU ogni casella ha l'etichetta sopra e il valore sotto (o, in qualche stampa, a destra); il lettore cerca l'etichetta e
   prende il valore sotto. Se due caselle stanno sulla stessa riga, il valore va all'etichetta piu' vicina. Se la CU e' un modulo
   compilabile, i valori dei campi si leggono dalle annotazioni del PDF.

   Campi letti (nomi del modello CU 2026, anno d'imposta 2025):
   - Lavoro autonomo, provvigioni e redditi diversi (SIAE, editori, locali): Causale, Anno (arretrati), Ammontare lordo corrisposto,
     Codice e Altre somme non soggette a ritenuta, Imponibile, Ritenute a titolo d'acconto. Un blocco per ogni modulo.
   - Lavoro dipendente e pensione: punti 1 e 2 (redditi, indeterminato e determinato), 3 (pensione), 6 e 7 (giorni), 21 (ritenute
     IRPEF), 22 (addizionale regionale), 26 e 27 (addizionale comunale: acconto e saldo dell'anno).
   Quello che non si trova resta vuoto e l'utente lo vede nella schermata di conferma. Nessun valore viene indovinato. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});

  const norm = (s) => String(s || '').toLowerCase().replace(/[’`´‘]/g, "'").replace(/\s+/g, ' ').trim();
  const MONEY = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/;
  const isMoney = (s) => MONEY.test(String(s).trim());
  /** "1.051,16" -> "1051.16" (stringa per Decimal). */
  const money = (s) => { const t = String(s).trim(); return MONEY.test(t) ? t.replace(/\./g, '').replace(',', '.') : null; };
  const isValue = (s) => { const t = String(s).trim(); return isMoney(t) || /^\d{1,4}$/.test(t) || /^[A-Z]{1,2}\d?$/.test(t); };

  /** Raggruppa le scritte della stessa riga vicine tra loro (un'etichetta spezzata in piu' pezzi diventa una sola). */
  function chunks(items) {
    const list = items.filter((i) => String(i.str).trim()).map((i) => ({ str: String(i.str), x: i.x, y: i.y, w: i.w || String(i.str).length * 4, h: i.h || 8, field: !!i.field }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const out = [];
    for (const it of list) {
      const last = out[out.length - 1];
      const sameLine = last && Math.abs(last.y - it.y) <= 2.5 && it.x - (last.x + last.w) <= Math.max(4, it.h * 0.6) && it.x >= last.x;
      if (sameLine && !last.field && !it.field && !isValue(it.str) && !isValue(last.str)) {
        last.str = `${last.str}${it.x - (last.x + last.w) > 0.8 ? ' ' : ''}${it.str}`;
        last.w = it.x + it.w - last.x;
      } else out.push({ ...it });
    }
    for (const c of out) { c.str = c.str.trim(); c.n = norm(c.str).replace(/^\d{1,3}\s+(?=[a-z])/, ''); c.cx = c.x + c.w / 2; c.value = c.field || isValue(c.str); }
    // il numero di una casella (es. "21" prima di "Ritenute Irpef") sta sulla stessa riga, subito prima dell'etichetta: non e' un valore
    for (const c of out) {
      if (c.value && !c.field && /^\d{1,3}$/.test(c.str) && out.some((d) => !d.value && Math.abs(d.y - c.y) <= 3 && d.x >= c.x + c.w - 1 && d.x - (c.x + c.w) <= 10)) c.value = false;
    }
    return out;
  }

  /** Valore sotto (o a destra di) un'etichetta, conteso con le altre etichette della stessa riga. */
  function valueOf(cs, L, test, opts) {
    const o = opts || {};
    const maxDy = o.maxDy || 40;
    const near = (V) => Math.min(Math.abs(V.x - L.x), Math.abs(V.cx - L.cx));
    const rowLabels = cs.filter((c) => !c.value && Math.abs(c.y - L.y) <= 3);
    const owner = (V) => rowLabels.reduce((best, c) => (Math.min(Math.abs(V.x - c.x), Math.abs(V.cx - c.cx)) < Math.min(Math.abs(V.x - best.x), Math.abs(V.cx - best.cx)) ? c : best), L);
    const blocked = (V) => cs.some((c) => !c.value && c !== L && c.y > L.y + 2 && c.y < V.y - 2 && c.x < V.x + V.w && c.x + c.w > V.x);
    const below = cs.filter((V) => V.value && test(V.str) && V.y > L.y + 2 && V.y - L.y <= maxDy && near(V) <= 160 && owner(V) === L && !blocked(V))
      .sort((a, b) => (a.y - b.y) || (near(a) - near(b)));
    if (below.length) return below[0];
    const right = cs.filter((V) => V.value && test(V.str) && Math.abs(V.y - L.y) <= 3 && V.x >= L.x + L.w - 1 && V.x - (L.x + L.w) <= 160)
      .sort((a, b) => a.x - b.x);
    return right[0] || null;
  }
  const find = (cs, re) => cs.filter((c) => !c.value && re.test(c.n));

  // ---------------------------------------------------------------- lavoro autonomo (un blocco per ogni "Ammontare lordo corrisposto")
  function autonomo(pages) {
    const out = [];
    pages.forEach((pg, p) => {
      const cs = pg.cs;
      for (const A of find(cs, /^ammontare lordo corrisposto$/)) {
        const inBlock = (c) => c.y >= A.y - 160 && c.y <= A.y + 130;
        const pick = (re) => find(cs, re).filter(inBlock).sort((a, b) => Math.abs(a.y - A.y) - Math.abs(b.y - A.y))[0] || null;
        const val = (re, test) => { const L = pick(re); const V = L && valueOf(cs, L, test); return V ? V.str : null; };
        const lordo = valueOf(cs, A, isMoney);
        const b = {
          page: p + 1,
          causale: val(/^causale$/, (s) => /^[A-Z]{1,2}\d?$/.test(s)),
          anno: val(/^anno$/, (s) => /^(19|20)\d\d$/.test(s)),
          lordo: lordo ? money(lordo.str) : null,
          codice: val(/^codice$/, (s) => /^\d{1,2}$/.test(s)),
          nonSoggette: money(val(/^altre somme non soggette a ritenuta$/, isMoney) || ''),
          imponibile: money(val(/^imponibile$/, isMoney) || ''),
          ritenute: money(val(/^ritenute a titolo d'acconto$/, isMoney) || ''),
        };
        if (b.lordo !== null) out.push(b);
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- lavoro dipendente e pensione
  const DIP = [
    ['p1', /\(?indeterminato\)?$/, isMoney],
    ['p2', /(^|[^n])\(?determinato\)?$/, isMoney],
    ['p3', /^redditi di pensione/, isMoney],
    ['p6', /^lavoro dipendente$/, (s) => /^\d{1,3}$/.test(s)],
    ['p7', /^pensione$/, (s) => /^\d{1,3}$/.test(s)],
    ['p21', /^ritenute irpef$/, isMoney],
    ['p22', /^addizionale regionale all'irpef$/, isMoney],
  ];
  function dipendente(pages, year) {
    const r = {};
    for (const pg of pages) {
      const cs = pg.cs;
      for (const [k, re, test] of DIP) {
        if (r[k] !== undefined) continue;
        for (const L of find(cs, re)) { const V = valueOf(cs, L, test); if (V) { r[k] = k === 'p6' || k === 'p7' ? V.str : money(V.str); break; } }
      }
      // addizionale comunale: "Acconto <anno>" e "Saldo <anno>" dell'anno d'imposta (l'acconto dell'anno dopo e' il punto 29, non serve)
      if (year) {
        for (const [k, re] of [['p26', new RegExp(`^acconto ${year}$`)], ['p27', new RegExp(`^saldo ${year}$`)]]) {
          if (r[k] !== undefined) continue;
          for (const L of find(cs, re)) { const V = valueOf(cs, L, isMoney); if (V) { r[k] = money(V.str); break; } }
        }
      }
    }
    return r;
  }

  /** Testo della pagina in ordine di lettura (per riconoscere anno e sostituto). */
  const pageText = (pg) => pg.cs.map((c) => c.str).join(' ');

  /**
   * Analizza le pagine estratte da un PDF: [{ items: [{ str, x, y, w, h, field? }] }] con y dall'alto.
   * Ritorna { year (anno d'imposta), sostituto, autonomo: [blocchi], dipendente: {p1..p27}, warnings }.
   */
  function parse(pages) {
    const P = pages.map((pg) => ({ cs: chunks(pg.items || []) }));
    const all = P.map(pageText).join('\n');
    const warnings = [];
    const mCU = /certificazione unica\s*(20\d\d)/i.exec(all);
    const mPer = /periodo d'imposta\s*(20\d\d)/i.exec(norm(all));
    const year = mCU ? Number(mCU[1]) - 1 : mPer ? Number(mPer[1]) : null;
    let sostituto = /societa'? italiana (degli )?autori ed editori|\bsiae\b/i.test(norm(all)) ? 'SIAE' : '';
    if (!sostituto) {
      for (const pg of P) {
        const L = find(pg.cs, /^(cognome o )?denominazione$/)[0];
        const V = L && pg.cs.filter((c) => c.y > L.y + 2 && c.y - L.y <= 30 && Math.abs(c.x - L.x) <= 120 && !/^\d/.test(c.str) && c.str.length > 2).sort((a, b) => a.y - b.y)[0];
        if (V) { sostituto = V.str; break; }
      }
    }
    const aut = autonomo(P);
    const dip = dipendente(P, year);
    for (const b of aut) {
      if (b.anno) warnings.push(`Pagina ${b.page}: compenso dell'anno ${b.anno} (arretrati): fallo verificare al commercialista.`);
      if (b.causale && !/^(B|M)$/.test(b.causale)) warnings.push(`Pagina ${b.page}: causale ${b.causale}, non gestita dal programma: chiedi al commercialista dove va.`);
      if (b.imponibile !== null && b.nonSoggette !== null) {
        const diff = Math.abs(Number(b.lordo) - Number(b.nonSoggette) - Number(b.imponibile));
        if (diff > 0.05) warnings.push(`Pagina ${b.page}: lordo meno somme non soggette non torna con l'imponibile (${b.lordo} - ${b.nonSoggette} ≠ ${b.imponibile}): controlla i numeri.`);
      }
    }
    if (!aut.length && !Object.keys(dip).length) warnings.push('Non ho trovato i campi della CU in questo PDF. Se è una foto o una scansione non contiene testo: scrivi i numeri a mano.');
    return { year, sostituto, autonomo: aut, dipendente: dip, warnings };
  }

  /** Quota esente dei diritti d'autore applicata dal sostituto: 0.40 (meno di 35 anni), 0.25 o null. */
  function dedRate(b) {
    if (!b || b.causale !== 'B' || !b.nonSoggette || !b.lordo || !(Number(b.lordo) > 0)) return null;
    const r = Number(b.nonSoggette) / Number(b.lordo);
    if (Math.abs(r - 0.40) < 0.005) return 0.40;
    if (Math.abs(r - 0.25) < 0.005) return 0.25;
    return null;
  }

  // ---------------------------------------------------------------- estrazione dal PDF (solo nel browser)
  function ensurePdfJs() {
    if (globalThis.pdfjsLib) return globalThis.pdfjsLib;
    if (typeof document === 'undefined') throw new Error('lettore PDF non disponibile');
    for (const s of document.querySelectorAll('script[data-lazy="pdfjs"]')) {
      const el = document.createElement('script');
      el.textContent = s.textContent;
      document.head.appendChild(el);      // il worker si registra come globalThis.pdfjsWorker: pdf.js lavora nella pagina, senza file esterni
    }
    if (!globalThis.pdfjsLib) throw new Error('lettore PDF non disponibile in questa versione della pagina');
    return globalThis.pdfjsLib;
  }
  /** Testo con posizione di ogni pagina di un PDF (ArrayBuffer). */
  async function extract(buf, lib) {
    const pdfjs = lib || ensurePdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 }).promise;
    const pages = [];
    try {
      for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 8 }));
        let ann = [];
        try { ann = await page.getAnnotations(); } catch (e) { ann = []; }
        for (const a of ann) {
          if (typeof a.fieldValue === 'string' && a.fieldValue.trim() && Array.isArray(a.rect)) {
            const [x1, y1, x2, y2] = a.rect;
            items.push({ str: a.fieldValue.trim(), x: x1 + 2, y: vp.height - (y1 + (y2 - y1) * 0.3), w: x2 - x1 - 4, h: y2 - y1, field: true });
          }
        }
        pages.push({ items });
      }
    } finally { doc.destroy(); }
    return pages;
  }
  async function readPdf(buf, lib) { return parse(await extract(buf, lib)); }

  CT.cu = { parse, readPdf, extract, chunks, valueOf, dedRate, money };
  if (typeof module !== 'undefined') module.exports = CT.cu;
})();
