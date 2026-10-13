# Login più compatto e righe di Movimenti uguali (ottobre 2026) — niente da fare online

Nessuna modifica al database: basta la pubblicazione dell'app.

- **Login**: niente più spazio vuoto sotto Accedi / Registrati (la riga dei messaggi
  compare solo quando c'è un messaggio).
- **Movimenti**: tutte le righe alte uguali in Entrate, Uscite e Tutti (prima la
  pillola IN/OUT, la casella "Pagato" o la 📎 degli allegati allungavano alcune righe).

---

# Ritocchi grafici e Impostazioni riordinate (ottobre 2026) — niente da fare online

Nessuna modifica al database: basta la pubblicazione dell'app.

- **Impostazioni** su due colonne ordinate: a sinistra Profilo e Account, a destra
  Preferenze, Team e Tassi di cambio; Backup sotto a tutta larghezza. I tassi fissi
  sono in una sezione apribile (si apre da sola se spegni i cambi BCE).
- **Movimenti**: la barra delle schede non si sposta più passando a Uscite; il
  Registro pagamenti si apre in una finestra più grande.
- **+ Entrata / + Uscita** in colori pastello pieni, senza bordo, più luminosi al passaggio.
- **Dashboard**: periodo, Personalizza e Report PDF su una riga sola, tutti alti uguali
  (sul telefono ⚙ e "PDF" compatti; le date del periodo personalizzato vanno sotto).
- **Login** senza bordo.
- **Calendario**: ogni evento ha in prima riga il tipo di attività in maiuscolo.

---

# Movimenti, "Pagato", pianificazione e distributori (ottobre 2026) — niente da fare online

Nessuna modifica al database: basta la pubblicazione dell'app.

- **Movimenti** divisi in schede Entrate / Uscite / Tutti, con maschere separate
  (l'uscita ha solo i campi di una spesa: categoria, fornitore, descrizione, importo…).
- **Pagato** sulle uscite: una spesa da pagare resta nell'elenco ma non conta nei
  totali finché non la segni come pagata; in dashboard si vede quanto c'è da pagare.
  Ogni cambio resta nel **Registro pagamenti** (quando, chi, da dove). La colonna
  PAGATO dei fogli Excel/Google viene letta all'import.
- **Pianificazione**: nuovi tipi (pre-order, evento, merch, podcast, artist scouting);
  calendario con domeniche e festivi italiani in rosso; ogni voce avvisa 7 giorni prima
  e il giorno stesso (centro notifiche, avviso a comparsa, notifica di sistema se
  permessa) ed è segnalata nel menu e nell'elenco.
- **Import**: riconoscimento automatico dei report dei distributori rifatto (Believe
  ora funziona, Bandcamp con la piattaforma giusta) e una riga dice cosa è stato
  riconosciuto.

---

# Correzioni dal giro di controllo (ottobre 2026) — niente da fare online

Nessuna modifica al database: basta la pubblicazione dell'app (se Vercel segnala il
limite giornaliero, rilancia "Redeploy" il giorno dopo).

Cosa cambia per chi usa l'app:
- **Import CSV/Excel intelligente**: legge anche file .xlsx e fogli Google esportati,
  riconosce da solo colonne, date, importi, entrate/uscite e categorie (anche estratti
  conto, PayPal, Revolut, N26, Wise), impara le tue mappature e categorie, anteprima
  con tutti i campi scelti, preset modificabili ed eliminabili.
- **Quote artisti**: alla prima release chiede se usare 50% per tutti o scriverle a mano;
  quota % modificabile in blocco per più artisti.
- **Login** ricordato su web e dispositivi; apertura più affidabile.
- **Discografia artista**: in una compilation (VA) mostra solo la sua traccia.
- Decine di correzioni su pagamenti, periodi chiusi, contratti, portale artista,
  sincronizzazione, esportazioni, dashboard e testi in 7 lingue.
- **Grafica**: più contrasto in tema chiaro e scuro, logo centrato con menu ridotto,
  scritta BETA leggibile, tooltip tradotti, Esc chiude le finestre.
- **Prezzi e piani**: nomi dei piani corretti ovunque (Starter, Big Label, Company,
  Enterprise) e prezzi annuali uguali tra sito e app; tolta la promessa di una
  "prova di 14 giorni" che non esiste.

---

# Nuove funzioni (ottobre 2026) — cosa fare online

Una sola cosa da fare, ~1 minuto: **rieseguire lo schema del database**.
Dashboard Supabase → **SQL Editor** → **New query** → incolla tutto
`supabase/schema.sql` → **Run**. È sicuro rieseguirlo (crea solo ciò che manca).

Aggiunge:
- **Versioni salvate nel cloud** (`app_state_versions`): il database conserva la
  versione precedente dei dati (al massimo una all'ora, per 30 giorni) per il
  ripristino da Impostazioni → Backup & dati → Versioni salvate.
- **Accesso team** (`team_members`): il titolare invita collaboratori in sola lettura
  o con modifica (piano Enterprise). Le regole di accesso stanno nel database e valgono
  solo per email confermate.
- **Ricevute allegate** (Storage, bucket privato `receipts`): foto/PDF dei movimenti,
  visibili da tutti i dispositivi dell'etichetta e dal team.

Le Edge Functions si ripubblicano da sole (il portale artista usa i nuovi calcoli:
cambi BCE per mese e vendite arrivate dopo la chiusura di un periodo).

Il resto è già nell'app: cestino, chiusura periodo e statement a tutti, avvisi
intelligenti, conto economico per release, cambi BCE automatici, ricerca (Ctrl+K),
ritenuta d'acconto con ricevuta, pacchetto per il commercialista, checklist di uscita.

---

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
   Apri https://supabase.com/dashboard/account/tokens → **Generate new token**:
   - nome a piacere (es. `github-label-finance`);
   - **accesso**: solo il progetto di Label Finance (`ztjlqorvnulgfvbtvavm`);
   - **permessi**: **Edge Functions → lettura e scrittura** (read-write) e
     **Projects → lettura** (read). Non serve altro;
   - scadenza: la più lunga disponibile (max 1 anno; alla scadenza ne crei una nuova
     e aggiorni il secret al punto 2).

   Poi **Generate** e **copia** il token (inizia con `sbp_`). I permessi di un token
   non si possono modificare: se hai sbagliato, eliminalo e creane un altro.
   ⚠️ È come una password: non condividerlo e non incollarlo nel codice o in chat.
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

Se il workflow fallisce con un errore **403** e la parola `missing_permissions`,
al token manca un permesso: il log elenca quale. Crea un nuovo token con quel
permesso in più e aggiorna il secret (Settings → Secrets and variables → Actions →
`SUPABASE_ACCESS_TOKEN` → Update).

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
