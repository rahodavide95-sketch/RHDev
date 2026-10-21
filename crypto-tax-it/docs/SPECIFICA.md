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
| 2023 | 26% | 2.000 € (da 2.000 in su si tassa tutto) | minusvalenza netta riportabile solo se > 2.000 € |
| 2024 | 26% | 2.000 € | minusvalenza netta riportabile solo se > 2.000 € |
| 2025 | 26% | nessuna | franchigia abolita, anche per il riporto delle minusvalenze (L. 207/2024, c. 25) |
| 2026 | 33% | nessuna | 26% per stablecoin in euro conformi a MiCA (E-money token; lista indicativa in `core.js`) |

Oro/metalli preziosi (art. 67 c.1 lett. c-ter TUIR): 26% tutti gli anni, paniere separato.

| Tema | Regola implementata |
|---|---|
| Costo | LIFO, un pool per asset su tutti i conti (Circ. 30/E 2023) |
| Eventi imponibili (dal 2023) | vendita in fiat, permuta cripto/stablecoin (trattate come e-money token), cripto/metallo, pagamenti, commissioni pagate in cripto |
| Permute senza realizzo | cripto/cripto con eguali caratteristiche e funzioni (es. BTC/ETH) e stablecoin/stablecoin (Circ. AdE 30/E/2023, par. 3.1): il costo, più la commissione, passa all'asset ricevuto. Opzione `swapRule: 'all'` per tassare ogni permuta |
| Prima del 2023 | nessuna permuta cripto-cripto è un realizzo: il costo si trasferisce al nuovo asset |
| Proventi | staking, interessi, cashback, airdrop: valore normale alla percezione = nuovo costo del lotto; non compensabili con minusvalenze da cessione (scelta prudenziale) |
| Minusvalenze | cripto compensano solo cripto; oro separato; riporto automatico dai file per 4 anni (opzione; vale solo se indicate nella dichiarazione dell'anno); 2023-2024: riportabili solo se la minusvalenza netta supera 2.000 € |
| Storni di cashback | riducono i proventi dell'anno (mai sotto zero), non sono cessioni |
| Rideterminazione 1/1/2025 | opzionale: costo = valore al 1/1/2025 (imposta sostitutiva 18% pagata a parte); sui lotti rideterminati le perdite non sono deducibili (L. 207/2024, c. 29) |
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

## Spiegazione dell'imposta e controllo dei prezzi scaricati
- In «Calcolo imposte → Riepilogo» il riquadro «Da dove arriva l'imposta» elenca, per l'anno scelto, vendite in euro, scambi tra cripto, pagamenti, commissioni (guadagno o perdita) e premi (interessi, staking, cashback, bonus: tassati per intero al valore alla ricezione). Se non ci sono vendite lo dice: l'imposta può venire da scambi e premi anche senza vendere. Funzione `taxSources` in `app/src/report.js`.
- Un prezzo scaricato si scarta solo se è assurdo rispetto a un prezzo noto dai file dell'utente (`pricefeed.plausible`): fino a 20 volte entro 30 giorni, con tolleranza crescente con la distanza. Simboli di una sola lettera (es. S, Sonic) sono ammessi.
- Moduli fac-simile: gli sfondi (`fx-rw.jpg`, `fx-w.jpg`) sono i moduli ufficiali dei due riferimenti senza alcun valore (celle, etichette e numero del modulo vuoti); ogni valore scritto sopra viene dai calcoli. «Acconti versati» (RW8 col. 4, W8 col. 4) non si ricava dai file: resta il segnaposto rosso, oppure si scrive l'importo nel campo facoltativo, e allora RW8 riporta acconti, imposta a debito (col. 5) o a credito (col. 6).

## Cosa pagare (anno d'imposta 2025, controllato in ottobre 2026)
`app/src/payments.js` (`CT.payments.plan`) produce, per l'anno scelto, l'elenco dei versamenti con codice tributo, scadenza e stima del
ravvedimento; lo usano la schermata Risultato («Cosa devi pagare», «Cosa fare adesso») e il PDF (copertina e documento 04).

| Voce | Quadro | Codice F24 | Scadenza (anno 2025) |
|---|---|---|---|
| Imposta sostitutiva cripto (26%) | RT, sezione V-A | 1715 (Ris. 36/E/2023), non rateizzabile | 30/06/2026, o 30/07/2026 +0,40% |
| Imposta sostitutiva oro e metalli (26%) | RT, sezione II | 1100 (da confermare) | come sopra |
| IVCA 2 per mille, saldo | RW, rigo RW8 | 1727 | come sopra |
| Acconto IVCA 2026 (metodo storico, regole IRPEF: oltre 51,65 €; 40% + 60% oltre 257,52 €) | RW | 1728 (30/06) e 1729 (30/11) | 30/06/2026 e 30/11/2026 |

Invio del Redditi PF 2026: 2 novembre 2026 (il 31/10 è sabato); il 730/2026 scadeva il 30/09/2026. Ravvedimento: sanzione 25% (D.Lgs.
87/2024), dimezzata entro 90 giorni, ridotta a 1/10 entro 30 giorni, 1/9 entro 90, 1/8 entro la dichiarazione dell'anno della violazione,
1/7 entro quella successiva, 1/6 oltre; interessi legali giorno per giorno (2% nel 2025, 1,6% dal 2026). Scadenze di sabato, domenica o
festivo slittano al primo giorno lavorativo. I righi esatti del quadro RT non sono indicati: le fonti consultate non concordavano.

## Altri redditi e detrazioni (`app/src/others.js`)
Dati inseriti a mano (sezioni «Lavoro dipendente», «Musica» e «Spese e detrazioni»): lavoro dipendente dalla CU (reddito, giorni, ritenute facoltative), lavoro autonomo
occasionale (RL15, art. 67 c. 1 lett. l), diritti d'autore (RL25, art. 53 c. 2 lett. b, deduzione forfettaria 25% o 40% sotto i 35 anni),
spese sanitarie (RP1, 19% oltre 129,11 €), altre detrazioni e oneri deducibili. Stima IRPEF 2025: scaglioni 23/35/43 (L. 207/2024);
detrazione art. 13 c. 1 (1.955 fino a 15.000; 1.910 + 1.190 x (28.000 - R)/13.000; 1.910 x (50.000 - R)/22.000; +65 tra 25.000 e 35.000;
in proporzione ai giorni); taglio del cuneo (somma esente 7,1/5,3/4,8% del reddito di lavoro se il reddito complessivo non supera 20.000;
ulteriore detrazione 1.000 tra 20.000 e 32.000, decrescente fino a 40.000); trattamento integrativo 1.200 fino a 15.000; detrazione art. 13
c. 5 per chi non ha lavoro dipendente. Con lo stipendio e senza le ritenute della CU la stima è la differenza tra l'IRPEF «solo stipendio»
(quella che il datore ha trattenuto) e quella complessiva, compresi i bonus da restituire. Non considerati: familiari a carico, redditi
fondiari, crediti esteri, trattamento integrativo tra 15.000 e 28.000. Addizionali: percentuale indicata dall'utente (2% se vuota) sulla
parte di reddito in più. Acconto IRPEF dell'anno dopo con le regole ordinarie (oltre 51,65 €; 40% + 60% oltre 257,52 €).
