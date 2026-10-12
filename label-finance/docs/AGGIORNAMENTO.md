# Aggiornamento sicurezza e calcoli (ottobre 2026) — cosa fare online

Il codice dell'app si aggiorna da solo con la pubblicazione (GitHub Pages / Vercel).
Il **database** e le **funzioni del server** invece vivono su Supabase: il database
va aggiornato a mano (un copia-incolla), le funzioni si pubblicano da sole dopo
un'impostazione fatta una volta. In tutto ~5 minuti.

## 1. Database (obbligatorio)
Dashboard Supabase → **SQL Editor** → **New query** → incolla tutto
`supabase/schema.sql` → **Run**. È sicuro rieseguirlo.

Cosa cambia:
- **Firma contratti**: il server accetta solo un'immagine PNG come firma, decide lui
  data e ora, e calcola un'impronta dei termini firmati. Un contratto firmato non si
  può più modificare né "rifiutare" dopo la firma.
- **Approvazione**: un utente non approvato non può più leggere o scrivere dati
  (prima il blocco era solo grafico). Chi usava già l'app resta approvato.
- **Limite AI**: nuova tabella `ai_usage` per il limite giornaliero.
- **Sync tra dispositivi**: `app_state` entra negli aggiornamenti in tempo reale.

## 2. Funzioni del server (Edge Functions) — si pubblicano da sole
Le "Edge Functions" sono i pezzi di programma che girano sui server di Supabase
(assistente AI, portale artista, pagamenti, ricerca catalogo). Il loro codice sta
in questo repository, ma va **copiato su Supabase** ogni volta che cambia.

Lo fa GitHub in automatico (file `.github/workflows/deploy-supabase-functions.yml`).
Serve solo un'impostazione, **una volta sola**: dare a GitHub una "chiave" per
pubblicare sul tuo progetto Supabase.

1. **Crea la chiave su Supabase**
   Apri https://supabase.com/dashboard/account/tokens → **Generate new token** →
   nome a piacere (es. `github`) → **Generate** → **copia** il token (inizia con `sbp_`).
   ⚠️ È come una password: non condividerlo e non incollarlo nel codice.
2. **Incollala su GitHub**
   Apri il repository su GitHub → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**:
   - Name: `SUPABASE_ACCESS_TOKEN`
   - Secret: il token copiato al punto 1
   → **Add secret**.
3. **Pubblica**
   Su GitHub → scheda **Actions** → a sinistra **Deploy Supabase Edge Functions
   (Label Finance)** → **Run workflow** → **Run workflow**. Dopo un paio di minuti
   compare la spunta verde ✓: le funzioni sono online.

Da quel momento, ogni volta che una modifica alle funzioni entra in `main`, la
pubblicazione parte da sola. (Se il secret manca, il workflow si salta con un
avviso e non pubblica nulla.)

<details><summary>In alternativa, dal tuo computer (per chi usa il terminale)</summary>

Con la [CLI di Supabase](https://supabase.com/docs/guides/cli) installata, dalla
cartella `label-finance/` del repository:
```bash
supabase login
supabase functions deploy ai-advisor --project-ref ztjlqorvnulgfvbtvavm
supabase functions deploy catalog-search --project-ref ztjlqorvnulgfvbtvavm
supabase functions deploy create-checkout --project-ref ztjlqorvnulgfvbtvavm
supabase functions deploy create-portal --project-ref ztjlqorvnulgfvbtvavm
supabase functions deploy artist-statement --project-ref ztjlqorvnulgfvbtvavm --no-verify-jwt
supabase functions deploy stripe-webhook --project-ref ztjlqorvnulgfvbtvavm --no-verify-jwt
```
</details>

Cosa cambia nelle funzioni con questo aggiornamento:
- `ai-advisor`: il piano ora si legge dagli abbonamenti veri (non dai dati dell'app,
  che l'utente può modificare). In beta l'AI resta disponibile agli **utenti
  approvati**. Modello aggiornato a `claude-opus-5-5`. Secret facoltativi:
  `AI_DAILY_LIMIT` (default 30 al giorno per utente), `AI_ALLOW_APPROVED=false` al lancio.
- `artist-statement`: usa gli stessi calcoli dell'app (`_shared/lfcore.js`); il
  "netto" non conta più le vendite successive al periodo e mostra i pagamenti.
- `catalog-search`: solo per utenti con login, massimo 3 etichette per richiesta.
- `stripe-webhook` / `create-checkout`: niente doppio abbonamento, e la disdetta di
  un abbonamento vecchio non azzera quello nuovo.

## 3. Controllo rapido
- Apri l'app, accedi: i dati devono comparire come prima.
- Royalty → "Pronti da pagare": accanto a ogni artista c'è **✓ Pagato**.
- Contratti: invia un contratto di prova, firmalo dal link, poi prova a modificarlo:
  l'app chiede di rifirmarlo.

## Note
- I test automatici dei calcoli: `npm test` dentro `label-finance/`.
- Se modifichi `core.js`, copia il file anche in `supabase/functions/_shared/lfcore.js`
  (un test controlla che siano uguali) e rideploya `artist-statement`.
