# Consegne — come metterlo in funzione

Tempo: circa 15 minuti la prima volta. Non serve saper programmare.

## 0. Provalo subito (senza account)

Apri **https://rahodavide95-sketch.github.io/RHDev/consegne/?demo=1**.

Si apre la **modalità prova**: tutto resta solo nel tuo browser, nessun dato va su internet.
Puoi creare la chiave, una release, aggiungere un artista, aprire il suo link (sullo stesso browser),
compilare il modulo come se fossi l'artista e vedere cosa ricevi. Per uscire: "Esci dalla prova".

## 1. Il database (si fa da solo)

Il database sta sul progetto Supabase che usi già per Label Finance, Documenti Raho e Fioritura
(le tabelle di Consegne si chiamano `consegne_…` e non toccano le altre app).

Quando le modifiche arrivano su `main`, il workflow **"Consegne (database ed email)"**:

1. fa girare tutti i test (anche quelli di sicurezza del database);
2. crea le tabelle e le regole;
3. pubblica la funzione delle email.

Usa lo stesso secret `SUPABASE_ACCESS_TOKEN` che c'è già. Se il workflow è verde, è tutto a posto.

### Consigliato: blocca l'area dell'etichetta sulla tua email

Prima di fare il merge (o dopo, rilanciando il workflow) aggiungi un secret su GitHub:

1. Su GitHub apri il repository › **Settings** › **Secrets and variables** › **Actions** › **New repository secret**.
2. **Name:** `CONSEGNE_OWNER_EMAIL`.
3. **Secret:** l'email del tuo account (la stessa con cui entri in Label Finance).
4. Salva.

Così, anche se qualcuno trovasse la pagina prima di te, solo il tuo account può diventare
"proprietario" dell'area. Senza questo secret vale la regola "il primo che entra" (con email
confermata e verifica in due passaggi).

## 2. Primo accesso

Apri **https://rahodavide95-sketch.github.io/RHDev/consegne/**.

1. **Accedi** con il tuo account. Puoi usare lo stesso di Label Finance, oppure crearne uno.
2. **Verifica in due passaggi**: è obbligatoria.
   - Installa un'app di autenticazione: Google Authenticator, Microsoft Authenticator, 1Password, Authy o "Password" di iPhone.
   - Inquadra il QR e scrivi il codice di 6 cifre.
   - Da quel momento, per entrare servono password + codice.
3. **Primo accesso**: conferma che questo è l'account dell'etichetta.
4. **Chiave di cifratura**:
   - Scegli una password di cifratura **diversa** da quella dell'account (meglio una frase lunga).
   - Ti viene mostrato il **codice di recupero**: scaricalo o stampalo e tienilo al sicuro.
   - Senza password e senza codice, i dati degli artisti non si aprono più. Non li può aprire nessuno, nemmeno noi: è questo che li rende sicuri.

Al primo accesso trovi già il modulo **"Consegna release"** pronto da usare.

## 3. Impostazioni (una volta sola)

In **Impostazioni**:

- **Nome dell'etichetta**, **logo** e **chi firma per l'etichetta**.
- **Firma dell'etichetta**: la disegni una volta e va in tutti i contratti.
- **Email per gli avvisi**: dove ricevere un avviso a ogni invio, modifica o firma (vedi punto 5).

## 4. Usarlo

1. **Release** › **Nuova release**: titolo, catalogo, data.
2. **Aggiungi artista**: nome, % all'artista nel contratto, scadenza del link.
3. Si apre il **link segreto**: lo mandi su WhatsApp, per email o lo copi.
4. Nella release vedi per ogni artista:
   - se ha aperto il link, inviato o modificato;
   - la **checklist**, per esempio "manca artwork" o "Contratto firmato ✓".
5. **Vedi invio**: i dati decifrati, il contratto firmato con la verifica d'integrità, lo storico
   delle modifiche ("prima → dopo") e il PDF.
6. Quando hai tutto: **chiudi la release** (il lucchetto). Gli artisti possono ancora rivedere,
   ma non modificare.

Per cambiare domande, testi, colori o contratto: **Moduli** › **Modifica**. Si salva da solo.

## 5. Avvisi via email (facoltativo)

Senza questo passo gli avvisi li vedi comunque nell'app (campanella "Avvisi").

1. Crea un account gratuito su **resend.com**.
2. In Resend apri **API Keys** › **Create API Key** e copia la chiave.
3. Su GitHub aggiungi due secret, come al punto 1:
   - `CONSEGNE_RESEND_API_KEY` = la chiave copiata;
   - `CONSEGNE_MAIL_FROM` = per ora `Consegne <onboarding@resend.dev>`.
4. In GitHub apri **Actions** › **Consegne (database ed email)** › **Run workflow**.
5. In Consegne › Impostazioni › **Manda un'email di prova**.

Finché non hai un dominio, Resend può scrivere **solo all'email del tuo account Resend**:
- gli avvisi per te funzionano;
- le copie via email agli artisti partiranno quando avrai il dominio (punto 6).

Gli artisti possono comunque scaricare la loro copia in PDF.

## 6. Quando compri il dominio

Esempio con il dominio su Cloudflare e la pagina su `invio.subconsciousculture.com`.

1. Cloudflare › **Workers & Pages** › **Create** › **Pages** › collega il repository GitHub:
   - **Root directory:** `consegne`;
   - **Build command:** vuoto;
   - **Output:** `/`.
2. Nel progetto Pages › **Custom domains** › aggiungi `invio.subconsciousculture.com`.
   Il file `_headers` mette già le intestazioni di sicurezza.
3. In Consegne › Impostazioni › **Indirizzo dei link**: scrivi `https://invio.subconsciousculture.com/invio.html`.
   I link nuovi useranno quello. Quelli vecchi continuano a funzionare finché resta online anche GitHub Pages.
4. Secret GitHub `CONSEGNE_ALLOWED_ORIGINS` = `https://invio.subconsciousculture.com`, poi rilancia il workflow.
5. Supabase › **Authentication** › **URL Configuration** › aggiungi `https://invio.subconsciousculture.com/**`
   tra i "Redirect URLs" (serve per i link di conferma e di reset password).
6. Email (Resend):
   - **Domains** › **Add domain** e copia i record DNS che ti dà Resend in Cloudflare (SPF e DKIM);
   - poi `CONSEGNE_MAIL_FROM` = `SUBCONSCIOUS Culture <invio@subconsciousculture.com>` e rilancia il workflow.

## Se qualcosa va storto

| Problema | Cosa fare |
|---|---|
| Ho dimenticato la password di cifratura | Sblocca › "uso il codice di recupero" e scegli una password nuova. |
| Ho perso password **e** codice di recupero | I dati già inviati non si possono più aprire (è la garanzia di sicurezza). Crea una nuova chiave dal pannello Supabase (svuota `label_key` in `consegne_settings`) e chiedi agli artisti di reinviare. |
| Ho perso il telefono con il codice 2FA | Supabase › Authentication › Users › il tuo utente › elimina il fattore MFA, poi rientra e riattivalo. |
| Un link è finito nelle mani sbagliate | Nella release › menu dell'artista › **Nuovo link** (il vecchio smette subito di funzionare). Chi ha il link non può leggere i dati già inviati. |
| L'artista ha dimenticato la sua password | Non si recupera: i dati restano al sicuro da te. Puoi mandargli il PDF dell'invio. |
| Il workflow è rosso | Apri il run su GitHub Actions: se è un test, il messaggio dice quale regola non è rispettata. Niente viene pubblicato finché i test non passano. |
