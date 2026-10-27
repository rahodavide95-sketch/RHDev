# Documenti Raho

Strumento per compilare e scaricare in PDF i documenti di lavoro di Raho (DJ e produttore techno, persona fisica senza partita IVA in Italia).
L'utente si chiama D, scrive in italiano, non è uno sviluppatore: spiega le cose in modo semplice e fai tu le modifiche al codice.

## File

- `app.html`: il sorgente. È un frammento HTML: niente `<!doctype>`, `<html>`, `<head>`, `<body>` (li aggiunge `build.js`).
  D usa SOLO il sito GitHub Pages: non aggiornare e non nominare la vecchia copia su claude.ai (artifact FxSBhSkci1cyJsvGFR8YYS), lo confonde.
  Le modifiche vanno online solo quando arrivano su `main` (il workflow pubblica da lì).
- `build.js`: genera `index.html`, la versione completa servita da GitHub Pages (usabile da PC, iPhone e iPad senza claude.ai).
- `index.html`: generato. Non modificarlo a mano. Dopo ogni modifica ad `app.html` esegui `node documenti-raho/build.js`.

Il repo è pubblico e tutta la cartella è pubblicata su GitHub Pages dal workflow `deploy-pages.yml`.
Non mettere mai dati personali di D (nome, codice fiscale, IBAN, firma) nel codice: restano solo nel `localStorage` del suo browser.

## Documenti (6)

| id | Documento | Note |
| --- | --- | --- |
| `bkc-en` | Contratto booking in inglese: il contratto UFFICIALE di D, 9 pagine, identico al suo PDF "Raho_DJ_Performance_Agreement_EN_Abroad -- VUOTO" (Google Docs) | Date all'estero. Promoter ed evento restano vuoti: li compila il promoter |
| `bkc-it` | Contratto booking in italiano (Contratto di prestazione artistica), 6 pagine | Date in Italia |
| `bkr-est` | Ricevuta booking per committente estero, bilingue IT/EN | Nessuna ritenuta italiana |
| `bkr-it` | Ricevuta booking per committente italiano | Ritenuta 20% se sostituto d'imposta; calcolo lordo dal netto |
| `roy-est` | Ricevuta royalties per label estera, bilingue IT/EN | Nessuna ritenuta |
| `roy-it` | Ricevuta royalties per label italiana | Ritenuta 20%, si toglie se la label è in regime forfettario |

Funzioni: scelta logo (RAHO, RH[BKNG], oppure immagine caricata), firma disegnata con dito / Apple Pencil / trackpad (facoltativa), etichette e committenti salvati, PDF A4 (html2canvas + jsPDF, una pagina immagine per foglio).
Archivio (scheda "Archivio"): ogni PDF scaricato finisce in `state.history` (`{id, doc, number, date, who, amount, file, snap, created, at}`; `snap` = i dati del documento, senza anagrafica, firma e testi modificati). Icona e colore dicono subito il tipo: booking arancione (ricevuta), royalties viola (nota musicale), contratti blu. "Apri" ricarica il documento (`state.viewing`): riscaricandolo l'archivio lo aggiorna con lo stesso numero. Anche un documento identico all'ultimo scaricato tiene il suo numero (`archivedTwin()`).
Numerazione ricevute: la decide lo strumento (richiesta di D), campo in sola lettura. Una sola serie per tutte le ricevute, da 1 ogni anno (anno della data della ricevuta): ultimo numero dell'archivio o `state.seqStart[anno]` (ultimo numero usato fuori dallo strumento, impostabile nell'archivio) + 1. Il vecchio campo `number` diventa `seqStart` al primo avvio.
Dati di D ("I tuoi dati"): anagrafica e più conti (`state.accounts` = `{id, label, holder, iban, bic}`, scelto con `state.acc` nella sezione Ricevuta). Il vecchio `me.iban` diventa da solo il primo conto (`load()`).
"Rubrica e backup": elenco etichette/committenti salvati con Elimina, backup in un file JSON (Scarica / Carica) per passare i dati tra dispositivi o tra sito e claude.ai, "Cancella tutti i dati" con doppio tocco.
Attenzione: `merge()` tiene solo le chiavi presenti in `defaults()`, quindi `load()` copia a parte `saved.labels` e `saved.clients` (prima andavano persi a ogni riapertura).
Su telefono la pagina ha tre schede: Compila / Anteprima / Archivio, ognuna con la sua posizione di scorrimento. Da 941 px in su ci sono solo Compila / Archivio e l'anteprima è sempre a destra; le colonne scorrono separate.

## Interfaccia dello strumento (rifatta su richiesta di D: "contrasti più netti, niente contorni, pulito, moderno ed elegante, + temi")

- Niente bordi: le superfici si distinguono per colore (sfondo, schede `--panel`, campi `--field`). Selezioni in tinta piena (`--accent`). Carattere Inter.
- 5 temi in alto a destra: Automatico (segue il sistema), Chiaro, Sabbia, Scuro, Notte. `state.ui.theme`, applicato con `data-theme` su `<html>` (anche prima del primo disegno, script in cima ad `app.html`).
- I documenti restano bianchi in tutti i temi: i loro colori (`--paper`, `--ink`…) non cambiano.

## Design (approvato da D: non cambiarlo senza che lo chieda)

- Foglio A4 a 96 dpi: 794 × 1123 px, padding 56 / 64 / 48 px, sfondo bianco, inchiostro #111.
- Logo RAHO: Arimo (tipo Arial) 40 px, peso 400, letter-spacing 0.04em. "Più unito, dritto ed elegante" è stata la richiesta.
- Testo: Inter. Etichette ed elementi tecnici: IBM Plex Mono 12 px maiuscolo, letter-spacing 0.08em, grigio #555.
- Intestazione: logo a sinistra, numero e data a destra, filo nero da 3 px sotto. Totale con filo da 3 px sopra e cifra 34 px.
- Note fiscali e pagamento affiancati; in fondo riquadro tratteggiato per la marca da bollo e riga firma.
- Oggetto delle ricevute royalties: solo "Royalties".
- Contratti: una sezione per pagina (richiesta esplicita di D), piè di pagina con sigle e numero di pagina.
- Contratto EN (`contractEN()`, CSS `.ag`): copia del PDF ufficiale misurata in pt (Montserrat SemiBold per titoli ed etichette, Arial/Arimo per il testo, fascia nera con il logo, filo nero da 3 pt in fondo). È stato verificato sovrapponendolo al PDF ufficiale: scarto massimo 1–2 px a 96 dpi. Non cambiare misure o testi senza che D lo chieda. I numeri d'esempio dell'originale (EUR 500, 50%, giorni) si adattano ai dati del modulo (`state.en`). In "Balance" ci sono due caselle vuote (contanti / bonifico) che spunta il promoter: richiesta di D, al posto dei pallini dell'originale. Rispetto all'originale sono corretti due refusi: "included. Late" e "courts of Italy have".
- I filetti del contratto EN sono sfondi `linear-gradient`, non bordi: i browser arrotondano i bordi a pixel interi e le righe si accorciavano.
- Emittente e destinatario delle ricevute più piccoli (nome 14 px, righe 12,5 px) e senza la riga "in arte / aka Raho": richiesta di D.
- Ogni documento deve stare in un foglio per pagina, senza togliere dati (richiesta di D). `fitPaper()`: prima la classe `fit` (spaziature più strette), poi, se non basta, riduce tutto il foglio in scala (la scala più grande che entra, margini invariati). L'avviso giallo compare solo se la scala scende sotto 0,7 (es. molte release).
- Importi: "1.500" vale 1500 (punto delle migliaia); in uscita sempre con il punto, es. € 1.500,00.

## Regole fiscali usate (D non è commercialista: in caso di dubbi va consigliato di sentirne uno)

- D non ha partita IVA: tutti i documenti sono ricevute, non fatture; fuori campo IVA (art. 5 DPR 633/1972).
- Le royalties sono royalties su master, NON diritti d'autore SIAE: niente abbattimento 25%/40%, vanno in dichiarazione come redditi diversi (RL15/RL16, da confermare col commercialista).
- Committente italiano sostituto d'imposta: ritenuta d'acconto 20% (art. 25 DPR 600/1973), Certificazione Unica.
- Committente estero: nessuna ritenuta italiana; il contratto estero prevede che eventuali ritenute locali (es. Germania § 50a EStG) siano a carico del promoter, oltre al netto.
- Marca da bollo da 2 € sopra 77,47 €.
- Nei contratti NON usare la parola "occasionale" (D non vuole dire che suona saltuariamente): EN "Independent self-employed artist", IT "Artista autonomo (art. 2222 c.c.)". Nelle ricevute booking invece "prestazione occasionale" resta, perché è la base fiscale senza partita IVA.
- Nei contratti indirizzo e IBAN di D non compaiono: "forniti a parte".

## Contesto

- Il testo dei contratti viene dalla chat "Contratto per suonare in Germania" (ottobre 2026), versione con una sezione per pagina.
- Logo RH[BKNG] di ricevute e contratto IT: `logo-rhbkng.webp`, il file mandato da D, identico byte per byte. D ha chiesto esplicitamente: niente ritagli, niente modifiche, nulla che non decida lui. Solo la dimensione a schermo (altezza 90 px nelle ricevute) è una scelta nostra, da confermare con D.
- Logo nella fascia del contratto EN: `logo-rhbkng-contract.png`, estratto dal PDF ufficiale di D (88,5 × 31,5 pt).
- `build.js` incorpora i loghi in `index.html` (righe `var ... = 'logo-....png/webp'`), così la pagina funziona anche offline.
- Testo modificabile: ogni blocco creato con `ed(chiave, html)` si può riscrivere dal foglio ("Modifica il testo"). Le modifiche stanno in `state.edits[documento][chiave]` come testo semplice (`**grassetto**`, `[spazio da compilare]`, righe "● " e "- "). Non rinominare le chiavi: D perderebbe le sue modifiche.
