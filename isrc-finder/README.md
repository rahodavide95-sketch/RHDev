# ISRC Finder — discografia e tracce

Strumento standalone, **automatico**, per recuperare **ISRC e metadati** con
suggerimenti live e immagini.

- **Modalità Artista** → tutta la discografia con ISRC, esportabile in CSV/JSON.
- **Modalità Traccia** → una singola traccia con **tutte le info**: ISRC, UPC,
  album, etichetta, data, durata, popolarità, generi, n. traccia/disco, mercati,
  link Spotify, anteprima audio.
- **Suggerimenti mentre scrivi**, con foto profilo (artisti) o copertina (tracce).

## Fonte dati

Usa **Spotify** (completa e veloce). I suggerimenti con immagini richiedono Spotify.

Se le chiavi Spotify non sono impostate, lo strumento ripiega su **MusicBrainz**
(solo dati base, niente immagini né suggerimenti), chiamato lato server con lo
User-Agent corretto — dal browser MusicBrainz risponderebbe con errore 503.

## Configurazione (una volta sola)

Nel progetto **Vercel** → *Settings → Environment Variables*:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Le ottieni gratis creando un'app su <https://developer.spotify.com/dashboard>
(non serve alcun redirect URI: si usa il flusso *Client Credentials*).
Dopo aver aggiunto le variabili, fai un **Redeploy**.

## Deploy

- **Vercel** (consigliato): *Root Directory* = `isrc-finder`. La funzione
  `api/discography.js` viene servita come edge function su `/api/discography`.
- Su hosting statico senza server (es. GitHub Pages) la funzione non esiste,
  quindi lo strumento non è operativo: serve Vercel.

## Note

- L'artista/traccia viene scelto in automatico (miglior corrispondenza); se
  selezioni un suggerimento, viene usato l'**ID esatto** di Spotify.
- Nella discografia si tengono solo le tracce effettivamente accreditate
  all'artista (le compilation di altri vengono filtrate).
