# Analisi Finanziarie

Gestione completa della finanza personale, con le simulazioni finanziarie di prima
(rifatte e corrette). Si accede con **email e password** (lo stesso account di
[RH] Documents) e i dati sono sincronizzati tra telefono e computer, **cifrati nel
browser** prima di partire: online c'è solo testo illeggibile. Si può usare anche senza
account, solo su un dispositivo. Nessun tracciamento.

Indirizzo: `https://rahodavide95-sketch.github.io/RHDev/finanza-personale/`
(si aggiorna da solo dopo ogni modifica su `main`).

## Cosa fa

- **Panoramica**: patrimonio netto con il grafico degli ultimi mesi, entrate e uscite
  del mese con la previsione a fine mese, spese per categoria, scadenze in arrivo,
  budget, obiettivi, investimenti e consigli ("la liquidità copre 9 mesi di spese",
  "gli abbonamenti costano X all'anno", "questo mese spendi di più in…").
- **Movimenti**: uscite, entrate e giroconti (anche tra valute diverse), categorie,
  etichette `#vacanze`, note, "da verificare". Ricerca per nome, nota, etichetta o
  importo, filtri per periodo/conto/categoria/tipo, selezione multipla (cambia
  categoria, etichetta, elimina con "Annulla"), esportazione CSV per Excel.
  Gli importi accettano piccoli calcoli: `12,50+7,5`.
- **Import dell'estratto conto** (CSV di qualsiasi banca): riconosce colonne, date e
  importi all'italiana, salta le righe di intestazione, suggerisce le categorie e
  **esclude i doppioni** se reimporti lo stesso file.
- **Patrimonio**: l'andamento mese per mese di ogni cosa che hai (conti, investimenti,
  casa, auto, fondo pensione) e dei debiti, in una tabella con i valori a fine mese e la
  variazione di ogni mese; il confronto tra il 31 dicembre dell'anno prima e la fine
  dell'anno (o oggi) per ogni conto, con la spiegazione della differenza: quanto hai
  **risparmiato**, quanto vale ciò che hai **aggiunto** e quanto è dovuto a **variazioni
  di valore** (mercati, casa e auto, debito che scende); il riepilogo anno per anno.
  "Aggiorna i valori" ti fa scrivere in un colpo solo il valore reale di più conti a una
  data (oggi o la fine del mese scorso), anche nel passato per ricostruire lo storico.
  Esporta la tabella in CSV.
- **Conti**: conto corrente, deposito, contanti, carte, investimenti, crypto, fondo
  pensione, casa, auto, crediti, mutui e prestiti (con piano d'ammortamento: il debito
  residuo scende da solo ogni mese). "Aggiorna saldo" allinea il conto all'estratto
  conto senza falsare lo storico.
- **Investimenti**: ETF, azioni, BTP, obbligazioni, fondi, crypto, oro. Acquisti,
  vendite, cedole/dividendi e costi; prezzo medio di carico (costo medio ponderato),
  guadagno, rendimento, allocazione, **tasse se vendi oggi** (26%, titoli di Stato
  12,5%, crypto 33%) e bollo stimato. Prezzi aggiornabili online (facoltativo).
  Ogni titolo ha tipo, **categoria** (es. "Azioni USA", "Oro") e **TER**; le vendite
  registrano l'**imposta trattenuta** (con la stima). Tre schede:
  - *Portafoglio*: valore, guadagni, allocazione per tipo, categoria, conto o valuta.
  - *Operazioni*: tutte le operazioni in un registro, con filtri, CSV, **"Registra il
    PAC"** (gli acquisti del mese in un colpo solo) e **imposta di bollo**.
  - *Anno per anno*: investito mese per mese (con totale e media), investito per tipo,
    categoria, titolo (con quote e prezzo medio) o conto, e rendite, tasse e costi.
- **Prezzi aggiornati da soli** (con il consenso): per codice ISIN da onvista.de, con i
  prezzi della LS Exchange (la borsa di Trade Republic) o di Tradegate/Xetra/Milano; si
  aggiornano all'apertura e ogni 3 ore. I titoli senza ISIN si collegano in un passo: l'app
  li cerca per nome e per prezzo dell'ultimo acquisto e fa confermare.
- **Entrate e uscite** mese per mese, come in un foglio: categoria → sottocategoria → voce
  (descrizione), una colonna per mese, totale e media mensile, CSV; tocca un importo per i
  movimenti. **Categorie in libertà**: crea, rinomina, colora, riordina, nascondi, unisci.
- **Import di tutto il file Excel** (.xlsx, o CSV per un foglio alla volta): ogni foglio
  si riconosce dalla sua intestazione, non dal nome. Fogli delle operazioni (wallet dei PAC
  e **crypto**: COIN, QUANTITA', VALORE, PIATTAFORMA…), fogli **mese per mese** delle
  entrate e delle uscite (CATEGORIA, SUB CATEGORIA, NOTE, GEN…DIC) e il foglio del
  **patrimonio** (Net Worth, con le date di fine mese). Anteprima foglio per foglio,
  righe di totale/guadagno/% e Asset Allocation saltate e usate per il **controllo al
  centesimo**, valori strani (errori di battitura) esclusi, titoli del Net Worth già negli
  investimenti esclusi (niente doppi conteggi), doppioni esclusi se reimporti, un solo
  "Annulla".
- **Net Worth come il tuo foglio**: sezioni (Cash - Liquidity, ETF, Stock, Crypto, WORK…)
  con conti e singoli titoli, a fine mese, e per ogni sezione Total, Gain/Loss in euro e in %;
  in fondo patrimonio netto e Asset Allocation. Si organizza a piacere, si filtra, CSV.
- **Entrate e uscite "come il foglio"**: CATEGORIA, SUB CATEGORIA, NOTE, i 12 mesi, TOTALI e
  MEDIA MENS., con le categorie colorate e ferme mentre scorri.
- **Colori a scelta**: palette Excel (blu e grigio), Oceano, Smeraldo, Grafite, Viola o i
  tuoi colori; righe alterne, tabelle compatte, colonne allargabili, barra laterale
  comprimibile, pagina a tutta larghezza; loghi delle banche e delle crypto (salvati
  nell'app, nessuna richiesta esterna).
- **Storia di ogni titolo e crypto**: quanto hai speso, quando, ogni quanto compri
  (regolare come un PAC o no), acquisto medio e più grande, prezzo pagato più basso, più
  alto e medio, commissioni, anno per anno; in "Anno per anno" la tabella titolo per
  titolo e il filtro **Tutto / Titoli / Crypto** per ogni statistica.
- **Budget** mensile per categoria, con la riga di "dove dovresti essere oggi" e le
  **proposte automatiche** dalla media degli ultimi mesi.
- **Scadenze e abbonamenti**: stipendio, affitto, bollette, PAC… con calendario,
  registrazione automatica o su conferma (per gli importi che cambiano), costo
  annuo degli abbonamenti.
- **Obiettivi** di risparmio: quanto mettere da parte al mese per arrivarci in tempo,
  anche collegati a un conto.
- **Analisi**: entrate/uscite e risparmio mese per mese, tasso di risparmio, dove
  vanno i soldi con il confronto col periodo prima, andamento di una categoria,
  dove spendi di più, giorni della settimana, patrimonio nel tempo.
- **Simulazioni** (regole fiscali italiane): PAC e interesse composto, conto deposito,
  conto corrente remunerato, mutuo e prestiti con TAEG ed estinzione anticipata,
  indipendenza finanziaria (FIRE), inflazione, BTP e obbligazioni, costo reale delle
  spese fisse. Il pulsante "I miei dati" riempie i campi con i tuoi numeri.
- **Mercati**: indici, ETF, azioni, materie prime, valute e crypto con grafici
  (solo se attivi i dati online).
- **Ricerca rapida** (⌘K / Ctrl K) e scorciatoie: `N` nuovo movimento, `H` nascondi
  importi, `L` blocca, `/` cerca.
- Temi chiaro, scuro e automatico; funziona offline; si installa come app.

## Cosa è stato corretto rispetto alla versione precedente

- **PAC/ETF**: la tassa del 26% veniva tolta ogni anno dal rendimento. Per ETF e fondi
  si paga solo quando si vende, sul guadagno: ora è così (prima il risultato netto era
  sottostimato). Aggiunti TER, bollo 0,20%, inflazione, scenari e rendimento effettivo.
  Un PAC può partire da zero euro (prima veniva rifiutato).
- **Conto corrente**: il grafico usava interessi annuali mentre i numeri usavano quelli
  mensili, e il bollo da 34,20 € veniva segnalato ma non tolto. Ora i calcoli sono
  coerenti e il bollo è sottratto (in proporzione ai mesi).
- **Conto deposito**: scelta del tipo di bollo (0,20%, 34,20 €, pagato dalla banca),
  interessi capitalizzati o accreditati sul conto, versamenti mensili, rendimento
  netto effettivo.
- Importi gestiti in **centesimi interi** (niente errori di arrotondamento).
- Librerie esterne tolte: niente più Chart.js da CDN senza versione, niente font di
  Google (che rivelavano a Google ogni apertura). Grafici e caratteri sono nell'app.
- Le quotazioni non passano più da proxy pubblici: si chiede il consenso e i prezzi vanno
  direttamente alla fonte (onvista.de per codice ISIN; crypto da Binance; cambi dalla BCE).

## Privacy e sicurezza in breve

Dettagli in [`docs/SICUREZZA.md`](docs/SICUREZZA.md).

- Dati cifrati con **AES-256-GCM**; la chiave nasce dalla password (PBKDF2-SHA256,
  600.000 passaggi) e non viene mai salvata: resta in memoria solo mentre l'app è aperta.
- **Account e sincronizzazione**: online (Supabase, lo stesso progetto di [RH] Documents)
  va solo la cassaforte già cifrata. Solo il tuo account può leggerla o scriverla, e
  nessuno può cancellarla dall'app. Se cambi qualcosa su due dispositivi, le modifiche si
  uniscono (non si sovrascrivono).
- **Codice di recupero** (mostrato alla creazione) per aprire i dati se dimentichi la
  password. Senza password e senza codice nessuno può aprirli, nemmeno lo sviluppatore.
- **Blocco automatico** dopo qualche minuto di inattività (scegli tu quanti), velo
  sfocato quando l'app va in secondo piano, "nascondi importi" per l'uso in pubblico.
- **Backup cifrato** in un file (si apre solo con la tua password o il codice), più una
  copia automatica al giorno sul dispositivo per gli ultimi 7 giorni.
- Nessuna connessione verso altri siti, salvo l'account (dati cifrati) e i dati di mercato
  che attivi tu (vengono inviati solo i simboli dei titoli, mai importi o conti).

**Importante**: la password apre e cifra i dati. Se la dimentichi servono l'email (per
sceglierne una nuova) **e il codice di recupero** (per riaprire i dati): conservalo.
Senza account i dati esistono solo sul dispositivo: fai il backup cifrato ogni tanto.
Su iPhone aggiungi l'app alla schermata Home: Safari può cancellare i dati dei siti non
usati per qualche settimana, le app della schermata Home no.

## Come usarla

1. Apri l'indirizzo e tocca **Accedi con email e password** (lo stesso account di
   [RH] Documents). La prima volta **salva il codice di recupero** che compare.
2. Aggiungi i conti con il saldo di oggi, poi i movimenti o importa l'estratto conto.
3. Sugli altri dispositivi accedi con la stessa email e password: trovi tutto.
4. Su iPhone: Condividi → **Aggiungi alla schermata Home**.

Senza account: "Usa senza account, solo su questo dispositivo" (si collega dopo dalle
Impostazioni).

Vuoi solo guardarla? **Prova con dati di esempio**: dati inventati, solo in memoria.

## Per sviluppare

Nessuna compilazione: HTML, CSS e moduli JavaScript.

```bash
cd finanza-personale
python3 -m http.server 8000   # poi apri http://localhost:8000
npm test                      # test dei calcoli, della cifratura, dell'unione dei dati, del CSV, degli import e delle quotazioni
bash test/rls/run.sh          # regole di sicurezza del database su un Postgres vero (serve PostgreSQL)
```

Struttura:

| Cartella | Contenuto |
| --- | --- |
| `js/core/` | Calcoli puri e testati: importi, date e ricorrenze, simulazioni, modello dei dati, cifratura, CSV |
| `js/` | Avvio e navigazione (`app.js`), sessione, salvataggio e sincronizzazione (`session.js`), account online (`cloud.js`), archivio IndexedDB (`store.js`), operazioni (`actions.js`), dati di mercato (`market.js`), dati di prova (`demo.js`) |
| `supabase/schema.sql` | Tabelle e regole del database online (applicate dal workflow `finanza-personale-db.yml`) |
| `js/ui/` | Componenti dell'interfaccia, grafici SVG, icone, formattazione |
| `js/views/` | Le pagine dell'app e le finestre di inserimento |
| `css/app.css` | Il design (temi chiaro e scuro) |
| `sw.js` | Funzionamento offline |
| `test/` | Test automatici (`node --test`) |
