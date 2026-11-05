-- ============================================================================
-- Label Form — il modulo dell'etichetta per gli artisti (cartella label-form/)
--
-- Sta nel progetto Supabase "label-form", tutto suo: nessun'altra app ci mette account o tabelle.
-- Si può rieseguire senza problemi (lo applica il workflow .github/workflows/label-form.yml).
--
-- Regole di sicurezza
--   • L'etichetta (una sola persona, il "proprietario") vede e gestisce tutto, ma SOLO con la
--     verifica in due passaggi completata (aal2). Senza il codice il database non risponde.
--   • Gli artisti non hanno account: arrivano con un link segreto (256 bit). Nel database c'è solo
--     l'impronta SHA-256 del link, mai il link. Possono usare solo le funzioni labelform_open,
--     labelform_unlock, labelform_submit, labelform_update; nessun accesso diretto alle tabelle.
--   • Il link da solo serve a INVIARE. Per rivedere o modificare serve anche la password scelta
--     dall'artista (il server ne conosce solo un'impronta) e i tentativi sbagliati sono limitati.
--   • I dati degli artisti arrivano già cifrati dal browser: qui c'è solo testo illeggibile.
--   • Il contratto, una volta firmato, non si può più cambiare: lo impedisce il database stesso.
--   • L'etichetta non può riscrivere i dati inviati da un artista (permessi per colonna).
-- ============================================================================

-- ─── Proprietario ───────────────────────────────────────────────────────────
create table if not exists public.labelform_owner (
  id boolean primary key default true check (id),
  user_id uuid unique references auth.users(id) on delete set null,
  email text check (email is null or (length(email) <= 254 and email = lower(email))),
  created_at timestamptz not null default now()
);
alter table public.labelform_owner enable row level security;
revoke all on public.labelform_owner from anon, authenticated;

create or replace function public.labelform_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
     and auth.uid() is not null
     and exists (select 1 from public.labelform_owner where user_id = auth.uid());
$$;

-- Stato per la pagina dell'etichetta (chi sono, serve la 2FA, si può ancora reclamare?)
create or replace function public.labelform_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.labelform_owner; me text;
begin
  select * into o from public.labelform_owner where id;
  select lower(email) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  return jsonb_build_object(
    'owner', o.user_id is not null and o.user_id = auth.uid(),
    'claimed', o.user_id is not null,
    'aal2', coalesce((auth.jwt() ->> 'aal') = 'aal2', false),
    'email_ok', me is not null,
    'can_claim', o.user_id is null and me is not null and (o.email is null or o.email = me)
  );
end $$;

-- Codice di attivazione: solo chi lo conosce può diventare proprietario. Qui c'è solo la sua impronta
-- SHA-256 (100 bit casuali: non si ricava dall'impronta); il codice lo ha solo l'etichetta.
create table if not exists public.labelform_activation (
  id boolean primary key default true check (id),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz
);
alter table public.labelform_activation enable row level security;
revoke all on public.labelform_activation from anon, authenticated;
insert into public.labelform_activation (id, code_hash)
  values (true, 'c01588bea84045e37cae45d9c81511849acc7309ae44337e429ecd24c5610b33')
  on conflict (id) do update set code_hash = excluded.code_hash where public.labelform_activation.used_at is null;

-- Diventa proprietario chi ha 2FA, email confermata (in automatico nel progetto di Label Form) e il codice
-- di attivazione. Se il workflow ha fissato l'email (secret LABELFORM_OWNER_EMAIL), serve anche quella.
drop function if exists public.labelform_claim();
create or replace function public.labelform_claim(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.labelform_owner; me text; a public.labelform_activation;
begin
  if auth.uid() is null then return 'not_allowed'; end if;
  if coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2' then return 'need_mfa'; end if;
  select lower(email) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if me is null then return 'need_email'; end if;
  perform pg_advisory_xact_lock(hashtext('labelform_owner'));
  select * into o from public.labelform_owner where id;
  if found and o.user_id = auth.uid() then return 'already'; end if;
  if found and o.user_id is not null then return 'taken'; end if;
  if found and o.email is not null and o.email <> me then return 'not_allowed'; end if;
  select * into a from public.labelform_activation where id;
  if not found or a.code_hash is null
     or encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex') <> a.code_hash then
    return 'bad_code';
  end if;
  insert into public.labelform_owner (id, user_id, email) values (true, auth.uid(), me)
    on conflict (id) do update set user_id = excluded.user_id, email = excluded.email;
  update public.labelform_activation set used_at = now() where id;
  return 'ok';
end $$;

-- Solo per il workflow (ruolo postgres): fissa l'email che potrà reclamare l'area dell'etichetta.
create or replace function public.labelform_pin_owner(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.labelform_owner;
begin
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 254 then return 'invalid'; end if;
  select * into o from public.labelform_owner where id;
  if found and o.user_id is not null then return case when o.email = lower(p_email) then 'claimed' else 'claimed_by_other' end; end if;
  insert into public.labelform_owner (id, email) values (true, lower(p_email)) on conflict (id) do update set email = excluded.email;
  return 'pinned';
end $$;

-- ─── Impostazioni dell'etichetta e chiave pubblica ─────────────────────────
create table if not exists public.labelform_settings (
  id boolean primary key default true check (id),
  label_name text not null default '' check (length(label_name) <= 120),
  notify_email text not null default '' check (length(notify_email) <= 254),
  public_url text not null default '' check (length(public_url) <= 300),
  logo text not null default '' check (length(logo) <= 700000),
  label_signature text not null default '' check (length(label_signature) <= 300000),
  label_signer text not null default '' check (length(label_signer) <= 120),
  label_key jsonb check (label_key is null or (jsonb_typeof(label_key) = 'object' and length(label_key::text) <= 20000 and length(label_key ->> 'pub') between 100 and 4000)),
  updated_at timestamptz not null default now()
);
alter table public.labelform_settings enable row level security;
revoke all on public.labelform_settings from anon, authenticated;
grant select, insert, update on public.labelform_settings to authenticated;
drop policy if exists labelform_settings_owner on public.labelform_settings;
create policy labelform_settings_owner on public.labelform_settings for all to authenticated
  using (public.labelform_is_owner()) with check (public.labelform_is_owner());

-- ─── Moduli ─────────────────────────────────────────────────────────────────
create table if not exists public.labelform_forms (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (length(title) <= 200),
  schema jsonb not null check (jsonb_typeof(schema) = 'object' and pg_column_size(schema) <= 2500000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.labelform_forms enable row level security;
revoke all on public.labelform_forms from anon, authenticated;
grant select, insert, update, delete on public.labelform_forms to authenticated;
drop policy if exists labelform_forms_owner on public.labelform_forms;
create policy labelform_forms_owner on public.labelform_forms for all to authenticated
  using (public.labelform_is_owner()) with check (public.labelform_is_owner());

-- ─── Release ────────────────────────────────────────────────────────────────
create table if not exists public.labelform_releases (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  catalog text not null default '' check (length(catalog) <= 60),
  release_date date,
  notes text not null default '' check (length(notes) <= 5000),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.labelform_releases enable row level security;
revoke all on public.labelform_releases from anon, authenticated;
grant select, insert, update, delete on public.labelform_releases to authenticated;
drop policy if exists labelform_releases_owner on public.labelform_releases;
create policy labelform_releases_owner on public.labelform_releases for all to authenticated
  using (public.labelform_is_owner()) with check (public.labelform_is_owner());

-- ─── Inviti (un artista in una release) e il suo invio cifrato ─────────────
create table if not exists public.labelform_invites (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.labelform_releases(id) on delete cascade,
  form_id uuid not null references public.labelform_forms(id) on delete restrict,
  artist_name text not null check (length(artist_name) between 1 and 120),
  artist_email text not null default '' check (length(artist_email) <= 254),
  artist_pct smallint not null default 50 check (artist_pct between 0 and 100),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_enc text not null check (length(token_enc) between 100 and 1200),
  expires_at timestamptz,
  revoked_at timestamptz,
  opened_at timestamptz,
  submitted_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  -- dati cifrati nel browser dell'artista
  dek_label text check (dek_label is null or (length(dek_label) between 100 and 1200 and dek_label ~ '^[A-Za-z0-9+/]+={0,2}$')),
  dek_artist jsonb check (dek_artist is null or length(dek_artist::text) <= 600),
  pw_salt text check (pw_salt is null or pw_salt ~ '^[A-Za-z0-9+/]{22}==$'),
  pw_iter integer check (pw_iter is null or pw_iter between 100000 and 10000000),
  pw_verifier text check (pw_verifier is null or pw_verifier ~ '^[0-9a-f]{64}$'),
  main_ct jsonb check (main_ct is null or length(main_ct::text) <= 1500000),
  version integer not null default 0,
  filled text[] not null default '{}' check (cardinality(filled) <= 300),
  contract_ct jsonb check (contract_ct is null or length(contract_ct::text) <= 1000000),
  contract_hash text check (contract_hash is null or contract_hash ~ '^[0-9a-f]{64}$'),
  contract_signed_at timestamptz,
  fail_count integer not null default 0,
  fail_since timestamptz,
  copies_day date,
  copies integer not null default 0
);
create index if not exists labelform_invites_release on public.labelform_invites (release_id);
alter table public.labelform_invites enable row level security;
revoke all on public.labelform_invites from anon, authenticated;
grant select, delete on public.labelform_invites to authenticated;
grant insert (release_id, form_id, artist_name, artist_email, artist_pct, token_hash, token_enc, expires_at) on public.labelform_invites to authenticated;
grant update (artist_name, artist_email, artist_pct, token_hash, token_enc, expires_at, revoked_at) on public.labelform_invites to authenticated;
drop policy if exists labelform_invites_owner on public.labelform_invites;
create policy labelform_invites_owner on public.labelform_invites for all to authenticated
  using (public.labelform_is_owner()) with check (public.labelform_is_owner());

-- Contratto firmato = immutabile (vale per tutti, anche per le funzioni del server)
create or replace function public.labelform_invites_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id or new.form_id is distinct from old.form_id
     or new.release_id is distinct from old.release_id or new.created_at is distinct from old.created_at then
    raise exception 'label form: campi non modificabili';
  end if;
  if old.contract_signed_at is not null and (
       new.contract_ct is distinct from old.contract_ct or new.contract_hash is distinct from old.contract_hash
       or new.contract_signed_at is distinct from old.contract_signed_at or new.artist_pct is distinct from old.artist_pct) then
    raise exception 'label form: il contratto è firmato e non si può modificare';
  end if;
  if old.dek_label is not null and new.dek_label is distinct from old.dek_label then
    raise exception 'label form: chiave dei dati non modificabile';
  end if;
  return new;
end $$;
drop trigger if exists labelform_invites_guard on public.labelform_invites;
create trigger labelform_invites_guard before update on public.labelform_invites
  for each row execute function public.labelform_invites_guard();

-- ─── Versioni (storico di ogni invio, per vedere cosa è cambiato) ──────────
create table if not exists public.labelform_versions (
  id bigint generated always as identity primary key,
  invite_id uuid not null references public.labelform_invites(id) on delete cascade,
  version integer not null,
  main_ct jsonb not null,
  contract_ct jsonb,
  filled text[] not null default '{}',
  changed text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (invite_id, version)
);
alter table public.labelform_versions enable row level security;
revoke all on public.labelform_versions from anon, authenticated;
grant select on public.labelform_versions to authenticated;
drop policy if exists labelform_versions_owner on public.labelform_versions;
create policy labelform_versions_owner on public.labelform_versions for select to authenticated using (public.labelform_is_owner());

create or replace function public.labelform_versions_frozen() returns trigger
language plpgsql set search_path = public as $$
begin raise exception 'label form: lo storico non si modifica'; end $$;
drop trigger if exists labelform_versions_frozen on public.labelform_versions;
create trigger labelform_versions_frozen before update on public.labelform_versions
  for each row execute function public.labelform_versions_frozen();

-- ─── Avvisi per l'etichetta ────────────────────────────────────────────────
create table if not exists public.labelform_events (
  id bigint generated always as identity primary key,
  invite_id uuid not null references public.labelform_invites(id) on delete cascade,
  kind text not null check (kind in ('opened', 'submitted', 'updated', 'signed')),
  changed text[] not null default '{}' check (cardinality(changed) <= 300),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  mailed_at timestamptz
);
create index if not exists labelform_events_invite on public.labelform_events (invite_id);
create index if not exists labelform_events_unmailed on public.labelform_events (created_at) where mailed_at is null;
alter table public.labelform_events enable row level security;
revoke all on public.labelform_events from anon, authenticated;
grant select, delete on public.labelform_events to authenticated;
grant update (read_at) on public.labelform_events to authenticated;
drop policy if exists labelform_events_owner on public.labelform_events;
create policy labelform_events_owner on public.labelform_events for all to authenticated
  using (public.labelform_is_owner()) with check (public.labelform_is_owner());

-- ============================================================================
-- Funzioni per gli artisti (senza account, solo con il link)
-- ============================================================================

create or replace function public.labelform_find(p_token text) returns public.labelform_invites
language sql stable security definer set search_path = public as $$
  select i.* from public.labelform_invites i
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- controlli comuni: restituisce un codice d'errore oppure null
create or replace function public.labelform_link_error(i public.labelform_invites) returns text
language sql stable set search_path = public as $$
  select case
    when i.id is null then 'not_found'
    when i.revoked_at is not null then 'revoked'
    when i.expires_at is not null and i.expires_at < now() then 'expired'
    else null end;
$$;

-- forma dei dati cifrati: {iv, ct, z}
create or replace function public.labelform_sealed_ok(s jsonb, max_len integer) returns boolean
language sql immutable set search_path = public as $$
  select s is not null and jsonb_typeof(s) = 'object'
     and coalesce(s ->> 'iv', '') ~ '^[A-Za-z0-9+/]{16}$'
     and coalesce(s ->> 'ct', '') ~ '^[A-Za-z0-9+/]+={0,2}$'
     and length(s ->> 'ct') <= max_len
     and coalesce(s ->> 'z', '0') in ('0', '1')
     and (select count(*) from jsonb_object_keys(s)) <= 3;
$$;

create or replace function public.labelform_ids_ok(a jsonb) returns boolean
language sql immutable set search_path = public as $$
  select a is null or (jsonb_typeof(a) = 'array' and jsonb_array_length(a) <= 300
    and not exists (select 1 from jsonb_array_elements(a) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z][a-z0-9_]{1,39}$'));
$$;
create or replace function public.labelform_ids(a jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(a, '[]'::jsonb))), '{}');
$$;

-- password dell'artista: {salt, iter, verifier, dek:{iv, ct}}
create or replace function public.labelform_pw_ok(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'object'
     and coalesce(p ->> 'salt', '') ~ '^[A-Za-z0-9+/]{22}==$'
     and coalesce(p ->> 'iter', '') ~ '^\d{6,8}$' and (p ->> 'iter')::int between 100000 and 10000000
     and coalesce(p ->> 'verifier', '') ~ '^[A-Za-z0-9+/]{43}=$'
     and jsonb_typeof(p -> 'dek') = 'object'
     and coalesce(p -> 'dek' ->> 'iv', '') ~ '^[A-Za-z0-9+/]{16}$'
     and coalesce(p -> 'dek' ->> 'ct', '') ~ '^[A-Za-z0-9+/]{64}$';
$$;

create or replace function public.labelform_verifier_hash(v text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(decode(v, 'base64')), 'hex');
$$;

-- Controlla la password: 8 errori in 15 minuti bloccano i tentativi per 15 minuti.
-- Restituisce null se va bene, altrimenti un oggetto d'errore. Va chiamata con la riga bloccata (for update).
create or replace function public.labelform_check_pw(i public.labelform_invites, p_verifier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if i.pw_verifier is null then return jsonb_build_object('error', 'no_password'); end if;
  if i.fail_since is not null and i.fail_since > now() - interval '15 minutes' and i.fail_count >= 8 then
    return jsonb_build_object('error', 'locked', 'retry_at', i.fail_since + interval '15 minutes');
  end if;
  if p_verifier is not null and p_verifier ~ '^[A-Za-z0-9+/]{43}=$' and public.labelform_verifier_hash(p_verifier) = i.pw_verifier then
    if i.fail_count <> 0 then update public.labelform_invites set fail_count = 0, fail_since = null where id = i.id; end if;
    return null;
  end if;
  if i.fail_since is null or i.fail_since <= now() - interval '15 minutes' then
    update public.labelform_invites set fail_count = 1, fail_since = now() where id = i.id returning fail_count into n;
  else
    update public.labelform_invites set fail_count = fail_count + 1 where id = i.id returning fail_count into n;
  end if;
  return jsonb_build_object('error', 'wrong_password', 'left', greatest(0, 8 - n));
end $$;

-- Apre il link: cosa serve per mostrare il modulo (nessun dato dell'artista).
create or replace function public.labelform_open(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.labelform_invites; r public.labelform_releases; f public.labelform_forms; s public.labelform_settings; e text;
begin
  i := public.labelform_find(p_token);
  e := public.labelform_link_error(i);
  if e is not null then return jsonb_build_object('error', e); end if;
  select * into s from public.labelform_settings where id;
  if s.label_key is null then return jsonb_build_object('error', 'not_ready'); end if;
  select * into r from public.labelform_releases where id = i.release_id;
  select * into f from public.labelform_forms where id = i.form_id;
  if i.opened_at is null then
    update public.labelform_invites set opened_at = now() where id = i.id;
    insert into public.labelform_events (invite_id, kind) values (i.id, 'opened');
  end if;
  return jsonb_build_object(
    'invite', jsonb_build_object('id', i.id, 'artist', i.artist_name, 'artist_pct', i.artist_pct,
      'version', i.version, 'submitted_at', i.submitted_at, 'updated_at', i.updated_at,
      'has_password', i.pw_verifier is not null, 'pw_salt', i.pw_salt, 'pw_iter', i.pw_iter,
      'contract_signed_at', i.contract_signed_at, 'expires_at', i.expires_at),
    'release', jsonb_build_object('title', r.title, 'catalog', r.catalog, 'release_date', r.release_date, 'closed', r.closed_at is not null),
    'form', f.schema,
    'label', jsonb_build_object('name', s.label_name, 'logo', s.logo, 'signature', s.label_signature,
      'signer', s.label_signer, 'pub', s.label_key ->> 'pub', 'share_with', s.notify_email)
  );
end $$;

-- Con la password: restituisce l'invio cifrato (si apre solo nel browser dell'artista).
create or replace function public.labelform_unlock(p_token text, p_verifier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.labelform_invites; e text; err jsonb;
begin
  i := public.labelform_find(p_token);
  e := public.labelform_link_error(i);
  if e is not null then return jsonb_build_object('error', e); end if;
  select * into i from public.labelform_invites where id = i.id for update;
  err := public.labelform_check_pw(i, p_verifier);
  if err is not null then return err; end if;
  return jsonb_build_object('dek_artist', i.dek_artist, 'main', i.main_ct, 'contract', i.contract_ct,
    'contract_hash', i.contract_hash, 'contract_signed_at', i.contract_signed_at, 'version', i.version);
end $$;

-- Primo invio.
-- p = { dek_label, main:{iv,ct,z}, filled:[…], password?:{salt,iter,verifier,dek}, contract?:{ct:{…}, sign:bool, hash} }
create or replace function public.labelform_submit(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.labelform_invites; e text; closed boolean; signing boolean; now_ timestamptz := now();
begin
  i := public.labelform_find(p_token);
  e := public.labelform_link_error(i);
  if e is not null then return jsonb_build_object('error', e); end if;
  select * into i from public.labelform_invites where id = i.id for update;
  select closed_at is not null into closed from public.labelform_releases where id = i.release_id;
  if closed then return jsonb_build_object('error', 'closed'); end if;
  if i.version > 0 then return jsonb_build_object('error', 'already_submitted'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('error', 'invalid'); end if;
  if coalesce(p ->> 'dek_label', '') !~ '^[A-Za-z0-9+/]+={0,2}$' or length(p ->> 'dek_label') not between 100 and 1200 then return jsonb_build_object('error', 'invalid'); end if;
  if not public.labelform_sealed_ok(p -> 'main', 1400000) then return jsonb_build_object('error', 'invalid'); end if;
  if not public.labelform_ids_ok(p -> 'filled') then return jsonb_build_object('error', 'invalid'); end if;
  if p ? 'password' and p -> 'password' <> 'null'::jsonb and not public.labelform_pw_ok(p -> 'password') then return jsonb_build_object('error', 'invalid'); end if;
  signing := false;
  if p ? 'contract' and p -> 'contract' <> 'null'::jsonb then
    if not public.labelform_sealed_ok(p -> 'contract' -> 'ct', 900000) then return jsonb_build_object('error', 'invalid'); end if;
    signing := coalesce((p -> 'contract' ->> 'sign')::boolean, false);
    if signing and coalesce(p -> 'contract' ->> 'hash', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'invalid'); end if;
  end if;

  update public.labelform_invites set
    dek_label = p ->> 'dek_label',
    dek_artist = case when p -> 'password' ->> 'salt' is not null then p -> 'password' -> 'dek' end,
    pw_salt = p -> 'password' ->> 'salt',
    pw_iter = (p -> 'password' ->> 'iter')::int,
    pw_verifier = case when p -> 'password' ->> 'verifier' is not null then public.labelform_verifier_hash(p -> 'password' ->> 'verifier') end,
    main_ct = p -> 'main',
    filled = public.labelform_ids(p -> 'filled'),
    contract_ct = case when p -> 'contract' -> 'ct' is not null and jsonb_typeof(p -> 'contract' -> 'ct') = 'object' then p -> 'contract' -> 'ct' end,
    contract_hash = case when signing then p -> 'contract' ->> 'hash' end,
    contract_signed_at = case when signing then now_ end,
    version = 1, submitted_at = now_, updated_at = now_
  where id = i.id;
  insert into public.labelform_versions (invite_id, version, main_ct, contract_ct, filled)
    values (i.id, 1, p -> 'main', case when jsonb_typeof(p -> 'contract' -> 'ct') = 'object' then p -> 'contract' -> 'ct' end, public.labelform_ids(p -> 'filled'));
  insert into public.labelform_events (invite_id, kind) values (i.id, 'submitted');
  if signing then insert into public.labelform_events (invite_id, kind) values (i.id, 'signed'); end if;
  return jsonb_build_object('ok', true, 'version', 1, 'submitted_at', now_, 'contract_signed_at', case when signing then now_ end);
end $$;

-- Modifica di un invio (serve la password dell'artista).
-- p = { base_version, main:{…}, filled:[…], changed:[…], contract?:{ct, sign, hash}, password?:{…nuova…} }
create or replace function public.labelform_update(p_token text, p_verifier text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.labelform_invites; e text; err jsonb; closed boolean; signing boolean := false; has_contract boolean := false; v integer; now_ timestamptz := now();
begin
  i := public.labelform_find(p_token);
  e := public.labelform_link_error(i);
  if e is not null then return jsonb_build_object('error', e); end if;
  select * into i from public.labelform_invites where id = i.id for update;
  if i.version = 0 then return jsonb_build_object('error', 'not_submitted'); end if;
  err := public.labelform_check_pw(i, p_verifier);
  if err is not null then return err; end if;
  select closed_at is not null into closed from public.labelform_releases where id = i.release_id;
  if closed then return jsonb_build_object('error', 'closed'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('error', 'invalid'); end if;
  if coalesce(p ->> 'base_version', '') !~ '^\d{1,6}$' or (p ->> 'base_version')::int <> i.version then
    return jsonb_build_object('error', 'conflict', 'version', i.version);
  end if;
  if i.version >= 300 then return jsonb_build_object('error', 'too_many_versions'); end if;
  if not public.labelform_sealed_ok(p -> 'main', 1400000) then return jsonb_build_object('error', 'invalid'); end if;
  if not public.labelform_ids_ok(p -> 'filled') or not public.labelform_ids_ok(p -> 'changed') then return jsonb_build_object('error', 'invalid'); end if;
  if p ? 'password' and p -> 'password' <> 'null'::jsonb and not public.labelform_pw_ok(p -> 'password') then return jsonb_build_object('error', 'invalid'); end if;
  if p ? 'contract' and p -> 'contract' <> 'null'::jsonb then
    if i.contract_signed_at is not null then return jsonb_build_object('error', 'contract_locked'); end if;
    if not public.labelform_sealed_ok(p -> 'contract' -> 'ct', 900000) then return jsonb_build_object('error', 'invalid'); end if;
    has_contract := true;
    signing := coalesce((p -> 'contract' ->> 'sign')::boolean, false);
    if signing and coalesce(p -> 'contract' ->> 'hash', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'invalid'); end if;
  end if;

  v := i.version + 1;
  update public.labelform_invites set
    main_ct = p -> 'main',
    filled = public.labelform_ids(p -> 'filled'),
    contract_ct = case when has_contract then p -> 'contract' -> 'ct' else contract_ct end,
    contract_hash = case when signing then p -> 'contract' ->> 'hash' else contract_hash end,
    contract_signed_at = case when signing then now_ else contract_signed_at end,
    dek_artist = case when p -> 'password' ->> 'salt' is not null then p -> 'password' -> 'dek' else dek_artist end,
    pw_salt = coalesce(p -> 'password' ->> 'salt', pw_salt),
    pw_iter = coalesce((p -> 'password' ->> 'iter')::int, pw_iter),
    pw_verifier = case when p -> 'password' ->> 'verifier' is not null then public.labelform_verifier_hash(p -> 'password' ->> 'verifier') else pw_verifier end,
    version = v, updated_at = now_
  where id = i.id;
  insert into public.labelform_versions (invite_id, version, main_ct, contract_ct, filled, changed)
    values (i.id, v, p -> 'main', case when has_contract then p -> 'contract' -> 'ct' else i.contract_ct end,
            public.labelform_ids(p -> 'filled'), public.labelform_ids(p -> 'changed'));
  if cardinality(public.labelform_ids(p -> 'changed')) > 0 or not signing then
    insert into public.labelform_events (invite_id, kind, changed) values (i.id, 'updated', public.labelform_ids(p -> 'changed'));
  end if;
  if signing then insert into public.labelform_events (invite_id, kind) values (i.id, 'signed'); end if;
  return jsonb_build_object('ok', true, 'version', v, 'updated_at', now_, 'contract_signed_at', case when signing then now_ else i.contract_signed_at end);
end $$;

-- ============================================================================
-- Funzioni per le email (solo la funzione del server, ruolo service_role)
-- ============================================================================

-- Copia via email per l'artista: entro 30 minuti dall'ultimo invio, oppure con la password; max 5 al giorno.
create or replace function public.labelform_copy_ok(p_token text, p_verifier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.labelform_invites; e text; err jsonb; r public.labelform_releases; s public.labelform_settings;
begin
  i := public.labelform_find(p_token);
  e := public.labelform_link_error(i);
  if e is not null then return jsonb_build_object('error', e); end if;
  select * into i from public.labelform_invites where id = i.id for update;
  if i.version = 0 then return jsonb_build_object('error', 'not_submitted'); end if;
  if coalesce(i.updated_at, i.submitted_at) < now() - interval '30 minutes' then
    err := public.labelform_check_pw(i, p_verifier);
    if err is not null then return err; end if;
  end if;
  if i.copies_day = current_date and i.copies >= 5 then return jsonb_build_object('error', 'too_many'); end if;
  update public.labelform_invites set copies = case when copies_day = current_date then copies + 1 else 1 end, copies_day = current_date where id = i.id;
  select * into r from public.labelform_releases where id = i.release_id;
  select * into s from public.labelform_settings where id;
  return jsonb_build_object('ok', true, 'artist', i.artist_name, 'release', r.title, 'catalog', r.catalog, 'label', s.label_name, 'reply_to', s.notify_email);
end $$;

-- Avvisi da spedire all'etichetta: li "prende in carico" (mailed_at) e li restituisce raggruppati per invito.
-- Quelli più vecchi di 2 giorni non si spediscono più (restano visibili nell'app).
create or replace function public.labelform_mail_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.labelform_settings; out jsonb;
begin
  select * into s from public.labelform_settings where id;
  update public.labelform_events set mailed_at = now()
    where mailed_at is null and (kind = 'opened' or created_at < now() - interval '2 days');
  if s.notify_email is null or s.notify_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('to', null, 'items', '[]'::jsonb); end if;
  with claimed as (
    update public.labelform_events ev set mailed_at = now()
    where ev.id in (select id from public.labelform_events where mailed_at is null order by id limit 50 for update skip locked)
    returning ev.*
  ),
  agg as (select invite_id, array_agg(distinct kind) kinds, array_agg(id) ids from claimed group by invite_id),
  ch as (select c.invite_id, array_agg(distinct x) changed from claimed c, unnest(c.changed) x group by c.invite_id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'invite_id', agg.invite_id, 'artist', i.artist_name, 'release', r.title, 'catalog', r.catalog,
      'kinds', agg.kinds, 'changed', coalesce(ch.changed, '{}'), 'event_ids', agg.ids)), '[]'::jsonb)
    into out
  from agg
  left join ch on ch.invite_id = agg.invite_id
  join public.labelform_invites i on i.id = agg.invite_id
  join public.labelform_releases r on r.id = i.release_id;
  return jsonb_build_object('to', s.notify_email, 'label', s.label_name, 'public_url', s.public_url, 'items', out);
end $$;

-- Se l'email non parte, gli avvisi tornano in coda.
create or replace function public.labelform_mail_unclaim(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update public.labelform_events set mailed_at = null where id = any(p_ids) and mailed_at > now() - interval '10 minutes';
$$;

-- Etichette dei campi (per l'email "ha modificato: Bio, Tracce…"): dal modulo dell'invito.
create or replace function public.labelform_field_labels(p_invite uuid, p_ids text[]) returns text[]
language sql stable security definer set search_path = public as $$
  with f as (select schema from public.labelform_forms where id = (select form_id from public.labelform_invites where id = p_invite)),
  fields as (
    select fld from f, jsonb_array_elements(f.schema -> 'sections') s, jsonb_array_elements(s -> 'fields') fld
  )
  select coalesce(array(select coalesce(nullif(fld ->> 'label', ''), x) from unnest(p_ids) x
    left join fields on fields.fld ->> 'id' = x), '{}');
$$;

-- ─── Permessi delle funzioni ───────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'labelform_is_owner()', 'labelform_status()', 'labelform_claim(text)', 'labelform_pin_owner(text)',
    'labelform_find(text)', 'labelform_link_error(public.labelform_invites)', 'labelform_sealed_ok(jsonb, integer)',
    'labelform_ids_ok(jsonb)', 'labelform_ids(jsonb)', 'labelform_pw_ok(jsonb)', 'labelform_verifier_hash(text)',
    'labelform_check_pw(public.labelform_invites, text)', 'labelform_open(text)', 'labelform_unlock(text, text)',
    'labelform_submit(text, jsonb)', 'labelform_update(text, text, jsonb)', 'labelform_copy_ok(text, text)',
    'labelform_mail_claim()', 'labelform_mail_unclaim(bigint[])', 'labelform_field_labels(uuid, text[])',
    'labelform_invites_guard()', 'labelform_versions_frozen()'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon, authenticated', fn);
  end loop;
end $$;
grant execute on function public.labelform_is_owner() to authenticated;
grant execute on function public.labelform_status() to authenticated;
grant execute on function public.labelform_claim(text) to authenticated;
grant execute on function public.labelform_open(text) to anon, authenticated;
grant execute on function public.labelform_unlock(text, text) to anon, authenticated;
grant execute on function public.labelform_submit(text, jsonb) to anon, authenticated;
grant execute on function public.labelform_update(text, text, jsonb) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.labelform_copy_ok(text, text) to service_role;
    grant execute on function public.labelform_mail_claim() to service_role;
    grant execute on function public.labelform_mail_unclaim(bigint[]) to service_role;
    grant execute on function public.labelform_field_labels(uuid, text[]) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
