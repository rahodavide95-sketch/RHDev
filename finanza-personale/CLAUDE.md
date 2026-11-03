# [RH] Finance (cartella `finanza-personale`)

App di gestione della finanza personale di D (Davide Raho), nata dalla vecchia "Analisi
Finanziarie" (simulazioni conto corrente / deposito / PAC + mercati), rifatta da zero su
sua richiesta: "super completa, efficiente ma soprattutto AFFIDABILE, super sicura per la
privacy, design degno dei migliori design moderni".
Il nome è **"[RH] Finance"**, chiesto da D il 2/11/2026 ("il nome del tool deve essere [RH] Finance,
cambia i nomi e il logo"). Storia: era stata chiamata "[RH] Finance" di nostra iniziativa e a D non
era piaciuto ("chi ti ha detto di chiamarla così?"), poi per un periodo "Analisi Finanziarie" col logo
a ciambella; ora l'ha scelto lui. **Logo** (D: "al logo devi aggiungere Finance sotto ad RH", poi "Finance deve
stare più unito a RH ed RH più grande, Finance della stessa larghezza di RH"): il segno **"[RH]"** di
[RH] Documents (preso pari pari da `documenti-raho/icon-512.png`, lettere del logo RH[BKNG] di D) e
sotto, attaccato, **"Finance"** in Liberation Sans Regular (lo stesso disegno di Arimo, il carattere
del nome di [RH] Documents) leggermente spaziato e largo esattamente come "[RH]"; bianco su nero.
File: `icon-512.png`, `icon-192.png`, `apple-touch-icon.png` (180), `favicon-64.png` col logo intero;
`icon-maskable-512.png` uguale ma un po' più piccolo (dentro la zona sicura del cerchio di Android);
`favicon-32.png` e `mark-192.png` solo "[RH]" (a 30 px "Finance" non si leggerebbe): `mark-192.png`
nella barra laterale e in Impostazioni, accanto alla scritta "[RH] **Finance**". Schermata di accesso:
il logo intero a 112 px. Gli script che li hanno disegnati erano nello scratchpad della sessione.
File scaricati: `RH-Finance-backup-….json`, `RH-Finance-codice-di-recupero.txt`. Non inventare
nomi, loghi con scritte o marchi: se serve, chiedi.
I nomi interni invisibili (`rh-finance` per IndexedDB, cache e formato della cassaforte)
restano: cambiarli renderebbe illeggibili cassaforti e backup già creati.
D scrive in italiano e non è uno sviluppatore: spiegagli le cose in modo semplice e fai tu
le modifiche. Tutta l'interfaccia è in italiano.

Pubblicata da GitHub Pages (`deploy-pages.yml`, da `main`) su
`https://rahodavide95-sketch.github.io/RHDev/finanza-personale/`; c'è anche `vercel.json`
(intestazioni di sicurezza) se la cartella è un progetto Vercel.
Il repo è pubblico: mai dati personali di D nel codice.

## Architettura (niente compilazione)

- `index.html` (CSP rigida in `<meta>`), `js/boot.js` (tema prima del primo disegno),
  `js/app.js` (avvio, router a hash `#/pagina/param?query`, guscio, blocco automatico,
  scorciatoie, service worker).
- `js/core/*`: funzioni pure con test in `test/` (`npm test`, Node 22, `node --test`).
  - `money.js`: importi in **centesimi interi**; `parseAmount` legge "1.234,56", "1.500"
    (= 1500), "12.5", e piccoli calcoli senza `eval`.
  - `dates.js`: date `AAAA-MM-GG` locali; ricorrenze calcolate sempre dall'inizio (il 31
    resta 31 dove esiste).
  - `finance.js`: simulazioni (PAC, interessi CC/CD, mutuo con TAEG via TIR, FIRE,
    inflazione, BTP, costo reale). Regole fiscali italiane 2026 commentate in cima.
  - `model.js`: schema, `sanitize()` (difesa da dati rotti), `derive()` (saldi, patrimonio,
    flussi, budget, scadenze, obiettivi, portafoglio).
  - `crypto.js`: cassaforte (AES-GCM, PBKDF2 600k, codice di recupero).
  - `csv.js`: lettura estratti conto, esportazione sicura per Excel.
  - `xlsx.js`: lettura dei .xlsx senza librerie (zip con `DecompressionStream`, XML con
    espressioni regolari; solo valori delle celle, limiti di dimensione).
  - `invimport.js`: import degli investimenti (vedi sotto).
  - `sheets.js`: fogli mese per mese e Net Worth dello stesso file (vedi sotto).
- `js/session.js`: stato in memoria, `commit(fn, opts)` per ogni modifica (salva cifrato
  dopo 500 ms, serializzato), blocco, backup, "Annulla" (`undo(token)`), una scheda alla
  volta (BroadcastChannel). `js/store.js`: IndexedDB `rh-finance` (chiavi `vault`,
  `vault-prev`, `auto-AAAA-MM-GG` ultime 7).
- `js/actions.js`: tutte le operazioni sui dati. `js/views/*`: pagine (ognuna esporta
  `render(ctx) → { title, sub, node, actions }`) e `editors.js` (finestre di inserimento).
- `js/ui/*`: `h()` per costruire il DOM (solo `textContent`, mai HTML dai dati),
  componenti (finestre dal basso su telefono / al centro su computer, avvisi, campi),
  grafici SVG fatti a mano (`charts.js`), icone (`icons.js`).
- `css/app.css`: tutto il design. `sw.js`: offline.

## Pagina Patrimonio (`views/networth.js`) = il Net Worth di D

D, dopo aver provato col suo file: "il patrimonio non è la somma di entrate, networth e wallet…
deve essere intelligente. Nel patrimonio deve esserci semplicemente il riassunto del networth e
quindi quello effettivo è quello di ogni fine mese. La sezione investimenti è a sé, non deve essere
collegata a nient'altro." Quindi il patrimonio è **solo** il Net Worth, a fine mese:
- Righe (`nwItems` in `derive`): conti del patrimonio senza titoli (`a:id`, valore = `valueAt` a
  fine mese, e solo da quando hanno un primo punto fermo: niente ricostruzioni all'indietro) e
  titoli con valori **scritti nel Net Worth** (`h:id`, `snapshots[mese].nwHd[id]` in valuta
  principale, dal foglio importato o da "Aggiorna i valori"). Mai i prezzi degli Investimenti:
  i conti titoli/crypto con titoli non entrano, né la loro liquidità; un titolo senza `nwHd` non c'è.
  Conti fuori dal patrimonio (es. "Entrate e uscite dal file", TFR lordo) non entrano.
- Colonne: solo fine mese **passate** (`pastEnd`): il mese in corso resta vuoto fino a fine mese.
- `nwSections` (ordine e nomi da `settings.nwLayout`, scritto dall'import o da "Organizza", poi
  sezioni di base per le righe nuove), `nwTable(cols)`, `nwSheet(anno, filtro)` (31/12 anno prima
  + 12 fine mese: per sezione Total, Gain/Loss, %; Net Worth; Asset Allocation), `nwMonthly(n)`
  (ultime fine mese, `last` = l'ultima con valori).
- Pagina: patrimonio all'ultima fine mese con variazione sul mese prima, dal 31/12 e massimo; una
  scheda per sezione (valore, variazione, quota, andamento); grafico a barre per sezione + linea;
  il foglio Net Worth dell'anno (filtro, Organizza, CSV, colonne allargabili); anno per anno.
- Foglio Net Worth **tutto sullo schermo** (D: "far entrare tutto da dic 2025 alla differenza tra
  2025-2026, anche senza comprimere la barra"): colonne 31/12 anno prima + 12 fine mese + **Diff.
  anno prima→anno** (€, dal 31/12 all'ultima fine mese con un valore; in Asset Allocation in punti)
  + **%**. Su computer (`fitOf()`, tabella `.fit`, `table-layout: fixed`) le 15 colonne riempiono la
  pagina con la barra aperta; carattere, decimali e simbolo € scelti **misurando** con un canvas
  il numero più lungo e la % più lunga (prima via i decimali, poi carattere più piccolo fino a
  10,5 px, per ultimo via "€", che va nell'intestazione "Net Worth (€)"); date corte (31/12/25)
  quando non entrano; ridisegno al cambio di larghezza (`rhf-rerender`). Su telefono scorre.
  Provato a 1280, 1366, 1440, 1512, 1920 e 2560 px: nessuna cella tagliata. Classi delle colonne
  `nw-dcol`/`nw-dpct` (`.nw-diff` è già usata dal confronto tra date).
- "Aggiorna i valori" (`checkInEditor`, `saveCheckIn`): il Net Worth di una fine mese riga per
  riga come nel foglio (precompilato, "fine mese prima: …"); conti → punto fermo `adjust` (uno
  per data, il nuovo sostituisce), titoli → `nwHd`; per i titoli c'è solo come **suggerimento**
  il valore di oggi negli Investimenti (tocca per copiarlo).
- Sezioni come blocchi (D: "l'intestazione di ogni categoria non mi piace con quel colore e forma…
  colori non così vivaci… la riga del gain loss più staccata per far vedere che si passa a una nuova
  categoria"): titolo sobrio (maiuscoletto, quadratino e riga sottile nel colore **smorzato** della
  sezione `--sec-m`), Total con una riga sopra, Gain/Loss e % piccoli, riga vuota `tr.nw-gap` tra
  una sezione e l'altra. Con "Colori vivaci" il titolo ha solo un fondo leggero.
- In cima **una card sola** (D: "anche le cards in patrimonio non mi piacciono"; tolte le schede per
  sezione): Net Worth a fine mese, sul mese prima / dal 31/12 / il più alto, barre per sezione (colori
  smorzati `softColor`) con la linea del totale, e accanto le sezioni con quota, valore e variazione.
- Tabelle-foglio **da leggere come in Excel** (D: "mi girano ancora gli occhi… su Excel è molto meglio
  leggere"; "il networth è ancora molto confusionario"): una riga sola per voce (il tipo in `title`),
  griglia leggera tra le colonne dei numeri, niente righe alterne (`.table.fit` escluso dallo zebra),
  verde/rosso smorzati, Total senza fondo. Logica "entra nello schermo" condivisa in `ui/fit.js`
  (`fitTable`, `watchFit`, `fitMoney`: senza decimali solo sopra 1.000 €, sotto restano i centesimi).
- **Colore al volo** (D: "cambiare il colore delle varie categorie direttamente cliccando sul
  quadratino"): `colorDot()` in `views/common.js` = quadratino-pulsante che apre la tavolozza lì accanto
  (8 colori + arcobaleno); `setSectionColor(d, nome, colore)` per le sezioni del Net Worth,
  `A.setGroupColor` per le macro categorie. C'è nelle sezioni (titoli della tabella, Asset Allocation,
  card in cima), nelle macro categorie di Entrate e uscite (tabella e card) e nella Panoramica.
- **Righe delle categorie con il colore del quadratino, molto tenue** (D: "fai anche la barra dello
  stesso colore ma molto tenue… solo le categorie di ogni cosa, che sia net worth, entrate, uscite o
  investimenti"): fondo `color-mix(colore 9%, --card)` sul titolo di ogni sezione del Net Worth
  (`tr.nw-band`), sulla riga di ogni macro categoria di Entrate e uscite (`tr.fin-macro`) e, negli
  Investimenti › Anno per anno per Tipo o Categoria, su ogni riga (`tr.inv-cat`, quadratino e colore
  della ciambella). Le righe delle voci restano bianche; le righe alterne non coprono le categorie.
- **Asset Allocation come il foglio di D** (D: "nelle varie celle ci sono le somme di tutto, le % sono
  solo nella prima colonna"): una riga per sezione con le sue somme mese per mese e la quota (%)
  dell'ultima fine mese accanto al nome; sotto Total (il Net Worth), Gain/Loss e %. Non c'è più una
  sezione "Net Worth" a parte.
- **Conti "solo nei mesi con un valore"** (`account.nwSparse`; D: per il TFR "no, come nel mio
  foglio"): nel Net Worth valgono solo nelle fine mese con un punto fermo. L'import lo accende per le
  righe con celle vuote dopo il primo valore (TFR scritto solo al 31/12); interruttore nel conto.
- La Panoramica usa lo stesso Net Worth di fine mese (`netWorthCard`). Le vecchie funzioni
  `netWorthAt`/`netWorthHistory` (somma dei saldi) restano solo per altri calcoli.

## Panoramica (`views/dashboard.js`)

D: "le cards nella panoramica non mi piacciono… non le voglio così"; scelte sue: **poche card e
grandi** con Net Worth, Entrate e uscite, Investimenti, Scadenze/budget/obiettivi. Griglia `.dash2`
(due colonne, una su schermi stretti): Net Worth a tutta larghezza (numero grande, sul mese prima,
dal 31/12, il più alto, grafico e sezioni con barra e quote), Entrate e uscite dell'anno (totale,
media sui mesi trascorsi come la pagina, uscite e risparmio, barre mese per mese, macro categorie),
Investimenti (investito in totale, valore se ci sono prezzi, nell'anno, media, Azionario/Crypto,
investito ogni mese), una card con tre colonne Scadenze / Budget / Obiettivi. Colori smorzati
(`soft()`); avvisi solo se chiedono di fare qualcosa (cambio mancante), in una riga sopra. Tolte
"Questo mese" (a inizio mese era vuota), "Spese per categoria", "Ultimi movimenti", "Da sapere".

## Investimenti (`views/investments.js`)

Schede `#/investimenti` (Portafoglio), `?vista=operazioni`, `?vista=anni`; dettaglio
`#/investimenti/<id>`. Nate da un Excel "Wallet Summary" di uno youtuber che D ha mandato
come esempio ("mi sembra molto interessante"), con la colonna di destra di riepiloghi.
- Titolo: `cls` (tipo, anche `etf_mm` ETF monetario), `group` (categoria libera), `ter` (%).
  Operazione di vendita: `tax` (imposta trattenuta: riduce realizzato e liquidità).
- `investmentFlows()` in `model.js` (`d.invest()`): investito netto = acquisti con
  commissioni − vendite al netto di commissioni e imposta (come la colonna TOTALE del
  foglio); per mese, per anno, `pivot(chiave)` per tipo/categoria/titolo/conto (anche le
  quote per anno), commissioni, imposte, cedole, realizzato e costi del conto: movimenti di
  spesa sui conti investimenti con categoria `c-tasse`/`c-banca` o "bollo" nella descrizione.
  Media dell'anno: dal primo mese con operazioni (gennaio se si investiva già) a dicembre o
  al mese corrente. Il prezzo medio comprende le commissioni (come per il fisco): per questo
  i totali per categoria sono più alti di un foglio che somma solo l'importo (spiegato nella
  pagina).
- `pacEditor` (più acquisti alla stessa data, importi dall'ultimo acquisto, un "Annulla"),
  `bolloEditor` (spesa "Imposta di bollo" sul conto investimenti), `opEditor` con due tra
  quantità, prezzo e importo.
- Import (`views/invimport.js` + `core/invimport.js`): .xlsx o CSV; intestazione cercata
  nelle prime 40 righe (sinonimi italiani/inglesi in `FIELDS`, prima colonna da sinistra:
  le tabelle di riepilogo a destra non disturbano); righe "TASSE"/bollo → spese del conto;
  quote negative → vendite; righe senza numeri saltate; il prezzo è importo ÷ quote (così
  l'importo del file resta esatto); controllo riga per riga con la colonna Totale (in
  centesimi, accetta i due segni); doppioni (stessa data, tipo, quote e prezzo) esclusi;
  conto per broker (nuovo se non c'è, aperto dalla prima operazione), liquidità non mossa
  di default. Test: `test/invimport.test.js` con `test/fixtures/portafoglio-esempio.xlsx`
  (dati inventati).
- Crypto (D: "stesso ragionamento per le crypto", foglio COIN | DATA ACQUISTO | QUANTITA' |
  VALORE | IMPORTO | FEE | TOTALE | PIATTAFORMA | NOTE): `findHeader` segna `crypto` se la
  colonna del nome si chiama coin/crypto/token; `cryptoSymbol()` porta "BTC", "Bitcoin",
  "BTC/EUR" a `BTC-USD` (il simbolo dei prezzi Binance); classe `crypto`; un conto nuovo con
  sole crypto è un "Wallet crypto". `normHead` toglie gli apostrofi (QUANTITA').
- D: "i movimenti preferirei tenerli divisi per azionario e crypto altrimenti non si capisce
  niente": in alto il selettore **Azionario | Crypto | Tutto** (predefinito Azionario) vale per
  Portafoglio (`d.portfolio(scope)`), Operazioni (`d.invest(scope)`) e Anno per anno. Gli
  Investimenti sono a sé: non entrano nel Patrimonio.
- D: "tutte quelle statistiche per le crypto sono le stesse del wallet azionario, anzi lì
  ce ne sono di più". Le crypto sono titoli come gli altri: hanno tutto. In più
  `investmentFlows(state, toBase, scope)` con `scope` '' / 'titoli' / 'crypto' (il bollo va
  con le crypto solo se il conto ha solo crypto) e `d.invest(scope)`; in "Anno per anno" i
  pulsanti Tutto / Titoli (wallet) / Crypto. `buyHistory(h)` (model): speso, giorni di
  acquisto, intervallo tipico (mediana) e "regolare" (≥3 intervalli, 7 su 10 vicini),
  prossimo previsto, acquisto medio e più grande, prezzo min/max/medio, commissioni, anno
  per anno → card "Storia degli acquisti" nel dettaglio e "Titolo per titolo" negli anni.

## Import di tutto il file (`views/invimport.js` + `core/sheets.js`)

D, con il foglio Net Worth: "se importo direttamente il file excel, il tool sarà in grado di
distinguere tutto?". `detectSheet()`: operazioni se `findHeader` ha punteggio ≥ 4, poi
mese per mese (≥ 10 mesi GEN…DIC in una riga), poi patrimonio (≥ 3 date crescenti in una
riga), altrimenti non riconosciuto. Tutti i fogli di operazioni si leggono e si pianificano
**insieme** (`planImport` su un `read` unito: stessi conti, niente doppioni tra wallet e
crypto). Un solo `importWorkbook()` in `actions.js` (un "Annulla").
- Mese per mese: `readMonths` (riga della sola categoria quando ci sono sottocategorie =
  suo totale, solo per il controllo; categoria scritta solo nella prima riga vale per le
  successive; TOTALE in fondo saltato), `sheetHints` (entrate/uscite e anno dal nome o dal
  titolo), `planMonths`: un movimento per cella con data a fine mese (oggi nel mese in
  corso, mesi futuri saltati), descrizione = nota o sottocategoria, categorie create con
  `niceName` ("LAVORO" → "Lavoro"), importo negativo = movimento opposto nella stessa
  categoria (`yearTable` lo sottrae: rimborsi), doppioni (data, importo, tipo,
  descrizione) cercati in tutti i conti. Conto: uno apposta "Entrate e uscite dal file"
  **fuori dal patrimonio** (default, i saldi non cambiano), un conto del Net Worth o un
  conto esistente.
- Net Worth: `readNetWorth` (sezioni = righe di solo testo; Total/Gain/Loss/% saltate,
  Total usate per il controllo; sezione Asset Allocation saltata; valore "strano" =
  > max(100.000, 50 × mediana della riga)), `planNetWorth`: tipo da sezione/tipo/nome
  (`accountTypeFor`: "Euro"/"Dollari" sono la valuta, TFR = credito, "Mutuo casa" =
  debito), valuta da Type, righe già negli investimenti (`matchHolding`, anche i titoli che
  arrivano dallo stesso file) o col nome del conto dei titoli escluse, "Lordo" escluso se
  c'è "Netto", righe sempre a zero escluse, date future saltate, valori già presenti
  saltati. Ogni valore diventa un punto fermo ('open' il primo, poi 'adjust'), creato
  **dopo** i movimenti (a fine giornata vale il foglio); stesso nome in più fogli = un conto.
- Correzioni dopo la prova di D col suo file vero ("tantissimi bug di calcolo e
  riconoscimenti sbagliati"): le righe del Net Worth che sono titoli diventano i valori di
  fine mese di quei titoli nel Net Worth (`nwHd`) e le loro righe nel layout, non conti; nella sezione della
  liquidità (`isCashSection`) un nome di broker è il suo conto di liquidità: **Trade Republic →
  conto corrente, Scalable Capital → conto deposito** (nome "Trade Republic – Conto corrente"
  se esiste già il conto titoli, `institution` = broker); **TFR: conta solo il netto**
  (`isGross`: "lordo" o la stessa voce senza "netto"; se lo si importa resta fuori dal
  patrimonio); il controllo dei Total accetta anche la somma senza il lordo. Il bollo del
  foglio delle operazioni va sul conto di liquidità del broker (se c'è nel Net Worth) con il
  tag `investimenti`: conta nei costi degli investimenti e **non** nella tabella Uscite (come
  nel foglio di D). Categorie: stessa solo se coincidono categoria **e** sottocategoria (prima
  "MUSICA › ROYALTIES" finiva in "Lavoro › Royalties"); i nomi restano come nel file
  (LAVORO, INT. BANCA, CC, CD); "Solo le categorie del file" nasconde quelle dell'app non
  usate. Doppioni anche per bollo e valori dei titoli.
- Test: `test/sheets.test.js` con `test/fixtures/file-completo-esempio.xlsx` (dati
  inventati: Wallet, Crypto, Entrate 2026, Uscite 2026, Net Worth con Trade Republic e
  Scalable nella liquidità, Note).
- **Provato con la struttura del file vero di D** (D ha mandato una copia con numeri di esempio, "per
  vedere la struttura": i numeri non vanno usati né messi da nessuna parte; il file resta solo nello
  scratchpad della sessione, mai nel repo). Fogli "📊 NW 2026" e "🤑 Entrate 2026". Correzioni:
  - Due righe con lo stesso nome ("Contanti" Euro e "Contanti" Dollari) erano finite in un conto solo
    (i valori in dollari sovrascrivevano quelli in euro): ora `planNetWorth` dà nomi distinti col
    Type ("Contanti (Euro)", "Contanti (Dollari)") e `nameKey()` (come `normHead` ma tiene quello tra
    parentesi) riconosce i conti; un vecchio "Contanti" nella stessa valuta diventa "Contanti (Euro)".
  - Colonna Type → tipo di titolo (`positionClass`): "ETF:S" azionario, "ETF:M" monetario (anche nella
    liquidità: resta in quella sezione), "ETC"/"XAU" oro e materie prime, "BTC+ALT" o sezione Crypto
    crypto, un simbolo maiuscolo (es. "RKLB") o sezione Stock azione. Senza lo stesso titolo negli
    Investimenti la riga è un **conto-posizione** (`account.cls`, tipo `broker`/`crypto`): distintivo
    ETF/STOCK/ETC nel Net Worth e in Conti ("ETF azionario · nel Net Worth"), sezione da `HD_SECTION`;
    negli Investimenti non c'è (D: "la sezione investimenti è a sé").
  - Un conto del Net Worth già importato resta quello (anche se poi arriva un titolo con lo stesso
    nome dal foglio del wallet): niente doppioni reimportando.
- **Reimport mensile** (lo stesso file aggiornato ogni mese): Net Worth → valori uguali saltati,
  valori **corretti nel file** aggiornati (`row.changed`: punto fermo / `nwHd` della stessa data).
  Mese per mese → ogni cella ha un'impronta `importHash` = `cellHash(tipo, mese, categoria, voce)`
  (`xl:` + 16 hex): importo cambiato = stesso movimento aggiornato, cella svuotata = movimento tolto
  (solo quelli con l'impronta), mese in corso reimportato un altro giorno = stesso movimento (prima
  la data di oggi faceva un doppione). I movimenti importati prima delle impronte si riconoscono da
  mese + categoria + descrizione e ricevono l'impronta. Anteprima: "N valori cambiati: li aggiorno",
  "importo tolto dal file", "Come schedo le righe" (macro › voce, descrizione, categoria nuova o già
  nell'app, statistiche saltate).
- **Controllo col foglio** dopo l'import (`reconcileNetWorth` + `fileCheck` in `views/invimport.js`):
  il Net Worth dell'app (`d.nwTable(date del file)`) fine mese per fine mese accanto al totale del file
  (riga Total dell'Asset Allocation, o somma dei Total delle sezioni) e il **perché** delle differenze,
  raggruppato sui mesi: valore che nell'app resta nei mesi vuoti del foglio (es. TFR scritto solo al
  31/12), riga in un'altra valuta (convertita nell'app, sommata così com'è nel foglio), riga
  dell'Asset Allocation vuota o diversa dalla sua sezione (il totale del foglio non la conta). Si apre
  solo se qualcosa non coincide e solo se l'import ha toccato il Net Worth; altrimenti l'avviso dice
  "coincide in tutti i N mesi ✓". Test: `test/reimport.test.js` (struttura come quella di D, nomi e
  numeri inventati).

## Prezzi online (`js/market.js`)

D: "non ci sono i prezzi aggiornati". Verificato il 30/10/2026 con un workflow temporaneo su
un ramo (`curl` con `Origin` e poi il codice vero dell'app in Node): Yahoo risponde 429 e
senza CORS, allorigins è giù, corsproxy vuole una chiave. **onvista.de** risponde con
`access-control-allow-origin: *`, senza chiave, per ISIN:
`/api/v1/instruments/query?searchValue=` (ricerca), `/instruments/{TIPO}/ISIN:{isin}/snapshot`
(una quotazione per borsa e valuta) e `/instruments/{TIPO}/{entityValue}/eod_history?idNotation=…&range=M1|M3|M6|Y1|Y5|MAX&startDate=`
(`chart_history` dà 403). `pickQuote()`: valuta del titolo, borse in ordine LSX (Trade
Republic), GAT, GER, TRO, MIL…, niente borse ferme da una settimana. Crypto da Binance
(CoinGecko di riserva), valute dalla BCE con storico (`fxQuote`, `EURUSD=X`).
- Titoli: `isin` + `ovType` (FUND, STOCK, DERIVATIVE…), `priceSrc` (borsa). Senza ISIN
  `linkSheet()` (Investimenti) cerca per nome (`findCandidates`: ricerche più corte, tipo
  per classe, punteggio per nome e per prezzo dell'ultima operazione) e fa confermare.
- `autoPrices()` da `app.js`: con il consenso, all'apertura e al massimo ogni 3 ore;
  avviso "prezzi non aggiornati" in Portafoglio.
- Mercati: elenchi in `data/markets.js` con `isin`/`ev`/`type` dove servono (indici,
  materie prime: solo quelli che onvista ha davvero), altrimenti ricerca per nome col tipo
  giusto; "Cerca online" su onvista.

## Entrate e uscite (`views/yearly.js`) e categorie (`views/categories.js`)

D, mandando il suo foglio delle entrate (CATEGORIA, SUB CATEGORIA, NOTE, GEN…DIC, TOTALI,
MEDIA MENS.): "deve essere bravissimo… devo poter fare tutto ciò che voglio in completa
libertà". Categoria del foglio = `group` della categoria dell'app, sottocategoria =
categoria, voce = descrizione del movimento (`payee`). `d.yearTable(anno, tipo)`: gruppi →
categorie → voci con importi per mese, totale; media = totale ÷ mesi trascorsi dell'anno.
Ordine = ordine dell'array `categories` (riordinabile). Colori dei gruppi in
`settings.groupColors` (`"income:Lavoro"` → 1…8, palette dei grafici). `categoryManager()`:
gruppi su/giù, rinomina (se il nome esiste già si uniscono), colore, nuove sottocategorie;
`categoryEditor` con "Nascondi" e "Elimina e sposta i movimenti in…" (unione).
Schema attuale (D, bocciando la vista a celle unite "come il foglio": "quello che sta adesso fa
cagare… LAVORO è la macro categoria, indica la somma di tutto"): **come un bilancio**.
Macro categoria = `group` (LAVORO, MUSICA, INT. BANCA, ALTRO), voci = categorie (STIPENDIO,
13ESIMA, 14ESIMA, BUONI PASTO, WELFARE; ALTRO, DJ, PRODUZIONE, GRAFICHE; CC, CD). Pagina:
numeri dell'anno (totale con confronto sull'anno prima, media, mese migliore, mese in corso
sulla media; il mese in corso conta per la media e nei numeri solo se ha già degli importi,
altrimenti si usa l'ultimo mese completo) → una scheda colorata per macro (totale, quota, barra, media, andamento; tocca
per vedere solo quella) → grafico a barre impilate per macro → tabella: riga della macro
(somma, colorata, si apre e chiude) e sotto le voci rientrate, GEN…DIC, Totale, Media, %;
macro senza voci vere (ALTRO) = una riga; note (`payee` diverse dal nome) a richiesta
("1 nota ›" o "Mostra tutte le note"); "Anche le voci senza importi" acceso (13ESIMA a zero
resta, come nel foglio); filtro con totali rifatti; CSV. Colori: `groupColor()` = colore
scelto o uno diverso per ogni macro nell'ordine (non più dal nome). L'import crea anche le
voci ancora a zero (`planMonths().keys`) e, con "Solo le categorie del file", dà alle
categorie già presenti i nomi del file. Test col file di prova che ha questa struttura.
**Tutto sullo schermo e una card sola** (D: "cerca di far entrare tutto anche nelle entrate/uscite";
le schede per macro non piacevano): in cima una card con totale dell'anno (e confronto sull'anno prima),
media, mese migliore, ultimo mese, barre mese per mese per macro e accanto le macro (tocca il nome =
solo quella nella tabella, tocca il quadratino = colore). La tabella usa `ui/fit.js` come il Net Worth
(15 colonne: 12 mesi, Totale, Media, %), celle vuote vuote (niente più "–"), "Categoria (€)" quando il
simbolo non c'entra. Provata a 1366–2560 px con la barra aperta e chiusa.
**Categorie uniche** (D: "perché due categorie lavoro? è solo 1"): import di versioni diverse
avevano scritto "Lavoro" e "LAVORO". `catNorm()` (minuscole, senza accenti né simboli) = stessa
macro / stessa voce. `yearTable` raggruppa con `catNorm`; `tidyPlan`/`applyTidy` (model) danno a
ogni macro un solo nome (quello delle categorie con movimenti, a pari merito il maiuscolo) e
fondono le voci doppie spostando movimenti, scadenze, regole e budget; `actions.tidyCategories()`
gira all'apertura (con un avviso se ha unito qualcosa) e dentro ogni import del file. L'ordine
delle macro guarda solo le categorie visibili (una "Altro" nascosta non porta ALTRO in alto).
**Statistiche non sono entrate** (D: "Liquidità a fine 2025 è solo una statistica"): `readMonths`
salta le righe `isStatLabel` (liquidità/saldo/giacenza/patrimonio + fine/inizio/anno) e tutto
ciò che sta sotto la riga TOTALE (`read.stats`, mostrate nell'anteprima); `tidyPlan().stats`
toglie quelle già importate (categorie non dell'app con movimenti solo in conti fuori dal
patrimonio).

## Impostazioni (`views/settings.js`)

D: "nelle impostazioni non si capisce niente, tutte le card stanno ognuna per fatti suoi" (era
una griglia a tre colonne con altezze diverse). Ora menu delle sezioni a sinistra (fisso, evidenzia
quella che si sta guardando; su telefono pulsanti in orizzontale) e sezioni una sotto l'altra;
Categorie = riepilogo per macro categoria con le sue voci (tocca → gestione).

## Account e sincronizzazione (richiesta di D: "perché non mi fai accedere con mail e password?")

- Stesso schema collaudato di Documenti Raho (leggi `documenti-raho/CLAUDE.md`, "Account e
  sincronizzazione"): progetto Supabase di Label Finance `ztjlqorvnulgfvbtvavm`, oggetti con
  prefisso `finanza_personale`, un solo proprietario (`finanza_personale_claim()`), client
  senza librerie (`js/cloud.js`: `/auth/v1`, `/rest/v1`). Stesso account di Documents.
- Schema: `supabase/schema.sql` (niente DELETE per `authenticated`), applicato dal workflow
  `.github/workflows/finanza-personale-db.yml` (secret `SUPABASE_ACCESS_TOKEN`), che aggiunge
  anche l'indirizzo dell'app ai ritorni consentiti dopo le email. Test: `bash test/rls/run.sh`.
- Online va la cassaforte intera (stessa di IndexedDB e dei backup), riga unica con `version`.
  La password dell'account È la password della cassaforte. Diversamente da Documents la chiave
  non si ricorda sul dispositivo: si chiede la password a ogni sblocco (origine condivisa).
- `session.js`: `cloudSync()` (versione online → `pullMerge()` con unione a tre vie dalla
  "base" = ultima versione comune salvata in IndexedDB `cloud-base` → `pushNow()` con PATCH
  `version=eq.N`, se 0 righe si ricomincia). `pushKeys` forza l'invio quando cambiano solo le
  chiavi (password/codice). `keysAt` nella cassaforte dice quali chiavi sono più recenti.
  Si sincronizza: all'apertura, 1,5 s dopo ogni salvataggio, ogni 60 s, tornando sulla
  pagina, quando torna la rete, prima del blocco (max 4 s).
- Flussi: `loginNewDevice` (dispositivo nuovo), `linkAccount` (da Impostazioni: se ci sono
  dati online si uniscono e valgono password e codice dell'account; se no la cassaforte locale
  si richiude con la password dell'account), `unlockViaCloud`/`rekey` (password cambiata su
  un altro dispositivo o da Documents), `loginWithOld`, `resetFromLink` (email "password
  dimenticata" + codice di recupero), `relogin` (sessione scaduta), `unlinkAccount`.
- Schermate in `views/gate.js` (accesso, nuovo account, password cambiata, nuova password dal
  link; `handleAuthLanding()` legge `#access_token…` / `#error…` tornando dalle email).
- Prove: finto Supabase con Playwright (`route`), più dispositivi insieme. Da qui Supabase non
  è raggiungibile.

## Modello dei saldi (importante)

Saldo di un conto = ultimo "punto fermo" (`valuations`: saldo iniziale `kind:'open'` o
"Aggiorna saldo") + movimenti successivi. Un movimento dello stesso giorno conta se
inserito dopo il punto fermo (si confronta `created`). Prima del primo punto fermo il
saldo si ricostruisce all'indietro (così gli import del passato non falsano il saldo di
oggi). Mutui/prestiti con piano: il debito segue solo il piano d'ammortamento.
Conti investimenti/crypto: liquidità (movimenti + operazioni con `cash:true`) + titoli
(quantità × prezzo attuale; nei mesi passati la fotografia `snapshots[mese]` se c'è).
Titoli: costo medio ponderato.

## Sicurezza (scelte da non cambiare senza motivo)

- La chiave non si salva mai (niente "ricordami"): su GitHub Pages tutte le app del repo
  condividono lo stesso origine e lo stesso IndexedDB.
- CSP senza `unsafe-inline`: gli stili dinamici solo via `element.style` (CSSOM), mai
  attributi `style` in stringa; niente `innerHTML` con dati dell'utente (le icone sono
  costanti).
- Dati di mercato solo dopo consenso (`settings.market.enabled`), direttamente dal
  dispositivo alle fonti (niente proxy). Nuovi domini vanno aggiunti alla CSP in
  `index.html` **e** in `vercel.json`.
- Label Finance, quando si aggiorna, cancella tutte le cache del sito tranne la sua:
  `sw.js` si ricompleta a ogni apertura (messaggio `refill`). La cache contiene solo
  codice, mai dati.

## Cancellazione dei dati

D: "la cancellazione dei dati non avviene, già provata due volte". Prima "Cancella tutto"
svuotava solo il dispositivo e usciva dall'account: al nuovo accesso la cassaforte online
tornava. Ora **"Cancella tutti i dati"** = `actions.resetData()` (dati come nuovi, restano
password e preferenze) + `cloudSync()`: la versione vuota va online e gli altri dispositivi la
seguono (unione a tre vie); "Annulla" subito dopo. **"Togli l'app da questo dispositivo"** =
`wipeAll()` (solo locale; l'uscita dall'account non blocca più la cancellazione se la rete
manca).

## Design

Colori (`ui/theme.js`): palette **Excel** (predefinita: blu, intestazioni delle tabelle blu
scuro, sfondo grigio, righe alterne), Viola, Oceano, Smeraldo, Grafite, o **"I tuoi colori"**
(colore principale, intestazioni, sfondo con `input type=color`, anteprima mentre scegli);
colori dei grafici (Vivaci, Excel/Office, Blu e verdi, Verdi e grigi, Pastello), righe alterne,
tabelle compatte. Diventano variabili CSS sulla radice; copia delle sole variabili in
localStorage `rhf-look` che `boot.js` applica prima del primo disegno. D: "usa più colori per
intestazioni ecc, è tutto uguale e non si capisce niente": pulsanti principali, schede scelte
e voce attiva col colore principale, barretta colorata nei titoli delle schede.
**Colori sobri** di base (D, dopo aver chiesto più colori: "non mi piacciono tutti quei colori"):
`look.colorful` (falso di base) → `<html data-colors="few|many">` (anche in `index.html` e
`boot.js`); in "few" schede, sezioni del Net Worth, righe delle macro categorie e distintivi sono
neutri, con solo un pallino colorato per riconoscerli nei grafici; verde/rosso per guadagni e
perdite; grafici a colori. Interruttore "Colori vivaci" in Impostazioni › Aspetto.
**Colori organizzati e liberi** (D: "organizza meglio i colori e dammi la possibilità di modificarli
come voglio con la palette dei colori completa"): Impostazioni › **Aspetto** = tema, palette pronte
(un tocco cambia tutto, anche i colori dei grafici), stile (Colori vivaci, righe alterne,
compatte); Impostazioni › **Colori** = ogni colore con `input type=color` (tavolozza completa):
colore principale, intestazioni, sfondo (cambiarli passa a "I tuoi colori" partendo da quelli di
ora), **guadagni** e **perdite** (`look.pos`/`look.neg`, '' = verde e rosso di base, `--pos`/`--neg`),
gli **8 colori dei grafici** uno per uno (`look.series`, 8 hex che vincono su `look.chart`; "Parti
da" rimette un gruppo pronto; al buio si schiariscono solo quelli molto scuri), il colore di ogni
**macro categoria** (Entrate/Uscite) e di ogni **sezione del Net Worth** (`d.nwGroups()`; salvare
scrive tutto `nwLayout` con le sezioni come si vedono). `colorChoice(valore, onChange, { onDone })`
(`ui/components.js`): 8 cerchi della palette + cerchio arcobaleno per qualsiasi colore (hex);
`onDone` salva una volta sola alla chiusura della tavolozza. Colori liberi salvati in minuscolo;
`colorVar()` (common) dà `var(--cN)` o l'hex. "Tutti i colori come all'inizio" (due tocchi) rimette
la palette Excel (non tocca categorie e sezioni).
Layout a **tutta larghezza** (D col monitor da 27": niente `max-width`), barra laterale
**comprimibile** (pulsante in basso o tasto `[`, `html.side-mini`, `rhf-side`). Menu **compatto**
(D: "un po' più compatto ma con il giusto spazio tra i diversi blocchi"): larghezza 236 px, voci alte
35 px e vicine, titoli dei blocchi (Gestione, Pianificazione, Strumenti) con 14 px sopra. Chiuso (86 px,
anche sugli schermi da 760 a 1100 px) ha **il nome sotto ogni icona** (D: "aggiungi i titoli sotto
all'icona per far vedere cosa è"; "Cerca" con `span.mini-l`), una lineetta tra un blocco e l'altro e
i pulsanti in fondo su due colonne, così entra tutto in 945 px di altezza; finestre alte
fino allo schermo (niente tetti a 46vh/900px), `sheet-lg` fino a 1280 px.
**Intestazioni delle tabelle al centro e rinominabili** (D: "i nomi delle intestazioni delle tabelle li
voglio centrali. ma anche qui, dammi la possibilità di modificarli come voglio"): tutte le `thead th`
centrate; nelle tabelle con `data-tid` si tocca l'intestazione (passandoci sopra compare una piccola
matita nell'angolo in alto a destra, `.th-rename::after` con una maschera SVG; sugli schermi touch è
sempre visibile, tenue) e si scrive il nome (riquadro
`.name-pop` in `ui/tables.js`, "Torna a «…»" per il nome di partenza). Nomi in `settings.colNames`
(`"tabella|colonna"`, sincronizzati), chiave della colonna = `data-col` (stabile: Net Worth `name`,
`c0`…`c12`, `diff`, `pct`; Entrate e uscite `name`, `m0`…`m11`, `tot`, `avg`, `pct`, separati per
entrate e uscite) o il testo di partenza; le tabelle "adattate" usano lo stesso nome (`-fit` tolto).
I riquadri sopra la pagina (nome della colonna, colore) si chiudono scorrendo solo se l'elemento si è
spostato di più di 60 px (prima il piccolo scorrimento del trackpad li chiudeva subito). Se nemmeno il
carattere più piccolo basta (schermo stretto, numeri a 6 cifre), `fitTable` torna `null`: la tabella
scorre di lato invece di tagliare le cifre; le date intere solo con 10 px di margine.
Tabelle con `data-tid`: **colonne allargabili** trascinando il bordo dell'intestazione
(`ui/tables.js`, larghezze in `rhf-tables`, doppio clic per tornare); `filterBox()` per filtrare.
Loghi: banche (`data/banks.js`, `icons/banks/`) dalle icone ufficiali dei loro siti e crypto
(`data/coins.js`, `icons/crypto/`) dalle immagini di CoinGecko, scaricati **una volta** da un
workflow temporaneo (poi tolto) e salvati nell'app: nessuna richiesta a terzi durante l'uso.
Titoli: distintivo ETF / ETC / STOCK / BOND / FONDO (D: "per gli etf basta un semplice logo").
Superfici senza bordi né ombre (si distinguono per colore), schede con angoli 24 px,
pulsanti a pillola, carattere Inter (in `fonts/`, niente Google Fonts), numeri grandi,
barre in vetro sfocato. Su computer barra laterale; su telefono barra in basso a
capsula con il "+" al centro e finestre che salgono dal basso. Temi Automatico / Chiaro /
Scuro. Palette dei grafici validata per daltonismo (`--c1`…`--c8` nei due temi).
Gusti di D visti in `documenti-raho/CLAUDE.md`: niente ombre sotto le schede, contrasti
netti, pulito ed elegante.

## Prove

- `npm test`: 58 test (calcoli, colori scelti, reimport e controllo col foglio, cifratura, unione dei dati, CSV, investimenti, import da Excel di tutti i fogli, crypto, storia degli acquisti, quotazioni con risposte finte).
- `bash test/rls/run.sh`: regole di sicurezza del database su Postgres.
- Nel browser: `python3 -m http.server` nella cartella e Playwright (Chromium già
  installato). Da questo ambiente onvista/Binance/BCE non sono raggiungibili: per provarli
  dal vivo serve un workflow temporaneo su un ramo (poi cancellato).
- "Prova con dati di esempio" (`js/demo.js`): dati inventati, solo in memoria.
