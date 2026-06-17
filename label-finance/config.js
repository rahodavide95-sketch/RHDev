/* ============================================================================
   Configurazione Supabase del prodotto.
   Compilando questi due valori, TUTTI gli utenti accedono solo con email e
   password, senza dover inserire URL e chiave su ogni dispositivo.

   NB: la chiave "anon"/"publishable" è PUBBLICA per natura — è fatta per stare
   nel codice lato client ed è protetta dalle regole di sicurezza (RLS) del
   database. È quindi sicuro lasciarla qui.
   Se questi campi restano vuoti, l'app chiede la configurazione manuale.
   ============================================================================ */
window.LF_CONFIG = {
  supabaseUrl: '',     // es. https://xxxx.supabase.co
  supabaseAnonKey: ''  // es. eyJhbGciOiJI...
};
