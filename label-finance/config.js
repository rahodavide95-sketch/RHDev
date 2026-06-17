/* ============================================================================
   Configurazione Supabase del prodotto (modello SaaS condiviso).
   Tutti gli utenti accedono a questo progetto; ogni utente ha i propri dati
   isolati (RLS). Gli utenti fanno solo registrazione/login, senza inserire
   URL e chiave.

   NB: la chiave "anon"/"publishable" è PUBBLICA per natura — è fatta per stare
   nel codice lato client ed è protetta dalle regole di sicurezza (RLS) del
   database. È quindi sicuro lasciarla qui.
   ============================================================================ */
window.LF_CONFIG = {
  supabaseUrl: 'https://ztjlqorvnulgfvbtvavm.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0amxxb3J2bnVsZ2Z2YnR2YXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTgwMDIsImV4cCI6MjA5NzI3NDAwMn0._6gEbzCCnejpyh36Lpqe0_fj27UaonCkn2a7NastDMA'
};
