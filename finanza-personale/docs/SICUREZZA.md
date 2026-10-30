# Sicurezza e privacy di Analisi Finanziarie

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
| Dove | Supabase, progetto di Label Finance (lo stesso di [RH] Documents, quindi lo stesso account), tabelle con il prefisso `finanza_personale` |
| Cosa c'è online | una riga per l'account: la cassaforte cifrata (stesso formato del file di backup) e il numero di versione |
| Chi la legge | solo il proprietario: il primo account che accede dall'app (`finanza_personale_claim()`); gli altri vengono rifiutati dalle regole del database (RLS) |
| Cancellazione | non permessa dall'app (nemmeno al proprietario): un accesso rubato non può cancellare i dati |
| Password | è anche la password che cifra i dati. Viaggia verso Supabase solo per l'accesso (HTTPS), come in [RH] Documents; i dati restano cifrati con una chiave PBKDF2 a 600.000 passaggi |
| Due dispositivi | ogni salvataggio dice su quale versione si basa: se nel frattempo un altro dispositivo ha salvato, si scarica, si unisce elemento per elemento (unione a tre vie, `js/core/merge.js`) e si riprova; niente si sovrascrive di nascosto |
| Senza rete | si continua a lavorare sul dispositivo; si sincronizza appena torna la rete |

Le regole del database sono verificate da `test/rls/run.sh` su un Postgres vero
(18 controlli: chi non ha fatto l'accesso, il proprietario, un estraneo, versioni
superate, cancellazioni).

Cambi di password:
- cambiata dall'app: si cambia online e la cassaforte si richiude con la nuova; gli altri
  dispositivi la accettano al prossimo sblocco;
- cambiata altrove (es. da [RH] Documents): l'app chiede una volta la password di prima
  (o il codice di recupero) e richiude i dati con quella nuova;
- dimenticata: link via email per sceglierne una nuova + codice di recupero per riaprire
  i dati. Senza codice di recupero i dati cifrati non si possono aprire.

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
| Pagina Mercati / "Aggiorna prezzi" / cambi (con consenso) | Yahoo Finance, Binance, CoinGecko, BCE (Frankfurter) | solo il simbolo del titolo (es. `VWCE.DE`) o la valuta base |
| Solo pagina Mercati, se "proxy di riserva" è attivo | allorigins.win, corsproxy.io | l'indirizzo della quotazione pubblica richiesta |

I prezzi del portafoglio vanno ai proxy solo se attivi esplicitamente l'opzione
apposita (spenta di base): i proxy potrebbero dedurre quali titoli possiedi.

## Backup

- **Backup cifrato** (`Analisi-Finanziarie-backup-AAAA-MM-GG.json`): è la cassaforte stessa;
  si apre con la password o il codice di recupero di quando è stato creato.
- **Esporta JSON in chiaro**: solo per passare ad altri programmi, con avviso.
- Ripristinare un backup sostituisce i dati (con "Annulla" subito dopo).

## Limiti noti

- Password e codice dimenticati entrambi = dati persi (per scelta: nessuno ha una
  "chiave di riserva").
- Il token di accesso all'account sta nell'archivio del browser, condiviso con le altre
  app del sito su GitHub Pages: chi lo rubasse potrebbe scaricare la cassaforte, ma non
  aprirla senza la password.
- Safari su iPhone può cancellare i dati di un sito non usato per settimane: installa
  l'app nella schermata Home e fai backup regolari (l'app li ricorda).
- Un dispositivo compromesso (malware, estensioni del browser con accesso alle pagine)
  può leggere ciò che vedi mentre l'app è sbloccata: nessuna app web può impedirlo.
