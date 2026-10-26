-- Imitazione minima di Supabase per testare le regole di sicurezza in locale:
-- ruoli anon/authenticated, schema auth con users e mfa_factors, auth.uid()/auth.jwt()
-- letti dalle impostazioni della richiesta (come fa PostgREST).
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb
);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, status text
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- come Supabase: le tabelle nuove di public sono concesse ad anon e authenticated
alter default privileges in schema public grant all on tables to anon, authenticated;
