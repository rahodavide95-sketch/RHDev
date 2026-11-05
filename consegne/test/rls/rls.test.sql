-- Test delle regole di sicurezza di supabase/schema.sql (eseguiti da run.sh su un Postgres vero)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- utenti: D (etichetta), Eve (estranea con account), Carol (email non confermata)
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000d', 'D@Example.com', now()),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', null);

create or replace function public._as(who text, aal text default 'aal1') returns void language plpgsql as $$
begin
  if who = 'anon' then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', case who
    when 'd' then '00000000-0000-0000-0000-00000000000d' when 'eve' then '00000000-0000-0000-0000-00000000000e'
    when 'carol' then '00000000-0000-0000-0000-00000000000c' end, 'role', 'authenticated', 'aal', aal)::text, false);
end $$;
create or replace function public._fails(q text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then return; end;
  raise exception 'DOVEVA FALLIRE ma è riuscito: %', q;
end $$;
create or replace function public._rows(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
create or replace function public._check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'TEST FALLITO: %', what; end if; raise notice 'ok  %', what; end $$;
-- dati cifrati finti ma con la forma giusta
create or replace function public._sealed(n int default 64) returns jsonb language sql as $$
  select jsonb_build_object('iv', 'AAAAAAAAAAAAAAAA', 'ct', repeat('Q', n), 'z', 1) $$;
create or replace function public._tok(x text) returns text language sql as $$ select rpad(x, 43, 'A') $$;
create or replace function public._ver(x text) returns text language sql as $$ select encode(sha256(convert_to(x, 'UTF8')), 'base64') $$;
create or replace function public._pw(x text) returns jsonb language sql as $$
  select jsonb_build_object('salt', 'AAAAAAAAAAAAAAAAAAAAAA==', 'iter', 600000, 'verifier', public._ver(x),
    'dek', jsonb_build_object('iv', 'BBBBBBBBBBBBBBBB', 'ct', repeat('C', 64))) $$;
grant execute on function public._as(text, text), public._fails(text), public._rows(text), public._check(boolean, text),
  public._sealed(int), public._tok(text), public._ver(text), public._pw(text) to authenticated, anon, service_role;
create table public._ids (k text primary key, v uuid);
grant all on public._ids to authenticated, anon, service_role;
set client_min_messages = notice;

-- 0. il workflow fissa l'email del proprietario
select _check(public.consegne_pin_owner('d@example.com') = 'pinned', 'email del proprietario fissata dal workflow');

-- 1. Chi non è l'etichetta non vede nulla
set role anon;
select _as('anon');
select _fails($$select * from consegne_settings$$);
select _fails($$select * from consegne_invites$$);
select _fails($$select * from consegne_owner$$);
select _fails($$select consegne_claim()$$);
select _fails($$select consegne_find('x')$$);
select _fails($$select consegne_mail_claim()$$);
select _fails($$select consegne_copy_ok('x', null)$$);
select _check(true, 'anon: nessun accesso a tabelle e funzioni interne');
select _check(consegne_open('corto') ->> 'error' = 'not_found', 'link malformato: non trovato');
select _check(consegne_open(_tok('nessuno')) ->> 'error' = 'not_found', 'link inesistente: non trovato');

-- 2. Reclamo dell'area dell'etichetta
set role authenticated;
select _as('eve');
select _check(consegne_claim() = 'need_mfa', 'senza 2FA non si reclama');
select _as('eve', 'aal2');
select _check(consegne_claim() = 'not_allowed', 'un''altra email non può reclamare (email fissata)');
select _check(not (consegne_status() ->> 'can_claim')::boolean, 'stato: eve non può reclamare');
select _as('carol', 'aal2');
select _check(consegne_claim() = 'need_email', 'email non confermata: no');
select _as('d');
select _check(consegne_claim() = 'need_mfa', 'anche D senza 2FA: no');
select _check(not consegne_is_owner(), 'D senza 2FA non è proprietario');
select _as('d', 'aal2');
select _check((consegne_status() ->> 'can_claim')::boolean, 'stato: D può reclamare');
select _check(consegne_claim() = 'ok', 'D reclama con 2FA ed email confermata');
select _check(consegne_claim() = 'already', 'secondo reclamo: già suo');
select _check(consegne_is_owner(), 'D è proprietario con 2FA');
select _as('eve', 'aal2');
select _check(consegne_claim() = 'taken', 'dopo D nessun altro');
reset role;
select _check(public.consegne_pin_owner('altro@example.com') = 'claimed_by_other', 'il workflow non può cambiare un proprietario già attivo');
set role authenticated;

-- 3. D senza 2FA non vede e non scrive
select _as('d', 'aal1');
select _check((select count(*) from consegne_forms) = 0, 'D aal1: non vede i moduli');
select _fails($$insert into consegne_forms (title, schema) values ('x', '{}')$$);
select _check(true, 'D aal1: non crea moduli');

-- 4. D con 2FA prepara tutto
select _as('d', 'aal2');
insert into consegne_settings (label_name, notify_email, label_key, label_signature)
  values ('SUBCONSCIOUS Culture', 'label@example.com', jsonb_build_object('v', 1, 'pub', repeat('P', 200)), 'data:image/png;base64,AAAA');
insert into consegne_forms (title, schema) values ('Consegna release',
  '{"title":"Consegna release","sections":[{"id":"s_a","fields":[{"id":"f_bio","type":"long","label":"Bio"},{"id":"f_link","type":"link","label":"Cartella press"}]}]}')
  returning id as fid \gset
insert into consegne_releases (title, catalog) values ('Night EP', 'SC005') returning id as rid \gset
insert into consegne_invites (release_id, form_id, artist_name, token_hash, token_enc, artist_pct)
  values (:'rid', :'fid', 'DJ Prova', encode(sha256(convert_to(_tok('uno'), 'UTF8')), 'hex'), repeat('E', 400), 60) returning id as iid \gset
insert into _ids values ('rid', :'rid'), ('fid', :'fid'), ('iid', :'iid');
select _check((select count(*) from consegne_invites) = 1, 'D crea release e invito');
select _fails($$insert into consegne_invites (release_id, form_id, artist_name, token_hash, token_enc, main_ct)
  values ((select v from _ids where k='rid'), (select v from _ids where k='fid'), 'x', repeat('a', 64), repeat('E', 400), '{}')$$);
select _check(true, 'D non può scrivere dati cifrati al posto dell''artista');

-- 5. Eve (con account e 2FA) non vede e non tocca nulla
select _as('eve', 'aal2');
select _check((select count(*) from consegne_invites) = 0, 'estranea: non vede gli inviti');
select _check((select count(*) from consegne_settings) = 0, 'estranea: non vede le impostazioni');
select _check(_rows($$update consegne_invites set artist_name = 'hack'$$) = 0, 'estranea: non modifica');
select _check(_rows($$delete from consegne_releases$$) = 0, 'estranea: non elimina');
select _fails($$insert into consegne_releases (title) values ('furto')$$);
select _check(true, 'estranea: non crea release');

-- 6. L'artista apre il link
set role anon;
select _as('anon');
select _check(consegne_open(_tok('uno')) -> 'form' ->> 'title' = 'Consegna release', 'artista: il link apre il modulo');
select _check(consegne_open(_tok('uno')) -> 'label' ->> 'pub' = repeat('P', 200), 'artista: riceve la chiave pubblica dell''etichetta');
select _check(consegne_open(_tok('uno')) -> 'invite' ->> 'artist_pct' = '60', 'artista: vede la percentuale del contratto');
select _check(consegne_open(_tok('uno')) -> 'label' ->> 'name' = 'SUBCONSCIOUS Culture', 'artista: vede il nome dell''etichetta');
select _check(not (consegne_open(_tok('uno')) -> 'label' ? 'label_key'), 'artista: non riceve la chiave privata chiusa');
select _check(consegne_unlock(_tok('uno'), _ver('pw')) ->> 'error' = 'no_password', 'prima dell''invio non c''è nulla da aprire');
select _check(consegne_update(_tok('uno'), _ver('pw'), '{}') ->> 'error' = 'not_submitted', 'non si modifica prima di inviare');

-- 7. Invio
select _check(consegne_submit(_tok('uno'), '{}') ->> 'error' = 'invalid', 'invio vuoto rifiutato');
select _check(consegne_submit(_tok('uno'), jsonb_build_object('dek_label', repeat('K', 512), 'main', _sealed(), 'filled', '["BAD ID"]'::jsonb)) ->> 'error' = 'invalid', 'id dei campi controllati');
select _check(consegne_submit(_tok('uno'), jsonb_build_object('dek_label', repeat('K', 512), 'main', jsonb_build_object('iv', 'x', 'ct', 'y'))) ->> 'error' = 'invalid', 'dati cifrati malformati rifiutati');
select _check(consegne_submit(_tok('uno'), jsonb_build_object('dek_label', repeat('K', 512), 'main', _sealed(1500000))) ->> 'error' = 'invalid', 'dati troppo grandi rifiutati');
select _check(consegne_submit(_tok('uno'), jsonb_build_object('dek_label', repeat('K', 512), 'main', _sealed(), 'contract', jsonb_build_object('ct', _sealed(), 'sign', true))) ->> 'error' = 'invalid', 'firma senza impronta rifiutata');
select _check((consegne_submit(_tok('uno'), jsonb_build_object('dek_label', repeat('K', 512), 'main', _sealed(), 'filled', '["f_bio"]'::jsonb,
  'password', _pw('segreta'), 'contract', jsonb_build_object('ct', _sealed(), 'sign', false))) ->> 'ok')::boolean, 'primo invio con password');
select _check(consegne_submit(_tok('uno'), jsonb_build_object('dek_label', repeat('K', 512), 'main', _sealed())) ->> 'error' = 'already_submitted', 'il link da solo non sovrascrive un invio');
select _check((consegne_open(_tok('uno')) -> 'invite' ->> 'has_password')::boolean, 'l''invio ha la password');

-- 8. Rivedere e modificare: serve la password
select _check(consegne_unlock(_tok('uno'), null) ->> 'error' = 'wrong_password', 'senza password non si apre');
select _check(consegne_unlock(_tok('uno'), _ver('sbagliata')) ->> 'error' = 'wrong_password', 'password sbagliata: no');
select _check(consegne_unlock(_tok('uno'), _ver('segreta')) ->> 'version' = '1', 'password giusta: dati cifrati restituiti');
select _check(consegne_unlock(_tok('uno'), _ver('segreta')) -> 'dek_artist' ->> 'iv' = 'BBBBBBBBBBBBBBBB', 'chiave dell''artista restituita');
select _check(consegne_update(_tok('uno'), _ver('sbagliata'), jsonb_build_object('base_version', 1, 'main', _sealed())) ->> 'error' = 'wrong_password', 'modifica con password sbagliata: no');
select _check((consegne_update(_tok('uno'), _ver('segreta'), jsonb_build_object('base_version', 1, 'main', _sealed(80), 'filled', '["f_bio","f_link"]'::jsonb, 'changed', '["f_link"]'::jsonb)) ->> 'version') = '2', 'modifica con la password');
select _check(consegne_update(_tok('uno'), _ver('segreta'), jsonb_build_object('base_version', 1, 'main', _sealed())) ->> 'error' = 'conflict', 'modifica su una versione vecchia: conflitto');

-- 9. Troppi tentativi sbagliati bloccano
select consegne_unlock(_tok('uno'), _ver('no' || g)) from generate_series(1, 8) g;
select _check(consegne_unlock(_tok('uno'), _ver('segreta')) ->> 'error' = 'locked', '8 errori: bloccato anche con la password giusta');
reset role;
update consegne_invites set fail_since = now() - interval '16 minutes';
set role anon;
select _as('anon');
select _check(consegne_unlock(_tok('uno'), _ver('segreta')) ->> 'version' = '2', 'dopo 15 minuti si riapre');

-- 10. Firma: dopo, il contratto non si cambia più
select _check(consegne_update(_tok('uno'), _ver('segreta'), jsonb_build_object('base_version', 2, 'main', _sealed(80), 'contract', jsonb_build_object('ct', _sealed(90), 'sign', true, 'hash', repeat('a', 64)))) ->> 'version' = '3', 'firma del contratto');
select _check(consegne_open(_tok('uno')) -> 'invite' ->> 'contract_signed_at' is not null, 'firma registrata con l''ora del server');
select _check(consegne_update(_tok('uno'), _ver('segreta'), jsonb_build_object('base_version', 3, 'main', _sealed(80), 'contract', jsonb_build_object('ct', _sealed(99), 'sign', false))) ->> 'error' = 'contract_locked', 'contratto firmato: l''artista non lo cambia');
select _check((consegne_update(_tok('uno'), _ver('segreta'), jsonb_build_object('base_version', 3, 'main', _sealed(70), 'changed', '["f_bio"]'::jsonb)) ->> 'version') = '4', 'il resto si modifica ancora');
reset role;
select _fails($$update consegne_invites set contract_ct = '{"iv":"x"}'$$);
select _check(true, 'nemmeno il database con pieni poteri cambia un contratto firmato');
select _fails($$update consegne_versions set main_ct = '{}'$$);
select _check(true, 'lo storico non si riscrive');
set role authenticated;
select _as('d', 'aal2');
select _fails($$update consegne_invites set artist_pct = 10$$);
select _check(true, 'dopo la firma la percentuale non cambia');
select _fails($$update consegne_invites set main_ct = '{}'$$);
select _fails($$update consegne_invites set contract_signed_at = null$$);
select _fails($$update consegne_invites set pw_verifier = null$$);
select _check(true, 'l''etichetta non può riscrivere i dati dell''artista');
select _check((select version from consegne_invites) = 4 and (select contract_hash from consegne_invites) = repeat('a', 64), 'l''etichetta vede versione e impronta');
select _check((select count(*) from consegne_versions) = 4, 'l''etichetta vede lo storico');
select _check((select array_agg(kind order by id) from consegne_events) = array['opened', 'submitted', 'updated', 'signed', 'updated'], 'avvisi registrati in ordine');
select _check((select changed from consegne_events where kind = 'updated' order by id limit 1) = array['f_link'], 'l''avviso dice cosa è cambiato');
select _check(_rows($$update consegne_events set read_at = now()$$) = 5, 'D segna gli avvisi come letti');
select _fails($$update consegne_events set kind = 'opened'$$);
select _check(true, 'il tipo di avviso non si cambia');

-- 11. Email (solo il server)
reset role;
set role service_role;
select _check(jsonb_array_length(consegne_mail_claim() -> 'items') = 1, 'il server prende gli avvisi da spedire, raggruppati');
select _check(jsonb_array_length(consegne_mail_claim() -> 'items') = 0, 'non li prende due volte');
select _check(consegne_field_labels((select v from _ids where k = 'iid'), array['f_bio', 'f_link', 'f_x']) = array['Bio', 'Cartella press', 'f_x'], 'nomi dei campi per l''email');
select _check((consegne_copy_ok(_tok('uno'), null) ->> 'ok')::boolean, 'copia via email subito dopo l''invio');
select consegne_copy_ok(_tok('uno'), null) from generate_series(1, 4);
select _check(consegne_copy_ok(_tok('uno'), null) ->> 'error' = 'too_many', 'massimo 5 copie al giorno');
reset role;

-- 12. Release chiusa, link revocato o scaduto
set role authenticated;
select _as('d', 'aal2');
update consegne_releases set closed_at = now();
insert into consegne_invites (release_id, form_id, artist_name, token_hash, token_enc)
  values ((select v from _ids where k = 'rid'), (select v from _ids where k = 'fid'), 'Secondo', encode(sha256(convert_to(_tok('due'), 'UTF8')), 'hex'), repeat('E', 400));
set role anon;
select _as('anon');
select _check(consegne_update(_tok('uno'), _ver('segreta'), jsonb_build_object('base_version', 4, 'main', _sealed())) ->> 'error' = 'closed', 'release chiusa: niente modifiche');
select _check(consegne_submit(_tok('due'), jsonb_build_object('dek_label', repeat('K', 512), 'main', _sealed())) ->> 'error' = 'closed', 'release chiusa: niente invii');
select _check((consegne_open(_tok('uno')) -> 'release' ->> 'closed')::boolean, 'l''artista vede che è chiusa');
select _check(consegne_unlock(_tok('uno'), _ver('segreta')) ->> 'version' = '4', 'ma può ancora rivedere il suo invio');
set role authenticated;
select _as('d', 'aal2');
update consegne_invites set revoked_at = now() where artist_name = 'Secondo';
update consegne_invites set expires_at = now() - interval '1 day' where artist_name = 'DJ Prova';
set role anon;
select _as('anon');
select _check(consegne_open(_tok('due')) ->> 'error' = 'revoked', 'link revocato');
select _check(consegne_open(_tok('uno')) ->> 'error' = 'expired', 'link scaduto');
select _check(consegne_unlock(_tok('uno'), _ver('segreta')) ->> 'error' = 'expired', 'link scaduto: nemmeno con la password');

-- 13. Nuovo link per lo stesso artista (il vecchio smette di funzionare)
set role authenticated;
select _as('d', 'aal2');
update consegne_invites set token_hash = encode(sha256(convert_to(_tok('tre'), 'UTF8')), 'hex'), expires_at = null where artist_name = 'DJ Prova';
set role anon;
select _as('anon');
select _check(consegne_open(_tok('uno')) ->> 'error' = 'not_found', 'il vecchio link non funziona più');
select _check(consegne_unlock(_tok('tre'), _ver('segreta')) ->> 'version' = '4', 'il nuovo link funziona con la stessa password');

-- 14. Eliminazione a cascata
set role authenticated;
select _as('d', 'aal2');
select _fails($$delete from consegne_forms$$);
select _check(true, 'un modulo in uso non si elimina');
delete from consegne_releases;
select _check((select count(*) from consegne_invites) = 0 and (select count(*) from consegne_versions) = 0 and (select count(*) from consegne_events) = 0, 'eliminando la release spariscono inviti, storico e avvisi');
reset role;

select 'PASSATI tutti i test di sicurezza di Consegne';
