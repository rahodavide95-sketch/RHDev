# Analisi Finanziarie (cartella `finanza-personale`)

App di gestione della finanza personale di D (Davide Raho), nata dalla vecchia "Analisi
Finanziarie" (simulazioni conto corrente / deposito / PAC + mercati), rifatta da zero su
sua richiesta: "super completa, efficiente ma soprattutto AFFIDABILE, super sicura per la
privacy, design degno dei migliori design moderni".
Il nome è **"Analisi Finanziarie"**, quello di D: era stato rinominato di nostra iniziativa
"[RH] Finance" e a D non è piaciuto ("chi ti ha detto di chiamarla così?"). Non inventare
nomi, loghi con scritte o marchi: se serve, chiedi. Il logo è il **grafico a ciambella**
(tre spicchi bianco, grigio e verde `#00e5a0` della vecchia app, su nero): D l'ha scelto tra
6 proposte dopo aver bocciato il primo ("il logo fa cagare"). File: `icons/icon.svg` (anche
nella barra laterale e nella schermata di accesso) e le PNG generate da lì.
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

## Pagina Patrimonio (`views/networth.js`, richiesta di D)

D: "una pagina per il networth, dove monitorare l'andamento mese dopo mese di ogni cosa
che ho e alla fine dell'anno rispetto alla fine dell'anno precedente per capire la
differenza". Contiene: patrimonio di oggi con la differenza dal 31/12 dell'anno prima, in
12 mesi e il massimo; grafico a barre impilate per gruppo + linea del patrimonio; scelta
dell'anno; confronto 31/12 anno prima → 31/12 (o oggi) per gruppo e conto, con la
scomposizione Risparmiato (entrate − uscite dei conti del patrimonio) + Conti aggiunti
(valore iniziale dei conti nati nell'anno) + Variazioni di valore (il resto); tabella mese
per mese (colonna del 31/12 precedente, prima colonna fissa, si apre sugli ultimi mesi,
CSV); anno per anno. "Aggiorna i valori" (`checkInEditor`, `actions.saveCheckIn`): più
conti alla stessa data; conti normali → punto fermo `adjust`; conti con titoli solo a una
fine mese passata → fotografia `snapshots[mese].byAcc` (valore dei titoli = totale meno
liquidità); mutui con piano: non si scrivono.
**Net Worth come il foglio di D** (D: "lo voglio esattamente come il file excel, per ogni
categoria ci deve essere il gain loss sia in numero sia in %"): `d.nwSheet(anno, filtro)` →
colonne 31/12 dell'anno prima + fine di ogni mese (vuote nel futuro), sezioni con righe =
conti senza titoli (`a:id`), **singoli titoli** (`h:id`) e liquidità dei conti titoli
(`c:id`, solo se non zero); per sezione Total, Gain/Loss (sul mese prima) e %; in fondo Net
Worth (Total, Gain/Loss, %) e Asset Allocation (quota di ogni sezione sugli attivi).
L'ordine e i nomi delle sezioni stanno in `settings.nwLayout` ({sections:[{name,color,items}],
labels}), scritto dall'import del foglio Net Worth o da "Organizza"; le righe non in elenco
vanno nelle sezioni di base (Liquidità, ETF, Azioni, Obbligazioni, Fondi, Materie prime,
Crypto, …). Valore di un titolo a fine mese: `snapshots[mese].byHd[id]` (dal foglio o dalla
fotografia automatica, che ora salva anche per titolo), altrimenti la sua parte della
fotografia del conto, altrimenti quantità di allora × prezzo attuale (`holdingValueAt`).
Calcoli in `derive()`: `valueAt(conto, data)` (null prima che il conto esista),
`netWorthAt(data)`, `monthClose`, `yearClose`, `firstDate`. Un conto **archiviato** resta
nel patrimonio (e nello storico) se ha "Conta nel patrimonio": un conto chiuso deve
continuare a valere nei mesi in cui esisteva; nella pagina Conti un archiviato con saldo
diverso da zero resta visibile.

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
  fine mese di quei titoli (`byHd`) e le loro righe nel layout, non conti; nella sezione della
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
sulla media) → una scheda colorata per macro (totale, quota, barra, media, andamento; tocca
per vedere solo quella) → grafico a barre impilate per macro → tabella: riga della macro
(somma, colorata, si apre e chiude) e sotto le voci rientrate, GEN…DIC, Totale, Media, %;
macro senza voci vere (ALTRO) = una riga; note (`payee` diverse dal nome) a richiesta
("1 nota ›" o "Mostra tutte le note"); "Anche le voci senza importi" acceso (13ESIMA a zero
resta, come nel foglio); filtro con totali rifatti; CSV. Colori: `groupColor()` = colore
scelto o uno diverso per ogni macro nell'ordine (non più dal nome). L'import crea anche le
voci ancora a zero (`planMonths().keys`) e, con "Solo le categorie del file", dà alle
categorie già presenti i nomi del file. Test col file di prova che ha questa struttura.
**Categorie uniche** (D: "perché due categorie lavoro? è solo 1"): import di versioni diverse
avevano scritto "Lavoro" e "LAVORO". `catNorm()` (minuscole, senza accenti né simboli) = stessa
macro / stessa voce. `yearTable` raggruppa con `catNorm`; `tidyPlan`/`applyTidy` (model) danno a
ogni macro un solo nome (quello delle categorie con movimenti, a pari merito il maiuscolo) e
fondono le voci doppie spostando movimenti, scadenze, regole e budget; `actions.tidyCategories()`
gira all'apertura (con un avviso se ha unito qualcosa) e dentro ogni import del file. L'ordine
delle macro guarda solo le categorie visibili (una "Altro" nascosta non porta ALTRO in alto).

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
Layout a **tutta larghezza** (D col monitor da 27": niente `max-width`), barra laterale
**comprimibile** (pulsante in basso o tasto `[`, `html.side-mini`, `rhf-side`), finestre alte
fino allo schermo (niente tetti a 46vh/900px), `sheet-lg` fino a 1280 px.
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

- `npm test`: 48 test (calcoli, cifratura, unione dei dati, CSV, investimenti, import da Excel di tutti i fogli, crypto, storia degli acquisti, quotazioni con risposte finte).
- `bash test/rls/run.sh`: regole di sicurezza del database su Postgres.
- Nel browser: `python3 -m http.server` nella cartella e Playwright (Chromium già
  installato). Da questo ambiente onvista/Binance/BCE non sono raggiungibili: per provarli
  dal vivo serve un workflow temporaneo su un ramo (poi cancellato).
- "Prova con dati di esempio" (`js/demo.js`): dati inventati, solo in memoria.
