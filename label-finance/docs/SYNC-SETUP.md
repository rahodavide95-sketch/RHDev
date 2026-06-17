# Sincronizzazione cloud — Guida di configurazione

Questa guida collega l'app a **Supabase** (gratuito) per vedere gli **stessi dati
su PC e telefono**. La fai **una volta sola**, in ~10 minuti. Non serve scrivere
codice: solo copiare e incollare.

> I dati continuano a funzionare anche offline (restano in locale). Quando sei
> connesso, vengono salvati anche nel cloud e condivisi tra i tuoi dispositivi.

---

## Passo 1 — Crea un progetto Supabase (gratis)

1. Vai su **https://supabase.com** → **Start your project** → registrati (anche con GitHub).
2. **New project**: dai un nome (es. `label-finance`), scegli una password per il
   database (salvala da qualche parte), **Region: Europe** (es. Frankfurt).
3. Attendi ~2 minuti che il progetto sia pronto.

## Passo 2 — Crea la tabella dei dati

1. Nel menu a sinistra: **SQL Editor** → **New query**.
2. Incolla **tutto** questo e premi **Run**:

```sql
create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb,
  updated_at timestamptz default now()
);

alter table public.app_state enable row level security;

create policy "own select" on public.app_state
  for select using (auth.uid() = user_id);
create policy "own insert" on public.app_state
  for insert with check (auth.uid() = user_id);
create policy "own update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

> Cosa fa: crea una tabella dove ogni utente ha **una sola riga** con i propri dati,
> e attiva regole di sicurezza (RLS) per cui **ognuno vede solo i propri** dati.

## Passo 3 — (consigliato) Login senza conferma email

Per accedere subito senza dover confermare l'email ogni volta:

1. Menu **Authentication** → **Sign In / Providers** (o **Providers → Email**).
2. Disattiva **"Confirm email"** e salva.

(Se preferisci lasciarlo attivo, dopo la registrazione riceverai un'email da
confermare prima di poter accedere.)

## Passo 4 — Copia le due chiavi

1. Menu **Project Settings** (ingranaggio) → **API**.
2. Copia:
   - **Project URL** → es. `https://abcd1234.supabase.co`
   - **anon public** key → una stringa lunga che inizia con `eyJ…`

> La chiave **anon** è pubblica per natura: è sicura da incollare nell'app, perché
> i dati sono protetti dalle regole RLS del Passo 2.

## Passo 5 — Configura l'app

1. Apri l'app → **Impostazioni → ☁ Sincronizzazione cloud**.
2. In **"1 · Configura connessione"** incolla **Project URL** e **anon public key**
   → **Salva connessione**.
3. Inserisci **Email** e **Password** (scelte da te) → **Registrati** la prima volta,
   poi **Accedi**.
4. Lo stato diventa **"Sincronizzato ✓"**. Da ora i dati vanno nel cloud.

## Passo 6 — Sul telefono

1. Apri lo **stesso link** dell'app sul telefono.
2. **Impostazioni → Sincronizzazione cloud** → incolla gli **stessi** URL e chiave →
   **Salva connessione** → **Accedi** con la stessa email/password.
3. Vedrai gli stessi dati del PC. 🎉

---

## Come funziona / cosa sapere

- **Offline-first**: l'app funziona anche senza rete; appena torni online e sei
  connesso, risincronizza.
- **Ultimo salvataggio vince**: se modifichi sullo stesso conto da due dispositivi
  nello stesso momento, l'ultimo salvataggio sovrascrive. All'apertura di un
  dispositivo viene scaricata prima la versione dal cloud (pulsante **"Aggiorna ora"**
  per forzare).
- **Backup**: l'export `.json` resta sempre disponibile come copia di sicurezza.
- **Privacy**: i dati stanno nel **tuo** progetto Supabase (server UE), accessibili
  solo dal tuo account. Vedi anche `SICUREZZA-PRIVACY.md`.

## Problemi comuni

| Sintomo | Soluzione |
|---|---|
| "Libreria cloud non caricata" | Sei offline o un blocco rete impedisce il CDN. Riprova online. |
| "Accesso fallito: Email not confirmed" | Conferma l'email ricevuta, **oppure** disattiva "Confirm email" (Passo 3). |
| "Errore lettura/salvataggio" | Controlla di aver eseguito l'SQL del Passo 2 nel progetto giusto. |
| Non vedo i dati sul telefono | Verifica di aver incollato **gli stessi** URL/chiave e fatto **Accedi**. |
