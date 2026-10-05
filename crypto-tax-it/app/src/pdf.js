/* Generazione dei PDF di supporto alla dichiarazione (jsPDF + AutoTable, incluse in vendor/).
   NON sono moduli ufficiali dell'Agenzia delle Entrate: sono prospetti di lavoro per compilare (o far compilare) il
   Modello Redditi PF e documentare i calcoli. Se ci sono punti irrisolti ogni pagina porta la filigrana BOZZA. */
(function () {
  'use strict';
  const CT = (globalThis.CT = globalThis.CT || {});
  const { D, ZERO } = CT;
  const R = CT.report;

  // ------------------------------------------------------------------ formattazione
  const nf = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  const eur = (x) => (x === null || x === undefined ? '—' : nf.format(Number(D(x).toFixed(2))));
  const qty = (x) => (x === null || x === undefined ? '—' : CT.fq(x).replace('.', ','));
  const dmy = R.dmy;
  const pct = (x) => `${D(x).times(100).toFixed(0)}%`;
  const SAFE = /[^ -~ -ÿ€–—‘’“”•…]/g;
  const safe = (s) => String(s ?? '').replace(/−/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(SAFE, '?');

  const INK = [20, 32, 43], ACCENT = [23, 73, 107], MUTED = [93, 107, 122], ZEBRA = [244, 247, 250], WARN = [143, 84, 0], WARN_BG = [253, 240, 210], GOOD = [29, 122, 75], GOOD_BG = [223, 242, 232];
  const MX = 14, MTOP = 20, MBOT = 16;

  const INTERPRETATIONS = [
    'Costo di acquisto: metodo LIFO (si considerano ceduti per primi gli ultimi acquistati), con un unico conto virtuale per ogni asset su tutte le piattaforme (Circ. AdE 30/E del 27/10/2023, regime dichiarativo).',
    'Dal 2023 sono cessioni imponibili, al valore normale del giorno: vendite in euro, scambi tra crypto, passaggi a stablecoin, pagamenti in crypto e commissioni pagate in crypto. Prima del 2023 le permute tra crypto non erano un realizzo e il costo si trasferisce al nuovo asset.',
    'Proventi (staking, interessi, cashback, airdrop, referral): tassati al valore normale alla percezione; quel valore diventa il costo del lotto; non compensabili con le minusvalenze da cessione (scelta prudenziale).',
    'Minusvalenze: quelle cripto compensano solo plusvalenze cripto; l\'oro e i metalli preziosi hanno un conteggio separato. Riporto in avanti per 4 anni, calcolato dai file caricati: vale solo se le minusvalenze sono state indicate nella dichiarazione dell\'anno di realizzo.',
    'Data fiscale: data di calendario in Italia (fuso Europe/Rome). Importi arrotondati all\'euro solo sui totali di quadro.',
    'Valori e prezzi: se un\'operazione non riporta il controvalore in euro si usa il prezzo del giorno ricavato dalle altre operazioni, oppure il prezzo inserito manualmente (elencato nell\'Allegato E).',
  ];

  // ------------------------------------------------------------------ costruttore PDF
  class Pdf {
    constructor(JS, meta) { this.JS = JS; this.meta = meta; this.doc = null; this.marks = []; this.y = MTOP; }
    begin(orient, title) {
      if (!this.doc) {
        this.doc = new this.JS({ unit: 'mm', format: 'a4', orientation: orient });
        this.doc.setProperties({ title: safe(this.meta.docTitle), subject: safe(`Anno d'imposta ${this.meta.year}`), author: 'Dichiarazione Crypto', creator: 'Dichiarazione Crypto' });
      } else this.doc.addPage('a4', orient);
      this.orient = orient; this.y = MTOP;
      this.marks.push({ title, page: this.doc.getNumberOfPages() });
    }
    get W() { return this.doc.internal.pageSize.getWidth(); }
    get H() { return this.doc.internal.pageSize.getHeight(); }
    get cw() { return this.W - 2 * MX; }
    ensure(h) { if (this.y + h > this.H - MBOT) { this.doc.addPage('a4', this.orient); this.y = MTOP; } }
    gap(h) { this.y += h; }
    h1(t) { this.ensure(16); this.doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK); this.doc.text(safe(t), MX, this.y + 5); this.y += 8; this.doc.setDrawColor(...ACCENT).setLineWidth(0.6).line(MX, this.y, MX + this.cw, this.y); this.y += 6; }
    h2(t) { this.ensure(12); this.doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...ACCENT); this.doc.text(safe(t), MX, this.y + 4); this.y += 7; }
    para(t, o = {}) {
      const size = o.size || 9.5;
      this.doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal').setFontSize(size).setTextColor(...(o.color || INK));
      const lines = this.doc.splitTextToSize(safe(t), this.cw - (o.indent || 0));
      const lh = size * 0.42;
      for (const ln of lines) { this.ensure(lh + 1); this.doc.text(ln, MX + (o.indent || 0), this.y + lh * 0.8); this.y += lh + 0.8; }
      this.y += o.after === undefined ? 1.5 : o.after;
    }
    bullets(items, o = {}) { for (const t of items) this.para('• ' + t, { ...o, indent: 3 }); }
    box(text, tone) {
      const fill = tone === 'good' ? GOOD_BG : WARN_BG, col = tone === 'good' ? GOOD : WARN;
      this.doc.setFont('helvetica', 'bold').setFontSize(10);
      const lines = this.doc.splitTextToSize(safe(text), this.cw - 8);
      const h = lines.length * 4.6 + 6;
      this.ensure(h + 2);
      this.doc.setFillColor(...fill).setDrawColor(...col).setLineWidth(0.3).roundedRect(MX, this.y, this.cw, h, 1.5, 1.5, 'FD');
      this.doc.setTextColor(...col); lines.forEach((ln, i) => this.doc.text(ln, MX + 4, this.y + 5.2 + i * 4.6));
      this.y += h + 4;
    }
    table(head, body, o = {}) {
      const num = new Set(o.num || []);
      this.doc.autoTable({
        startY: this.y, head: [head.map(safe)], body: body.map((r) => r.map((c) => safe(c))), foot: o.foot ? [o.foot.map(safe)] : undefined,
        theme: 'grid', margin: { top: MTOP, bottom: MBOT, left: MX, right: MX },
        styles: { font: 'helvetica', fontSize: o.fontSize || 8, cellPadding: 1.6, lineColor: [214, 222, 230], lineWidth: 0.2, textColor: INK, overflow: 'linebreak', valign: 'top' },
        headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: [233, 238, 243], textColor: INK, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: ZEBRA }, columnStyles: o.columnStyles || {}, showFoot: 'lastPage',
        didParseCell: (d) => { if (num.has(d.column.index)) d.cell.styles.halign = 'right'; if (o.boldRows && d.section === 'body' && o.boldRows.includes(d.row.index)) d.cell.styles.fontStyle = 'bold'; },
      });
      this.y = this.doc.lastAutoTable.finalY + 6;
    }
    /** Intestazione, piè di pagina e filigrana su tutte le pagine. */
    finish() {
      const doc = this.doc, n = doc.getNumberOfPages(), m = this.meta;
      for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
        doc.text(safe(m.docTitle), MX, 10);
        if (m.taxpayerLine) doc.text(safe(m.taxpayerLine), W - MX, 10, { align: 'right' });
        doc.setDrawColor(214, 222, 230).setLineWidth(0.2).line(MX, 12, W - MX, 12).line(MX, H - 11, W - MX, H - 11);
        doc.text(safe(`Documento di lavoro generato automaticamente il ${m.generated}. Non è un modulo ufficiale dell'Agenzia delle Entrate.`), MX, H - 7);
        doc.text(`Pagina ${i} di ${n}`, W - MX, H - 7, { align: 'right' });
        if (m.draft) {
          doc.saveGraphicsState();
          doc.setGState(new doc.GState({ opacity: 0.09 }));
          doc.setTextColor(179, 38, 30).setFont('helvetica', 'bold').setFontSize(100);
          doc.text('BOZZA', W / 2, H / 2 + 10, { align: 'center', angle: 35 });
          doc.restoreGraphicsState();
        }
      }
      return doc.output('arraybuffer');
    }
  }

  // ------------------------------------------------------------------ sezioni
  const byAsset = (ds) => {
    const m = new Map();
    for (const d of ds) {
      const a = m.get(d.asset) || { n: 0, proceeds: ZERO, cost: ZERO, gain: ZERO };
      a.n++; a.proceeds = a.proceeds.plus(d.proceeds); a.cost = a.cost.plus(d.cost); a.gain = a.gain.plus(d.gain);
      m.set(d.asset, a);
    }
    return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  };

  function coverSection(p, c) {
    const { res, meta, state } = c;
    const y = res.y, Y = res.year;
    p.doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...INK);
    p.doc.text(safe('Fascicolo di supporto'), MX, p.y + 8); p.y += 11;
    p.doc.setFontSize(22).text(safe('alla dichiarazione dei redditi'), MX, p.y + 8); p.y += 14;
    p.para(`Anno d'imposta ${Y} · Modello Redditi Persone Fisiche ${Y + 1} · Cripto-attività e oro/metalli preziosi`, { size: 11, color: MUTED, after: 4 });
    const tp = state.taxpayer || {};
    p.table(['Contribuente', 'Codice fiscale'], [[tp.name || '(da compilare)', tp.cf || '(da compilare)']], { fontSize: 10 });
    if (meta.draft) p.box(`BOZZA: ci sono ${res.groups.blockCount} punti ancora da risolvere (vedi Allegato E). I numeri di questo fascicolo possono cambiare e non vanno usati per la dichiarazione.`, 'warn');
    else p.box('Calcolo completato senza punti aperti. Richiede comunque la revisione di un commercialista prima dell\'uso in dichiarazione.', 'good');
    const rwTot = res.rw.reduce((s, r) => s.plus(r.ivca), ZERO);
    p.h2('Riepilogo');
    p.table(['Voce', 'Importo (€)'], [
      ['Imposta sostitutiva su cripto-attività (quadro RT)', eur(y.crypto.tax)],
      ['Imposta sostitutiva su oro e metalli preziosi (quadro RT)', eur(y.metals.tax)],
      ['Totale imposta sostitutiva', eur(y.totalTax)],
      ['Imposta sul valore delle cripto-attività, IVCA (quadro RW, indicativa)', eur(rwTot)],
      ['Minusvalenze cripto da riportare agli anni successivi', eur(y.crypto.newLoss)],
      ['Minusvalenze oro/metalli da riportare agli anni successivi', eur(y.metals.newLoss)],
    ], { num: [1], boldRows: [2], columnStyles: { 1: { cellWidth: 36 } }, fontSize: 9 });
    p.h2('A cosa servono questi documenti');
    p.para('L\'Agenzia delle Entrate non richiede né accetta allegati per i redditi da cripto-attività e metalli preziosi: i dati si dichiarano nel Modello Redditi Persone Fisiche (quadri RT e RW). Questi prospetti raccolgono i numeri da riportare nel modello e documentano come sono stati calcolati, per te o per il commercialista. Non sono moduli ufficiali e non vanno inviati.');
    p.bullets([
      'Quadro RT: usa i prospetti 01 (cripto) e 02 (oro e metalli). I righi esatti cambiano ogni anno: vanno presi dalle istruzioni del modello.',
      'Quadro RW: usa il prospetto 03. Servono anche la denominazione e lo Stato del custode di ogni piattaforma o wallet.',
      'Versamenti: vedi il prospetto 04.',
      'Conserva gli allegati A-E e gli export originali delle piattaforme per tutto il periodo in cui l\'Agenzia può controllare (in genere fino al 31 dicembre del quinto anno successivo alla presentazione).',
    ], { size: 9 });
    p.h2('Indice');
    c.indexY = p.y; c.indexPage = p.doc.getNumberOfPages();
  }

  function rtSection(kind) {
    return (p, c) => {
      const { res } = c;
      const b = kind === 'crypto' ? res.y.crypto : res.y.metals;
      const Y = res.year;
      const ds = res.engine.disposals.filter((d) => d.year === Y && d.cls === kind);
      p.h1(`Prospetto quadro RT · ${b.name}`);
      p.para(`${b.law}. Anno d'imposta ${Y}. Riferimento nel modello: quadro RT${kind === 'crypto' ? ', sezione dedicata alle cripto-attività' : ', plusvalenze su metalli preziosi'} (righi e colonne da verificare nelle istruzioni del modello Redditi PF ${Y + 1}).`, { color: MUTED, size: 9 });
      const rows = [
        ['Numero di cessioni imponibili nell\'anno', String(b.nDisposals)],
        ['Corrispettivi / valore di cessione (al netto delle commissioni)', eur(b.proceeds)],
        ['Costo o valore di acquisto', eur(b.costs)],
        ['Plusvalenze', eur(b.gains)],
        ['Minusvalenze', eur(b.losses)],
        ['Plusvalenza / minusvalenza netta', eur(b.net)],
      ];
      if (b.income.gt(0)) rows.push(['Proventi (staking, interessi, premi) al valore normale', eur(b.income)]);
      for (const cu of b.carryUsed) rows.push([`Minusvalenza ${cu.year} utilizzata in compensazione`, `-${eur(cu.amount)}`]);
      if (b.thresholdExempt) rows.push(['Importo sotto la franchigia di 2.000 € (non imponibile)', eur(0)]);
      rows.push(['Imponibile', eur(b.taxable)]);
      rows.push([`Aliquota${b.emtShare.gt(0) ? ' (parte al 26% su stablecoin in euro)' : ''}`, pct(b.rate)]);
      rows.push(['Imposta sostitutiva dovuta', eur(b.tax)]);
      const bold = [rows.length - 3, rows.length - 1];
      if (b.newLoss.gt(0)) rows.push([`Minusvalenza ${Y} da riportare nei 4 anni successivi (da indicare in dichiarazione)`, eur(b.newLoss)]);
      for (const cu of b.carryUnused) rows.push([`Minusvalenza ${cu.year} ancora riportabile`, eur(cu.amount)]);
      for (const cu of b.carryExpired) rows.push([`Minusvalenza ${cu.year} non più utilizzabile (oltre 4 anni)`, eur(cu.amount)]);
      p.h2('Dati da riportare in dichiarazione');
      p.table(['Voce', 'Importo (€)'], rows, { num: [1], boldRows: bold, columnStyles: { 1: { cellWidth: 36 } }, fontSize: 9 });
      const rebased = ds.reduce((s, d) => d.uses.filter((u) => u.rebased).reduce((s2, u) => s2.plus(u.cost), s), ZERO);
      if (rebased.gt(0)) p.para(`Di cui costo di lotti rideterminati al valore del 1/1/2025: ${eur(rebased)} €. Nel modello le cessioni di lotti rideterminati vanno indicate separatamente (verificare i righi).`, { size: 9 });
      p.h2('Riepilogo per asset');
      p.table(['Asset', 'Cessioni', 'Corrispettivi (€)', 'Costi (€)', 'Plus / minusvalenza (€)'], byAsset(ds).map(([a, v]) => [a, String(v.n), eur(v.proceeds), eur(v.cost), eur(v.gain)]), { num: [1, 2, 3, 4], foot: ['Totale', String(ds.length), eur(b.proceeds), eur(b.costs), eur(b.net)] });
      if (kind === 'metal') p.para('Attenzione: l\'oro dei prodotti digitali (es. Bitpanda Metals) è qui trattato come metallo prezioso (art. 67, c. 1, lett. c-ter). La qualificazione e l\'obbligo di monitoraggio RW per metalli custoditi all\'estero vanno confermati dal commercialista.', { color: WARN, bold: true, size: 9 });
      p.h2('Come sono stati fatti i calcoli');
      p.bullets(INTERPRETATIONS, { size: 8.5 });
      p.para(`Regole ${Y}: ${res.y.rule.note} Stato delle regole: ${res.y.rule.status}. Dettaglio operazione per operazione: Allegato A; lotti di acquisto: Allegato B.`, { size: 8.5, color: MUTED });
    };
  }

  function rwSection(p, c) {
    const { res, state } = c;
    const Y = res.year;
    p.h1('Prospetto quadro RW · Monitoraggio e IVCA');
    p.para(`Cripto-attività e metalli preziosi detenuti presso piattaforme estere o wallet personali nell'anno ${Y}. Bozza di lavoro: i codici (tipologia di investimento, criterio di valutazione) e i righi vanno presi dalle istruzioni del modello Redditi PF ${Y + 1}.`, { color: MUTED, size: 9 });
    const cust = (a) => { const x = (state.custodians || {})[a] || {}; return [x.name || '(da indicare)', x.country || '(da indicare)']; };
    const rows = res.rw.map((r) => [...cust(r.account), r.account, r.asset, r.cls === 'metal' ? 'Metallo' : 'Cripto', '100%', String(r.days), eur(r.valueInitial), eur(r.valueFinal), r.cls === 'metal' ? '—' : eur(r.ivca)]);
    const tot = res.rw.reduce((s, r) => s.plus(r.ivca), ZERO);
    if (!rows.length) p.para('Nessuna cripto-attività o metallo detenuto nell\'anno.');
    else p.table(['Custode (denominazione)', 'Stato', 'Conto / wallet', 'Asset', 'Tipo', 'Quota', 'Giorni', 'Valore iniziale (€)', 'Valore finale (€)', 'IVCA 0,2% (€)'], rows, { num: [5, 6, 7, 8, 9], fontSize: 8, foot: ['Totale IVCA indicativa', '', '', '', '', '', '', '', '', eur(tot)] });
    p.h2('Come leggere i valori');
    p.bullets([
      'Valore iniziale: quantità detenuta al 1° gennaio per il prezzo di quel giorno; se l\'asset è stato acquisito durante l\'anno, valore all\'acquisizione.',
      'Valore finale: quantità al 31 dicembre per il prezzo di quel giorno; se l\'asset è stato ceduto durante l\'anno, valore alla cessione.',
      'Giorni: giorni di calendario (Italia) in cui l\'asset è stato detenuto nell\'anno, anche solo in parte.',
      'IVCA indicativa: 0,2% × valore finale × giorni/365, solo per le cripto-attività. Per i metalli non è calcolata: verificare con il commercialista quali imposte e obblighi si applicano.',
      'Custode e Stato: il programma non li conosce. Indicarli nella scheda Documenti (denominazione della società che custodisce i fondi, dai termini e condizioni della piattaforma).',
    ], { size: 9 });
  }

  function paySection(p, c) {
    const { res } = c;
    const Y = res.year, y = res.y;
    const rwTot = res.rw.reduce((s, r) => s.plus(r.ivca), ZERO);
    p.h1('Riepilogo imposte e versamenti');
    p.para('Importi stimati dal programma. Scadenze e codici tributo vanno verificati nelle istruzioni del modello e con il commercialista.', { color: MUTED, size: 9 });
    const rows = [
      ['Imposta sostitutiva cripto-attività', eur(y.crypto.tax)],
      ['Imposta sostitutiva oro e metalli preziosi', eur(y.metals.tax)],
      ['Totale imposta sostitutiva', eur(y.totalTax)],
      ['IVCA (imposta sul valore delle cripto-attività), indicativa', eur(rwTot)],
    ];
    if (c.state.settings.rebase2025 && Y >= 2025) rows.push(['Imposta sostitutiva 18% sulla rideterminazione del costo (se non già versata)', eur(c.res.engine.rebaseTotal.times('0.18'))]);
    p.table(['Voce', 'Importo (€)'], rows, { num: [1], boldRows: [2], columnStyles: { 1: { cellWidth: 36 } }, fontSize: 9 });
    p.h2('Scadenze ordinarie (indicative)');
    p.bullets([
      `Saldo delle imposte sui redditi: entro il 30 giugno ${Y + 1}, oppure entro il 30 luglio ${Y + 1} con la maggiorazione dello 0,40%.`,
      'Se la scadenza è passata si può regolarizzare con il ravvedimento operoso (sanzioni ridotte): da calcolare con il commercialista.',
      'Invio telematico del Modello Redditi PF: di norma entro il 31 ottobre (se cade di sabato o festivo, il giorno lavorativo successivo).',
    ], { size: 9 });
  }

  function attCessioni(p, c) {
    const { res } = c;
    p.h1('Allegato A · Elenco delle cessioni');
    p.para(`Tutte le cessioni dell'anno ${res.year} con corrispettivo, costo e risultato. Fonte del valore: "dal file" = importo riportato nell'export della piattaforma; "prezzo ..." = valore ricavato da prezzi del giorno.`, { color: MUTED, size: 9 });
    const disp = res.engine.disposals.filter((d) => d.year === res.year).sort((a, b) => a.ts - b.ts);
    p.table(['Data', 'Conto', 'Asset', 'Tipo', 'Quantità', 'Corrispettivo netto (€)', 'Costo (€)', 'Plus/minus (€)', 'Fonte del valore', 'Origine (file:riga)'],
      disp.map((d) => [dmy(d.day), d.account, d.asset, R.KIND_IT[d.kind] || d.kind, qty(d.qty), eur(d.proceeds), eur(d.cost), eur(d.gain), d.source, d.src]),
      { num: [4, 5, 6, 7], fontSize: 7.5, foot: ['Totale', '', '', '', '', eur(disp.reduce((s, d) => s.plus(d.proceeds), ZERO)), eur(disp.reduce((s, d) => s.plus(d.cost), ZERO)), eur(disp.reduce((s, d) => s.plus(d.gain), ZERO)), '', ''] });
  }

  function attBlotti(p, c) {
    const { res } = c;
    p.h1('Allegato B · Lotti di acquisto utilizzati (documentazione del costo)');
    p.para('Per ogni cessione, i lotti di acquisto consumati secondo il metodo LIFO e il relativo costo. Un costo "NON documentato" significa che nei file caricati manca l\'acquisto: in quel caso il costo è zero e l\'intero corrispettivo risulta plusvalenza.', { color: MUTED, size: 9 });
    const disp = res.engine.disposals.filter((d) => d.year === res.year).sort((a, b) => a.ts - b.ts);
    const rows = [];
    for (const d of disp) for (const u of d.uses) rows.push([dmy(d.day), d.asset, qty(d.qty), dmy(u.day), qty(u.qty), eur(u.cost), u.documented ? 'sì' : 'NON documentato', u.rebased ? 'sì' : 'no', u.lotId]);
    if (!rows.length) p.para('Nessuna cessione nell\'anno.');
    else p.table(['Data cessione', 'Asset', 'Quantità ceduta', 'Data acquisto lotto', 'Quantità dal lotto', 'Costo del lotto (€)', 'Costo documentato', 'Rideterminato 1/1/2025', 'Lotto'], rows, { num: [2, 4, 5], fontSize: 7.5 });
  }

  function attProventi(p, c) {
    const { res } = c;
    p.h1('Allegato C · Proventi (staking, interessi, premi)');
    const inc = res.engine.incomes.filter((i) => i.year === res.year).sort((a, b) => a.ts - b.ts);
    if (!inc.length) { p.para('Nessun provento nell\'anno.'); return; }
    p.para('Valore normale alla data di percezione, in euro. Il valore diventa il costo del lotto di quanto ricevuto.', { color: MUTED, size: 9 });
    p.table(['Data', 'Conto', 'Asset', 'Tipo', 'Quantità', 'Valore normale (€)', 'Fonte del valore', 'Origine (file:riga)'],
      inc.map((i) => [dmy(i.day), i.account, i.asset, R.INC_IT[i.type] || i.type, qty(i.qty), eur(i.value), i.source, i.src]),
      { num: [4, 5], fontSize: 7.5, foot: ['Totale', '', '', '', '', eur(inc.reduce((s, i) => s.plus(i.value), ZERO)), '', ''] });
  }

  function attSaldi(p, c) {
    const { res } = c;
    p.h1(`Allegato D · Saldi al 31/12/${res.year}`);
    p.para('Quantità che risultano dai file caricati in ogni conto a fine anno. Vanno confrontate con quanto mostrato dalle piattaforme: se non coincidono manca qualche operazione.', { color: MUTED, size: 9 });
    if (!res.balances.length) p.para('Nessun saldo.');
    else p.table(['Conto / wallet', 'Asset', 'Quantità'], res.balances.map((b) => [b.account, b.asset, qty(b.qty)]), { num: [2] });
  }

  function describeResolution(c, uid, r) {
    const base = uid.replace(/#(fee|netfee)$/, '');
    const e = c.res.events.find((x) => x.uid === base);
    const what = e ? `${dmy(CT.taxDate(e.ts))} · ${e.account} · ${qty(e.qty)} ${e.asset}` : uid;
    const A = { ignore: 'Riga ignorata', self_custody: `Trasferimento verso un proprio wallet (${r.wallet || 'Wallet personale'})`, from_self_custody: 'Ingresso da un proprio wallet', disposal: `Uscita trattata come vendita, valore ${r.value_eur} €`, set_cost: `Costo impostato: ${r.cost_eur} €${r.acquired ? ` (acquisto del ${dmy(r.acquired)})` : ''}`, cover_cost: `Costo del mancante impostato: ${r.cost_eur} €${r.acquired ? ` (acquisto del ${dmy(r.acquired)})` : ''}`, set_value: `Valore impostato: ${r.value_eur} €` };
    return [what, A[r.action] || r.action];
  }

  function attFonti(p, c) {
    const { res, state, hashes } = c;
    p.h1('Allegato E · Fonti dei dati, scelte dell\'utente e problemi');
    p.h2('File di origine');
    const rows = res.parsed.map((x) => {
      const r = x.ok ? x.result : null;
      return [x.file.name, x.ok ? r.label : `ERRORE: ${x.error}`, x.ok ? String(r.rows) : '', r && r.from ? `${dmy(CT.taxDate(r.from))} - ${dmy(CT.taxDate(r.to))}` : '', hashes[x.file.id] || 'n.d.'];
    });
    if (rows.length) p.table(['File', 'Tipo', 'Righe', 'Periodo', 'Impronta SHA-256'], rows, { num: [2], fontSize: 7, columnStyles: { 4: { cellWidth: 62, font: 'courier', fontSize: 5.5 } } });
    else p.para('Nessun file.');
    p.para('L\'impronta SHA-256 permette di dimostrare che i file originali conservati sono quelli usati per il calcolo.', { size: 8.5, color: MUTED });
    if (state.manual && state.manual.length) {
      p.h2('Operazioni inserite a mano');
      p.table(['Data', 'Operazione', 'Conto', 'Asset', 'Quantità', 'Valore (€)'], state.manual.map((m) => [dmy(m.data.slice(0, 10)), m.tipo.replace(/_/g, ' '), m.conto, m.asset, m.quantita, m.valore_eur]), { num: [4, 5], fontSize: 8 });
    }
    const pr = Object.entries(state.prices || {});
    if (pr.length) {
      p.h2('Prezzi inseriti manualmente');
      p.table(['Asset', 'Data', 'Prezzo (€ per unità)'], pr.map(([k, v]) => { const [s, d] = k.split('|'); return [s, dmy(d), String(v).replace('.', ',')]; }), { num: [2], fontSize: 8 });
    }
    const rs = Object.entries(state.resolutions || {});
    if (rs.length) {
      p.h2('Decisioni prese dall\'utente');
      p.table(['Operazione', 'Decisione'], rs.map(([uid, r]) => describeResolution(c, uid, r)), { fontSize: 8 });
    }
    p.h2('Problemi e note del programma');
    const iss = res.engine.issues;
    if (!iss.length) p.para('Nessuno.');
    else p.table(['Livello', 'Messaggio'], [...iss].sort((a, b) => ['block', 'warn', 'info'].indexOf(a.level) - ['block', 'warn', 'info'].indexOf(b.level)).map((i) => [i.level === 'block' ? 'DA RISOLVERE' : i.level === 'warn' ? 'Attenzione' : 'Nota', i.message]), { fontSize: 7.5, columnStyles: { 0: { cellWidth: 26 } } });
    p.h2('Scelte interpretative applicate');
    p.bullets(INTERPRETATIONS, { size: 8.5 });
    p.para(`Regole ${res.year}: ${res.y.rule.note} Stato: ${res.y.rule.status}. Fonti da verificare: L. 197/2022, L. 207/2024, L. 199/2025, Circolare AdE 30/E del 27/10/2023, istruzioni del modello Redditi PF.`, { size: 8.5, color: MUTED });
  }

  const SECTIONS = [
    { id: '00', file: '00-copertina-e-riepilogo', title: 'Copertina e riepilogo', orient: 'p', fn: coverSection },
    { id: '01', file: '01-quadro-RT-cripto', title: '01 · Prospetto quadro RT · Cripto-attività', orient: 'p', fn: rtSection('crypto') },
    { id: '02', file: '02-quadro-RT-oro-e-metalli', title: '02 · Prospetto quadro RT · Oro e metalli preziosi', orient: 'p', fn: rtSection('metal') },
    { id: '03', file: '03-quadro-RW', title: '03 · Prospetto quadro RW · Monitoraggio e IVCA', orient: 'l', fn: rwSection },
    { id: '04', file: '04-imposte-e-versamenti', title: '04 · Riepilogo imposte e versamenti', orient: 'p', fn: paySection },
    { id: 'A', file: 'A-elenco-cessioni', title: 'Allegato A · Elenco delle cessioni', orient: 'l', fn: attCessioni },
    { id: 'B', file: 'B-lotti-di-acquisto', title: 'Allegato B · Lotti di acquisto utilizzati', orient: 'l', fn: attBlotti },
    { id: 'C', file: 'C-proventi', title: 'Allegato C · Proventi', orient: 'l', fn: attProventi },
    { id: 'D', file: 'D-saldi-al-31-12', title: 'Allegato D · Saldi al 31/12', orient: 'p', fn: attSaldi },
    { id: 'E', file: 'E-fonti-decisioni-problemi', title: 'Allegato E · Fonti, decisioni e problemi', orient: 'p', fn: attFonti },
  ];

  async function sha256(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return null; }
  }

  /** Costruisce il fascicolo completo e i singoli PDF. Ritorna { full, parts, zip }. */
  async function buildAll(res, state) {
    const JS = (globalThis.jspdf && globalThis.jspdf.jsPDF) || null;
    if (!JS) throw new Error('Libreria PDF non disponibile');
    const Y = res.year;
    const tp = state.taxpayer || {};
    const hashes = {};
    for (const f of state.files) hashes[f.id] = await sha256(f.text);
    const baseMeta = {
      year: Y, draft: res.groups.blockCount > 0, generated: new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
      taxpayerLine: [tp.name, tp.cf ? `CF ${tp.cf}` : ''].filter(Boolean).join(' · '),
    };
    const ctx0 = { res, state, hashes };

    const full = new Pdf(JS, { ...baseMeta, docTitle: `Fascicolo di supporto alla dichiarazione · Anno d'imposta ${Y}` });
    const ctx = { ...ctx0, meta: baseMeta };
    for (const s of SECTIONS) { full.begin(s.orient, s.title); s.fn(full, ctx); }
    // indice sulla copertina
    const doc = full.doc;
    doc.setPage(ctx.indexPage);
    let iy = ctx.indexY;
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK);
    for (const m of full.marks.slice(1)) {
      doc.text(safe(m.title), MX + 2, iy + 4); doc.text(String(m.page), full.W - MX, iy + 4, { align: 'right' });
      doc.setDrawColor(230, 235, 240).setLineWidth(0.15).line(MX, iy + 5.6, full.W - MX, iy + 5.6);
      iy += 6.4;
    }
    const files = [{ name: `${Y}-fascicolo-completo.pdf`, title: 'Fascicolo completo (tutti i documenti in un unico PDF)', data: new Uint8Array(full.finish()) }];
    const parts = [];
    for (const s of SECTIONS) {
      const p = new Pdf(JS, { ...baseMeta, docTitle: `${s.title.replace(/^\d+ · /, '')} · Anno d'imposta ${Y}` });
      p.begin(s.orient, s.title);
      const c2 = { ...ctx0, meta: baseMeta, indexY: 0 };
      s.fn(p, c2);
      if (s.id === '00') {
        p.para('Indice completo: vedi il fascicolo completo.', { size: 9, color: MUTED });
      }
      parts.push({ name: `${Y}-${s.file}.pdf`, title: s.title, data: new Uint8Array(p.finish()) });
    }
    const zip = CT.zipStore([...files, ...parts].map((f) => ({ name: f.name, data: f.data })));
    return { full: files[0], parts, zip: { name: `${Y}-dichiarazione-crypto-pdf.zip`, data: zip }, draft: baseMeta.draft };
  }

  CT.pdf = { buildAll, safe, eur, SECTIONS, INTERPRETATIONS };
  if (typeof module !== 'undefined') module.exports = CT.pdf;
})();
