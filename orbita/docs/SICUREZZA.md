# Sicurezza e privacy di Orbita

## Principi

1. **Il server decide, non il browser.** Ogni regola d'accesso sta nel database
   (Row Level Security di Postgres). Anche chi manomettesse l'app nel browser potrebbe
   chiedere solo ciò che le regole permettono.
2. **Il minimo indispensabile.** Salviamo viaggi, profilo e inviti, nient'altro.
   Niente pubblicità, analytics, tracciamento, librerie caricate da altri siti.
3. **I dati sono dell'utente.** Si esportano in un file, si eliminano con l'account.

## Chi vede cosa

| Dato | Proprietario | Invitato "vede" | Invitato "modifica" | Altri |
|---|---|---|---|---|
| Viaggio | legge, modifica, elimina | legge | legge e modifica | nulla |
| Inviti di un viaggio | gestisce tutti | solo il proprio (può uscire) | solo il proprio | nulla |
| Profilo | legge e modifica | nulla | nulla | nulla |

- L'invito è legato all'**email**: il viaggio si apre solo a chi entra con quell'indirizzo
  **verificato**. Il link da solo non basta e non contiene segreti.
- L'editor non può cambiare il proprietario, eliminare il viaggio o invitare altri.
- Se l'account ha la **verifica in due passaggi**, il database non restituisce nulla
  (né lettura né scrittura) finché la sessione non ha inserito il codice (livello `aal2`).
- Gli utenti non autenticati (`anon`) non hanno alcun permesso sulle tabelle.

Tutto questo è verificato da `test/rls/run.sh` (36 controlli su un Postgres reale).

## Protezioni anti-abuso nel database

- Lunghezze massime su testi ed email, dimensione massima dei dati di un viaggio (256 KB).
- Formato degli id controllato; proprietario, id e date di modifica decisi dal server.
- Massimo 25 persone per viaggio, 50 inviti al giorno per account, 3.000 viaggi per account.

## Nel browser

- **Content Security Policy** rigida: solo script dell'app, nessuno script in linea,
  connessioni solo verso l'app e Supabase. Su Vercel anche `frame-ancestors 'none'`,
  HSTS, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.
- Tutto ciò che arriva dall'utente o da un viaggio condiviso viene "escapato" prima
  di essere mostrato (contro XSS), e validato con limiti di lunghezza e formato
  (`js/model.js`) prima di essere salvato o letto.
- Librerie esterne copiate nel repo in **versione fissa** (`vendor/`): nessun CDN che
  possa cambiare il codice di nascosto.
- Ogni account ha il suo spazio sul dispositivo; **all'uscita viene cancellato**.
  "Esci da tutti i dispositivi" chiude ogni sessione aperta.
- La chiave `service_role` non deve mai stare nel browser: l'app si rifiuta di usarla
  e un test automatico lo controlla.

## Account

- Password di almeno 10 caratteri con misuratore di robustezza (più le regole lato
  Supabase, vedi `SETUP.md`), conferma dell'email obbligatoria.
- Accesso con link via email (senza password), recupero password via email.
- Verifica in due passaggi con app di autenticazione (TOTP).
- **Elimina account**: cancella l'utente e, a cascata, profilo, viaggi e inviti.
  Con la 2FA attiva serve anche il codice.

## Email d'invito

La funzione `trip-invite` lavora con le credenziali di chi invita, non con chiavi
amministrative, quindi le regole RLS valgono anche lì. Il link nell'email punta solo
all'indirizzo autorizzato dell'app (`APP_URL`), mai a uno scelto da chi chiama.
Nomi e titoli sono "escapati" nell'HTML.

## Ricerche private

Città (GeoNames) e aeroporti (OurAirports) sono dentro l'app: cosa cerchi non
esce dal dispositivo.
