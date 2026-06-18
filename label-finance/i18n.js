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
      // Comuni
      'common.export':'Esporta','common.save':'Salva','common.cancel':'Annulla','common.close':'Chiudi',
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
      'about.title':'Chi siamo','about.subtitle':'Label Finance — il gestionale per etichette indipendenti.',
      'about.credits':'Crediti','credits.product':'Prodotto','credits.version':'Versione','credits.dev':'Sviluppo & design',
      // Offerte
      'off.title':'Offerte & Piani','off.subtitle':'Gestisci più etichette da un unico account. Scegli il piano adatto al tuo roster.',
      'off.monthly':'Mensile','off.annual':'Annuale','off.activate':'Attiva',
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
    },
    en:{
      'nav.dashboard':'Dashboard','nav.transactions':'Transactions','nav.releases':'Releases',
      'nav.royalties':'Royalties','nav.import':'Import CSV','nav.settings':'Settings',
      'nav.faq':'Help & FAQ','nav.about':'About','nav.more':'More','nav.offers':'Plans',
      'common.export':'Export','common.save':'Save','common.cancel':'Cancel','common.close':'Close',
      'common.delete':'Delete','common.signout':'Sign out','common.all_periods':'All periods',
      'common.period.ytd':'Year to date','common.period.12m':'Last 12 months','common.period.6m':'Last 6 months',
      'common.period.3m':'Last 3 months','common.period.custom':'Custom…',
      'common.theme':'Theme','common.language':'Language',
      'theme.system':'◐ System','theme.light':'☀ Light','theme.dark':'☾ Dark',
      'dash.kpi.income':'Income','dash.kpi.expense':'Expenses','dash.kpi.net':'Net margin','dash.kpi.count':'Transactions',
      'dash.chart.title':'Income vs Expenses by month','dash.legend.income':'Income','dash.legend.expense':'Expenses',
      'dash.byrelease':'By release / catalog','dash.byartist':'By artist',
      'dash.byplatform':'By platform','dash.bytype':'By type',
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
      'about.title':'About','about.subtitle':'Label Finance — the back office for independent labels.',
      'about.credits':'Credits','credits.product':'Product','credits.version':'Version','credits.dev':'Development & design',
      'off.title':'Plans & Pricing','off.subtitle':'Manage multiple labels from one account. Pick the plan that fits your roster.',
      'off.monthly':'Monthly','off.annual':'Yearly','off.activate':'Activate',
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
    }
  };

  let lang = localStorage.getItem(KEY) ||
    ((navigator.language||'it').toLowerCase().startsWith('en') ? 'en' : 'it');

  function t(k){ const d=DICT[lang]||DICT.it; return (d && d[k]) || DICT.it[k] || k; }

  function apply(root){
    root=root||document;
    root.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent=t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach(el=>{ const v=DICT[lang][el.getAttribute('data-i18n-html')]||DICT.it[el.getAttribute('data-i18n-html')]; if(v!=null) el.innerHTML=v; });
    root.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    root.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
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
