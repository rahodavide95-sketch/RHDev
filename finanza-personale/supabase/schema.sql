-- [RH] Finance: sincronizzazione cifrata tra i dispositivi, un account per persona.
-- Registrazione aperta a tutti (D: "aperto a tutti"): ognuno ha la sua riga e vede solo quella.
-- Sta nel progetto Supabase di Label Finance (lo stesso di Documenti Raho, quindi gli stessi account
-- email e password) ma usa solo oggetti con il prefisso finanza_personale: non tocca Label Finance
-- (i suoi dati vogliono l'approvazione del titolare) né Documenti Raho (solo il suo proprietario).
-- Sul server c'è solo la "cassaforte" cifrata nel browser (AES-256-GCM, chiave dalla password con
-- PBKDF2-SHA256 600.000). Il contenuto si apre solo con la password, il codice di recupero o (dal 3/11/2026)
-- il link "password dimenticata" arrivato per email: vedi sotto.
-- Il server risponde solo all'app dal suo sito (D: "regolamentarlo ai fini della sicurezza per non farmelo
-- copiare"): una copia messa su un altro sito non può usare questo database.
-- Si può rieseguire senza problemi (lo applica il workflow .github/workflows/finanza-personale-db.yml).

-- i dati: una riga per account, cifrata, con la versione per non sovrascrivere le modifiche di un altro dispositivo
create table if not exists public.finanza_personale (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text not null check (length(data) < 50000000),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.finanza_personale enable row level security;
revoke all on public.finanza_personale from anon, authenticated;
grant select, insert, update on public.finanza_personale to authenticated;   -- niente delete: un accesso rubato non può cancellare la riga

-- la richiesta arriva dal sito dell'app? (i browser mettono sempre l'Origin nelle richieste verso il server:
-- quella di una copia su un altro sito non è questa; senza Origin, es. strumenti a riga di comando, vale l'account)
create or replace function public.finanza_personale_from_app() returns boolean
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'origin', 'https://rahodavide95-sketch.github.io')
    = 'https://rahodavide95-sketch.github.io';
$$;

-- l'app la chiama dopo l'accesso: questo account può usare la sincronizzazione da qui?
create or replace function public.finanza_personale_claim() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.finanza_personale_from_app();
$$;

revoke all on function public.finanza_personale_from_app() from public;
revoke all on function public.finanza_personale_claim() from public;
grant execute on function public.finanza_personale_from_app() to authenticated;
grant execute on function public.finanza_personale_claim() to authenticated;

-- ognuno la sua riga (prima: solo il proprietario, il primo account che aveva fatto l'accesso)
drop policy if exists "finanza_personale solo proprietario" on public.finanza_personale;
drop policy if exists "finanza_personale ognuno la sua riga" on public.finanza_personale;
create policy "finanza_personale ognuno la sua riga" on public.finanza_personale
  for all to authenticated
  using (user_id = auth.uid() and public.finanza_personale_from_app())
  with check (user_id = auth.uid() and public.finanza_personale_from_app());

-- ─── "Password dimenticata" con la sola email (D: "la password dimenticata facciamola tramite email", scelta
-- "Solo email"). La chiave dei dati resta cifrata nel browser come sempre, ma l'app ne fa sigillare una copia dal
-- server con un suo segreto (in Supabase Vault, non nella tabella dei dati) legato all'account: la copia sigillata
-- sta nella cassaforte stessa. Il server la riapre solo a chi è entrato col link arrivato per email da meno di
-- un'ora (nel token di accesso: amr "otp"), dal sito dell'app e per il suo account. Chi ha solo la password
-- dell'account, una copia dei dati o un backup non la riapre; chi controlla la casella email sì (è il prezzo
-- della scelta, detto a D).
create table if not exists public.finanza_personale_escrow_key (
  id int primary key default 1 check (id = 1),
  k text not null
);
alter table public.finanza_personale_escrow_key enable row level security;
revoke all on public.finanza_personale_escrow_key from public, anon, authenticated;

-- il segreto si crea una volta sola: in Vault (cifrato con una chiave che non sta nel database); la tabella
-- qui sopra serve solo se Vault non c'è
do $$
begin
  perform set_config('search_path', 'public, extensions', true);
  if exists (select 1 from public.finanza_personale_escrow_key) then return; end if;
  begin
    if not exists (select 1 from vault.secrets where name = 'finanza_personale_escrow') then
      perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'finanza_personale_escrow', '[RH] Finance: chiave di riserva per "password dimenticata" via email. Non cancellarla: senza, il ripristino via email non funziona più.');
    end if;
  exception when others then
    insert into public.finanza_personale_escrow_key (k) values (encode(gen_random_bytes(32), 'hex'));
  end;
end $$;

create or replace function public.finanza_personale_escrow_secret() returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare k text;
begin
  select e.k into k from public.finanza_personale_escrow_key e where e.id = 1;
  if k is null then
    begin
      select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'finanza_personale_escrow' limit 1;
    exception when others then k := null;
    end;
  end if;
  if k is null or length(k) < 32 then raise exception 'chiave di riserva mancante'; end if;
  return k;
end $$;

-- sigilla la chiave dei dati (44 caratteri base64) per questo account
create or replace function public.finanza_personale_escrow_seal(dek text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null or not public.finanza_personale_from_app() then
    raise exception 'non consentito' using errcode = '42501';
  end if;
  if dek is null or dek !~ '^[A-Za-z0-9+/]{43}=$' then raise exception 'chiave non valida' using errcode = '22023'; end if;
  return replace(encode(pgp_sym_encrypt(dek, public.finanza_personale_escrow_secret() || ':' || auth.uid()::text, 'cipher-algo=aes256'), 'base64'), E'\n', '');
end $$;

-- la riapre solo per chi è entrato col link dell'email da meno di un'ora
create or replace function public.finanza_personale_escrow_open(sealed text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare amr jsonb := auth.jwt() -> 'amr';
begin
  if auth.uid() is null or not public.finanza_personale_from_app() then
    raise exception 'non consentito' using errcode = '42501';
  end if;
  if jsonb_typeof(amr) is distinct from 'array' or not exists (
    select 1 from jsonb_array_elements(amr) e
    where e ->> 'method' in ('otp', 'recovery', 'magiclink')
      and (e ->> 'timestamp') ~ '^[0-9]{9,11}$'
      and (e ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 3600) then
    raise exception 'serve il link arrivato per email' using errcode = '42501';
  end if;
  if sealed is null or length(sealed) > 4000 then raise exception 'non valido' using errcode = '22023'; end if;
  return pgp_sym_decrypt(decode(sealed, 'base64'), public.finanza_personale_escrow_secret() || ':' || auth.uid()::text);
end $$;

revoke all on function public.finanza_personale_escrow_secret() from public, anon, authenticated;
revoke all on function public.finanza_personale_escrow_seal(text) from public, anon;
revoke all on function public.finanza_personale_escrow_open(text) from public, anon;
grant execute on function public.finanza_personale_escrow_seal(text) to authenticated;
grant execute on function public.finanza_personale_escrow_open(text) to authenticated;

-- via quello che serviva al proprietario unico
drop function if exists public.finanza_personale_is_owner();
drop function if exists public.finanza_personale_has_owner();
drop table if exists public.finanza_personale_owner;

notify pgrst, 'reload schema';
