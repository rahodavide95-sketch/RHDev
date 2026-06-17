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
├── index.html          ← APP MVP (sito da deployare)
├── app.js              ← logica: store locale, import CSV, dashboard
├── style.css           ← interfaccia
├── vercel.json         ← config deploy
├── README.md           ← questo file (mappa del progetto)
├── docs/               ← documentazione
│   ├── PROGETTO.md      ← documento di progetto completo (LEGGI QUESTO)
│   └── SICUREZZA-PRIVACY.md  ← sicurezza dati e GDPR
└── data/
    └── samples/         ← esempi di CSV (Bandcamp, distributore) per i test
```

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
