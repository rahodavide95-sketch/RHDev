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
--   7. team_members   accesso team (sola lettura / modifica) ai dati del titolare
--   8. app_state_versions  versioni salvate dei dati (ripristino, ultimi 30 giorni)
--   9. receipts       allegati delle spese (Storage, cartella privata per account)
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

-- ---------------------------------------------------------------------------
-- 7. team_members — accesso team ai dati del titolare (piano Agency)
--    Il titolare invita un'email come "viewer" (sola lettura) o "editor" (modifica).
--    Chi accede con quell'email (verificata) vede l'etichetta del titolare.
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  owner_id    uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  role        text not null default 'viewer' check (role in ('viewer','editor')),
  owner_email text,
  owner_label text,
  created_at  timestamptz not null default now(),
  primary key (owner_id, email)
);
alter table public.team_members enable row level security;
create or replace function public.team_members_norm()
returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end; $$;
drop trigger if exists team_members_norm on public.team_members;
create trigger team_members_norm before insert or update on public.team_members
  for each row execute function public.team_members_norm();

-- email dell'utente collegato, solo se confermata (niente accessi con email non verificate)
create or replace function public.lf_my_email()
returns text language sql stable security definer set search_path = public, auth as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null;
$$;
-- ruolo dell'utente collegato nei dati del titolare p_owner: owner | editor | viewer | null
create or replace function public.lf_role(p_owner uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_owner is null then null
    when auth.uid() = p_owner then 'owner'
    else (select t.role from public.team_members t
           where t.owner_id = p_owner and t.email = public.lf_my_email() limit 1)
  end;
$$;
-- come sopra, ma da testo (es. nome della cartella in Storage); null se non è un id valido
create or replace function public.lf_role_txt(p_owner text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return public.lf_role(p_owner::uuid);
exception when others then
  return null;
end; $$;

drop policy if exists team_owner_all on public.team_members;
create policy team_owner_all on public.team_members
  for all using (auth.uid() = owner_id and public.lf_is_approved())
  with check (auth.uid() = owner_id and public.lf_is_approved());
drop policy if exists team_member_read on public.team_members;
create policy team_member_read on public.team_members
  for select using (email = public.lf_my_email());

-- Regole di app_state: il titolare vede e modifica i propri dati; i membri del team
-- li vedono (viewer) o li modificano (editor). Sempre solo se approvati.
drop policy if exists "own select" on public.app_state;
drop policy if exists "own insert" on public.app_state;
drop policy if exists "own update" on public.app_state;
drop policy if exists app_state_select on public.app_state;
drop policy if exists app_state_insert on public.app_state;
drop policy if exists app_state_update on public.app_state;
create policy app_state_select on public.app_state
  for select using (public.lf_role(user_id) is not null and public.lf_is_approved());
create policy app_state_insert on public.app_state
  for insert with check (auth.uid() = user_id and public.lf_is_approved());
create policy app_state_update on public.app_state
  for update using (public.lf_role(user_id) in ('owner','editor') and public.lf_is_approved())
  with check (public.lf_role(user_id) in ('owner','editor') and public.lf_is_approved());

-- ---------------------------------------------------------------------------
-- 8. app_state_versions — versioni salvate (rete di sicurezza)
--    Prima di ogni modifica il database conserva la versione precedente, al
--    massimo una all'ora; si tengono le ultime 30 e solo per 30 giorni.
-- ---------------------------------------------------------------------------
create table if not exists public.app_state_versions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  reason     text not null default 'auto',
  created_at timestamptz not null default now()
);
create index if not exists app_state_versions_user_idx on public.app_state_versions (user_id, created_at desc);
alter table public.app_state_versions enable row level security;
drop policy if exists versions_read on public.app_state_versions;
create policy versions_read on public.app_state_versions
  for select using (public.lf_role(user_id) is not null and public.lf_is_approved());
-- Nessuna scrittura diretta: le versioni le crea solo il database.

create or replace function public.lf_prune_versions(p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.app_state_versions v
   where v.user_id = p_user
     and (v.created_at < now() - interval '30 days'
          or v.id not in (select id from public.app_state_versions
                           where user_id = p_user order by created_at desc limit 30));
$$;
create or replace function public.lf_version_app_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.data is not null and old.data is distinct from new.data
     and not exists (select 1 from public.app_state_versions v
                      where v.user_id = old.user_id and v.created_at > now() - interval '1 hour') then
    insert into public.app_state_versions(user_id, data, reason) values (old.user_id, old.data, 'auto');
    perform public.lf_prune_versions(old.user_id);
  end if;
  return new;
end; $$;
drop trigger if exists app_state_versioning on public.app_state;
create trigger app_state_versioning before update on public.app_state
  for each row execute function public.lf_version_app_state();

-- Copia "adesso" prima di un'operazione pericolosa (cancella tutto, ripristino):
-- solo titolare o editor del team.
create or replace function public.lf_snapshot_now(p_owner uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(p_owner, auth.uid()); d jsonb;
begin
  if coalesce(public.lf_role(o), '') not in ('owner','editor') or not public.lf_is_approved() then
    return 'forbidden';
  end if;
  select data into d from public.app_state where user_id = o;
  if d is null then return 'empty'; end if;
  if exists (select 1 from public.app_state_versions
              where user_id = o and reason = 'manual' and created_at > now() - interval '2 minutes') then
    return 'recent';
  end if;
  insert into public.app_state_versions(user_id, data, reason) values (o, d, 'manual');
  perform public.lf_prune_versions(o);
  return 'ok';
end; $$;
grant execute on function public.lf_snapshot_now(uuid) to authenticated;

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
drop policy if exists contracts_read on public.contracts;
drop policy if exists contracts_ins  on public.contracts;
drop policy if exists contracts_upd  on public.contracts;
drop policy if exists contracts_del  on public.contracts;
create policy contracts_read on public.contracts
  for select using (public.lf_role(owner_id) is not null and public.lf_is_approved());
create policy contracts_ins on public.contracts
  for insert with check (public.lf_role(owner_id) in ('owner','editor') and public.lf_is_approved());
create policy contracts_upd on public.contracts
  for update using (public.lf_role(owner_id) in ('owner','editor') and public.lf_is_approved())
  with check (public.lf_role(owner_id) in ('owner','editor') and public.lf_is_approved());
create policy contracts_del on public.contracts
  for delete using (public.lf_role(owner_id) in ('owner','editor') and public.lf_is_approved());

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
drop policy if exists artist_shares_read  on public.artist_shares;
drop policy if exists artist_shares_write on public.artist_shares;
create policy artist_shares_read on public.artist_shares
  for select using (public.lf_role(owner_id) is not null and public.lf_is_approved());
create policy artist_shares_write on public.artist_shares
  for all using (public.lf_role(owner_id) in ('owner','editor') and public.lf_is_approved())
  with check (public.lf_role(owner_id) in ('owner','editor') and public.lf_is_approved());
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

-- ---------------------------------------------------------------------------
-- 9. receipts — allegati delle spese (Supabase Storage, bucket privato)
--    Ogni account ha la sua cartella: receipts/<id titolare>/…
--    Il team del titolare li vede; titolare ed editor li caricano ed eliminano.
--    (Se questa parte desse errore, il resto dello schema è già a posto.)
-- ---------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('receipts', 'receipts', false, 10485760)
  on conflict (id) do nothing;

  execute 'drop policy if exists receipts_read on storage.objects';
  execute 'drop policy if exists receipts_ins on storage.objects';
  execute 'drop policy if exists receipts_upd on storage.objects';
  execute 'drop policy if exists receipts_del on storage.objects';
  execute $p$create policy receipts_read on storage.objects for select
    using (bucket_id = 'receipts' and public.lf_role_txt((storage.foldername(name))[1]) is not null and public.lf_is_approved())$p$;
  execute $p$create policy receipts_ins on storage.objects for insert
    with check (bucket_id = 'receipts' and public.lf_role_txt((storage.foldername(name))[1]) in ('owner','editor') and public.lf_is_approved())$p$;
  execute $p$create policy receipts_upd on storage.objects for update
    using (bucket_id = 'receipts' and public.lf_role_txt((storage.foldername(name))[1]) in ('owner','editor') and public.lf_is_approved())$p$;
  execute $p$create policy receipts_del on storage.objects for delete
    using (bucket_id = 'receipts' and public.lf_role_txt((storage.foldername(name))[1]) in ('owner','editor') and public.lf_is_approved())$p$;
exception when others then
  raise notice 'Allegati (Storage) non configurati: %', sqlerrm;
end $$;
