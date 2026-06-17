# Frontend — App MVP (Fase 1)

App gestionale **single-user**, gira interamente nel browser. I dati sono
salvati in locale (`localStorage`): non escono dal dispositivo, nessun server,
nessun login. Pronta per il deploy su Vercel come il sito della label.

## File
- `index.html` — struttura e viste (Dashboard, Movimenti, Importa, Impostazioni)
- `style.css` — interfaccia (tema scuro, responsive)
- `app.js` — logica: store locale, importatore CSV universale, dashboard, backup
- `vercel.json` — config deploy

## Cosa fa
- **Importa CSV** da qualsiasi piattaforma con mappatura colonne + preset salvabili
  (auto-riconosce le colonne; gestisce numeri IT/US e date Bandcamp).
- **Movimenti**: entrate/uscite, aggiunta/modifica manuale, ricerca e filtri.
- **Dashboard**: entrate vs uscite, margine, grafico mensile, totali per
  release/catalogo e per piattaforma, multi-valuta → EUR.
- **Impostazioni**: tassi di cambio, backup/ripristino (JSON), export CSV.

## Come provarla
Apri `index.html` nel browser. Per i dati di prova importa
`../../data/samples/bandcamp_esempio.csv` (formato data: "Mese/Giorno/Anno").

## Deploy
Pubblica la cartella `app/frontend/` come progetto statico su Vercel.

> Evoluzione futura (SaaS): si aggiunge un backend (Supabase) sopra questa base,
> sostituendo lo store locale con un database multi-utente. Vedi
> `../../docs/PROGETTO.md` e `../../docs/SICUREZZA-PRIVACY.md`.
