-- ============================================================================
-- Label Finance — Portale artista (link in sola lettura per statement royalty)
-- Esegui UNA VOLTA nel tuo progetto Supabase:
--   Dashboard → SQL Editor → New query → incolla tutto → Run.
-- Poi deploya la Edge Function: supabase functions deploy artist-statement --no-verify-jwt
-- ============================================================================

create table if not exists public.artist_shares (
  token       text primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label_id    text not null,
  artist_name text not null,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.artist_shares enable row level security;

-- Il proprietario (etichetta) gestisce solo i propri link
drop policy if exists artist_shares_owner on public.artist_shares;
create policy artist_shares_owner on public.artist_shares
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Nessuna lettura pubblica diretta: lo statement è calcolato dalla Edge Function
-- (service role) che espone all'artista SOLO le sue righe, mai i dati dell'etichetta.
