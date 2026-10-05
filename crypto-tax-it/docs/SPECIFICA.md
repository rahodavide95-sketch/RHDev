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

## Cosa NON è incluso (ancora)

- **API degli exchange**: una pagina web non può chiamarle da sola (blocchi CORS e chiavi segrete). Servirebbe un piccolo
  programma o servizio di appoggio. Per Crypto.com App non esiste comunque un'API pubblica. Per ora: export CSV/ZIP e
  modello universale.
- **PDF** come input: poco affidabili; si preferiscono CSV.
- Azioni, ETF, obbligazioni, dividendi, IVAFE, imposta sulle transazioni finanziarie, forex.
- DeFi, NFT, margin/futures, hard fork, wrapped, rebase: le righe diventano "tipo sconosciuto".
- Mappatura sui **righi esatti** di RT/RW e codici tributo F24 (le fonti sono discordanti: serve il modello ufficiale).
- Ravvedimento per anni omessi.

## Ipotesi da far verificare

1. Qualificazione dell'oro Bitpanda come metallo prezioso (c-ter); obbligo e codice RW per metalli presso custode estero.
2. `Amount Fiat` di Bitpanda comprende già le commissioni; unità dei metalli (grammi); fuso orario dei timestamp.
3. Valori di `Transaction Kind` di Crypto.com App; nomi colonna di Crypto.com Exchange.
4. Cashback/rimborsi della carta Crypto.com trattati come provento (alternativa: riduzione di costo).
5. Franchigia 2023-2024 valutata sul totale (plusvalenze nette + proventi) prima del riporto perdite.
6. Formula IVCA e criterio di valorizzazione RW.
7. Stablecoin in euro al 26% dal 2026: lista di token in `core.js` (`EMT_EUR`).

## Prossimi passi

1. Validare gli importatori sugli export reali (pulsante **Copia diagnostica**: struttura dei file, nessun importo).
2. Confronto dei saldi finali con quelli mostrati dalle piattaforme.
3. Revisione di un commercialista su regole, scelte interpretative e righi del modello.
4. Eventuale servizio di appoggio per le API e per i prezzi storici.
