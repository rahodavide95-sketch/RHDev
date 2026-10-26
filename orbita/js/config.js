/* ============================================================================
   Configurazione cloud di Orbita (Supabase)

   Lascia vuoto per usare l'app SOLO sul dispositivo (modalità locale).
   Per attivare account, sincronizzazione e condivisione segui docs/SETUP.md
   e incolla qui l'URL del progetto e la chiave "anon" / "publishable".

   NB: la chiave anon è PUBBLICA per natura: è fatta per stare nel codice del
   browser ed è protetta dalle regole di sicurezza del database (RLS, in
   supabase/schema.sql). Non incollare MAI qui la chiave "service_role".
   ============================================================================ */
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
