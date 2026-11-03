# Fioritura

Webapp di studio per la compagna di D (Diritto processuale civile, esame il 21 dicembre 2026).
L'ha chiesta D: deve essere rilassante, con un design morbido, elegante e moderno, e pensata per una donna (testi al femminile: "Benvenuta", "Sei stata brava").
D scrive in italiano e non è uno sviluppatore: spiega in modo semplice e fai tu le modifiche.

Online: https://rahodavide95-sketch.github.io/RHDev/fioritura/ (pubblicata dal workflow `deploy-pages.yml` quando arriva su `main`).

## File

- `index.html`: tutta l'app (HTML, CSS e JS in un solo file, niente build).
- `sw.js`: service worker (funziona offline; la pagina arriva sempre fresca dalla rete). Se cambi l'elenco dei file in cache, alza `VERSION`.
- `manifest.webmanifest` e le icone PNG: per installarla sulla schermata Home.
- `supabase/schema.sql`: la tabella per l'account, applicata dal workflow `.github/workflows/fioritura-db.yml`.
- `docs/ACCOUNT.md`: la guida per D per creare e collegare il progetto Supabase di Fioritura.

## Il programma

È scritto in `PHASES` dentro `index.html`: 4 fasi, 48 giornate dal 3 novembre al 20 dicembre.
Ogni giornata è `[data, [[volume, da, a], ...], { extra, critici }]`. Il 19 dicembre ha `extra: 'simulazione orale'`; il 20 dicembre è `critici: true` (mostra gli argomenti critici segnati negli Appunti).
Al primo avvio il 3 novembre risulta già fatto: era già completato quando D ha mandato il programma.

## Sezioni

- **Oggi**: saluto, giorni all'esame, la giornata di oggi (con "Pagina per pagina" facoltativo), giornate da recuperare, il giardino (un fiore per ogni giornata fatta, una riga per fase), domani, minuti di concentrazione, una frase gentile.
- **Programma**: le 4 fasi con le giornate da spuntare. Toccando una giornata si apre il foglio con note, pagine, "Com'è andata?" e argomento critico veloce.
- **Concentrati**: timer studio/pausa (25/40/50/60 + pausa 5/10/15), suoni di sottofondo generati con Web Audio (pioggia, onde, brusio: nessun file audio), respiro guidato di un minuto.
- **Appunti**: argomenti critici (con volume e pagina, si spuntano come "chiariti") e le note di tutte le giornate.

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

- D: "non deve entrare con l'utenza di Documents, non è mia, è una cosa su cui deve registrarsi un'altra persona".
  Quindi Fioritura ha un progetto Supabase **tutto suo**, separato da Label Finance / Documenti Raho / Finance (come consiglia anche la guida di Orbita). Non usare mai il progetto `ztjlqorvnulgfvbtvavm` né i suoi account.
- Collegamento: oggetto `CLOUD` in `index.html` (Project URL + chiave anon/publishable). Vuoto = account spento (niente pulsante, dati solo sul dispositivo). Una chiave che non sia pubblica (service_role, `sb_secret_`) viene rifiutata (`keyIsPublic()`). Guida per D: `docs/ACCOUNT.md`.
- Workflow `.github/workflows/fioritura-db.yml`: con i secret `SUPABASE_ACCESS_TOKEN` e `FIORITURA_SUPABASE_PROJECT_REF` crea la tabella (`supabase/schema.sql`) e imposta l'accesso del progetto: Site URL e indirizzi di ritorno = indirizzo dell'app, registrazione senza email di conferma (`mailer_autoconfirm`: il servizio email di prova di Supabase manda solo ai membri del progetto), password minima 8, testi delle email in italiano. Senza il secret del progetto si salta.
- Tabella `public.fioritura`: una riga per account (`data` jsonb, `version`), RLS "ognuno la sua riga" e solo dal sito dell'app (`fioritura_from_app()`). Registrazione aperta. Dati non cifrati (sono progressi di studio).
- Client senza librerie (`fetch` verso `/auth/v1` e `/rest/v1`). Salvataggio con `PATCH ...&version=eq.N`: se un altro dispositivo ha salvato prima, si scarica, si unisce e si riprova (`push()` / `pull()`). Confronto con `stateHash()` (JSON con le chiavi in ordine, `canon()`), così due dispositivi uguali non si rimandano i dati a vicenda.
- Si sincronizza 1,5 s dopo ogni modifica, all'apertura, tornando sulla pagina, quando torna la rete e ogni 45 s; non mentre si scrive in un campo.
- Pulsante rotondo in alto (nuvola, o l'iniziale con il pallino dello stato) e riga in cima alle Impostazioni: aprono "Account" (Crea il tuo account / Accedi / Password dimenticata; da dentro: Sincronizza ora, Cambia password, Esci). Nel benvenuto "Hai già un account? Accedi".
- "Password dimenticata?" funziona solo se nel progetto c'è un SMTP (es. Resend); senza, l'app lo dice con un messaggio chiaro. Link delle email: tornano su `…/RHDev/fioritura/` con i dati dopo `#`; `landing()` fa entrare (o apre "Nuova password") e ripulisce l'indirizzo.
- Uscendo i dati restano sul dispositivo. "Cancella i dati da questo dispositivo" con l'account fa uscire e cancella solo qui.
- Da qui Supabase non si raggiunge: i test usano un finto Supabase con Playwright (`route`), mettendo un indirizzo finto in `CLOUD` nella pagina servita.

## Prove

`?oggi=AAAA-MM-GG` nell'indirizzo finge un altro giorno (utile per vedere arretrati, il 20 dicembre, il giorno dell'esame).
Si prova con un server locale (`python3 -m http.server` nella cartella del repo, poi `http://localhost:8000/fioritura/`): da `file://` l'account è spento.
