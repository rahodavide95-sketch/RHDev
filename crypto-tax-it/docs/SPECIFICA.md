# Specifica - perimetro: dichiarazione anno d'imposta 2025 (Redditi PF 2026)

Persona fisica residente in Italia, non esercente attivita' d'impresa, regime **dichiarativo**.
Piattaforme: Crypto.com App, Crypto.com Exchange, Bitpanda (solo oro/metalli preziosi).
Scadenza invio telematico Redditi PF 2026: **2 novembre 2026** (il 31/10 e' sabato).

## Regole applicate (stato: da verificare su fonti primarie)

| Tema | Regola implementata | Fonte (secondaria, da riverificare) |
|---|---|---|
| Aliquota cripto 2025 | 26%, nessuna franchigia (abolita la soglia 2.000 EUR dal 2025) | L. 207/2024 |
| Aliquota metalli preziosi | 26% (art. 67 c.1 lett. c-ter TUIR) | stampa specializzata |
| Costo | LIFO, un pool per asset su tutti i conti | Circ. AdE 30/E 2023 |
| Eventi imponibili | vendita in fiat, permuta cripto/cripto, cripto/stablecoin, pagamenti in cripto, commissioni pagate in cripto | art. 67 c.1 lett. c-sexies |
| Proventi | staking, interessi, cashback, airdrop: valore normale alla percezione, che diventa costo del lotto | Circ. 30/E 2023 |
| Minusvalenze | cripto compensano solo cripto; riporto 4 anni solo se dichiarate; metalli (c-ter) separati | Circ. 30/E 2023 |
| Rideterminazione | opzionale: costo = valore al 1/1/2025 (imposta sostitutiva 18%, pagata a parte) | L. 207/2024 |
| IVCA | 0,2% x valore finale x giorni/365 (indicativa) | L. 197/2022 |
| Oro senza costo documentato (cessioni dal 2024) | plusvalenza = intero corrispettivo | stampa specializzata |
| Data fiscale | data di calendario in Italia | scelta di progetto |

Anni **precedenti al 2025**: il motore elabora tutto lo storico per costruire i lotti, ma **non calcola l'imposta**
(franchigia 2.000 EUR non implementata): `baskets_for_year` solleva `NotImplementedError`.

## Elenco dei calcoli: stato

| # | Calcolo | Stato |
|---|---|---|
| 1 | Normalizzazione eventi, UID deterministici | fatto |
| 2 | Abbinamento trasferimenti tra conti propri (finestra 72h, commissione <=10%), commissione di rete come cessione | fatto |
| 3 | Valorizzazione EUR (valore dalla fonte > prezzario; cambio BCE con gap max 7 gg) | fatto, **manca il download automatico dei prezzi** |
| 4 | Riconciliazione: cessione oltre i lotti disponibili => blocco + costo zero | fatto; **manca il confronto con i saldi dichiarati dalle piattaforme** |
| 5 | LIFO, plus/minus, commissioni accessorie, rideterminazione 1/1/2025 | fatto |
| 6 | Permute, proventi, commissioni in cripto | fatto |
| 7 | Compensazione e riporto minusvalenze (4 anni, piu' vecchie prima, scadute segnalate) | fatto |
| 8 | Imposta sostitutiva per paniere, arrotondamento all'euro | fatto |
| 9 | RW: giorni, valore iniziale/finale, IVCA indicativa | fatto come **bozza**; mappatura sui righi e codici da fare con le istruzioni ufficiali |
| 10 | Report e audit lotto per lotto | fatto |
| 11 | Mappatura sui righi esatti RT/RW/RX e importi F24 con codici tributo | **da fare** (richiede istruzioni ufficiali) |
| 12 | Ravvedimento per anni precedenti omessi | non in perimetro |
| 13 | Azioni/ETF/obbligazioni, dividendi, IVAFE, FTT, forex | non in perimetro (Bitpanda usato solo per l'oro) |
| 14 | DeFi, NFT, margin/futures, fork, wrapped, rebase | non supportati: le righe diventano UNRESOLVED e bloccano il report |

## Ipotesi che richiedono una verifica umana

1. **Qualificazione dell'oro Bitpanda** come metallo prezioso (c-ter) e non come altro strumento; obbligo e codice RW
   per metalli detenuti presso un custode estero; eventuali imposte patrimoniali.
2. `Amount Fiat` Bitpanda comprende gia' le commissioni (altrimenti l'errore e' pari alla commissione).
3. Unita' dei metalli Bitpanda (di norma grammi) e fuso orario dei timestamp.
4. Formati e valori di `Transaction Kind` di Crypto.com App; nomi colonne Crypto.com Exchange.
5. Cashback/rimborsi della carta Crypto.com: qui trattati come provento (scelta prudenziale; alternativa: riduzione di costo).
6. Proventi non compensabili con minusvalenze (scelta prudenziale).
7. Formula IVCA e criterio di valorizzazione RW (fonti discordanti).
8. Sezione e righi del quadro RT per le cripto (fonti discordanti: sezione V-A vs XI).

## Prossimi passi

1. Validare gli importatori sugli export reali (`inspect` stampa solo struttura e valori categoriali, nessun importo).
2. Fornire prezzi 1/1/2025, 31/12/2025 e per le permute (`prezzi_mancanti.csv` elenca cosa serve).
3. Riconciliazione con i saldi 31/12 mostrati dalle piattaforme.
4. Mappatura sui righi ufficiali e revisione di un commercialista.
