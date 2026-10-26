# Orbita · il tuo mondo in viaggio

Web app (installabile come app su iPhone, Android e computer) per tenere il diario
dei viaggi su un **globo 3D**, con un **passaporto del viaggiatore** che conta paesi,
continenti, regioni, città, aeroporti e chilometri, un **Recap animato** e la
**condivisione dei viaggi via email**. Stile Apple iOS 26/27 "Liquid Glass": blu notte, colori "gioiello" morbidi e dettagli oro champagne.

## Cosa fa (versione 1)

- **Globo 3D** che si gira col dito, si avvicina con il pizzico o la rotella. I paesi
  visitati si alzano in rilievo e si colorano (per continente, per numero di visite o
  per anno). Ci sono anche i voli come archi animati, le città come punti luminosi, la
  casa con un anello pulsante e la lista dei desideri in oro. Tocca un paese per la sua
  scheda.
- **Recap** a "storie": il globo parte spento e si accende viaggio dopo viaggio, con la
  camera che vola di tappa in tappa, gli archi dei voli che si disegnano e i contatori
  che salgono. Puoi scegliere tutti i viaggi, un anno o un singolo viaggio, mettere in
  pausa e andare 2× o 4×.
- **Passaporto**: carta olografica in stile Wallet (si inclina e si gira), con:
  - paesi su 195 e % del mondo, territori, continenti, regioni e stati (anche le 20
    regioni italiane e i 50 stati USA);
  - città, aeroporti, voli, km volati (giri della Terra, strada per la Luna), ore in
    aria, giorni e notti in viaggio;
  - timbri per ogni paese, 24 traguardi, livelli da Sognatore a Leggenda, grafico
    anno per anno e record (volo più lungo, punti estremi, il più lontano da casa…).
- **Viaggi** con tappe (55.000 città con nomi italiani, oppure un punto scelto sul
  globo), voli (4.000 aeroporti con codice IATA, distanza calcolata), date, notti,
  note, icona e colore. Il conto alla rovescia per il prossimo viaggio.
- **Account** con email e password robusta, accesso con link via email, verifica in
  due passaggi (codice da app), password dimenticata, sincronizzazione tra
  dispositivi, esportazione e importazione dei dati, eliminazione dell'account.
- **Condivisione**: inviti via email per un viaggio, "può vedere" o "può modificare",
  revocabili in ogni momento. Chi riceve l'invito decide se il viaggio conta nel suo
  passaporto.
- **Funziona anche senza account e offline**: i dati restano sul dispositivo finché
  non accedi.

## Come provarla

L'app non ha bisogno di compilazione. In locale:

```bash
cd orbita
python3 -m http.server 8000      # poi apri http://localhost:8000
```

Tocca **Guarda un esempio** per vedere subito il globo pieno di viaggi.

Pubblicazione: con il deploy di GitHub Pages già attivo sul repo, dopo il merge su
`main` l'app è su `https://<utente>.github.io/<repo>/orbita/`. Su Vercel: New Project
→ Root Directory `orbita` → Framework "Other" (le intestazioni di sicurezza sono in
`vercel.json`).

**Account, sincronizzazione e inviti** richiedono un progetto Supabase gratuito:
segui [`docs/SETUP.md`](docs/SETUP.md) (circa 15 minuti). Senza, l'app funziona in
modalità locale.

## Sicurezza in breve

Dettagli in [`docs/SICUREZZA.md`](docs/SICUREZZA.md).

- Regole RLS sul database: ogni riga è visibile solo al proprietario e agli invitati
  (con email verificata). I test in `test/rls/` lo verificano su un vero Postgres.
- La verifica in due passaggi è applicata dal database stesso: senza codice non
  esce nulla.
- Content Security Policy rigida e nessuno script in linea. Tutto ciò che viene
  dall'utente viene "escapato" prima di essere mostrato.
- Nessuna libreria caricata da siti esterni, nessun tracciamento. Le ricerche di
  città e aeroporti restano nel dispositivo.
- Quando esci, i dati dell'account vengono tolti dal dispositivo.

## Struttura

```
orbita/
├── index.html            pagina unica (CSP, nessuno script in linea)
├── css/app.css           stile Liquid Glass
├── js/
│   ├── app.js            avvio, navigazione, foglio a scatti, barra delle schede
│   ├── globe.js          globo 3D (globe.gl / three.js)
│   ├── recap.js          Recap animato
│   ├── stats.js          statistiche, livelli e traguardi (funzioni pure, testate)
│   ├── model.js          forma e validazione dei dati (testata)
│   ├── store.js          dati sul dispositivo, uno spazio per account
│   ├── cloud.js          account, sincronizzazione, inviti (Supabase)
│   ├── geo.js            paesi, città, aeroporti: ricerca locale
│   ├── config.js         URL e chiave pubblica di Supabase (vuoti = modalità locale)
│   └── views/            schermate: home, viaggi, editor, passaporto, profilo…
├── data/                 dataset compatti (generati da tools/build-data.cjs)
├── vendor/               globe.gl e supabase-js, versioni fisse
├── fonts/                Inter (riserva quando il sistema non ha SF)
├── supabase/
│   ├── schema.sql        database + regole di sicurezza (rieseguibile)
│   └── functions/trip-invite/   funzione che manda l'email d'invito
├── test/                 test automatici (npm test) e test di sicurezza (test/rls)
├── docs/                 SETUP.md, SICUREZZA.md
└── sw.js, manifest.webmanifest   app installabile e offline
```

## Test

```bash
cd orbita
npm test                 # statistiche, validazione, ricerca, integrità dei file
bash test/rls/run.sh     # regole di sicurezza del database (serve PostgreSQL 15+)
```

## Crediti dei dati

- Confini e regioni: [Natural Earth](https://www.naturalearthdata.com/) (pubblico dominio)
- Città: [GeoNames](https://www.geonames.org/) via `all-the-cities` (CC BY 4.0)
- Aeroporti: [OurAirports](https://ourairports.com/data/) (pubblico dominio)
- Paesi e nomi italiani: `world-countries` (ODbL)
- Globo: [globe.gl](https://github.com/vasturiano/globe.gl) (MIT) · font Inter (OFL)
