/* ============================================================================
   sync.js — Sincronizzazione cloud opzionale via Supabase
   I dati restano in locale (offline-first); se configuri Supabase e fai login,
   vengono salvati anche nel cloud e condivisi tra i tuoi dispositivi.
   Strategia: ultimo salvataggio vince. All'apertura si scarica la versione cloud.
   ============================================================================ */
(function(){
  'use strict';
  const CFG_KEY = 'labelfinance.supabase';
  const $ = (id)=>document.getElementById(id);
  let client=null, user=null, pushTimer=null, pulling=false;

  const getCfg = ()=>{ try{ return JSON.parse(localStorage.getItem(CFG_KEY)); }catch{ return null; } };
  const setStatus = (msg)=>{ const e=$('sync-status'); if(e) e.textContent=msg; };
  const now = ()=> new Date().toLocaleTimeString('it-IT');

  /* ---------- UI ---------- */
  function renderUI(){
    const cfg=getCfg();
    const configured = !!(cfg && cfg.url && cfg.key);
    if($('sync-url')) $('sync-url').value = cfg?.url||'';
    if($('sync-key')) $('sync-key').value = cfg?.key||'';
    // box config aperto solo se non configurato
    const box=$('sync-config-box'); if(box) box.open = !configured;
    $('sync-auth').hidden = !configured || !!user;
    $('sync-account').hidden = !user;
    if(user){ $('sync-account-label').textContent = '☁ Connesso come '+user.email; }
  }

  /* ---------- Client ---------- */
  function initClient(){
    const cfg=getCfg();
    if(!cfg||!cfg.url||!cfg.key){ setStatus('Non configurata'); renderUI(); return; }
    if(!window.supabase){ setStatus('Libreria cloud non caricata (sei offline?)'); return; }
    try{
      client = window.supabase.createClient(cfg.url, cfg.key);
    }catch(e){ setStatus('Configurazione non valida'); return; }
    setStatus('In attesa di accesso…');
    client.auth.onAuthStateChange((_evt, session)=>{ user = session?.user || null; onAuth(); });
    client.auth.getSession().then(({data})=>{ user = data.session?.user || null; onAuth(); });
  }

  async function onAuth(){
    renderUI();
    if(user){
      setStatus('Connesso — sincronizzo…');
      window.LF_push = schedulePush;          // ogni save() locale ora spinge al cloud
      await pull();
    } else {
      window.LF_push = null;
      setStatus(getCfg() ? 'Configurata — accedi per sincronizzare' : 'Non configurata');
    }
  }

  /* ---------- Sync ---------- */
  async function pull(){
    if(!user||!client) return;
    pulling=true;
    const { data, error } = await client.from('app_state').select('data').eq('user_id', user.id).maybeSingle();
    pulling=false;
    if(error){ setStatus('Errore lettura cloud: '+error.message); return; }
    if(data && data.data){ window.LF.applyCloud(data.data); setStatus('Sincronizzato ✓ '+now()); }
    else { await push(); }                    // primo accesso: carico i dati locali nel cloud
  }
  function schedulePush(){ if(pulling) return; clearTimeout(pushTimer); pushTimer=setTimeout(push, 700); }
  async function push(){
    if(!user||!client) return;
    const payload = { user_id:user.id, data:window.LF.data(), updated_at:new Date().toISOString() };
    const { error } = await client.from('app_state').upsert(payload);
    setStatus(error ? ('Errore salvataggio: '+error.message) : ('Sincronizzato ✓ '+now()));
  }

  /* ---------- Auth ---------- */
  async function signIn(){
    if(!client) return;
    const { error } = await client.auth.signInWithPassword({ email:$('sync-email').value.trim(), password:$('sync-pw').value });
    if(error) setStatus('Accesso fallito: '+error.message);
  }
  async function signUp(){
    if(!client) return;
    const { error } = await client.auth.signUp({ email:$('sync-email').value.trim(), password:$('sync-pw').value });
    setStatus(error ? ('Registrazione fallita: '+error.message)
      : 'Registrato. Se Supabase richiede conferma email, confermala e poi accedi.');
  }
  async function signOut(){ if(client) await client.auth.signOut(); }

  /* ---------- Wiring ---------- */
  function wire(){
    $('sync-save-config')?.addEventListener('click', ()=>{
      const url=$('sync-url').value.trim().replace(/\/$/,''), key=$('sync-key').value.trim();
      if(!url||!key){ setStatus('Inserisci URL e chiave'); return; }
      localStorage.setItem(CFG_KEY, JSON.stringify({url,key}));
      setStatus('Connessione salvata'); initClient();
    });
    $('sync-signin')?.addEventListener('click', signIn);
    $('sync-signup')?.addEventListener('click', signUp);
    $('sync-signout')?.addEventListener('click', signOut);
    $('sync-pull')?.addEventListener('click', ()=>{ setStatus('Aggiorno…'); pull(); });
  }

  wire();
  initClient();
  renderUI();
})();
