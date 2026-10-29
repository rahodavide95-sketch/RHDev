# Analisi Finanziarie

Gestione completa della finanza personale, con le simulazioni finanziarie di prima
(rifatte e corrette). Tutti i dati restano **cifrati sul tuo dispositivo**: nessun
server, nessun account, nessun tracciamento.

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
- Le quotazioni non passano più da proxy pubblici senza che tu lo sappia: si chiede il
  consenso e i prezzi del portafoglio vanno solo direttamente alle fonti.

## Privacy e sicurezza in breve

Dettagli in [`docs/SICUREZZA.md`](docs/SICUREZZA.md).

- Dati cifrati con **AES-256-GCM**; la chiave nasce dalla password (PBKDF2-SHA256,
  600.000 passaggi) e non viene mai salvata: resta in memoria solo mentre l'app è aperta.
- **Codice di recupero** (mostrato alla creazione) per aprire i dati se dimentichi la
  password. Senza password e senza codice nessuno può aprirli, nemmeno lo sviluppatore.
- **Blocco automatico** dopo qualche minuto di inattività (scegli tu quanti), velo
  sfocato quando l'app va in secondo piano, "nascondi importi" per l'uso in pubblico.
- **Backup cifrato** in un file (si apre solo con la tua password o il codice), più una
  copia automatica al giorno sul dispositivo per gli ultimi 7 giorni.
- Nessuna connessione verso altri siti, salvo i dati di mercato che attivi tu (vengono
  inviati solo i simboli dei titoli, mai importi o conti).

**Importante**: i dati esistono solo sul dispositivo. Fai il backup cifrato ogni tanto
(l'app te lo ricorda) e tienilo fuori dal telefono (iCloud Drive, chiavetta…). Su iPhone
aggiungi l'app alla schermata Home: Safari può cancellare i dati dei siti non usati
per qualche settimana, le app della schermata Home no.

## Come usarla

1. Apri l'indirizzo e tocca **Crea la tua cassaforte**, scegli una password (meglio una
   frase di 4 parole) e **salva il codice di recupero**.
2. Aggiungi i conti con il saldo di oggi, poi i movimenti o importa l'estratto conto.
3. Su iPhone: Condividi → **Aggiungi alla schermata Home**.
4. Per passare a un altro dispositivo: Impostazioni → Scarica backup → sull'altro
   dispositivo "Ho un file di backup".

Vuoi solo guardarla? **Prova con dati di esempio**: dati inventati, solo in memoria.

## Per sviluppare

Nessuna compilazione: HTML, CSS e moduli JavaScript.

```bash
cd finanza-personale
python3 -m http.server 8000   # poi apri http://localhost:8000
npm test                      # test dei calcoli, della cifratura, del CSV e delle quotazioni
```

Struttura:

| Cartella | Contenuto |
| --- | --- |
| `js/core/` | Calcoli puri e testati: importi, date e ricorrenze, simulazioni, modello dei dati, cifratura, CSV |
| `js/` | Avvio e navigazione (`app.js`), sessione e salvataggio (`session.js`), archivio IndexedDB (`store.js`), operazioni (`actions.js`), dati di mercato (`market.js`), dati di prova (`demo.js`) |
| `js/ui/` | Componenti dell'interfaccia, grafici SVG, icone, formattazione |
| `js/views/` | Le pagine dell'app e le finestre di inserimento |
| `css/app.css` | Il design (temi chiaro e scuro) |
| `sw.js` | Funzionamento offline |
| `test/` | Test automatici (`node --test`) |
