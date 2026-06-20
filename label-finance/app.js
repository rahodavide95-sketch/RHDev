/* ============================================================================
   Label Finance — MVP gestionale entrate/uscite per etichette
   100% client-side. I dati restano nel browser (localStorage).
   Schema canonico movimento:
   { id, kind:'income'|'expense', date(ISO), platform, type, catalog,
     product, artist, isrc, upc, qty, gross, fees, net, csShare, currency, note }
   ============================================================================ */
'use strict';

const STORE_KEY = 'labelfinance.v1';
const CANON = [
  ['date','Data'], ['dateTo','Data transazione (a)'],
  ['platform','Piattaforma'], ['type','Tipologia'],
  ['catalog','Catalogo'], ['product','Prodotto/Titolo'], ['artist','Artista'],
  ['isrc','ISRC'], ['upc','UPC'], ['qty','Quantità'], ['gross','Lordo'],
  ['shipping','Spedizione'], ['taxes','Tasse'],
  ['payProcFees','Commissioni processore pagamento'], ['fees','Commissioni'],
  ['csShare','Collection society share'], ['net','Netto'], ['currency','Valuta'],
];

/* ---------- Store ---------- */
const DEFAULT_TX_ORDER = ['date','kind','platform','catalog','product','artist','qty','net','eur',
  'dateTo','type','isrc','upc','gross','shipping','taxes','payProcFees','fees','csShare','currency','note'];
const DEFAULT_TX_VISIBLE = ['date','kind','platform','catalog','product','artist','qty','net','eur'];
/* Account = piu' etichette; DB punta all'etichetta attiva. */
const DASH_BASE = ['ai','kpi','chart','g_release','g_artist','g_platform','g_type'];
const DASH_EXTRAS = ['forecast','w_top','recent']; // libreria widget opzionali (nascosti di default)
const DASH_DEFAULT_ORDER = [...DASH_BASE, ...DASH_EXTRAS];
const DASH_FULL = new Set(['ai','kpi','chart','forecast']);
const PLAN_LIMITS = { free:1, studio:3, agency:Infinity };
// capacità per piano (gating funzioni). Recoupment è incluso ovunque.
const PLAN_CAPS = {
  free:   { excel:false, batch:false, branding:false, audit:false, automations:false, team:false, ai:false, layout:false },
  studio: { excel:true,  batch:true,  branding:true,  audit:false, automations:false, team:false, ai:true,  layout:true },
  agency: { excel:true,  batch:true,  branding:true,  audit:true,  automations:true,  team:true,  ai:true,  layout:true },
};
const FEATURE_MIN = { excel:'studio', batch:'studio', branding:'studio', ai:'studio', layout:'studio', audit:'agency', automations:'agency', team:'agency' };
function planCaps(){ return PLAN_CAPS[ACCOUNT.plan] || PLAN_CAPS.free; }
function can(feat){ return !!planCaps()[feat]; }
function requireFeature(feat){
  if(can(feat)) return true;
  const planName=(PLAN_INFO[FEATURE_MIN[feat]]||{}).name||'Studio';
  toast((window.t?window.t('gate.upgrade'):'Disponibile con il piano {plan}').replace('{plan}',planName));
  goto('offers'); return false;
}
const newId = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const defaultRates = ()=>({ EUR:1, USD:0.92, GBP:1.17, CHF:1.04 });
function defaultLabel(name='La mia etichetta'){
  return { id:newId(), name, transactions:[], releases:[], profile:{name:'',label:name},
    rates:defaultRates(), mappings:{}, recoup:[],
    txOrder:DEFAULT_TX_ORDER.slice(), txHidden:DEFAULT_TX_ORDER.filter(c=>!DEFAULT_TX_VISIBLE.includes(c)) };
}
function ensureLabelShape(l){
  l.id=l.id||newId();
  l.transactions=l.transactions||[]; l.releases=l.releases||[];
  l.profile=l.profile||{name:'',label:l.name||''};
  l.rates=l.rates||defaultRates(); l.mappings=l.mappings||{}; l.recoup=l.recoup||[];
  l.dashLayout=l.dashLayout||{order:DASH_DEFAULT_ORDER.slice(), hidden:DASH_EXTRAS.slice(), cols:2};
  l.txOrder=l.txOrder||DEFAULT_TX_ORDER.slice();
  l.txHidden=l.txHidden||DEFAULT_TX_ORDER.filter(c=>!DEFAULT_TX_VISIBLE.includes(c));
  l.artists=l.artists||[]; l.tasks=l.tasks||[]; l.contracts=l.contracts||[];
  l.name=l.name||(l.profile&&l.profile.label)||'Etichetta';
  return l;
}
function defaultAccount(){ const l=defaultLabel(); return { labels:[l], activeLabel:l.id, plan:'free' }; }
function migrateAccount(raw){
  if(!raw || typeof raw!=='object') return defaultAccount();
  if(Array.isArray(raw.labels)){
    raw.plan=raw.plan||'free';
    if(!raw.labels.length) raw.labels=[defaultLabel()];
    raw.labels.forEach(ensureLabelShape);
    if(!raw.labels.find(l=>l.id===raw.activeLabel)) raw.activeLabel=raw.labels[0].id;
    return raw;
  }
  if(raw.transactions){ // vecchio formato a singola etichetta -> migra
    const name=(raw.profile&&raw.profile.label)||'La mia etichetta';
    const lab=ensureLabelShape(Object.assign(defaultLabel(name), raw, {name}));
    return { labels:[lab], activeLabel:lab.id, plan:'free' };
  }
  return defaultAccount();
}
function loadAccount(){ try{ return migrateAccount(JSON.parse(localStorage.getItem(STORE_KEY))); }catch{ return defaultAccount(); } }
let ACCOUNT = loadAccount();
function activeLabel(){ return ACCOUNT.labels.find(l=>l.id===ACCOUNT.activeLabel) || ACCOUNT.labels[0]; }
let DB = activeLabel();
function planLimit(){ return PLAN_LIMITS[ACCOUNT.plan] ?? 1; }
function saveLocal(){ localStorage.setItem(STORE_KEY, JSON.stringify(ACCOUNT)); }
function save(){ saveLocal(); if(window.LF_push) window.LF_push(); }
/* API per il modulo di sincronizzazione cloud (sync.js) — sincronizza tutto l'account */
window.LF = {
  data(){ return ACCOUNT; },
  applyCloud(d){ ACCOUNT = migrateAccount(d); DB = activeLabel(); saveLocal(); reloadViews(); if(typeof rebuildAccountMenu==='function') rebuildAccountMenu(); },
  profile(){ return DB.profile || (DB.profile={name:'',label:''}); },
  setProfile(p){ DB.profile = Object.assign(this.profile(), p||{}); if(p&&p.label) DB.name=p.label; save();
    if(typeof updateIdentity==='function') updateIdentity(); if(typeof rebuildAccountMenu==='function') rebuildAccountMenu(); },
  goto(v){ if(typeof goto==='function') goto(v); },
};
function reloadViews(){ renderDashboard(); renderTx(); renderReleases(); renderRoyalties(); renderArtists(); renderContracts(); renderTasks(); renderOffers(); renderSettings(); }
// integra eventuali colonne nuove non ancora presenti nell'ordine salvato
function ensureCols(){
  DB.txOrder = DB.txOrder || DEFAULT_TX_ORDER.slice();
  DB.txHidden = DB.txHidden || [];
  DEFAULT_TX_ORDER.forEach(c=>{ if(!DB.txOrder.includes(c)){ DB.txOrder.push(c); DB.txHidden.push(c); } });
}

/* ---------- Utils ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
/* traduzione: tt(chiave) → stringa nella lingua attiva (fallback alla chiave/italiano) */
const tt = (k)=> (window.t ? window.t(k) : k);
const COL_I18N={date:'col.date',dateTo:'col.dateTo',platform:'col.platform',type:'col.type',catalog:'col.catalog',
  product:'col.product',artist:'col.artist',qty:'col.qty',gross:'col.gross',shipping:'col.shipping',taxes:'col.taxes',
  payProcFees:'col.payProcFees',fees:'col.fees',csShare:'col.csShare',net:'col.net',currency:'col.currency',note:'col.note'};
function colLabel(c){ return (COL_I18N[c]&&window.t) ? window.t(COL_I18N[c]) : (TX_COLS[c]?TX_COLS[c].label:c); }
const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function fmtMoney(n,cur='EUR'){
  const v = Number(n)||0;
  return new Intl.NumberFormat('it-IT',{style:'currency',currency:cur}).format(v);
}
function toEur(n,cur){ const r = DB.rates[(cur||'EUR').toUpperCase()] ?? 1; return (Number(n)||0)*r; }

// Parse importi: gestisce "1.234,56", "1,234.56", "€8,70", "$8.70", "-3"
function parseAmount(raw){
  if(raw==null) return 0;
  if(typeof raw==='number') return raw;
  let s = String(raw).trim().replace(/[^\d.,\-]/g,'');
  if(!s) return 0;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if(lastComma>-1 && lastDot>-1){
    if(lastComma>lastDot){ s = s.replace(/\./g,'').replace(',','.'); }   // 1.234,56
    else { s = s.replace(/,/g,''); }                                     // 1,234.56
  } else if(lastComma>-1){
    // solo virgola: decimale se 1-2 cifre dopo, altrimenti separatore migliaia
    s = (/,\d{1,2}$/.test(s)) ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
  }
  const n = parseFloat(s); return isNaN(n)?0:n;
}

// Parse date in ISO. fmt: auto|dmy|mdy|ymd
function parseDate(raw,fmt='auto'){
  if(!raw) return '';
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // ISO
  if(m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);  // x/x/x
  if(m){
    let a=+m[1], b=+m[2], y=+m[3]; if(y<100) y+=2000;
    let day,mon;
    if(fmt==='mdy'){ mon=a; day=b; }
    else if(fmt==='ymd'){ /* unlikely here */ day=b; mon=a; }
    else if(fmt==='dmy'){ day=a; mon=b; }
    else { if(a>12){day=a;mon=b;} else if(b>12){mon=a;day=b;} else {day=a;mon=b;} } // auto, default DMY
    if(mon>12){ [day,mon]=[mon,day]; }
    return `${y}-${pad(mon)}-${pad(day)}`;
  }
  const d = new Date(s); return isNaN(d)?'':d.toISOString().slice(0,10);
}
const pad = n => String(n).padStart(2,'0');
const monthKey = iso => (iso||'').slice(0,7);

/* ---------- CSV parser ---------- */
function detectDelim(text){
  const line = text.split(/\r?\n/)[0]||'';
  const counts = {',':0,';':0,'\t':0};
  let q=false;
  for(const ch of line){ if(ch==='"') q=!q; else if(!q && ch in counts) counts[ch]++; }
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}
function parseCSV(text, delim='auto'){
  text = text.replace(/^﻿/,'');
  const d = delim==='auto' ? detectDelim(text) : (delim==='\\t'?'\t':delim);
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; }
      else cell+=c;
    } else {
      if(c==='"') q=true;
      else if(c===d){ row.push(cell); cell=''; }
      else if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
      else if(c==='\r'){ /* skip */ }
      else cell+=c;
    }
  }
  if(cell.length||row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(c=>c.trim()!==''));
}

/* ---------- Auto-mapping euristico ---------- */
const HINTS = {
  date:['date','data','sold','time','timestamp','giorno'],
  platform:['platform','store','piattaforma','retailer','shop','source','channel'],
  type:['type','tipo','format','formato','item type'],
  catalog:['catalog','cat','catalogo','catno','catalogue'],
  product:['item','product','title','titolo','prodotto','track','release','name','album'],
  artist:['artist','artista','band'],
  isrc:['isrc'],
  upc:['upc','ean','barcode'],
  qty:['qty','quantity','quantità','units','copies','count'],
  gross:['gross','lordo','amount','sale','price','revenue','subtotal'],
  shipping:['shipping','spedizione'],
  taxes:['tax','vat','iva','imposta'],
  payProcFees:['payment processor','processor fee','processor','paypal fee','stripe fee'],
  fees:['fee','fees','commission','commissioni','charge'],
  net:['net','netto','payout','net amount','net revenue','earnings','royalt'],
  csShare:['collection society','society share','collecting society','cmo','pro share','mechanical'],
  dateTo:['date to','transaction date to','to date'],
  currency:['currency','valuta','cur'],
};
function autoMap(headers){
  const map={}; const used=new Set();
  for(const [field] of CANON){
    const hints=HINTS[field]||[];
    let best=-1;
    headers.forEach((h,i)=>{
      if(used.has(i)) return;
      const hl=h.toLowerCase();
      if(hints.some(k=>hl.includes(k))){ if(best===-1) best=i; }
    });
    if(best>-1){ map[field]=best; used.add(best); }
  }
  return map;
}

/* ============================================================================
   NAVIGAZIONE
   ============================================================================ */
const VIEW_TITLES={dashboard:'Dashboard',transactions:'Movimenti',releases:'Release',royalties:'Royalty',artists:'Artisti',contracts:'Contratti',tasks:'Task',import:'Importa CSV',settings:'Impostazioni',about:'Chi siamo',offers:'Offerte & Piani',faq:'Aiuto & FAQ'};
function goto(view){
  $$('.nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('is-active',v.id==='view-'+view));
  const sec=$('#topbar-section'); if(sec) sec.textContent=VIEW_TITLES[view]||'';
  if(view==='dashboard') renderDashboard();
  if(view==='transactions') renderTx();
  if(view==='releases') renderReleases();
  if(view==='royalties') renderRoyalties();
  if(view==='artists') renderArtists();
  if(view==='contracts') renderContracts();
  if(view==='tasks') renderTasks();
  if(view==='offers') renderOffers();
  if(view==='settings') renderSettings();
  $('.main').scrollTop=0;
  updateTopbarSection();
}
$$('.nav-item').forEach(b=>b.onclick=()=>goto(b.dataset.view));
document.addEventListener('click',e=>{ const g=e.target.closest('[data-goto]'); if(g) goto(g.dataset.goto); });

/* nome sezione nella topbar: visibile solo quando il titolo sotto è scrollato via */
function updateTopbarSection(){
  const vh=document.querySelector('.view.is-active .view-head');
  const show = vh ? (vh.getBoundingClientRect().bottom < 52) : false;
  document.body.classList.toggle('show-topsec', show);
}
$('.main').addEventListener('scroll', updateTopbarSection, {passive:true});

/* pannelli Informazioni: toggle ⓘ per ogni sezione */
document.addEventListener('click',e=>{
  const b=e.target.closest('.info-btn'); if(!b) return;
  const p=document.getElementById('info-'+b.dataset.info); if(!p) return;
  p.hidden=!p.hidden;
  b.classList.toggle('is-open',!p.hidden);
  if(!p.hidden) p.scrollIntoView({behavior:'smooth',block:'nearest'});
});

/* sheet "Altro" su mobile */
const msheet=$('#mobile-more'), moreBtn=$('#nav-more');
function setMoreSheet(open){
  if(!msheet) return;
  msheet.hidden=!open;
  if(moreBtn) moreBtn.classList.toggle('is-open',open);
  document.body.classList.toggle('msheet-open',open);
}
if(moreBtn) moreBtn.onclick=()=>setMoreSheet(msheet.hidden);
if(msheet){
  msheet.addEventListener('click',e=>{
    if(e.target.closest('[data-msheet-close]')) return setMoreSheet(false);
    if(e.target.closest('.nav-item')) setMoreSheet(false); // naviga e chiudi
  });
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && msheet && !msheet.hidden) setMoreSheet(false); });

/* ===== FAQ: ricerca + accordion ===== */
function initFAQ(){
  document.addEventListener('click',e=>{
    const q=e.target.closest('.faq-q'); if(!q) return;
    const item=q.closest('.faq-item');
    const open=item.classList.toggle('is-open');
    q.setAttribute('aria-expanded', open?'true':'false');
  });
  const search=document.getElementById('faq-search');
  if(search) search.addEventListener('input',()=>{
    const term=search.value.trim().toLowerCase();
    let any=false;
    $$('.faq-item').forEach(it=>{
      const hit=!term || it.textContent.toLowerCase().includes(term);
      it.hidden=!hit; if(hit) any=true;
    });
    $$('.faq-group').forEach(g=>{
      const vis=g.querySelectorAll('.faq-item:not([hidden])').length>0;
      g.hidden=!vis;
    });
    const empty=document.getElementById('faq-empty');
    if(empty) empty.hidden=any;
  });
}

/* ===== Account: menu, etichette, piani ===== */
const PLAN_INFO={ free:{name:'Starter'}, studio:{name:'Studio'}, agency:{name:'Agency'} };
function rebuildAccountMenu(){
  const m=$('#account-menu-labels'); if(!m) return;
  const multi=ACCOUNT.labels.length>1;
  m.innerHTML=ACCOUNT.labels.map(l=>`<div class="acct-label-row ${l.id===ACCOUNT.activeLabel?'is-active':''}">
    <button class="acct-label" data-label="${l.id}">
      <span class="acct-dot"></span><span class="acct-label-name">${esc(l.name||'Etichetta')}</span>${l.id===ACCOUNT.activeLabel?'<span class="acct-check">✓</span>':''}</button>
    ${multi?`<button class="acct-del" data-del="${l.id}" title="Elimina etichetta" aria-label="Elimina">✕</button>`:''}
  </div>`).join('');
  $$('#account-menu-labels .acct-label').forEach(b=>b.onclick=()=>switchLabel(b.dataset.label));
  $$('#account-menu-labels .acct-del').forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); deleteLabel(b.dataset.del); });
  const g=$('#account-greet'); if(g) g.textContent=(DB.profile&&DB.profile.name)?DB.profile.name:tt('acct.your_labels');
  const pn=$('#account-plan'); if(pn) pn.textContent=tt('acct.plan')+' '+((PLAN_INFO[ACCOUNT.plan]||{}).name||'Starter');
  if(typeof updateAvatar==='function') updateAvatar();
}
function deleteLabel(id){
  if(ACCOUNT.labels.length<=1){ toast(tt('t.label_min')); return; }
  const lab=ACCOUNT.labels.find(l=>l.id===id); if(!lab) return;
  if(!confirm(`Eliminare l'etichetta "${lab.name||''}" e tutti i suoi dati? Operazione irreversibile.`)) return;
  ACCOUNT.labels=ACCOUNT.labels.filter(l=>l.id!==id);
  if(ACCOUNT.activeLabel===id) ACCOUNT.activeLabel=ACCOUNT.labels[0].id;
  DB=activeLabel(); save(); reloadViews(); rebuildAccountMenu(); toast(tt('t.label_deleted')); goto('dashboard');
}
function closeAccountMenu(){ const e=$('#account-menu'); if(e) e.hidden=true; }
function toggleAccountMenu(){ const e=$('#account-menu'); if(!e) return; if(e.hidden){ rebuildAccountMenu(); e.hidden=false; } else e.hidden=true; }
function switchLabel(id){
  if(!ACCOUNT.labels.find(l=>l.id===id)) return;
  ACCOUNT.activeLabel=id; DB=activeLabel(); save(); reloadViews(); rebuildAccountMenu(); closeAccountMenu();
  toast(tt('t.label_active')+(DB.name||'')); goto('dashboard');
}
function addLabelFlow(){
  closeAccountMenu();
  if(ACCOUNT.labels.length>=planLimit()){ goto('offers'); toast(tt('t.upgrade')); return; }
  const name=(prompt('Nome della nuova etichetta:')||'').trim(); if(!name) return;
  const l=defaultLabel(name); l.profile={name:(DB.profile&&DB.profile.name)||'', label:name};
  ACCOUNT.labels.push(l); ACCOUNT.activeLabel=l.id; DB=activeLabel(); save(); reloadViews(); rebuildAccountMenu();
  toast(tt('t.label_added')); goto('dashboard');
}
function setPlan(plan){
  if(!PLAN_LIMITS[plan]) return;
  ACCOUNT.plan=plan; save(); renderOffers(); rebuildAccountMenu();
  toast(tt('t.plan_activated')+((PLAN_INFO[plan]||{}).name||plan));
}
let billing='monthly';
const fmtEur=n=> '€'+(Number.isInteger(n)? n : n.toFixed(2).replace('.',','));
function renderOffers(){
  $$('#view-offers .plan-card').forEach(c=>{
    const active=ACCOUNT.plan===c.dataset.plan;
    c.classList.toggle('is-current',active);
    const btn=c.querySelector('.plan-btn'); if(btn){ btn.textContent=active?tt('off.current'):tt('off.activate'); btn.disabled=active; }
    const m=+c.dataset.monthly||0;
    const priceEl=c.querySelector('.plan-price'), noteEl=c.querySelector('.plan-note');
    if(priceEl){
      if(billing==='annual'){
        priceEl.innerHTML=`${fmtEur(m*0.7)}<span>/mese</span> <s class="plan-old">${fmtEur(m)}</s>`;
        if(noteEl) noteEl.textContent=`${tt('off.billed')} · ${fmtEur(m*12*0.7)}/${tt('off.year')} ${tt('off.instead')} ${fmtEur(m*12)}`;
      } else {
        priceEl.innerHTML=`${fmtEur(m)}<span>/mese</span>`;
        if(noteEl) noteEl.textContent='';
      }
    }
  });
  $$('#billing-toggle button').forEach(b=>b.classList.toggle('is-active',b.dataset.billing===billing));
}
$('#btn-account').onclick=e=>{ e.stopPropagation(); toggleAccountMenu(); };
document.addEventListener('click',e=>{ const m=$('#account-menu');
  if(m && !m.hidden && !m.contains(e.target) && !e.target.closest('#btn-account')) closeAccountMenu(); });
$('#acct-add').onclick=addLabelFlow;
$('#acct-offers').onclick=()=>{ closeAccountMenu(); goto('offers'); };
$('#acct-settings').onclick=()=>{ closeAccountMenu(); goto('settings'); };
$('#acct-signout').onclick=()=>{ closeAccountMenu(); if(window.LF_signOut) window.LF_signOut(); };
$$('#view-offers .plan-btn').forEach(b=>b.onclick=()=>setPlan(b.dataset.plan));
$$('#billing-toggle button').forEach(b=>b.onclick=()=>{ billing=b.dataset.billing; renderOffers(); });

/* identità: saluto in dashboard + nome label nella topbar */
function updateIdentity(){
  const p=(DB.profile)||{};
  const g=$('#greeting'); if(g) g.textContent = p.name ? `${tt('greet.hi')} ${p.name}` : tt('nav.dashboard');
  const tl=$('#topbar-label'); if(tl) tl.textContent = p.label || '';
  updateAvatar();
}

/* ---------- Foto profilo ---------- */
function profileAvatar(){ return (DB.profile && DB.profile.avatar) || ''; }
function updateAvatar(){
  const a=profileAvatar();
  const top=$('#acct-avatar-top'), svg=$('#acct-icon-svg');
  if(top){ if(a){ top.src=a; top.hidden=false; if(svg) svg.style.display='none'; } else { top.hidden=true; if(svg) svg.style.display=''; } }
  const menu=$('#acct-avatar-menu'); if(menu){ if(a){ menu.src=a; menu.hidden=false; } else menu.hidden=true; }
  const prevImg=$('#avatar-prev-img'), prev=$('#avatar-prev'), clr=$('#avatar-clear');
  if(prevImg){ if(a){ prevImg.src=a; prevImg.hidden=false; if(prev) prev.classList.add('has-img'); } else { prevImg.hidden=true; if(prev) prev.classList.remove('has-img'); } }
  if(clr) clr.hidden=!a;
}
function processAvatar(file){
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{ URL.revokeObjectURL(url);
    const S=256, c=document.createElement('canvas'); c.width=S; c.height=S; const ctx=c.getContext('2d');
    const min=Math.min(img.width,img.height), sx=(img.width-min)/2, sy=(img.height-min)/2;
    ctx.drawImage(img, sx, sy, min, min, 0, 0, S, S);
    window.LF.setProfile({ avatar:c.toDataURL('image/jpeg',0.85) }); updateAvatar();
  };
  img.onerror=()=>{ URL.revokeObjectURL(url); toast(tt('t.file_invalid')); };
  img.src=url;
}
$('#avatar-btn')?.addEventListener('click',()=>$('#avatar-input').click());
$('#avatar-input')?.addEventListener('change',e=>{ const f=e.target.files[0]; if(f) processAvatar(f); e.target.value=''; });
$('#avatar-clear')?.addEventListener('click',()=>{ window.LF.setProfile({avatar:''}); updateAvatar(); });

/* equalizer animato dello sfondo login */
(function buildGateEq(){
  const eq=$('#gate-eq'); if(!eq) return;
  let html='';
  for(let i=0;i<28;i++){
    const dur=(0.9+Math.random()*1.1).toFixed(2);
    const delay=(-Math.random()*1.4).toFixed(2);
    html+=`<i style="animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }
  eq.innerHTML=html;
})();

/* ---- Barra laterale apri/chiudi ---- */
const NAV_KEY='labelfinance.navCollapsed';
function applyNavCollapsed(){
  const c=localStorage.getItem(NAV_KEY)==='1';
  document.body.classList.toggle('nav-collapsed',c);
}
function toggleNav(force){
  const c = force!=null ? force : localStorage.getItem(NAV_KEY)!=='1';
  localStorage.setItem(NAV_KEY, c?'1':'0'); applyNavCollapsed();
}
$('#nav-collapse').onclick=()=>toggleNav();
document.querySelector('.brand').addEventListener('click',()=>{ if(document.body.classList.contains('nav-collapsed')) toggleNav(false); });
applyNavCollapsed();

function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.hidden=false;
  clearTimeout(t._t); t._t=setTimeout(()=>t.hidden=true,2200);
}

/* ============================================================================
   DASHBOARD
   ============================================================================ */
const isoD=d=>d.toISOString().slice(0,10);
function periodRange(){
  const p=$('#dash-period').value;
  const now=new Date(), today=isoD(now);
  if(p==='all') return {from:null,to:null,prevFrom:null,prevTo:null};
  if(p==='custom'){
    const f=$('#dash-from').value||null, t=$('#dash-to').value||today;
    let pf=null,pt=null;
    if(f){ const d1=new Date(f+'T00:00:00'), d2=new Date(t+'T00:00:00');
      const len=Math.max(0,d2-d1), ptD=new Date(d1.getTime()-86400000);
      pt=isoD(ptD); pf=isoD(new Date(ptD.getTime()-len)); }
    return {from:f,to:t,prevFrom:pf,prevTo:pt};
  }
  let from;
  if(p==='ytd') from=new Date(now.getFullYear(),0,1);
  else if(p==='12m') from=new Date(now.getFullYear(),now.getMonth()-11,1);
  else if(p==='6m') from=new Date(now.getFullYear(),now.getMonth()-5,1);
  else from=new Date(now.getFullYear(),now.getMonth()-2,1);
  const len=now-from, ptD=new Date(from.getTime()-86400000);
  return {from:isoD(from),to:today,prevFrom:isoD(new Date(ptD.getTime()-len)),prevTo:isoD(ptD)};
}
const inRange=(t,from,to)=>{ const d=t.date||''; if(from&&d<from) return false; if(to&&d>to) return false; return true; };
function sumKPI(txs){ let inc=0,exp=0; txs.forEach(t=>{ const v=toEur(t.net,t.currency); if(t.kind==='income') inc+=v; else exp+=Math.abs(v); }); return {inc,exp,net:inc-exp}; }
function deltaTag(cur,prev,goodUp){
  if(prev==null) return '';
  if(Math.abs(prev)<0.005) return '';
  const pct=Math.round((cur-prev)/Math.abs(prev)*100);
  if(pct===0) return '<span class="kpi-delta flat">≈ 0%</span>';
  const up=pct>0, good=(up===goodUp);
  return `<span class="kpi-delta ${good?'up':'down'}" title="rispetto al periodo precedente">${up?'▲':'▼'} ${Math.abs(pct)}%</span>`;
}
function renderDashboard(){
  updateIdentity();
  if(typeof renderAiPanel==='function') renderAiPanel();
  const all=DB.transactions;
  $('#dash-empty').hidden = all.length>0;
  const range=periodRange();
  const txs=all.filter(t=>inRange(t,range.from,range.to));
  const cur=sumKPI(txs);
  $('#kpi-income').textContent=fmtMoney(cur.inc);
  $('#kpi-expense').textContent=fmtMoney(cur.exp);
  $('#kpi-net').textContent=fmtMoney(cur.net);
  $('#kpi-net').style.color = cur.net>=0?'var(--in)':'var(--out)';
  $('#kpi-count').textContent=txs.length;
  // variazione % vs periodo precedente
  const prev = range.prevFrom ? sumKPI(all.filter(t=>inRange(t,range.prevFrom,range.prevTo))) : null;
  $('#delta-income').innerHTML = prev?deltaTag(cur.inc,prev.inc,true):'';
  $('#delta-expense').innerHTML = prev?deltaTag(cur.exp,prev.exp,false):'';
  $('#delta-net').innerHTML = prev?deltaTag(cur.net,prev.net,true):'';
  const psel=$('#dash-period');
  $('#dash-range-label').textContent = psel.value==='custom'
    ? ((range.from||'inizio')+' → '+(range.to||'oggi'))
    : psel.selectedOptions[0].textContent;

  // monthly chart
  const months={};
  txs.forEach(t=>{ const k=monthKey(t.date)||'—'; (months[k]??={in:0,out:0}); const v=toEur(t.net,t.currency);
    if(t.kind==='income') months[k].in+=v; else months[k].out+=Math.abs(v); });
  const keys=Object.keys(months).sort().slice(-12);
  const max=Math.max(1,...keys.map(k=>Math.max(months[k].in,months[k].out)));
  $('#chart-monthly').innerHTML = keys.length? keys.map(k=>`
    <div class="bar-col">
      <div class="bars">
        <div class="bar bar--in" style="height:${months[k].in/max*160}px" title="Entrate ${fmtMoney(months[k].in)}"></div>
        <div class="bar bar--out" style="height:${months[k].out/max*160}px" title="Uscite ${fmtMoney(months[k].out)}"></div>
      </div>
      <span class="bar-label">${k}</span>
    </div>`).join('') : `<p class="muted">${tt('empty.noperiod')}</p>`;

  dashTxs=txs;
  renderGroupTables();
  renderExtraWidgets(txs);
  if(typeof setupDashWidgets==='function') setupDashWidgets();
  const edBtn=$('#btn-dash-edit'); if(edBtn) edBtn.hidden = !can('layout');
}
/* card dashboard con filtro + ordinamento */
const GROUP_TABLES=[
  {sel:'#table-release',key:'catalog',label:'Catalogo',i18n:'col.catalog'},
  {sel:'#table-artist',key:'artist',label:'Artista',i18n:'col.artist'},
  {sel:'#table-platform',key:'platform',label:'Piattaforma',i18n:'col.platform'},
  {sel:'#table-type',key:'type',label:'Tipologia',i18n:'col.type'},
];
let dashTxs=[]; const dashSort={}, dashFilter={};

/* ============================================================================
   PAGINAZIONE RIUSABILE — max righe per pagina + selettore pagina, ovunque
   ============================================================================ */
const PAGE_DEFAULT=15;
const PAGE_OPTIONS=[10,15,25,50,'all'];
const pageState={};
function pageGet(key){ return pageState[key]||(pageState[key]={page:1, per:PAGE_DEFAULT}); }
function paginate(arr, key){
  const st=pageGet(key); const total=arr.length;
  const per = st.per==='all' ? (total||1) : st.per;
  const pages=Math.max(1, Math.ceil(total/per));
  if(st.page>pages) st.page=pages; if(st.page<1) st.page=1;
  const start=(st.page-1)*per;
  const slice = st.per==='all' ? arr.slice() : arr.slice(start, start+per);
  return { slice, total, pages, page:st.page, per:st.per };
}
function pagerHTML(key, info){
  const {total, pages, page, per}=info;
  if(total<=0) return '';
  const opts=PAGE_OPTIONS.map(o=>`<option value="${o}" ${String(per)===String(o)?'selected':''}>${o==='all'?tt('pg.all'):o}</option>`).join('');
  const realPer = per==='all'?total:per;
  const from=total?((page-1)*realPer+1):0, to=Math.min(total, page*realPer);
  return `<div class="pager" data-pager="${key}" data-pages="${pages}">
    <label class="pager-per">${tt('pg.per')} <select class="select pager-per-sel">${opts}</select></label>
    <span class="pager-info">${from}–${to} ${tt('pg.of')} ${total}</span>
    <span class="pager-nav">
      <button class="pager-btn" data-pg="first" ${page<=1?'disabled':''} aria-label="Prima">«</button>
      <button class="pager-btn" data-pg="prev" ${page<=1?'disabled':''} aria-label="Precedente">‹</button>
      <span class="pager-page">${page}/${pages}</span>
      <button class="pager-btn" data-pg="next" ${page>=pages?'disabled':''} aria-label="Successiva">›</button>
      <button class="pager-btn" data-pg="last" ${page>=pages?'disabled':''} aria-label="Ultima">»</button>
    </span></div>`;
}
function mountPager(anchor, key, info){
  if(!anchor) return;
  const after = anchor.closest('.table-wrap') || anchor;
  let m=after.nextElementSibling;
  if(!m || !m.classList || !m.classList.contains('pager-mount')){
    m=document.createElement('div'); m.className='pager-mount';
    after.parentNode.insertBefore(m, after.nextSibling);
  }
  m.innerHTML=pagerHTML(key, info);
}
function clearPagerAfter(anchor){ if(!anchor) return; const after=anchor.closest('.table-wrap')||anchor;
  const m=after.nextElementSibling; if(m&&m.classList&&m.classList.contains('pager-mount')) m.innerHTML=''; }
const PAGER_RENDER={
  tx:()=>applyTxFilters(), rel:()=>renderReleases(), roy:()=>renderRoyalties(),
  recoup:()=>renderRecoup(), artists:()=>renderArtists(), contracts:()=>renderContracts(), tasks:()=>renderTasks(),
};
function pagerRerender(key){
  if(PAGER_RENDER[key]) return PAGER_RENDER[key]();
  if(key.indexOf('g:')===0){ const sel=key.slice(2); const cfg=GROUP_TABLES.find(c=>c.sel===sel); if(cfg) renderGroupTable(cfg); }
}
document.addEventListener('change', e=>{
  const sel=e.target.closest('.pager-per-sel'); if(!sel) return;
  const p=sel.closest('.pager'); const key=p.dataset.pager; const st=pageGet(key);
  st.per = sel.value==='all'?'all':+sel.value; st.page=1; pagerRerender(key);
});
document.addEventListener('click', e=>{
  const b=e.target.closest('.pager-btn'); if(!b) return;
  const p=b.closest('.pager'); const key=p.dataset.pager; const st=pageGet(key); const pages=+p.dataset.pages||1;
  const act=b.dataset.pg;
  if(act==='first') st.page=1; else if(act==='prev') st.page=Math.max(1,st.page-1);
  else if(act==='next') st.page=Math.min(pages,st.page+1); else if(act==='last') st.page=pages;
  pagerRerender(key);
});

/* ============================================================================
   VISTA elenco/cards (Release · Royalty · Artisti)
   ============================================================================ */
const VIEWMODE_KEY='labelfinance.viewmode';
let viewMode={};
try{ viewMode=JSON.parse(localStorage.getItem(VIEWMODE_KEY))||{}; }catch(e){}
function getVM(sec, def){ return viewMode[sec]||def; }
function setVM(sec, m){ viewMode[sec]=m; try{ localStorage.setItem(VIEWMODE_KEY, JSON.stringify(viewMode)); }catch(e){}
  if(sec==='artists') renderArtists(); else if(sec==='releases') renderReleases(); else if(sec==='royalties') renderRoyalties();
  syncVMButtons(); }
function syncVMButtons(){ $$('.vm-toggle').forEach(t=>{ const m=getVM(t.dataset.vmSec, t.dataset.vmDef||'cards');
  t.querySelectorAll('.vm-btn').forEach(b=>b.classList.toggle('is-active', b.dataset.vm===m)); }); }
document.addEventListener('click', e=>{ const b=e.target.closest('.vm-btn'); if(!b) return;
  const t=b.closest('.vm-toggle'); if(t) setVM(t.dataset.vmSec, b.dataset.vm); });

function computeGroup(cfg){
  const {sel,key}=cfg;
  const sort=dashSort[sel]||(dashSort[sel]={col:'net',dir:-1});
  const flt=(dashFilter[sel]||'').toLowerCase();
  const g={};
  dashTxs.forEach(t=>{ const k=(t[key]||'—'); (g[k]??={in:0,out:0}); const v=toEur(t.net,t.currency);
    if(t.kind==='income') g[k].in+=v; else g[k].out+=Math.abs(v); });
  let rows=Object.entries(g).map(([k,v])=>({k,...v,net:v.in-v.out}));
  if(flt) rows=rows.filter(r=>r.k.toLowerCase().includes(flt));
  rows.sort((a,b)=>{ if(sort.col==='k') return a.k.toLowerCase().localeCompare(b.k.toLowerCase())*sort.dir;
    return (a[sort.col]-b[sort.col])*sort.dir; });
  return rows;
}
function renderGroupTable(cfg){
  const {sel}=cfg;
  const label=(cfg.i18n&&window.t)?window.t(cfg.i18n):cfg.label;
  const gin=tt('g.income'), gout=tt('g.expense'), gmar=tt('g.margin');
  const sort=dashSort[sel]||(dashSort[sel]={col:'net',dir:-1});
  const allRows=computeGroup(cfg);
  const info=paginate(allRows, 'g:'+sel); const rows=info.slice;
  const cols=[['k',label,0],['in',gin,1],['out',gout,1],['net',gmar,1]];
  const head=cols.map(([id,lab,num])=>{ const act=sort.col===id?(sort.dir>0?' ▲':' ▼'):'';
    return `<th class="th-sort ${num?'num':''}" data-col="${id}">${esc(lab)}${act}</th>`; }).join('');
  const body=rows.length?rows.map(r=>`<tr><td data-label="${esc(label)}">${esc(r.k)}</td>
     <td class="num pos" data-label="${esc(gin)}">${fmtMoney(r.in)}</td><td class="num neg" data-label="${esc(gout)}">${fmtMoney(r.out)}</td>
     <td class="num ${r.net>=0?'pos':'neg'}" data-label="${esc(gmar)}">${fmtMoney(r.net)}</td></tr>`).join('')
     :'<tr><td colspan="4" class="muted">—</td></tr>';
  $(sel).innerHTML=`<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  mountPager($(sel), 'g:'+sel, info);
  const cs=document.querySelector(`.card-sort[data-table="${sel}"]`);
  if(cs){ const v=sort.col+':'+sort.dir; if([...cs.options].some(o=>o.value===v)) cs.value=v; }
  $$(`${sel} thead th[data-col]`).forEach(th=>th.onclick=()=>{
    const c=th.dataset.col; if(sort.col===c) sort.dir*=-1; else { sort.col=c; sort.dir=c==='k'?1:-1; }
    renderGroupTable(cfg);
  });
}
function renderGroupTables(){ GROUP_TABLES.forEach(renderGroupTable); }
$$('.card-filter').forEach(inp=>inp.oninput=()=>{
  dashFilter[inp.dataset.table]=inp.value;
  const cfg=GROUP_TABLES.find(c=>c.sel===inp.dataset.table); if(cfg) renderGroupTable(cfg);
});
/* Ordinamento da mobile per le tabelle dashboard (le intestazioni sono nascoste) */
$$('.card-sort').forEach(sel=>sel.onchange=()=>{
  const [col,dir]=sel.value.split(':'); dashSort[sel.dataset.table]={col, dir:+dir};
  const cfg=GROUP_TABLES.find(c=>c.sel===sel.dataset.table); if(cfg) renderGroupTable(cfg);
});

/* ============================================================================
   EXPORT — CSV / Excel / PDF per ogni sezione/card
   ============================================================================ */
const EXPORTERS={};
const registerExport=(name,fn)=>{ EXPORTERS[name]=fn; };
let curExport=null;
const xmlEsc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function csvOf(headers,rows){ return [headers,...rows].map(r=>r.map(csvCell).join(',')).join('\n'); }
function xlsOf(headers,rows){
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>`+
    `<table border="1"><thead><tr>${headers.map(h=>`<th>${xmlEsc(h)}</th>`).join('')}</tr></thead>`+
    `<tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${xmlEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
function printTableDoc(title,headers,rows){
  $('#print-area').innerHTML=`<div class="stmt">
    <div class="stmt-head"><img src="icon.png?v=3" alt="" class="stmt-logo"><div><div class="stmt-brand">Label<span class="lf-fin">Finance</span></div><div class="stmt-doc">${esc(title)}</div></div></div>
    <table class="stmt-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="stmt-foot">Label Finance · ${esc(DB.name||'')} · ${new Date().toLocaleDateString('it-IT')}</p></div>`;
  document.body.classList.add('print-statement'); window.print();
  setTimeout(()=>document.body.classList.remove('print-statement'),600);
}
function doExport(name,fmt){
  if(fmt==='excel' && !requireFeature('excel')) return;
  const fn=EXPORTERS[name]; if(!fn) return;
  const {title,headers,rows}=fn();
  const fname=(title||'export').replace(/[^\w\-]+/g,'_');
  if(fmt==='csv') download(fname+'.csv', csvOf(headers,rows), 'text/csv');
  else if(fmt==='excel') download(fname+'.xls', xlsOf(headers,rows), 'application/vnd.ms-excel');
  else printTableDoc(title,headers,rows);
}
document.addEventListener('click',e=>{
  const trg=e.target.closest('.btn-export');
  const menu=$('#export-menu');
  if(trg){ e.stopPropagation(); curExport=trg.dataset.export;
    const ex=menu.querySelector('[data-fmt="excel"]'); if(ex) ex.classList.toggle('is-locked', !can('excel'));
    const r=trg.getBoundingClientRect();
    menu.style.top=(r.bottom+6)+'px'; menu.style.left=Math.max(8,Math.min(r.left,innerWidth-140))+'px';
    menu.hidden=false; return; }
  if(menu && !menu.hidden && !menu.contains(e.target)) menu.hidden=true;
});
$$('#export-menu button').forEach(b=>b.onclick=()=>{ $('#export-menu').hidden=true; if(curExport) doExport(curExport,b.dataset.fmt); });

/* dati esportabili per sezione */
registerExport('movimenti', ()=>{
  const cols=CANON;
  const headers=['Tipo',...cols.map(c=>c[1]),'Nota'];
  const rows=DB.transactions.map(t=>[t.kind==='income'?'Entrata':'Uscita',...cols.map(c=>{
    const v=t[c[0]]; return (typeof v==='number')?v:(v??''); }), t.note||'']);
  return {title:'Movimenti — '+(DB.name||''), headers, rows};
});
GROUP_TABLES.forEach(cfg=>registerExport('group:'+cfg.sel, ()=>{
  const rows=computeGroup(cfg).map(r=>[r.k, +r.in.toFixed(2), +r.out.toFixed(2), +r.net.toFixed(2)]);
  return {title:cfg.label, headers:[cfg.label,'Entrate (€)','Uscite (€)','Margine (€)'], rows};
}));
registerExport('releases', ()=>{
  const rows=releases().map(r=>{ const tot=(r.splits||[]).reduce((s,x)=>s+(+x.pct||0),0);
    const splits=(r.splits||[]).map(s=>`${s.name} ${(+s.pct||0)}%`).join(' · ');
    return [r.catalog, r.title||'', r.year||'', splits, Math.max(0,100-tot)+'%']; });
  return {title:'Release', headers:['Catalogo','Titolo','Anno','Quote artisti','Quota label'], rows};
});
registerExport('royalty', ()=>{
  const {byArtist,labelTotal}=computeRoyalties();
  const rows=Object.entries(byArtist).map(([n,v])=>[n, +v.total.toFixed(2)]).sort((a,b)=>b[1]-a[1]);
  rows.push(['Label (quota residua)', +labelTotal.toFixed(2)]);
  return {title:'Royalty — '+(DB.name||''), headers:['Artista','Royalty (€)'], rows};
});
function syncCustomDates(){ const cu=$('#dash-period').value==='custom'; $('#dash-from').hidden=!cu; $('#dash-to').hidden=!cu; }
$('#dash-period').onchange=()=>{ syncCustomDates(); renderDashboard(); };
$('#dash-from').onchange=$('#dash-to').onchange=renderDashboard;
syncCustomDates();
$('#btn-print').onclick=()=>{ document.body.classList.add('printing'); window.print(); setTimeout(()=>document.body.classList.remove('printing'),500); };

/* onboarding: dati dimostrativi */
function loadDemo(){
  if(DB.transactions.length && !confirm('Caricare i dati dimostrativi in questa etichetta?')) return;
  releases().push({ id:uid(), catalog:'SC-DEMO', title:'Demo EP', year:new Date().getFullYear(),
    splits:[{name:'Raho',pct:50},{name:'Jacom',pct:30}], tracks:[] });
  const plats=['Bandcamp','Beatport','Spotify'], arts=['Raho','Jacom'], now=new Date(), tx=[];
  for(let m=5;m>=0;m--) for(let i=0;i<3;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-m,3+i*7);
    tx.push({ id:uid(), kind:'income', date:d.toISOString().slice(0,10), platform:plats[(m+i)%3],
      type:'digital', catalog:'SC-DEMO', product:'Demo EP', artist:arts[i%2], isrc:'', upc:'',
      qty:1+(i%3), gross:0, fees:0, net:+(5+Math.random()*20).toFixed(2), csShare:0, currency:'EUR', note:'demo' });
  }
  tx.push({ id:uid(), kind:'expense', date:new Date(now.getFullYear(),now.getMonth()-4,10).toISOString().slice(0,10), platform:'', type:'expense', catalog:'SC-DEMO', product:'Mastering', artist:'', qty:1, gross:0, fees:0, net:80, csShare:0, currency:'EUR', note:'demo' });
  tx.push({ id:uid(), kind:'expense', date:new Date(now.getFullYear(),now.getMonth()-2,15).toISOString().slice(0,10), platform:'', type:'expense', catalog:'SC-DEMO', product:'Artwork', artist:'', qty:1, gross:0, fees:0, net:120, csShare:0, currency:'EUR', note:'demo' });
  DB.transactions.push(...tx); save(); reloadViews(); toast(tt('t.demo_loaded')); goto('dashboard');
}
$('#btn-demo')?.addEventListener('click', loadDemo);
$('#btn-onb-income')?.addEventListener('click', ()=>{ curKind='income'; openTx(null); });

/* ============================================================================
   MOVIMENTI
   ============================================================================ */
const moneyCell=(v,t)=> v?fmtMoney(v,t.currency||'EUR'):'';
const TX_COLS = {
  date:    {label:'Data',        cell:t=>esc(t.date)},
  dateTo:  {label:'Data (a)',    cell:t=>esc(t.dateTo)},
  kind:    {label:'',            cell:t=>`<span class="pill ${t.kind==='income'?'pill--in':'pill--out'}">${t.kind==='income'?'IN':'OUT'}</span>`},
  platform:{label:'Piattaforma', cell:t=>esc(t.platform)},
  type:    {label:'Tipologia',   cell:t=>esc(t.type)},
  catalog: {label:'Catalogo',    cell:t=>esc(t.catalog)},
  product: {label:'Prodotto',    cell:t=>esc(t.product)},
  artist:  {label:'Artista',     cell:t=>esc(t.artist)},
  isrc:    {label:'ISRC',        cell:t=>esc(t.isrc)},
  upc:     {label:'UPC',         cell:t=>esc(t.upc||t.code)},
  qty:     {label:'Q.tà', num:1, cell:t=>t.qty||''},
  gross:   {label:'Lordo', num:1,cell:t=>moneyCell(t.gross,t)},
  shipping:{label:'Spedizione', num:1, cell:t=>moneyCell(t.shipping,t)},
  taxes:   {label:'Tasse', num:1,cell:t=>moneyCell(t.taxes,t)},
  payProcFees:{label:'Comm. processore', num:1, cell:t=>moneyCell(t.payProcFees,t)},
  fees:    {label:'Commissioni', num:1, cell:t=>moneyCell(t.fees,t)},
  csShare: {label:'Coll. society', num:1, cell:t=>moneyCell(t.csShare,t)},
  net:     {label:'Netto', num:1,cell:t=>fmtMoney(t.net,t.currency||'EUR')},
  currency:{label:'Valuta',      cell:t=>esc(t.currency)},
  eur:     {label:'€', num:1,    cell:t=>`<span class="${t.kind==='income'?'pos':'neg'}">${fmtMoney((t.kind==='income'?1:-1)*toEur(t.net,t.currency))}</span>`},
  note:    {label:'Nota',        cell:t=>esc(t.note)},
};
function visibleCols(){ ensureCols(); return DB.txOrder.filter(c=>!DB.txHidden.includes(c) && TX_COLS[c]); }

const NUM_COLS=['qty','gross','shipping','taxes','payProcFees','fees','csShare','net'];
let txSort={ col:'date', dir:-1 };   // -1 = decrescente
function txSortKey(c,t){
  if(c==='eur') return (t.kind==='income'?1:-1)*toEur(t.net,t.currency);
  if(c==='kind') return t.kind||'';
  if(NUM_COLS.includes(c)) return +t[c]||0;
  if(c==='date'||c==='dateTo') return t[c]||'';
  if(c==='upc') return (t.upc||t.code||'').toLowerCase();
  return (t[c]||'').toString().toLowerCase();
}

function renderTx(){
  const platSel=$('#tx-filter-platform');
  const plats=[...new Set(DB.transactions.map(t=>t.platform).filter(Boolean))].sort();
  platSel.innerHTML=`<option value="">${tt('tx.all_platforms')}</option>`+plats.map(p=>`<option>${esc(p)}</option>`).join('');
  applyTxFilters();
}
function applyTxFilters(){
  const q=$('#tx-search').value.toLowerCase().trim();
  const kind=$('#tx-filter-kind').value, plat=$('#tx-filter-platform').value;
  const r=computeRange($('#tx-period'), $('#tx-from'), $('#tx-to'));
  const from=r.from, to=r.to;
  let rows=DB.transactions.slice();
  if(kind) rows=rows.filter(t=>t.kind===kind);
  if(plat) rows=rows.filter(t=>t.platform===plat);
  if(from) rows=rows.filter(t=>(t.date||'')>=from);
  if(to)   rows=rows.filter(t=>(t.date||'')<=to);
  if(q) rows=rows.filter(t=>[t.product,t.artist,t.catalog,t.platform,t.isrc,t.upc,t.code,t.note].join(' ').toLowerCase().includes(q));
  const k=txSort.col;
  rows.sort((a,b)=>{ const va=txSortKey(k,a), vb=txSortKey(k,b);
    const r=(typeof va==='number')?(va-vb):String(va).localeCompare(String(vb)); return r*txSort.dir; });
  $('#tx-count-label').textContent=`${rows.length} ${tt('tx.movements')}`;
  const ss=$('#tx-sort'); if(ss){ const v=txSort.col+':'+txSort.dir; if([...ss.options].some(o=>o.value===v)) ss.value=v; }
  const info=paginate(rows,'tx'); const pageRows=info.slice;
  const cols=visibleCols();
  const head=cols.map(c=>{ const act=txSort.col===c?(txSort.dir>0?' ▲':' ▼'):'';
    return `<th class="th-sort ${TX_COLS[c].num?'num':''}" data-col="${c}">${esc(colLabel(c))}${act}</th>`; }).join('');
  const body=pageRows.length
    ? pageRows.map(t=>`<tr data-id="${t.id}">${cols.map(c=>`<td class="${TX_COLS[c].num?'num':''}" data-label="${esc(colLabel(c))}">${TX_COLS[c].cell(t)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length||1}" class="muted">${tt('empty.notx')}</td></tr>`;
  $('#table-tx').innerHTML=`<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  mountPager($('#table-tx'), 'tx', info);
  $$('#table-tx thead th[data-col]').forEach(th=>th.onclick=()=>{
    const c=th.dataset.col;
    if(txSort.col===c) txSort.dir*=-1; else txSort={col:c, dir:TX_COLS[c].num?-1:1};
    applyTxFilters();
  });
  $$('#table-tx tbody tr[data-id]').forEach(tr=>tr.onclick=()=>openTx(tr.dataset.id));
}
['#tx-search','#tx-filter-kind','#tx-filter-platform','#tx-from','#tx-to'].forEach(s=>{
  $(s).addEventListener('input',applyTxFilters); $(s).addEventListener('change',applyTxFilters);
});
function syncTxDates(){ const cu=$('#tx-period').value==='custom'; $('#tx-from').hidden=!cu; $('#tx-to').hidden=!cu; }
$('#tx-period').addEventListener('change',()=>{ syncTxDates(); applyTxFilters(); });
syncTxDates();
/* Ordinamento da mobile per i Movimenti (intestazioni nascoste a schede) */
const txSortSel=$('#tx-sort');
if(txSortSel) txSortSel.addEventListener('change',()=>{
  const [col,dir]=txSortSel.value.split(':'); txSort={col, dir:+dir}; applyTxFilters();
});

/* ---------- Gestione colonne (mostra/nascondi + ordine) ---------- */
function renderColsManager(){
  ensureCols();
  $('#cols-list').innerHTML = DB.txOrder.filter(c=>TX_COLS[c]).map(c=>`
    <li class="col-item" data-col="${c}">
      <label class="col-check"><input type="checkbox" ${DB.txHidden.includes(c)?'':'checked'} data-col-toggle="${c}">
        <span>${esc(colLabel(c))||'(IN/OUT)'}</span></label>
      <span class="col-moves">
        <button type="button" data-col-up="${c}" title="Sposta su">↑</button>
        <button type="button" data-col-down="${c}" title="Sposta giù">↓</button>
      </span>
    </li>`).join('');
  $$('[data-col-toggle]').forEach(b=>b.onchange=()=>{
    const c=b.dataset.colToggle;
    if(b.checked) DB.txHidden=DB.txHidden.filter(x=>x!==c);
    else if(!DB.txHidden.includes(c)) DB.txHidden.push(c);
    save(); applyTxFilters();
  });
  $$('[data-col-up]').forEach(b=>b.onclick=()=>moveCol(b.dataset.colUp,-1));
  $$('[data-col-down]').forEach(b=>b.onclick=()=>moveCol(b.dataset.colDown,1));
}
function moveCol(c,dir){
  ensureCols();
  const arr=DB.txOrder, i=arr.indexOf(c), j=i+dir;
  if(i<0||j<0||j>=arr.length) return;
  [arr[i],arr[j]]=[arr[j],arr[i]]; save(); renderColsManager(); applyTxFilters();
}
$('#btn-cols').onclick=()=>{ renderColsManager(); $('#cols-modal').hidden=false; };
$('#cols-close').onclick=$('#cols-done').onclick=()=>$('#cols-modal').hidden=true;
$('#cols-modal').onclick=e=>{ if(e.target.id==='cols-modal') $('#cols-modal').hidden=true; };
$('#cols-reset').onclick=()=>{
  DB.txOrder=DEFAULT_TX_ORDER.slice();
  DB.txHidden=DEFAULT_TX_ORDER.filter(c=>!DEFAULT_TX_VISIBLE.includes(c));
  save(); renderColsManager(); applyTxFilters();
};

/* ============================================================================
   RELEASE (anagrafica + quote royalty)
   release = { id, catalog, title, year, splits:[{name, pct}] }
   ============================================================================ */
function releases(){ return DB.releases || (DB.releases=[]); }
function releaseByCatalog(cat){
  if(!cat) return null;
  const c=cat.trim().toLowerCase();
  return releases().find(r=>(r.catalog||'').trim().toLowerCase()===c) || null;
}
function renderReleases(){
  const all=releases().slice().sort((a,b)=>(a.catalog||'').localeCompare(b.catalog||''));
  $('#rel-count-label').textContent=`${all.length} release`;
  const info=paginate(all,'rel'); const list=info.slice;
  const cont=$('#releases-cards'); const mode=getVM('releases','cards');
  if(!list.length){ cont.className='releases-cards'; cont.innerHTML=`<p class="muted">${tt('empty.norel')}</p>`; mountPager(cont,'rel',info); syncVMButtons(); return; }
  if(mode==='list'){
    cont.className='release-list';
    cont.innerHTML = list.map(r=>{
      const tot=(r.splits||[]).reduce((s,x)=>s+(+x.pct||0),0); const label=Math.max(0,100-tot);
      const who=(r.splits||[]).map(s=>esc(s.name)+' '+(+s.pct||0)+'%').join(' · ')+(label?` · Label ${label}%`:'');
      return `<div class="release-lrow" data-id="${r.id}">
        <span class="release-cat">${esc(r.catalog)}</span>
        <span class="release-lname">${esc(r.title)||'—'}</span>
        <span class="muted small">${r.year||''}</span>
        <span class="release-lsplit muted small">${who}</span>
        ${(r.tracks&&r.tracks.length)?`<span class="release-ltag">${r.tracks.length} ISRC</span>`:'<span></span>'}
      </div>`;
    }).join('');
  } else {
    cont.className='releases-cards';
    cont.innerHTML = list.map(r=>{
      const tot=(r.splits||[]).reduce((s,x)=>s+(+x.pct||0),0); const label=Math.max(0,100-tot);
      const chips=(r.splits||[]).map(s=>`<span class="split-chip">${esc(s.name)} <b>${(+s.pct||0)}%</b></span>`).join('')
        + `<span class="split-chip split-chip--label">Label <b>${label}%</b></span>`;
      return `<div class="release-card" data-id="${r.id}">
        <div class="release-card-head">
          <div><span class="release-cat">${esc(r.catalog)}</span>
            <span class="release-title">${esc(r.title)||''}</span></div>
          <span class="muted small">${r.year||''}</span>
        </div>
        <div class="split-chips">${chips}</div>
        ${(r.tracks&&r.tracks.length)?`<div class="release-tracks muted small">${r.tracks.length} tracc${r.tracks.length===1?'ia':'e'} con override</div>`:''}
      </div>`;
    }).join('');
  }
  cont.querySelectorAll('[data-id]').forEach(c=>c.onclick=()=>openRelease(c.dataset.id));
  mountPager(cont,'rel',info);
  syncVMButtons();
}

/* ---------- Modal release ---------- */
function splitRowHTML(name='',pct=''){
  return `<div class="split-row">
    <input class="input split-name" list="artist-list" placeholder="Nome artista" value="${esc(name)}">
    <input class="input split-pct" type="number" min="0" max="100" step="0.01" placeholder="%" value="${pct===''?'':esc(pct)}">
    <button type="button" class="btn split-del" title="Rimuovi">✕</button>
  </div>`;
}
function artistDatalist(){
  const names=new Set();
  releases().forEach(r=>(r.splits||[]).forEach(s=>s.name&&names.add(s.name)));
  DB.transactions.forEach(t=>t.artist&&names.add(t.artist));
  let dl=document.getElementById('artist-list');
  if(!dl){ dl=document.createElement('datalist'); dl.id='artist-list'; document.body.appendChild(dl); }
  dl.innerHTML=[...names].sort().map(n=>`<option value="${esc(n)}">`).join('');
}
function refreshSplitTotal(){
  let tot=0; $$('#r-splits .split-pct').forEach(i=>tot+=(+i.value||0));
  const el=$('#r-split-total');
  el.textContent = `Totale artisti ${tot}% · Label ${Math.max(0,100-tot)}%` + (tot>100?' ⚠ supera 100%':'');
  el.style.color = tot>100 ? 'var(--out)' : 'var(--muted)';
}
function trackBlockHTML(t={}){
  const splits=(t.splits&&t.splits.length)?t.splits:[{name:'',pct:''}];
  return `<div class="track-block">
    <div class="track-head">
      <input class="input track-title" placeholder="Titolo traccia" value="${esc(t.title||'')}">
      <input class="input track-isrc" placeholder="ISRC" value="${esc(t.isrc||'')}">
      <button type="button" class="btn track-del" title="Rimuovi traccia">✕</button>
    </div>
    <div class="track-splits">${splits.map(s=>splitRowHTML(s.name,s.pct)).join('')}</div>
    <button type="button" class="btn btn-mini track-add-split">+ artista</button>
  </div>`;
}
function collectSplits(container){
  const out=[];
  container.querySelectorAll('.split-row').forEach(row=>{
    const name=row.querySelector('.split-name').value.trim();
    const pct=+row.querySelector('.split-pct').value||0;
    if(name) out.push({name,pct});
  });
  return out;
}
function openRelease(id){
  const r = id ? releases().find(x=>x.id===id) : null;
  artistDatalist();
  $('#rel-modal-title').textContent = r ? tt('rel.modal.edit') : tt('rel.modal.new');
  $('#r-id').value=r?.id||'';
  $('#r-catalog').value=r?.catalog||''; $('#r-title').value=r?.title||''; $('#r-year').value=r?.year||'';
  const splits = (r?.splits&&r.splits.length) ? r.splits : [{name:'',pct:''}];
  $('#r-splits').innerHTML = splits.map(s=>splitRowHTML(s.name,s.pct)).join('');
  $('#r-tracks').innerHTML = (r?.tracks||[]).map(t=>trackBlockHTML(t)).join('');
  refreshSplitTotal();
  $('#r-delete').hidden=!r;
  $('#rel-modal').hidden=false;
}
$('#btn-add-release').onclick=()=>openRelease(null);
$('#rel-modal-close').onclick=$('#r-cancel').onclick=()=>$('#rel-modal').hidden=true;
$('#rel-modal').onclick=e=>{ if(e.target.id==='rel-modal') $('#rel-modal').hidden=true; };
$('#r-add-split').onclick=()=>{ $('#r-splits').insertAdjacentHTML('beforeend',splitRowHTML()); refreshSplitTotal(); };
$('#r-add-track').onclick=()=>{ $('#r-tracks').insertAdjacentHTML('beforeend',trackBlockHTML()); };
$('#rel-form').addEventListener('click', e=>{ const t=e.target;
  if(t.classList.contains('split-del')){ t.closest('.split-row').remove(); refreshSplitTotal(); }
  else if(t.classList.contains('track-del')){ t.closest('.track-block').remove(); }
  else if(t.classList.contains('track-add-split')){ t.closest('.track-block').querySelector('.track-splits').insertAdjacentHTML('beforeend', splitRowHTML()); }
});
$('#rel-form').addEventListener('input', e=>{ if(e.target.classList.contains('split-pct') && e.target.closest('#r-splits')) refreshSplitTotal(); });
$('#r-delete').onclick=()=>{
  const id=$('#r-id').value;
  DB.releases=releases().filter(r=>r.id!==id); save();
  $('#rel-modal').hidden=true; renderReleases(); renderRoyalties(); toast(tt('t.rel_deleted'));
};
$('#rel-form').onsubmit=e=>{
  e.preventDefault();
  const id=$('#r-id').value;
  const splits=collectSplits($('#r-splits'));
  const tracks=[];
  $$('#r-tracks .track-block').forEach(tb=>{
    const title=tb.querySelector('.track-title').value.trim();
    const isrc=tb.querySelector('.track-isrc').value.trim();
    const tsplits=collectSplits(tb.querySelector('.track-splits'));
    if(title||isrc||tsplits.length) tracks.push({id:uid(), title, isrc, splits:tsplits});
  });
  const rec={ id:id||uid(), catalog:$('#r-catalog').value.trim(), title:$('#r-title').value.trim(),
    year:Number($('#r-year').value)||'', splits, tracks };
  if(!rec.catalog){ toast(tt('t.cat_required')); return; }
  if(id){ const i=releases().findIndex(r=>r.id===id); DB.releases[i]=rec; }
  else releases().push(rec);
  save(); $('#rel-modal').hidden=true; renderReleases(); renderRoyalties(); toast(tt('t.rel_saved'));
};

/* ============================================================================
   ROYALTY — ripartizione per artista basata sulle quote delle release
   ============================================================================ */
// range {from,to} generico da un selettore periodo + due date personalizzate
function computeRange(sel, fromEl, toEl){
  const p=sel.value, now=new Date(), today=isoD(now);
  if(p==='all') return {from:null,to:null};
  if(p==='custom') return {from:(fromEl&&fromEl.value)||null, to:(toEl&&toEl.value)||today};
  let from;
  if(p==='ytd') from=new Date(now.getFullYear(),0,1);
  else if(p==='12m') from=new Date(now.getFullYear(),now.getMonth()-11,1);
  else if(p==='6m') from=new Date(now.getFullYear(),now.getMonth()-5,1);
  else from=new Date(now.getFullYear(),now.getMonth()-2,1);
  return {from:isoD(from), to:today};
}
function royaltyPeriod(txs){
  const r=computeRange($('#roy-period'), $('#roy-from'), $('#roy-to'));
  if(!r.from && !r.to) return txs;
  return txs.filter(t=>inRange(t,r.from,r.to));
}
// trova release + quote applicabili a una transazione (traccia per ISRC, poi release)
function splitsForTx(t){
  const iso=(t.isrc||'').trim().toLowerCase();
  const rel=releaseByCatalog(t.catalog);
  if(rel){
    if(iso && rel.tracks){ const tr=rel.tracks.find(x=>(x.isrc||'').trim().toLowerCase()===iso && x.splits&&x.splits.length);
      if(tr) return {rel, splits:tr.splits}; }
    return {rel, splits:rel.splits||[]};
  }
  if(iso){ for(const r of releases()){ const tr=(r.tracks||[]).find(x=>(x.isrc||'').trim().toLowerCase()===iso && x.splits&&x.splits.length);
    if(tr) return {rel:r, splits:tr.splits}; } }
  return null;
}
// calcola { artist -> {total, byRelease:{catalog->amount}} } e label total
function computeRoyalties(){
  const txs=royaltyPeriod(DB.transactions.filter(t=>t.kind==='income'));
  const byArtist={}; let labelTotal=0;
  txs.forEach(t=>{
    const eur=toEur(t.net,t.currency);
    const m=splitsForTx(t);
    if(!m||!m.splits||!m.splits.length){ labelTotal+=eur; return; }
    let assigned=0;
    m.splits.forEach(s=>{
      const share=eur*(+s.pct||0)/100; assigned+=share;
      const a=(byArtist[s.name] ??= {total:0, byRelease:{}});
      a.total+=share; a.byRelease[m.rel.catalog]=(a.byRelease[m.rel.catalog]||0)+share;
    });
    labelTotal += eur-assigned;
  });
  return { byArtist, labelTotal };
}
// royalty per artista su una lista di transazioni (senza filtro periodo) — per il recoupment
function royaltyTotalsByArtist(txs){
  const byArtist={};
  txs.forEach(t=>{ const eur=toEur(t.net,t.currency); const m=splitsForTx(t);
    if(!m||!m.splits||!m.splits.length) return;
    m.splits.forEach(s=>{ const share=eur*(+s.pct||0)/100; (byArtist[s.name]??={total:0}).total+=share; });
  });
  return byArtist;
}
// recoupment: saldo recuperabile vs royalty maturate (lifetime) per artista
function computeRecoup(){
  const life=royaltyTotalsByArtist(DB.transactions.filter(t=>t.kind==='income'));
  const acc={};
  (DB.recoup||[]).forEach(r=>{ const a=(acc[r.artist]??={advance:0,cost:0});
    if(r.kind==='advance') a.advance+=(+r.amount||0); else a.cost+=(+r.amount||0); });
  return Object.keys(acc).map(name=>{
    const recoupable=(acc[name].advance||0)+(acc[name].cost||0);
    const roy=(life[name]&&life[name].total)||0;
    return { name, advance:acc[name].advance||0, cost:acc[name].cost||0, recoupable,
      royalties:roy, recouped:Math.min(roy,recoupable),
      unrecouped:Math.max(0,recoupable-roy), payable:Math.max(0,roy-recoupable) };
  }).sort((a,b)=>b.unrecouped-a.unrecouped || b.royalties-a.royalties);
}
function renderRoyalties(){
  const hasRel=releases().length>0;
  $('#roy-empty').hidden = hasRel;
  renderRecoup();
  const { byArtist, labelTotal } = computeRoyalties();
  const rows=Object.entries(byArtist).map(([name,v])=>({name,...v})).sort((a,b)=>b.total-a.total);
  const tbl=$('#table-roy-artist'), cardsBox=$('#roy-cards'), wrap=$('#roy-table-wrap');
  if(!hasRel){ tbl.innerHTML=''; if(cardsBox) cardsBox.innerHTML=''; $('#roy-detail-panel').hidden=true; mountPager(tbl,'roy',{total:0}); return; }
  const info=paginate(rows,'roy'); const pr=info.slice;
  const isLast = info.page>=info.pages;
  const mode=getVM('royalties','list');
  if(mode==='cards'){
    if(wrap) wrap.hidden=true; if(cardsBox) cardsBox.hidden=false;
    cardsBox.innerHTML = pr.map(r=>{
      const top=Object.entries(r.byRelease||{}).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([c,a])=>`<div class="royc-line"><span>${esc(c)}</span><b>${fmtMoney(a)}</b></div>`).join('');
      return `<div class="roy-card" data-artist="${esc(r.name)}">
        <div class="royc-head"><span class="royc-name">${esc(r.name)}</span><span class="royc-tot pos">${fmtMoney(r.total)}</span></div>
        ${top?`<div class="royc-body">${top}</div>`:''}</div>`;
    }).join('') + (isLast?`<div class="roy-card roy-card--label"><div class="royc-head"><span class="royc-name">${tt('roy.label_residual')}</span><span class="royc-tot">${fmtMoney(labelTotal)}</span></div></div>`:'');
    cardsBox.querySelectorAll('.roy-card[data-artist]').forEach(c=>c.onclick=()=>showRoyaltyDetail(c.dataset.artist,byArtist[c.dataset.artist]));
    clearPagerAfter(tbl); mountPager(cardsBox,'roy',info);
  } else {
    if(wrap) wrap.hidden=false; if(cardsBox){ cardsBox.hidden=true; cardsBox.innerHTML=''; }
    clearPagerAfter(cardsBox);
    tbl.innerHTML=`<thead><tr><th>${tt('roy.h.artist')}</th><th class="num">${tt('roy.h.amount')}</th></tr></thead>
      <tbody>${pr.map(r=>`<tr data-artist="${esc(r.name)}" style="cursor:pointer">
        <td data-label="Artista">${esc(r.name)}</td><td class="num pos" data-label="Royalty (€)">${fmtMoney(r.total)}</td></tr>`).join('')}
        ${isLast?`<tr><td data-label=""><strong>${tt('roy.label_residual')}</strong></td><td class="num" data-label="${tt('roy.h.amount')}"><strong>${fmtMoney(labelTotal)}</strong></td></tr>`:''}
        ${rows.length?'':`<tr><td colspan="2" class="muted">${tt('empty.noroy')}</td></tr>`}</tbody>`;
    $$('#table-roy-artist tbody tr[data-artist]').forEach(tr=>tr.onclick=()=>showRoyaltyDetail(tr.dataset.artist,byArtist[tr.dataset.artist]));
    mountPager(tbl,'roy',info);
  }
  syncVMButtons();
}
function renderRecoup(){
  const allRows=computeRecoup();
  const t=$('#table-recoup');
  if(t){
    const info=paginate(allRows,'recoup'); const rows=info.slice;
    t.innerHTML = allRows.length
      ? `<thead><tr><th>${tt('roy.h.artist')}</th><th class="num">${tt('recoup.recoupable')}</th><th class="num">${tt('recoup.royalties')}</th><th class="num">${tt('recoup.recouped')}</th><th class="num">${tt('recoup.unrecouped')}</th><th class="num">${tt('recoup.payable')}</th></tr></thead><tbody>`
        + rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${fmtMoney(r.recoupable)}</td><td class="num">${fmtMoney(r.royalties)}</td><td class="num">${fmtMoney(r.recouped)}</td><td class="num ${r.unrecouped>0?'neg':''}">${fmtMoney(r.unrecouped)}</td><td class="num ${r.payable>0?'pos':''}">${fmtMoney(r.payable)}</td></tr>`).join('')
        + `</tbody>`
      : `<tbody><tr><td class="muted">${tt('recoup.empty')}</td></tr></tbody>`;
    mountPager(t,'recoup',info);
  }
  const dl=$('#recoup-artists');
  if(dl){ const names=[...new Set([...releases().flatMap(r=>(r.splits||[]).map(s=>s.name)), ...(DB.recoup||[]).map(r=>r.artist)])].filter(Boolean).sort();
    dl.innerHTML=names.map(n=>`<option value="${esc(n)}">`).join(''); }
  const el=$('#recoup-entries');
  if(el){ const list=(DB.recoup||[]).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    el.innerHTML = list.length
      ? `<ul class="recoup-list">`+list.map(r=>`<li><span class="rc-kind rc-${r.kind}">${r.kind==='advance'?tt('recoup.advance'):tt('recoup.cost')}</span><b class="rc-art">${esc(r.artist)}</b><span class="muted small">${esc(r.date||'')}</span><span class="rc-amt">${fmtMoney(r.amount)}</span><span class="muted small rc-note">${esc(r.note||'')}</span><button class="rc-del" data-id="${esc(r.id)}" title="Elimina" aria-label="Elimina">✕</button></li>`).join('')+`</ul>`
      : '';
  }
}
function addRecoup(){
  const artist=$('#recoup-artist').value.trim();
  const amount=+$('#recoup-amount').value;
  if(!artist || !amount){ toast(tt('recoup.need')); return; }
  DB.recoup.push({ id:uid(), artist, kind:$('#recoup-kind').value, amount, date:$('#recoup-date').value||isoD(new Date()), note:$('#recoup-note').value.trim() });
  save();
  $('#recoup-artist').value=''; $('#recoup-amount').value=''; $('#recoup-note').value='';
  renderRecoup();
}
$('#recoup-add')?.addEventListener('click', addRecoup);
document.addEventListener('click',e=>{ const b=e.target.closest('.rc-del'); if(!b) return;
  DB.recoup=(DB.recoup||[]).filter(r=>r.id!==b.dataset.id); save(); renderRecoup(); });

let royDetail=null;   // {name, data} dell'artista mostrato
function showRoyaltyDetail(name,data){
  if(!data) return;
  royDetail={name,data};
  $('#roy-detail-title').textContent=tt('roy.detail')+' — '+name;
  const rows=Object.entries(data.byRelease).map(([cat,amt])=>({cat,amt})).sort((a,b)=>b.amt-a.amt);
  $('#table-roy-detail').innerHTML=`<thead><tr><th>${tt('roy.h.release')}</th><th class="num">${tt('roy.h.amount')}</th></tr></thead>
    <tbody>${rows.map(r=>{ const rel=releaseByCatalog(r.cat); const t=rel&&rel.title?` — ${esc(rel.title)}`:'';
      return `<tr><td data-label="Release">${esc(r.cat)}${t}</td><td class="num pos" data-label="Royalty (€)">${fmtMoney(r.amt)}</td></tr>`; }).join('')}
      <tr><td data-label=""><strong>${tt('roy.total')}</strong></td><td class="num pos" data-label="${tt('roy.h.amount')}"><strong>${fmtMoney(data.total)}</strong></td></tr></tbody>`;
  $('#roy-detail-panel').hidden=false;
  $('#roy-detail-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('#roy-detail-close').onclick=()=>$('#roy-detail-panel').hidden=true;
function syncRoyDates(){ const cu=$('#roy-period').value==='custom'; $('#roy-from').hidden=!cu; $('#roy-to').hidden=!cu; }
$('#roy-period').onchange=()=>{ syncRoyDates(); renderRoyalties(); };
$('#roy-from').onchange=$('#roy-to').onchange=renderRoyalties;
syncRoyDates();
$('#roy-detail-pdf').onclick=()=>{
  if(!royDetail) return;
  const { name, data } = royDetail;
  const period=$('#roy-period').value==='custom'
    ? (($('#roy-from').value||'inizio')+' → '+($('#roy-to').value||'oggi'))
    : $('#roy-period').selectedOptions[0].textContent;
  const rows=Object.entries(data.byRelease).map(([cat,amt])=>({cat,amt})).sort((a,b)=>b.amt-a.amt);
  $('#print-area').innerHTML=`<div class="stmt">
    <div class="stmt-head">
      <img src="icon.png?v=3" alt="" class="stmt-logo">
      <div><div class="stmt-brand">Label<span class="lf-fin">Finance</span></div>
        <div class="stmt-doc">Rendiconto Royalty</div></div>
    </div>
    <p class="stmt-meta">Artista: <strong>${esc(name)}</strong><br>
      Periodo: ${esc(period)}<br>
      Generato il ${new Date().toLocaleDateString('it-IT')}</p>
    <table class="stmt-table">
      <thead><tr><th>Release</th><th style="text-align:right">Royalty (€)</th></tr></thead>
      <tbody>${rows.map(r=>{ const rel=releaseByCatalog(r.cat); const t=rel&&rel.title?` — ${esc(rel.title)}`:'';
        return `<tr><td>${esc(r.cat)}${t}</td><td style="text-align:right">${fmtMoney(r.amt)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td><strong>Totale dovuto</strong></td><td style="text-align:right"><strong>${fmtMoney(data.total)}</strong></td></tr></tfoot>
    </table>
    <p class="stmt-foot">Documento generato automaticamente con Label Finance · ${new Date().toLocaleDateString('it-IT')}</p>
  </div>`;
  document.body.classList.add('print-statement');
  window.print();
  setTimeout(()=>document.body.classList.remove('print-statement'),600);
};

/* ---------- Modal movimento ---------- */
function openTx(id){
  const t = id ? DB.transactions.find(x=>x.id===id) : null;
  $('#tx-modal-title').textContent = t ? tt('tx.modal.edit') : (curKind==='expense'?tt('tx.modal.new_exp'):tt('tx.modal.new_inc'));
  const k = t ? t.kind : curKind;
  $('#f-id').value=t?.id||''; $('#f-kind').value=k;
  $('#f-date').value=t?.date||new Date().toISOString().slice(0,10);
  $('#f-dateto').value=t?.dateTo||'';
  $('#f-platform').value=t?.platform||''; $('#f-type').value=t?.type||(k==='expense'?'expense':'digital');
  $('#f-catalog').value=t?.catalog||''; $('#f-product').value=t?.product||'';
  $('#f-artist').value=t?.artist||'';
  $('#f-isrc').value=t?.isrc||''; $('#f-upc').value=t?.upc||t?.code||'';
  $('#f-qty').value=t?.qty??1; $('#f-gross').value=t?.gross??'';
  $('#f-shipping').value=t?.shipping??''; $('#f-taxes').value=t?.taxes??'';
  $('#f-payprocfees').value=t?.payProcFees??''; $('#f-fees').value=t?.fees??'';
  $('#f-net').value=t?.net??''; $('#f-csshare').value=t?.csShare??'';
  $('#f-currency').value=t?.currency||'EUR'; $('#f-note').value=t?.note||'';
  $('#f-delete').hidden=!t;
  $('#tx-modal').hidden=false;
}
let curKind='income';
$('#btn-add-income').onclick=()=>{curKind='income';openTx(null);};
$('#btn-add-expense').onclick=()=>{curKind='expense';openTx(null);};
$('#tx-modal-close').onclick=$('#f-cancel').onclick=()=>$('#tx-modal').hidden=true;
$('#tx-modal').onclick=e=>{ if(e.target.id==='tx-modal') $('#tx-modal').hidden=true; };
$('#f-delete').onclick=()=>{
  const id=$('#f-id').value;
  DB.transactions=DB.transactions.filter(t=>t.id!==id); save();
  $('#tx-modal').hidden=true; renderTx(); toast(tt('t.tx_deleted'));
};
$('#tx-form').onsubmit=e=>{
  e.preventDefault();
  const id=$('#f-id').value;
  const rec={
    id:id||uid(), kind:$('#f-kind').value, date:$('#f-date').value, dateTo:$('#f-dateto').value,
    platform:$('#f-platform').value.trim(), type:$('#f-type').value,
    catalog:$('#f-catalog').value.trim(), product:$('#f-product').value.trim(),
    artist:$('#f-artist').value.trim(),
    isrc:$('#f-isrc').value.trim(), upc:$('#f-upc').value.trim(),
    qty:Number($('#f-qty').value)||0, gross:parseAmount($('#f-gross').value),
    shipping:parseAmount($('#f-shipping').value), taxes:parseAmount($('#f-taxes').value),
    payProcFees:parseAmount($('#f-payprocfees').value), fees:parseAmount($('#f-fees').value),
    net:parseAmount($('#f-net').value), csShare:parseAmount($('#f-csshare').value),
    currency:($('#f-currency').value||'EUR').toUpperCase().slice(0,3), note:$('#f-note').value.trim(),
  };
  if(id){ const i=DB.transactions.findIndex(t=>t.id===id); DB.transactions[i]=rec; }
  else DB.transactions.push(rec);
  save(); $('#tx-modal').hidden=true; renderTx(); toast(tt('t.saved'));
};

/* ============================================================================
   IMPORT CSV
   ============================================================================ */
let importRows=[], importHeaders=[];
const drop=$('#import-drop');
$('#browse-btn').onclick=()=>$('#file-input').click();
$('#file-input').onchange=e=>{ if(e.target.files[0]) readFile(e.target.files[0]); };
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
drop.addEventListener('drop',e=>{ const f=e.dataTransfer.files[0]; if(f) readFile(f); });

function readFile(file){
  const r=new FileReader();
  r.onload=()=>{ window._rawCSV=r.result; refreshParse(); $('#import-config').hidden=false;
    populatePresets(); $('#map-preset-name').value=file.name.replace(/\.[^.]+$/,''); };
  r.readAsText(file);
}
function refreshParse(){
  const rows=parseCSV(window._rawCSV||'', $('#map-delim').value);
  importHeaders=rows[0]||[]; importRows=rows.slice(1);
  const distro=detectDistro();
  if(distro){ $('#map-distro').value=distro; applyDistro(distro); }
  else { $('#map-distro').value='auto'; buildMapFields(autoMap(importHeaders)); }
  renderPreview();
}
$('#map-delim').onchange=refreshParse;
['#map-kind','#map-datefmt','#map-currency','#map-platform'].forEach(s=>$(s).addEventListener('input',renderPreview));

/* ---------- Preset distributori (riconoscimento automatico colonne) ---------- */
const DISTRO_PRESETS={
  bandcamp:{ name:'Bandcamp', platform:'Bandcamp', datefmt:'mdy', fields:{
    date:['date'], type:['item type'], artist:['artist'], product:['item name'],
    catalog:['catalog number','catalog'], upc:['upc'], qty:['quantity'],
    gross:['item total','sub total','item price'], fees:['transaction fee'],
    net:['net amount'], currency:['currency'] } },
  distrokid:{ name:'DistroKid', platform:'DistroKid', datefmt:'ymd', fields:{
    date:['reporting date','sale month','sale date'], platform:['store'], type:['type'],
    product:['title','song'], artist:['artist'], isrc:['isrc'], upc:['upc'],
    qty:['quantity'], net:['earnings'], currency:['currency'] } },
  believe:{ name:'Believe', platform:'Believe', datefmt:'dmy', fields:{
    date:['sales period','period','date'], platform:['platform','dsp','store'],
    product:['track title','release title','title'], artist:['artist name','artist'],
    isrc:['isrc'], upc:['upc','ean'], qty:['quantity','units','net qty'],
    net:['net revenue','net income','royalty','net'], currency:['currency'] } },
  symphonic:{ name:'Symphonic', platform:'Symphonic', datefmt:'ymd', fields:{
    date:['sale date','date','period'], platform:['store','dsp','retailer'],
    product:['title','track'], artist:['artist'], isrc:['isrc'], upc:['upc'],
    qty:['quantity','units'], net:['net','earnings','revenue'], currency:['currency'] } },
};
function detectDistro(){
  let best=null, bestScore=2;
  for(const key in DISTRO_PRESETS){ const p=DISTRO_PRESETS[key]; let s=0;
    for(const f in p.fields){ if(importHeaders.some(h=>p.fields[f].some(x=>h.toLowerCase().includes(x)))) s++; }
    if(s>bestScore){ bestScore=s; best=key; } }
  return best;
}
function applyDistro(key){
  const p=DISTRO_PRESETS[key]; if(!p){ buildMapFields(autoMap(importHeaders)); return; }
  if($('#map-platform')) $('#map-platform').value=p.platform||'';
  if(p.datefmt) $('#map-datefmt').value=p.datefmt;
  const map={}, used=new Set();
  CANON.forEach(([f])=>{ const subs=p.fields[f]; if(!subs) return;
    importHeaders.forEach((h,i)=>{ if(used.has(i)) return;
      if(map[f]==null && subs.some(s=>h.toLowerCase().includes(s))){ map[f]=i; used.add(i); } }); });
  buildMapFields(map);
}
$('#map-distro')?.addEventListener('change',()=>{
  const v=$('#map-distro').value;
  if(v==='auto') buildMapFields(autoMap(importHeaders)); else applyDistro(v);
  renderPreview();
});

function buildMapFields(initial={}){
  $('#map-fields').innerHTML = CANON.map(([f,label])=>`
    <div class="map-row"><span>${label}</span>
      <select class="select map-sel" data-field="${f}">
        <option value="">— ignora —</option>
        ${importHeaders.map((h,i)=>`<option value="${i}" ${initial[f]===i?'selected':''}>${esc(h)||'col '+(i+1)}</option>`).join('')}
      </select></div>`).join('');
  $$('.map-sel').forEach(s=>s.onchange=renderPreview);
}
function currentMap(){
  const m={}; $$('.map-sel').forEach(s=>{ if(s.value!=='') m[s.dataset.field]=+s.value; }); return m;
}
function rowToRec(cols,map){
  const kind=$('#map-kind').value, fmt=$('#map-datefmt').value;
  const defCur=($('#map-currency').value||'EUR').toUpperCase().slice(0,3);
  const get=f=> map[f]!=null ? (cols[map[f]]??'') : '';
  const gross=parseAmount(get('gross')), fees=parseAmount(get('fees'));
  let net = map.net!=null ? parseAmount(get('net')) : (gross-fees);
  if(kind==='expense') net=Math.abs(net);
  return {
    id:uid(), kind, date:parseDate(get('date'),fmt), dateTo:parseDate(get('dateTo'),fmt),
    platform:($('#map-platform').value.trim()||get('platform')).trim(),
    type:get('type').trim()||(kind==='expense'?'expense':'digital'),
    catalog:get('catalog').trim(), product:get('product').trim(), artist:get('artist').trim(),
    isrc:get('isrc').trim(), upc:get('upc').trim(),
    qty:Number(parseAmount(get('qty')))||(map.qty!=null?0:1),
    gross, shipping:parseAmount(get('shipping')), taxes:parseAmount(get('taxes')),
    payProcFees:parseAmount(get('payProcFees')), fees, net, csShare:parseAmount(get('csShare')),
    currency:(get('currency')||defCur).toUpperCase().slice(0,3), note:'',
  };
}
function renderPreview(){
  const map=currentMap();
  const recs=importRows.slice(0,8).map(r=>rowToRec(r,map));
  $('#preview-count').textContent=`${importRows.length} righe nel file — anteprima prime ${Math.min(8,importRows.length)}`;
  $('#preview-table').innerHTML=`<thead><tr>
    <th>Data</th><th>Piattaforma</th><th>Catalogo</th><th>Prodotto</th><th>Artista</th><th class="num">Q.tà</th><th class="num">Netto</th><th>Val.</th></tr></thead>
   <tbody>${recs.map(t=>`<tr>
     <td>${esc(t.date)||'<span class=muted>?</span>'}</td><td>${esc(t.platform)}</td><td>${esc(t.catalog)}</td>
     <td>${esc(t.product)}</td><td>${esc(t.artist)}</td><td class="num">${t.qty}</td>
     <td class="num">${fmtMoney(t.net,t.currency)}</td><td>${esc(t.currency)}</td></tr>`).join('')}</tbody>`;
}
$('#import-cancel').onclick=()=>{ $('#import-config').hidden=true; $('#file-input').value=''; };
const txSig=t=>[t.kind,t.date,t.platform,(t.catalog||'').toLowerCase(),(t.product||'').toLowerCase(),
  t.isrc,t.upc,Math.round((+t.net||0)*100),t.qty].join('|');
$('#import-confirm').onclick=()=>{
  const map=currentMap();
  if(map.net==null && map.gross==null){ toast(tt('t.map_min')); return; }
  let recs=importRows.map(r=>rowToRec(r,map));
  let skipped=0;
  if($('#import-dedup').checked){
    const seen=new Set(DB.transactions.map(txSig));
    recs=recs.filter(r=>{ const s=txSig(r); if(seen.has(s)){ skipped++; return false; } seen.add(s); return true; });
  }
  DB.transactions.push(...recs); save();
  $('#import-config').hidden=true; $('#file-input').value='';
  toast(`${recs.length} ${tt('t.imported')}${skipped?` · ${skipped} ${tt('t.dupes_skipped')}`:''}`); goto('transactions');
};

/* ---------- Preset di mappatura ---------- */
function snapshotPreset(){
  return { delim:$('#map-delim').value, kind:$('#map-kind').value, datefmt:$('#map-datefmt').value,
    currency:$('#map-currency').value, platform:$('#map-platform').value, map:currentMap() };
}
function populatePresets(){
  const sel=$('#map-preset');
  sel.innerHTML='<option value="">— nuovo —</option>'+Object.keys(DB.mappings).map(n=>`<option>${esc(n)}</option>`).join('');
}
$('#save-preset').onclick=()=>{
  const name=$('#map-preset-name').value.trim(); if(!name){ toast(tt('t.preset_name')); return; }
  DB.mappings[name]=snapshotPreset(); save(); populatePresets(); $('#map-preset').value=name; toast(tt('t.preset_saved'));
};
$('#map-preset').onchange=()=>{
  const p=DB.mappings[$('#map-preset').value]; if(!p) return;
  $('#map-delim').value=p.delim; $('#map-kind').value=p.kind; $('#map-datefmt').value=p.datefmt;
  $('#map-currency').value=p.currency; $('#map-platform').value=p.platform;
  refreshParse(); buildMapFields(p.map); renderPreview();
};

/* ============================================================================
   IMPOSTAZIONI — tassi & backup
   ============================================================================ */
function renderSettings(){
  $('#rates-grid').innerHTML=Object.entries(DB.rates).map(([c,v])=>`
    <div class="rate-chip"><strong>${esc(c)}</strong>
      <input type="number" step="0.0001" value="${v}" data-cur="${esc(c)}">
      ${c==='EUR'?'':`<button data-del="${esc(c)}">✕</button>`}</div>`).join('');
  $$('#rates-grid input').forEach(i=>i.onchange=()=>{ DB.rates[i.dataset.cur]=parseFloat(i.value)||0; save(); });
  $$('#rates-grid button[data-del]').forEach(b=>b.onclick=()=>{ delete DB.rates[b.dataset.del]; save(); renderSettings(); });
}
$('#add-rate').onclick=()=>{
  const c=$('#rate-cur').value.trim().toUpperCase().slice(0,3), v=parseFloat($('#rate-val').value);
  if(!c||!v){ toast(tt('t.rate_required')); return; }
  DB.rates[c]=v; save(); $('#rate-cur').value=$('#rate-val').value=''; renderSettings();
};
$('#export-json').onclick=()=>download('label-finance-backup.json',JSON.stringify(ACCOUNT,null,2),'application/json');
$('#export-csv').onclick=()=>{
  const head=['kind',...CANON.map(c=>c[0]),'note'];
  const lines=[head.join(',')].concat(DB.transactions.map(t=>head.map(h=>csvCell(t[h])).join(',')));
  download('movimenti.csv',lines.join('\n'),'text/csv');
};
$('#import-json').onclick=()=>$('#json-input').click();
$('#json-input').onchange=e=>{
  const f=e.target.files[0]; if(!f) return; const r=new FileReader();
  r.onload=()=>{ try{ const d=JSON.parse(r.result); if(!d.transactions && !d.labels) throw 0;
    ACCOUNT=migrateAccount(d); DB=activeLabel(); save(); reloadViews(); rebuildAccountMenu();
    toast(tt('t.backup_restored')); goto('dashboard'); }
    catch{ toast(tt('t.file_invalid')); } };
  r.readAsText(f);
};
$('#wipe').onclick=()=>{ if(confirm('Cancellare TUTTI i dati (tutte le etichette) da questo dispositivo? Operazione irreversibile.')){
  ACCOUNT=defaultAccount(); DB=activeLabel(); save(); reloadViews(); rebuildAccountMenu();
  toast(tt('t.data_wiped')); goto('dashboard'); } };

function csvCell(v){ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function download(name,content,type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

/* ============================================================================
   TEMA — chiaro / scuro / sistema
   ============================================================================ */
const THEME_KEY='labelfinance.theme';
const themeMq=matchMedia('(prefers-color-scheme: dark)');
const themePref=()=>localStorage.getItem(THEME_KEY)||'system';
function applyTheme(){
  const p=themePref();
  const dark = p==='dark' || (p==='system' && themeMq.matches);
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
  $$('[data-theme-opt]').forEach(b=>b.classList.toggle('is-active', b.dataset.themeOpt===p));
}
function setTheme(p){ localStorage.setItem(THEME_KEY,p); applyTheme(); }
$$('[data-theme-opt]').forEach(b=>b.onclick=()=>setTheme(b.dataset.themeOpt));
themeMq.addEventListener('change',()=>{ if(themePref()==='system') applyTheme(); });
applyTheme();

/* ---------- PWA: service worker ---------- */
if('serviceWorker' in navigator){ window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); }); }

/* ---------- Anno copyright automatico ---------- */
{ const y=$('#copyright-year'); if(y) y.textContent=new Date().getFullYear(); }

/* ============================================================================
   ASSISTENTE AI (Studio/Agency) — riassunto dati + consigli via Edge Function
   ============================================================================ */
function buildAiSummary(){
  const txs=DB.transactions||[];
  const inc=txs.filter(t=>t.kind==='income'), exp=txs.filter(t=>t.kind==='expense');
  const sum=a=>a.reduce((s,t)=>s+toEur(t.net,t.currency),0);
  const income=sum(inc), expense=Math.abs(sum(exp)), net=income-expense;
  // trend ultimi 6 mesi (netto)
  const byMonth={};
  txs.forEach(t=>{ const m=(t.date||'').slice(0,7); if(!m) return; const v=toEur(t.net,t.currency)*(t.kind==='income'?1:-1); byMonth[m]=(byMonth[m]||0)+v; });
  const months=Object.keys(byMonth).sort().slice(-6).map(m=>({mese:m, netto:+byMonth[m].toFixed(2)}));
  // top piattaforme per netto
  const plat={}; txs.forEach(t=>{ const k=t.platform||'—'; plat[k]=(plat[k]||0)+toEur(t.net,t.currency)*(t.kind==='income'?1:-1); });
  const piattaforme=Object.entries(plat).map(([k,v])=>({nome:k, netto:+v.toFixed(2)})).sort((a,b)=>b.netto-a.netto).slice(0,5);
  // artisti per royalty (a vita) + recoupment
  const life=royaltyTotalsByArtist(inc);
  const artisti=Object.entries(life).map(([k,v])=>({nome:k, royalty:+v.total.toFixed(2)})).sort((a,b)=>b.royalty-a.royalty).slice(0,5);
  const recoup=computeRecoup().filter(r=>r.unrecouped>0).map(r=>({artista:r.name, nonRecuperato:+r.unrecouped.toFixed(2)}));
  return {
    valuta:'EUR',
    totali:{ entrate:+income.toFixed(2), uscite:+expense.toFixed(2), margineNetto:+net.toFixed(2),
      marginePct: income? +((net/income)*100).toFixed(1):0, movimenti:txs.length },
    trendUltimi6Mesi:months, perPiattaforma:piattaforme, topArtistiRoyalty:artisti, nonRecouped:recoup
  };
}
let aiBusy=false;
function renderAiPanel(){
  const panel=$('#ai-panel'), body=$('#ai-body'); if(!panel||!body) return;
  if(!can('ai')){
    // mostra l'upsell solo se c'è qualche dato (altrimenti tieni pulita la dashboard)
    if((DB.transactions||[]).length===0){ panel.hidden=true; return; }
    panel.hidden=false;
    body.innerHTML=`<div class="ai-upsell"><p>${tt('ai.locked')}</p><button class="btn btn-primary" data-goto="offers">${tt('ai.see_plans')}</button></div>`;
    return;
  }
  panel.hidden=false;
  if(!body.dataset.ready){
    body.innerHTML=`<button class="btn btn-primary" id="ai-go">✦ ${tt('ai.analyze')}</button><div class="ai-out" id="ai-out"></div>`;
    body.dataset.ready='1';
    $('#ai-go').addEventListener('click', runAi);
  }
}
async function runAi(){
  if(aiBusy) return; aiBusy=true;
  const out=$('#ai-out'), btn=$('#ai-go');
  if(btn){ btn.disabled=true; btn.textContent='… '+tt('ai.thinking'); }
  if(out) out.innerHTML=`<p class="muted">${tt('ai.thinking')}</p>`;
  let res={error:'offline'};
  try{ if(window.LF_aiAdvise) res=await window.LF_aiAdvise({ summary:buildAiSummary(), lang:(window.LFI18N?window.LFI18N.lang:'it') }); }catch(e){ res={error:e.message}; }
  aiBusy=false;
  if(btn){ btn.disabled=false; btn.textContent='✦ '+tt('ai.again'); }
  if(!out) return;
  if(res && res.text){
    out.innerHTML=`<div class="ai-answer">${aiFormat(res.text)}</div>`;
  } else {
    const map={ upgrade_required:tt('ai.err_plan'), unauthorized:tt('ai.err_auth'), offline:tt('ai.err_offline'),
      ai_not_configured:tt('ai.err_config'), refused:tt('ai.err_refused') };
    const code=res&&res.error;
    const known=code&&map[code];
    // per errori non previsti mostra anche il codice grezzo e il dettaglio, così è diagnosticabile
    let html=`<p class="ai-err">${known||tt('ai.err_generic')}${(code&&!known)?` <span class="muted small">(${esc(String(code))})</span>`:''}</p>`;
    if(res&&res.detail) html+=`<p class="muted small" style="white-space:pre-wrap;margin-top:6px">${esc(String(res.detail).slice(0,300))}</p>`;
    out.innerHTML=html;
  }
}
function aiFormat(t){
  // mini-markdown: **bold**, righe con - in elenco, paragrafi
  const esc2=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const lines=esc2(t).split(/\n/); let html='', inList=false;
  for(let raw of lines){
    let l=raw.trim();
    l=l.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
    if(/^[-•*]\s+/.test(l)){ if(!inList){html+='<ul>';inList=true;} html+='<li>'+l.replace(/^[-•*]\s+/,'')+'</li>'; }
    else { if(inList){html+='</ul>';inList=false;} if(l) html+='<p>'+l+'</p>'; }
  }
  if(inList) html+='</ul>';
  return html;
}

/* ============================================================================
   DASHBOARD PERSONALIZZABILE (Studio/Agency) — widget riordinabili / nascondibili
   ============================================================================ */
function dashLayout(){ const l=DB.dashLayout||(DB.dashLayout={order:DASH_DEFAULT_ORDER.slice(),hidden:DASH_EXTRAS.slice(),cols:2,widths:{}});
  l.order=l.order&&l.order.length?l.order:DASH_DEFAULT_ORDER.slice(); l.hidden=l.hidden||[]; l.cols=l.cols||2; l.widths=l.widths||{};
  // integra widget nuovi non presenti nell'ordine salvato; gli extra entrano nascosti (libreria)
  DASH_DEFAULT_ORDER.forEach(id=>{ if(!l.order.includes(id)){ l.order.push(id); if(DASH_EXTRAS.includes(id)&&!l.hidden.includes(id)) l.hidden.push(id); } });
  return l; }
function widgetWidth(id){ const l=dashLayout(); return l.widths[id] || (DASH_FULL.has(id)?'full':1); }
let dashWired=false;
function setupDashWidgets(){
  const view=$('#view-dashboard'); if(!view) return;
  let cont=$('#dash-widgets');
  if(!cont){
    cont=document.createElement('div'); cont.id='dash-widgets'; cont.className='dash-widgets';
    const map={ ai:$('#ai-panel'), kpi:view.querySelector('.kpi-grid'),
      chart:$('#chart-monthly')&&$('#chart-monthly').closest('.panel'),
      g_release:$('#table-release')&&$('#table-release').closest('.panel'),
      g_artist:$('#table-artist')&&$('#table-artist').closest('.panel'),
      g_platform:$('#table-platform')&&$('#table-platform').closest('.panel'),
      g_type:$('#table-type')&&$('#table-type').closest('.panel'),
      forecast:$('#w-forecast'), w_top:$('#w-top'), recent:$('#w-recent') };
    const grid2=view.querySelector('.grid-2');
    // posiziona il contenitore dove c'era l'ai-panel (prima delle card dati)
    (map.ai||map.kpi).parentNode.insertBefore(cont, map.ai||map.kpi);
    Object.entries(map).forEach(([id,el])=>{ if(!el) return;
      const w=document.createElement('div'); w.className='dash-widget'; w.dataset.widget=id;
      w.innerHTML='<span class="dw-handle" title="Trascina">⠿</span>'
        +'<span class="dw-width" role="group">'
        +'<button class="dw-w" data-w="1" title="Stretta">▯</button>'
        +'<button class="dw-w" data-w="2" title="Media">▭</button>'
        +'<button class="dw-w" data-w="full" title="Larga">▬</button></span>'
        +'<button class="dw-hide" title="Nascondi">✕</button>';
      el.parentNode.removeChild(el); w.appendChild(el); cont.appendChild(w); });
    if(grid2&&grid2.parentNode) grid2.parentNode.removeChild(grid2);
    wireDashEdit(cont);
  }
  applyDashLayout();
}
function applyDashLayout(){
  const cont=$('#dash-widgets'); if(!cont) return;
  const l=dashLayout();
  cont.style.setProperty('--dash-cols', l.cols);
  // riordina i nodi secondo l'ordine salvato
  l.order.forEach(id=>{ const w=cont.querySelector(`.dash-widget[data-widget="${id}"]`); if(w) cont.appendChild(w); });
  cont.querySelectorAll('.dash-widget').forEach(w=>{
    const id=w.dataset.widget;
    // larghezza: 'full' = tutta la riga, altrimenti N colonne (max = colonne disponibili)
    let span=widgetWidth(id);
    if(span==='full'){ w.style.gridColumn='1 / -1'; }
    else { span=Math.min(Number(span)||1, l.cols); w.style.gridColumn='span '+span; }
    // stato attivo dei pulsanti larghezza
    w.querySelectorAll('.dw-w').forEach(b=>b.classList.toggle('is-active', String(widgetWidth(id))===b.dataset.w));
    // un widget è nascosto se l'utente l'ha tolto, o se il suo contenuto è vuoto (es. AI panel senza dati)
    const inner=w.firstElementChild&&w.querySelector('#ai-panel');
    const emptied = inner && inner.hidden && !document.body.classList.contains('dash-edit');
    w.classList.toggle('is-hidden', l.hidden.includes(id) || emptied);
  });
  renderHiddenTray();
}
function renderHiddenTray(){
  const tray=$('#dash-tray'); if(!tray) return; const l=dashLayout();
  const names={ ai:tt('ai.title'), kpi:'KPI', chart:tt('dash.chart.title'),
    g_release:tt('dash.byrelease'), g_artist:tt('dash.byartist'), g_platform:tt('dash.byplatform'), g_type:tt('dash.bytype'),
    forecast:tt('dash.forecast'), w_top:tt('dash.top_artists'), recent:tt('dash.recent') };
  if(!l.hidden.length){ tray.innerHTML=`<span class="muted small">${tt('dash.none_hidden')}</span>`; return; }
  tray.innerHTML=l.hidden.map(id=>`<button class="dw-restore" data-id="${id}">+ ${esc(names[id]||id)}</button>`).join('');
  tray.querySelectorAll('.dw-restore').forEach(b=>b.onclick=()=>{ const l=dashLayout(); l.hidden=l.hidden.filter(x=>x!==b.dataset.id); save(); applyDashLayout(); });
}
let dashEdit=false;
function toggleDashEdit(force){
  dashEdit = force!==undefined?force:!dashEdit;
  document.body.classList.toggle('dash-edit', dashEdit);
  const b=$('#btn-dash-edit'); if(b) b.classList.toggle('is-active', dashEdit);
  const cont=$('#dash-widgets');
  if(cont) cont.querySelectorAll('.dash-widget').forEach(w=>{ w.draggable=dashEdit; });
  applyDashLayout();
}
function wireDashEdit(cont){
  const btn=$('#btn-dash-edit');
  if(btn) btn.addEventListener('click', ()=>{ if(!requireFeature('layout')) return; toggleDashEdit(); });
  const done=$('#btn-dash-done'); if(done) done.addEventListener('click', ()=>toggleDashEdit(false));
  const reset=$('#btn-dash-reset'); if(reset) reset.addEventListener('click', ()=>{
    DB.dashLayout={order:DASH_DEFAULT_ORDER.slice(),hidden:DASH_EXTRAS.slice(),cols:2,widths:{}}; save(); applyDashLayout(); syncColsSeg(); });
  const seg=$('#dash-cols-seg');
  if(seg) seg.addEventListener('click', e=>{ const b=e.target.closest('.seg-btn'); if(!b) return; setDashCols(+b.dataset.cols); syncColsSeg(); });
  syncColsSeg();
  // pulsanti nascondi
  cont.addEventListener('click', e=>{ const h=e.target.closest('.dw-hide'); if(!h||!dashEdit) return;
    const w=h.closest('.dash-widget'); const id=w.dataset.widget; const l=dashLayout();
    if(!l.hidden.includes(id)) l.hidden.push(id); save(); applyDashLayout(); });
  // pulsanti larghezza widget
  cont.addEventListener('click', e=>{ const b=e.target.closest('.dw-w'); if(!b||!dashEdit) return;
    const w=b.closest('.dash-widget'); setWidgetWidth(w.dataset.widget, b.dataset.w==='full'?'full':Number(b.dataset.w)); });
  // drag & drop riordino
  let dragEl=null;
  cont.addEventListener('dragstart', e=>{ const w=e.target.closest('.dash-widget'); if(!w||!dashEdit){ e.preventDefault(); return; } dragEl=w; w.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
  cont.addEventListener('dragend', ()=>{ if(dragEl){ dragEl.classList.remove('dragging'); dragEl=null; saveDashOrder(); } });
  cont.addEventListener('dragover', e=>{ if(!dragEl) return; e.preventDefault();
    const after=[...cont.querySelectorAll('.dash-widget:not(.dragging):not(.is-hidden)')].find(w=>{
      const r=w.getBoundingClientRect(); return e.clientY < r.top + r.height/2 && e.clientX < r.right; });
    if(after) cont.insertBefore(dragEl, after); else cont.appendChild(dragEl); });
}
function saveDashOrder(){
  const cont=$('#dash-widgets'); if(!cont) return; const l=dashLayout();
  l.order=[...cont.querySelectorAll('.dash-widget')].map(w=>w.dataset.widget); save();
}
function setDashCols(n){ const l=dashLayout(); l.cols=n; save(); applyDashLayout(); }
function setWidgetWidth(id,w){ const l=dashLayout(); l.widths[id]=w; save(); applyDashLayout(); }
/* ---- Widget extra: Top artisti, Ultimi movimenti, Cashflow previsionale ---- */
function renderExtraWidgets(txs){
  // Top artisti per netto (royalty)
  const tb=$('#top-body');
  if(tb){
    const g={};
    txs.forEach(t=>{ const k=t.artist||'—'; const v=toEur(t.net,t.currency); g[k]=(g[k]||0)+(t.kind==='income'?v:-Math.abs(v)); });
    const rows=Object.entries(g).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const max=Math.max(1,...rows.map(r=>r[1]));
    tb.innerHTML = rows.length ? rows.map(([k,v])=>`
      <div class="top-row"><span class="top-name">${esc(k)}</span>
        <span class="top-bar"><i style="width:${Math.round(v/max*100)}%"></i></span>
        <span class="top-val">${fmtMoney(v)}</span></div>`).join('')
      : `<p class="muted">${tt('empty.noperiod')}</p>`;
  }
  // Ultimi movimenti
  const rb=$('#recent-body');
  if(rb){
    const recent=[...txs].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,7);
    rb.innerHTML = recent.length ? recent.map(t=>{
      const v=toEur(t.net,t.currency); const inc=t.kind==='income';
      const label=t.artist||t.product||t.platform||t.catalog||'—';
      return `<div class="recent-row"><span class="recent-date">${esc(t.date||'')}</span>
        <span class="recent-label">${esc(label)}</span>
        <span class="recent-amt ${inc?'pos':'neg'}">${inc?'+':'−'}${fmtMoney(Math.abs(v))}</span></div>`;
    }).join('') : `<p class="muted">${tt('empty.noperiod')}</p>`;
  }
  // Cashflow previsionale: proiezione a 3 mesi sul netto medio dei mesi recenti
  const fb=$('#forecast-body');
  if(fb){
    const months={};
    txs.forEach(t=>{ const k=monthKey(t.date); if(!k) return; const v=toEur(t.net,t.currency);
      months[k]=(months[k]||0)+(t.kind==='income'?v:-Math.abs(v)); });
    const keys=Object.keys(months).sort().slice(-6);
    if(!keys.length){ fb.innerHTML=`<p class="muted">${tt('dash.forecast_empty')}</p>`; }
    else{
      const avg=keys.reduce((s,k)=>s+months[k],0)/keys.length;
      const last=keys[keys.length-1]; let [yy,mm]=last.split('-').map(Number); let cum=0; const proj=[];
      for(let i=0;i<3;i++){ mm++; if(mm>12){mm=1;yy++;} cum+=avg; proj.push({k:`${yy}-${String(mm).padStart(2,'0')}`, v:avg, cum}); }
      fb.innerHTML = `<div class="fc-avg">${tt('dash.forecast_avg')}: <b class="${avg>=0?'pos':'neg'}">${fmtMoney(avg)}</b></div>
        <div class="fc-rows">${proj.map(p=>`<div class="fc-row"><span class="fc-m">${p.k}</span>
          <span class="fc-v ${p.v>=0?'pos':'neg'}">${p.v>=0?'+':'−'}${fmtMoney(Math.abs(p.v))}</span>
          <span class="fc-cum">Σ ${fmtMoney(p.cum)}</span></div>`).join('')}</div>
        <p class="muted small">${tt('dash.forecast_note')}</p>`;
    }
  }
}
function syncColsSeg(){ const seg=$('#dash-cols-seg'); if(!seg) return; const c=dashLayout().cols;
  seg.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('is-active', +b.dataset.cols===c)); }

/* ============================================================================
   ARTISTI (RUBRICA) · CONTRATTI · TASK
   ============================================================================ */
function resizeImage(file, S, cb){
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{ URL.revokeObjectURL(url);
    const c=document.createElement('canvas'); c.width=S; c.height=S; const ctx=c.getContext('2d');
    const min=Math.min(img.width,img.height), sx=(img.width-min)/2, sy=(img.height-min)/2;
    ctx.drawImage(img,sx,sy,min,min,0,0,S,S); cb(c.toDataURL('image/jpeg',0.85)); };
  img.onerror=()=>{ URL.revokeObjectURL(url); toast(tt('t.file_invalid')); };
  img.src=url;
}
/* ridimensiona mantenendo le proporzioni (per loghi non quadrati) */
function resizeImageW(file, maxW, cb){
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{ URL.revokeObjectURL(url);
    const scale=Math.min(1, maxW/img.width); const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h); cb(c.toDataURL('image/png')); };
  img.onerror=()=>{ URL.revokeObjectURL(url); toast(tt('t.file_invalid')); };
  img.src=url;
}
const initials = s => (String(s||'').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('')||'?').toUpperCase();
function artistById(id){ return (DB.artists||[]).find(a=>a.id===id); }

/* ---------- Artisti ---------- */
let editingArtistId=null, artistPhotoData='';
function renderArtists(){
  const grid=$('#artists-grid'); if(!grid) return;
  const q=($('#art-search')&&$('#art-search').value||'').toLowerCase().trim();
  const all=(DB.artists||[]).filter(a=> !q || (a.name+' '+(a.legal||'')+' '+(a.email||'')).toLowerCase().includes(q));
  $('#artists-empty').hidden = (DB.artists||[]).length>0;
  const info=paginate(all,'artists'); const list=info.slice;
  const mode=getVM('artists','cards');
  const av=a=>`<div class="art-av">${a.photo?`<img src="${a.photo}" alt="">`:`<span>${esc(initials(a.name))}</span>`}</div>`;
  const acts=a=>`<div class="art-actions">
        <button class="icon-btn-sm" data-art-edit="${a.id}" title="${tt('common.edit')}">✎</button>
        <button class="icon-btn-sm" data-art-del="${a.id}" title="${tt('common.delete')}">🗑</button></div>`;
  if(mode==='list'){
    grid.className='art-list';
    grid.innerHTML = list.map(a=>`
      <div class="art-lrow" data-id="${a.id}">
        ${av(a)}
        <div class="art-lname"><b>${esc(a.name)}</b>${a.legal?`<span class="art-meta">${esc(a.legal)}</span>`:''}</div>
        <div class="art-lcol art-meta">${a.email?('✉ '+esc(a.email)):''}</div>
        <div class="art-lcol art-meta">${a.phone?('☎ '+esc(a.phone)):''}</div>
        <div class="art-lcol">${a.split?`<span class="art-split">${esc(a.split)}%</span>`:''}</div>
        ${acts(a)}
      </div>`).join('');
  } else {
    grid.className='art-grid';
    grid.innerHTML = list.map(a=>`
      <div class="art-card" data-id="${a.id}">
        ${av(a)}
        <div class="art-info">
          <div class="art-cname">${esc(a.name)}</div>
          ${a.legal?`<div class="art-meta">${esc(a.legal)}</div>`:''}
          ${a.email?`<div class="art-meta">✉ ${esc(a.email)}</div>`:''}
          ${a.phone?`<div class="art-meta">☎ ${esc(a.phone)}</div>`:''}
          ${a.split?`<span class="art-split">${esc(a.split)}%</span>`:''}
        </div>
        ${acts(a)}
      </div>`).join('');
  }
  mountPager(grid,'artists',info);
  syncVMButtons();
}
function setArtistPhoto(d){ artistPhotoData=d||''; const ph=$('#art-photo');
  if(ph) ph.innerHTML = artistPhotoData?`<img src="${artistPhotoData}" alt="">`:`<span>${tt('art.photo')}</span>`; }
function openArtistForm(id){
  editingArtistId=id||null; const a=id?artistById(id):null;
  $('#art-form-title').textContent = a?tt('art.edit'):tt('art.new');
  $('#art-name').value=a?a.name||'':''; $('#art-legal').value=a?a.legal||'':'';
  $('#art-email').value=a?a.email||'':''; $('#art-phone').value=a?a.phone||'':'';
  $('#art-iban').value=a?a.iban||'':''; $('#art-split').value=a?(a.split||''):'';
  $('#art-address').value=a?a.address||'':''; $('#art-note').value=a?a.note||'':'';
  setArtistPhoto(a?a.photo:'');
  $('#art-form').hidden=false; $('#art-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function saveArtist(){
  const name=$('#art-name').value.trim(); if(!name){ toast(tt('art.need_name')); return; }
  const data={ name, legal:$('#art-legal').value.trim(), email:$('#art-email').value.trim(),
    phone:$('#art-phone').value.trim(), iban:$('#art-iban').value.trim(),
    split:Number($('#art-split').value)||0, address:$('#art-address').value.trim(),
    note:$('#art-note').value.trim(), photo:artistPhotoData };
  if(editingArtistId){ const a=artistById(editingArtistId); if(a) Object.assign(a,data); }
  else { DB.artists.push(Object.assign({id:newId()}, data)); }
  save(); $('#art-form').hidden=true; editingArtistId=null; renderArtists(); toast(tt('art.saved'));
}
function deleteArtist(id){ const a=artistById(id); if(!a) return;
  if(!confirm(tt('art.del_confirm').replace('{name}',a.name))) return;
  DB.artists=DB.artists.filter(x=>x.id!==id); save(); renderArtists(); toast(tt('art.deleted')); }

/* ---------- Contratti (Authorization to Release) ---------- */
let currentContract=null; let conLogoData='';
function labelName(){ return (DB.profile&&DB.profile.label)||DB.name||'Label'; }
function setConLogo(d){ conLogoData=d||''; const box=$('#con-logo-prev');
  if(box) box.innerHTML = conLogoData?`<img src="${conLogoData}" alt="logo">`:`<span data-i18n="con.logo">Logo etichetta</span>`; }
function conArtistPickOptions(){
  const sel=$('#con-artist-pick'); if(!sel) return;
  const opts=(DB.artists||[]).map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  sel.innerHTML=`<option value="">${tt('con.pick_none')}</option>`+opts;
}
function conFillFromArtist(id){
  const a=artistById(id); if(!a) return;
  if(a.legal) $('#con-fullname').value=a.legal;
  $('#con-project').value=a.name||'';
  if(!$('#con-artist-names').value) $('#con-artist-names').value=a.name||'';
  if(a.email) $('#con-email').value=a.email;
  if(a.split){ $('#con-artist-pct').value=a.split; }
  updateSplitBar();
}
function updateSplitBar(){
  let p=Number($('#con-artist-pct').value); if(isNaN(p)) p=50; p=Math.max(0,Math.min(100,p));
  const lab=100-p, a=$('#csb-art'), l=$('#csb-lab');
  if(a){ a.textContent=p+'%'; a.style.width=p+'%'; }
  if(l){ l.textContent=lab+'%'; l.style.width=lab+'%'; }
}
function conNew(){
  currentContract=null;
  $('#con-form-title').textContent=tt('con.build');
  ['con-titles','con-artist-names','con-written','con-fullname','con-project','con-email'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});
  $('#con-date').value=isoD(new Date()); $('#con-artist-pct').value=50;
  conArtistPickOptions(); if($('#con-artist-pick')) $('#con-artist-pick').value='';
  setConLogo((DB.profile&&DB.profile.logo)||''); updateSplitBar();
  $('#con-preview').hidden=true; $('#con-form').hidden=false;
  $('#con-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function editContract(){ // torna al form mantenendo i dati per correggere prima di generare
  const c=currentContract; if(!c){ $('#con-preview').hidden=true; $('#con-form').hidden=false; return; }
  $('#con-form-title').textContent=tt('con.edit');
  conArtistPickOptions();
  $('#con-titles').value=c.titles||''; $('#con-artist-names').value=c.artistNames||'';
  $('#con-written').value=c.writtenBy||''; $('#con-fullname').value=c.fullName||'';
  $('#con-project').value=c.projectName||''; $('#con-email').value=c.email||'';
  $('#con-date').value=c.date||isoD(new Date()); $('#con-artist-pct').value=c.artistPct??50;
  setConLogo(c.logo||(DB.profile&&DB.profile.logo)||''); updateSplitBar();
  $('#con-preview').hidden=true; $('#con-form').hidden=false;
  $('#con-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function collectContract(){
  let p=Number($('#con-artist-pct').value); if(isNaN(p)) p=50; p=Math.max(0,Math.min(100,p));
  return Object.assign({}, currentContract||{}, {
    id:(currentContract&&currentContract.id)||newId(),
    date:$('#con-date').value||isoD(new Date()),
    titles:$('#con-titles').value.trim(), artistNames:$('#con-artist-names').value.trim(),
    writtenBy:$('#con-written').value.trim(), fullName:$('#con-fullname').value.trim(),
    projectName:$('#con-project').value.trim(), email:$('#con-email').value.trim(),
    artistPct:p, label:labelName(), logo:conLogoData||'',
    status:(currentContract&&currentContract.status)||'draft',
    signed:(currentContract&&currentContract.signed)||null
  });
}
function generateContract(){
  const c=collectContract();
  if(!c.titles){ toast(tt('con.need_titles')); return; }
  if(!c.fullName){ toast(tt('con.need_fullname')); return; }
  // ricorda il logo dell'etichetta per i prossimi contratti
  if(conLogoData && window.LF) window.LF.setProfile({ logo:conLogoData });
  currentContract=c;
  $('#contract-doc').innerHTML=buildContractDoc(c);
  $('#con-form').hidden=true; $('#con-preview').hidden=false;
  $('#con-preview').scrollIntoView({behavior:'smooth',block:'start'});
}
function numWord(n){ const w={0:'zero',10:'ten',20:'twenty',25:'twenty-five',30:'thirty',33:'thirty-three',40:'forty',
  50:'fifty',60:'sixty',66:'sixty-six',67:'sixty-seven',70:'seventy',75:'seventy-five',80:'eighty',90:'ninety',100:'one hundred'};
  return w[n]||String(n); }
function contractLetterhead(c){
  const lf=`<div class="cd-lf"><img src="icon.png?v=3" alt="Label Finance" class="cd-lf-ico"><span class="cd-lf-name">Label<span class="lf-fin">Finance</span></span></div>`;
  const lbl=(c.logo)
    ? `<div class="cd-label-logo"><img src="${c.logo}" alt="${esc(c.label)}"></div>`
    : `<div class="cd-label-logo cd-label-logo--text">${esc(c.label)}</div>`;
  return `<div class="cd-letterhead">${lf}${lbl}</div>`;
}
function buildContractDoc(c){
  const L=esc(c.label), aPct=c.artistPct, lPct=100-c.artistPct;
  const sig = c.signed
    ? `<div class="cd-signed"><img src="${c.signed.dataUrl}" alt="signature" class="cd-sig-img">
         <div class="cd-sig-meta"><b>${esc(c.signed.name||c.fullName||'')}</b><br>${esc(c.signed.date||'')}${c.signed.time?(' · '+esc(c.signed.time)):''}${c.signed.place?(' · '+esc(c.signed.place)):''}</div></div>`
    : `<div class="cd-sign"><div><span>Date</span><hr></div><div><span>Signature</span><hr></div></div>`;
  return `
  <div class="cd-page">
    ${contractLetterhead(c)}
    <h3 class="cd-title">AUTHORIZATION TO RELEASE AND COLLABORATION AGREEMENT</h3>
    <p class="cd-intro"><em>This document is intended to clearly and transparently define the terms of the collaboration between the Artist and the Label.</em></p>
    <h4>1. Declaration of ownership of rights</h4>
    <p>The Artist declares that they are the sole owner, or that they have obtained full authorization from all entitled parties, of the <b>copyright and related rights necessary for the exploitation and release</b> of the track(s) covered by this agreement.</p>
    <h4>2. Grant of rights</h4>
    <p>The Artist grants <b>${L}</b>, as an independent project, the <b>exclusive right</b>, free of charge, with <b>worldwide validity</b> and <b>no time limitation</b>, to release, distribute, communicate to the public and promote the track(s), in any format and on any digital platform, including as part of compilations (VA), EPs, singles or similar releases.</p>
    <p>This grant does <b>not</b> constitute a transfer of authorship of the work, which shall remain with the Artist.</p>
    <h4>3. Warranties and indemnification</h4>
    <p>The Artist warrants that the track(s) is/are original and do not infringe the rights of third parties, including, by way of example, copyright, related rights or image rights.</p>
    <p>The Artist agrees to indemnify and hold the Label harmless from any claim, demand or damage arising from any breach of the above warranties.</p>
    <h4>4. Compensation and revenue split</h4>
    <p>Any proceeds derived from the exploitation of the released track(s) (including, by way of example and not limitation, digital sales and streaming) shall be considered <b>net revenues</b>, meaning revenues net of distribution platform fees, taxes and any refunds.</p>
    <p>Such net revenues shall first be applied to the <b>recoupment of costs incurred by the Label</b>, including, by way of example but not limited to: mastering, artwork, promotion, marketing and distribution.</p>
    <p>Once such costs have been fully recouped, the subsequent net revenues shall be split as follows: <b>${aPct}% (${numWord(aPct)} percent) to the Artist and ${lPct}% (${numWord(lPct)} percent) to the Label</b>, unless otherwise agreed in writing by the parties.</p>
    <p>The methods and timing of accounting and payments shall depend on the distribution platform used. The Artist acknowledges that any compensation received may be subject to taxation and that the Label shall not be responsible for the Artist's personal tax obligations.</p>
    <h4>5. Nature of the project</h4>
    <p>The parties acknowledge that <b>${L}</b> operates as an independent project and is not structured as a company. This agreement constitutes a private authorization and an artistic collaboration.</p>
    <h4>6. Final provisions</h4>
    <p>This document constitutes the entire agreement between the parties with respect to the track(s) covered herein. Any amendments or additions must be agreed upon in writing.</p>
    <p>The submission and signature of this document shall constitute full acceptance of the terms set forth above.</p>
    <h4>7. Personal Data Processing</h4>
    <p>Pursuant to article 13 of the Regulation (EU) 2016/679 (GDPR), the Artist acknowledges that their personal data will be processed by ${L}, acting as Data Controller, exclusively for purposes related to the negotiation, execution and performance of this contract, as well as to the publication, distribution, promotion and administrative management of any revenues that may derive from the exploitation of the recordings.</p>
    <p>The processing of personal data is necessary for the performance of this contract, in accordance with Article 6(1)(b) of the Regulation (EU) 2016/679 (GDPR). Personal data will be retained for the time strictly necessary for the management of the contractual relationship and for the protection of the rights relating to the recordings. Personal data will not be disclosed to third parties nor used for purposes other than those stated above, except for disclosure to parties involved in digital distribution, promotion, rights management, and technical, accounting and administrative services, who will act as data processors. Where necessary, personal data may be transferred to countries outside the European Union in compliance with applicable data protection laws.</p>
    <p>The Artist may at any time exercise their rights of access, rectification, erasure, restriction of processing, data portability and objection to processing, as well as lodge a complaint with the competent Data Protection Authority.</p>
  </div>
  <div class="cd-page cd-page--copy">
    ${contractLetterhead(c)}
    <h3 class="cd-title">LABEL COPY INFORMATION</h3>
    <h4>The Company:</h4><p>${L}</p>
    <h4>Track(s) Information</h4>
    <p><b>Title(s):</b> ${esc(c.titles)||'—'}</p>
    <p><b>Artist Name(s):</b> ${esc(c.artistNames)||'—'}</p>
    <p><b>Written by:</b> ${esc(c.writtenBy)||'—'}</p>
    <h4>Artist Details</h4>
    <p><b>Full Name:</b> ${esc(c.fullName)||'—'}</p>
    <p><b>Artist / Project Name:</b> ${esc(c.projectName)||'—'}</p>
    <h4>Signature</h4>
    <p>I confirm that I have read, understood, and accepted the terms of this Release Authorization.</p>
    ${sig}
  </div>`;
}
function contractPlainText(c){
  const tmp=document.createElement('div'); tmp.innerHTML=buildContractDoc(c);
  tmp.querySelectorAll('h3,h4,p,div').forEach(el=>el.appendChild(document.createTextNode('\n')));
  return tmp.textContent.replace(/\n{2,}/g,'\n\n').replace(/[ \t]+\n/g,'\n').trim();
}
function saveCurrentContract(){ if(!currentContract) return;
  const i=DB.contracts.findIndex(x=>x.id===currentContract.id);
  if(i>=0) DB.contracts[i]=currentContract; else DB.contracts.push(currentContract);
  save(); }
function sendContract(){
  if(!currentContract) return; const c=currentContract;
  if(c.status==='draft'){ c.status='sent'; c.sentAt=Date.now(); }
  saveCurrentContract(); renderContracts();
  const subject=encodeURIComponent(`Release Authorization — ${c.titles} · ${c.label}`);
  const body=encodeURIComponent(tt('con.mail_intro').replace('{label}',c.label)+'\n\n'+contractPlainText(c)+'\n\n'+tt('con.mail_foot'));
  if(c.email){ window.location.href=`mailto:${encodeURIComponent(c.email)}?subject=${subject}&body=${body}`; toast(tt('con.sent')); }
  else { toast(tt('con.no_email')); }
}
function printContract(){
  if(!currentContract) return;
  document.body.classList.add('printing-contract');
  const done=()=>{ document.body.classList.remove('printing-contract'); window.removeEventListener('afterprint',done); };
  window.addEventListener('afterprint',done); window.print(); setTimeout(done,1500);
}
function downloadContractPDF(){
  if(!currentContract) return;
  const el=$('#contract-doc'); if(!el) return;
  if(typeof html2pdf==='undefined'){ printContract(); return; }  // fallback se la libreria non è caricata
  const fname=(currentContract.titles||'contract').replace(/[^\w\-]+/g,'_').slice(0,60)||'contract';
  toast(tt('con.pdf_wait'));
  const opt={ margin:[8,8,8,8], filename:fname+'.pdf',
    image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2, useCORS:true, backgroundColor:'#ffffff', windowWidth:820},
    jsPDF:{unit:'mm', format:'a4', orientation:'portrait'},
    pagebreak:{ mode:['css','legacy'], before:'.cd-page--copy' } };
  html2pdf().set(opt).from(el).save().catch(()=>printContract());
}
function openContract(id){ const c=DB.contracts.find(x=>x.id===id); if(!c) return;
  currentContract=c; $('#contract-doc').innerHTML=buildContractDoc(c);
  $('#con-form').hidden=true; $('#con-preview').hidden=false; goto('contracts');
  $('#con-preview').scrollIntoView({behavior:'smooth',block:'start'}); }
function deleteContract(id){ const c=DB.contracts.find(x=>x.id===id); if(!c) return;
  if(!confirm(tt('con.del_confirm'))) return;
  DB.contracts=DB.contracts.filter(x=>x.id!==id); save(); renderContracts(); }
function conStatusPill(s){
  if(s==='signed') return `<span class="pill pill-ok">${tt('con.st_signed')}</span>`;
  if(s==='sent') return `<span class="pill pill-sent">${tt('con.st_sent')}</span>`;
  return `<span class="pill">${tt('con.st_draft')}</span>`;
}
function renderContracts(){
  const tb=$('#contracts-table'); if(!tb) return;
  const all=(DB.contracts||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  $('#contracts-empty').hidden=all.length>0;
  if(!all.length){ tb.innerHTML=''; mountPager(tb,'contracts',{total:0}); return; }
  const info=paginate(all,'contracts'); const list=info.slice;
  const head=`<thead><tr><th>${tt('con.titles')}</th><th>${tt('con.fullname')}</th><th>${tt('con.split_short')}</th><th>${tt('con.date')}</th><th>${tt('con.status')}</th><th></th></tr></thead>`;
  const rows=list.map(c=>{
    const who=esc(c.projectName||c.fullName||c.artistNames||'—');
    return `<tr><td><b>${esc(c.titles||'—')}</b></td><td class="muted small">${who}</td><td>${c.artistPct}/${100-c.artistPct}</td><td>${esc(c.date)}</td><td>${conStatusPill(c.status)}</td>
      <td class="con-row-act"><button class="icon-btn-sm" data-con-open="${c.id}" title="${tt('con.open')}">↗</button>
        <button class="icon-btn-sm" data-con-del="${c.id}" title="${tt('common.delete')}">🗑</button></td></tr>`;
  }).join('');
  tb.innerHTML=head+'<tbody>'+rows+'</tbody>';
  mountPager(tb,'contracts',info);
}

/* ---------- Firma in-app (canvas) ---------- */
let sigPad=null;
function openSignPad(){
  if(!currentContract){ toast(tt('con.gen_first')); return; }
  $('#sign-place').value=''; $('#sign-name').value=currentContract.fullName||'';
  $('#sign-modal').hidden=false;
  const cv=$('#sign-canvas'); const ctx=cv.getContext('2d');
  const rect=cv.getBoundingClientRect(); cv.width=rect.width*2; cv.height=180*2; ctx.scale(2,2);
  ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.strokeStyle='#111';
  let drawing=false, last=null, has=false;
  const pos=e=>{ const r=cv.getBoundingClientRect(); const t=e.touches?e.touches[0]:e; return {x:t.clientX-r.left, y:t.clientY-r.top}; };
  const start=e=>{ drawing=true; last=pos(e); e.preventDefault(); };
  const move=e=>{ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; has=true; e.preventDefault(); };
  const end=()=>{ drawing=false; };
  sigPad={cv,ctx,clear:()=>{ ctx.clearRect(0,0,cv.width,cv.height); has=false; }, isEmpty:()=>!has};
  cv.onmousedown=start; cv.onmousemove=move; window.onmouseup=end;
  cv.ontouchstart=start; cv.ontouchmove=move; cv.ontouchend=end;
}
function closeSignPad(){ $('#sign-modal').hidden=true; sigPad=null; }
function confirmSign(){
  if(!sigPad || sigPad.isEmpty()){ toast(tt('con.sign_empty')); return; }
  const now=new Date();
  currentContract.signed={ dataUrl:sigPad.cv.toDataURL('image/png'),
    name:$('#sign-name').value.trim()||currentContract.fullName||'',
    place:$('#sign-place').value.trim(),
    date:isoD(now), time:now.toTimeString().slice(0,5) };
  currentContract.status='signed';
  saveCurrentContract(); renderContracts();
  $('#contract-doc').innerHTML=buildContractDoc(currentContract);
  closeSignPad(); toast(tt('con.signed_ok'));
}

/* ---------- Task ---------- */
function renderTasks(){
  const cont=$('#tasks-list'); if(!cont) return;
  const list=(DB.tasks||[]); $('#tasks-empty').hidden=list.length>0;
  const today=isoD(new Date());
  const open=list.filter(t=>!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  const done=list.filter(t=>t.done).sort((a,b)=>(b.due||'').localeCompare(a.due||''));
  const icon={payment:'💸',contract:'📄',other:'•'};
  const row=t=>{
    const overdue=t.due && !t.done && t.due<today;
    const soon=t.due && !t.done && t.due===today;
    const due = t.due?`<span class="tsk-due ${overdue?'over':''} ${soon?'today':''}">${overdue?'⚠ ':''}${esc(t.due)}</span>`:'';
    return `<div class="tsk-row ${t.done?'is-done':''}" data-id="${t.id}">
      <button class="tsk-check" data-tsk-toggle="${t.id}" aria-label="done">${t.done?'✓':''}</button>
      <span class="tsk-ico">${icon[t.type]||'•'}</span>
      <span class="tsk-title">${esc(t.title)}</span>
      ${due}
      <button class="icon-btn-sm" data-tsk-del="${t.id}" title="${tt('common.delete')}">🗑</button>
    </div>`;
  };
  const all=[...open,...done];
  const info=paginate(all,'tasks'); const slice=info.slice;
  let html='', doneOpen=false;
  slice.forEach(t=>{
    if(t.done && !doneOpen){ if(html) html+='</div>'; html+=`<div class="tsk-group tsk-done-group"><div class="tsk-group-lbl">${tt('tsk.completed')}</div>`; doneOpen=true; }
    else if(!doneOpen && !html){ html+='<div class="tsk-group">'; }
    html+=row(t);
  });
  if(html) html+='</div>';
  cont.innerHTML=html;
  mountPager(cont,'tasks',info);
}
function addTask(){
  const title=$('#tsk-title').value.trim(); if(!title){ toast(tt('tsk.need_title')); return; }
  DB.tasks.push({ id:newId(), title, type:$('#tsk-type').value, due:$('#tsk-due').value||'', done:false, createdAt:Date.now() });
  save(); $('#tsk-title').value=''; $('#tsk-due').value=''; renderTasks(); toast(tt('tsk.added'));
}
function toggleTask(id){ const t=(DB.tasks||[]).find(x=>x.id===id); if(!t) return; t.done=!t.done; save(); renderTasks(); }
function deleteTask(id){ DB.tasks=(DB.tasks||[]).filter(x=>x.id!==id); save(); renderTasks(); }

/* ---------- Wiring (una sola volta) ---------- */
function initFeatures(){
  // Artisti
  $('#art-new')?.addEventListener('click',()=>openArtistForm());
  $('#art-cancel')?.addEventListener('click',()=>{ $('#art-form').hidden=true; editingArtistId=null; });
  $('#art-save')?.addEventListener('click',saveArtist);
  $('#art-search')?.addEventListener('input',renderArtists);
  $('#art-photo-btn')?.addEventListener('click',()=>$('#art-photo-input').click());
  $('#art-photo-input')?.addEventListener('change',e=>{ const f=e.target.files[0]; if(f) resizeImage(f,256,setArtistPhoto); e.target.value=''; });
  $('#artists-grid')?.addEventListener('click',e=>{
    const ed=e.target.closest('[data-art-edit]'); if(ed) return openArtistForm(ed.dataset.artEdit);
    const dl=e.target.closest('[data-art-del]'); if(dl) return deleteArtist(dl.dataset.artDel);
  });
  // Contratti
  $('#con-new')?.addEventListener('click',conNew);
  $('#con-cancel')?.addEventListener('click',()=>{ $('#con-form').hidden=true; });
  $('#con-generate')?.addEventListener('click',generateContract);
  $('#con-back')?.addEventListener('click',editContract);
  $('#con-print')?.addEventListener('click',downloadContractPDF);
  $('#con-send')?.addEventListener('click',sendContract);
  $('#con-sign')?.addEventListener('click',openSignPad);
  $('#con-artist-pick')?.addEventListener('change',e=>{ if(e.target.value) conFillFromArtist(e.target.value); });
  $('#con-artist-pct')?.addEventListener('input',updateSplitBar);
  $('#con-logo-btn')?.addEventListener('click',()=>$('#con-logo-input').click());
  $('#con-logo-input')?.addEventListener('change',e=>{ const f=e.target.files[0]; if(f) resizeImageW(f,400,setConLogo); e.target.value=''; });
  $('#con-logo-clear')?.addEventListener('click',()=>setConLogo(''));
  $('#contracts-table')?.addEventListener('click',e=>{
    const op=e.target.closest('[data-con-open]'); if(op) return openContract(op.dataset.conOpen);
    const dl=e.target.closest('[data-con-del]'); if(dl) return deleteContract(dl.dataset.conDel);
  });
  // Firma
  $('#sign-close')?.addEventListener('click',closeSignPad);
  $('#sign-clear')?.addEventListener('click',()=>{ if(sigPad) sigPad.clear(); });
  $('#sign-confirm')?.addEventListener('click',confirmSign);
  $('#sign-modal')?.addEventListener('click',e=>{ if(e.target.id==='sign-modal') closeSignPad(); });
  // Task
  $('#tsk-add')?.addEventListener('click',addTask);
  $('#tsk-title')?.addEventListener('keydown',e=>{ if(e.key==='Enter') addTask(); });
  $('#tasks-list')?.addEventListener('click',e=>{
    const tg=e.target.closest('[data-tsk-toggle]'); if(tg) return toggleTask(tg.dataset.tskToggle);
    const dl=e.target.closest('[data-tsk-del]'); if(dl) return deleteTask(dl.dataset.tskDel);
  });
}

/* ---------- Cambio lingua: rigenera i contenuti dinamici ---------- */
window.addEventListener('langchange', ()=>{
  try{ reloadViews(); rebuildAccountMenu(); }catch(e){}
});

/* ---------- Avvio ---------- */
renderDashboard();
renderOffers();
rebuildAccountMenu();
initFAQ();
initFeatures();
