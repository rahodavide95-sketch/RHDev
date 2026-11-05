-- Toglie Consegne da un progetto Supabase: tutte le tabelle, funzioni e regole con il prefisso consegne_.
-- Serve a ripulire il progetto di un'altra app dove Consegne era stato messo per errore il primo giorno.
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
