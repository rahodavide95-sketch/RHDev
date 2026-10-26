# Attivare account, sincronizzazione e inviti (Supabase)

Tempo: circa 15 minuti, una volta sola. Senza questi passi Orbita funziona lo stesso,
ma i dati restano solo sul dispositivo e non si possono condividere viaggi.

## 1. Crea il progetto (gratis)

1. Vai su <https://supabase.com> → **New project**.
2. Nome: `orbita`. **Region: Central EU (Frankfurt)**, così i dati restano in Europa.
3. Scegli una password del database lunga e salvala nel tuo gestore di password.

> Consiglio: un progetto **separato** da Label Finance, così utenti e dati delle due app
> restano isolati.

## 2. Crea il database

1. Nel progetto: **SQL Editor → New query**.
2. Incolla tutto il contenuto di `orbita/supabase/schema.sql` e premi **Run**.
   Si può rieseguire senza danni ogni volta che lo aggiorniamo.

## 3. Collega l'app

1. **Project Settings → API**: copia **Project URL** e la chiave **anon / publishable**.
2. Incollali in `orbita/js/config.js`:

   ```js
   export const CONFIG = {
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'eyJ...',   // la chiave anon, MAI la service_role
   };
   ```

   La chiave anon è pubblica per natura: la sicurezza la fanno le regole del database.
   Se per errore incolli la `service_role`, l'app si rifiuta di usarla e un test fallisce.

## 4. Impostazioni di accesso (Authentication)

In **Authentication → Sign In / Providers → Email**:

- **Confirm email**: attivo (l'email va verificata prima di entrare).
- **Secure email change**: attivo.
- **Minimum password length**: `10`; **Password requirements**: lettere minuscole,
  maiuscole, numeri e simboli.
- **Leaked password protection** (se il piano lo prevede): attivo.

In **Authentication → URL Configuration**:

- **Site URL**: l'indirizzo dell'app, ad esempio
  `https://rahodavide95-sketch.github.io/RHDev/orbita/`
- **Redirect URLs**: lo stesso indirizzo, più `http://localhost:8000/` per le prove.

In **Authentication → Multi-Factor**: lascia attivo **TOTP** (codice da app).

### Email di sistema (conferme, password dimenticata)

Il servizio email incluso in Supabase manda pochissime email all'ora ed è pensato
per le prove. Per l'uso reale: **Authentication → Emails → SMTP Settings**, con
un provider come Resend (vedi passo 5, la stessa chiave funziona via SMTP:
host `smtp.resend.com`, porta `465`, utente `resend`, password = la API key).

## 5. Email d'invito ai viaggi (facoltativo ma consigliato)

Senza questo passo l'invito si salva comunque e l'app ti propone di mandarlo tu
(app Mail, copia link o condivisione del telefono).

1. Crea un account gratuito su <https://resend.com>, verifica il tuo dominio
   (oppure, per le prove, usa il mittente `onboarding@resend.dev`, che però manda
   email **solo al tuo indirizzo**). Crea una **API key**.
2. Nel progetto Supabase: **Edge Functions → Secrets** e aggiungi:
   - `RESEND_API_KEY` = la chiave di Resend
   - `INVITE_FROM` = `Orbita <viaggi@tuodominio.it>`
   - `APP_URL` = l'indirizzo dell'app (lo stesso del Site URL)
3. Pubblica la funzione, in uno dei due modi:
   - **Automatico da GitHub**: nelle impostazioni del repository → *Secrets and
     variables → Actions* aggiungi `SUPABASE_ACCESS_TOKEN` (da supabase.com →
     Account → Access Tokens) e `ORBITA_SUPABASE_PROJECT_REF` (l'id del progetto,
     la parte `xxxxxxxx` dell'URL). Da lì ogni modifica su `main` viene pubblicata
     dal workflow `deploy-orbita-functions.yml`.
   - **A mano**, dal computer: `cd orbita && supabase functions deploy trip-invite --project-ref xxxxxxxx`

## 6. Prova

1. Apri l'app → **Profilo → Crea account** → conferma l'email.
2. Crea un viaggio, aprilo → **Condividi** → invita un tuo secondo indirizzo.
3. Da un'altra finestra in incognito apri il link dell'invito ed entra con quell'indirizzo:
   il viaggio compare in **Viaggi → Condivisi**.
4. **Profilo → Verifica in due passaggi → Configura** per attivare il codice da app.
