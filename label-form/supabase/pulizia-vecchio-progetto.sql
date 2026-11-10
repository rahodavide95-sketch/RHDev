-- Toglie da un progetto Supabase le tabelle, funzioni e regole del primo giorno (prefisso consegne_,
-- il vecchio nome di Label Form), messe per errore nel progetto di un'altra app.
-- Il workflow lo esegue SOLO se quelle tabelle sono vuote. Si può rieseguire.
drop table if exists public.consegne_events, public.consegne_versions, public.consegne_invites,
  public.consegne_releases, public.consegne_forms, public.consegne_settings, public.consegne_owner cascade;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'consegne\_%' loop
    execute 'drop function if exists ' || r.f || ' cascade';
  end loop;
end $$;
notify pgrst, 'reload schema';
