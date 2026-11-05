# Social Lens

Analizzatore di profili Instagram chiesto da D ("sapresti crearmi un analizzatore completo di profili instagram?"). Il nome l'ha scelto D: "chiamalo Social Lens" (cartella `social-lens/`).
D scrive in italiano e non è uno sviluppatore: spiega in modo semplice e fai tu le modifiche. Tutti i testi dell'app sono in italiano.

Online: https://rahodavide95-sketch.github.io/RHDev/social-lens/ (pubblicata dal workflow `deploy-pages.yml` quando arriva su `main`). Niente server: tutto gira nel browser.
Il repo è pubblico: mai nomi, token o dati personali nel codice. I dati d'esempio sono inventati (`demo.artista`, `demo.band`).

## File

- `index.html`: markup e CSS (colori come variabili su `:root`, modalità scura sia con `prefers-color-scheme` sia con `data-theme`). Lo script nel `<head>` applica il tema prima del primo disegno.
- `core.js`: il motore, senza interfaccia. Nel browser è `window.SocialLens`, in Node `require('./core.js')`. Qui va ogni calcolo nuovo, con la sua prova.
- `app.js`: l'interfaccia (HTML generato come stringhe, sempre con `esc()`; link solo `http(s)` con `safeLink()`, immagini solo `https` con `safeImg()`).
- `sw.js`: rete prima di tutto, cache solo per l'uso offline. Se cambi l'elenco dei file alza `VERSION`.
- `test/core.test.js`: `cd social-lens && npm test` (usa `TZ=Europe/Rome`; le prove ZIP chiamano `python3`).

## Le tre fonti di dati (tutte consentite: niente scraping)

1. **API di Meta** (`makeApi()` in `core.js`). Token "EAA…" (Accesso con Facebook) → `graph.facebook.com`, oppure "IG…" (Accesso con Instagram) → `graph.instagram.com`, solo il proprio account. Versione predefinita `API_VERSION` (`v25.0`), modificabile nelle impostazioni avanzate.
   - `accounts()`: `me/accounts` con `instagram_business_account` (token IG: `me`).
   - `discover()`: `business_discovery.username(x){…,media.after(c).limit(n){…}}` sull'ID del proprio account; solo profili Business/Creator. Se un campo non esiste (errore 100) riprova con meno campi (`view_count` → `MEDIA_FULL` → `MEDIA_SAFE`).
   - `own()`: profilo + `media` + insights per post (`reach,saved,shares,views,total_interactions`, con ripieghi), `follower_demographics` (country, city, age, gender), totali di 28 giorni, `follower_count` giornaliero. `impressions` e `plays` non esistono più: non usarli.
   - Errori spiegati in italiano da `explainError()` (190 token, 110 profilo non Business, 4/17/32/613 limiti, 10/200 permessi).
   - Il token resta nel browser: `sessionStorage` (`social-lens.token`) e, solo se spunta "Ricorda", in `settings.token`.
2. **Export di Instagram** (JSON). `readExportZip()` legge lo ZIP senza librerie (indice centrale + `DecompressionStream('deflate-raw')`, ZIP64 compreso) e apre solo i `.json` che servono (`kindOf()`), così un export di GB non va in memoria. `parseExport()` capisce sia il formato vecchio (`string_list_data[0].value`) sia il nuovo (nome in `title`, oppure `label_values`), e ripara il testo con `fixText()` (UTF-8 salvato come Latin-1). Un export in HTML viene riconosciuto e si chiede il JSON. `analyzeExport()` fa elenchi, grafici e il confronto con l'export precedente (`DB.exportSnaps`, fino a 3 per account; se lo stesso export viene ricaricato si confronta con quello prima).
3. **CSV o a mano**: `csvToPosts()` riconosce le colonne in italiano e inglese (anche il CSV di Meta Business Suite con "Publish time" mese/giorno), separatore `,` `;` o tab, numeri come `1.234`, `12,5K`, `1,2 mln`.

## L'analisi (`analyze()`)

- ER = (mi piace medi + commenti medi) / follower. I post delle ultime 24 ore sono esclusi dalle medie (se ne restano almeno 3). Mi piace nascosti (`null`): contano solo i commenti.
- Fasce `TIERS` con valori tipici indicativi; `erRating()`.
- Punteggio `scoreOf()`: coinvolgimento 35, costanza 20, attività recente 15, varietà formati 10, profilo completo 10 (solo con API/esempio o se bio/link sono stati scritti), andamento 10. Le voci senza dati non contano.
- Momento migliore: celle giorno × fascia di 3 ore (ora del dispositivo) con almeno 2 post se ce ne sono 20 o più.
- `tipsOf()` consigli, `signalsOf()` segnali (scritti come indizi, mai come accuse), `valueOf()` forchetta indicativa per post e storie.

## Dati sul dispositivo

`localStorage` chiave `social-lens.v1`: `{ v:1, profiles: { [username]: { last (profilo con max 200 post, didascalie ≤500), history: [misure], summary, … } }, exportSnaps, settings: { version, maxPosts, theme, accounts, igId, token } }`.
Ogni analisi aggiunge una misura alla storia (se l'ultima ha meno di 6 ore, la sostituisce): da qui la crescita dei follower. L'archivio si esporta/importa in JSON (`app: 'social-lens'`).

## Grafici

Fatti a mano (HTML + SVG, nessuna libreria): `columns()`, `line()`, `hbars()`, `heatmap()`, `ring()`, `bench()`. Colori dei dati dalla palette validata (`--s1…--s4`, rampa `--q1…--q6`), testo sempre nei colori del testo, legenda quando ci sono più serie, suggerimento al passaggio (`data-tip`) anche al tocco. Nel confronto ogni profilo tiene il suo colore finché resta selezionato.
