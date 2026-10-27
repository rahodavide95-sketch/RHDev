-- Documenti Raho: sincronizzazione cifrata, un solo proprietario.
-- Sta nel progetto Supabase di Label Finance ma usa solo oggetti con il prefisso documenti_raho:
-- non tocca tabelle, funzioni o regole di Label Finance.
-- Sul server c'è solo testo cifrato nel browser con la password di D (AES-GCM, chiave PBKDF2): nessuno può leggerlo.
-- Si può rieseguire senza problemi (lo applica il workflow .github/workflows/documenti-raho-db.yml).

-- il proprietario: il primo account che accede dallo strumento, poi nessun altro
create table if not exists public.documenti_raho_owner (
  id boolean primary key default true check (id),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.documenti_raho_owner enable row level security;
revoke all on public.documenti_raho_owner from anon, authenticated;

-- i dati: una riga, cifrata
create table if not exists public.documenti_raho (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.documenti_raho enable row level security;
revoke all on public.documenti_raho from anon;
grant select, insert, update on public.documenti_raho to authenticated;

create or replace function public.documenti_raho_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documenti_raho_owner where user_id = auth.uid());
$$;

create or replace function public.documenti_raho_has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documenti_raho_owner);
$$;

create or replace function public.documenti_raho_claim() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  insert into public.documenti_raho_owner (id, user_id) values (true, auth.uid()) on conflict do nothing;
  return exists (select 1 from public.documenti_raho_owner where user_id = auth.uid());
end $$;

revoke all on function public.documenti_raho_is_owner() from public;
revoke all on function public.documenti_raho_has_owner() from public;
revoke all on function public.documenti_raho_claim() from public;
grant execute on function public.documenti_raho_is_owner() to authenticated;
grant execute on function public.documenti_raho_has_owner() to anon, authenticated;
grant execute on function public.documenti_raho_claim() to authenticated;

drop policy if exists "documenti_raho solo proprietario" on public.documenti_raho;
create policy "documenti_raho solo proprietario" on public.documenti_raho
  for all to authenticated
  using (user_id = auth.uid() and public.documenti_raho_is_owner())
  with check (user_id = auth.uid() and public.documenti_raho_is_owner());

notify pgrst, 'reload schema';
