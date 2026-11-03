-- Fioritura: i progressi di studio sincronizzati tra i dispositivi, un account per persona.
-- Sta nel progetto Supabase di Label Finance (lo stesso di Documenti Raho e Analisi Finanziarie, quindi gli
-- stessi account email e password) ma usa solo oggetti con il prefisso fioritura: non tocca nient'altro.
-- Ognuno ha la sua riga e vede solo quella. I dati non sono cifrati (sono progressi di studio: giornate,
-- pagine, note, argomenti critici); chi gestisce il progetto Supabase potrebbe vederli dal pannello.
-- Il server risponde solo all'app dal suo sito: una copia messa su un altro sito non può usare questo database.
-- Si può rieseguire senza problemi (lo applica il workflow .github/workflows/fioritura-db.yml).

-- i dati: una riga per account, con la versione per non sovrascrivere le modifiche di un altro dispositivo
create table if not exists public.fioritura (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (pg_column_size(data) < 5000000),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.fioritura enable row level security;
revoke all on public.fioritura from anon, authenticated;
grant select, insert, update on public.fioritura to authenticated;   -- niente delete: un accesso rubato non può cancellare la riga

-- la richiesta arriva dal sito dell'app? (i browser mettono sempre l'Origin nelle richieste verso il server;
-- senza Origin, es. strumenti a riga di comando, vale solo l'account)
create or replace function public.fioritura_from_app() returns boolean
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'origin', 'https://rahodavide95-sketch.github.io')
    = 'https://rahodavide95-sketch.github.io';
$$;
revoke all on function public.fioritura_from_app() from public;
grant execute on function public.fioritura_from_app() to authenticated;

drop policy if exists "fioritura ognuno la sua riga" on public.fioritura;
create policy "fioritura ognuno la sua riga" on public.fioritura
  for all to authenticated
  using (user_id = auth.uid() and public.fioritura_from_app())
  with check (user_id = auth.uid() and public.fioritura_from_app());

notify pgrst, 'reload schema';
