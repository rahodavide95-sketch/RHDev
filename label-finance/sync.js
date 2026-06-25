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
  function showGate(show){ document.body.classList.toggle('gated', show); }
  function gateStatus(msg,err){ const e=$('gate-status'); if(!e) return; e.textContent=msg||''; e.classList.toggle('err',!!err); }
  function setGateMode(mode){
    const signup = mode==='signup';
    document.body.classList.toggle('gate-signup', signup);
    const sub=$('gate-sub'); if(sub) sub.textContent = window.t
      ? window.t(signup?'gate.sub_signup':'gate.sub_login')
      : (signup ? 'Crea il tuo account' : 'Accedi al tuo gestionale');
    // il pulsante "submit" del form cambia in base alla modalità (per il portachiavi iOS)
    if($('gate-signin')) $('gate-signin').type = signup ? 'button' : 'submit';
    if($('gate-signup')) $('gate-signup').type = signup ? 'submit' : 'button';
    // login = password esistente, registrazione = nuova password (suggerimenti iOS)
    if($('gate-pw')) $('gate-pw').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    // In login i campi di sola-registrazione (nome/cognome/label) vanno DISABILITATI:
    // così iOS/Android non classificano il form come "registrazione" e propongono
    // "Salva password" / l'autofill invece della "password sicura".
    ['gate-name','gate-surname','gate-label'].forEach(id=>{ const el=$(id); if(el) el.disabled = !signup; });
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
    const name=$('gate-name').value.trim(), surname=$('gate-surname')?$('gate-surname').value.trim():'', label=$('gate-label').value.trim();
    if(!name||!label){ gateStatus('Inserisci nome e nome label.',true); return; }
    gateStatus('Registrazione in corso…');
    const { data, error } = await client.auth.signUp({
      email:$('gate-email').value.trim(), password:$('gate-pw').value,
      options:{ data:{ full_name:name, last_name:surname, label_name:label } }
    });
    if(error){ gateStatus(authMsg(error.message),true); return; }
    window.LF.setProfile({ name, surname, label });
    if(data.session) gateStatus('Account creato ✓');                       // login immediato → onAuth nasconde il gate
    else gateStatus('Account creato. Controlla l\'email per confermare, poi premi Accedi.');
  }
  async function gateForgot(){
    if(!client){ gateStatus('Servizio non disponibile.',true); return; }
    const email=$('gate-email').value.trim();
    if(!email){ gateStatus('Inserisci la tua email, poi premi "Password dimenticata?".',true); return; }
    gateStatus('Invio email di reset…');
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if(error) gateStatus(authMsg(error.message),true);
    else gateStatus('Ti abbiamo inviato un\'email per reimpostare la password. Apri il link, poi imposta la nuova password.');
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
    if($('account-surname')) $('account-surname').value = md.last_name || p.surname || '';
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
    client.auth.onAuthStateChange((evt, session)=>{ user = session?.user || null; onAuth();
      if(evt==='PASSWORD_RECOVERY') onRecovery(); });
    client.auth.getSession().then(({data})=>{ user = data.session?.user || null; onAuth(); });
  }

  function showPending(show){ const el=$('pending-screen'); if(el) el.hidden=!show; document.body.classList.toggle('pending-locked', !!show); }
  async function isApproved(){
    // Solo se richiesto in config. "Fail-open" se la tabella non c'è ancora
    // o non c'è la riga, così non blocca prima del setup né il titolare.
    if(!(window.LF_CONFIG && window.LF_CONFIG.requireApproval)) return true;
    try{
      const { data, error } = await client.from('profiles').select('approved').eq('id', user.id).maybeSingle();
      if(error) return true;           // tabella mancante / non configurata → non bloccare
      if(!data) return true;           // nessuna riga → non bloccare (es. titolare pre-esistente)
      return !!data.approved;
    }catch(e){ return true; }
  }
  async function onAuth(){
    renderUI();
    if(user){
      if(!(await isApproved())){
        showPending(true); showGate(false); setStatus('In attesa di approvazione'); window.LF_push=null; return;
      }
      showPending(false);
      showGate(false);
      window.LF_push = schedulePush;
      setStatus('Connesso — sincronizzo…'); gateStatus('');
      await pull();
      fillAccount();
      watchContracts();
    } else {
      showPending(false);
      window.LF_push = null;
      if(getCfg()){ showGate(true); setStatus('Accedi per sincronizzare'); }
      else { showGate(false); setStatus('Non configurata'); }
    }
  }
  $('pending-logout')?.addEventListener('click', async ()=>{ try{ await client.auth.signOut(); }catch(e){} showPending(false); });

  /* ---------- Aggiornamento in tempo reale dei contratti firmati ---------- */
  let contractChannel=null;
  function watchContracts(){
    if(!client||!user) return;
    try{ if(contractChannel) client.removeChannel(contractChannel); }catch(e){}
    try{
      contractChannel = client.channel('contracts-'+user.id)
        .on('postgres_changes', { event:'*', schema:'public', table:'contracts', filter:'owner_id=eq.'+user.id },
          ()=>{ try{ window.dispatchEvent(new CustomEvent('lf-contracts-changed')); }catch(e){} })
        .subscribe();
    }catch(e){}
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
  /* Assistente AI: invoca la Edge Function 'ai-advisor' (chiave server-side) */
  window.LF_aiAdvise = async function(payload){
    if(!client) return { error:'offline' };
    if(!user) return { error:'unauthorized' };
    try{
      const { data, error } = await client.functions.invoke('ai-advisor', { body:payload });
      if(error){ let d=null; try{ d=await error.context?.json?.(); }catch{} return d || { error:error.message||'ai_error' }; }
      return data;
    }catch(e){ return { error:e.message||'ai_error' }; }
  };
  /* ---------- Ricerca catalogo etichetta (MusicBrainz/Discogs/Spotify) ---------- */
  window.LF_catalogSearch = async function(payload){
    if(!client) return { error:'offline' };
    try{
      const { data, error } = await client.functions.invoke('catalog-search', { body:payload });
      if(error){ let d=null; try{ d=await error.context?.json?.(); }catch{} return d || { error:error.message||'cat_error' }; }
      return data;
    }catch(e){ return { error:e.message||'cat_error' }; }
  };
  /* ---------- Firma remota dei contratti ---------- */
  function randToken(){ try{ return crypto.randomUUID().replace(/-/g,''); }catch(e){ return Date.now().toString(36)+Math.random().toString(36).slice(2,10); } }
  window.LF_signLink = function(token){ try{ return new URL('firma.html?t='+encodeURIComponent(token), location.href).href; }catch(e){ return 'firma.html?t='+token; } };
  /* salva il contratto sul cloud e restituisce token + link di firma */
  window.LF_sendForSignature = async function(contract){
    if(!client) return { error:'offline' };
    if(!user) return { error:'unauthorized' };
    const token = contract.token || randToken();
    const row = { token, owner_id:user.id, label:contract.label||'', artist_email:contract.email||'',
      data:contract, status:'sent', updated_at:new Date().toISOString() };
    try{
      const { error } = await client.from('contracts').upsert(row, { onConflict:'token' });
      if(error) return { error:error.message||'db_error' };
      return { token, link: window.LF_signLink(token) };
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  /* ---------- Portale artista (link sola lettura) ---------- */
  window.LF_artistPortalLink = function(token){ try{ return new URL('artista.html?t='+encodeURIComponent(token), location.href).href; }catch(e){ return 'artista.html?t='+token; } };
  window.LF_shareArtist = async function(labelId, name){
    if(!client) return { error:'offline' };
    if(!user) return { error:'unauthorized' };
    const token = randToken();
    try{
      const { error } = await client.from('artist_shares').insert({ token, owner_id:user.id, label_id:labelId, artist_name:name });
      if(error) return { error:error.message||'db_error' };
      return { token, link: window.LF_artistPortalLink(token) };
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  window.LF_revokeArtistShare = async function(token){
    if(!client||!user) return { error:'offline' };
    try{ const { error } = await client.from('artist_shares').update({ revoked:true }).eq('token', token);
      if(error) return { error:error.message||'db_error' }; return { ok:true };
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  /* legge lo stato firma/rifiuto dei contratti dell'utente */
  window.LF_refreshContractStatuses = async function(){
    if(!client||!user) return null;
    try{
      const { data, error } = await client.from('contracts').select('token,status,signature,reject_reason,updated_at').eq('owner_id', user.id);
      if(error) return null; return data||[];
    }catch(e){ return null; }
  };
  async function saveAccount(){
    const name=$('account-name').value.trim(), surname=$('account-surname')?$('account-surname').value.trim():'', label=$('account-label').value.trim();
    window.LF.setProfile({ name, surname, label });
    if(client && user){
      const { error } = await client.auth.updateUser({ data:{ full_name:name, last_name:surname, label_name:label } });
      setStatus(error ? ('Errore profilo: '+error.message) : 'Profilo salvato ✓');
    } else setStatus('Profilo salvato (locale)');
  }
  async function changePassword(){
    const st=$('pw-status'); const set=(m,ok)=>{ if(st){ st.textContent=m; st.style.color = ok?'var(--in)':'var(--out)'; } };
    if(!client || !user){ set('Devi essere connesso per cambiare password.',false); return; }
    const p1=$('pw-new').value, p2=$('pw-new2').value;
    if(p1.length<6){ set('La password deve avere almeno 6 caratteri.',false); return; }
    if(p1!==p2){ set('Le due password non coincidono.',false); return; }
    set('Aggiornamento…',true);
    const { error } = await client.auth.updateUser({ password:p1 });
    if(error){ set(authMsg(error.message),false); return; }
    $('pw-new').value=''; $('pw-new2').value='';
    set('Password aggiornata ✓',true);
  }

  /* ---------- Recupero password: porta l'utente al cambio password ---------- */
  function onRecovery(){
    showGate(false);
    try{ window.LF.goto('settings'); }catch{}
    const box=$('pw-change-box'); if(box){ box.open=true; box.scrollIntoView({behavior:'smooth',block:'center'}); }
    const st=$('pw-status'); if(st){ st.textContent='Imposta qui la tua nuova password.'; st.style.color='var(--accent)'; }
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
    // gate: il form gestisce il submit (così iOS/Keychain riconosce il login)
    $('gate-form')?.addEventListener('submit', e=>{
      e.preventDefault();
      document.body.classList.contains('gate-signup') ? gateSignUp() : gateSignIn();
    });
    // i due pulsanti, quando NON sono il submit corrente, servono a cambiare modalità
    $('gate-signin')?.addEventListener('click', ()=>{ if(document.body.classList.contains('gate-signup')) setGateMode('login'); });
    $('gate-signup')?.addEventListener('click', ()=>{ if(!document.body.classList.contains('gate-signup')) setGateMode('signup'); });
    $('gate-forgot')?.addEventListener('click', gateForgot);
    // aggiorna il sottotitolo del gate al cambio lingua
    window.addEventListener('langchange', ()=> setGateMode(document.body.classList.contains('gate-signup')?'signup':'login'));
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
    $('pw-save')?.addEventListener('click', changePassword);
  }

  wire(); wireEyes();
  // modalità iniziale: registrazione se si arriva dalla landing con app.html?signup (o #signup), altrimenti login
  setGateMode(/(?:[?&]signup\b)|#signup/i.test((location.search||'')+(location.hash||'')) ? 'signup' : 'login');
  showGate(!!getCfg());     // se configurato, mostra il login subito (in attesa della sessione)
  initClient();
  renderUI();
})();
