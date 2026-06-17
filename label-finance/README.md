# Label Finance — Gestionale Entrate/Uscite per Etichette

Prodotto **separato e indipendente** dal sito della label (`../etichetta/`).
Qui vive il gestionale per registrare entrate (vendite) e uscite (spese) di
un'etichetta discografica, con import automatico da CSV e API (Bandcamp, ecc.).

> ⚠️ Questo NON tocca il sito web della label. Sono due progetti distinti.

## Stato

Fase 1 — **MVP personale pronto** (`app/frontend/`): app browser single-user con
import CSV, dashboard entrate/uscite e backup locale. Dati solo sul dispositivo.

## Come sono organizzate le cartelle

```
label-finance/
├── README.md            ← questo file (mappa del progetto)
├── docs/                ← documentazione
│   ├── PROGETTO.md      ← documento di progetto completo (LEGGI QUESTO)
│   └── SICUREZZA-PRIVACY.md  ← sicurezza dati e GDPR
├── app/
│   ├── frontend/        ← APP MVP (index.html, app.js, style.css) — pronta
│   └── backend/         ← futuro (SaaS multi-utente), ancora vuoto
└── data/
    └── samples/         ← esempi di CSV (Bandcamp, distributore) per i test
```

## Da dove iniziare

1. Leggi **`docs/PROGETTO.md`** — spiega cosa si può fare, come, e la roadmap.
2. Per partire con lo sviluppo servono **CSV di esempio** (Bandcamp + tuo
   distributore), da mettere in `data/samples/`.

## Prossimo passo

Fase 1 — MVP personale: carichi un CSV e vedi entrate/uscite e margine per
release. Dettagli nella roadmap del documento di progetto.
