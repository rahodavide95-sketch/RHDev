# Sicurezza e privacy di [RH] Finance

## Principi

1. **I dati escono dal dispositivo solo cifrati.** Con l'account, online c'è solo la
   cassaforte cifrata nel browser: chi gestisce il server vede testo illeggibile.
   Senza account i dati non escono proprio.
2. **Cifrati anche a riposo.** Sul dispositivo c'è solo testo cifrato; la chiave non è
   mai salvata.
3. **Il minimo indispensabile verso la rete.** Niente librerie da CDN, niente font
   esterni, niente analisi o pubblicità. Le sole richieste esterne sono l'account (dati
   già cifrati) e le quotazioni pubbliche, solo se le attivi.

## Cifratura

| Cosa | Come |
| --- | --- |
| Dati | AES-256-GCM (Web Crypto), compressi prima di cifrarli, IV casuale nuovo a ogni salvataggio, dati aggiuntivi autenticati (`rh-finance/vault/v1`): un solo byte cambiato e il file non si apre |
| Chiave dei dati | 256 bit casuali, generata una volta; in memoria è **non esportabile** |
| Password | PBKDF2-SHA256 con **600.000** passaggi (raccomandazione OWASP) e sale casuale di 16 byte; chiude (wrap) la chiave dei dati |
| Codice di recupero | 160 bit casuali (32 caratteri), chiude una seconda copia della chiave dei dati |
| Cambio password | si richiude solo la chiave (sale nuovo); i dati non vengono riscritti |
| Chiave di riserva (email) | solo con l'account: una copia della chiave dei dati sigillata dal server (`keys.em`, vedi sotto "Password dimenticata"); da sola non apre niente |

Sul dispositivo (IndexedDB `rh-finance`) ci sono: la cassaforte cifrata, la versione
precedente (se l'ultima scrittura si rovinasse) e una copia automatica al giorno per
7 giorni, tutte cifrate. Nel `localStorage` c'è solo il tema (chiaro/scuro), per
evitare il lampo bianco all'apertura.

Robustezza della password: minimo 8 caratteri, con un misuratore che penalizza parole
comuni e sequenze; sotto una certa soglia viene rifiutata se è corta. Dopo 5 tentativi
sbagliati l'interfaccia fa aspettare (la vera protezione resta il costo di PBKDF2).

## Account e sincronizzazione

| Cosa | Come |
| --- | --- |
| Dove | Supabase, progetto di Label Finance (lo stesso di [RH] Documents, quindi gli stessi account), tabelle con il prefisso `finanza_personale` |
| Chi può registrarsi | chiunque (registrazione aperta): ognuno ha il suo account e la sua riga |
| Cosa c'è online | una riga per account: la cassaforte cifrata (stesso formato del file di backup) e il numero di versione |
| Chi la legge | solo l'account a cui appartiene (regole del database, RLS: `user_id = auth.uid()`); nessuno vede le righe degli altri, e il contenuto è comunque cifrato con la password di ciascuno |
| Da dove | solo dal sito dell'app: le regole controllano l'Origin della richiesta (`finanza_personale_from_app()`), così una copia messa su un altro sito non può usare il database |
| Altre app dello stesso progetto | un nuovo account non vede niente di Label Finance (serve l'approvazione del titolare) né di [RH] Documents (solo il suo proprietario) |
| Cancellazione | non permessa dall'app: un accesso rubato non può cancellare i dati |
| Password | è anche la password che cifra i dati. Viaggia verso Supabase solo per l'accesso (HTTPS), come in [RH] Documents; i dati restano cifrati con una chiave PBKDF2 a 600.000 passaggi |
| Due dispositivi | ogni salvataggio dice su quale versione si basa: se nel frattempo un altro dispositivo ha salvato, si scarica, si unisce elemento per elemento (unione a tre vie, `js/core/merge.js`) e si riprova; niente si sovrascrive di nascosto |
| Senza rete | si continua a lavorare sul dispositivo; si sincronizza appena torna la rete |

Le regole del database sono verificate da `test/rls/run.sh` su un Postgres vero
(37 controlli: chi non ha fatto l'accesso, due account diversi che non si vedono a vicenda,
versioni superate, cancellazioni, richieste da un altro sito, la chiave di riserva per
"password dimenticata", niente resti del vecchio "proprietario unico").

Il codice è visibile ma non è open source: `LICENSE` (tutti i diritti riservati, vietato copiarlo
o riusarlo senza permesso).

Cambi di password:
- cambiata dall'app: si cambia online e la cassaforte si richiude con la nuova; gli altri
  dispositivi la accettano al prossimo sblocco;
- cambiata altrove (es. da [RH] Documents): l'app chiede una volta la password di prima
  (o il codice di recupero) e richiude i dati con quella nuova;
- dimenticata (scelta di D: "la password dimenticata facciamola tramite email", opzione "Solo
  email"): dal blocco o dall'accesso, "Password dimenticata?" manda un'email all'account; dal
  link si sceglie la nuova password e i dati si riaprono, **senza codice di recupero**.

### Password dimenticata via email: come funziona

- Alla prima apertura con la password (con l'account collegato) l'app manda al server la chiave
  dei dati e il server la restituisce **sigillata** (`finanza_personale_escrow_seal`: pgcrypto
  AES-256 con un segreto del server + l'id dell'account). La copia sigillata sta nella cassaforte
  stessa (`keys.em`), quindi anche online e nei backup; il server non la conserva.
- Il segreto del server sta in **Supabase Vault** (cifrato con una chiave che non è nel database);
  nessuna funzione lo dà all'app (`finanza_personale_escrow_secret` non si può chiamare).
- `finanza_personale_escrow_open` riapre la chiave solo se: la richiesta arriva dal sito dell'app,
  è dello stesso account, e la sessione è nata dal **link dell'email da meno di un'ora** (nel token,
  `amr` con metodo `otp`, come fa Supabase per i link delle email; verificato sul codice di Supabase
  Auth). Un accesso con la sola password non basta.
- Dal link: prima si riaprono i dati, poi si cambia la password dell'account e si richiude la
  cassaforte con quella nuova (mai una password nuova con i dati ancora chiusi con la vecchia).
- Cassaforte senza chiave di riserva (creata prima, mai riaperta con questa versione): il link
  chiede anche il codice di recupero, e la chiave di riserva si crea subito dopo.
- Il prezzo della scelta: **chi controlla la casella email** dell'account può riaprire i dati; e
  chi gestisce il server (il titolare del progetto Supabase), in teoria, potrebbe farlo cambiando
  le funzioni. Senza account resta tutto come prima: solo password o codice di recupero.

## Durante l'uso

- I dati in chiaro esistono solo in memoria mentre l'app è sbloccata. **Blocco**
  manuale (tasto o `L`) e **automatico** dopo 1–60 minuti senza attività (predefinito 5),
  anche se l'app resta in secondo piano più a lungo. Al blocco si cancellano dalla
  memoria dati, chiave e la copia usata per "Annulla".
- Quando l'app va in secondo piano il contenuto viene sfocato (non si vede nel
  selettore delle app). "Nascondi importi" (`H`) sostituisce le cifre con pallini.
- **Una sola scheda alla volta**: se apri l'app in un'altra scheda, la prima salva e
  si blocca, così le due non si sovrascrivono.
- Salvataggio cifrato mezzo secondo dopo ogni modifica, in un'unica transazione; in
  caso di errore (es. spazio pieno) riprova da solo e mostra un avviso.

## Nel browser

- **Content Security Policy** rigida (`default-src 'none'`): solo script e stili
  dell'app, nessuno script in linea, nessun `eval`, connessioni solo verso le fonti
  di mercato elencate. Su Vercel anche `frame-ancestors 'none'`, HSTS, `nosniff`,
  `no-referrer`, `Permissions-Policy`.
- Tutto il testo dell'utente è inserito con `textContent` (mai HTML): niente XSS.
- I dati letti da backup, file o disco passano da `sanitize()`: tipi, lunghezze,
  formati e id controllati; un file manomesso non può iniettare nulla.
- L'esportazione CSV neutralizza le formule (`=`, `+`, `@`…) contro la "CSV injection".
- Nessun riferimento (`Referer`) e nessun cookie nelle richieste ai dati di mercato.

### Nota su GitHub Pages

Su `rahodavide95-sketch.github.io` tutte le app del repository condividono lo stesso
"origine" del browser, quindi anche lo stesso spazio di archiviazione. Per questo i
dati sono sempre cifrati e la chiave non viene mai salvata: anche un'altra pagina dello
stesso sito vedrebbe solo testo cifrato. Chi vuole un isolamento completo può
pubblicare la cartella su un dominio proprio (es. Vercel, già configurato in
`vercel.json`).

## Rete: cosa esce e quando

| Quando | Verso | Cosa viene inviato |
| --- | --- | --- |
| Con l'account | Supabase (`ztjlqorvnulgfvbtvavm.supabase.co`) | email e password per l'accesso; la cassaforte cifrata |
| Mai, senza consenso | — | — |
| Prezzi online (con consenso): portafoglio, pagina Mercati, ricerca di un titolo | onvista.de (`api.onvista.de`) | il codice ISIN del titolo (es. `IE00BFMXXD54`) o il testo cercato |
| Crypto e cambi (con consenso) | Binance, CoinGecko, BCE (Frankfurter) | il simbolo della crypto (es. `BTC-USD`) o la coppia di valute |

Le richieste partono dal dispositivo direttamente verso queste fonti: nessun intermediario,
niente cookie (`credentials: 'omit'`), niente indirizzo della pagina di provenienza
(`no-referrer`). La fonte vede il codice richiesto e l'indirizzo internet, come per una
qualsiasi pagina web: mai quantità, importi, conti o altri dati. Con i prezzi online spenti
non esce nulla. Yahoo Finance e i proxy pubblici (allorigins, corsproxy) non si usano più:
Yahoo blocca le richieste dai siti web (niente CORS) e i proxy erano fuori uso o a
pagamento (verificato il 30/10/2026).

## Backup

- **Backup cifrato** (`RH-Finance-backup-AAAA-MM-GG.json`): è la cassaforte stessa;
  si apre con la password o il codice di recupero di quando è stato creato (la chiave di riserva
  dentro il file da sola non serve: la riapre solo il server, dal link dell'email).
- **Esporta JSON in chiaro**: solo per passare ad altri programmi, con avviso.
- Ripristinare un backup sostituisce i dati (con "Annulla" subito dopo).

## Limiti noti

- Con l'account, la casella email è la chiave di riserva: proteggila (password forte, verifica
  in due passaggi). Senza account, password e codice dimenticati entrambi = dati persi.
- Il token di accesso all'account sta nell'archivio del browser, condiviso con le altre
  app del sito su GitHub Pages: chi lo rubasse potrebbe scaricare la cassaforte, ma non
  aprirla senza la password (a meno di rubare quello di un link dell'email nell'ora in cui vale).
- Safari su iPhone può cancellare i dati di un sito non usato per settimane: installa
  l'app nella schermata Home e fai backup regolari (l'app li ricorda).
- Un dispositivo compromesso (malware, estensioni del browser con accesso alle pagine)
  può leggere ciò che vedi mentre l'app è sbloccata: nessuna app web può impedirlo.
