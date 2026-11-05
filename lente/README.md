# Lente — analizzatore di profili Instagram

Lente analizza un profilo Instagram e ti dice come va e cosa fare per crescere.
Gira tutta nel browser: i dati restano sul tuo dispositivo.

Online (quando arriva su `main`): <https://rahodavide95-sketch.github.io/RHDev/lente/>

## Cosa fa

- **Numeri principali**: follower, seguiti, post, engagement rate (anche mediano),
  media di mi piace, commenti e visualizzazioni, post a settimana, ultimo post.
- **Punteggio da 0 a 100** con le voci che lo compongono.
- **Confronto con la fascia** del profilo (Nano, Micro, Medio, Macro, Mega).
- **Consigli pratici**: momento migliore, formato che rende di più, hashtag,
  lunghezza delle didascalie, domande, ritmo, pause, link e bio.
- **Grafici**: interazioni post per post, giorno × ora, formati, giorni della
  settimana, hashtag più usati ed efficaci, didascalie, mese per mese.
- **Post migliori e da rivedere**, tabella di tutti i post (ordinabile, filtri).
- **Segnali da controllare** (numeri insoliti, non prove di follower falsi).
- **Valore indicativo** di un post o di una storia sponsorizzati.
- **Archivio** con la **crescita dei follower** nel tempo e il **confronto** tra
  2–4 profili.
- **Export** in CSV, JSON e PDF (stampa).

## Da dove prende i dati (tutti modi consentiti da Instagram)

1. **Profilo pubblico con le API di Meta**: qualsiasi profilo Business o Creator,
   anche non tuo. Con il tuo account aggiunge gli insights (copertura, salvataggi,
   condivisioni, città, paesi, età, genere). Serve un token gratuito: la scheda
   **Guida** dell'app spiega come averlo, passo per passo.
2. **I tuoi dati (export di Instagram)**: lo ZIP che Instagram ti manda. Lente trova
   chi non ti segue, i fan che non segui, i reciproci, gli unfollow, le richieste,
   quando pubblichi, a chi metti più mi piace. Caricando un export nuovo ti dice
   **chi ha smesso di seguirti** dalla volta prima.
3. **CSV o a mano**: il CSV dei contenuti di Meta Business Suite, un file tuo o i
   numeri scritti a mano.

C'è anche un **esempio** con dati inventati, per provarla subito.

Non può leggere i profili privati o personali e non può dire chi ha visitato un
profilo: nessuno strumento ufficiale può farlo.

## File

- `index.html` — pagina e stile
- `core.js` — i calcoli (analisi, lettura dell'export e dello ZIP, CSV, API di Meta)
- `app.js` — l'interfaccia
- `sw.js`, `manifest.webmanifest`, icone — per installarla sul telefono e aprirla offline
- `test/core.test.js` — le prove automatiche

## Prove

```bash
cd lente && npm test
```
