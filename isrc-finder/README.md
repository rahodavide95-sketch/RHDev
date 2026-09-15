# ISRC Finder — discografia per artista

Strumento standalone che recupera gli **ISRC** della discografia di un artista da
**MusicBrainz**, **Spotify** e **Discogs**, unisce i risultati (dedup per ISRC/titolo)
ed esporta in **CSV**/JSON.

## Come funziona (architettura)

| Fonte | Dove gira | Chiave richiesta | Fornisce ISRC |
|-------|-----------|------------------|:-------------:|
| **MusicBrainz** | direttamente nel browser (CORS libero) | nessuna | ✅ |
| **Spotify** | edge function `api/discography.js` | Client ID + Secret | ✅ |
| **Discogs** | edge function `api/discography.js` | Token | ❌ (solo tracklist/metadati) |

MusicBrainz è la fonte principale e **funziona subito ovunque**, anche su GitHub Pages,
senza configurazione. Spotify e Discogs richiedono la edge function, quindi il deploy su
**Vercel** (dove esiste `/api/*`). Il token Spotify usa il flusso *client credentials*, che
non può girare nel browser (CORS): per questo passa dalla function.

Se la function non è disponibile (es. GitHub Pages), il tool continua a funzionare con la
sola MusicBrainz e mostra un avviso per Spotify/Discogs.

## Uso

1. Apri `index.html`.
2. Scrivi il nome dell'artista e premi **Cerca**.
3. Se ci sono più artisti omonimi su MusicBrainz, scegli quello giusto.
4. Attiva/disattiva le fonti con gli interruttori (Spotify/Discogs vanno configurati, vedi sotto).
5. Filtra, ordina e usa **⬇ CSV**, **⬇ JSON** o **⧉ Copia tutti gli ISRC**.

## Configurare Spotify e Discogs

Le credenziali possono essere fornite in due modi:

### A) Variabili d'ambiente su Vercel (consigliato per la versione pubblica)

Nel progetto Vercel → *Settings → Environment Variables*:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`  (da <https://developer.spotify.com/dashboard>)
- `DISCOGS_TOKEN`  (da <https://www.discogs.com/settings/developers>)

### B) Direttamente nell'interfaccia (uso personale)

Apri **Impostazioni fonti & chiavi API** e incolla le credenziali: restano nel
`localStorage` del tuo browser e vengono inviate solo alla edge function dello stesso
sito, mai scritte nel codice pubblicato.

## Deploy

- **Vercel** (tutte le fonti): root del progetto = questa cartella. `api/discography.js`
  viene servita come edge function su `/api/discography`.
- **GitHub Pages** (solo MusicBrainz): la cartella è pubblicata come sito statico; l'endpoint
  `/api/*` non esiste, quindi restano attive solo le funzioni lato browser.

## Note

- MusicBrainz applica un rate limit (~1 richiesta/secondo): per artisti molto prolifici il
  caricamento può richiedere qualche secondo.
- Discogs non espone gli ISRC: contribuisce con tracklist e metadati (titoli/release) che
  vengono incrociati con le altre fonti; le tracce presenti solo su Discogs compaiono con
  ISRC vuoto, da completare a mano.
- Una registrazione con più ISRC (edizioni per territorio) viene mostrata con gli ISRC
  separati da ` / `.
