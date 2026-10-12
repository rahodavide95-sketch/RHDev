# Aggiornamento sicurezza e calcoli (ottobre 2026) — cosa fare online

Il codice dell'app si aggiorna da solo con la pubblicazione (GitHub Pages / Vercel).
Il **database** e le **Edge Functions** invece vivono su Supabase: vanno aggiornati
a mano, una volta. Ci vogliono ~5 minuti.

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

## 2. Edge Functions (obbligatorio)
Dalla cartella `label-finance/` (dove c'è `supabase/`):
```bash
supabase functions deploy ai-advisor
supabase functions deploy artist-statement --no-verify-jwt
supabase functions deploy catalog-search
supabase functions deploy create-checkout
supabase functions deploy create-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```
- `ai-advisor`: il piano ora si legge dagli abbonamenti veri (non dai dati dell'app,
  che l'utente può modificare). In beta l'AI resta disponibile agli **utenti
  approvati**. Modello aggiornato a `claude-opus-5-5`. Secret facoltativi:
  `AI_DAILY_LIMIT` (default 30 al giorno per utente), `AI_ALLOW_APPROVED=false` al lancio.
- `artist-statement`: usa gli stessi calcoli dell'app (`_shared/lfcore.js`); il
  "netto" non conta più le vendite successive al periodo e mostra i pagamenti.
- `catalog-search`: solo per utenti con login, massimo 3 etichette per richiesta.
  Prima era deployata con `--no-verify-jwt`: ora non serve più.
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
