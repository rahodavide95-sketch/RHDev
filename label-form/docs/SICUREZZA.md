# Sicurezza e privacy di Label Form

Scritto per essere capito anche da chi non è tecnico.

## L'idea in una riga

I dati degli artisti vengono **cifrati nel loro browser** prima di partire.
Il server conserva solo testo illeggibile. Si aprono solo nel **tuo** browser, con la tua chiave.
Se qualcuno rubasse il database, troverebbe solo dati inutilizzabili.

## Chi può fare cosa

| Chi | Cosa può fare | Cosa NON può fare |
|---|---|---|
| **Tu (etichetta)** con password + codice 2FA | Creare release, moduli e link; leggere gli invii (con la chiave di cifratura) | Cambiare i dati inviati da un artista; cambiare un contratto firmato |
| **Artista con il link** | Compilare e inviare **una volta** | Leggere o sovrascrivere un invio già fatto |
| **Artista con link + sua password** | Rivedere e modificare il suo invio finché la release è aperta | Cambiare il contratto dopo la firma |
| **Chiunque altro** | Nulla: Label Form ha un progetto Supabase tutto suo e, dopo il tuo primo accesso, le iscrizioni sono chiuse | Creare un account, vedere qualsiasi dato |
| **Chi ruba il database** | Vedere testo cifrato, impronte, date | Leggere dati, link o password |

Tutte queste regole stanno **nel database** (Row Level Security + funzioni controllate), non solo
nell'interfaccia. Sono verificate da `test/rls/run.sh`: 82 controlli su un Postgres vero, che girano
a ogni pubblicazione. Se uno fallisce, non si pubblica nulla.

## Come funziona la cifratura (per i curiosi)

- **La tua chiave**: una coppia RSA-OAEP 3072 bit creata nel tuo browser.
  - La parte privata è chiusa con AES-256-GCM due volte:
    - con la tua password di cifratura (PBKDF2-SHA256, 600.000 passaggi);
    - con il codice di recupero (160 bit casuali).
  - Il server ha solo le due copie chiuse.
- **Ogni invio**: una chiave AES-256 casuale.
  - I dati sono compressi, cifrati e "legati" all'invito: non si possono spostare su un altro artista.
  - La chiave dell'invio è chiusa per te (RSA) e, se l'artista sceglie una password, anche per lui.
- **La password dell'artista** non lascia mai il suo browser.
  - Dalla password nascono due cose: la chiave che apre i suoi dati e una "prova" per il server.
  - Il server ne tiene solo l'impronta SHA-256.
  - Dopo 8 tentativi sbagliati si blocca per 15 minuti.
- **Il link** contiene un codice casuale di 256 bit.
  - Nel database c'è solo l'impronta SHA-256 del codice, più una copia chiusa con la tua chiave (per mostrarti di nuovo il link).
  - Il codice sta dopo il `#` nell'indirizzo, quindi non arriva nei registri dei server web.
- **Il contratto firmato**:
  - viene "congelato" (testo, dati, firme) e se ne calcola l'impronta SHA-256;
  - il database rifiuta qualsiasi modifica dopo la firma, anche con pieni poteri;
  - quando lo apri, l'app ricalcola l'impronta e ti dice se è integro.

## Nel browser

- **Content Security Policy rigida**:
  - solo il codice dell'app, nessuno script esterno;
  - connessioni solo verso Supabase;
  - niente inserimento in altre pagine (anti-clickjacking).
- **Nessun HTML dai dati**:
  - i testi formattati sono salvati come dati strutturati e ridisegnati in modo sicuro;
  - i link accettati sono solo `https`/`mailto`;
  - i colori sono solo `#rrggbb`.
- **Librerie copiate nel repo in versione fissa** (`vendor/`): nessun CDN che possa cambiare il codice.
- **Niente Google Fonts, niente tracciamento, niente pubblicità.**
- **La bozza dell'artista** resta solo sul suo dispositivo e **non** include i dati riservati (IBAN, codice fiscale…).

## Controllo dei link degli artisti

Il modulo riconosce Google Drive, Dropbox, OneDrive, iCloud, WeTransfer, SoundCloud, Spotify,
Bandcamp, Instagram, RA e altri, e controlla questi casi:

- **domini scritti male**: "drive.gogle.com" → "forse intendevi drive.google.com?";
- **link alla propria pagina** invece che al file condiviso: "Il mio Drive", la home di Dropbox;
- **link che scadono**: WeTransfer, SwissTransfer, Smash.

Toglie anche i parametri di tracciamento (`utm_…`, `igsh`, `fbclid`).

Consiglio per gli artisti, già scritto nel modulo: condividere le cartelle **con la tua email**
invece che con "chiunque abbia il link".

## GDPR in pratica

- **Titolare del trattamento**: l'etichetta. Il testo del contratto predefinito contiene già
  l'informativa (art. 13).
- **Dove stanno i dati**: progetto Supabase dell'etichetta, cifrati.
- **Minimizzazione**: il server non conosce nemmeno i dati che conserva. Gli avvisi email dicono
  solo *chi* ha inviato o modificato e *quali campi*, mai i valori.
- **Diritto alla cancellazione**: eliminando l'artista (o la release) spariscono invio, storico,
  contratto e avvisi.
- **Conservazione**: i contratti e i dati fiscali vanno tenuti per gli obblighi di legge (in Italia
  di norma 10 anni). Prima di eliminare una release, scarica i PDF.
- **Copia per l'artista**:
  - il PDF si crea nel suo browser;
  - l'email di copia nasconde i dati riservati;
  - le copie via email sono permesse solo entro 30 minuti dall'invio o con la password, massimo 5 al giorno.

## Cosa resta a te

- Una **password dell'account** solida e la **verifica in due passaggi** (obbligatoria).
- Una **password di cifratura** lunga e il **codice di recupero** in un posto sicuro.
- "Ricorda su questo dispositivo" solo su dispositivi tuoi e protetti.
- Se un link finisce nelle mani sbagliate: **Nuovo link**.
