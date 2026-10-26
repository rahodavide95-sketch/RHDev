-- ============================================================================
-- Orbita — database su Supabase (Postgres)
-- Incolla TUTTO in Supabase → SQL Editor → Run. Si può rieseguire senza danni.
--
-- Modello di sicurezza (Row Level Security ovunque):
--   • ogni viaggio appartiene a un account (owner_id) e solo lui lo vede;
--   • un viaggio condiviso è visibile a chi entra con l'EMAIL invitata, solo se
--     quell'email è verificata; "editor" può modificarlo, "viewer" solo vederlo;
--   • solo il proprietario elimina il viaggio e gestisce gli inviti;
--   • se l'account ha la verifica in due passaggi, senza il codice (aal2) il
--     database non restituisce nulla, neanche con una sessione valida;
--   • gli utenti anonimi non hanno alcun accesso alle tabelle.
--
--   1. funzioni di supporto     4. orb_trip_shares (inviti)
--   2. orb_profiles             5. eliminazione dell'account
--   3. orb_trips                6. permessi
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Funzioni di supporto (security definer: leggono auth.* senza esporlo)
-- ---------------------------------------------------------------------------
-- email dell'utente collegato, solo se verificata
create or replace function public.orb_my_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

-- vero se la sessione rispetta la verifica in due passaggi (quando attivata)
create or replace function public.orb_aal_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;

-- ---------------------------------------------------------------------------
-- 2. Profilo (nome, casa, paesi segnati, preferenze)
-- ---------------------------------------------------------------------------
create table if not exists public.orb_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  data         jsonb not null default '{}'::jsonb
               check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.orb_profiles enable row level security;

drop policy if exists orb_profiles_own on public.orb_profiles;
create policy orb_profiles_own on public.orb_profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists orb_profiles_mfa on public.orb_profiles;
create policy orb_profiles_mfa on public.orb_profiles as restrictive for all to authenticated
  using (public.orb_aal_ok()) with check (public.orb_aal_ok());

create or replace function public.orb_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists orb_profiles_touch on public.orb_profiles;
create trigger orb_profiles_touch before update on public.orb_profiles
  for each row execute function public.orb_touch();

-- ---------------------------------------------------------------------------
-- 3. Viaggi
--    id generato dal dispositivo (UUID casuale), così si lavora anche offline.
-- ---------------------------------------------------------------------------
create table if not exists public.orb_trips (
  id         text primary key check (id ~ '^[A-Za-z0-9-]{6,64}$'),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  start_date date,
  end_date   date,
  data       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint orb_trips_dates check (start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists orb_trips_owner_idx on public.orb_trips (owner_id);
alter table public.orb_trips enable row level security;

-- Regole che le policy da sole non esprimono: proprietario e id immutabili,
-- date di modifica decise dal server, tetto di viaggi per account.
create or replace function public.orb_trips_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.orb_trips t where t.owner_id = new.owner_id) >= 3000 then
      raise exception 'limite di viaggi raggiunto' using errcode = 'P0001';
    end if;
    new.created_at := now();
  else
    if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
      raise exception 'proprietario e id non si possono cambiare' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;
drop trigger if exists orb_trips_guard on public.orb_trips;
create trigger orb_trips_guard before insert or update on public.orb_trips
  for each row execute function public.orb_trips_guard();

-- ---------------------------------------------------------------------------
-- 4. Inviti: chi può vedere (viewer) o modificare (editor) un viaggio
-- ---------------------------------------------------------------------------
create table if not exists public.orb_trip_shares (
  trip_id      text not null references public.orb_trips(id) on delete cascade,
  email        text not null check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role         text not null default 'viewer' check (role in ('viewer', 'editor')),
  invited_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  inviter_name text not null default '' check (char_length(inviter_name) <= 80),
  created_at   timestamptz not null default now(),
  primary key (trip_id, email)
);
create index if not exists orb_trip_shares_email_idx on public.orb_trip_shares (email);
alter table public.orb_trip_shares enable row level security;

-- (le regole dei viaggi stanno qui perché usano anche la tabella degli inviti)
-- ruolo dell'utente collegato su un viaggio: owner | editor | viewer | null
create or replace function public.orb_trip_role(p_trip text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from public.orb_trips t where t.id = p_trip and t.owner_id = auth.uid()) then 'owner'
    else (select s.role from public.orb_trip_shares s
          where s.trip_id = p_trip and s.email = public.orb_my_email() limit 1)
  end;
$$;

drop policy if exists orb_trips_select on public.orb_trips;
create policy orb_trips_select on public.orb_trips for select to authenticated
  using (owner_id = (select auth.uid()) or public.orb_trip_role(id) in ('viewer', 'editor'));
drop policy if exists orb_trips_insert on public.orb_trips;
create policy orb_trips_insert on public.orb_trips for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists orb_trips_update on public.orb_trips;
create policy orb_trips_update on public.orb_trips for update to authenticated
  using (owner_id = (select auth.uid()) or public.orb_trip_role(id) = 'editor')
  with check (owner_id = (select auth.uid()) or public.orb_trip_role(id) = 'editor');
drop policy if exists orb_trips_delete on public.orb_trips;
create policy orb_trips_delete on public.orb_trips for delete to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists orb_trips_mfa on public.orb_trips;
create policy orb_trips_mfa on public.orb_trips as restrictive for all to authenticated
  using (public.orb_aal_ok()) with check (public.orb_aal_ok());


create or replace function public.orb_is_trip_owner(p_trip text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orb_trips t where t.id = p_trip and t.owner_id = auth.uid());
$$;

drop policy if exists orb_shares_select on public.orb_trip_shares;
create policy orb_shares_select on public.orb_trip_shares for select to authenticated
  using (public.orb_is_trip_owner(trip_id) or email = public.orb_my_email());
drop policy if exists orb_shares_insert on public.orb_trip_shares;
create policy orb_shares_insert on public.orb_trip_shares for insert to authenticated
  with check (public.orb_is_trip_owner(trip_id) and invited_by = (select auth.uid())
              and email is distinct from public.orb_my_email());
drop policy if exists orb_shares_update on public.orb_trip_shares;
create policy orb_shares_update on public.orb_trip_shares for update to authenticated
  using (public.orb_is_trip_owner(trip_id))
  with check (public.orb_is_trip_owner(trip_id) and email is distinct from public.orb_my_email());
drop policy if exists orb_shares_delete on public.orb_trip_shares;
-- il proprietario revoca; l'invitato può uscire dal viaggio
create policy orb_shares_delete on public.orb_trip_shares for delete to authenticated
  using (public.orb_is_trip_owner(trip_id) or email = public.orb_my_email());
drop policy if exists orb_shares_mfa on public.orb_trip_shares;
create policy orb_shares_mfa on public.orb_trip_shares as restrictive for all to authenticated
  using (public.orb_aal_ok()) with check (public.orb_aal_ok());

-- email in minuscolo, mittente deciso dal server, limiti anti-abuso
create or replace function public.orb_shares_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' then
    new.invited_by := auth.uid();
    new.created_at := now();
    if (select count(*) from public.orb_trip_shares s where s.trip_id = new.trip_id) >= 25 then
      raise exception 'limite di 25 persone per viaggio' using errcode = 'P0001';
    end if;
    if (select count(*) from public.orb_trip_shares s
        where s.invited_by = auth.uid() and s.created_at > now() - interval '1 day') >= 50 then
      raise exception 'limite di inviti giornalieri raggiunto, riprova domani' using errcode = 'P0001';
    end if;
  else
    new.trip_id := old.trip_id;
    new.invited_by := old.invited_by;
    new.created_at := old.created_at;
  end if;
  return new;
end; $$;
drop trigger if exists orb_shares_guard on public.orb_trip_shares;
create trigger orb_shares_guard before insert or update on public.orb_trip_shares
  for each row execute function public.orb_shares_guard();

-- ---------------------------------------------------------------------------
-- 5. Eliminazione dell'account (diritto all'oblio): cancella l'utente e, a
--    cascata, profilo, viaggi e inviti fatti. Richiede il codice se c'è la 2FA.
-- ---------------------------------------------------------------------------
create or replace function public.orb_delete_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'accesso richiesto' using errcode = '42501';
  end if;
  if not public.orb_aal_ok() then
    raise exception 'serve la verifica in due passaggi' using errcode = '42501';
  end if;
  delete from public.orb_trip_shares where email = public.orb_my_email();
  delete from auth.users where id = auth.uid();
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Permessi: nessun accesso agli anonimi, funzioni interne non esposte
-- ---------------------------------------------------------------------------
revoke all on table public.orb_profiles, public.orb_trips, public.orb_trip_shares from anon;
grant select, insert, update, delete on table public.orb_profiles, public.orb_trips, public.orb_trip_shares to authenticated;

revoke all on function public.orb_my_email() from public, anon;
revoke all on function public.orb_aal_ok() from public, anon;
revoke all on function public.orb_trip_role(text) from public, anon;
revoke all on function public.orb_is_trip_owner(text) from public, anon;
revoke all on function public.orb_delete_account() from public, anon;
grant execute on function public.orb_my_email() to authenticated;
grant execute on function public.orb_aal_ok() to authenticated;
grant execute on function public.orb_trip_role(text) to authenticated;
grant execute on function public.orb_is_trip_owner(text) to authenticated;
grant execute on function public.orb_delete_account() to authenticated;
revoke all on function public.orb_touch() from public, anon, authenticated;
revoke all on function public.orb_trips_guard() from public, anon, authenticated;
revoke all on function public.orb_shares_guard() from public, anon, authenticated;
