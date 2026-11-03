# Fioritura

Webapp di studio nata per la compagna di D (Bi: Diritto processuale civile, esame il 21 dicembre 2026), poi aperta a chiunque si registri, con tutti gli esami che servono.
L'ha chiesta D: deve essere rilassante, con un design morbido, elegante e moderno, e pensata per una donna (testi al femminile: "Benvenuta", "Sei stata brava").
D scrive in italiano e non è uno sviluppatore: spiega in modo semplice e fai tu le modifiche.

Online: https://rahodavide95-sketch.github.io/RHDev/fioritura/ (pubblicata dal workflow `deploy-pages.yml` quando arriva su `main`).

## File

- `index.html`: tutta l'app (HTML, CSS e JS in un solo file, niente build).
- `sw.js`: service worker (funziona offline; la pagina arriva sempre fresca dalla rete). Se cambi l'elenco dei file in cache, alza `VERSION`.
- `manifest.webmanifest` e le icone PNG: per installarla sulla schermata Home.
- `supabase/schema.sql`: la tabella per l’account, applicata dal workflow `.github/workflows/fioritura-db.yml`.
- `supabase/push.sql`, `supabase/functions/fioritura-push/index.ts`, `supabase/config.toml`: le notifiche push, preparate dal workflow `.github/workflows/fioritura-push.yml`.

## Crediti

Riga di crediti scritta da D (testo esatto, non cambiarlo): «Progettata per dare un piccolo aiuto alla mia bellissima Bi, ti amo! ❤️». Costante `CREDITS`, in fondo alla pagina Oggi (`.credits`, sotto la frase del giorno) e in fondo alle Impostazioni.

## Esami (D: "l'app è fatta non solo per 1 solo esame ma per tanti, per quelli che servono, in base a chi si registra")

- Ognuno ha i suoi esami in `S.exams`: `{ id, name, date (giorno dell'esame), start, books: [nomi], phases: [{ title, short, days: [[giorno, [[libro, da, a], ...], { extra, critici }]] }], gen, at, mt }`. Si sincronizzano per `id` (vince `mt`), gli eliminati vanno in `gone`.
- L'esame in corso è scelto su ogni dispositivo (`fioritura.exam`, `setActive()` / `pickActive()`: altrimenti il prossimo esame in calendario). `useExam()` rifà le variabili che usano le viste: `SUBJECT`, `EXAM`, `EXID`, `BOOKS`, `PHASES`, `DAYS`, `DAY`, `TOTAL`.
- Spunte, pagine, note e umore sono per esame: chiave `esame|giorno` (`K(iso)`, es. `dpc|2026-11-03`). Gli argomenti critici hanno `ex`. Il calendario, i minuti di concentrazione e le impostazioni non dipendono dall'esame.
- **Programma pronto** `TEMPLATES.dpc`: Diritto processuale civile, il programma con cui è nata l'app (di Bi): 4 fasi, 48 giornate dal 3 novembre al 20 dicembre, esame il 21 dicembre 2026; il 19 dicembre ha `extra: 'simulazione orale'`, il 20 è `critici: true`. Aggiungendolo il 3 novembre risulta già fatto (`firstDone`). Compare tra i programmi pronti finché la data dell'esame non è passata.
- **Dati di prima** (senza `exams`, giornate scritte solo come data): `upgradeData()` li trasforma in `dpc|giorno` e aggiunge quell'esame (con `at`/`mt` = 1, così qualunque modifica vera vince). Vale per i dati sul dispositivo (salvati subito nel nuovo formato), per quelli online e per le copie in file.
- **Nuovo esame** (`genSheet()` + `makePlan()`): nome, inizio, giorno dell'esame, libri con le pagine, quante ripetizioni dopo la prima lettura (0–3, quindi al massimo 4 fasi e 4 colori), più pagine nel weekend (doppio), domenica libera, l'ultimo giorno solo argomenti critici. I giorni vanno dall'inizio alla vigilia; la prima lettura ha il doppio del tempo di ogni ripetizione; ogni giro copre tutte le pagine in ordine (un giorno può avere pezzi di due libri). Anteprima dal vivo e messaggi chiari se mancano dati o giorni. Un utente nuovo dopo il benvenuto apre subito "Nuovo esame"; senza esami Oggi e Programma mostrano "Aggiungi il tuo primo esame".
- In Oggi e nel Programma la pillola con il nome dell'esame apre "I tuoi esami" (progressi, cambia esame, modifica: nome e data, elimina con due tocchi e Annulla, aggiungi). In Oggi la scheda "Anche oggi" mostra le giornate degli altri esami.
- **Modifica la giornata** (dal foglio della giornata): pezzi di pagine (libro, da, a), "altro da fare", "solo argomenti critici".
- Frasi: la vigilia e il giorno dell'esame in corso hanno le loro (Dante, Virgilio).

## Sezioni

- **Oggi**: saluto e sotto una frase celebre con il suo autore, diversa ogni giorno (D: "ogni giorno una frase motivazionale diversa", "devono essere celebri, di qualcuno", "molte molte di più", "devono cambiarsi ogni mezzanotte"). `QUOTES` = 228 coppie [frase, autore] con attribuzione sicura (niente frasi da internet con autore dubbio), in ordine dal 3 novembre con `quoteOf()`: 228 giorni senza ripetizioni, mai due di fila dello stesso autore; `QUOTE_DAY` per il 20 e il 21 dicembre. Cambia a mezzanotte (data del telefono; a pagina aperta si ridisegna da sola). In fondo alla pagina restano solo i crediti. Poi: giorni all'esame, la giornata di oggi (con "Pagina per pagina" facoltativo), giornate da recuperare, il giardino (un fiore per ogni giornata fatta, una riga per fase), domani, minuti di concentrazione.
- **Programma**: le 4 fasi con le giornate da spuntare. Toccando una giornata si apre il foglio con note, pagine, "Com'è andata?" e argomento critico veloce.
- **Concentrati**: timer studio/pausa (25/40/50/60 + pausa 5/10/15), suoni di sottofondo generati con Web Audio (pioggia, onde, brusio: nessun file audio), respiro guidato di un minuto.
- **Calendario** (D: "una sezione calendario dove potermi appuntare determinate cose, con promemoria e notifiche che mi arrivano nella sezione notifiche sopra vicino alla lettera del profilo"): mese con i giorni di studio (pallino del colore della fase) e i suoi impegni (pallini colorati), il giorno scelto con studio, esame e impegni, "Prossimi impegni". Scheda in mezzo alla barra (5 schede: Oggi, Programma, Calendario, Concentrati, Appunti; Programma ora ha l'icona dell'elenco). Gli impegni di oggi compaiono anche in Oggi ("Oggi in calendario").
- **Appunti**: argomenti critici (con volume e pagina, si spuntano come "chiariti") e le note di tutte le giornate.

## Calendario, promemoria e notifiche

- `S.events`: `{ id, title, date, time ('' = tutto il giorno), rem, color 0-4, note, at, mt }`. `rem` = minuti prima dell'ora (-1 nessuno); per "tutto il giorno" l'ora di riferimento è le 9 (`REM_DAY`: quel giorno alle 9, il giorno prima alle 18, due giorni prima alle 9). Foglio `evSheet()` con bozza `evDraft`; Elimina con due tocchi (finisce in `gone`).
- Le notifiche non si salvano: si calcolano dagli impegni (`notifications()`: promemoria già scattati negli ultimi 45 giorni, chiave `id@ora del promemoria`). Lette in `notifRead`, tolte con "Svuota" in `notifHide`: si sincronizzano. Un promemoria salvato quando la sua ora è già passata non suona.
- Campanella (`.ib.bell`) in alto, prima della lettera del profilo, con il numero delle nuove (`paintBell()`). Aprendola si segnano come lette (in quel foglio restano evidenziate); toccandone una si va al calendario su quel giorno. Sotto: "In arrivo" e l'interruttore "Avvisi anche sul telefono".
- `checkReminders()` ogni 15 s, all'apertura e tornando sulla pagina: un promemoria si annuncia una sola volta per dispositivo (`fioritura.announced`). Se è appena scattato: avviso a schermo, rintocco e, se attivi, avviso del telefono (`sysNotify()`, tramite il service worker; toccandolo si torna all'app, `notificationclick` in `sw.js`). Se è scattato mentre l'app era chiusa: "Hai N promemoria nella campanella".
- **Notifiche push, anche ad app chiusa** (D: "si aggiungi le notifiche push sul telefono"): interruttore "Avvisi sul telefono" nella campanella. Chiede il permesso (subito dal tocco: iPhone lo vuole), poi, con l'account collegato, iscrive il telefono (`pushSubscribe()`: chiave pubblica VAPID da `GET …/functions/v1/fioritura-push?key=1`, `pushManager.subscribe`, `rpc/fioritura_push_save`). Senza account gli avvisi valgono solo ad app aperta. Su iPhone solo con l'app nella schermata Home (iOS 16.4+): nel browser l'interruttore non c'è e il testo lo spiega. L'iscrizione si rinnova dopo l'accesso e ogni 3 giorni (`pushRefresh()`); uscendo dall'account si toglie (`pushUnsubscribe()`).
- Ogni impegno ha `remTs` (ora del promemoria in ms, -1 = nessuno o già passato) e `tz` (fuso del telefono), calcolati dall'app: il server non deve interpretare date e fusi. Gli impegni di prima li ricevono al caricamento.
- Server: funzione `fioritura/supabase/functions/fioritura-push/index.ts` (senza librerie: firma VAPID ES256 e cifratura aes128gcm con WebCrypto), chiamata ogni minuto da pg_cron (job `fioritura-push`, intestazione `x-cron-secret`): manda i promemoria con `remTs` negli ultimi 10 minuti, una volta sola (`fioritura_push_sent`), a tutti i telefoni dell'account (`fioritura_push`); 404/410 = telefono tolto. Testo: «Titolo» / «Oggi alle 15:00 · note». Tabelle e job in `supabase/push.sql`; tutto lo prepara il workflow `.github/workflows/fioritura-push.yml` (chiavi VAPID solo la prima volta nei segreti della funzione `FIORITURA_VAPID_JWK`, segreto `FIORITURA_CRON_SECRET` nuovo a ogni giro, pubblicazione, SQL, due prove finali). Le chiavi VAPID non vanno mai rigenerate: i telefoni iscritti smetterebbero di ricevere.
- `sw.js`: `push` mostra la notifica (icona, `tag` = chiave del promemoria, così non si doppia con l'avviso locale), `notificationclick` riapre l'app sul giorno (`?cal=giorno` o messaggio `{type:'cal'}` → `goCal()`).
- Prove della funzione: in locale con Node (`--experimental-strip-types`) contro un finto Supabase; la cifratura è verificata decifrando con la libreria `http_ece` (quella di web-push), la firma con la chiave pubblica.
- Sincronizzazione: `events` per `id` (vince `mt` più recente), `notifRead`/`notifHide` il più recente; `keep` conserva e rimanda le chiavi sconosciute arrivate da versioni più nuove dell'app.

## Colori (richiesta di D: "lilla, verde pastello, tutti colori tenui, anche gialletto, bianco, nero per la sera, azzurro pastello")

- 7 tavolozze in `window.FIO_PAL` (in cima, nel `<head>`): Cipria, Lilla, Salvia, Vaniglia, Cielo, Pesca, Neve. Ognuna ha la versione di giorno (`l`) e di sera (`d`); il CSS delle tavolozze lo genera lo script del `<head>` (attributi `data-pal` e `data-mode` su `<html>`, messi prima del primo disegno).
- "Luce" (`settings.theme`): Auto (segue il telefono), Chiara, Scura (quasi nera), Di sera (nera dalle 19 alle 7, ricontrollata ogni minuto). `window.FIO_THEME()` decide.
- I colori delle 4 fasi (fiori del giardino, pillole) restano gli stessi in tutte le tavolozze.
- Si scelgono nel benvenuto e nelle Impostazioni (`palGrid()`).

## Dati

Nel `localStorage` del browser, chiave `fioritura.v1` (la scheda aperta in `fioritura.tab`, il nome del dispositivo in `fioritura.dev`, l'account in `fioritura.sync`).
Ogni cosa ha la sua data di modifica, così due dispositivi si uniscono senza perdere nulla (`mergeIn()`, usata sia dall'account sia da "Carica una copia"):
`done[giorno]` = data della spunta (negativa = spunta tolta); `pagesAt`, `notesAt`, `moodAt`, `settingsAt` e `st` degli argomenti: vince la più recente; argomenti eliminati in `gone` (non tornano); minuti di concentrazione per dispositivo (`focus[dispositivo][giorno]`), sommati in `focusOf()`.
Dell'impostazioni si sincronizzano solo nome, colore e luce (`SYNC_SETTINGS`); suoni, schermo acceso e timer restano del dispositivo.
Il 3 novembre parte già fatto con data 1 (la più vecchia possibile): qualsiasi modifica vera, anche da un altro dispositivo, vince.
Il repo è pubblico: non mettere mai nel codice nomi o dati personali.

## Account e sincronizzazione (richiesta di D: "collegare con un account così resta tutto sincronizzato")

- D prima: "non deve entrare con l'utenza di Documents, non è mia, è una cosa su cui deve registrarsi un'altra persona"; poi, chiarendo: "l'importante è che lei acceda con una sua mail, non mi importa dove va a finire l'utenza".
  Quindi: lei crea il SUO account (sua email e password) nel progetto Supabase già esistente `ztjlqorvnulgfvbtvavm` (lo stesso di Analisi Finanziarie, che ha già la registrazione aperta a tutti), tabella separata `fioritura`. Il suo account non apre Documenti Raho (solo il proprietario) né Label Finance (serve l'approvazione del titolare). Non serve creare progetti nuovi.
- Collegamento: oggetto `CLOUD` in `index.html` (Project URL + chiave anon). Vuoto = account spento. Una chiave non pubblica (service_role, `sb_secret_`) viene rifiutata (`keyIsPublic()`).
- Workflow `.github/workflows/fioritura-db.yml` (secret `SUPABASE_ACCESS_TOKEN`, c'è già): crea la tabella e aggiunge l'indirizzo dell'app agli indirizzi di ritorno consentiti dopo le email, senza togliere quelli delle altre app né cambiare il Site URL.
- Tabella `public.fioritura`: una riga per account (`data` jsonb, `version`), RLS "ognuno la sua riga" e solo dal sito dell'app (`fioritura_from_app()`). Registrazione aperta. Dati non cifrati (sono progressi di studio).
- Client senza librerie (`fetch` verso `/auth/v1` e `/rest/v1`). Salvataggio con `PATCH ...&version=eq.N`: se un altro dispositivo ha salvato prima, si scarica, si unisce e si riprova (`push()` / `pull()`). Confronto con `stateHash()` (JSON con le chiavi in ordine, `canon()`), così due dispositivi uguali non si rimandano i dati a vicenda.
- Si sincronizza 1,5 s dopo ogni modifica, all'apertura, tornando sulla pagina, quando torna la rete e ogni 45 s; non mentre si scrive in un campo.
- Pulsante rotondo in alto (nuvola, o l'iniziale con il pallino dello stato) e riga in cima alle Impostazioni: aprono "Account" (Crea il tuo account / Accedi / Password dimenticata; da dentro: Sincronizza ora, Cambia password, Esci). Nel benvenuto "Hai già un account? Accedi".
- Link delle email (conferma della registrazione, nuova password): tornano su `…/RHDev/fioritura/` con i dati dopo `#`; `landing()` fa entrare (o apre "Nuova password") e ripulisce l'indirizzo.
- Password visibile a richiesta (D: "rendi possibile vedere la password mentre si accede"): ogni campo password (`pwField()`) ha l'occhio a destra (`pwEye`) che la mostra e la nasconde; toccandolo il cursore resta nel campo (`pointerdown` senza togliere il fuoco), così la tastiera non si chiude.
- Uscendo i dati restano sul dispositivo. "Cancella i dati da questo dispositivo" con l'account fa uscire e cancella solo qui.
- Da qui Supabase non si raggiunge: i test usano un finto Supabase con Playwright (`route`).

## Prove

`?oggi=AAAA-MM-GG` nell’indirizzo finge un altro giorno (utile per vedere arretrati, la vigilia, il giorno dell’esame). I dati salvati senza `exams` vengono trattati come dati di prima (Diritto processuale civile).
Si prova con un server locale (`python3 -m http.server` nella cartella del repo, poi `http://localhost:8000/fioritura/`): da `file://` l'account è spento.
