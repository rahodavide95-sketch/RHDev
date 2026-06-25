# Pubblicare Label Finance come SaaS vendibile — guida operativa

> Scritta per essere capita anche senza background tecnico. Parte da **com'è
> messo oggi il progetto** e arriva, passo per passo, a **cosa serve per
> vendere il prodotto** ad altre etichette: backend, dominio, pagamenti,
> privacy/legale e checklist finale.

---

## 0. Com'è fatto oggi (foto reale)

| Pezzo | Tecnologia | Stato |
|---|---|---|
| **Frontend** (l'app) | PWA in HTML/JS puro | ✅ Funziona. Pubblicato via **GitHub Pages** (workflow `deploy-pages.yml`, deploy automatico a ogni push su `main`). C'è anche un `vercel.json` se preferisci Vercel. |
| **Login & dati cloud** | **Supabase** (Auth + Postgres + RLS) | ✅ Configurato in `config.js` (URL + chiave anon pubblica). Ogni utente vede solo i propri dati grazie a RLS. |
| **Sincronizzazione** | `sync.js` | ✅ I dati dell'app vengono salvati su Supabase per utente. |
| **Contratti / firma remota** | tabella `contracts` + funzioni RPC (`supabase/contracts.sql`) | ✅ |
| **Portale artista** | tabella `artist_shares` + Edge Function `artist-statement` | ✅ |
| **Assistente AI** | Edge Function `ai-advisor` (chiave Anthropic lato server) | ✅ Attivo. La chiave resta sul server (secret). |
| **Pagamenti / abbonamenti** | — | ❌ **Non esiste.** Il piano è scelto dall'utente nell'app e basta. |

### ⚠️ Il problema numero 1 da risolvere prima di vendere

Oggi il piano (`free` / `biglabel` / `studio` / `agency`) è **salvato dentro i
dati dell'utente** e impostato dall'app stessa (`ACCOUNT.plan = ...`). Significa
che **un cliente furbo può sbloccarsi da solo tutti i piani** modificando i
propri dati nel browser. Anche l'AI lato server legge questo valore, quindi è
aggirabile.

Per vendere davvero serve che **il piano lo decida il pagamento, non l'utente**:
una tabella `subscriptions` scritta **solo** da Stripe (webhook), che l'utente
non può modificare. Vedi sezione 3.

---

## 1. Backend Supabase — metterlo "in produzione"

Probabilmente ora usi un progetto Supabase di test. Per vendere conviene un
progetto **dedicato alla produzione** (così test e dati reali non si mescolano).

1. **Crea il progetto di produzione** su supabase.com → scegli **regione UE**
   (es. Frankfurt) per stare comodi col GDPR.
2. **Esegui gli script SQL** (Dashboard → SQL Editor → incolla → Run):
   - `supabase/contracts.sql` (contratti + firma remota)
   - `supabase/artist-portal.sql` (portale artista)
   - lo schema della tabella di sync degli utenti (quella usata da `sync.js`).
3. **Verifica la RLS** su **ogni** tabella: deve esserci una policy
   `auth.uid() = owner_id`. Senza RLS, un utente potrebbe leggere i dati di un
   altro. Questa è la verifica di sicurezza più importante.
4. **Deploya le Edge Functions**:
   ```bash
   supabase functions deploy ai-advisor
   supabase functions deploy artist-statement --no-verify-jwt
   supabase functions deploy catalog-search
   ```
5. **Imposta i secret** (mai nel codice!):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   # opzionale: supabase secrets set ANTHROPIC_MODEL=claude-opus-4-8
   ```
6. **Aggiorna `config.js`** con URL e chiave **anon** del progetto di
   produzione. (La chiave anon è pubblica per natura: è protetta dalla RLS, va
   bene lasciarla nel codice.)
7. ⚠️ **Ho appena corretto** un disallineamento: la Edge Function `ai-advisor`
   abilitava l'AI solo a `studio`/`agency`, escludendo il nuovo piano
   **Big Label**. Ora include `biglabel`. **Devi rideployarla** (`supabase
   functions deploy ai-advisor`) perché la correzione abbia effetto online.

---

## 2. Dominio e pubblicazione del sito

1. **Compra il dominio** (es. labelfinance.app / .com) — Namecheap, Cloudflare,
   Google Domains, ecc. ~10–15 €/anno.
2. **Scegli dove ospitare** (l'app è statica, quindi è facile):
   - **GitHub Pages** (già attivo): Settings → Pages → *Custom domain* → metti il
     dominio. Aggiungi i record DNS che ti indica GitHub (un `CNAME` verso
     `tuo-utente.github.io`, o gli `A` record per l'apex). Spunta **Enforce
     HTTPS**. Aggiungi un file `CNAME` con il dominio nella root.
   - **Vercel** (c'è già `vercel.json`): importi il repo, colleghi il dominio,
     HTTPS automatico. Più comodo per gestire redirect/dintorni.
3. **HTTPS**: obbligatorio (anche per la PWA e per Supabase). Sia Pages che
   Vercel lo danno gratis.
4. **Landing + app**: `index.html` è la landing di vendita, `app.html` è il
   gestionale. Assicurati che i link "Accedi/Prova" della landing puntino a
   `app.html`.

---

## 3. Pagamenti e abbonamenti (il pezzo che manca per vendere)

Obiettivo: l'utente paga → il suo piano si attiva **automaticamente e in modo
non falsificabile**.

**Strumento consigliato: Stripe** (gestisce carte, IVA UE, fatture, rinnovi,
disdette; tu non tocchi mai i numeri di carta — niente grane PCI).

Passi:
1. **Crea i prodotti/prezzi su Stripe**, uno per piano a pagamento:
   Big Label €69/mese, Company €150/mese, Enterprise (quando lo apri).
2. **Stripe Checkout**: il pulsante "Abbonati" della landing/app apre la pagina
   di pagamento Stripe (ospitata da loro).
3. **Tabella `subscriptions` su Supabase**, scritta **solo** dal webhook (RLS:
   l'utente può leggerla, non scriverla):
   ```sql
   create table public.subscriptions (
     user_id uuid primary key references auth.users(id) on delete cascade,
     plan text not null default 'free',     -- free|biglabel|studio|agency
     status text not null default 'inactive',
     current_period_end timestamptz
   );
   alter table public.subscriptions enable row level security;
   create policy sub_read on public.subscriptions
     for select using (auth.uid() = user_id);   -- sola lettura per l'utente
   ```
4. **Edge Function webhook Stripe**: quando Stripe conferma pagamento/rinnovo/
   disdetta, aggiorna `subscriptions` (con la *service role*, che bypassa la
   RLS). Questo è l'unico punto in cui il piano viene deciso.
5. **Cambia il punto di verità del piano**: l'app deve leggere il piano da
   `subscriptions` (non da `ACCOUNT.plan`). Anche `ai-advisor` deve leggere il
   piano da lì, non da `data.plan`. Così nessuno può sbloccarsi da solo.
6. **Portale clienti Stripe**: un link dove il cliente gestisce/disdice
   l'abbonamento da solo (te lo dà Stripe pronto).

> Finché questo non c'è, puoi vendere solo in modo "manuale/fiducia" (attivi tu
> i piani a mano): ok per i primissimi clienti, non per scalare.

---

## 4. Privacy e adempimenti legali (GDPR)

Tu diventi **Titolare del trattamento**; Supabase/Stripe sono **Responsabili**.
La buona notizia: gran parte è già coperta dai fornitori (cifratura in transito
e a riposo, backup, data center UE). Quello che devi mettere tu:

1. **Privacy Policy** (pagina pubblica linkata dalla landing e in fase di
   registrazione): quali dati raccogli (account, dati finanziari della label,
   anagrafiche artisti con email/IBAN), perché, dove sono ospitati (Supabase,
   UE), con chi sono condivisi (Stripe per i pagamenti, Anthropic per l'AND
   solo se l'utente usa l'assistente), per quanto tempo, e i diritti dell'utente.
2. **Termini di Servizio**.
3. **Cookie/consensi**: l'app usa storage tecnico (localStorage) → di norma non
   serve un banner invasivo, ma cita lo storage tecnico nella privacy. Se in
   futuro aggiungi analytics di terze parti, lì serve il consenso.
4. **DPA (Data Processing Agreement)**: accettalo/firmalo con **Supabase** e
   **Stripe** (li trovi nelle loro dashboard). Se i tuoi clienti gestiscono dati
   di artisti, **tu** offri a loro un DPA a tua volta.
5. **Diritti degli utenti** — già parzialmente pronti nell'app:
   - **Esportazione dati**: c'è già "Esporta backup (.json)" e "Esporta
     movimenti (.csv)". ✅
   - **Cancellazione**: c'è "Cancella tutti i dati" lato dispositivo; aggiungi
     una **cancellazione account completa** lato server (elimina l'utente e le
     sue righe su Supabase). Da prevedere.
6. **Sub-processor list**: tieni una lista pubblica dei fornitori (Supabase,
   Stripe, Anthropic, host) — richiesta tipica B2B.
7. **AI**: nella privacy spiega che, se l'utente usa l'Assistente AI, un
   **riassunto** dei suoi dati viene inviato all'API di Anthropic per generare i
   consigli. (Già oggi la funzione manda solo un sommario, non l'anagrafica
   completa.)

Esiste già un documento interno utile: `docs/SICUREZZA-PRIVACY.md`.

---

## 5. Sicurezza — controlli prima del lancio

- [ ] **RLS attiva e testata** su tutte le tabelle (prova a leggere i dati di un
  altro utente: deve fallire).
- [ ] La **service role key** non è MAI nel frontend (solo nei secret delle Edge
  Function). ✅ oggi è così.
- [ ] La chiave **anon** in `config.js` è quella giusta del progetto di
  produzione.
- [ ] **Rate limiting** sulle Edge Function (specie `ai-advisor`: costa soldi a
  ogni chiamata) — limita per utente/tempo.
- [ ] **Backup** Supabase attivi (inclusi nei piani a pagamento Supabase).
- [ ] Email di **conferma registrazione** e **reset password** attive in
  Supabase Auth.

---

## 6. Costi mensili indicativi (avvio)

| Voce | Costo |
|---|---|
| Dominio | ~1 €/mese (10–15 €/anno) |
| Hosting frontend (GitHub Pages / Vercel hobby) | 0 € |
| Supabase | 0 € (free) per iniziare; ~25 $/mese (Pro) quando cresci/ti servono backup |
| Stripe | 0 € fisso, ~1,5% + 0,25 € a transazione (UE) |
| Anthropic (AI) | a consumo, solo se i clienti usano l'AI |
| **Totale di partenza** | **quasi 0 €**, paghi davvero quando incassi |

---

## 7. Checklist go-live (in ordine di priorità)

1. [ ] **Billing reale con Stripe** + tabella `subscriptions` scritta solo dal
   webhook → piano non falsificabile. *(blocco principale)*
2. [ ] App legge il piano da `subscriptions` (client **e** `ai-advisor`).
3. [ ] Progetto Supabase di **produzione** (regione UE), SQL eseguiti, Edge
   Function deployate, secret impostati, **`ai-advisor` rideployata** col fix
   Big Label.
4. [ ] Verifica **RLS** su tutte le tabelle.
5. [ ] **Dominio** collegato + **HTTPS** attivo.
6. [ ] **Privacy Policy** + **Termini** pubblicati e linkati; DPA accettati.
7. [ ] **Cancellazione account** lato server.
8. [ ] Rate limiting sull'AI + email auth (conferma/reset) attive.
9. [ ] (Quando vuoi riattivarli) EmailJS e chiave-AI manuale tornano visibili
   mettendo `devSettings:true` in `config.js`.

---

*Quando vuoi, posso implementare i punti tecnici (es. lo scheletro
Stripe + tabella `subscriptions` + webhook, o la cancellazione account
server-side). Dimmi da quale partire.*
