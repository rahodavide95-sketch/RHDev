# Specifica

Persona fisica residente in Italia, non esercente attività d'impresa, regime **dichiarativo**.
Perimetro attuale: **cripto** (Crypto.com App ed Exchange, altre piattaforme/wallet tramite modello universale) e
**oro e metalli preziosi** (Bitpanda). Anni selezionabili: **2023, 2024, 2025, 2026**.

## Regole applicate (stato: da verificare su fonti primarie)

I valori vengono da fonti secondarie: il sito dell'Agenzia delle Entrate non era raggiungibile durante lo sviluppo.
Fonti primarie da controllare: L. 197/2022, L. 207/2024, L. 199/2025, Circolare AdE 30/E del 27/10/2023, istruzioni
Redditi PF dell'anno. Le regole per anno sono in `app/src/tax.js` (`RULES`).

| Anno | Aliquota cripto | Franchigia | Note |
|---|---|---|---|
| 2023 | 26% | 2.000 € (sopra si tassa tutto) | permute cripto-cripto imponibili dal 2023 |
| 2024 | 26% | 2.000 € | |
| 2025 | 26% | nessuna | franchigia abolita |
| 2026 | 33% | nessuna | 26% per stablecoin in euro conformi a MiCA (E-money token; lista indicativa in `core.js`) |

Oro/metalli preziosi (art. 67 c.1 lett. c-ter TUIR): 26% tutti gli anni, paniere separato.

| Tema | Regola implementata |
|---|---|
| Costo | LIFO, un pool per asset su tutti i conti (Circ. 30/E 2023) |
| Eventi imponibili (dal 2023) | vendita in fiat, permuta cripto/cripto, cripto/stablecoin, pagamenti, commissioni pagate in cripto |
| Prima del 2023 | la permuta cripto-cripto non è un realizzo: il costo si trasferisce al nuovo asset (scelta di progetto) |
| Proventi | staking, interessi, cashback, airdrop: valore normale alla percezione = nuovo costo del lotto; non compensabili con minusvalenze da cessione (scelta prudenziale) |
| Minusvalenze | cripto compensano solo cripto; oro separato; riporto automatico dai file per 4 anni (opzione) |
| Rideterminazione 1/1/2025 | opzionale: costo = valore al 1/1/2025 (imposta sostitutiva 18% pagata a parte) |
| IVCA | 0,2% x valore finale x giorni/365, indicativa, solo cripto |
| Data fiscale | data di calendario in Italia (Europe/Rome) |
| Arrotondamento | all'euro sui totali di quadro |

Anni **precedenti al 2023**: regime diverso (soglia di giacenza), **non calcolato**.

## Principio di funzionamento

Un dato mancante o ambiguo non viene mai risolto in silenzio. Genera un punto "da controllare" e il calcolo prosegue con
l'ipotesi più prudente (costo zero, valore zero), così il risultato resta visibile ma marcato BOZZA. L'utente risolve dalla
schermata **Da controllare** (wallet proprio, costo, vendita, ignora, prezzo), senza scrivere file.

## Documenti PDF

L'Agenzia delle Entrate non ha un modulo ufficiale né richiede allegati per cripto e metalli preziosi: i dati si dichiarano
nel Modello Redditi PF (quadri RT e RW) e i calcoli si conservano per un eventuale controllo. Il programma genera quindi
**prospetti di supporto** (non moduli ufficiali), che l'utente o il commercialista usano per compilare il modello:

| Documento | Contenuto |
|---|---|
| 00 Copertina e riepilogo | contribuente, stato (BOZZA o completo), riepilogo imposte, a cosa servono i documenti, indice |
| 01 Quadro RT · cripto | dati da riportare (corrispettivi, costi, plus/minus, proventi, minus utilizzate, imponibile, imposta, minus da riportare), riepilogo per asset, metodo di calcolo |
| 02 Quadro RT · oro e metalli | idem per il paniere c-ter, con avviso sulla qualificazione |
| 03 Quadro RW | per custode/asset: giorni, valore iniziale e finale, IVCA indicativa; custode e Stato inseriti dall'utente |
| 04 Imposte e versamenti | totali, scadenze ordinarie indicative |
| A Elenco cessioni | ogni cessione con corrispettivo, costo, risultato e riga del file di origine |
| B Lotti di acquisto | per ogni cessione i lotti LIFO usati e il costo (documentazione del costo) |
| C Proventi | staking, interessi, premi al valore normale |
| D Saldi al 31/12 | per conto, da confrontare con le piattaforme |
| E Fonti, decisioni e problemi | file usati con impronta SHA-256, operazioni e prezzi inseriti a mano, decisioni dell'utente, problemi, scelte interpretative |

Ogni pagina ha intestazione, piè di pagina con la dicitura "non è un modulo ufficiale" e numero di pagina; con punti
irrisolti ogni pagina porta la filigrana BOZZA. I righi esatti dei quadri e i codici tributo non sono riportati perché le
fonti consultate erano discordanti: vanno presi dalle istruzioni del modello.

## Moduli fac-simile (Quadro RW / Quadro W)

`app/src/facsimile.js` scrive i valori sopra l'immagine del modulo dell'Agenzia delle Entrate (`app/src/assets/fx-rw.jpg`, `fx-w.jpg`, ricavate da due fac-simile di riferimento forniti dall'utente) e produce anteprima (canvas) e PDF (jsPDF) dalle stesse operazioni di disegno. Coordinate misurate sui riferimenti. Righe: una per piattaforma e per tipo (cripto / oro hanno codici diversi); se le cripto della piattaforma hanno giorni di detenzione diversi, i giorni sono la media pesata sul valore finale (segnalata «GIORNI MEDI») e l'IC è la somma calcolata attività per attività (cripto: titolo 1, codice 21, quota 100,00, criterio 1 = valore di mercato; valori in euro interi; IC = 0,2% × valore finale × giorni/365, arrotondata per riga e sommata in RW8). Disponibile solo per il periodo d'imposta 2025. Non ancora presenti: quadro RT e quadro T (plusvalenze); la compilazione dei righi per l'oro (codice da verificare). I campi «Acconti versati» restano al commercialista.

## Cosa NON è incluso (ancora)

- **API degli exchange: sperimentali, mai provate con un account reale.** Esistono i collegamenti per Crypto.com Exchange, Bitpanda
  e Binance (`app/src/api/`), costruiti sulla documentazione ufficiale e sulle librerie open source (le fonti e, per ogni punto, se è
  *verificato* o *assunto* sono nel commento di testa di ogni modulo), verificati da agenti indipendenti e provati con reti simulate
  (firma HMAC con vettori ufficiali, finestre e paginazione, rate limit, errori, record sconosciuti, scenario completo fino alla plusvalenza)
  e in un browser reale con la rete simulata. Restano non verificabili da qui: se la piattaforma consente le chiamate dal browser (CORS),
  la profondità storica dell'API, alcune semantiche non documentate (commissione nei prelievi, unità dei metalli). Regole: chiave di sola
  lettura mai salvata né scritta negli errori; richiesta fallita = errore, mai dati parziali; ogni prodotto non scaricato (Earn, staking,
  margine, azioni, conversioni tra stablecoin…) o storico di profondità ignota è «Da controllare» finché l'utente non aggiunge il file o
  conferma; API e file sullo stesso periodo = blocco finché non si sceglie una fonte. Crypto.com App non ha un'API pubblica; Coinbase è
  pianificato. La via più sicura per la dichiarazione resta il file con lo storico completo.
- **Formati nativi di Binance e Coinbase**: non ancora validati; si usa il modello universale o si invia la diagnostica per farli aggiungere.
- **PDF** come input: poco affidabili; si preferiscono CSV.
- Azioni, ETF, obbligazioni, dividendi, IVAFE, imposta sulle transazioni finanziarie, forex.
- DeFi, NFT, margin/futures, hard fork, wrapped, rebase: le righe diventano "tipo sconosciuto".
- Mappatura sui **righi esatti** di RT/RW e codici tributo F24 (le fonti sono discordanti: serve il modello ufficiale); compilazione dei moduli ufficiali.
- Ravvedimento per anni omessi.

## Ipotesi da far verificare

1. Qualificazione dell'oro Bitpanda come metallo prezioso (c-ter); obbligo e codice RW per metalli presso custode estero.
2. `Amount Fiat` di Bitpanda comprende già le commissioni; unità dei metalli (grammi); fuso orario dei timestamp.
3. Formati dei file: per **Crypto.com App** e **Bitpanda** (due varianti) la struttura e i tipi di riga sono stati verificati confrontandoli con un parser open source collaudato (BittyTax, usato solo come riferimento sui fatti del formato, senza copiarne il codice); mancano ancora prove su file reali dell'utente. **Crypto.com Exchange**: colonne riconosciute per nome o per parola chiave, formato non verificato. Righe non previste restano "da controllare".
   Bitpanda: tipi diversi da buy/sell/deposit/withdrawal (es. staking, transfer) non sono mappati e vengono segnalati. Crypto.com App: i trasferimenti tra utenti (`crypto_transfer`) richiedono una decisione.
4. Cashback/rimborsi della carta Crypto.com trattati come provento (alternativa: riduzione di costo).
5. Franchigia 2023-2024 valutata sul totale (plusvalenze nette + proventi) prima del riporto perdite.
6. Formula IVCA e criterio di valorizzazione RW.
7. Stablecoin in euro al 26% dal 2026: lista di token in `core.js` (`EMT_EUR`).

## Prossimi passi

1. Validare gli importatori sugli export reali (pulsante **Copia diagnostica**: struttura dei file, nessun importo).
2. Confronto dei saldi finali con quelli mostrati dalle piattaforme.
3. Revisione di un commercialista su regole, scelte interpretative e righi del modello.
4. Eventuale servizio di appoggio per le API e per i prezzi storici.
