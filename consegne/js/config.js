/* ============================================================================
   Configurazione di Consegne: il progetto Supabase (lo stesso di Label Finance,
   Documenti Raho e Fioritura; le tabelle di Consegne hanno il prefisso consegne_).

   NB: la chiave "anon" è PUBBLICA per natura: sta nel codice del browser ed è
   protetta dalle regole del database (supabase/schema.sql). Non incollare MAI qui
   la chiave "service_role".
   ============================================================================ */
export const CONFIG = {
  supabaseUrl: 'https://ztjlqorvnulgfvbtvavm.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0amxxb3J2bnVsZ2Z2YnR2YXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTgwMDIsImV4cCI6MjA5NzI3NDAwMn0._6gEbzCCnejpyh36Lpqe0_fj27UaonCkn2a7NastDMA',
};
