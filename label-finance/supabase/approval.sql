-- ============================================================================
-- Label Finance — Registrazione con approvazione del titolare
-- Esegui UNA VOLTA nel tuo progetto Supabase:
--   Dashboard → SQL Editor → New query → incolla tutto → Run.
--
-- Ogni nuovo iscritto viene creato come "non approvato". L'app lo lascia
-- entrare solo quando tu metti  approved = true  (lo fai dal pannello Supabase).
-- ============================================================================

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Ognuno può leggere SOLO il proprio profilo (per sapere se è approvato).
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);
-- Nessuna policy di scrittura: il flag "approved" lo cambi solo tu dal pannello
-- (o con la query in fondo). Così l'utente non può auto-approvarsi.

-- Crea automaticamente il profilo (NON approvato) a ogni registrazione.
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

-- IMPORTANTE: approva SUBITO te stesso così non resti fuori.
-- Sostituisci l'email con la tua e lancia anche questa riga:
--   insert into public.profiles(id, email, approved)
--   select id, email, true from auth.users where email = 'tua@email.com'
--   on conflict (id) do update set approved = true;

-- Per approvare un tester in futuro (dal SQL Editor):
--   update public.profiles set approved = true where email = 'tester@email.com';
-- Oppure dal pannello: Table Editor → profiles → spunta "approved" sulla sua riga.
