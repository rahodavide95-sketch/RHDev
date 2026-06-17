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

  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a9.1 9.1 0 0 0 4.3-1.06"/><path d="m3 3 18 18"/></svg>';

  // config incorporata nel prodotto (config.js): se presente, l'utente NON
  // deve inserire URL/chiave, accede solo con email e password.
  const bakedCfg = ()=>{ const c=window.LF_CONFIG;
    return (c&&c.supabaseUrl&&c.supabaseAnonKey)?{url:c.supabaseUrl,key:c.supabaseAnonKey,baked:true}:null; };
  const getCfg = ()=>{ const b=bakedCfg(); if(b) return b;
    try{ return JSON.parse(localStorage.getItem(CFG_KEY)); }catch{ return null; } };
  const setStatus = (msg)=>{ const e=$('sync-status'); if(e) e.textContent=msg; };
  const now = ()=> new Date().toLocaleTimeString('it-IT');

  /* ---------- UI ---------- */
  function renderUI(){
    const cfg=getCfg();
    const baked=!!bakedCfg();
    const configured = !!(cfg && cfg.url && cfg.key);
    const box=$('sync-config-box');
    if(baked){ if(box) box.hidden=true; }            // config già incorporata: nascondi il passaggio
    else if(box){
      box.hidden=false; box.open=!configured;
      if($('sync-url')) $('sync-url').value = cfg?.url||'';
      if($('sync-key')) $('sync-key').value = cfg?.key||'';
    }
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

    // occhio mostra/nascondi password
    const eye=$('sync-pw-eye'), pw=$('sync-pw');
    if(eye && pw){
      eye.innerHTML = EYE;
      eye.addEventListener('click', ()=>{
        const show = pw.type==='password';
        pw.type = show ? 'text' : 'password';
        eye.innerHTML = show ? EYE_OFF : EYE;
        eye.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
        pw.focus();
      });
    }
  }

  wire();
  initClient();
  renderUI();
})();
