-- [RH] Finance: sincronizzazione cifrata tra i dispositivi, un account per persona.
-- Registrazione aperta a tutti (D: "aperto a tutti"): ognuno ha la sua riga e vede solo quella.
-- Sta nel progetto Supabase di Label Finance (lo stesso di Documenti Raho, quindi gli stessi account
-- email e password) ma usa solo oggetti con il prefisso finanza_personale: non tocca Label Finance
-- (i suoi dati vogliono l'approvazione del titolare) né Documenti Raho (solo il suo proprietario).
-- Sul server c'è solo la "cassaforte" cifrata nel browser (AES-256-GCM, chiave dalla password con
-- PBKDF2-SHA256 600.000): nessuno può leggerne il contenuto, nemmeno il titolare del progetto.
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

-- via quello che serviva al proprietario unico
drop function if exists public.finanza_personale_is_owner();
drop function if exists public.finanza_personale_has_owner();
drop table if exists public.finanza_personale_owner;

notify pgrst, 'reload schema';
