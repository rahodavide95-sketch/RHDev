# Label Form (cartella `label-form`)

Modulo dell'etichetta di D (SUBCONSCIOUS Culture) per farsi mandare dagli artisti tutto il necessario
per una release: dati, bio, press kit, tracce, artwork, contratto. Nato il 5/11/2026 su richiesta di D:
"una piattaforma tipo google form da inviare agli artisti … senza usare google … solo se tutti i dati
di ognuno sono in MASSIMA sicurezza".
D scrive in italiano e non è uno sviluppatore: spiegagli le cose in modo semplice e fai tu le modifiche.
Tutta l'interfaccia è in italiano. Il nome **"Label Form"** l'ha scelto D ("non mi piace consegne, facciamo
label form"; il primo nome era "Consegne"): cartella `label-form`, progetto Supabase `label-form`, tabelle
`labelform_`, funzione `label-form-mail`, chiavi del browser `labelform-…`. Non inventare marchi o loghi con
scritte (le icone sono il logo dell'etichetta preso da `etichetta/images/logo.png`).

## Decisioni di D (rispettarle)

- I file restano su Drive/Dropbox ecc.: gli artisti incollano i **link** ("utilizzo comunque i servizi di
  google come drive … la piattaforma principale non è google form ma la mia"). Niente caricamento di WAV.
- **Niente a che fare con Label Finance**: "label finance per ora non centra niente quindi tutto a parte".
  Il primo giorno (quando si chiamava Consegne) era finito nel progetto Supabase di Label Finance e la pagina d'accesso diceva
  "usa lo stesso account di Label Finance": D l'ha ripreso ("ma ti ho detto che non centra niente con label
  finance"). Ora ha il SUO progetto Supabase (`label-form`) e nessun testo nomina Label Finance. Non
  ricollegarli mai (account, tabelle, email, testi).
- L'artista **vede quello che ha compilato** e sceglie se avere la copia (PDF o email).
- L'artista **può modificare finché la release non è chiusa**, e "per ogni modifica devo essere avvisato".
- "il contratto una volta firmato non si può più modificare" → bloccato dal database (trigger).
- I moduli si modificano **come su Google Form**: "aggiungere, togliere, cambiare stili, formattazioni,
  colori, ecc". → costruttore in `js/admin/views/builder.js`.
- Gli piacciono: firma sulla pagina, checklist per release ("manca artwork", "contratto firmato ✓"),
  controllo dei link (Drive, Dropbox… ed errori di battitura).
- Richieste del 6/11/2026 (tutte fatte, non tornare indietro):
  - "servono tasti indietro - ripeti" → Indietro/Ripeti nel costruttore (anche Ctrl+Z / Ctrl+Maiusc+Z).
  - "qualsiasi testo, forma, modulo, cosa, deve essere cancellabile, modulabile, ridimensionabile, tutto" →
    larghezza di ogni elemento (¼…intera, anche trascinando il bordo nell'anteprima), immagini e separatori,
    titoli nascondibili, tutti i testi e i pulsanti della pagina dell'artista modificabili (`form.texts`,
    `form.show`), misure del modulo e del logo con cursori, riordino trascinando.
  - "barra laterale comprimibile" → `js/admin/look.js` (scelta salvata nel browser).
  - "il logo dell'etichetta lo voglio quadrato non arrotondato" → logo sempre quadrato (forma regolabile nei moduli).
  - "il contratto deve essere tale e quale a quello di label finance (senza il logo di label finance) ma con la
    possibilità di modificare la formattazione generale, layout" → stesso testo e impaginazione
    (`labelContract()` in `schema.js`, `contractDoc()` in `ui/pdf.js`, caratteri DM Sans e Syne in `fonts/`),
    formattazione in `form.contract.style`. Nessuna scritta o logo di Label Finance.
  - "temi del sito, minimal, chiaro, scuro" → `data-theme` su `<html>` (Impostazioni › Aspetto del sito).
  - "l'anteprima del modulo deve essere zoomabile e visibile anche da finito tramite link anteprima che si
    aggiorna da solo" → zoom e telefono/tablet/computer nel costruttore; `anteprima.html#p=…` legge
    `labelform_preview()` ogni 4 secondi (e subito, via BroadcastChannel, se il costruttore è aperto nello
    stesso browser). Nel database solo l'impronta del codice (`preview_hash`) e il codice cifrato.

## Architettura (niente compilazione, moduli ES)

- `index.html` + `js/admin/*`: area etichetta. `app.js` = accesso (Supabase Auth, 2FA TOTP obbligatoria),
  reclamo del proprietario, chiave di cifratura, guscio e router a hash (`#/release`, `#/release/<id>`,
  `#/invio/<id>`, `#/moduli`, `#/modulo/<id>`, `#/avvisi`, `#/impostazioni`). `state.js` = stato e aiuti
  (link, apertura invii, checklist). `keys.js` = chiave privata in memoria / IndexedDB non esportabile.
- `invio.html` + `js/artist/app.js`: pagina artista a passi (sezioni → contratto → riepilogo/password/copie).
- `js/core/*` (testati in `test/core.test.js`): `crypto.js` (RSA-OAEP 3072 etichetta, AES-GCM dati con AAD
  per invito, PBKDF2 600k, codice di recupero), `schema.js` (modulo + `defaultForm()` "Consegna release" con
  il contratto dell'etichetta e segnaposto), `answers.js` (controlli, IBAN/CF/P.IVA, filled, diff, maschere),
  `links.js` (provider, errori di battitura), `contract.js` (segnaposto, copia congelata, impronta),
  `richtext.js` (testo formattato come DATI, mai HTML), `theme.js` (colori/caratteri controllati).
- `js/ui/*`: `dom.js` (`h()` solo textContent), `rich.js` (render + editor contenteditable → modello),
  `form-view.js` (campi del modulo, usato anche nell'anteprima del costruttore), `signature.js`,
  `pdf.js` (html2pdf da `vendor/`).
- `js/api/supabase.js` e `js/api/demo.js` hanno la stessa interfaccia. La **modalità prova** (`?demo=1`,
  `localStorage['labelform-mode']='demo'`) replica in JS le regole SQL: serve a D per provare e ai test.
- Quando aggiungi una `.append(` o `replaceChildren(` con valori che possono essere `null`, usa `append()`
  / `swap()` di `dom.js`: il DOM nativo scrive "null" nella pagina.

## Database (`supabase/schema.sql`, prefisso `labelform_`)

Progetto Supabase **tutto suo**, chiamato `label-form` (server in Irlanda, UE). Il workflow `.github/workflows/label-form.yml`
lo trova o lo crea (solo con piano gratuito), poi: test + test RLS, schema, proprietario dal secret
`LABELFORM_OWNER_EMAIL`, impostazioni di accesso (site URL, redirect, testi delle email in italiano,
iscrizioni chiuse appena c'è il proprietario), funzione `label-form-mail`, prova dal vivo, pulizia delle
tabelle `labelform_` dal progetto di un'altra app (`OLD_REF`, solo se vuote) e, ogni giorno, "sveglia" del
progetto (i progetti gratuiti si addormentano dopo 7 giorni). `js/config.js` e le CSP (index.html, invio.html,
vercel.json, _headers) devono puntare al progetto `label-form`.
Email di accesso: senza SMTP personalizzato Supabase le manda solo agli indirizzi del team Supabase e poche
all'ora: il proprietario deve iscriversi con l'email del suo account Supabase.
- Proprietario unico (`labelform_owner`), tutte le tabelle richiedono `labelform_is_owner()` = proprietario + aal2.
- Artisti senza account: solo RPC `labelform_open/unlock/submit/update` (security definer). Link = token 256 bit,
  nel DB solo `token_hash` (sha256) + `token_enc` (cifrato per l'etichetta).
- Anteprima: `labelform_preview(token, since)` restituisce solo il modulo e nome/logo/firma dell'etichetta.
- Password artista: il DB ha `sha256(verifier)`; 8 errori → 15 minuti di blocco.
- Trigger: contratto firmato immutabile, `dek_label` immutabile, storico (`labelform_versions`) immutabile.
- L'etichetta non può scrivere i campi cifrati (permessi per colonna).
- Avvisi: `labelform_events` (opened/submitted/updated/signed, `changed` = id dei campi). Email via
  `labelform_mail_claim()` dalla funzione (service_role).
- Test: `bash test/rls/run.sh` (91 controlli). Ogni regola nuova → un test nuovo.

## Pubblicazione

GitHub Pages (`deploy-pages.yml`, da `main`): `https://rahodavide95-sketch.github.io/RHDev/label-form/`.
`vercel.json` e `_headers` (Cloudflare Pages) per quando D avrà il dominio (consigliato Cloudflare:
dominio + Pages + email routing). Il repo è pubblico: mai dati personali di D o degli artisti nel codice.

## Test nel browser

Playwright (già installato) su `python3 -m http.server` dalla radice del repo, in modalità prova:
chiave → release → artista → link → compilazione completa con firma → riapertura con password e modifica →
area etichetta (invio decifrato, verifica contratto, storico, avvisi, PDF), anche su iPhone 13.
Sui telefoni i campi devono avere almeno 16px (altrimenti l'iPhone ingrandisce la pagina).
