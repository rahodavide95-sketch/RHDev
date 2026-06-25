-- ============================================================================
-- Label Finance — Abbonamenti (Stripe)
-- Esegui UNA VOLTA nel tuo progetto Supabase:
--   Dashboard → SQL Editor → New query → incolla tutto → Run.
--
-- Questa tabella è la "verità" sul piano di ogni utente. La scrive SOLO il
-- webhook di Stripe (tramite service role). L'utente può solo leggerla: così
-- nessuno può sbloccarsi i piani da solo.
-- ============================================================================

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

-- L'utente legge SOLO la propria riga. Nessuna policy di scrittura per gli
-- utenti: insert/update li fa solo la service role (la Edge Function webhook),
-- che bypassa la RLS.
drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions
  for select using (auth.uid() = user_id);

-- Indice per ritrovare l'utente dal cliente Stripe (usato dal webhook)
create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);
