# Dichiarazione Crypto

Calcola plusvalenze, proventi, imposta sostitutiva e prospetto di monitoraggio (quadri RT e RW) per **cripto e oro**
partendo dagli export di Crypto.com (App ed Exchange) e Bitpanda. Si sceglie l'anno (2023-2026), si caricano i file, si
leggono i risultati. È un'unica pagina web: **nessuna installazione, nessun server, i dati restano nel browser**.

> **Stato: prototipo da validare.** Il motore di calcolo è coperto da test con casi calcolati a mano, ma i
> **formati degli export sono ricostruiti da fonti secondarie e non ancora verificati su file reali**, e le regole
> fiscali sono marcate "da verificare". Finché il risultato è una BOZZA o non è stato rivisto da un commercialista non
> va usato per la dichiarazione. Dettagli in `docs/SPECIFICA.md`.

## Come si usa

1. Apri `index.html` (doppio clic) oppure il link della pagina pubblicata.
2. **File**: trascina gli export (CSV o direttamente lo .zip). Il tipo viene riconosciuto da solo.
3. **Da controllare**: il programma non indovina; ti chiede solo ciò che non può sapere (dove sono finite delle
   crypto uscite, a che costo hai preso quelle arrivate da fuori, righe di tipo sconosciuto, prezzi mancanti).
4. **Risultato**: imposta stimata, quadro RT per cripto e oro, prospetto RW, confronto tra anni.
5. **Documenti**: fascicolo **PDF** per la dichiarazione (copertina e riepilogo, prospetti per i quadri RT cripto, RT oro e RW, imposte e versamenti, allegati A-E con elenco cessioni, lotti di acquisto, proventi, saldi, fonti dei dati con impronta SHA-256, decisioni prese e problemi). Si scarica completo oppure un PDF per documento (.zip). Se ci sono punti irrisolti ogni pagina porta la filigrana BOZZA. Inoltre CSV per Excel e salvataggio del progetto.

Il lavoro si salva da solo nel browser; si può anche salvare/riaprire come file di progetto.

## Attenzione: questo repository pubblica su GitHub Pages

Il workflow `.github/workflows/deploy-pages.yml` pubblica **l'intera cartella radice** a ogni push su `main`.
La pagina è pubblica ma i dati non lo sono (restano nel browser di chi la usa). Non committare mai export,
chiavi o report: il `.gitignore` di questa cartella li esclude, ma controlla sempre con `git status`.

## Per chi sviluppa

```bash
node app/build.js          # ricostruisce index.html (pagina unica) e app/dist/artifact.html
node --test app/test/      # test del motore, degli importatori, dell'analisi e dei PDF
```

Sorgenti in `app/src`: `core` (tipi, date), `csv`, `importers`, `engine` (lotti LIFO, permute, trasferimenti),
`tax` (panieri, riporto perdite, franchigie per anno), `rw`, `zip` (lettura/scrittura), `pipeline`, `report`, `pdf`, `ui`.
Librerie incluse in `app/src/vendor` (licenza MIT): `decimal.js` (calcoli esatti sui decimali), `jsPDF` e `jsPDF-AutoTable` (PDF).
