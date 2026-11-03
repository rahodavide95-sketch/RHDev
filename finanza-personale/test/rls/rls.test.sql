-- Test delle regole di sicurezza di supabase/schema.sql (eseguiti da run.sh)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- utenti: Davide ed Eve, due persone qualsiasi con il loro account
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'davide@example.com', now()),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com', now());

create or replace function public._as(who text, origin text default 'https://rahodavide95-sketch.github.io') returns void language plpgsql as $$
begin
  perform set_config('request.headers', case when origin is null then '' else json_build_object('origin', origin)::text end, false);
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
grant execute on function public._as(text, text), public._fails(text), public._rows(text), public._check(boolean, text) to authenticated, anon;
set client_min_messages = notice;

-- 1. Chi non ha fatto l'accesso non legge e non scrive niente
set role anon;
select _as('anon');
select _fails($$select * from finanza_personale$$);
select _check(true, 'senza accesso non si leggono i dati');
select _fails($$select finanza_personale_claim()$$);
select _check(true, 'senza accesso non si usa la sincronizzazione');
reset role;

-- 2. Davide: la sua riga
set role authenticated;
select _as('davide');
select _check(finanza_personale_claim() = true, 'un account qualsiasi può usare la sincronizzazione');
insert into finanza_personale (user_id, data, version) values ('00000000-0000-0000-0000-0000000000d1', 'cifrato-davide', 1);
select _check((select count(*) from finanza_personale) = 1, 'salva e rilegge la sua riga');
select _check(_rows($$update finanza_personale set data = 'v2', version = 2 where user_id = auth.uid() and version = 1$$) = 1, 'aggiornamento con la versione giusta');
select _check(_rows($$update finanza_personale set data = 'vecchia', version = 2 where user_id = auth.uid() and version = 1$$) = 0, 'una versione superata non sovrascrive');
select _fails($$delete from finanza_personale$$);
select _check(true, 'la riga non si cancella dall''app');
select _fails($$insert into finanza_personale (user_id, data) values ('00000000-0000-0000-0000-00000000000e', 'x')$$);
select _check(true, 'non si scrive a nome di un altro');

-- 3. Eve, un'altra persona: si registra e ha la sua riga, ma quella di Davide non la vede
select _as('eve');
select _check(finanza_personale_claim() = true, 'anche un secondo account può usarla (aperto a tutti)');
select _check((select count(*) from finanza_personale) = 0, 'non vede la riga di Davide');
select _check(_rows($$update finanza_personale set data = 'hack'$$) = 0, 'non modifica la riga di Davide');
insert into finanza_personale (user_id, data, version) values ('00000000-0000-0000-0000-00000000000e', 'cifrato-eve', 1);
select _check((select count(*) from finanza_personale) = 1 and (select data from finanza_personale) = 'cifrato-eve', 'vede solo la sua riga');
select _fails($$insert into finanza_personale (user_id, data) values ('00000000-0000-0000-0000-0000000000d1', 'x')$$);
select _check(true, 'non scrive a nome di Davide');

-- 4. Una copia dell'app su un altro sito non può usare il server
select _as('davide', 'https://copia-di-rh-finance.example');
select _check(finanza_personale_claim() = false, 'da un altro sito la sincronizzazione non è consentita');
select _check((select count(*) from finanza_personale) = 0, 'da un altro sito non si leggono i dati');
select _check(_rows($$update finanza_personale set data = 'hack' where user_id = auth.uid()$$) = 0, 'da un altro sito non si modifica');
select _as('eve', 'http://localhost:8080');
select _fails($$insert into finanza_personale (user_id, data) values ('00000000-0000-0000-0000-00000000000e', 'x2')$$);
select _check(true, 'da un altro sito non si salva');
-- senza Origin (non è un browser) vale solo l'account
select _as('davide', null);
select _check((select count(*) from finanza_personale) = 1, 'senza Origin: solo la propria riga');

-- 5. Chiave di riserva per "password dimenticata" via email
reset role;
create or replace function public._as_link(who text, ago int, method text default 'otp', origin text default 'https://rahodavide95-sketch.github.io') returns void language plpgsql as $$
begin
  perform _as(who, origin);
  perform set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', method, 'timestamp', extract(epoch from now())::bigint - ago))))::text, false);
end $$;
grant execute on function public._as_link(text, int, text, text) to authenticated, anon;
set role authenticated;
select _as('davide');
select _fails($$select finanza_personale_escrow_secret()$$);
select _check(true, 'il segreto del server non si legge dall''app');
select _fails($$select * from finanza_personale_escrow_key$$);
select _check(true, 'la tabella del segreto non si legge');
select _fails($$select * from vault.decrypted_secrets$$);
select _check(true, 'Vault non si legge dall''app');
create temp table _sealed as select finanza_personale_escrow_seal('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=') as s;
select _check(length((select s from _sealed)) > 40 and position('QUFB' in (select s from _sealed)) = 0, 'la chiave dei dati si sigilla (e non si legge così com''è)');
select _fails($$select finanza_personale_escrow_seal('non è una chiave')$$);
select _check(true, 'si sigilla solo una chiave vera');
select _fails($$select finanza_personale_escrow_open((select s from _sealed))$$);
select _check(true, 'con la sola password dell''account non si riapre');
select _as_link('davide', 120);
select _check(finanza_personale_escrow_open((select s from _sealed)) = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=', 'dal link dell''email (2 minuti fa) si riapre');
select _as_link('davide', 120, 'recovery');
select _check(finanza_personale_escrow_open((select s from _sealed)) = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=', 'anche col metodo "recovery"');
select _as_link('davide', 2 * 3600);
select _fails($$select finanza_personale_escrow_open((select s from _sealed))$$);
select _check(true, 'un link di più di un''ora fa non basta');
select _as_link('davide', 120, 'password');
select _fails($$select finanza_personale_escrow_open((select s from _sealed))$$);
select _check(true, 'un accesso con password non basta');
select _as_link('eve', 60);
select _fails($$select finanza_personale_escrow_open((select s from _sealed))$$);
select _check(true, 'un altro account, anche dal suo link, non riapre la chiave di Davide');
select _as_link('davide', 60, 'otp', 'https://copia-di-rh-finance.example');
select _fails($$select finanza_personale_escrow_open((select s from _sealed))$$);
select _check(true, 'da un altro sito non si riapre');
set role anon;
select _as('anon');
select _fails($$select finanza_personale_escrow_seal('QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=')$$);
select _check(true, 'senza accesso non si sigilla niente');
reset role;
select _check((select count(*) from vault.secrets where name = 'finanza_personale_escrow') = 1, 'il segreto è uno solo, in Vault (anche rieseguendo lo schema)');
select _check((select count(*) from finanza_personale_escrow_key) = 0, 'con Vault la tabella di riserva resta vuota');
set role authenticated;

-- 6. Niente più resti del proprietario unico
select _check(to_regclass('public.finanza_personale_owner') is null, 'la tabella del proprietario non c''è più');
select _check(not exists (select 1 from pg_proc where proname in ('finanza_personale_has_owner', 'finanza_personale_is_owner')), 'le funzioni del proprietario non ci sono più');
reset role;
select _check((select data from finanza_personale where user_id = '00000000-0000-0000-0000-0000000000d1') = 'v2', 'i dati di Davide sono intatti');
select _check((select data from finanza_personale where user_id = '00000000-0000-0000-0000-00000000000e') = 'cifrato-eve', 'i dati di Eve sono intatti');

select 'TUTTI I TEST PASSATI';
