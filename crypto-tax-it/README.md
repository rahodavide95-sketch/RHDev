# Dichiarazione Redditi

Aiuta a preparare la dichiarazione dei redditi delle persone fisiche (Redditi PF / 730) in autonomia: lavoro dipendente,
musica (prestazioni occasionali, diritti d'autore), spese e detrazioni e, soprattutto, **investimenti in cripto e oro**
(quadri RT e RW, partendo dagli export di Crypto.com, Bitpanda e altri). Alla fine dice se, quanto e cosa pagare con l'F24.
È un'unica pagina web: **nessuna installazione, nessun server, i dati restano nel browser**.

> **Stato: prototipo da validare.** Il motore di calcolo è coperto da test con casi calcolati a mano, ma i
> **formati degli export sono ricostruiti da fonti secondarie e non ancora verificati su file reali**, e le regole
> fiscali sono marcate "da verificare". Finché il risultato è una BOZZA o non è stato rivisto da un commercialista non
> va usato per la dichiarazione. Dettagli in `docs/SPECIFICA.md`.

## Come si usa

1. Apri `index.html` (doppio clic) oppure il link della pagina pubblicata. A sinistra (sul telefono nel menu ☰) c'è
   l'elenco delle sezioni, in ordine; in fondo a ogni pagina il pulsante porta alla successiva.
2. **Panoramica**: quanto pagare adesso e più avanti, quando inviare la dichiarazione, il prossimo passo da fare e
   l'avanzamento di ogni sezione.
3. **Redditi**
   - **Lavoro dipendente**: stipendio o pensione dalla Certificazione Unica (quadro RC: righi RC1, RC6, RC10) e
     addizionali già trattenute (CU punto 22 regionale, punti 26 e 27 comunale: righi RV3 e RV11).
   - **Musica (DJ e SIAE)**: serate e lavori occasionali (rigo RL15), diritti d'autore SIAE e royalties (rigo RL25,
     deduzione forfettaria 25% o 40% sotto i 35 anni). Per ogni CU si copiano il punto 4 (lordo) e il punto 9 (ritenuta).
   - **Spese e detrazioni**: spese sanitarie (19% oltre 129,11 €, rigo RP1), altre detrazioni e oneri deducibili.
   - **IRPEF e addizionali**: stima dell'IRPEF 2025 su tutti i redditi (scaglioni, detrazioni da lavoro, taglio del
     cuneo) e addizionali regionale e comunale: l'importo dovuto si può scrivere a mano (righi RV2 e RV10), altrimenti
     si stima con l'aliquota della CU. Le voci da pagare (4001, 3801, 3844, 3843, acconti 4033/4034) entrano in «Cosa
     pagare»; fino a 12 € per tributo non si versa.
   Ogni pagina mostra dove si scrive ogni importo.
4. **Investimenti** (tutto in un'unica sezione)
   - **Piattaforme e file**: scegli la piattaforma (Crypto.com App o Exchange, Bitpanda, Binance, Coinbase, altra o
     wallet personale) e carica i file (CSV o .zip, il tipo viene riconosciuto da solo) o collega le API.
   - **Da controllare**: il programma non indovina; ti chiede solo ciò che non può sapere (dove sono finite delle
     crypto uscite, a che costo hai preso quelle arrivate da fuori, righe sconosciute). I **prezzi** che mancano (per
     esempio il valore al 31/12 per il quadro RW) li scarica da solo: cripto da Binance, Crypto.com Exchange, Kraken,
     Coinbase o CryptoCompare; oro e metalli dal prezzo LBMA in euro (diviso 31,1035 per avere il grammo, come li conta
     Bitpanda) o da PAX Gold; valute dal cambio BCE. Ogni prezzo ha la fonte scritta per esteso e il confronto con una
     seconda fonte; si può sempre sostituire con quello dell'estratto conto della piattaforma.
   - **Calcolo imposte**: riepilogo, quadro RT (cripto sez. V-A, oro sez. II), quadro RW con IVCA, elenco delle
     operazioni, azioni/ETF/conti (dove vanno), confronto tra anni e metodo di calcolo.
5. **Chiusura**
   - **Cosa pagare**: **se** devi pagare, **quanto** e **cosa**, voce per voce con codice tributo F24 (1715 cripto,
     1727/1728/1729 IVCA, 1100 oro da confermare, 4001/4033/4034 IRPEF, 3801/3844 addizionali), scadenza e, se la
     scadenza è passata, la stima del ravvedimento operoso nel giorno in cui paghi.
   - **Documenti**: un solo pulsante scarica tutto per il commercialista (.zip con LEGGIMI, fascicolo PDF e moduli).
     Qui si completano i dati per i moduli (nome, codice fiscale, acconti IVCA già versati, custodi). I **moduli
     fac-simile** dell'Agenzia delle Entrate (Quadro RW di Redditi PF 2026 e Quadro W del 730/2026) arrivano già
     compilati, con **in rosso** i campi da completare o verificare e una legenda su ogni pagina. Il fascicolo PDF
     (copertina, prospetti RT/RW, imposte e versamenti, altri redditi, allegati con cessioni, lotti, proventi, saldi,
     fonti con impronta SHA-256) porta la filigrana BOZZA finché restano punti da controllare. Inoltre CSV per Excel.
   - **Guida alla compilazione**: un riquadro per ogni quadro (RC, RL, RP, RT, RW, RN/RV/F24) con i righi e gli
     importi da scrivere, i consigli per la precompilata e le parole difficili spiegate.
6. **Impostazioni**: regole di calcolo, salvataggio e apertura del progetto, programma da usare offline, dati di
   esempio e azzeramento.

Il lavoro si salva da solo nel browser; si può anche salvare/riaprire come file di progetto.

**Fuori da claude.ai:** in Impostazioni il pulsante "Scarica il programma (.html)" salva un unico file .html che si apre con un doppio clic, anche senza internet.

**API (sperimentali):** Crypto.com Exchange, Bitpanda e Binance si possono collegare con una chiave di sola lettura (la chiave resta nel browser, non viene salvata e viene inviata solo alla piattaforma). I collegamenti sono costruiti sulla documentazione ufficiale e provati su risposte **simulate**, non con un account reale: dall'ambiente di sviluppo non si raggiungono i server delle piattaforme. Inoltre i browser possono bloccare le chiamate dirette (CORS) e dentro claude.ai la pagina non può collegarsi a siti esterni: in quel caso si usano i file. Ciò che l'API non scarica (Earn, staking, margine, azioni…) compare in **Da controllare** finché non aggiungi il file o confermi di non avere operazioni di quel tipo; se API e file coprono lo stesso periodo il programma ti fa scegliere una sola fonte. Crypto.com App non ha un'API pubblica. Dettagli e limiti in `docs/SPECIFICA.md`.

## Pubblicazione su Vercel

Su Vercel: **Add New → Project →** importa il repository `RHDev` **→** nella schermata «Configure Project», alla voce
**Root Directory** premi **Edit** e scegli la cartella `crypto-tax-it` **→** Framework Preset: **Other**, nessun comando di build
(la pagina `index.html` è già pronta) **→ Deploy**. Lo stesso repository può avere più progetti Vercel, uno per cartella.
`vercel.json` fa sì che `index.html` non resti in cache dopo un aggiornamento. La cartella `api/` contiene la funzione
`/api/price` che Vercel pubblica da sola: scarica i prezzi storici dal server (dal browser le borse spesso bloccano le
richieste) e riceve solo simbolo e data. Su GitHub Pages non c'è e la pagina chiede i prezzi direttamente alle fonti.

## Attenzione: questo repository pubblica su GitHub Pages

Il workflow `.github/workflows/deploy-pages.yml` pubblica **l'intera cartella radice** a ogni push su `main`.
La pagina è pubblica ma i dati non lo sono (restano nel browser di chi la usa). Non committare mai export,
chiavi o report: il `.gitignore` di questa cartella li esclude, ma controlla sempre con `git status`.

## Per chi sviluppa

```bash
node app/build.js          # ricostruisce index.html (pagina unica) e app/dist/artifact.html
node --test app/test/*.test.js  # test del motore, degli importatori, dell'analisi e dei PDF
```

Sorgenti in `app/src`: `core` (tipi, date), `csv`, `importers`, `engine` (lotti LIFO, permute, trasferimenti),
`tax` (panieri, riporto perdite, franchigie per anno), `rw`, `zip` (lettura/scrittura), `pipeline`, `report`, `payments` (cosa pagare: codici F24, scadenze, ravvedimento), `others` (lavoro, musica, spese: righi e stima IRPEF), `pdf`, `facsimile`, `platforms` (catalogo piattaforme), `ui`.
Librerie incluse in `app/src/vendor` (licenza MIT): `decimal.js` (calcoli esatti sui decimali), `jsPDF` e `jsPDF-AutoTable` (PDF).
