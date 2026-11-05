/* ============================================================================
   Configurazione di Label Form: il SUO progetto Supabase ("label-form"), separato
   da tutte le altre app (lo crea e lo prepara il workflow label-form.yml).

   NB: la chiave "anon" è PUBBLICA per natura: sta nel codice del browser ed è
   protetta dalle regole del database (supabase/schema.sql). Non incollare MAI qui
   la chiave "service_role".
   ============================================================================ */
export const CONFIG = {
  // true: il progetto Supabase di Label Form è pronto (con false l'area dell'etichetta mostra "Quasi pronto")
  ready: true,
  supabaseUrl: 'https://ktyxenqmqvhhbyvojdmz.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0eXhlbnFtcXZoaGJ5dm9qZG16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MTQzODQsImV4cCI6MjEwOTQ5MDM4NH0.TkgBAtBuXm_Lv1Cb9ixaqfifEwrMvyrVQQdZ8sCw6z8',
};
