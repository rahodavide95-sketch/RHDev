# Label Finance — Gestionale Entrate/Uscite per Etichette

Prodotto **separato e indipendente** dal sito della label (`../etichetta/`).
Qui vive il gestionale per registrare entrate (vendite) e uscite (spese) di
un'etichetta discografica, con import automatico da CSV e API (Bandcamp, ecc.).

> ⚠️ Questo NON tocca il sito web della label. Sono due progetti distinti.

## Stato

Fase 1 — **MVP personale pronto**: app browser single-user con import CSV,
dashboard entrate/uscite e backup locale. Dati solo sul dispositivo.

## Come sono organizzate le cartelle

L'app vive **direttamente in questa cartella** (come gli altri progetti del repo),
così si pubblica su Vercel impostando la Root Directory su `label-finance`.

```
label-finance/
├── index.html          ← sito pubblico (landing) + landing.js
├── app.html            ← l'app
├── core.js             ← calcoli puri e testati: importi/date CSV, royalty,
│                         recoupment, pagamenti, statement, unione dati sync
├── app.js              ← interfaccia e logica dell'app
├── sync.js             ← login + sincronizzazione cloud (Supabase)
├── firma.html/.js      ← pagina pubblica di firma contratto
├── artista.html/.js    ← portale artista (statement in sola lettura)
├── vendor/             ← librerie esterne con versione fissa (supabase-js)
├── style.css           ← interfaccia
├── vercel.json         ← config deploy + intestazioni di sicurezza
├── test/               ← test automatici (npm test)
├── supabase/
│   ├── schema.sql      ← TUTTO il database (sicuro da rieseguire)
│   └── functions/      ← Edge Functions (AI, portale artista, Stripe, catalogo)
├── docs/               ← documentazione
│   ├── AGGIORNAMENTO.md ← cosa fare su Supabase dopo l'ultimo aggiornamento
│   ├── PROGETTO.md      ← documento di progetto completo (LEGGI QUESTO)
│   ├── SICUREZZA-PRIVACY.md  ← sicurezza dati e GDPR
│   └── SYNC-SETUP.md   ← guida sincronizzazione cloud (PC + telefono)
└── data/
    └── samples/         ← esempi di CSV (Bandcamp, distributore) per i test
```

## Test

```bash
cd label-finance
npm test
```
I test girano con il fuso orario italiano (`TZ=Europe/Rome`): coprono importi in
formato europeo/americano, date senza slittamenti, royalty, recoupment, pagamenti,
statement, deduplica dell'import e unione dei dati tra dispositivi.

## Deploy su Vercel

New Project → importa il repo → **Root Directory = `label-finance`** →
Framework Preset = **Other** → Deploy. Identico a `etichetta`, `apex-finance`, ecc.

## Come provarla

Apri `index.html` nel browser → **Importa CSV** → carica
`data/samples/bandcamp_esempio.csv` (formato data: Mese/Giorno/Anno) → guarda la
dashboard popolarsi.

## Prossimo passo

Fase 1 — MVP personale: carichi un CSV e vedi entrate/uscite e margine per
release. Dettagli nella roadmap del documento di progetto.
