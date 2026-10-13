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
  // di chi sono i dati aperti: il proprio account o, con l'accesso team, quello del titolare
  let workspace=null, memberships=[];
  const wsId=()=> (workspace && workspace.owner) || (user && user.id) || null;
  const isViewer=()=> !!(workspace && workspace.role==='viewer');
  const WS_KEY='labelfinance.ws.';

  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a9.1 9.1 0 0 0 4.3-1.06"/><path d="m3 3 18 18"/></svg>';

  // config incorporata nel prodotto (config.js): se presente, l'utente NON
  // deve inserire URL/chiave, accede solo con email e password.
  const bakedCfg = ()=>{ const c=window.LF_CONFIG;
    return (c&&c.supabaseUrl&&c.supabaseAnonKey)?{url:c.supabaseUrl,key:c.supabaseAnonKey,baked:true}:null; };
  const getCfg = ()=>{ const b=bakedCfg(); if(b) return b;
    try{ return JSON.parse(localStorage.getItem(CFG_KEY)); }catch{ return null; } };
  const setStatus = (msg)=>{ const e=$('sync-status'); if(e) e.textContent=msg; };
  const now = ()=> new Date().toLocaleTimeString((window.LFI18N&&window.LFI18N.lang)||undefined);
  const tt0=(k,fb)=>{ const v=window.t?window.t(k):''; return (v&&v!==k)?v:fb; };

  function authMsg(m){
    if(/Email not confirmed/i.test(m)) return tt0('sync.e_unconfirmed','Email non confermata: apri il link che ti abbiamo mandato, poi accedi.');
    if(/Invalid login credentials/i.test(m)) return tt0('sync.e_invalid','Email o password non corretti.');
    if(/already registered|already.*registered|User already/i.test(m)) return tt0('sync.e_registered','Email già registrata: prova ad accedere.');
    if(/already.*(in use|exists|been used)|email_exists|email address.*registered/i.test(m)) return tt0('sync.e_in_use','Questa email è già usata da un altro account. Scegline un\'altra.');
    if(/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return tt0('sync.e_email','Indirizzo email non valido.');
    if(/for security purposes|rate limit|too many/i.test(m)) return tt0('sync.e_rate','Troppi tentativi ravvicinati: riprova tra qualche minuto.');
    if(/at least 6|password.*6/i.test(m)) return tt0('sync.e_pw6','La password deve avere almeno 6 caratteri.');
    if(/fetch|network|Load failed/i.test(m)) return tt0('sync.g_unavailable','Servizio non raggiungibile: controlla la connessione e riprova.');
    return m;
  }
  // Salva/aggiorna la credenziale nel gestore password (Chromium/Android).
  // Su iOS l'API non esiste: lì ci pensa il <form> con i campi autocomplete.
  async function storeCred(email, password){
    try{
      if(email && password && navigator.credentials && window.PasswordCredential){
        await navigator.credentials.store(new window.PasswordCredential({ id:email, password, name:email }));
      }
    }catch(e){}
  }

  const LAST_EMAIL='labelfinance.lastEmail';
  function rememberEmail(e){ try{ if(e) localStorage.setItem(LAST_EMAIL, e); }catch(_){} }
  function prefillEmail(){ const el=$('gate-email'); if(!el || el.value) return; try{ const e=localStorage.getItem(LAST_EMAIL); if(e) el.value=e; }catch(_){} }
  /* ---------- Pagina di login (gate) ---------- */
  function showGate(show){ document.body.classList.toggle('gated', show); if(show) prefillEmail();
    if(!show){ try{ window.LF_maybeStartTour && window.LF_maybeStartTour(); }catch(e){} } }
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
    gateStatus(linkMsg||'', !!linkMsg);   // l'avviso sul link della mail resta finché l'utente non agisce
  }
  let linkMsg=null;   // avviso "link scaduto" arrivato dalla mail
  async function gateSignIn(){
    linkMsg=null;
    if(!client){ gateStatus(tt0('sync.g_unavailable','Servizio non raggiungibile: controlla la connessione e riprova.'),true); return; }
    gateStatus(tt0('sync.g_signing','Accesso in corso…'));
    const email=$('gate-email').value.trim(), pw=$('gate-pw').value;
    const { error } = await client.auth.signInWithPassword({ email, password:pw });
    if(error) gateStatus(authMsg(error.message),true);
    else { storeCred(email, pw); rememberEmail(email); }
  }
  async function gateSignUp(){
    linkMsg=null;
    if(!client){ gateStatus(tt0('sync.g_unavailable','Servizio non raggiungibile: controlla la connessione e riprova.'),true); return; }
    const name=$('gate-name').value.trim(), surname=$('gate-surname')?$('gate-surname').value.trim():'', label=$('gate-label').value.trim();
    if(!name||!label){ gateStatus(tt0('sync.g_need_name','Inserisci nome e nome label.'),true); return; }
    gateStatus(tt0('sync.g_signing_up','Registrazione in corso…'));
    const email=$('gate-email').value.trim(), pw=$('gate-pw').value;
    const { data, error } = await client.auth.signUp({
      email, password:pw,
      options:{ data:{ full_name:name, last_name:surname, label_name:label } }
    });
    if(error){ gateStatus(authMsg(error.message),true); return; }
    storeCred(email, pw); rememberEmail(email);
    window.LF.setProfile({ name, surname, label });
    if(data.session) gateStatus(tt0('sync.g_created','Account creato ✓'));                       // login immediato → onAuth nasconde il gate
    else gateStatus(tt0('sync.g_check_mail','Account creato. Controlla l\'email per confermare, poi premi Accedi.'));
  }
  async function gateForgot(){
    linkMsg=null;
    if(!client){ gateStatus(tt0('sync.g_unavailable','Servizio non raggiungibile: controlla la connessione e riprova.'),true); return; }
    const email=$('gate-email').value.trim();
    if(!email){ gateStatus(tt0('sync.g_need_email','Inserisci la tua email, poi premi "Password dimenticata?".'),true); return; }
    gateStatus(tt0('sync.g_sending_reset','Invio email di reset…'));
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if(error) gateStatus(authMsg(error.message),true);
    else gateStatus(tt0('sync.g_reset_sent','Ti abbiamo inviato un\'email per reimpostare la password. Apri il link, poi imposta la nuova password.'));
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
    // profilo e dati di accesso: solo con un account collegato
    document.querySelectorAll('[data-when-user]').forEach(el=>{ el.hidden = !user; });
    if(user) $('sync-account-label').textContent = user.email;
  }
  function fillAccount(){
    const md = (user && user.user_metadata) || {};
    const p = window.LF.profile();
    if($('account-name')) $('account-name').value = md.full_name || p.name || '';
    if($('account-surname')) $('account-surname').value = md.last_name || p.surname || '';
    if($('account-label')) $('account-label').value = md.label_name || p.label || '';
    if($('email-current')) $('email-current').value = (user && user.email) || '';
    if($('pw-username')) $('pw-username').value = (user && user.email) || '';
  }

  /* ---------- Client ---------- */
  function initClient(){
    const cfg=getCfg();
    if(!cfg||!cfg.url||!cfg.key){ setStatus(tt0('sync.s_not_configured','Non configurata')); renderUI(); return; }
    if(!window.supabase){ setStatus(tt0('sync.s_lib','Libreria cloud non caricata (sei offline?)')); gateStatus(tt0('sync.g_unavailable','Servizio non raggiungibile: controlla la connessione e riprova.'),true); return; }
    try{ client = window.supabase.createClient(cfg.url, cfg.key); }
    catch(e){ setStatus(tt0('sync.s_bad_cfg','Configurazione non valida')); return; }
    setStatus(tt0('sync.s_waiting','In attesa di accesso…'));
    client.auth.onAuthStateChange((evt, session)=>{ user = session?.user || null; onAuth();
      if(evt==='PASSWORD_RECOVERY') onRecovery(); });
    client.auth.getSession().then(({data})=>{ user = data.session?.user || null; onAuth(); });
  }

  function showPending(show){ const el=$('pending-screen'); if(el) el.hidden=!show; document.body.classList.toggle('pending-locked', !!show); }
  async function isApproved(){
    // Solo se richiesto in config. Se la tabella profiles non esiste ancora, o il
    // titolare non ha una riga (account creato prima dell'approvazione), non blocca.
    // Qui è solo la schermata: il vero controllo è nel database (RLS su app_state,
    // vedi supabase/schema.sql), quindi in caso di errore non si blocca nessuno.
    if(!(window.LF_CONFIG && window.LF_CONFIG.requireApproval)) return true;
    try{
      const { data, error } = await client.from('profiles').select('approved').eq('id', user.id).maybeSingle();
      if(error) return true;
      if(!data) return true;
      return !!data.approved;
    }catch(e){ return true; }
  }
  let authedUserId=null;
  // i dati locali sono di questo account (o di nessuno)? allora si possono mostrare subito
  const wsGuess = uid => { try{ return localStorage.getItem(WS_KEY+uid)||uid; }catch(e){ return uid; } };
  const localIsMine = uid => !meta.owner || meta.owner===uid || meta.owner===wsGuess(uid);
  // sessione già salvata su questo dispositivo (Supabase la tiene in localStorage)
  function storedSessionUser(){
    try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i)||'';
        if(!/^sb-.+-auth-token$/.test(k)) continue;
        const v=JSON.parse(localStorage.getItem(k)||'null'), ses=v&&(v.currentSession||v);
        if(ses && ses.refresh_token && ses.user && ses.user.id) return ses.user.id; } }catch(e){}
    return null; }
  // modifiche fatte prima che la sincronizzazione sia pronta: segnate da salvare, partono dopo la pull
  function markDirty(){ if(isViewer()) return; editSeq++; if(!meta.dirty){ meta.dirty=true; saveMeta(); } }
  async function onAuth(){
    renderUI();
    if(user){
      if(user.id===authedUserId) return;            // rinnovo token ecc.: già sincronizzato
      authedUserId=user.id; const uid0=user.id;
      const alive=()=>user && user.id===uid0;
      // stesso account dei dati locali: niente schermata di accesso in attesa della rete
      if(localIsMine(uid0)){ showPending(false); showGate(false); window.LF_push=markDirty; }
      const approved=await Promise.race([ isApproved(), new Promise(r=>setTimeout(()=>r(true), 4000)) ]);
      if(!alive()) return;
      if(!approved){
        showPending(true); showGate(false); setStatus(tt0('sync.s_pending','In attesa di approvazione')); window.LF_push=null; return;
      }
      showPending(false);
      showGate(false);
      setStatus(tt0('sync.s_connected','Connesso — sincronizzo…')); gateStatus('');
      try{ await (window.LF.ready||Promise.resolve()); }catch(e){}
      // accesso team: etichette di altri titolari a cui questo account è stato invitato
      await Promise.race([ loadMemberships(), new Promise(r=>setTimeout(r, 6000)) ]); if(!alive()) return;
      restoreWorkspace();
      // i dati di questo dispositivo appartengono all'ultimo account che li ha sincronizzati:
      // se entra un account diverso, si riparte puliti (niente dati di un'altra etichetta)
      if(meta.owner && meta.owner!==wsId()){ await resetLocal(); }
      window.LF_push = schedulePush;
      await pull({ initial:true });
      fillAccount();
      watchContracts();
      watchState();
      if(!workspace) refreshPlan();          // il piano di un'etichetta altrui lo decide il titolare
      renderWsUI();
    } else {
      authedUserId=null; workspace=null; memberships=[]; window.LF_readOnly=false; renderWsUI();
      showPending(false);
      window.LF_push = null;
      if(getCfg()){ showGate(true); setStatus(tt0('sync.s_login','Accedi per sincronizzare')); }
      else { showGate(false); setStatus(tt0('sync.s_not_configured','Non configurata')); }
    }
  }
  $('pending-logout')?.addEventListener('click', async ()=>{ try{ await client.auth.signOut(); }catch(e){} showPending(false); });

  /* ---------- Aggiornamento in tempo reale dei contratti firmati ---------- */
  let contractChannel=null;
  function watchContracts(){
    if(!client||!user) return;
    try{ if(contractChannel) client.removeChannel(contractChannel); }catch(e){}
    try{
      contractChannel = client.channel('contracts-'+wsId())
        .on('postgres_changes', { event:'*', schema:'public', table:'contracts', filter:'owner_id=eq.'+wsId() },
          ()=>{ try{ window.dispatchEvent(new CustomEvent('lf-contracts-changed')); }catch(e){} })
        .subscribe();
    }catch(e){}
  }

  /* ---------- Sync ----------
     Il cloud tiene una riga per utente (app_state). Ogni salvataggio è condizionato:
     va a buon fine solo se nel cloud c'è ancora la versione che questo dispositivo
     conosce (updated_at). Se un altro dispositivo ha salvato nel frattempo, le due
     versioni vengono UNITE (LFCore.mergeAccounts) invece di sovrascriversi.
     meta (localStorage): owner = account a cui appartengono i dati locali,
     remoteTs = versione cloud conosciuta, dirty = modifiche locali non ancora salvate.
     La "base" (ultima versione sincronizzata) sta in IndexedDB. */
  const META_KEY='labelfinance.syncmeta';
  const loadMeta=()=>{ try{ return Object.assign({owner:null,remoteTs:null,dirty:false}, JSON.parse(localStorage.getItem(META_KEY))||{}); }catch(e){ return {owner:null,remoteTs:null,dirty:false}; } };
  let meta=loadMeta();
  const saveMeta=()=>{ try{ localStorage.setItem(META_KEY, JSON.stringify(meta)); }catch(e){} };
  const store=()=>window.LFStore||{ get:()=>Promise.resolve(null), set:()=>Promise.resolve(), del:()=>Promise.resolve() };
  let baseMem=null;   // copia in memoria: senza IndexedDB l'unione a tre vie funziona lo stesso (finché la pagina è aperta)
  async function getBase(){ try{ const b=await store().get('syncBase'); if(b) return JSON.parse(b); }catch(e){} return baseMem?JSON.parse(baseMem):null; }
  async function setBase(json){ baseMem=typeof json==='string'?json:JSON.stringify(json); try{ await store().set('syncBase', baseMem); }catch(e){} }
  async function resetLocal(){
    window.LF.wipeLocal();
    meta={owner:null,remoteTs:null,dirty:false}; saveMeta(); baseMem=null;
    try{ await store().del('syncBase'); }catch(e){}
  }
  let editSeq=0, pushing=false, pushAgain=false, lastPull=0;
  function applyMerged(d){ pulling=true; try{ window.LF.applyCloud(d); } finally { pulling=false; } }
  async function pull(opt){
    opt=opt||{};
    if(!user||!client) return;
    lastPull=Date.now();
    const seq0=editSeq, ts0=meta.remoteTs, u0=user.id, w0=wsId();
    const { data, error } = await client.from('app_state').select('data,updated_at').eq('user_id', wsId()).maybeSingle();
    if(!user || user.id!==u0 || wsId()!==w0) return;     // uscito o cambiato etichetta durante il download
    if(error){ setStatus(tt0('sync.s_read_err','Errore lettura cloud: {e}').replace('{e}', error.message)); return; }
    // modifiche o salvataggi avvenuti durante il download: questa copia è già vecchia, riprova dopo
    if(editSeq!==seq0 || meta.remoteTs!==ts0 || pushing){ schedulePull(); return; }
    if((!data || !data.data) && workspace){
      // etichetta di un titolare che non ha ancora salvato nulla nel cloud: niente da mostrare
      meta.owner=wsId(); meta.remoteTs=null; meta.dirty=false; saveMeta(); setStatus(tt0('team.owner_empty','L\'etichetta del titolare è ancora vuota.')); window.LF_push=schedulePush; return;
    }
    if(!data || !data.data){
      // cloud vuoto (account nuovo): carica i dati locali, ma chiedi se non si sa di chi sono
      if(opt.initial && !meta.owner && window.LF.localSize()>0){
        const msg=(window.t?window.t('sync.adopt_local'):'Su questo dispositivo ci sono {n} elementi non collegati a un account. Vuoi salvarli nel tuo account?').replace('{n}', window.LF.localSize());
        if(!confirm(msg)) await resetLocal();
      }
      meta.owner=user.id; meta.remoteTs=null; meta.dirty=true; saveMeta();
      await push();
      return;
    }
    if(data.updated_at===meta.remoteTs && !meta.dirty){ meta.owner=wsId(); saveMeta(); setStatus(tt0('sync.s_synced','Sincronizzato ✓ {t}').replace('{t}', now())); return; }
    // dati creati su questo dispositivo prima di accedere (di nessun account): si chiede se unirli
    let base=await getBase();
    if(!base && opt.initial && !meta.owner && !workspace && window.LF.localSize()>0){
      const msg=(window.t?window.t('sync.merge_local'):'Su questo dispositivo ci sono {n} elementi non ancora nel tuo account. Vuoi unirli ai dati del cloud?').replace('{n}', window.LF.localSize());
      meta.dirty=confirm(msg);
    }
    if(!user || user.id!==u0 || wsId()!==w0) return;
    if(!meta.dirty) applyMerged(data.data);
    else applyMerged(LFCore.mergeAccounts(base, window.LF.data(), data.data));
    meta.owner=wsId(); meta.remoteTs=data.updated_at; saveMeta();
    await setBase(data.data);
    if(meta.dirty) await push();
    else setStatus(tt0('sync.s_synced','Sincronizzato ✓ {t}').replace('{t}', now()));
  }
  // salvataggio fallito (rete, server): si riprova da soli, sempre più di rado, finché resta qualcosa da salvare
  let retryMs=0, retryTimer=null;
  function scheduleRetry(){ clearTimeout(retryTimer); retryMs=Math.min(60000, retryMs?retryMs*2:3000);
    retryTimer=setTimeout(()=>{ if(user && meta.dirty && !pushing) push(); }, retryMs); }
  function schedulePush(){
    if(isViewer()) return;                        // sola lettura: niente salvataggi nel cloud
    editSeq++;
    if(!meta.dirty){ meta.dirty=true; saveMeta(); }
    if(pulling) return;                           // la pull in corso salverà alla fine
    clearTimeout(pushTimer); pushTimer=setTimeout(push, 700);
  }
  async function push(){
    if(!user||!client||isViewer()) return;
    if(workspace && !meta.remoteTs) return;       // un membro del team non può creare i dati del titolare
    if(pushing){ pushAgain=true; return; }
    pushing=true; const u0=user.id, w0=wsId(); const alive=()=>user && user.id===u0 && wsId()===w0;
    try{
      for(let attempt=0; attempt<4; attempt++){
        const seq=editSeq;
        const snapshot=JSON.stringify(window.LF.data());
        const ts=new Date().toISOString();
        const body={ data:JSON.parse(snapshot), updated_at:ts };
        const res = meta.remoteTs
          ? await client.from('app_state').update(body).eq('user_id', wsId()).eq('updated_at', meta.remoteTs).select('updated_at')
          : await client.from('app_state').insert(Object.assign({ user_id:user.id }, body)).select('updated_at');
        if(!alive()) return;
        if(res.error && res.error.code!=='23505'){ setStatus(tt0('sync.s_save_err','Errore salvataggio: {e} — riprovo tra poco.').replace('{e}', res.error.message)); scheduleRetry(); return; }
        if(!res.error && res.data && res.data.length){
          meta.owner=wsId(); meta.remoteTs=res.data[0].updated_at; meta.dirty=(editSeq!==seq); saveMeta();
          await setBase(snapshot); retryMs=0;
          setStatus(tt0('sync.s_synced','Sincronizzato ✓ {t}').replace('{t}', now()));
          if(meta.dirty) pushAgain=true;
          return;
        }
        // un altro dispositivo ha salvato nel frattempo: scarica, unisci, riprova
        setStatus(tt0('sync.s_merging','Unisco le modifiche di un altro dispositivo…'));
        const cur=await client.from('app_state').select('data,updated_at').eq('user_id', wsId()).maybeSingle();
        if(!alive()) return;
        if(cur.error){ setStatus(tt0('sync.s_read_err','Errore lettura cloud: {e}').replace('{e}', cur.error.message)); scheduleRetry(); return; }
        if(!cur.data){ meta.remoteTs=null; continue; }
        const base=await getBase();
        applyMerged(LFCore.mergeAccounts(base, window.LF.data(), cur.data.data));
        meta.remoteTs=cur.data.updated_at; saveMeta();
        await setBase(cur.data.data);
      }
      setStatus(tt0('sync.s_too_many','Salvataggio non riuscito: troppe modifiche contemporanee. Riprovo tra poco.')); scheduleRetry();
    } finally {
      pushing=false;
      if(pushAgain){ pushAgain=false; clearTimeout(pushTimer); pushTimer=setTimeout(push, 400); }
    }
  }
  /* aggiornamento automatico quando un altro dispositivo salva (realtime) o si torna sulla scheda */
  let stateChannel=null, pullTimer=null;
  function schedulePull(){ clearTimeout(pullTimer); pullTimer=setTimeout(()=>{ if(user && !pushing) pull(); }, 800); }
  function watchState(){
    if(!client||!user) return;
    try{ if(stateChannel) client.removeChannel(stateChannel); }catch(e){}
    try{
      stateChannel = client.channel('state-'+wsId())
        .on('postgres_changes', { event:'UPDATE', schema:'public', table:'app_state', filter:'user_id=eq.'+wsId() },
          (p)=>{ const ts=p && p.new && p.new.updated_at; if(!ts || ts!==meta.remoteTs) schedulePull(); })
        .subscribe();
    }catch(e){}
  }
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && user && Date.now()-lastPull>30000) schedulePull(); });
  window.addEventListener('online', ()=>{ if(user){ if(meta.dirty) push(); else schedulePull(); } });

  /* ---------- Piano dal server (abbonamento Stripe) ---------- */
  async function refreshPlan(){
    if(!client||!user||!(window.LF_CONFIG && window.LF_CONFIG.payments)) return;
    try{
      const { data, error } = await client.from('subscriptions').select('plan,status').eq('user_id', user.id).maybeSingle();
      if(error) return;
      const active=data && (data.status==='active' || data.status==='trialing');
      window.LF.setServerPlan(active ? (data.plan||'free') : 'free');
    }catch(e){}
  }
  window.LF_checkout = async function(plan){
    if(!client||!user) return { error:'unauthorized' };
    try{ const { data, error } = await client.functions.invoke('create-checkout', { body:{ plan } });
      if(error){ let d=null; try{ d=await error.context?.json?.(); }catch{} return d || { error:error.message||'checkout_error' }; }
      return data;
    }catch(e){ return { error:e.message||'checkout_error' }; }
  };
  window.LF_billingPortal = async function(){
    if(!client||!user) return { error:'unauthorized' };
    try{ const { data, error } = await client.functions.invoke('create-portal', { body:{} });
      if(error){ let d=null; try{ d=await error.context?.json?.(); }catch{} return d || { error:error.message||'portal_error' }; }
      return data;
    }catch(e){ return { error:e.message||'portal_error' }; }
  };

  /* ---------- Auth (pannello impostazioni, fallback) ---------- */
  async function signIn(){
    if(!client) return;
    const { error } = await client.auth.signInWithPassword({ email:$('sync-email').value.trim(), password:$('sync-pw').value });
    if(error) setStatus(authMsg(error.message));
  }
  async function signUp(){
    if(!client) return;
    const { error } = await client.auth.signUp({ email:$('sync-email').value.trim(), password:$('sync-pw').value });
    setStatus(error ? authMsg(error.message) : tt0('sync.s_registered','Registrato. Se serve, conferma l\'email e poi accedi.'));
  }
  // Logout: salva le ultime modifiche, poi cancella i dati da questo dispositivo
  // (su un computer condiviso il prossimo utente non deve vedere nulla).
  async function signOut(){
    if(!client) return;
    if(meta.dirty){
      clearTimeout(pushTimer);
      if(user) await Promise.race([ push(), new Promise(r=>setTimeout(r, 6000)) ]);
      if(meta.dirty){
        const msg=window.t?window.t('sync.logout_unsaved'):'Alcune modifiche non sono ancora state salvate nel cloud e andranno perse. Uscire comunque?';
        if(!confirm(msg)) return;
      }
    }
    try{ await client.auth.signOut(); }catch(e){}
    workspace=null; memberships=[]; window.LF_readOnly=false; renderWsUI();
    await resetLocal();
    // credenziali personali salvate su questo dispositivo
    try{ ['labelfinance.aikey','labelfinance.emailjs'].forEach(k=>localStorage.removeItem(k)); }catch(e){}
  }
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
    if(!user) return { error:'login_required' };
    try{
      const { data, error } = await client.functions.invoke('catalog-search', { body:payload });
      if(error){ let d=null; try{ d=await error.context?.json?.(); }catch{} return d || { error:error.message||'cat_error' }; }
      return data;
    }catch(e){ return { error:e.message||'cat_error' }; }
  };
  /* ---------- Accesso team (vedi team_members in schema.sql) ----------
     Il titolare invita un'email come viewer (sola lettura) o editor (modifica).
     Chi entra con quell'email può aprire l'etichetta del titolare dal menu account:
     i dati letti e scritti diventano quelli del titolare (wsId). */
  async function loadMemberships(){
    memberships=[];
    if(!client||!user||!user.email) return;
    try{ const { data, error } = await client.from('team_members').select('owner_id,role,owner_email,owner_label')
        .eq('email', String(user.email).toLowerCase()).neq('owner_id', user.id);
      if(!error && data) memberships=data;
    }catch(e){}
  }
  function restoreWorkspace(){
    let id=''; try{ id=localStorage.getItem(WS_KEY+user.id)||''; }catch(e){}
    const m=memberships.find(x=>x.owner_id===id);
    workspace = m ? { owner:m.owner_id, role:m.role, label:m.owner_label||'', email:m.owner_email||'' } : null;
    window.LF_readOnly = isViewer();
  }
  async function switchWorkspace(ownerId){
    if(!user) return;
    const m=ownerId ? memberships.find(x=>x.owner_id===ownerId) : null;
    if((m?m.owner_id:null)===(workspace?workspace.owner:null)) return;
    if(meta.dirty && !isViewer()){ clearTimeout(pushTimer); await Promise.race([ push(), new Promise(r=>setTimeout(r, 6000)) ]); }
    try{ localStorage.setItem(WS_KEY+user.id, m?m.owner_id:''); }catch(e){}
    workspace = m ? { owner:m.owner_id, role:m.role, label:m.owner_label||'', email:m.owner_email||'' } : null;
    window.LF_readOnly = isViewer();
    await resetLocal();                            // si riparte puliti: i dati sono di un'altra etichetta
    setStatus(tt0('sync.s_switching','Cambio etichetta…'));
    watchContracts(); watchState();
    await pull({ initial:true });
    renderWsUI();
    if(typeof window.goto==='function') try{ window.goto('dashboard'); }catch(e){}
  }
  window.LF_switchWorkspace = switchWorkspace;
  window.LF_workspace = ()=> workspace ? Object.assign({}, workspace) : null;
  window.LF_memberships = ()=> memberships.slice();
  // sola lettura: le modifiche fatte sul dispositivo tornano com'erano nel cloud
  window.LF_revert = async function(){ const base=await getBase(); if(base){ applyMerged(base); meta.dirty=false; saveMeta(); } };
  function renderWsUI(){
    const b=$('ws-banner');
    if(b){
      b.hidden=!workspace;
      if(workspace){
        const who=workspace.label||workspace.email||'—';
        $('ws-banner-txt').textContent=tt0(workspace.role==='viewer'?'team.banner_viewer':'team.banner_editor', 'Stai lavorando sull\'etichetta di {who}').replace('{who}', who);
      }
    }
    document.body.classList.toggle('ws-readonly', isViewer());
    const box=$('account-menu-ws');
    if(box){
      if(!memberships.length){ box.hidden=true; box.innerHTML=''; }
      else {
        const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const row=(id,name,sub,on)=>`<button class="acct-item acct-ws${on?' is-active':''}" data-ws="${esc(id)}"><span>${esc(name)}</span><span class="muted small">${esc(sub)}</span>${on?'<span class="acct-check">✓</span>':''}</button>`;
        box.innerHTML=`<div class="acct-ws-h">${esc(tt0('team.workspaces','Etichette a cui hai accesso'))}</div>`
          +row('', tt0('team.my_account','Il mio account'), user?user.email:'', !workspace)
          +memberships.map(m=>row(m.owner_id, m.owner_label||m.owner_email||'—', tt0(m.role==='viewer'?'team.role_viewer':'team.role_editor', m.role), workspace && workspace.owner===m.owner_id)).join('');
        box.hidden=false;
      }
    }
    if(typeof window.renderTeam==='function') try{ window.renderTeam(); }catch(e){}
  }
  window.LF_renderWsUI = renderWsUI;
  /* gestione del team (titolare) */
  window.LF_teamList = async function(){
    if(!client||!user) return null;
    try{ const { data, error } = await client.from('team_members').select('email,role,created_at').eq('owner_id', user.id).order('created_at');
      if(error) return { error:error.message||'db_error' }; return data||[];
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  window.LF_teamInvite = async function(email, role, ownerLabel){
    if(!client||!user) return { error:'offline' };
    email=String(email||'').trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error:'email' };
    if(email===String(user.email||'').toLowerCase()) return { error:'self' };
    try{ const { error } = await client.from('team_members').upsert({ owner_id:user.id, email, role:role==='editor'?'editor':'viewer', owner_email:user.email, owner_label:ownerLabel||'' }, { onConflict:'owner_id,email' });
      if(error) return { error:error.message||'db_error' }; return { ok:true };
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  window.LF_teamRemove = async function(email){
    if(!client||!user) return { error:'offline' };
    try{ const { error } = await client.from('team_members').delete().eq('owner_id', user.id).eq('email', String(email).toLowerCase());
      if(error) return { error:error.message||'db_error' }; return { ok:true };
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  window.LF_isSignedIn = ()=> !!(client && user);
  document.addEventListener('click', e=>{ const b=e.target.closest('[data-ws]'); if(!b) return;
    const m=$('account-menu'); if(m) m.hidden=true; switchWorkspace(b.dataset.ws||null); });
  window.addEventListener('langchange', ()=>renderWsUI());

  /* ---------- Versioni salvate nel cloud (vedi app_state_versions in schema.sql) ---------- */
  window.LF_listVersions = async function(){
    if(!client||!user) return null;
    try{ const { data, error } = await client.from('app_state_versions').select('id,created_at,reason')
        .eq('user_id', wsId()).order('created_at', { ascending:false }).limit(30);
      if(error) return { error:error.message||'db_error' }; return data||[];
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  window.LF_getVersion = async function(id){
    if(!client||!user) return { error:'offline' };
    try{ const { data, error } = await client.from('app_state_versions').select('data').eq('id', id).eq('user_id', wsId()).maybeSingle();
      if(error||!data) return { error:(error&&error.message)||'not_found' }; return data.data;
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  // copia "adesso" nel cloud prima di un'operazione pericolosa (se il database la supporta)
  window.LF_snapshotNow = async function(){
    if(!client||!user) return;
    try{ await Promise.race([ client.rpc('lf_snapshot_now', { p_owner: wsId() }), new Promise(r=>setTimeout(r, 4000)) ]); }catch(e){}
  };
  /* ---------- Allegati (ricevute) su Supabase Storage: cartella privata dell'etichetta ---------- */
  window.LF_uploadReceipt = async function(name, blob, type){
    if(!client||!user||(workspace && workspace.role==='viewer')) return null;
    const path=wsId()+'/'+name;
    try{ const { error } = await client.storage.from('receipts').upload(path, blob, { contentType:type||'application/octet-stream', upsert:true });
      if(error) return null; return { path };
    }catch(e){ return null; }
  };
  window.LF_downloadReceipt = async function(path){
    if(!client||!user||!path) return null;
    try{ const { data, error } = await client.storage.from('receipts').download(path); return error?null:data; }catch(e){ return null; }
  };
  window.LF_deleteReceipt = async function(path){
    if(!client||!user||!path) return;
    try{ await client.storage.from('receipts').remove([path]); }catch(e){}
  };
  /* ---------- Firma remota dei contratti ---------- */
  // token dei link (firma, portale): 128 bit casuali, impossibili da indovinare
  function randToken(){ try{ return crypto.randomUUID().replace(/-/g,''); }catch(e){
    const b=new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x=>x.toString(16).padStart(2,'0')).join(''); } }
  window.LF_signLink = function(token){ try{ return new URL('firma.html?t='+encodeURIComponent(token), location.href).href; }catch(e){ return 'firma.html?t='+token; } };
  /* salva il contratto sul cloud e restituisce token + link di firma */
  window.LF_sendForSignature = async function(contract){
    if(!client) return { error:'offline' };
    if(!user) return { error:'unauthorized' };
    if(contract.status==='signed') return { error:'already_signed' };
    const token = contract.token || randToken();
    // nuovo invio: azzera firma e motivo di rifiuto di un eventuale invio precedente
    const row = { token, owner_id:wsId(), label:contract.label||'', artist_email:contract.email||'',
      data:contract, status:'sent', signature:null, reject_reason:null, updated_at:new Date().toISOString() };
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
      const { error } = await client.from('artist_shares').insert({ token, owner_id:wsId(), label_id:labelId, artist_name:name });
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
  /* elimina un contratto dal cloud: il link di firma smette di funzionare */
  window.LF_deleteContract = async function(token){
    if(!client||!user) return { error:'offline' };
    if(!token) return { ok:true };
    try{ const { error } = await client.from('contracts').delete().eq('token', token).eq('owner_id', wsId());
      if(error) return { error:error.message||'db_error' }; return { ok:true };
    }catch(e){ return { error:e.message||'db_error' }; }
  };
  /* legge lo stato firma/rifiuto dei contratti dell'utente */
  window.LF_refreshContractStatuses = async function(){
    if(!client||!user) return null;
    try{
      const { data, error } = await client.from('contracts').select('*').eq('owner_id', wsId());
      if(error) return null; return data||[];
    }catch(e){ return null; }
  };
  async function saveAccount(){
    const name=$('account-name').value.trim(), surname=$('account-surname')?$('account-surname').value.trim():'', label=$('account-label').value.trim();
    window.LF.setProfile({ name, surname, label });
    if(client && user){
      const { error } = await client.auth.updateUser({ data:{ full_name:name, last_name:surname, label_name:label } });
      setStatus(error ? tt0('sync.s_profile_err','Errore profilo: {e}').replace('{e}', error.message) : tt0('sync.s_profile_ok','Profilo salvato ✓'));
    } else setStatus(tt0('sync.s_profile_local','Profilo salvato (locale)'));
  }
  async function changePassword(){
    const st=$('pw-status'); const set=(m,ok)=>{ if(st){ st.textContent=m; st.style.color = ok?'var(--in)':'var(--out)'; } };
    if(!client || !user){ set(tt0('sync.p_need_login','Devi essere connesso per cambiare password.'),false); return; }
    const p1=$('pw-new').value, p2=$('pw-new2').value;
    if(p1.length<6){ set(tt0('sync.e_pw6','La password deve avere almeno 6 caratteri.'),false); return; }
    if(p1!==p2){ set(tt0('sync.p_mismatch','Le due password non coincidono.'),false); return; }
    set(tt0('sync.p_updating','Aggiornamento…'),true);
    const { error } = await client.auth.updateUser({ password:p1 });
    if(error){ set(authMsg(error.message),false); return; }
    $('pw-new').value=''; $('pw-new2').value='';
    set(tt0('sync.p_done','Password aggiornata ✓'),true);
    storeCred(user.email, p1);
  }
  async function changeEmail(){
    const st=$('email-status'); const set=(m,ok)=>{ if(st){ st.textContent=m; st.style.color = ok?'var(--in)':'var(--out)'; } };
    if(!client || !user){ set(tt0('sync.m_need_login','Devi essere connesso per cambiare email.'),false); return; }
    const ne=($('email-new').value||'').trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ne)){ set(tt0('sync.m_invalid','Inserisci un indirizzo email valido.'),false); return; }
    if(ne.toLowerCase()===(user.email||'').toLowerCase()){ set(tt0('sync.m_same','La nuova email è uguale a quella attuale.'),false); return; }
    set(tt0('sync.m_sending','Invio del link di conferma…'),true);
    const redirect = location.href.split('#')[0];
    const { error } = await client.auth.updateUser({ email:ne }, { emailRedirectTo: redirect });
    if(error){ set(authMsg(error.message),false); return; }
    $('email-new').value='';
    set(tt0('sync.m_sent','Ti abbiamo inviato un link di conferma a {e} (controlla anche la posta attuale). Il cambio sarà effettivo solo dopo aver cliccato il link.').replace('{e}', ne),true);
  }

  /* ---------- Recupero password: schermata dedicata "imposta nuova password" ---------- */
  function showRecovery(show){
    const el=$('recovery-screen'); if(el) el.hidden=!show;
    document.body.classList.toggle('recovery-mode', !!show);
    if(show){
      if($('rec-username')) $('rec-username').value=(user&&user.email)||'';
      if($('rec-status')) $('rec-status').textContent='';
    }
  }
  function onRecovery(){ showGate(false); showPending(false); showRecovery(true); }
  async function changeRecoveryPassword(){
    const st=$('rec-status'); const set=(m,ok)=>{ if(st){ st.textContent=m; st.style.color = ok?'var(--in)':'var(--out)'; } };
    if(!client || !user){ set(tt0('sync.r_invalid','Link non valido o scaduto. Richiedi un nuovo reset dalla schermata di accesso.'),false); return; }
    const p1=$('rec-pw').value, p2=$('rec-pw2').value;
    if(p1.length<6){ set(tt0('sync.e_pw6','La password deve avere almeno 6 caratteri.'),false); return; }
    if(p1!==p2){ set(tt0('sync.p_mismatch','Le due password non coincidono.'),false); return; }
    set(tt0('sync.r_saving','Salvataggio…'),true);
    const { error } = await client.auth.updateUser({ password:p1 });
    if(error){ set(authMsg(error.message),false); return; }
    storeCred(user.email, p1);
    $('rec-pw').value=''; $('rec-pw2').value='';
    set(tt0('sync.r_done','Password aggiornata ✓ Accesso in corso…'),true);
    setTimeout(()=>{ showRecovery(false); onAuth(); }, 900);
  }

  /* ---------- Occhio mostra/nascondi (tutti i campi password) ---------- */
  function wireEyes(){
    document.querySelectorAll('.eye-btn').forEach(eye=>{
      const wrap=eye.closest('.input-eye'); const pw=wrap&&wrap.querySelector('input'); if(!pw) return;
      eye.innerHTML=EYE;
      eye.onclick=()=>{ const show=pw.type==='password'; pw.type=show?'text':'password';
        eye.innerHTML=show?EYE_OFF:EYE; eye.setAttribute('aria-label',show?tt0('sync.eye_hide','Nascondi password'):tt0('sync.eye_show','Mostra password')); pw.focus(); };
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
      if(!url||!key){ setStatus(tt0('sync.s_need_url','Inserisci URL e chiave')); return; }
      localStorage.setItem(CFG_KEY, JSON.stringify({url,key}));
      setStatus(tt0('sync.s_conn_saved','Connessione salvata')); initClient(); showGate(true);
    });
    $('sync-signin')?.addEventListener('click', signIn);
    $('sync-signup')?.addEventListener('click', signUp);
    $('sync-signout')?.addEventListener('click', signOut);
    $('sync-pull')?.addEventListener('click', ()=>{ setStatus(tt0('sync.s_updating','Aggiorno…')); pull(); });
    $('account-save')?.addEventListener('click', saveAccount);
    $('pw-form')?.addEventListener('submit', e=>{ e.preventDefault(); changePassword(); });
    $('rec-form')?.addEventListener('submit', e=>{ e.preventDefault(); changeRecoveryPassword(); });
    $('email-save')?.addEventListener('click', changeEmail);
  }

  wire(); wireEyes();
  // modalità iniziale: registrazione se si arriva dalla landing con app.html?signup (o #signup), altrimenti login
  setGateMode(/(?:[?&]signup\b)|#signup/i.test((location.search||'')+(location.hash||'')) ? 'signup' : 'login');
  // se configurato, mostra il login subito — tranne quando su questo dispositivo c'è già la sessione
  // dello stesso account dei dati locali: allora l'app si apre subito e la sessione si verifica in background
  { const su=storedSessionUser(); showGate(!!getCfg() && !(su && localIsMine(su))); }
  // link della mail scaduto o già usato (reset password / conferma): Supabase torna qui con
  // #error_code=… → spiega cosa fare invece di lasciare la schermata di accesso muta
  (function(){
    const h=new URLSearchParams((location.hash||'').replace(/^#/,''));
    const code=h.get('error_code')||h.get('error'); if(!code) return;
    const expired=/expired|otp_expired|access_denied/i.test(code+' '+(h.get('error_description')||''));
    linkMsg = expired
      ? tt0('sync.link_expired','Il link è scaduto o è già stato usato. Inserisci la tua email e premi "Password dimenticata?" per riceverne uno nuovo.')
      : tt0('sync.link_invalid','Link non valido: {d}').replace('{d}', h.get('error_description')||code);
    showGate(true); gateStatus(linkMsg, true);
    try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
  })();
  initClient();
  renderUI();
})();
