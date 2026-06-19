/* ============================================================================
   i18n.js — Multilingua (Italiano / English)
   Traduce gli elementi statici dell'interfaccia tramite attributi:
     data-i18n="chiave"        → textContent
     data-i18n-ph="chiave"     → placeholder
     data-i18n-title="chiave"  → title
   Espone window.t(chiave) e window.LFI18N per le stringhe generate da JS.
   ============================================================================ */
(function(){
  'use strict';
  const KEY='labelfinance.lang';

  const DICT={
    it:{
      // Navigazione
      'nav.dashboard':'Dashboard','nav.transactions':'Movimenti','nav.releases':'Release',
      'nav.royalties':'Royalty','nav.import':'Importa CSV','nav.settings':'Impostazioni',
      'nav.faq':'Aiuto & FAQ','nav.about':'Chi siamo','nav.more':'Altro','nav.offers':'Offerte',
      'nav.artists':'Artisti','nav.contracts':'Contratti','nav.tasks':'Task',
      // Comuni
      'common.export':'Esporta','common.save':'Salva','common.cancel':'Annulla','common.close':'Chiudi','common.edit':'Modifica',
      'common.delete':'Elimina','common.signout':'Esci','common.all_periods':'Tutti i periodi',
      'common.period.ytd':'Anno corrente','common.period.12m':'Ultimi 12 mesi','common.period.6m':'Ultimi 6 mesi',
      'common.period.3m':'Ultimi 3 mesi','common.period.custom':'Personalizzato…',
      'common.theme':'Tema','common.language':'Lingua',
      'theme.system':'◐ Sistema','theme.light':'☀ Chiaro','theme.dark':'☾ Scuro',
      // Dashboard
      'dash.kpi.income':'Entrate','dash.kpi.expense':'Uscite','dash.kpi.net':'Margine netto','dash.kpi.count':'Movimenti',
      'dash.chart.title':'Entrate vs Uscite per mese','dash.legend.income':'Entrate','dash.legend.expense':'Uscite',
      'dash.byrelease':'Per release / catalogo','dash.byartist':'Per artista',
      'dash.byplatform':'Per piattaforma','dash.bytype':'Per tipologia',
      'dash.customize':'⚙ Personalizza','dash.columns':'Colonne','dash.reset':'↺ Ripristina','dash.done':'✓ Fatto','dash.hidden':'Nascosti','dash.none_hidden':'Nessun elemento nascosto',
      'dash.forecast':'Cashflow previsionale','dash.forecast_sub':'Proiezione a 3 mesi sul trend recente','dash.forecast_avg':'Media mensile netta','dash.forecast_note':'Stima indicativa basata sulla media degli ultimi mesi. Non è una previsione garantita.','dash.forecast_empty':'Servono almeno alcuni mesi di dati per la proiezione.',
      'dash.top_artists':'Top artisti','dash.recent':'Ultimi movimenti',
      // Artisti
      'art.title':'Artisti','art.subtitle':'La rubrica del tuo roster: contatti, foto e dati per contratti e pagamenti.',
      'art.search':'Cerca artista…','art.new':'Nuovo artista','art.edit':'Modifica artista','art.photo':'Foto','art.upload':'Carica foto',
      'art.name':"Nome d'arte *",'art.legal':'Nome legale','art.email':'Email','art.phone':'Telefono','art.iban':'IBAN',
      'art.split':'Split predefinito %','art.address':'Indirizzo','art.note':'Note','art.save':'Salva artista',
      'art.empty':'Nessun artista in rubrica. Aggiungi il primo per iniziare a creare contratti e promemoria.',
      'art.need_name':"Inserisci il nome d'arte.",'art.saved':'Artista salvato','art.deleted':'Artista eliminato','art.del_confirm':'Eliminare {name} dalla rubrica?',
      // Contratti
      'con.title':'Contratti','con.subtitle':'Genera un contratto standard di split, pronto da inviare via email agli artisti.',
      'con.new':'Nuovo contratto','con.build':'Compila il contratto','con.work':'Opera / Release *','con.date':'Data',
      'con.royalty':'Royalty su entrate nette %','con.advance':'Anticipo (€)','con.territory':'Territorio','con.territory_ph':'Mondo',
      'con.term':'Durata','con.term_ph':'2 anni','con.splits':'Split tra gli artisti','con.add_split':'＋ Aggiungi artista',
      'con.generate':'⚙ Genera contratto','con.preview':'Anteprima contratto','con.print':'⤓ Stampa / PDF','con.send':'✉ Invia agli artisti',
      'con.back':'‹ Modifica','con.saved':'Contratti salvati','con.empty':'Ancora nessun contratto. Creane uno con “Nuovo contratto”.',
      'con.pick_artist':'— Scegli artista —','con.world':'Mondo','con.need_work':"Indica l'opera o la release.",'con.need_artist':'Aggiungi almeno un artista.',
      'con.no_advance':'nessun anticipo','con.parties_short':'Parti','con.status':'Stato','con.st_sent':'Inviato','con.st_draft':'Bozza','con.open':'Apri',
      'con.no_emails':'Nessuna email tra gli artisti: aggiorna la rubrica.','con.sent':'Contratto pronto per l’invio','con.del_confirm':'Eliminare questo contratto?',
      'con.mail_subject':'Contratto — {work} ({label})','con.mail_foot':'— Inviato con Label Finance',
      'con.doc_title':'Contratto di ripartizione royalty','con.doc_parties':'Parti','con.doc_terms':'Condizioni',
      'con.doc_intro':"Il presente accordo è stipulato tra l'etichetta {label} (di seguito «Etichetta») e gli artisti di seguito indicati (di seguito «Artisti»), e disciplina la ripartizione dei proventi relativi all'opera {work}.",
      'con.cl_royalty':"All'insieme degli Artisti spetta una quota pari al {pct} delle entrate nette generate dall'opera, al netto di costi di distribuzione e commissioni.",
      'con.cl_split':'La quota spettante agli Artisti è ripartita tra di essi secondo le percentuali di split indicate nella sezione Parti.',
      'con.cl_advance':"L'Etichetta riconosce un anticipo recuperabile pari a {adv}, deducibile dalle royalty future.",
      'con.cl_territory':"L'accordo ha validità per il seguente territorio: {ter}.",
      'con.cl_term':'La durata dell’accordo è pari a {term}, salvo diverso accordo scritto tra le parti.',
      'con.cl_report':"L'Etichetta fornirà agli Artisti un rendiconto periodico dei proventi e delle quote maturate.",
      'con.cl_law':'Per quanto non espressamente previsto, le parti rinviano alla normativa vigente applicabile.',
      // Task
      'tsk.title':'Task','tsk.subtitle':'Promemoria per pagamenti, invio contratti e scadenze dell’etichetta.',
      'tsk.what':"Cosa c'è da fare *",'tsk.what_ph':'Es. Pagare royalty a Mario','tsk.type':'Tipo','tsk.due':'Scadenza','tsk.add':'＋ Aggiungi task',
      'tsk.t_payment':'Pagamento','tsk.t_contract':'Contratto','tsk.t_other':'Altro','tsk.completed':'Completati',
      'tsk.empty':'Nessun task. Aggiungi il primo promemoria qui sopra.','tsk.need_title':'Scrivi cosa c’è da fare.','tsk.added':'Task aggiunto',
      'dash.report_pdf':'⤓ Report PDF','dash.filter':'Filtra…',
      // Movimenti
      'tx.title':'Movimenti','tx.add_expense':'+ Uscita','tx.add_income':'+ Entrata',
      'tx.search':'Cerca prodotto, artista, catalogo…','tx.all_kinds':'Tutti i tipi',
      'tx.only_income':'Solo entrate','tx.only_expense':'Solo uscite','tx.all_platforms':'Tutte le piattaforme',
      'tx.cols':'⚙ Colonne','tx.export':'⤓ Esporta',
      // Release
      'rel.title':'Release','rel.export':'⤓ Esporta','rel.new':'+ Nuova release',
      'rel.intro':'Definisci catalogo, titolo e le quote di ripartizione (%) per artista. Le vendite con lo stesso catalogo useranno automaticamente queste quote nella sezione Royalty.',
      // Royalty
      'roy.title':'Royalty','roy.subtitle':'Quanto spetta a ogni artista, calcolato sul netto delle entrate.',
      'roy.export':'⤓ Esporta','roy.byartist':'Per artista','roy.statement':'⤓ Statement PDF',
      // Import
      'imp.title':'Importa CSV',
      'imp.subtitle':'Carica un file da Bandcamp, dal distributore o da qualsiasi piattaforma. Mappi le colonne una volta.',
      // Impostazioni
      'set.title':'Impostazioni','set.subtitle':'Sincronizzazione, aspetto, tassi di cambio, backup e gestione dati.',
      'set.sync':'☁ Sincronizzazione cloud','set.appearance':'Aspetto','set.language':'Lingua',
      'set.rates':'Tassi di cambio → EUR','set.backup':'Backup & dati',
      'set.name':'Nome','set.surname':'Cognome','set.label':'Nome label','set.save_profile':'Salva profilo',
      'set.refresh':'Aggiorna ora','set.change_pw':'Cambia password',
      // Chi siamo
      'about.title':'Chi siamo','about.subtitle':'Il gestionale per etichette indipendenti.',
      'about.mission_t':'La nostra missione','about.team_t':'Il team','about.rights':'Tutti i diritti riservati.',
      'about.tm':'Tutti i marchi citati (Bandcamp, DistroKid, Believe, Symphonic…) appartengono ai rispettivi proprietari.',
      'about.credits':'Crediti','credits.product':'Prodotto','credits.version':'Versione','credits.dev':'Sviluppo & design','credits.founder':'Founder',
      // Offerte
      'off.title':'Offerte & Piani','off.subtitle':'Gestisci più etichette da un unico account. Scegli il piano adatto al tuo roster.',
      'off.monthly':'Mensile','off.annual':'Annuale','off.activate':'Attiva','off.current':'Piano attuale',
      'off.billed':'fatturato annualmente','off.year':'anno','off.instead':'invece di',
      'gate.upgrade':'Disponibile con il piano {plan}',
      // FAQ
      'faq.title':'Aiuto & FAQ','faq.subtitle':'Le risposte alle domande più comuni. Cerca una parola o sfoglia per argomento.',
      'faq.search':'Cerca nella guida… (es. ISRC, CSV, royalty, password)',
      // Login
      'gate.sub_login':'Accedi al tuo gestionale','gate.sub_signup':'Crea il tuo account',
      'gate.name':'Nome','gate.surname':'Cognome','gate.label':'Nome label','gate.email':'Email','gate.password':'Password',
      'gate.forgot':'Password dimenticata?','gate.signin':'Accedi','gate.signup':'Registrati',
      // Colonne movimenti
      'col.date':'Data','col.dateTo':'Data (a)','col.platform':'Piattaforma','col.type':'Tipologia',
      'col.catalog':'Catalogo','col.product':'Prodotto','col.artist':'Artista','col.qty':'Q.tà',
      'col.gross':'Lordo','col.shipping':'Spedizione','col.taxes':'Tasse','col.payProcFees':'Comm. processore',
      'col.fees':'Commissioni','col.csShare':'Coll. society','col.net':'Netto','col.currency':'Valuta','col.note':'Nota',
      // Etichette dinamiche
      'greet.hi':'Ciao,','tx.movements':'movimenti','rel.count':'release',
      'g.income':'Entrate','g.expense':'Uscite','g.margin':'Margine',
      'roy.h.artist':'Artista','roy.h.amount':'Royalty (€)','roy.h.release':'Release',
      'roy.label_residual':'Label (quota residua)','roy.total':'Totale','roy.detail':'Dettaglio',
      'roy.click_artist':'Clicca un artista per il dettaglio per release.',
      'empty.noperiod':'Nessun dato nel periodo.','empty.notx':'Nessun movimento.',
      'empty.norel':'Nessuna release. Creane una per iniziare a calcolare le royalty.',
      'empty.noroy':'Nessuna entrata con catalogo collegato a una release.',
      // Toast
      't.label_min':'Deve restare almeno un\'etichetta','t.label_deleted':'Etichetta eliminata',
      't.label_active':'Etichetta attiva: ','t.upgrade':'Passa a un piano superiore per aggiungere etichette',
      't.label_added':'Etichetta aggiunta','t.plan_activated':'Piano attivato: ',
      't.demo_loaded':'Dati demo caricati','t.rel_deleted':'Release eliminata',
      't.cat_required':'Inserisci il catalogo','t.rel_saved':'Release salvata',
      't.tx_deleted':'Movimento eliminato','t.saved':'Salvato',
      't.map_min':'Mappa almeno Netto o Lordo','t.imported':'importati','t.dupes_skipped':'doppioni saltati',
      't.preset_name':'Dai un nome al preset','t.preset_saved':'Preset salvato',
      't.rate_required':'Inserisci valuta e tasso','t.backup_restored':'Backup ripristinato',
      't.file_invalid':'File non valido','t.data_wiped':'Dati cancellati',
      'acct.your_labels':'Le tue etichette','acct.plan':'Piano',
      'tx.modal.new':'Nuovo movimento','tx.modal.edit':'Modifica movimento',
      'tx.modal.new_exp':'Nuova uscita','tx.modal.new_inc':'Nuova entrata',
      'rel.modal.new':'Nuova release','rel.modal.edit':'Modifica release',
      'ai.title':'Assistente AI','ai.sub':'Consigli sulla situazione della tua etichetta.',
      'ai.locked':'L\'assistente AI è disponibile con i piani Studio e Agency.','ai.see_plans':'Vedi i piani',
      'ai.analyze':'Analizza la mia etichetta','ai.again':'Analizza di nuovo','ai.thinking':'Sto analizzando i tuoi dati…',
      'ai.err_plan':'Funzione dei piani Studio/Agency.','ai.err_auth':'Accedi per usare l\'assistente.',
      'ai.err_offline':'Servizio non raggiungibile (sei offline?).','ai.err_config':'Assistente non ancora configurato.',
      'ai.err_refused':'Non posso rispondere a questa richiesta.','ai.err_generic':'Si è verificato un errore. Riprova.',
      'recoup.recoupable':'Recuperabile','recoup.royalties':'Royalty (a vita)','recoup.recouped':'Recuperato',
      'recoup.unrecouped':'Non recuperato','recoup.payable':'Da pagare','recoup.advance':'Anticipo',
      'recoup.cost':'Costo recuperabile','recoup.empty':'Nessun anticipo o costo registrato.',
      'recoup.need':'Inserisci artista e importo',
    },
    en:{
      'nav.dashboard':'Dashboard','nav.transactions':'Transactions','nav.releases':'Releases',
      'nav.royalties':'Royalties','nav.import':'Import CSV','nav.settings':'Settings',
      'nav.faq':'Help & FAQ','nav.about':'About','nav.more':'More','nav.offers':'Plans',
      'nav.artists':'Artists','nav.contracts':'Contracts','nav.tasks':'Tasks',
      'common.export':'Export','common.save':'Save','common.cancel':'Cancel','common.close':'Close','common.edit':'Edit',
      'common.delete':'Delete','common.signout':'Sign out','common.all_periods':'All periods',
      'common.period.ytd':'Year to date','common.period.12m':'Last 12 months','common.period.6m':'Last 6 months',
      'common.period.3m':'Last 3 months','common.period.custom':'Custom…',
      'common.theme':'Theme','common.language':'Language',
      'theme.system':'◐ System','theme.light':'☀ Light','theme.dark':'☾ Dark',
      'dash.kpi.income':'Income','dash.kpi.expense':'Expenses','dash.kpi.net':'Net margin','dash.kpi.count':'Transactions',
      'dash.chart.title':'Income vs Expenses by month','dash.legend.income':'Income','dash.legend.expense':'Expenses',
      'dash.byrelease':'By release / catalog','dash.byartist':'By artist',
      'dash.byplatform':'By platform','dash.bytype':'By type',
      'dash.customize':'⚙ Customize','dash.columns':'Columns','dash.reset':'↺ Reset','dash.done':'✓ Done','dash.hidden':'Hidden','dash.none_hidden':'Nothing hidden',
      'dash.forecast':'Projected cashflow','dash.forecast_sub':'3-month projection on the recent trend','dash.forecast_avg':'Average monthly net','dash.forecast_note':'Indicative estimate based on the average of recent months. Not a guaranteed forecast.','dash.forecast_empty':'A few months of data are needed for the projection.',
      'dash.top_artists':'Top artists','dash.recent':'Recent movements',
      // Artists
      'art.title':'Artists','art.subtitle':'Your roster address book: contacts, photos and data for contracts and payments.',
      'art.search':'Search artist…','art.new':'New artist','art.edit':'Edit artist','art.photo':'Photo','art.upload':'Upload photo',
      'art.name':'Stage name *','art.legal':'Legal name','art.email':'Email','art.phone':'Phone','art.iban':'IBAN',
      'art.split':'Default split %','art.address':'Address','art.note':'Notes','art.save':'Save artist',
      'art.empty':'No artists yet. Add your first one to start creating contracts and reminders.',
      'art.need_name':'Enter the stage name.','art.saved':'Artist saved','art.deleted':'Artist deleted','art.del_confirm':'Remove {name} from the address book?',
      // Contracts
      'con.title':'Contracts','con.subtitle':'Generate a standard split contract, ready to email to your artists.',
      'con.new':'New contract','con.build':'Fill in the contract','con.work':'Work / Release *','con.date':'Date',
      'con.royalty':'Royalty on net income %','con.advance':'Advance (€)','con.territory':'Territory','con.territory_ph':'Worldwide',
      'con.term':'Term','con.term_ph':'2 years','con.splits':'Split between artists','con.add_split':'＋ Add artist',
      'con.generate':'⚙ Generate contract','con.preview':'Contract preview','con.print':'⤓ Print / PDF','con.send':'✉ Send to artists',
      'con.back':'‹ Edit','con.saved':'Saved contracts','con.empty':'No contracts yet. Create one with “New contract”.',
      'con.pick_artist':'— Pick artist —','con.world':'Worldwide','con.need_work':'Enter the work or release.','con.need_artist':'Add at least one artist.',
      'con.no_advance':'no advance','con.parties_short':'Parties','con.status':'Status','con.st_sent':'Sent','con.st_draft':'Draft','con.open':'Open',
      'con.no_emails':'No email among the artists: update the address book.','con.sent':'Contract ready to send','con.del_confirm':'Delete this contract?',
      'con.mail_subject':'Contract — {work} ({label})','con.mail_foot':'— Sent with Label Finance',
      'con.doc_title':'Royalty split agreement','con.doc_parties':'Parties','con.doc_terms':'Terms',
      'con.doc_intro':'This agreement is entered into between the label {label} (the “Label”) and the artists listed below (the “Artists”), and governs the split of proceeds related to the work {work}.',
      'con.cl_royalty':'The Artists collectively are entitled to {pct} of the net income generated by the work, net of distribution costs and fees.',
      'con.cl_split':'The Artists’ share is split among them according to the split percentages set out in the Parties section.',
      'con.cl_advance':'The Label grants a recoupable advance of {adv}, deductible from future royalties.',
      'con.cl_territory':'This agreement is valid for the following territory: {ter}.',
      'con.cl_term':'The term of this agreement is {term}, unless otherwise agreed in writing by the parties.',
      'con.cl_report':'The Label will provide the Artists with a periodic statement of proceeds and accrued shares.',
      'con.cl_law':'For anything not expressly provided herein, the parties refer to the applicable law in force.',
      // Tasks
      'tsk.title':'Tasks','tsk.subtitle':'Reminders for payments, contract sending and label deadlines.',
      'tsk.what':'What needs doing *','tsk.what_ph':'E.g. Pay royalties to Mario','tsk.type':'Type','tsk.due':'Due date','tsk.add':'＋ Add task',
      'tsk.t_payment':'Payment','tsk.t_contract':'Contract','tsk.t_other':'Other','tsk.completed':'Completed',
      'tsk.empty':'No tasks. Add your first reminder above.','tsk.need_title':'Write what needs doing.','tsk.added':'Task added',
      'dash.report_pdf':'⤓ PDF report','dash.filter':'Filter…',
      'tx.title':'Transactions','tx.add_expense':'+ Expense','tx.add_income':'+ Income',
      'tx.search':'Search product, artist, catalog…','tx.all_kinds':'All types',
      'tx.only_income':'Income only','tx.only_expense':'Expenses only','tx.all_platforms':'All platforms',
      'tx.cols':'⚙ Columns','tx.export':'⤓ Export',
      'rel.title':'Releases','rel.export':'⤓ Export','rel.new':'+ New release',
      'rel.intro':'Define catalog, title and the revenue split (%) per artist. Sales with the same catalog will automatically use these shares in the Royalties section.',
      'roy.title':'Royalties','roy.subtitle':'What each artist is owed, calculated on net income.',
      'roy.export':'⤓ Export','roy.byartist':'By artist','roy.statement':'⤓ PDF statement',
      'imp.title':'Import CSV',
      'imp.subtitle':'Upload a file from Bandcamp, your distributor or any platform. Map the columns once.',
      'set.title':'Settings','set.subtitle':'Sync, appearance, exchange rates, backup and data management.',
      'set.sync':'☁ Cloud sync','set.appearance':'Appearance','set.language':'Language',
      'set.rates':'Exchange rates → EUR','set.backup':'Backup & data',
      'set.name':'First name','set.surname':'Last name','set.label':'Label name','set.save_profile':'Save profile',
      'set.refresh':'Refresh now','set.change_pw':'Change password',
      'about.title':'About','about.subtitle':'The back office for independent labels.',
      'about.mission_t':'Our mission','about.team_t':'The team','about.rights':'All rights reserved.',
      'about.tm':'All trademarks cited (Bandcamp, DistroKid, Believe, Symphonic…) belong to their respective owners.',
      'about.credits':'Credits','credits.product':'Product','credits.version':'Version','credits.dev':'Development & design','credits.founder':'Founder',
      'off.title':'Plans & Pricing','off.subtitle':'Manage multiple labels from one account. Pick the plan that fits your roster.',
      'off.monthly':'Monthly','off.annual':'Yearly','off.activate':'Activate','off.current':'Current plan',
      'off.billed':'billed annually','off.year':'year','off.instead':'instead of',
      'gate.upgrade':'Available on the {plan} plan',
      'faq.title':'Help & FAQ','faq.subtitle':'Answers to the most common questions. Search a word or browse by topic.',
      'faq.search':'Search the guide… (e.g. ISRC, CSV, royalties, password)',
      'gate.sub_login':'Sign in to your back office','gate.sub_signup':'Create your account',
      'gate.name':'First name','gate.surname':'Last name','gate.label':'Label name','gate.email':'Email','gate.password':'Password',
      'gate.forgot':'Forgot password?','gate.signin':'Sign in','gate.signup':'Sign up',
      'col.date':'Date','col.dateTo':'Date (to)','col.platform':'Platform','col.type':'Type',
      'col.catalog':'Catalog','col.product':'Product','col.artist':'Artist','col.qty':'Qty',
      'col.gross':'Gross','col.shipping':'Shipping','col.taxes':'Taxes','col.payProcFees':'Processor fees',
      'col.fees':'Fees','col.csShare':'Coll. society','col.net':'Net','col.currency':'Currency','col.note':'Note',
      'greet.hi':'Hi,','tx.movements':'transactions','rel.count':'releases',
      'g.income':'Income','g.expense':'Expenses','g.margin':'Margin',
      'roy.h.artist':'Artist','roy.h.amount':'Royalties (€)','roy.h.release':'Release',
      'roy.label_residual':'Label (remaining share)','roy.total':'Total','roy.detail':'Detail',
      'roy.click_artist':'Click an artist for the per-release breakdown.',
      'empty.noperiod':'No data in this period.','empty.notx':'No transactions.',
      'empty.norel':'No releases yet. Create one to start calculating royalties.',
      'empty.noroy':'No income linked to a release catalog.',
      't.label_min':'At least one label must remain','t.label_deleted':'Label deleted',
      't.label_active':'Active label: ','t.upgrade':'Upgrade your plan to add more labels',
      't.label_added':'Label added','t.plan_activated':'Plan activated: ',
      't.demo_loaded':'Demo data loaded','t.rel_deleted':'Release deleted',
      't.cat_required':'Enter the catalog','t.rel_saved':'Release saved',
      't.tx_deleted':'Transaction deleted','t.saved':'Saved',
      't.map_min':'Map at least Net or Gross','t.imported':'imported','t.dupes_skipped':'duplicates skipped',
      't.preset_name':'Name the preset','t.preset_saved':'Preset saved',
      't.rate_required':'Enter currency and rate','t.backup_restored':'Backup restored',
      't.file_invalid':'Invalid file','t.data_wiped':'Data cleared',
      // Pannelli Informazioni (HTML)
      'info.dashboard':`<h4>What the Dashboard is for</h4>
        <p>It's the instant snapshot of your label. At the top you find the four key metrics: <b>Income</b>, <b>Expenses</b>, <b>Net margin</b> (income − expenses) and number of <b>Transactions</b>. The colored percentage under each value compares the selected period with the previous one, so you can see whether you're growing or declining.</p>
        <p>The chart shows income and expenses month by month. The tables below aggregate data <b>by release/catalog</b> and <b>by artist</b>, so you instantly see what earns the most.</p>
        <p>With the <b>period</b> menu in the top right you filter everything to a range (year, last 12 months… or <b>Custom</b> with your own dates). The <b>PDF report</b> button prints or saves a summary to archive or send.</p>
        <p class="muted" style="font-size:.86rem">Tip: data comes from Transactions. If the dashboard is empty, import a CSV or add a transaction manually.</p>`,
      'info.transactions':`<h4>What the Transactions section is for</h4>
        <p>It's the complete ledger of every <b>income</b> and <b>expense</b> of the label: the foundation dashboard and royalties are built on. Each row is a transaction with date, type, product/description, artist, catalog, platform and amount.</p>
        <p>You can add them two ways: manually with <b>+ Income</b> / <b>+ Expense</b>, or in bulk by importing a CSV from the <b>Import</b> section. The <b>Catalog</b> field matters: it's the code that links a sale to its release and therefore to the royalty splits.</p>
        <p>The toolbar lets you <b>search</b>, filter by type, platform and date range. With <b>⚙ Columns</b> you choose which columns to show; with <b>Export</b> you download everything in CSV, Excel or PDF.</p>`,
      'info.releases':`<h4>What Releases are for</h4>
        <p>A release is a catalog output (single, EP, album). Here you define, once, <b>who gets what</b>: for each release you set a <b>catalog</b> (e.g. <i>RHD001</i>) and the <b>revenue split</b> as a percentage among the artists/rights holders.</p>
        <p>The link happens through the <b>catalog</b>: every sale in Transactions with that code automatically inherits these shares in the Royalties calculation. You set the percentages once and they apply to all future sales of that release.</p>
        <p><b>Per-track override (ISRC).</b> Sometimes the shares aren't the same for every track of an EP: maybe track 2 has a featuring that changes the split. Opening a release you can add the individual tracks with their <b>ISRC code</b> and give each different shares. When a sale reports that ISRC, the app uses the shares of <b>that track</b> instead of the release's general ones.</p>
        <span class="ex">Example — EP <b>RHD007</b>, general shares: Raho 50%, Jacom 50%.<br>Add track 2 (ISRC <i>ITRH72500002</i>) with a feat and set: Raho 40%, Jacom 35%, Pol 25%.<br>→ Sales of the whole EP split 50/50, but those of <b>track 2 only</b> (recognized by the ISRC) split 40/35/25. If a sale has no ISRC, or an unmapped ISRC, the release's general shares are used.</span>
        <p class="muted" style="font-size:.86rem">The ISRC is the track's unique international code (12 characters, e.g. <i>ITRH72500002</i>): you find it in your distributor's report. If you don't work per track, just ignore the tracks: setting the release's general shares is enough.</p>`,
      'info.royalties':`<h4>What the Royalties section is for</h4>
        <p>It automatically calculates <b>what each artist is owed</b>. It takes every sale (income) in Transactions, finds the release with the same <b>catalog</b> and applies the <b>splits</b> defined in that release. The total per artist is what you see in the table.</p>
        <p>If you set a <b>per-track override (ISRC)</b> in the release, sales with that ISRC use the single track's shares; all others use the release's general shares. Sales with a catalog not linked to any release stay out of the calculation (you can tell because they don't appear).</p>
        <p>Click an artist for the <b>per-release breakdown</b> and use <b>PDF statement</b> to generate a ready-to-send report. The <b>period</b> menu limits the calculation to a range (handy for quarterly/yearly payments).</p>
        <p class="muted" style="font-size:.86rem">Royalties are calculated on <b>net income</b>: they're a share of revenue, not of expenses. If an artist is missing, check that the sales have the right catalog and that the release exists.</p>`,
      'info.import':`<h4>What CSV Import is for</h4>
        <p>Distributors and platforms (Bandcamp, DistroKid, Believe, Symphonic…) give you sales reports as <b>CSV</b> files. Here you upload them and turn them into Transactions, without entering rows by hand.</p>
        <p>Every platform uses different column names. The <b>mapping</b> lets you say once «the <i>Net Amount</i> column is the amount», «<i>Item</i> is the product» and so on. You can save the mapping as a <b>preset</b>: next time you pick the preset and the import is instant. <b>Auto-detect</b> recognizes the most common distributors and pre-fills everything.</p>
        <p>All processing happens in your browser: <b>no file is uploaded to a server</b>. After the preview you confirm and the rows enter Transactions.</p>`,
      'info.settings':`<h4>What Settings are for</h4>
        <p><b>Cloud sync:</b> turning it on you see the same data on computer and phone and keep it safe online. Without sync, data stays only on this device/browser.</p>
        <p><b>Profile &amp; labels:</b> manage your name, your labels (you can have more than one and switch between them) and your plan. Each label has separate transactions, releases and settings.</p>
        <p><b>Appearance:</b> light/dark/system theme. <b>Exchange rates:</b> if you sell in different currencies, here you set the conversion to your main currency. <b>Backup:</b> export or re-import all data as a file, useful before switching device or as a safety copy.</p>`,
      'info.offers':`<h4>How the plans work</h4>
        <p>The plan determines how many <b>labels</b> you can manage from the same account and which advanced features you get. You can change it anytime: your data always stays yours.</p>
        <ul>
          <li><b>Starter</b> — for those launching their own label: one label, accounting, royalties, CSV import and reports.</li>
          <li><b>Studio</b> — more labels and tools for those managing a roster.</li>
          <li><b>Agency</b> — for those managing many labels/clients, with the highest limits.</li>
        </ul>
        <p>With the <b>Monthly / Yearly</b> toggle you compare prices: the yearly plan costs less (the equivalent monthly rate is lower, up to 30% savings).</p>`,
      // FAQ — titoli gruppi
      'faq.g1':'Getting started','faq.g2':'Transactions & CSV import','faq.g3':'Releases & royalties',
      'faq.g4':'Account, sync & multiple labels','faq.g5':'Data, privacy & backup','faq.g6':'Common issues',
      // FAQ — domande
      'faq.q1':"What is Label Finance and who is it for?",
      'faq.q2':"Where do I start if everything is empty?",
      'faq.q3':"Do I need to install anything?",
      'faq.q4':"What's the «ⓘ» button in each section for?",
      'faq.q5':"How do I import sales data from Bandcamp or my distributor?",
      'faq.q6':"Do I have to redo the column mapping every time?",
      'faq.q7':"Can I avoid uploading the CSV and connect platforms via API?",
      'faq.q8':"The import creates duplicate rows. How do I avoid duplicates?",
      'faq.q9':"Amounts are in dollars/pounds: how do I convert them to euro?",
      'faq.q10':"Can I customize the Transactions table columns?",
      'faq.q11':"How does the app know who the royalties belong to?",
      'faq.q12':"What is the «per-track ISRC override» and when is it needed?",
      'faq.q13':"Where do I find a track's ISRC?",
      'faq.q14':"An artist doesn't appear in royalties. Why?",
      'faq.q15':"The percentages don't add up to 100%. Is that an error?",
      'faq.q16':"How do I generate the statement to send to an artist?",
      'faq.q17':"Are royalties calculated on expenses too?",
      'faq.q18':"How do I see the same data on computer and phone?",
      'faq.q19':"If I sell access to another user, do they see my data?",
      'faq.q20':"Can I manage multiple labels from one account?",
      'faq.q21':"How do I change name, email or plan?",
      'faq.q22':"I forgot my password.",
      'faq.q23':"Where is my data stored?",
      'faq.q24':"Does the CSV I import go online?",
      'faq.q25':"How do I back up or move data to another device?",
      'faq.q26':"Can I export data to Excel or PDF?",
      'faq.q27':"I updated but I still see the old version.",
      'faq.q28':"The Dashboard is empty even though I imported.",
      'faq.q29':"Amounts are imported wrong (e.g. 1,234 becomes 1).",
      'faq.q30':"The app looks bad on mobile.",
      'faq.q31':"I couldn't find the answer.",
      // FAQ — risposte (HTML)
      'faq.a1':`<p>It's a back office for <b>independent record labels</b>: track income and expenses, import sales reports from Bandcamp/distributors and automatically calculate the royalties to pay each artist. All on one screen, no spreadsheets.</p>`,
      'faq.a2':`<p>Three ways from the Dashboard: <b>Load demo data</b> to explore the app with fake data, <b>Import a CSV</b> from your distributor, or <b>Add manually</b> the first transaction. Then create your <b>Releases</b> with per-artist shares and Royalties calculate themselves.</p>`,
      'faq.a3':`<p>No, it works in the browser. On phone you can however <b>install it as an app</b> (PWA): open the site, browser menu → «Add to Home Screen». You'll get a dedicated icon and offline use.</p>`,
      'faq.a4':`<p>It opens an <b>Info</b> panel explaining what that section is for and how to use it. Click it again to close it.</p>`,
      'faq.a5':`<p>Go to <b>Import CSV</b>, drag the file or pick it. The app reads the columns; if it doesn't recognize the format right away, in «Map the columns» you indicate which column is the amount, which the date, etc. Check the preview and confirm. You can save the configuration as a <b>preset</b> for next time.</p>`,
      'faq.a6':`<p>No. The first time you map the columns and <b>save a preset</b> (e.g. «Bandcamp»). After that you pick that preset and the import is instant. For the most common distributors there's also <b>Auto-detect</b>.</p>`,
      'faq.a7':`<p>Today the app works via <b>CSV import</b>, the format every platform exports. A direct API connection is possible only for some platforms and requires a server-side component: it's on our roadmap. Meanwhile <b>presets</b> make the import take a few seconds.</p>`,
      'faq.a8':`<p>Keep <b>«Skip duplicates»</b> checked in the preview: rows already present (same date, product, amount…) are not re-imported. Handy if you re-upload a report that partly overlaps the previous one.</p>`,
      'faq.a9':`<p>In <b>Settings → Exchange rates</b> add the currency and the rate to euro (e.g. USD 0.92). Totals are converted using those rates.</p>`,
      'faq.a10':`<p>Yes: the <b>⚙ Columns</b> button. Check the ones to show and reorder them with the arrows.</p>`,
      'faq.a11':`<p>Through the <b>catalog</b>. In each release you set the catalog code and the per-artist shares. Every sale in Transactions with the same catalog inherits those shares, and the Royalties section sums up what each one is owed.</p>`,
      'faq.a12':`<p>It's needed when, within the same release, <b>the tracks don't all split the same way</b> — typically because one track has an extra featuring.</p>
            <p>By default the shares apply to the whole release. But you can add a track with its <b>ISRC</b> (the track's unique code) and give it different shares. Sales reporting that ISRC will use the track's shares; all the others use the release's general ones.</p>
            <span class="ex">EP <b>RHD007</b>, general shares Raho 50% / Jacom 50%. Track 2 (ISRC <i>ITRH72500002</i>) has a feat: you set Raho 40% / Jacom 35% / Pol 25%. → Track 2's sales split 40/35/25, all the others 50/50.</span>
            <p class="muted small">If all tracks split equally, you don't need it: leave the tracks alone and just use the general shares.</p>`,
      'faq.a13':`<p>It's in your distributor's report (often an «ISRC» column) and in the track metadata. It's 12 characters, e.g. <i>ITRH72500002</i>. If you don't need per-track shares, you can ignore it.</p>`,
      'faq.a14':`<p>Almost always it's the <b>catalog</b> that doesn't match: sales must have the same catalog code as the release. Check that the release exists, that the catalog is identical (including case/spaces) and that the shares are set.</p>`,
      'faq.a15':`<p>No: the part missing to 100% stays with the <b>label</b>. If Raho 50% and Jacom 30%, the remaining 20% is the label's.</p>`,
      'faq.a16':`<p>In <b>Royalties</b> click the artist to open the detail, then <b>PDF statement</b>: you get a ready-to-send document. You can limit it to a period (e.g. quarter) with the selector at the top.</p>`,
      'faq.a17':`<p>No. They're a share of <b>income</b> (revenue). Expenses affect the label's margin in the Dashboard, not the artists' shares.</p>`,
      'faq.a18':`<p>Turn on <b>Cloud sync</b> in Settings and sign in with the same account on both devices. Without sync, data stays only on the device where you entered it.</p>`,
      'faq.a19':`<p>No. Each account sees <b>only its own data</b>: it's isolated per user. Different accounts share nothing.</p>`,
      'faq.a20':`<p>Yes, with the Studio/Agency plans. Each label has separate transactions, releases and settings and you switch between them from the Account menu. Add and remove labels from Settings.</p>`,
      'faq.a21':`<p>Name and label name in <b>Settings → Account</b>. The plan is chosen in <b>Plans &amp; Pricing</b>. Your data stays yours when you change plan.</p>`,
      'faq.a22':`<p>Use password recovery from the sign-in screen. If sync isn't active yet, local data has no password: the password is only for the cloud.</p>`,
      'faq.a23':`<p>On your <b>device/browser</b> (localStorage). If you turn on sync, it's also saved in your private cloud space, accessible only from your account.</p>`,
      'faq.a24':`<p>No. Reading and processing the CSV happen <b>in your browser</b>: the file is not uploaded to any server.</p>`,
      'faq.a25':`<p>In <b>Settings → Backup &amp; data</b>, <b>Export backup (.json)</b>. On the other device use <b>Restore backup</b>. Alternatively turn on sync and the data aligns by itself.</p>`,
      'faq.a26':`<p>Yes. Almost every section and card has an <b>Export</b> (⤓) button with CSV, Excel and PDF. For the Dashboard there's also the <b>PDF report</b>.</p>`,
      'faq.a27':`<p>It's the browser cache. Do a <b>hard reload</b> (Ctrl/Cmd + Shift + R) or close and reopen the installed app. Data is not lost.</p>`,
      'faq.a28':`<p>Check the <b>period</b> selected in the top right: if it's narrow it might exclude your transactions. Set «All periods». Also check you're on the right label in the Account menu.</p>`,
      'faq.a29':`<p>Often it's the <b>separator</b> or the file's number/date format. In «File settings» choose the correct separator and the platform's date format, then recheck the preview.</p>`,
      'faq.a30':`<p>Install it as an app (Add to Home Screen) for the best result and rotate to portrait. If something overflows the edges after an update, do a hard reload.</p>`,
      'faq.a31':`<p>Write to us from <b>About</b>. Say what you were doing and, if you can, attach a .json backup: we'll help you solve it.</p>`,
      // Onboarding / account / piani / modali / impostazioni
      'onb.intro':'Get started in seconds — pick how to begin:',
      'onb.demo':'✨ Load demo data','onb.import':'⤓ Import a CSV','onb.manual':'+ Add manually',
      'acct.add':'＋ Add label','acct.offers':'Plans & pricing','acct.settings':'Account settings',
      'plan.free.desc':'For those launching their own independent label.',
      'plan.studio.desc':'For those managing multiple projects and labels.',
      'plan.agency.desc':'For managers and agencies with multiple rosters.',
      'tx.modal.new':'New transaction','rel.modal.new':'New release',
      'rel.splits_default':'Default split','rel.tracks_override':'Tracks — per-ISRC override',
      'rel.add_artist':'+ Add artist','rel.add_track':'+ Add track','rel.save':'Save release',
      'cols.title':'Transaction columns','cols.reset':'Reset to default','common.done':'Done',
      'set.export_json':'⤓ Export backup (.json)','set.export_csv':'⤓ Export transactions (.csv)',
      'set.restore':'⤴ Restore backup','set.wipe':'Delete all data','set.update_pw':'Update password',
      'set.photo':'Upload photo','set.photo_rm':'Remove','set.photo_hint':'JPG/PNG, auto-cropped and resized.',
      'f.date':'Date','f.dateTo':'Transaction date (to)','f.platform':'Platform','f.catalog':'Catalog',
      'f.product':'Product / Title','f.artist':'Artist','f.isrc':'ISRC','f.upc':'UPC','f.qty':'Quantity',
      'f.gross':'Gross','f.shipping':'Shipping','f.taxes':'Taxes','f.payproc':'Payment processor fees',
      'f.fees':'Fees','f.net':'Net','f.csshare':'Collection society share','f.currency':'Currency','f.note':'Note',
      'r.catalog':'Catalog','r.title':'Title','r.year':'Year','f.type':'Type',
      'about.p1':`We give <strong>independent labels</strong> a simple, modern tool to manage <strong>income, expenses and royalties</strong>: importing sales reports, automatic per-artist split calculation and ready-to-send statements.`,
      'about.p2':'Crafted with care for music makers. Same address, same data on every device.',
      'onb.title':`Welcome to Label<span class="lf-fin">Finance</span> 🎛️`,
      'onb.s1':'Import your sales reports (Bandcamp/distributor) or load the demo data.',
      'onb.s2':`Create your <b>Releases</b> with per-artist shares (even per single track).`,
      'onb.s3':`Watch <b>Royalties</b> and the <b>Dashboard</b> calculate themselves, and export to PDF/Excel/CSV.`,
      'pf.free1':'1 label','pf.free2':'Income, expenses and royalties','pf.free3':'CSV import (Bandcamp, distributors)',
      'pf.free4':'Dashboard and PDF reports','pf.free5':'Sync across all devices',
      'pf.studio1':'Up to 3 labels','pf.studio2':'Quick switch between labels','pf.studio3':'Everything in Starter',
      'pf.studio4':'Per-artist royalty statements','pf.studio5':'Priority support',
      'pf.agency1':'Unlimited labels','pf.agency2':'Everything in Studio','pf.agency3':'Advanced exports',
      'pf.agency4':`Team access <em>(coming soon)</em>`,'pf.agency5':'Dedicated onboarding',
      'ty.digital':'Digital','ty.physical':'Physical','ty.streaming':'Streaming','ty.merch':'Merch',
      'ty.expense':'Expense','ty.other':'Other',
      'acct.your_labels':'Your labels','acct.plan':'Plan',
      'tx.modal.edit':'Edit transaction','tx.modal.new_exp':'New expense','tx.modal.new_inc':'New income',
      'rel.modal.edit':'Edit release',
      'ai.title':'AI Assistant','ai.sub':'Advice on your label\'s situation.',
      'ai.locked':'The AI assistant is available on the Studio and Agency plans.','ai.see_plans':'See plans',
      'ai.analyze':'Analyze my label','ai.again':'Analyze again','ai.thinking':'Analyzing your data…',
      'ai.err_plan':'A Studio/Agency plan feature.','ai.err_auth':'Sign in to use the assistant.',
      'ai.err_offline':'Service unreachable (are you offline?).','ai.err_config':'Assistant not configured yet.',
      'ai.err_refused':'I can\'t answer this request.','ai.err_generic':'Something went wrong. Try again.',
      'recoup.title':'Recoupment & advances','recoup.sub':'Advances and recoupable costs offset against earned royalties (lifetime balance).',
      'recoup.artist':'Artist','recoup.note':'Note','recoup.add':'+ Add',
      'recoup.advance':'Advance','recoup.cost':'Recoupable cost',
      'recoup.recoupable':'Recoupable','recoup.royalties':'Royalties (lifetime)','recoup.recouped':'Recouped',
      'recoup.unrecouped':'Unrecouped','recoup.payable':'Payable',
      'recoup.empty':'No advances or costs recorded.','recoup.need':'Enter artist and amount',
      'info.recoup':`<h4>What Recoupment is for</h4>
          <p>When you advance money to an artist (an <b>advance</b>) or cover <b>recoupable costs</b> on their behalf (studio, video, promo), those amounts must be <b>recovered from their royalties</b> before you pay them the rest.</p>
          <p>Here you record advances and costs per artist. The app compares the <b>total recoupable</b> with the <b>earned royalties</b> (lifetime) and shows how much has already been <b>recouped</b>, how much is left (<b>unrecouped</b>) and how much, if any, is <b>payable</b> to the artist beyond recoupment.</p>
          <span class="ex">Example — €1,000 advance to Raho. Royalties earned so far: €700. → Recouped €700, <b>unrecouped</b> €300, payable €0. Once royalties pass €1,000, the difference becomes "payable".</span>`,
    }
  };

  let lang = localStorage.getItem(KEY) ||
    ((navigator.language||'it').toLowerCase().startsWith('en') ? 'en' : 'it');

  function t(k){ const d=DICT[lang]||DICT.it; return (d && d[k]) || DICT.it[k] || k; }

  function dv(k){ return DICT[lang] && DICT[lang][k]; }
  function apply(root){
    root=root||document;
    // testo: il contenuto originale (italiano inline) è il fallback se manca la chiave
    root.querySelectorAll('[data-i18n]').forEach(el=>{
      if(el.__i18nT==null) el.__i18nT=el.textContent;
      el.textContent=dv(el.getAttribute('data-i18n')) || el.__i18nT;
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el=>{
      if(el.__i18nOrig==null) el.__i18nOrig=el.innerHTML;
      el.innerHTML=dv(el.getAttribute('data-i18n-html')) || el.__i18nOrig;
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(el=>{
      if(el.__i18nPh==null) el.__i18nPh=el.getAttribute('placeholder')||'';
      el.setAttribute('placeholder', dv(el.getAttribute('data-i18n-ph')) || el.__i18nPh);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el=>{
      if(el.__i18nTi==null) el.__i18nTi=el.getAttribute('title')||'';
      el.setAttribute('title', dv(el.getAttribute('data-i18n-title')) || el.__i18nTi);
    });
    document.documentElement.lang=lang;
    document.querySelectorAll('[data-lang-opt]').forEach(b=>b.classList.toggle('is-active', b.getAttribute('data-lang-opt')===lang));
  }
  function setLang(l){ if(!DICT[l]) return; lang=l; localStorage.setItem(KEY,l); apply(); window.dispatchEvent(new CustomEvent('langchange',{detail:l})); }
  function wire(){ document.querySelectorAll('[data-lang-opt]').forEach(b=>b.onclick=()=>setLang(b.getAttribute('data-lang-opt'))); }

  window.LFI18N={ t, setLang, apply, get lang(){ return lang; } };
  window.t=t;

  function init(){ apply(); wire(); window.dispatchEvent(new CustomEvent('langchange',{detail:lang})); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
