# Consegne (cartella `consegne`)

Modulo dell'etichetta di D (SUBCONSCIOUS Culture) per farsi mandare dagli artisti tutto il necessario
per una release: dati, bio, press kit, tracce, artwork, contratto. Nato il 5/11/2026 su richiesta di D:
"una piattaforma tipo google form da inviare agli artisti … senza usare google … solo se tutti i dati
di ognuno sono in MASSIMA sicurezza".
D scrive in italiano e non è uno sviluppatore: spiegagli le cose in modo semplice e fai tu le modifiche.
Tutta l'interfaccia è in italiano. Il nome "Consegne" è descrittivo: non inventare marchi o loghi con
scritte (le icone sono il logo dell'etichetta preso da `etichetta/images/logo.png`).

## Decisioni di D (rispettarle)

- I file restano su Drive/Dropbox ecc.: gli artisti incollano i **link** ("utilizzo comunque i servizi di
  google come drive … la piattaforma principale non è google form ma la mia"). Niente caricamento di WAV.
- **Progetto a parte** da Label Finance ("label finance per ora non centra niente quindi tutto a parte ma
  il sistema deve essere pressochè identico"): stesso stack (Supabase dello stesso progetto, pagine
  statiche, firma come Label Finance, aspetto scuro/viola), nessun collegamento ai dati di Label Finance.
- L'artista **vede quello che ha compilato** e sceglie se avere la copia (PDF o email).
- L'artista **può modificare finché la release non è chiusa**, e "per ogni modifica devo essere avvisato".
- "il contratto una volta firmato non si può più modificare" → bloccato dal database (trigger).
- I moduli si modificano **come su Google Form**: "aggiungere, togliere, cambiare stili, formattazioni,
  colori, ecc". → costruttore in `js/admin/views/builder.js`.
- Gli piacciono: firma sulla pagina, checklist per release ("manca artwork", "contratto firmato ✓"),
  controllo dei link (Drive, Dropbox… ed errori di battitura).

## Architettura (niente compilazione, moduli ES)

- `index.html` + `js/admin/*`: area etichetta. `app.js` = accesso (Supabase Auth, 2FA TOTP obbligatoria),
  reclamo del proprietario, chiave di cifratura, guscio e router a hash (`#/release`, `#/release/<id>`,
  `#/invio/<id>`, `#/moduli`, `#/modulo/<id>`, `#/avvisi`, `#/impostazioni`). `state.js` = stato e aiuti
  (link, apertura invii, checklist). `keys.js` = chiave privata in memoria / IndexedDB non esportabile.
- `invio.html` + `js/artist/app.js`: pagina artista a passi (sezioni → contratto → riepilogo/password/copie).
- `js/core/*` (testati in `test/core.test.js`): `crypto.js` (RSA-OAEP 3072 etichetta, AES-GCM dati con AAD
  per invito, PBKDF2 600k, codice di recupero), `schema.js` (modulo + `defaultForm()` "Consegna release" con
  il contratto di Label Finance e segnaposto), `answers.js` (controlli, IBAN/CF/P.IVA, filled, diff, maschere),
  `links.js` (provider, errori di battitura), `contract.js` (segnaposto, copia congelata, impronta),
  `richtext.js` (testo formattato come DATI, mai HTML), `theme.js` (colori/caratteri controllati).
- `js/ui/*`: `dom.js` (`h()` solo textContent), `rich.js` (render + editor contenteditable → modello),
  `form-view.js` (campi del modulo, usato anche nell'anteprima del costruttore), `signature.js` (= Label Finance),
  `pdf.js` (html2pdf da `vendor/`).
- `js/api/supabase.js` e `js/api/demo.js` hanno la stessa interfaccia. La **modalità prova** (`?demo=1`,
  `localStorage['consegne-mode']='demo'`) replica in JS le regole SQL: serve a D per provare e ai test.
- Quando aggiungi una `.append(` o `replaceChildren(` con valori che possono essere `null`, usa `append()`
  / `swap()` di `dom.js`: il DOM nativo scrive "null" nella pagina.

## Database (`supabase/schema.sql`, prefisso `consegne_`)

Progetto Supabase di Label Finance (`ztjlqorvnulgfvbtvavm`). Applicato dal workflow
`.github/workflows/consegne.yml` (prima test + test RLS, poi schema, email del proprietario dal secret
`CONSEGNE_OWNER_EMAIL`, redirect URL, funzione `consegne-mail`).
- Proprietario unico (`consegne_owner`), tutte le tabelle richiedono `consegne_is_owner()` = proprietario + aal2.
- Artisti senza account: solo RPC `consegne_open/unlock/submit/update` (security definer). Link = token 256 bit,
  nel DB solo `token_hash` (sha256) + `token_enc` (cifrato per l'etichetta).
- Password artista: il DB ha `sha256(verifier)`; 8 errori → 15 minuti di blocco.
- Trigger: contratto firmato immutabile, `dek_label` immutabile, storico (`consegne_versions`) immutabile.
- L'etichetta non può scrivere i campi cifrati (permessi per colonna).
- Avvisi: `consegne_events` (opened/submitted/updated/signed, `changed` = id dei campi). Email via
  `consegne_mail_claim()` dalla funzione (service_role).
- Test: `bash test/rls/run.sh` (79 controlli). Ogni regola nuova → un test nuovo.

## Pubblicazione

GitHub Pages (`deploy-pages.yml`, da `main`): `https://rahodavide95-sketch.github.io/RHDev/consegne/`.
`vercel.json` e `_headers` (Cloudflare Pages) per quando D avrà il dominio (consigliato Cloudflare:
dominio + Pages + email routing). Il repo è pubblico: mai dati personali di D o degli artisti nel codice.

## Test nel browser

Playwright (già installato) su `python3 -m http.server` dalla radice del repo, in modalità prova:
chiave → release → artista → link → compilazione completa con firma → riapertura con password e modifica →
area etichetta (invio decifrato, verifica contratto, storico, avvisi, PDF), anche su iPhone 13.
Sui telefoni i campi devono avere almeno 16px (altrimenti l'iPhone ingrandisce la pagina).
