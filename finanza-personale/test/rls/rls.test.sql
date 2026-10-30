-- Test delle regole di sicurezza di supabase/schema.sql (eseguiti da run.sh)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- utenti: Davide (proprietario), Eve (estranea)
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'davide@example.com', now()),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com', now());

create or replace function public._as(who text) returns void language plpgsql as $$
begin
  if who = 'anon' then perform set_config('request.jwt.claims', '{"role":"anon"}', false); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', case who
    when 'davide' then '00000000-0000-0000-0000-0000000000d1' when 'eve' then '00000000-0000-0000-0000-00000000000e' end,
    'role', 'authenticated')::text, false);
end $$;
create or replace function public._fails(q text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then return; end;
  raise exception 'DOVEVA FALLIRE ma è riuscito: %', q;
end $$;
create or replace function public._rows(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
create or replace function public._check(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'TEST FALLITO: %', what; end if; raise notice 'ok  %', what; end $$;
grant execute on function public._as(text), public._fails(text), public._rows(text), public._check(boolean, text) to authenticated, anon;
set client_min_messages = notice;

-- 1. Chi non ha fatto l'accesso: sa solo se c'è già un proprietario
set role anon;
select _as('anon');
select _check(finanza_personale_has_owner() = false, 'all''inizio nessun proprietario');
select _fails($$select * from finanza_personale$$);
select _check(true, 'senza accesso non si leggono i dati');
select _fails($$select finanza_personale_claim()$$);
select _check(true, 'senza accesso non si diventa proprietari');
reset role;

-- 2. Davide accede per primo e diventa proprietario
set role authenticated;
select _as('davide');
select _check(finanza_personale_claim() = true, 'il primo account diventa proprietario');
select _check(finanza_personale_claim() = true, 'riprovare non cambia nulla');
insert into finanza_personale (user_id, data, version) values ('00000000-0000-0000-0000-0000000000d1', '{"format":"cifrato"}', 1);
select _check((select count(*) from finanza_personale) = 1, 'il proprietario salva e rilegge la sua riga');
select _check(_rows($$update finanza_personale set data = 'v2', version = 2 where user_id = auth.uid() and version = 1$$) = 1, 'aggiornamento con la versione giusta');
select _check(_rows($$update finanza_personale set data = 'vecchia', version = 2 where user_id = auth.uid() and version = 1$$) = 0, 'una versione superata non sovrascrive');
select _fails($$delete from finanza_personale$$);
select _check(true, 'la riga non si cancella dall''app');
select _fails($$insert into finanza_personale (user_id, data) values ('00000000-0000-0000-0000-00000000000e', 'x')$$);
select _check(true, 'non si scrive a nome di un altro');

-- 3. Eve, estranea: non diventa proprietaria e non vede né scrive nulla
select _as('eve');
select _check(finanza_personale_claim() = false, 'un secondo account non diventa proprietario');
select _check(finanza_personale_has_owner() = true, 'il proprietario c''è');
select _check(finanza_personale_is_owner() = false, 'l''estraneo non è proprietario');
select _check((select count(*) from finanza_personale) = 0, 'l''estraneo non vede i dati');
select _check(_rows($$update finanza_personale set data = 'hack'$$) = 0, 'l''estraneo non modifica');
select _fails($$insert into finanza_personale (user_id, data) values ('00000000-0000-0000-0000-00000000000e', 'x')$$);
select _check(true, 'l''estraneo non salva una sua riga');
select _fails($$select * from finanza_personale_owner$$);
select _check(true, 'la tabella del proprietario non si legge');
reset role;
select _check((select data from finanza_personale) = 'v2', 'i dati del proprietario sono intatti');

select 'TUTTI I TEST PASSATI';
