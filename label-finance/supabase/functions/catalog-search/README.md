# catalog-search — import del catalogo per nome etichetta

Permette di scrivere il nome dell'etichetta e importare **tutto il catalogo + gli artisti**
da più fonti combinate, con deduplica.

## Fonti
- **MusicBrainz** — sempre attiva, **nessuna chiave** richiesta.
- **Discogs** — attiva se imposti `DISCOGS_TOKEN` (token personale gratuito).
- **Spotify** — attiva se imposti `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`.

Più chiavi imposti, maggiore è la copertura. Senza chiavi funziona comunque (solo MusicBrainz).

## Deploy (una volta)
```bash
supabase functions deploy catalog-search --no-verify-jwt
```

## Segreti (facoltativi, per più copertura)
Dashboard Supabase → Edge Functions → Secrets, oppure:
```bash
supabase secrets set DISCOGS_TOKEN=xxxxx
supabase secrets set SPOTIFY_CLIENT_ID=xxxxx SPOTIFY_CLIENT_SECRET=xxxxx
```

### Dove prendere le chiavi (gratis)
- **Discogs token:** discogs.com → Settings → Developers → *Generate new token*.
- **Spotify client id/secret:** developer.spotify.com/dashboard → *Create app* (basta il flusso Client Credentials).

I segreti restano **solo sul server** (Edge Function): non vengono mai esposti al browser.
