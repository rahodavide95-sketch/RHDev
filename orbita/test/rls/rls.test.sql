-- Test delle regole di sicurezza di supabase/schema.sql (eseguiti da run.sh)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- utenti: Alice (proprietaria), Bob (invitato), Carol (email NON verificata), Eve (estranea)
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', null),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com', now());

create or replace function public._as(who text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case who
    when 'alice' then '00000000-0000-0000-0000-00000000000a' when 'bob' then '00000000-0000-0000-0000-00000000000b'
    when 'carol' then '00000000-0000-0000-0000-00000000000c' when 'eve' then '00000000-0000-0000-0000-00000000000e' end,
    'role', 'authenticated', 'aal', aal)::text, false);
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

set role authenticated;

-- 1. Alice crea profilo e viaggio
select _as('alice');
insert into orb_profiles (id, display_name, data) values ('00000000-0000-0000-0000-00000000000a', 'Alice', '{}');
insert into orb_trips (id, title, start_date, end_date, data) values ('trip-alice-0001', 'Lapponia', '2025-12-26', '2025-12-31', '{"v":1}');
select _check((select count(*) from orb_trips) = 1, 'la proprietaria vede il suo viaggio');
select _check((select owner_id from orb_trips where id = 'trip-alice-0001') = '00000000-0000-0000-0000-00000000000a', 'owner_id messo dal server');
select _fails($$insert into orb_trips (id, title, end_date, start_date) values ('trip-bad-dates', 'x', '2025-01-01', '2025-02-01')$$);
select _check(true, 'date incoerenti rifiutate');
select _fails($$insert into orb_trips (id, title, data) values ('trip-big-data', 'x', jsonb_build_object('n', repeat('x', 300000)))$$);
select _check(true, 'dati troppo grandi rifiutati');
select _fails($$insert into orb_trips (id, title) values ('../etc/passwd', 'x')$$);
select _check(true, 'id malformato rifiutato');

-- 2. Eve, estranea, non vede e non tocca nulla
select _as('eve');
select _check((select count(*) from orb_trips) = 0, 'un estraneo non vede i viaggi altrui');
select _check(_rows($$update orb_trips set title = 'hack' where id = 'trip-alice-0001'$$) = 0, 'un estraneo non modifica');
select _check(_rows($$delete from orb_trips where id = 'trip-alice-0001'$$) = 0, 'un estraneo non elimina');
select _fails($$insert into orb_trips (id, title, owner_id) values ('trip-eve-fake1', 'x', '00000000-0000-0000-0000-00000000000a')$$);
select _check(true, 'non si crea un viaggio a nome di altri');
select _fails($$insert into orb_trips (id, title) values ('trip-alice-0001', 'furto') on conflict (id) do update set title = 'furto'$$);
select _check(true, 'non si sovrascrive un viaggio altrui con upsert');
select _check((select count(*) from orb_profiles) = 0, 'un estraneo non vede i profili altrui');
select _fails($$insert into orb_trip_shares (trip_id, email) values ('trip-alice-0001', 'eve@example.com')$$);
select _check(true, 'un estraneo non si auto-invita');

-- 3. Alice invita Bob (sola lettura) e Carol (email non verificata)
select _as('alice');
insert into orb_trip_shares (trip_id, email, role, inviter_name) values ('trip-alice-0001', '  Bob@Example.com ', 'viewer', 'Alice');
insert into orb_trip_shares (trip_id, email, role) values ('trip-alice-0001', 'carol@example.com', 'editor');
select _check((select email from orb_trip_shares where email like 'bob%') = 'bob@example.com', 'email normalizzata');
select _fails($$insert into orb_trip_shares (trip_id, email) values ('trip-alice-0001', 'alice@example.com')$$);
select _check(true, 'non ci si invita da soli');
select _fails($$insert into orb_trip_shares (trip_id, email) values ('trip-alice-0001', 'non-una-email')$$);
select _check(true, 'email non valida rifiutata');

-- 4. Bob vede ma non modifica
select _as('bob');
select _check((select count(*) from orb_trips) = 1, 'l''invitato vede il viaggio condiviso');
select _check(_rows($$update orb_trips set title = 'cambio' where id = 'trip-alice-0001'$$) = 0, 'il viewer non modifica');
select _check(_rows($$delete from orb_trips where id = 'trip-alice-0001'$$) = 0, 'il viewer non elimina');
select _check((select count(*) from orb_trip_shares) = 1, 'l''invitato vede solo il proprio invito');
select _check(_rows($$update orb_trip_shares set role = 'editor'$$) = 0, 'l''invitato non si promuove a editor');

-- 5. Alice promuove Bob a editor: ora modifica, ma non cambia proprietario né elimina
select _as('alice');
update orb_trip_shares set role = 'editor' where email = 'bob@example.com';
select _as('bob');
select _check(_rows($$update orb_trips set title = 'Lapponia ❄️' where id = 'trip-alice-0001'$$) = 1, 'l''editor modifica');
select _check((select updated_by from orb_trips where id = 'trip-alice-0001') = '00000000-0000-0000-0000-00000000000b', 'updated_by tracciato dal server');
select _fails($$update orb_trips set owner_id = '00000000-0000-0000-0000-00000000000b' where id = 'trip-alice-0001'$$);
select _check(true, 'l''editor non si prende il viaggio');
select _check(_rows($$delete from orb_trips where id = 'trip-alice-0001'$$) = 0, 'l''editor non elimina');
select _fails($$insert into orb_trip_shares (trip_id, email) values ('trip-alice-0001', 'eve@example.com')$$);
select _check(true, 'l''editor non invita altre persone');

-- 6. Carol: invitata ma con email non verificata → niente
select _as('carol');
select _check((select count(*) from orb_trips) = 0, 'email non verificata: nessun accesso');

-- 7. Verifica in due passaggi: con 2FA attiva serve aal2
reset role;
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000a', 'verified');
set role authenticated;
select _as('alice', 'aal1');
select _check((select count(*) from orb_trips) = 0, '2FA attiva: senza codice il database non risponde');
select _fails($$insert into orb_trips (id, title) values ('trip-alice-0002', 'x')$$);
select _check(true, '2FA attiva: senza codice non si scrive');
select _as('alice', 'aal2');
select _check((select count(*) from orb_trips) = 1, '2FA attiva: con il codice tutto torna visibile');

-- 8. Limiti anti-abuso: massimo 25 persone per viaggio
select _as('alice', 'aal2');
insert into orb_trip_shares (trip_id, email) select 'trip-alice-0001', 'amico' || g || '@example.com' from generate_series(1, 23) g;
select _fails($$insert into orb_trip_shares (trip_id, email) values ('trip-alice-0001', 'troppi@example.com')$$);
select _check(true, 'tetto di 25 persone per viaggio');

-- 9. Bob esce dal viaggio
select _as('bob');
select _check(_rows($$delete from orb_trip_shares where email = 'bob@example.com'$$) = 1, 'l''invitato può uscire');
select _check((select count(*) from orb_trips) = 0, 'dopo l''uscita non vede più il viaggio');

-- 10. Anonimi: nessun accesso
reset role;
set role anon;
select _fails($$select count(*) from orb_trips$$);
select _fails($$select count(*) from orb_trip_shares$$);
select _fails($$select public.orb_delete_account()$$);
select _check(true, 'gli anonimi non leggono né chiamano nulla');

-- 11. Eliminazione account: sparisce tutto a cascata
reset role;
set role authenticated;
select _as('alice', 'aal1');
select _fails($$select public.orb_delete_account()$$);
select _check(true, 'eliminazione account bloccata senza codice 2FA');
select _as('alice', 'aal2');
select public.orb_delete_account();
reset role;
select _check((select count(*) from auth.users where email = 'alice@example.com') = 0, 'account eliminato');
select _check((select count(*) from orb_trips) = 0 and (select count(*) from orb_profiles) = 0 and (select count(*) from orb_trip_shares) = 0, 'viaggi, profilo e inviti eliminati a cascata');
\echo 'TUTTI I TEST DI SICUREZZA SONO PASSATI'
