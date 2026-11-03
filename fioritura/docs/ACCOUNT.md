# Attivare l'account di Fioritura

Fioritura ha un suo progetto Supabase, **separato** da Label Finance, Documenti Raho e dalle altre app:
lì si registra solo chi usa Fioritura, con la sua email e la sua password. Nessuno vede i dati degli altri.

Tempo: circa 5 minuti, una volta sola. Finché non è fatto, Fioritura funziona lo stesso:
il pulsante dell'account non compare e i dati restano sul dispositivo.

## 1. Crea il progetto (gratis)

1. Vai su <https://supabase.com> ed entra con il tuo account.
2. **New project** → nome `fioritura`, **Region: Central EU (Frankfurt)** (così i dati restano in Europa).
3. Scegli una password del database e salvala (non serve all'app, ma tienila).

> Il piano gratuito permette due progetti attivi. Se Supabase dice che hai raggiunto il limite,
> dimmelo e troviamo un'alternativa.

## 2. Dai a GitHub l'id del progetto

1. Nel progetto: **Project Settings → General** → copia il **Project ID** (lettere minuscole, tipo `abcdefghijklmnopqrst`).
2. Su GitHub, nel repository: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIORITURA_SUPABASE_PROJECT_REF`
   - Secret: il Project ID
3. Il secret `SUPABASE_ACCESS_TOKEN` c'è già (lo usano le altre app) e vale anche per questo progetto.

## 3. Mandami indirizzo e chiave pubblica

Nel progetto: **Project Settings → API Keys** (o **Data API**) e copia:

- il **Project URL** (`https://<id>.supabase.co`);
- la chiave **anon / public** (oppure la **Publishable key**, che inizia con `sb_publishable_`).

Mandameli in chat e li metto io nell'app (in `fioritura/index.html`, in cima alla parte "ACCOUNT", oggetto `CLOUD`).
Quella chiave è pubblica per natura: è fatta per stare nel sito. **Non** mandare la `service_role` o una
chiave `secret` (l'app comunque si rifiuta di usarle).

## 4. Unisci su main

Quando le modifiche arrivano su `main`, il workflow **Database Fioritura** prepara il progetto da solo:
crea la tabella, mette l'indirizzo dell'app per i link e le email in italiano, e permette di registrarsi
senza email di conferma (vedi sotto perché).

Se il workflow è partito prima che il secret esistesse: **Actions → Database Fioritura → Run workflow**.

## 5. Solo se il workflow non riesce: a mano

- **SQL Editor → New query**: incolla tutto `fioritura/supabase/schema.sql` e premi **Run** (si può rieseguire).
- **Authentication → Sign In / Providers → Email**: **Confirm email** spento; **Minimum password length** `8`.
- **Authentication → URL Configuration**: **Site URL** `https://rahodavide95-sketch.github.io/RHDev/fioritura/`;
  **Redirect URLs** lo stesso indirizzo, lo stesso con `**` alla fine, e `http://localhost:8000/fioritura/`.

## Come si registra lei

Apre <https://rahodavide95-sketch.github.io/RHDev/fioritura/>, tocca la nuvola in alto → **Crea il tuo account**
con la sua email e una password (almeno 8 caratteri) → è dentro. Sugli altri dispositivi tocca **Accedi**.

## Email e password dimenticata

Il servizio email di prova di Supabase manda email solo ai membri del progetto (cioè a te), quindi a lei
non arriverebbero. Per questo la registrazione non chiede di confermare l'email.

- **Facoltativo**, per far funzionare «Password dimenticata?»: **Authentication → Emails → SMTP Settings**
  con un servizio come Resend (gratis per pochi messaggi): host `smtp.resend.com`, porta `465`,
  utente `resend`, password = la API key di Resend. I testi delle email sono già in italiano.
- **Senza SMTP**, se dimentica la password: in **Authentication → Users** elimina il suo utente e lei si registra
  di nuovo con la stessa email. I suoi progressi sono anche sui suoi dispositivi: appena accede tornano online.
