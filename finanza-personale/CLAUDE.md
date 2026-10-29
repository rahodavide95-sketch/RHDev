# [RH] Finance (cartella `finanza-personale`)

App di gestione della finanza personale di D (Davide Raho), nata dalla vecchia "Analisi
Finanziarie" (simulazioni conto corrente / deposito / PAC + mercati), rifatta da zero su
sua richiesta: "super completa, efficiente ma soprattutto AFFIDABILE, super sicura per la
privacy, design degno dei migliori design moderni".
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
- Dati di mercato solo dopo consenso (`settings.market.enabled`); i proxy pubblici
  (allorigins, corsproxy) solo per la pagina Mercati, mai per i prezzi del portafoglio
  se non esplicitamente attivato. Nuovi domini vanno aggiunti alla CSP in `index.html`
  **e** in `vercel.json`.
- Label Finance, quando si aggiorna, cancella tutte le cache del sito tranne la sua:
  `sw.js` si ricompleta a ogni apertura (messaggio `refill`). La cache contiene solo
  codice, mai dati.

## Design

Superfici senza bordi né ombre (si distinguono per colore), schede con angoli 24 px,
pulsanti a pillola, carattere Inter (in `fonts/`, niente Google Fonts), numeri grandi,
barre in vetro sfocato. Su computer barra laterale; su telefono barra in basso a
capsula con il "+" al centro e finestre che salgono dal basso. Temi Automatico / Chiaro /
Scuro. Palette dei grafici validata per daltonismo (`--c1`…`--c8` nei due temi).
Gusti di D visti in `documenti-raho/CLAUDE.md`: niente ombre sotto le schede, contrasti
netti, pulito ed elegante.

## Prove

- `npm test`: 20 test (calcoli, cifratura, CSV, quotazioni con risposte finte).
- Nel browser: `python3 -m http.server` nella cartella e Playwright (Chromium già
  installato). Da questo ambiente Yahoo/Binance/BCE non sono raggiungibili.
- "Prova con dati di esempio" (`js/demo.js`): dati inventati, solo in memoria.
