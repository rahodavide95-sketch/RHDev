-- Fioritura, notifiche push: i telefoni iscritti, i promemoria già mandati e il giro di ogni minuto.
-- Sta nello stesso progetto della tabella fioritura e usa solo oggetti con il prefisso fioritura (più il job
-- pg_cron "fioritura-push"). Lo applica il workflow .github/workflows/fioritura-push.yml, che mette al posto di
-- __CRON_SECRET__ il segreto della funzione. Si può rieseguire.

-- i telefoni iscritti: li scrive solo fioritura_push_save (per l'account collegato), li legge solo la funzione
create table if not exists public.fioritura_push (
  endpoint text primary key check (length(endpoint) < 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) < 200),
  auth text not null check (length(auth) < 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fioritura_push_user on public.fioritura_push (user_id);
alter table public.fioritura_push enable row level security;
revoke all on public.fioritura_push from anon, authenticated;

-- ogni promemoria si manda una volta sola
create table if not exists public.fioritura_push_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) < 200),
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.fioritura_push_sent enable row level security;
revoke all on public.fioritura_push_sent from anon, authenticated;

-- l'app iscrive o toglie il telefono dell'account collegato (solo dal sito dell'app)
create or replace function public.fioritura_push_save(p_endpoint text, p_p256dh text, p_auth text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.fioritura_from_app() then return false; end if;
  insert into public.fioritura_push (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
  return true;
end $$;

create or replace function public.fioritura_push_remove(p_endpoint text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.fioritura_push where endpoint = p_endpoint and user_id = auth.uid();
  return true;
end $$;

revoke all on function public.fioritura_push_save(text, text, text) from public;
revoke all on function public.fioritura_push_remove(text) from public;
grant execute on function public.fioritura_push_save(text, text, text) to authenticated;
grant execute on function public.fioritura_push_remove(text) to authenticated;

-- il giro di ogni minuto: pg_cron chiama la funzione fioritura-push, che manda i promemoria scattati
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('fioritura-push', '* * * * *', $job$
  select net.http_post(
    url := 'https://ztjlqorvnulgfvbtvavm.supabase.co/functions/v1/fioritura-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$job$);

notify pgrst, 'reload schema';
