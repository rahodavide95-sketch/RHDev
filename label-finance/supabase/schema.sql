-- ============================================================================
-- Label Finance — Schema completo del database (Supabase)
--
-- Esegui TUTTO questo file nel progetto Supabase:
--   Dashboard → SQL Editor → New query → incolla → Run.
-- È sicuro rieseguirlo: crea solo ciò che manca e aggiorna funzioni e regole.
-- Sostituisce i vecchi approval.sql, contracts.sql, artist-portal.sql e
-- subscriptions.sql (restano solo come rimando a questo file).
--
-- Cosa contiene:
--   1. app_state      dati dell'app (una riga per utente) + sync tra dispositivi
--   2. profiles       registrazione con approvazione (controllata dal database)
--   3. contracts      firma remota dei contratti (firma validata dal server,
--                     contratti firmati non più modificabili)
--   4. artist_shares  link del portale artista
--   5. subscriptions  abbonamenti Stripe (scritti solo dal webhook)
--   6. ai_usage       limite giornaliero dell'assistente AI
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. app_state — dati dell'app, una riga per utente
-- ---------------------------------------------------------------------------
create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb,
  updated_at timestamptz default now()
);
alter table public.app_state enable row level security;

-- ---------------------------------------------------------------------------
-- 2. profiles — registrazione con approvazione del titolare
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);
-- Nessuna policy di scrittura: il flag "approved" lo cambia solo il titolare
-- dal pannello Supabase. L'utente non può auto-approvarsi.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, approved)
  values (new.id, new.email, false)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Chi usava già l'app prima di questo script resta approvato.
-- (Chi ha già una riga "in attesa" resta in attesa.)
insert into public.profiles(id, email, approved)
select id, email, true from auth.users
on conflict (id) do nothing;

-- Vero se l'utente è approvato (o non ha una riga: account del titolare creato
-- prima del sistema di approvazione). Usata dalle regole qui sotto.
create or replace function public.lf_is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), true);
$$;

-- Regole di app_state: ognuno vede e modifica SOLO i propri dati, e solo se approvato.
drop policy if exists "own select" on public.app_state;
drop policy if exists "own insert" on public.app_state;
drop policy if exists "own update" on public.app_state;
drop policy if exists app_state_select on public.app_state;
drop policy if exists app_state_insert on public.app_state;
drop policy if exists app_state_update on public.app_state;
create policy app_state_select on public.app_state
  for select using (auth.uid() = user_id and public.lf_is_approved());
create policy app_state_insert on public.app_state
  for insert with check (auth.uid() = user_id and public.lf_is_approved());
create policy app_state_update on public.app_state
  for update using (auth.uid() = user_id and public.lf_is_approved())
  with check (auth.uid() = user_id and public.lf_is_approved());

-- Per APPROVARE un tester:
--   update public.profiles set approved = true where email = 'tester@email.com';
-- Per APRIRE le registrazioni a tutti (al lancio), esegui entrambe le righe e
-- metti requireApproval: false in config.js:
--   alter table public.profiles alter column approved set default true;
--   update public.profiles set approved = true;

-- ---------------------------------------------------------------------------
-- 3. contracts — firma remota
-- ---------------------------------------------------------------------------
create table if not exists public.contracts (
  token         text primary key,
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label         text,
  artist_email  text,
  data          jsonb not null,
  status        text not null default 'sent',   -- sent | signed | rejected
  signature     jsonb,
  reject_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.contracts add column if not exists signed_at   timestamptz;
alter table public.contracts add column if not exists signed_hash text;   -- impronta SHA-256 dei termini firmati
alter table public.contracts enable row level security;

drop policy if exists contracts_owner on public.contracts;
create policy contracts_owner on public.contracts
  for all using (auth.uid() = owner_id and public.lf_is_approved())
  with check (auth.uid() = owner_id and public.lf_is_approved());

-- Protezione: un contratto firmato non si può più modificare, e solo la funzione
-- di firma (sign_contract) può segnarlo come firmato. L'etichetta può comunque
-- eliminarlo.
create or replace function public.contracts_guard()
returns trigger language plpgsql as $$
declare signing boolean := coalesce(current_setting('lf.signing', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not signing and (new.status = 'signed' or new.signature is not null or new.signed_at is not null) then
      raise exception 'contract_signature_forbidden' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'signed' then
    if new.data is distinct from old.data or new.signature is distinct from old.signature
       or new.status is distinct from old.status or new.token is distinct from old.token
       or new.signed_at is distinct from old.signed_at or new.signed_hash is distinct from old.signed_hash then
      raise exception 'contract_signed_locked' using errcode = 'check_violation';
    end if;
  elsif not signing and (new.status = 'signed'
        or (new.signature is not null and new.signature is distinct from old.signature)
        or new.signed_at is distinct from old.signed_at) then
    raise exception 'contract_signature_forbidden' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
drop trigger if exists contracts_guard on public.contracts;
create trigger contracts_guard before insert or update on public.contracts
  for each row execute function public.contracts_guard();

-- Lettura pubblica per la pagina di firma (solo per token, solo i campi utili)
drop function if exists public.get_contract_for_signing(text);
create function public.get_contract_for_signing(p_token text)
returns table(label text, data jsonb, status text, signature jsonb, reject_reason text, signed_at timestamptz)
language sql security definer set search_path = public as $$
  select label, data, status, signature, reject_reason, signed_at
  from public.contracts where token = p_token;
$$;

-- Firma dell'artista. La firma viene ricostruita lato server con soli campi
-- ammessi: immagine PNG in base64 (max ~300 KB), nome e luogo (max 120 caratteri),
-- data e ora decise dal server. Firmabile solo se in attesa ("sent").
create or replace function public.sign_contract(p_token text, p_signature jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  st  text;
  img text := coalesce(p_signature->>'dataUrl', '');
  ts  timestamptz := now();
  sig jsonb;
begin
  select status into st from public.contracts where token = p_token;
  if st is null then return 'not_found'; end if;
  if st = 'signed' then return 'already'; end if;
  if st <> 'sent' then return 'not_signable'; end if;
  if length(img) > 300000 or img !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then
    return 'invalid_signature';
  end if;
  sig := jsonb_build_object(
    'dataUrl', img,
    'name',  left(coalesce(p_signature->>'name',  ''), 120),
    'place', left(coalesce(p_signature->>'place', ''), 120),
    'date',  to_char(ts at time zone 'Europe/Rome', 'YYYY-MM-DD'),
    'time',  to_char(ts at time zone 'Europe/Rome', 'HH24:MI'),
    'signedAt', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  perform set_config('lf.signing', 'on', true);
  update public.contracts
     set status = 'signed', signature = sig, reject_reason = null, signed_at = ts,
         signed_hash = encode(sha256(convert_to(data::text, 'UTF8')), 'hex'), updated_at = ts
   where token = p_token;
  perform set_config('lf.signing', 'off', true);
  return 'ok';
end; $$;

-- Rifiuto (richiesta di un accordo diverso). Solo se il contratto è in attesa.
create or replace function public.reject_contract(p_token text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.contracts where token = p_token;
  if st is null then return 'not_found'; end if;
  if st = 'signed' then return 'already'; end if;
  if st <> 'sent' then return 'not_signable'; end if;
  update public.contracts
     set status = 'rejected', reject_reason = left(coalesce(p_reason, ''), 2000), updated_at = now()
   where token = p_token;
  return 'ok';
end; $$;

grant execute on function public.get_contract_for_signing(text) to anon, authenticated;
grant execute on function public.sign_contract(text, jsonb)     to anon, authenticated;
grant execute on function public.reject_contract(text, text)    to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. artist_shares — portale artista (statement in sola lettura)
-- ---------------------------------------------------------------------------
create table if not exists public.artist_shares (
  token       text primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label_id    text not null,
  artist_name text not null,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.artist_shares enable row level security;
drop policy if exists artist_shares_owner on public.artist_shares;
create policy artist_shares_owner on public.artist_shares
  for all using (auth.uid() = owner_id and public.lf_is_approved())
  with check (auth.uid() = owner_id and public.lf_is_approved());
-- Nessuna lettura pubblica: lo statement lo calcola la Edge Function artist-statement.

-- ---------------------------------------------------------------------------
-- 5. subscriptions — abbonamenti (scritti SOLO dal webhook Stripe)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  plan                   text not null default 'free',     -- free | biglabel | studio | agency
  status                 text not null default 'inactive',  -- active | trialing | past_due | canceled | inactive
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions
  for select using (auth.uid() = user_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

-- ---------------------------------------------------------------------------
-- 6. ai_usage — richieste all'assistente AI per utente e giorno
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
-- Nessuna policy: la scrive e legge solo la Edge Function ai-advisor (service role).

-- ---------------------------------------------------------------------------
-- Aggiornamenti in tempo reale (contratti firmati, dati da altri dispositivi)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contracts') then
      alter publication supabase_realtime add table public.contracts;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state') then
      alter publication supabase_realtime add table public.app_state;
    end if;
  end if;
end $$;
