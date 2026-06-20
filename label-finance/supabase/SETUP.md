# Setup operatore — Label Finance (una volta sola, vale per tutti gli utenti)

Progetto Supabase condiviso: **ztjlqorvnulgfvbtvavm**

---

## 1) Ricerca catalogo per nome etichetta (Edge Function `catalog-search`)

### A. Installa e collega la CLI (solo la prima volta)
```bash
npm install -g supabase
supabase login                     # apre il browser per autorizzare
supabase link --project-ref ztjlqorvnulgfvbtvavm
```

### B. Deploya la funzione (dalla cartella del progetto, dove c'è /supabase)
```bash
supabase functions deploy catalog-search --no-verify-jwt
```
Fatto: la ricerca funziona già con **MusicBrainz** (gratis, senza chiavi).

> In alternativa senza CLI: Dashboard → Edge Functions → Create function →
> nome `catalog-search` → incolla il contenuto di
> `supabase/functions/catalog-search/index.ts` → Deploy. Poi disattiva
> "Verify JWT" nelle impostazioni della funzione.

---

## 2) (Facoltativo, più copertura) Token Discogs
1. Vai su https://www.discogs.com/settings/developers
2. **Generate new token** → copia il token.
3. Impostalo come secret:
```bash
supabase secrets set DISCOGS_TOKEN=ILTUOTOKEN
```

## 3) (Facoltativo, più copertura) App Spotify
1. Vai su https://developer.spotify.com/dashboard → **Create app**
   (Redirect URI qualsiasi, es. `https://localhost` — non serve, usiamo Client Credentials).
2. Copia **Client ID** e **Client Secret**.
3. Impostali come secret:
```bash
supabase secrets set SPOTIFY_CLIENT_ID=xxxx SPOTIFY_CLIENT_SECRET=yyyy
```

> I secret restano solo sul server. Dopo averli impostati, ridai un
> `supabase functions deploy catalog-search --no-verify-jwt` se la funzione era
> già attiva (per ricaricare l'ambiente).

---

## 4) Verifica
Apri l'app → **Discografia → ⤒ Importa catalogo → Cerca la tua etichetta**,
scrivi un nome noto (es. *Anjunabeats*) → devono comparire i candidati e,
importando, le release + artisti.

## Promemoria altri setup già fatti
- **Firma contratti:** esegui una volta `supabase/contracts.sql` nel SQL Editor.
- **Assistente AI:** Edge Function `ai-advisor` con la chiave Anthropic come secret.
