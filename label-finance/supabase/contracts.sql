-- ============================================================================
-- Label Finance — Firma remota dei contratti
-- Esegui questo script UNA VOLTA nel tuo progetto Supabase:
--   Dashboard → SQL Editor → New query → incolla tutto → Run.
-- Non serve deployare Edge Function: usa tabella + funzioni RPC.
-- ============================================================================

-- Tabella dei contratti condivisi per la firma
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

alter table public.contracts enable row level security;

-- Il proprietario (etichetta) gestisce solo i propri contratti
drop policy if exists contracts_owner on public.contracts;
create policy contracts_owner on public.contracts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Lettura pubblica per la pagina di firma (solo per token, solo campi utili)
create or replace function public.get_contract_for_signing(p_token text)
returns table(label text, data jsonb, status text, signature jsonb, reject_reason text)
language sql security definer set search_path = public as $$
  select label, data, status, signature, reject_reason
  from public.contracts where token = p_token;
$$;

-- Firma (accettazione) del contratto da parte dell'artista
create or replace function public.sign_contract(p_token text, p_signature jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.contracts where token = p_token;
  if st is null then return 'not_found'; end if;
  if st = 'signed' then return 'already'; end if;
  update public.contracts
     set status = 'signed', signature = p_signature, reject_reason = null, updated_at = now()
   where token = p_token;
  return 'ok';
end; $$;

-- Rifiuto del contratto (per diverso accordo) con motivazione
create or replace function public.reject_contract(p_token text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.contracts where token = p_token;
  if st is null then return 'not_found'; end if;
  update public.contracts
     set status = 'rejected', reject_reason = p_reason, updated_at = now()
   where token = p_token;
  return 'ok';
end; $$;

-- Espone le funzioni alla pagina pubblica (anon) e agli utenti loggati
grant execute on function public.get_contract_for_signing(text) to anon, authenticated;
grant execute on function public.sign_contract(text, jsonb)     to anon, authenticated;
grant execute on function public.reject_contract(text, text)    to anon, authenticated;
