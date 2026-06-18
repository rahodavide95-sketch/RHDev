/* ============================================================================
   sync.js — Login + Sincronizzazione cloud via Supabase
   Offline-first: i dati restano in locale; con login attivo vengono salvati
   anche nel cloud e condivisi tra i dispositivi (ultimo salvataggio vince).
   La pagina di login (#login-gate) è l'ingresso quando l'app è configurata.
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

  function authMsg(m){
    if(/Email not confirmed/i.test(m)) return 'Email non confermata: controlla la posta (o disattiva la conferma su Supabase), poi accedi.';
    if(/Invalid login credentials/i.test(m)) return 'Email o password non corretti.';
    if(/already registered|already.*registered|User already/i.test(m)) return 'Email già registrata: prova ad accedere.';
    if(/at least 6|password.*6/i.test(m)) return 'La password deve avere almeno 6 caratteri.';
    return m;
  }

  /* ---------- Pagina di login (gate) ---------- */
  function showGate(show){ const g=$('login-gate'); if(!g) return; g.hidden=!show; document.body.classList.toggle('gated',show); }
  function gateStatus(msg,err){ const e=$('gate-status'); if(!e) return; e.textContent=msg||''; e.classList.toggle('err',!!err); }
  function setGateMode(mode){
    const signup = mode==='signup';
    document.body.classList.toggle('gate-signup', signup);
    const sub=$('gate-sub'); if(sub) sub.textContent = signup ? 'Crea il tuo account' : 'Accedi al tuo gestionale';
    gateStatus('');
  }
  async function gateSignIn(){
    if(!client){ gateStatus('Servizio non disponibile, usa "Continua senza account".',true); return; }
    gateStatus('Accesso in corso…');
    const { error } = await client.auth.signInWithPassword({ email:$('gate-email').value.trim(), password:$('gate-pw').value });
    if(error) gateStatus(authMsg(error.message),true);
  }
  async function gateSignUp(){
    if(!client){ gateStatus('Servizio non disponibile, usa "Continua senza account".',true); return; }
    const name=$('gate-name').value.trim(), label=$('gate-label').value.trim();
    if(!name||!label){ gateStatus('Inserisci nome e nome label.',true); return; }
    gateStatus('Registrazione in corso…');
    const { data, error } = await client.auth.signUp({
      email:$('gate-email').value.trim(), password:$('gate-pw').value,
      options:{ data:{ full_name:name, label_name:label } }
    });
    if(error){ gateStatus(authMsg(error.message),true); return; }
    window.LF.setProfile({ name, label });
    if(data.session) gateStatus('Account creato ✓');                       // login immediato → onAuth nasconde il gate
    else gateStatus('Account creato. Controlla l\'email per confermare, poi premi Accedi.');
  }

  /* ---------- UI impostazioni ---------- */
  function renderUI(){
    const cfg=getCfg();
    const baked=!!bakedCfg();
    const configured = !!(cfg && cfg.url && cfg.key);
    const box=$('sync-config-box');
    if(baked){ if(box) box.hidden=true; }
    else if(box){
      box.hidden=false; box.open=!configured;
      if($('sync-url')) $('sync-url').value = cfg?.url||'';
      if($('sync-key')) $('sync-key').value = cfg?.key||'';
    }
    $('sync-auth').hidden = !configured || !!user;
    $('sync-account').hidden = !user;
    if(user) $('sync-account-label').textContent = '☁ Connesso come '+user.email;
  }
  function fillAccount(){
    const md = (user && user.user_metadata) || {};
    const p = window.LF.profile();
    if($('account-name')) $('account-name').value = md.full_name || p.name || '';
    if($('account-label')) $('account-label').value = md.label_name || p.label || '';
  }

  /* ---------- Client ---------- */
  function initClient(){
    const cfg=getCfg();
    if(!cfg||!cfg.url||!cfg.key){ setStatus('Non configurata'); renderUI(); return; }
    if(!window.supabase){ setStatus('Libreria cloud non caricata (sei offline?)'); gateStatus('Servizio non raggiungibile. Usa "Continua senza account".',true); return; }
    try{ client = window.supabase.createClient(cfg.url, cfg.key); }
    catch(e){ setStatus('Configurazione non valida'); return; }
    setStatus('In attesa di accesso…');
    client.auth.onAuthStateChange((_evt, session)=>{ user = session?.user || null; onAuth(); });
    client.auth.getSession().then(({data})=>{ user = data.session?.user || null; onAuth(); });
  }

  async function onAuth(){
    renderUI();
    if(user){
      showGate(false);
      window.LF_push = schedulePush;
      setStatus('Connesso — sincronizzo…'); gateStatus('');
      await pull();
      fillAccount();
    } else {
      window.LF_push = null;
      if(getCfg()){ showGate(true); setStatus('Accedi per sincronizzare'); }
      else { showGate(false); setStatus('Non configurata'); }
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
    else { await push(); }
  }
  function schedulePush(){ if(pulling) return; clearTimeout(pushTimer); pushTimer=setTimeout(push, 700); }
  async function push(){
    if(!user||!client) return;
    const payload = { user_id:user.id, data:window.LF.data(), updated_at:new Date().toISOString() };
    const { error } = await client.from('app_state').upsert(payload);
    setStatus(error ? ('Errore salvataggio: '+error.message) : ('Sincronizzato ✓ '+now()));
  }

  /* ---------- Auth (pannello impostazioni, fallback) ---------- */
  async function signIn(){
    if(!client) return;
    const { error } = await client.auth.signInWithPassword({ email:$('sync-email').value.trim(), password:$('sync-pw').value });
    if(error) setStatus(authMsg(error.message));
  }
  async function signUp(){
    if(!client) return;
    const { error } = await client.auth.signUp({ email:$('sync-email').value.trim(), password:$('sync-pw').value });
    setStatus(error ? authMsg(error.message) : 'Registrato. Se serve, conferma l\'email e poi accedi.');
  }
  async function signOut(){ if(client) await client.auth.signOut(); }
  window.LF_signOut = signOut;
  async function saveAccount(){
    const name=$('account-name').value.trim(), label=$('account-label').value.trim();
    window.LF.setProfile({ name, label });
    if(client && user){
      const { error } = await client.auth.updateUser({ data:{ full_name:name, label_name:label } });
      setStatus(error ? ('Errore profilo: '+error.message) : 'Profilo salvato ✓');
    } else setStatus('Profilo salvato (locale)');
  }

  /* ---------- Occhio mostra/nascondi (tutti i campi password) ---------- */
  function wireEyes(){
    document.querySelectorAll('.eye-btn').forEach(eye=>{
      const wrap=eye.closest('.input-eye'); const pw=wrap&&wrap.querySelector('input'); if(!pw) return;
      eye.innerHTML=EYE;
      eye.onclick=()=>{ const show=pw.type==='password'; pw.type=show?'text':'password';
        eye.innerHTML=show?EYE_OFF:EYE; eye.setAttribute('aria-label',show?'Nascondi password':'Mostra password'); pw.focus(); };
    });
  }

  /* ---------- Wiring ---------- */
  function wire(){
    // gate
    $('gate-signin')?.addEventListener('click', ()=>{ document.body.classList.contains('gate-signup') ? setGateMode('login') : gateSignIn(); });
    $('gate-signup')?.addEventListener('click', ()=>{ document.body.classList.contains('gate-signup') ? gateSignUp() : setGateMode('signup'); });
    $('gate-pw')?.addEventListener('keydown', e=>{ if(e.key==='Enter') (document.body.classList.contains('gate-signup')?gateSignUp():gateSignIn()); });
    // impostazioni
    $('sync-save-config')?.addEventListener('click', ()=>{
      const url=$('sync-url').value.trim().replace(/\/$/,''), key=$('sync-key').value.trim();
      if(!url||!key){ setStatus('Inserisci URL e chiave'); return; }
      localStorage.setItem(CFG_KEY, JSON.stringify({url,key}));
      setStatus('Connessione salvata'); initClient(); showGate(true);
    });
    $('sync-signin')?.addEventListener('click', signIn);
    $('sync-signup')?.addEventListener('click', signUp);
    $('sync-signout')?.addEventListener('click', signOut);
    $('sync-pull')?.addEventListener('click', ()=>{ setStatus('Aggiorno…'); pull(); });
    $('account-save')?.addEventListener('click', saveAccount);
  }

  wire(); wireEyes();
  setGateMode('login');
  showGate(!!getCfg());     // se configurato, mostra il login subito (in attesa della sessione)
  initClient();
  renderUI();
})();
