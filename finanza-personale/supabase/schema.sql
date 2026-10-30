-- Analisi Finanziarie: sincronizzazione cifrata tra i dispositivi, un solo proprietario (D).
-- Sta nel progetto Supabase di Label Finance (lo stesso di Documenti Raho, quindi lo stesso account
-- con email e password) ma usa solo oggetti con il prefisso finanza_personale: non tocca Label Finance
-- né Documenti Raho.
-- Sul server c'è solo la "cassaforte" cifrata nel browser (AES-256-GCM, chiave dalla password con
-- PBKDF2-SHA256 600.000): nessuno può leggerne il contenuto.
-- Si può rieseguire senza problemi (lo applica il workflow .github/workflows/finanza-personale-db.yml).

-- il proprietario: il primo account che accede dall'app, poi nessun altro
create table if not exists public.finanza_personale_owner (
  id boolean primary key default true check (id),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.finanza_personale_owner enable row level security;
revoke all on public.finanza_personale_owner from anon, authenticated;

-- i dati: una riga, cifrata, con la versione per non sovrascrivere le modifiche di un altro dispositivo
create table if not exists public.finanza_personale (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text not null check (length(data) < 50000000),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.finanza_personale enable row level security;
revoke all on public.finanza_personale from anon, authenticated;
grant select, insert, update on public.finanza_personale to authenticated;   -- niente delete: un accesso rubato non può cancellare la riga

create or replace function public.finanza_personale_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.finanza_personale_owner where user_id = auth.uid());
$$;

create or replace function public.finanza_personale_has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.finanza_personale_owner);
$$;

create or replace function public.finanza_personale_claim() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  insert into public.finanza_personale_owner (id, user_id) values (true, auth.uid()) on conflict do nothing;
  return exists (select 1 from public.finanza_personale_owner where user_id = auth.uid());
end $$;

revoke all on function public.finanza_personale_is_owner() from public;
revoke all on function public.finanza_personale_has_owner() from public;
revoke all on function public.finanza_personale_claim() from public;
grant execute on function public.finanza_personale_is_owner() to authenticated;
grant execute on function public.finanza_personale_has_owner() to anon, authenticated;
grant execute on function public.finanza_personale_claim() to authenticated;

drop policy if exists "finanza_personale solo proprietario" on public.finanza_personale;
create policy "finanza_personale solo proprietario" on public.finanza_personale
  for all to authenticated
  using (user_id = auth.uid() and public.finanza_personale_is_owner())
  with check (user_id = auth.uid() and public.finanza_personale_is_owner());

notify pgrst, 'reload schema';
