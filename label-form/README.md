# Label Form — il modulo dell'etichetta per gli artisti

Come un Google Modulo, ma dell'etichetta e cifrato. Ogni artista riceve un link personale e manda
tutto il necessario per una release:
- dati;
- bio e social;
- press kit (link);
- tracce con BPM, tonalità, crediti e split;
- artwork;
- contratto firmato sulla pagina.

I file restano dove sono (Drive, Dropbox…): l'artista incolla i link e il modulo li controlla.

- **Area dell'etichetta:** https://rahodavide95-sketch.github.io/RHDev/label-form/
- **Prova senza account:** https://rahodavide95-sketch.github.io/RHDev/label-form/?demo=1
- **Messa in funzione:** [`docs/SETUP.md`](docs/SETUP.md)
- **Sicurezza e privacy:** [`docs/SICUREZZA.md`](docs/SICUREZZA.md)

## Cosa fa

- **Moduli personalizzabili come Google Moduli**
  - Sezioni e domande: risposta breve, paragrafo, email, telefono, numero, data, link controllato,
    scelta singola, caselle, menu, elenchi ripetibili (es. tracce), crediti e split %, IBAN,
    codice fiscale, testo libero.
  - Testi formattati: grassetto, corsivo, colori, titoli, elenchi, link.
  - Aspetto: stili pronti, colori, caratteri, angoli, larghezza, immagine di testata, logo.
  - Anteprima dal vivo; salvataggio automatico.
- **Contratto**
  - Il testo è modificabile, con i dati dell'artista inseriti in automatico.
  - Firma con dito, mouse o foto, più la firma dell'etichetta.
  - Dopo la firma non si cambia più (lo blocca il database) e l'integrità si verifica con un'impronta SHA-256.
- **Release e checklist**
  - Per ogni artista vedi se ha aperto, inviato o modificato.
  - Vedi cosa manca ("manca artwork", "Contratto firmato ✓").
- **Avvisi a ogni invio, modifica e firma**
  - Nell'app e, se attivate, via email.
  - Nell'email ci sono i campi cambiati, mai i valori.
- **Storico**: ogni versione dell'invio con il "prima → dopo" dei campi cambiati.
- **Per l'artista**
  - Riepilogo prima di inviare e bozza automatica (senza i dati riservati).
  - Copia in PDF o via email, a sua scelta.
  - Con una sua password può rivedere e modificare finché la release è aperta.
- **Sicurezza**
  - Cifratura nel browser (il server non legge nulla).
  - Verifica in due passaggi obbligatoria per l'etichetta.
  - Link revocabili e con scadenza.
  - Tentativi di password limitati.

## Struttura

```
label-form/
├── index.html            area dell'etichetta (accesso + 2FA, release, moduli, avvisi, impostazioni)
├── invio.html            pagina per l'artista (invio.html#k=<link segreto>)
├── css/                  app.css (area), form.css (modulo, tema variabile), pdf.css
├── js/core/              logica pura con test: crypto, schema, answers, links, contract, richtext, theme
├── js/ui/                DOM sicuro, editor di testo, firma, disegno del modulo, PDF
├── js/admin/             area dell'etichetta (views/ = pagine)
├── js/artist/app.js      pagina dell'artista
├── js/api/               supabase.js (vero) e demo.js (prova nel browser, stesse regole)
├── supabase/schema.sql   tabelle, regole e funzioni (rieseguibile)
├── supabase/functions/label-form-mail/   email (Resend): avvisi, copie, prova
├── test/                 npm test (codice) e test/rls/run.sh (sicurezza del database)
└── docs/                 SETUP.md, SICUREZZA.md
```

## Test

```bash
cd label-form
npm test                 # cifratura, moduli, link, IBAN/CF, contratto
bash test/rls/run.sh     # regole del database su un Postgres vero (serve PostgreSQL 15+)
```

In locale: `python3 -m http.server 8000` dalla cartella del repo, poi apri
`http://localhost:8000/label-form/?demo=1`.
