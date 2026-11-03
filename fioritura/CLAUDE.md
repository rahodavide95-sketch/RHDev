# Fioritura

Webapp di studio per la compagna di D (Diritto processuale civile, esame il 21 dicembre 2026).
L'ha chiesta D: deve essere rilassante, con un design morbido, elegante e moderno, e pensata per una donna (testi al femminile: "Benvenuta", "Sei stata brava").
D scrive in italiano e non è uno sviluppatore: spiega in modo semplice e fai tu le modifiche.

Online: https://rahodavide95-sketch.github.io/RHDev/fioritura/ (pubblicata dal workflow `deploy-pages.yml` quando arriva su `main`).

## File

- `index.html`: tutta l'app (HTML, CSS e JS in un solo file, niente build).
- `sw.js`: service worker (funziona offline; la pagina arriva sempre fresca dalla rete). Se cambi l'elenco dei file in cache, alza `VERSION`.
- `manifest.webmanifest` e le icone PNG: per installarla sulla schermata Home.

## Il programma

È scritto in `PHASES` dentro `index.html`: 4 fasi, 48 giornate dal 3 novembre al 20 dicembre.
Ogni giornata è `[data, [[volume, da, a], ...], { extra, critici }]`. Il 19 dicembre ha `extra: 'simulazione orale'`; il 20 dicembre è `critici: true` (mostra gli argomenti critici segnati negli Appunti).
Al primo avvio il 3 novembre risulta già fatto: era già completato quando D ha mandato il programma.

## Sezioni

- **Oggi**: saluto, giorni all'esame, la giornata di oggi (con "Pagina per pagina" facoltativo), giornate da recuperare, il giardino (un fiore per ogni giornata fatta, una riga per fase), domani, minuti di concentrazione, una frase gentile.
- **Programma**: le 4 fasi con le giornate da spuntare. Toccando una giornata si apre il foglio con note, pagine, "Com'è andata?" e argomento critico veloce.
- **Concentrati**: timer studio/pausa (25/40/50/60 + pausa 5/10/15), suoni di sottofondo generati con Web Audio (pioggia, onde, brusio: nessun file audio), respiro guidato di un minuto.
- **Appunti**: argomenti critici (con volume e pagina, si spuntano come "chiariti") e le note di tutte le giornate.

## Dati

Solo nel `localStorage` del browser, chiave `fioritura.v1` (la scheda aperta in `fioritura.tab`). Nessun server.
`done[giorno]` è la data della spunta; negativa vuol dire spunta tolta (serve per unire due copie: vince la modifica più recente).
"Salva una copia" / "Carica una copia" (Impostazioni) scaricano e uniscono un file JSON: le due versioni si sommano, gli argomenti eliminati (`gone`) non tornano.
Il repo è pubblico: non mettere mai nel codice nomi o dati personali.

## Prove

`?oggi=AAAA-MM-GG` nell'indirizzo finge un altro giorno (utile per vedere arretrati, il 20 dicembre, il giorno dell'esame).
