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
const DASH_BASE = ['kpi','chart','g_release','g_artist','g_platform','g_type'];
const DASH_EXTRAS = ['forecast','w_top','recent','merch','nextrel','nextevt','support','disco']; // libreria widget opzionali (nascosti di default)
const DASH_DEFAULT_ORDER = [...DASH_BASE, ...DASH_EXTRAS];
const DASH_FULL = new Set(['kpi','chart','forecast']);
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
  l.artists=l.artists||[]; l.tasks=l.tasks||[]; l.contracts=l.contracts||[]; l.merch=l.merch||[];
  l.planning=l.planning||[]; l.events=l.events||[]; l.supports=l.supports||[];
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
function save(){ saveLocal(); if(window.LF_push) window.LF_push(); if(typeof notifScan==='function') notifScan(); }
/* API per il modulo di sincronizzazione cloud (sync.js) — sincronizza tutto l'account */
window.LF = {
  data(){ return ACCOUNT; },
  applyCloud(d){ ACCOUNT = migrateAccount(d); DB = activeLabel(); saveLocal(); reloadViews(); if(typeof rebuildAccountMenu==='function') rebuildAccountMenu(); },
  profile(){ return DB.profile || (DB.profile={name:'',label:''}); },
  setProfile(p){ DB.profile = Object.assign(this.profile(), p||{}); if(p&&p.label) DB.name=p.label; save();
    if(typeof updateIdentity==='function') updateIdentity(); if(typeof rebuildAccountMenu==='function') rebuildAccountMenu(); },
  goto(v){ if(typeof goto==='function') goto(v); },
};
function reloadViews(){ renderDashboard(); renderTx(); renderReleases(); renderPlanning(); renderEvents(); renderSupports(); renderRoyalties(); renderArtists(); renderContracts(); renderTasks(); renderMerch(); renderOffers(); renderSettings(); }
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
const VIEW_TITLES={dashboard:'Dashboard',transactions:'Movimenti',releases:'Discografia',planning:'Pianificazione',events:'Eventi',supports:'Support DJ',royalties:'Royalty',artists:'Artisti',contracts:'Contratti',tasks:'Task',merch:'Merch',import:'Importa CSV',settings:'Impostazioni',about:'Chi siamo',offers:'Offerte & Piani',faq:'Aiuto & FAQ'};
function goto(view){
  $$('.nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('is-active',v.id==='view-'+view));
  if(typeof expandActiveGroup==='function') expandActiveGroup();
  const sec=$('#topbar-section'); if(sec) sec.textContent=VIEW_TITLES[view]||'';
  if(view==='dashboard') renderDashboard();
  if(view==='transactions') renderTx();
  if(view==='releases') renderReleases();
  if(view==='planning') renderPlanning();
  if(view==='events') renderEvents();
  if(view==='supports') renderSupports();
  if(view==='royalties') renderRoyalties();
  if(view==='artists') renderArtists();
  if(view==='contracts'){ renderContracts(); refreshContractStatuses(); }
  if(view==='tasks') renderTasks();
  if(view==='merch') renderMerch();
  if(view==='offers') renderOffers();
  if(view==='settings') renderSettings();
  $('.main').scrollTop=0;
  updateTopbarSection();
}
$$('.nav-item').forEach(b=>b.onclick=()=>goto(b.dataset.view));
document.addEventListener('click',e=>{ const g=e.target.closest('[data-goto]'); if(g) goto(g.dataset.goto); });
// collegamenti tra sezioni (link .lf-link)
document.addEventListener('click',e=>{
  const r=e.target.closest('[data-rel-open]'); if(r){ e.stopPropagation(); openRelease(r.dataset.relOpen); return; }
  const a=e.target.closest('[data-art-open]'); if(a){ e.stopPropagation(); openArtistByName(a.dataset.artOpen); }
});
function openArtistByName(name){ goto('artists');
  const a=(DB.artists||[]).find(x=>(x.name||'').trim().toLowerCase()===(name||'').trim().toLowerCase());
  if(a) openArtistForm(a.id); }
function relCatLink(cat){ const r=releaseByCatalog(cat); return r?`<span class="lf-link" data-rel-open="${r.id}">${esc(cat)}</span>`:esc(cat); }
function artNameLink(name){ const a=(DB.artists||[]).find(x=>(x.name||'').trim().toLowerCase()===(name||'').trim().toLowerCase());
  return a?`<span class="lf-link" data-art-open="${esc(name)}">${esc(name)}</span>`:esc(name); }

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
  if(typeof aiPopBody==='function' && $('#ai-pop') && !$('#ai-pop').hidden) aiPopBody();
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
  const R={artists:renderArtists, releases:renderReleases, royalties:renderRoyalties, merch:renderMerch,
    planning:renderPlanning, events:renderEvents, supports:renderSupports};
  if(R[sec]) R[sec]();
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
registerExport('merch', ()=>{
  const rows=(DB.merch||[]).slice().sort((a,b)=>(+b.sold||0)-(+a.sold||0)).map(m=>[
    m.name, (window.t?window.t(MERCH_TYPES[m.type]||'mch.t_other'):m.type),
    +(+m.price||0).toFixed(2), +(+m.cost||0).toFixed(2), m.sold||0,
    +merchRevenue(m).toFixed(2), +merchMargin(m).toFixed(2), m.stock==null?'':m.stock ]);
  return {title:'Merch — '+(DB.name||''), headers:['Articolo','Tipo','Prezzo','Costo','Venduti','Ricavi','Margine','Scorte'], rows};
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
  date:    {label:'Data vendita',cell:t=>esc(t.date)},
  dateTo:  {label:'Data vendita (a)', cell:t=>esc(t.dateTo)},
  kind:    {label:'',            cell:t=>`<span class="pill ${t.kind==='income'?'pill--in':'pill--out'}">${t.kind==='income'?'IN':'OUT'}</span>`},
  platform:{label:'Piattaforma', cell:t=>esc(t.platform)},
  type:    {label:'Tipologia',   cell:t=>esc(t.type)},
  catalog: {label:'Catalogo',    cell:t=>{ const r=releaseForTx(t); return r&&t.catalog?`<span class="lf-link" data-rel-open="${r.id}">${esc(t.catalog)}</span>`:esc(t.catalog); }},
  product: {label:'Prodotto',    cell:t=>{ const r=releaseForTx(t); return r?`<span class="lf-link" data-rel-open="${r.id}" title="${tt('tx.open_release')}">${esc(t.product||r.title||'')}</span>`:esc(t.product); }},
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
  const selH=`<th class="dbl-sel"><input type="checkbox" data-selall="transactions"></th>`;
  const head=selH+cols.map(c=>{ const act=txSort.col===c?(txSort.dir>0?' ▲':' ▼'):'';
    return `<th class="th-sort ${TX_COLS[c].num?'num':''}" data-col="${c}">${esc(colLabel(c))}${act}</th>`; }).join('');
  const selSet=(bulkSel.transactions||new Set());
  const body=pageRows.length
    ? pageRows.map(t=>`<tr data-id="${t.id}"><td class="dbl-sel"><input type="checkbox" data-sel="transactions|${t.id}" ${selSet.has(t.id)?'checked':''}></td>${cols.map(c=>`<td class="${TX_COLS[c].num?'num':''}" data-label="${esc(colLabel(c))}">${TX_COLS[c].cell(t)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${(cols.length||1)+1}" class="muted">${tt('empty.notx')}</td></tr>`;
  $('#table-tx').innerHTML=`<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  mountPager($('#table-tx'), 'tx', info);
  $$('#table-tx thead th[data-col]').forEach(th=>th.onclick=()=>{
    const c=th.dataset.col;
    if(txSort.col===c) txSort.dir*=-1; else txSort={col:c, dir:TX_COLS[c].num?-1:1};
    applyTxFilters();
  });
  $$('#table-tx tbody tr[data-id]').forEach(tr=>tr.onclick=e=>{
    if(e.target.closest('[data-rel-open]')||e.target.closest('.dbl-sel')) return;
    openTx(tr.dataset.id);
  });
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
$('#r-exclusive')?.addEventListener('change',e=>{ $('#r-excl-wrap').hidden = e.target.value!=='yes'; });
/* Autocomplete artista nella release (dagli artisti già creati) */
function renderArtistAC(){
  const inp=$('#r-artist'), box=$('#r-artist-ac'); if(!inp||!box) return;
  const q=inp.value.trim().toLowerCase();
  if(!q){ box.hidden=true; box.innerHTML=''; return; }
  const matches=(DB.artists||[]).filter(a=>(a.name||'').toLowerCase().includes(q)||(a.legal||'').toLowerCase().includes(q)).slice(0,8);
  box.innerHTML = matches.length
    ? matches.map(a=>`<div class="ac-item" data-ac-name="${esc(a.name)}">${esc(a.name)}${a.legal?`<span class="muted small"> · ${esc(a.legal)}</span>`:''}</div>`).join('')
    : `<div class="ac-item ac-add" data-ac-add="1">${tt('r.artist_add')}</div>`;
  box.hidden=false;
}
function quickAddArtistFromRelease(name){
  $('#rel-modal').hidden=true;
  goto('artists'); openArtistForm(); if(name) $('#art-name').value=name;
  $('#art-form')?.scrollIntoView({behavior:'smooth',block:'start'}); toast(tt('r.artist_after'));
}
$('#r-artist')?.addEventListener('input',renderArtistAC);
$('#r-artist')?.addEventListener('focus',renderArtistAC);
$('#r-artist-ac')?.addEventListener('click',e=>{
  const pick=e.target.closest('[data-ac-name]'); if(pick){ $('#r-artist').value=pick.dataset.acName; $('#r-artist-ac').hidden=true; return; }
  if(e.target.closest('[data-ac-add]')) quickAddArtistFromRelease($('#r-artist').value.trim());
});
document.addEventListener('click',e=>{ if(!e.target.closest('.ac-field')){ const b=$('#r-artist-ac'); if(b) b.hidden=true; } });
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
function releaseByTitle(name){
  if(!name) return null; const n=name.trim().toLowerCase(); if(!n) return null;
  return releases().find(r=>(r.title||'').trim().toLowerCase()===n) || null;
}
function releaseByUPC(upc){ const u=(''+(upc||'')).replace(/\D/g,''); if(!u) return null;
  return releases().find(r=>(''+(r.upc||'')).replace(/\D/g,'')===u) || null; }
function releaseByISRC(isrc){ const i=(isrc||'').trim().toLowerCase(); if(!i) return null;
  return releases().find(r=>(r.tracks||[]).some(x=>(x.isrc||'').trim().toLowerCase()===i)) || null; }
// release collegata a un movimento: per catalogo, UPC, ISRC di traccia, o nome prodotto = titolo release
function releaseForTx(t){ return releaseByCatalog(t.catalog) || releaseByUPC(t.upc||t.code) || releaseByISRC(t.isrc) || releaseByTitle(t.product) || null; }
let relSort={col:'catalog',dir:1};
function sortReleases(arr){
  const k=relSort.col, d=relSort.dir;
  return arr.slice().sort((a,b)=>{
    if(k==='year') return ((+a.year||0)-(+b.year||0))*d;
    if(k==='isrc') return (((a.tracks||[]).length)-((b.tracks||[]).length))*d;
    return String(a[k]||'').toLowerCase().localeCompare(String(b[k]||'').toLowerCase())*d;
  });
}
function renderReleases(){
  const rq=($('#rel-search')&&$('#rel-search').value||'').toLowerCase().trim();
  let base=releases().slice();
  if(rq) base=base.filter(r=>((r.catalog||'')+' '+(r.title||'')+' '+(r.artist||'')+' '+(r.upc||'')).toLowerCase().includes(rq));
  const all=colSort('releases', base, relSort);
  $('#rel-count-label').textContent=`${all.length} release`;
  const info=paginate(all,'rel'); const list=info.slice;
  const cont=$('#releases-cards'); const mode=getVM('releases','cards');
  if(!list.length){ cont.className='releases-cards'; cont.innerHTML=`<p class="muted">${tt('empty.norel')}</p>`; mountPager(cont,'rel',info); syncVMButtons(); return; }
  if(mode==='list'){
    cont.className='dbl';
    const cols=colsFor('releases');
    const sel=selOpt('releases');
    cont.innerHTML = dbHead(cols,relSort,{sel})+dbRows(list,cols,{rowCls:'dbl-click',sel});
    cont.querySelectorAll('.dbl-row[data-id]').forEach(c=>c.onclick=e=>{ if(e.target.closest('[data-sort]')||e.target.closest('.dbl-sel')) return; openRelease(c.dataset.id); });
    cont.querySelectorAll('[data-sort]').forEach(h=>h.onclick=e=>{ e.stopPropagation(); const k=h.dataset.sort;
      if(relSort.col===k) relSort.dir*=-1; else relSort={col:k,dir:1}; renderReleases(); });
    mountPager(cont,'rel',info); syncVMButtons(); return;
  }
  {
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
  cont.querySelectorAll('[data-rsort]').forEach(h=>h.onclick=e=>{ e.stopPropagation(); const c=h.dataset.rsort;
    if(relSort.col===c) relSort.dir*=-1; else relSort={col:c,dir:1}; renderReleases(); });
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
  $('#r-catalog').value=r?.catalog||''; $('#r-title').value=r?.title||''; $('#r-artist').value=r?.artist||'';
  $('#r-preorder').value=r?.preorder||''; $('#r-order').value=r?.orderDate||''; $('#r-upc').value=r?.upc||'';
  $('#r-note').value=r?.note||''; $('#r-exclusive').value=r?.exclusive?'yes':''; $('#r-excl-plat').value=r?.exclusivePlatform||'';
  $('#r-excl-wrap').hidden = !r?.exclusive;
  $('#r-written').value=r?.writtenBy||''; $('#r-produced').value=r?.producedBy||''; $('#r-mixed').value=r?.mixedBy||'';
  $('#r-mastered').value=r?.masteredBy||''; $('#r-artwork').value=r?.artworkBy||''; $('#r-publisher').value=r?.publisher||'';
  if($('#r-artist-ac')) $('#r-artist-ac').hidden=true;
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
  const orderDate=$('#r-order').value||'';
  const rec={ id:id||uid(), catalog:$('#r-catalog').value.trim(), title:$('#r-title').value.trim(),
    artist:$('#r-artist').value.trim(), upc:$('#r-upc').value.trim(), splits, tracks,
    preorder:$('#r-preorder').value||'', orderDate, year: orderDate? new Date(orderDate+'T00:00:00').getFullYear() : '',
    note:$('#r-note').value.trim(), exclusive:$('#r-exclusive').value==='yes', exclusivePlatform:$('#r-excl-plat').value.trim(),
    writtenBy:$('#r-written').value.trim(), producedBy:$('#r-produced').value.trim(), mixedBy:$('#r-mixed').value.trim(),
    masteredBy:$('#r-mastered').value.trim(), artworkBy:$('#r-artwork').value.trim(), publisher:$('#r-publisher').value.trim() };
  if(!rec.catalog){ toast(tt('t.cat_required')); return; }
  if(!rec.orderDate){ toast(tt('r.order_required')); return; }
  if(id){ const i=releases().findIndex(r=>r.id===id); DB.releases[i]=rec; }
  else releases().push(rec);
  save(); $('#rel-modal').hidden=true; renderReleases(); renderRoyalties(); toast(tt('t.rel_saved'));
};

/* ============================================================================
   IMPORT CATALOGO universale — CSV di qualunque piattaforma → release + artisti
   ============================================================================ */
const CAT_SYN = {
  upc:['upc','ean','barcode','upc/ean','upc code','grid'],
  isrc:['isrc','isrc code'],
  catalog:['catalogue number','catalog number','catalog #','cat no','cat. no','cat no.','catno','catalog','catalogue','catalogo','codice catalogo','cat'],
  date:['original release date','digital release date','release date','data di uscita','data uscita','released','release_date','released on','date','data'],
  artist:['display artist','primary artist','main artist','artist name','album artist','artist','artists','artista','performer','band'],
  title:['release title','album title','album name','release name','product title','title','titolo','album','release','product'],
};
let catImpRaw='', catImpHeaders=[];
function autoMapCat(headers){
  const low=headers.map(h=>String(h||'').toLowerCase().trim()); const used=new Set(); const map={};
  const fields=['upc','isrc','catalog','date','artist','title'];
  fields.forEach(f=>{ for(const s of CAT_SYN[f]){ const i=low.findIndex((h,j)=>!used.has(j)&&h===s); if(i>=0){map[f]=i;used.add(i);break;} } });
  fields.forEach(f=>{ if(map[f]!=null) return; for(const s of CAT_SYN[f]){ const i=low.findIndex((h,j)=>!used.has(j)&&h.includes(s)); if(i>=0){map[f]=i;used.add(i);break;} } });
  fields.forEach(f=>{ if(map[f]==null) map[f]=-1; });
  return map;
}
function normDate(s){ s=String(s||'').trim(); if(!s) return '';
  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if(m){ let a=+m[1],b=+m[2],day,mon;
    if(a>12){day=a;mon=b;} else if(b>12){day=b;mon=a;} else {day=a;mon=b;} return `${m[3]}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
  const d=new Date(s); if(!isNaN(d.getTime())) return d.toISOString().slice(0,10); return '';
}
function catImpMap(){ const m={}; ['catalog','title','artist','date','upc','isrc'].forEach(f=>{ const sel=$('#catimp-'+f); m[f]=sel?(+sel.value):-1; }); return m; }
// dedupe + creazione (condivisa da import CSV e ricerca online). items: {title,artist,date,upc,catalog,isrcs[]}
/* ---------- Motore di disambiguazione (similarità % + unione) ---------- */
const DUP_ASK=58, DUP_AUTO=90;     // soglie: ≥ASK = possibile duplicato, ≥AUTO = unione automatica
function strSim(a,b){ a=a||''; b=b||''; if(a===b) return a?1:0; if(a.length<2||b.length<2) return 0;
  const bg=s=>{ const m={}; for(let i=0;i<s.length-1;i++){ const g=s.slice(i,i+2); m[g]=(m[g]||0)+1; } return m; };
  const A=bg(a), B=bg(b); let inter=0, tot=0;
  for(const k in A){ tot+=A[k]; if(B[k]) inter+=Math.min(A[k],B[k]); }
  for(const k in B) tot+=B[k];
  return tot? (2*inter)/tot : 0; }
function normTitle(s){ return (s||'').toString().toLowerCase()
  .replace(/\b(feat|ft|featuring)\.?\b.*$/,'')
  .replace(/\([^)]*\b(remaster(ed)?|deluxe|edition|version|mono|stereo|expanded|bonus|reissue|anniversary|original)\b[^)]*\)/g,'')
  .replace(/\[[^\]]*\]/g,'')
  .replace(/[^a-z0-9]+/g,' ').trim(); }
function normArt(s){ return (s||'').toString().toLowerCase().replace(/\b(feat|ft|featuring)\.?\b.*$/,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function relYear(r){ return (''+(r.year||r.orderDate||r.date||r.preorder||'')).slice(0,4); }
function relMatch(a,b){
  const dig=s=>(s||'').toString().replace(/\D/g,'');
  const ua=dig(a.upc), ub=dig(b.upc);
  if(ua&&ub&&ua===ub) return {score:100, reasons:['upc']};
  const nc=s=>(s||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,'');
  const ca=nc(a.catalog), cb=nc(b.catalog);
  const tS=strSim(normTitle(a.title),normTitle(b.title));
  if(ca&&cb&&ca===cb&&ca.length>=3){ const r=['cat']; if(tS>=0.6) r.push(tS>=0.85?'title':'title2'); return {score:Math.max(88,Math.round(72+tS*28)), reasons:r}; }
  const arBoth=!!(a.artist&&b.artist);
  const arS=arBoth?strSim(normArt(a.artist),normArt(b.artist)):0.6;
  let score=Math.round(tS*62 + arS*30);
  const ya=relYear(a), yb=relYear(b);
  if(ya&&yb){ score = ya===yb ? Math.min(98,score+8) : Math.max(0,score-10); }
  if(ua&&ub&&ua!==ub) score=Math.max(0,score-25);  // barcode diversi → probabile edizione diversa
  const reasons=[];
  if(tS>=0.85) reasons.push('title'); else if(tS>=0.6) reasons.push('title2');
  if(arBoth&&arS>=0.8) reasons.push('artist');
  return {score:Math.min(100,Math.max(0,score)), reasons};
}
function itemToRelease(it){
  const title=(it.title||'').trim(), artist=(it.artist||'').trim(), upc=(it.upc||'').trim(), catalog=(it.catalog||'').trim();
  const date=normDate(it.date||'');
  return { id:uid(), catalog, title, artist, upc, orderDate:date, preorder:'', note:'',
    year:date?new Date(date+'T00:00:00').getFullYear():'',
    splits:[], tracks:(it.isrcs||[]).filter(Boolean).map(code=>({id:uid(), title:'', isrc:code, splits:[]})) };
}
function mergeRelInto(target, src){
  ['catalog','title','artist','upc','orderDate','preorder','year','note','exclusive','exclusivePlatform'].forEach(f=>{ if(!target[f] && src[f]) target[f]=src[f]; });
  if((!target.splits||!target.splits.length) && src.splits&&src.splits.length) target.splits=src.splits;
  const seen=new Set((target.tracks||[]).map(t=>(t.isrc||'').toLowerCase()).filter(Boolean));
  (src.tracks||[]).forEach(t=>{ const k=(t.isrc||'').toLowerCase(); if(k && !seen.has(k)){ seen.add(k); (target.tracks=target.tracks||[]).push(t); } });
}
function collectNewArtists(items){
  const exist=new Set((DB.artists||[]).map(a=>(a.name||'').toLowerCase()));
  const seen=new Set(), out=[];
  items.forEach(it=>{ (it.artist? (''+it.artist).split(/,|&|;| feat\.?| ft\.?| x /i):[]).map(s=>s.trim()).filter(Boolean)
    .forEach(nm=>{ const lk=nm.toLowerCase(); if(exist.has(lk)||seen.has(lk)) return; seen.add(lk); out.push({id:newId(), name:nm, split:''}); }); });
  return out;
}
function analyzeImport(items){
  const incoming=items.map(itemToRelease).filter(r=>r.title||r.upc);
  const existing=releases();
  const toAdd=[], conflicts=[];
  incoming.forEach(rel=>{
    let best=null, bestKind='', bestRef=null;
    existing.forEach(ex=>{ const m=relMatch(rel,ex); if(m.score>=DUP_ASK && (!best||m.score>best.score)){ best=m; bestKind='existing'; bestRef=ex; } });
    toAdd.forEach(nw=>{ const m=relMatch(rel,nw); if(m.score>=DUP_ASK && (!best||m.score>best.score)){ best=m; bestKind='new'; bestRef=nw; } });
    if(best) conflicts.push({incoming:rel, target:bestRef, kind:bestKind, score:best.score, reasons:best.reasons, decision:'keep'});
    else toAdd.push(rel);
  });
  return {toAdd, conflicts};
}
// commit=false → solo conteggi per l'anteprima; commit=true → applica o apre la revisione duplicati
function importReleasesData(items, commit){
  const {toAdd, conflicts}=analyzeImport(items);
  const newArtists=collectNewArtists(items);
  if(!commit) return { relNew:toAdd.length, relDup:conflicts.length, artNew:newArtists.length };
  if(!conflicts.length){
    toAdd.forEach(r=>releases().push(r)); DB.artists=DB.artists||[]; newArtists.forEach(a=>DB.artists.push(a));
    save(); renderReleases(); renderArtists(); renderRoyalties();
    return { relNew:toAdd.length, relDup:0, artNew:newArtists.length, direct:true };
  }
  dupState={mode:'import', conflicts, toAdd, newArtists};
  openDupModal();
  return { relNew:toAdd.length, relDup:conflicts.length, artNew:newArtists.length, review:true };
}
function catImpItems(){
  const rows=parseCSV(catImpRaw||''); const data=rows.slice(1); const map=catImpMap();
  const get=(r,f)=> map[f]>=0 ? String(r[map[f]]||'').trim() : '';
  const groups=new Map();
  data.forEach(r=>{ if(!r||!r.length) return;
    const catalog=get(r,'catalog'), title=get(r,'title'), artist=get(r,'artist'), date=get(r,'date'), upc=get(r,'upc'), isrc=get(r,'isrc');
    if(!catalog && !title && !upc) return;
    const key=(upc||catalog||title).toLowerCase();
    let g=groups.get(key); if(!g){ g={catalog,title,artist,date,upc,isrcs:[]}; groups.set(key,g); }
    if(!g.catalog&&catalog) g.catalog=catalog; if(!g.title&&title) g.title=title;
    if(!g.artist&&artist) g.artist=artist; if(!g.date&&date) g.date=date; if(!g.upc&&upc) g.upc=upc;
    if(isrc && !g.isrcs.includes(isrc)) g.isrcs.push(isrc);
  });
  return { items:[...groups.values()], rows:data.length };
}
function catImpCompute(commit){ const {items,rows}=catImpItems(); const r=importReleasesData(items,commit); return {...r, rows}; }
/* ---- Ricerca catalogo online (MusicBrainz/Discogs/Spotify) ---- */
let catCandidates=[], catSpotify=false;
async function catOnlineSearch(){
  const q=($('#catimp-q').value||'').trim(); const box=$('#catimp-results'); if(!q||!box) return;
  if(!window.LF_catalogSearch){ box.innerHTML=`<p class="ai-err">${tt('cimp.offline')}</p>`; return; }
  box.innerHTML=`<p class="muted small">${tt('cimp.searching')}</p>`;
  const res=await window.LF_catalogSearch({action:'search', query:q});
  if(!res||res.error){ box.innerHTML=`<p class="ai-err">${tt('cimp.search_fail')}${res&&res.error?` (${esc(String(res.error))})`:''}</p>`; return; }
  catCandidates=res.candidates||[]; catSpotify=!!res.spotify;
  let html='';
  if(catCandidates.length) html+=catCandidates.map((c,i)=>`<label class="cat-cand"><input type="checkbox" data-cand="${i}" ${i===0?'checked':''}> <b>${esc(c.name)}</b> <span class="muted small">${esc(c.detail||c.source)}</span></label>`).join('');
  if(catSpotify) html+=`<label class="cat-cand"><input type="checkbox" id="cat-sp" checked> <b>Spotify</b> <span class="muted small">${tt('cimp.by_name').replace('{q}',esc(q))}</span></label>`;
  if(!catCandidates.length && !catSpotify){
    let diag='';
    if(res.sources){ const s=res.sources;
      diag=`<p class="muted small" style="margin-top:8px">MusicBrainz: ${s.musicbrainz?(s.musicbrainz.err?('⚠ '+esc(s.musicbrainz.err)):s.musicbrainz.n):'—'} · Discogs: ${s.discogs?(s.discogs.err==='no token'?tt('cimp.no_token'):(s.discogs.err?('⚠ '+esc(s.discogs.err)):s.discogs.n)):'—'}</p>`;
      diag+=`<p class="muted small">${tt('cimp.hint_token')}</p>`;
    }
    html=`<p class="muted small">${tt('cimp.no_label')}</p>`+diag;
  } else {
    html += `<button class="btn btn-primary" id="cat-import" style="margin-top:10px">${tt('cimp.fetch')}</button>`;
  }
  box.innerHTML=html;
}
async function catOnlineImport(){
  const picks={ mb:[], discogs:[], spotifyName:null };
  $$('#catimp-results [data-cand]:checked').forEach(c=>{ const cand=catCandidates[+c.dataset.cand]; if(!cand) return;
    if(cand.source==='mb') picks.mb.push(cand.id); else if(cand.source==='discogs') picks.discogs.push(cand.id); });
  if($('#cat-sp') && $('#cat-sp').checked) picks.spotifyName=($('#catimp-q').value||'').trim();
  if(!picks.mb.length && !picks.discogs.length && !picks.spotifyName){ toast(tt('cimp.pick_one')); return; }
  const btn=$('#cat-import'); if(btn){ btn.disabled=true; btn.textContent=tt('cimp.fetching'); }
  const res=await window.LF_catalogSearch({action:'fetch', picks});
  if(btn){ btn.disabled=false; btn.textContent=tt('cimp.fetch'); }
  if(!res||res.error||!res.releases){ toast(tt('cimp.search_fail')+(res&&res.error?` (${res.error})`:'')); return; }
  const r=importReleasesData(res.releases, true);
  if(!r.review) toast(tt('cimp.done').replace('{rel}',r.relNew).replace('{art}',r.artNew).replace('{dup}',r.relDup));
  let hadErr=false, diag='';
  if(res.sources){ const s=res.sources; const p=[];
    if(picks.mb.length) p.push('MusicBrainz: '+(s.musicbrainz.err?('⚠ '+esc(s.musicbrainz.err)):s.musicbrainz.n));
    if(picks.discogs.length) p.push('Discogs: '+(s.discogs.err?('⚠ '+esc(s.discogs.err)):s.discogs.n));
    if(picks.spotifyName) p.push('Spotify: '+(s.spotify.err?('⚠ '+esc(s.spotify.err)):s.spotify.n));
    diag=p.join('<br>'); hadErr=!!(s.musicbrainz.err||s.discogs.err||s.spotify.err);
  }
  if(hadErr){ const box=$('#catimp-results'); if(box) box.insertAdjacentHTML('beforeend', `<p class="ai-err" style="margin-top:10px">${diag}</p>`); }
  else if(!r.review) $('#catimp-modal').hidden=true;
}
function catImpRenderMaps(){
  const opts=(sel)=>['<option value="-1">—</option>'].concat(catImpHeaders.map((h,i)=>`<option value="${i}" ${i===sel?'selected':''}>${esc(h||('Col '+(i+1)))}</option>`)).join('');
  const am=autoMapCat(catImpHeaders);
  const fields=[['catalog','col.catalog'],['title','rel.c_title'],['artist','r.artist'],['date','r.order'],['upc','r.upc'],['isrc','ISRC']];
  $('#catimp-maps').innerHTML = fields.map(([f,k])=>`<label><span>${k==='ISRC'?'ISRC':esc(tt(k).replace(' *',''))}</span>
    <select class="select" id="catimp-${f}">${opts(am[f])}</select></label>`).join('');
  $$('#catimp-maps select').forEach(s=>s.onchange=catImpPreview);
  catImpPreview();
}
function catImpPreview(){ const r=catImpCompute(false);
  const el=$('#catimp-preview'); if(el) el.textContent = tt('cimp.preview')
    .replace('{rows}',r.rows).replace('{rel}',r.relNew).replace('{art}',r.artNew).replace('{dup}',r.relDup); }
function catImpLoad(file){ const rd=new FileReader();
  rd.onload=()=>{ catImpRaw=rd.result||''; const rows=parseCSV(catImpRaw); catImpHeaders=rows[0]||[];
    if(!catImpHeaders.length){ toast(tt('cimp.empty')); return; }
    $('#catimp-config').hidden=false; catImpRenderMaps(); };
  rd.readAsText(file); }
(function wireCatImp(){
  const open=$('#catimp-open'); if(open) open.onclick=()=>{ $('#catimp-config').hidden=true; $('#catimp-preview').textContent=''; $('#catimp-results').innerHTML=''; $('#catimp-modal').hidden=false; };
  if($('#catimp-go')) $('#catimp-go').onclick=catOnlineSearch;
  if($('#catimp-q')) $('#catimp-q').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); catOnlineSearch(); } });
  if($('#catimp-results')) $('#catimp-results').addEventListener('click',e=>{ if(e.target.closest('#cat-import')) catOnlineImport(); });
  if($('#catimp-close')) $('#catimp-close').onclick=()=>$('#catimp-modal').hidden=true;
  if($('#catimp-modal')) $('#catimp-modal').onclick=e=>{ if(e.target.id==='catimp-modal') $('#catimp-modal').hidden=true; };
  if($('#catimp-browse')) $('#catimp-browse').onclick=()=>$('#catimp-file').click();
  if($('#catimp-file')) $('#catimp-file').onchange=e=>{ if(e.target.files[0]) catImpLoad(e.target.files[0]); };
  const drop=$('#catimp-drop');
  if(drop){ ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
    drop.addEventListener('drop',e=>{ const f=e.dataTransfer.files[0]; if(f) catImpLoad(f); }); }
  if($('#catimp-do')) $('#catimp-do').onclick=()=>{ const r=catImpCompute(true);
    $('#catimp-modal').hidden=true;
    if(!r.review) toast(tt('cimp.done').replace('{rel}',r.relNew).replace('{art}',r.artNew).replace('{dup}',r.relDup)); };
})();

/* ============================================================================
   REVISIONE DUPLICATI — pannello con similarità % + unione dati
   ============================================================================ */
let dupState=null;
const DUP_REASON={upc:'dup.r_upc',cat:'dup.r_cat',title:'dup.r_title',title2:'dup.r_title2',artist:'dup.r_artist'};
function dupScoreCls(s){ return s>=DUP_AUTO?'hi':(s>=72?'mid':'lo'); }
function relLabel(r){ const meta=[r.catalog,r.upc,relYear(r)].filter(Boolean).join(' · ');
  return `<b>${esc(r.title)||'—'}</b><span class="muted small">${esc(r.artist||'')}${meta?(' · '+esc(meta)):''}</span>`; }
function renderDupList(){
  const box=$('#dup-list'); if(!box||!dupState) return;
  const ex=dupState.mode==='existing';
  box.innerHTML=dupState.conflicts.map((c,i)=>{
    const reasons=(c.reasons||[]).map(r=>`<span class="dup-rsn">${esc(tt(DUP_REASON[r]||r))}</span>`).join('');
    const lTag = ex?'A':tt('dup.new');
    const rTag = ex?'B':(c.kind==='existing'?tt('dup.incat'):tt('dup.inimport'));
    const opt=(val,lab)=>`<label class="dup-opt"><input type="radio" name="dup-${i}" value="${val}" ${c.decision===val?'checked':''}> ${esc(tt(lab))}</label>`;
    const actions = ex
      ? opt('merge','dup.merge')+opt('keep','dup.ignore')
      : opt('merge','dup.merge')+opt('keep','dup.keep')+opt('skip','dup.skip');
    return `<div class="dup-row" data-i="${i}">
      <div class="dup-pair">
        <div class="dup-side"><span class="dup-side-tag">${esc(lTag)}</span>${relLabel(c.incoming)}</div>
        <div class="dup-score dup-${dupScoreCls(c.score)}">${c.score}%</div>
        <div class="dup-side"><span class="dup-side-tag">${esc(rTag)}</span>${relLabel(c.target)}</div>
      </div>
      ${reasons?`<div class="dup-reasons">${reasons}</div>`:''}
      <div class="dup-actions">${actions}</div>
    </div>`;
  }).join('');
  dupUpdateSummary();
}
function dupUpdateSummary(){ const el=$('#dup-summary'); if(!el||!dupState) return;
  const m=dupState.conflicts.filter(c=>c.decision==='merge').length;
  el.textContent=tt('dup.summary').replace('{a}',m).replace('{n}',dupState.conflicts.length); }
function openDupModal(){ if(!dupState) return;
  const ex=dupState.mode==='existing';
  $('#dup-title').textContent=tt('dup.title');
  $('#dup-intro').textContent=(ex?tt('dup.intro_existing'):tt('dup.intro_import')).replace('{n}',dupState.conflicts.length);
  renderDupList(); $('#dup-modal').hidden=false; }
function closeDupModal(){ $('#dup-modal').hidden=true; dupState=null; }
function dupAutoMerge(){ if(!dupState) return;
  dupState.conflicts.forEach(c=>{ if(c.score>=DUP_AUTO) c.decision='merge'; }); renderDupList(); }
function dupApply(){
  if(!dupState) return;
  if(dupState.mode==='existing'){
    const del=new Set(); let merged=0;
    dupState.conflicts.forEach(c=>{ if(c.decision==='merge' && !del.has(c.target.id) && !del.has(c.incoming.id)){ mergeRelInto(c.target,c.incoming); del.add(c.incoming.id); merged++; } });
    if(del.size) DB.releases=releases().filter(r=>!del.has(r.id));
    save(); renderReleases(); renderRoyalties();
    toast(tt('dup.applied').replace('{m}',merged).replace('{k}',dupState.conflicts.length-merged).replace('{s}',0));
  } else {
    const {conflicts,toAdd,newArtists}=dupState;
    toAdd.forEach(r=>releases().push(r));
    let merged=0,kept=0,skipped=0;
    conflicts.forEach(c=>{ if(c.decision==='merge'){ mergeRelInto(c.target,c.incoming); merged++; }
      else if(c.decision==='skip'){ skipped++; }
      else { releases().push(c.incoming); kept++; } });
    DB.artists=DB.artists||[]; (newArtists||[]).forEach(a=>DB.artists.push(a));
    save(); renderReleases(); renderArtists(); renderRoyalties();
    toast(tt('dup.applied').replace('{m}',merged).replace('{k}',toAdd.length+kept).replace('{s}',skipped));
  }
  closeDupModal();
}
function dupScanExisting(){
  const rels=releases();
  if(rels.length<2){ toast(tt('dup.none')); return; }
  const conflicts=[];
  for(let i=0;i<rels.length;i++) for(let j=i+1;j<rels.length;j++){
    const m=relMatch(rels[i],rels[j]);
    if(m.score>=DUP_ASK) conflicts.push({incoming:rels[j], target:rels[i], kind:'existing-pair', score:m.score, reasons:m.reasons, decision:'keep'});
  }
  if(!conflicts.length){ toast(tt('dup.none')); return; }
  conflicts.sort((a,b)=>b.score-a.score);
  dupState={mode:'existing', conflicts, toAdd:[], newArtists:[]};
  openDupModal();
}
(function wireDup(){
  const m=$('#dup-modal'); if(!m) return;
  $('#dup-close')&&($('#dup-close').onclick=closeDupModal);
  $('#dup-cancel')&&($('#dup-cancel').onclick=closeDupModal);
  $('#dup-apply')&&($('#dup-apply').onclick=dupApply);
  $('#dup-auto')&&($('#dup-auto').onclick=dupAutoMerge);
  $('#dup-find')&&($('#dup-find').onclick=dupScanExisting);
  m.addEventListener('change',e=>{ const ip=e.target.closest('input[type="radio"]'); if(!ip||!dupState) return;
    const row=e.target.closest('.dup-row'); if(!row) return; const i=+row.dataset.i;
    if(dupState.conflicts[i]){ dupState.conflicts[i].decision=ip.value; dupUpdateSummary(); } });
  m.addEventListener('click',e=>{ if(e.target.id==='dup-modal') closeDupModal(); });
})();

/* ============================================================================
   ARRICCHIMENTO — dati utili nei Movimenti per release già in catalogo
   (UPC, ISRC, numero di catalogo, artista…). La data del movimento è la data
   di vendita, non di uscita: per questo NON viene proposta come Data di release.
   ============================================================================ */
let enrichCache=[];
function txEnrichments(){
  const out=[], seen=new Set();
  const fields=[
    {f:'upc',    label:()=>tt('r.upc'),     get:t=>(t.upc||t.code||'').trim()},
    {f:'catalog',label:()=>tt('col.catalog'),get:t=>(t.catalog||'').trim()},
    {f:'artist', label:()=>tt('r.artist'),   get:t=>(t.artist||'').trim()},
  ];
  (DB.transactions||[]).forEach(t=>{
    const rel=releaseForTx(t); if(!rel) return;
    fields.forEach(fd=>{ const v=fd.get(t); if(!v) return;
      if((''+(rel[fd.f]||'')).trim()) return;                 // campo già compilato → non toccare
      const key=rel.id+'|'+fd.f; if(seen.has(key)) return; seen.add(key);
      out.push({field:fd.f, label:fd.label(), relId:rel.id, relTitle:rel.title, value:v, product:t.product||''}); });
    const isrc=(t.isrc||'').trim();
    if(isrc){ const i=isrc.toLowerCase(); const key=rel.id+'|isrc|'+i;
      const has=(rel.tracks||[]).some(x=>(x.isrc||'').trim().toLowerCase()===i);
      if(!has && !seen.has(key)){ seen.add(key); out.push({field:'isrc', label:'ISRC', relId:rel.id, relTitle:rel.title, value:isrc, product:t.product||''}); } }
  });
  return out;
}
function applyEnrichments(list){
  let n=0;
  (list||[]).forEach(e=>{ const rel=releases().find(r=>r.id===e.relId); if(!rel) return;
    if(e.field==='isrc'){ const i=e.value.trim().toLowerCase();
      if(!(rel.tracks||[]).some(x=>(x.isrc||'').trim().toLowerCase()===i)){ (rel.tracks=rel.tracks||[]).push({id:uid(),title:e.product||'',isrc:e.value,splits:[]}); n++; } }
    else if(!(''+(rel[e.field]||'')).trim()){ rel[e.field]=e.value; n++; } });
  if(n){ save(); renderReleases&&renderReleases(); renderRoyalties&&renderRoyalties(); }
  return n;
}
function renderEnrichList(){ const box=$('#enrich-list'); if(!box) return;
  enrichCache=txEnrichments();
  if(!enrichCache.length){ box.innerHTML=`<p class="muted small">${tt('enr.none')}</p>`; return; }
  box.innerHTML=enrichCache.map((e,i)=>`<label class="dup-row enr-row">
    <input type="checkbox" data-enr="${i}" checked>
    <div class="enr-info">
      <b>${esc(e.relTitle)||'—'}</b>
      <span class="dup-rsn">${esc(e.label)}: ${esc(e.value)}</span>
      ${e.product?`<span class="muted small">${tt('enr.from')} «${esc(e.product)}»</span>`:''}
    </div></label>`).join('');
}
function openEnrichModal(){ renderEnrichList(); const m=$('#enrich-modal'); if(m) m.hidden=false; }
function enrichApply(){
  const sel=[]; $$('#enrich-list [data-enr]:checked').forEach(c=>{ const e=enrichCache[+c.dataset.enr]; if(e) sel.push(e); });
  const n=applyEnrichments(sel); const m=$('#enrich-modal'); if(m) m.hidden=true;
  toast(tt('enr.done').replace('{n}',n)); notifScan();
}
(function wireEnrich(){
  const m=$('#enrich-modal'); if(!m) return;
  $('#enrich-close')&&($('#enrich-close').onclick=()=>m.hidden=true);
  $('#enrich-cancel')&&($('#enrich-cancel').onclick=()=>m.hidden=true);
  $('#enrich-apply')&&($('#enrich-apply').onclick=enrichApply);
  m.addEventListener('click',e=>{ if(e.target.id==='enrich-modal') m.hidden=true; });
})();

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
  const rel=releaseByCatalog(t.catalog) || releaseByUPC(t.upc||t.code) || releaseByISRC(t.isrc) || releaseByTitle(t.product);
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
        .map(([c,a])=>`<div class="royc-line"><span>${relCatLink(c)}</span><b>${fmtMoney(a)}</b></div>`).join('');
      return `<div class="roy-card" data-artist="${esc(r.name)}">
        <div class="royc-head"><span class="royc-name">${artNameLink(r.name)}</span><span class="royc-tot pos">${fmtMoney(r.total)}</span></div>
        ${top?`<div class="royc-body">${top}</div>`:''}</div>`;
    }).join('') + (isLast?`<div class="roy-card roy-card--label"><div class="royc-head"><span class="royc-name">${tt('roy.label_residual')}</span><span class="royc-tot">${fmtMoney(labelTotal)}</span></div></div>`:'');
    cardsBox.querySelectorAll('.roy-card[data-artist]').forEach(c=>c.onclick=e=>{ if(e.target.closest('[data-rel-open],[data-art-open]')) return; showRoyaltyDetail(c.dataset.artist,byArtist[c.dataset.artist]); });
    clearPagerAfter(tbl); mountPager(cardsBox,'roy',info);
  } else {
    if(wrap) wrap.hidden=false; if(cardsBox){ cardsBox.hidden=true; cardsBox.innerHTML=''; }
    clearPagerAfter(cardsBox);
    tbl.innerHTML=`<thead><tr><th>${tt('roy.h.artist')}</th><th class="num">${tt('roy.h.amount')}</th></tr></thead>
      <tbody>${pr.map(r=>`<tr data-artist="${esc(r.name)}" style="cursor:pointer">
        <td data-label="Artista">${artNameLink(r.name)}</td><td class="num pos" data-label="Royalty (€)">${fmtMoney(r.total)}</td></tr>`).join('')}
        ${isLast?`<tr><td data-label=""><strong>${tt('roy.label_residual')}</strong></td><td class="num" data-label="${tt('roy.h.amount')}"><strong>${fmtMoney(labelTotal)}</strong></td></tr>`:''}
        ${rows.length?'':`<tr><td colspan="2" class="muted">${tt('empty.noroy')}</td></tr>`}</tbody>`;
    $$('#table-roy-artist tbody tr[data-artist]').forEach(tr=>tr.onclick=e=>{ if(e.target.closest('[data-art-open]')) return; showRoyaltyDetail(tr.dataset.artist,byArtist[tr.dataset.artist]); });
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
      return `<tr><td data-label="Release">${rel?`<span class="lf-link" data-rel-open="${rel.id}">${esc(r.cat)}${t}</span>`:esc(r.cat)+t}</td><td class="num pos" data-label="Royalty (€)">${fmtMoney(r.amt)}</td></tr>`; }).join('')}
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
  // merch
  const merch=(DB.merch||[]).map(m=>({nome:m.name, tipo:m.type, prezzo:+m.price||0, venduti:+m.sold||0,
    ricavi:+merchRevenue(m).toFixed(2), margine:+merchMargin(m).toFixed(2), scorte:m.stock==null?null:m.stock}))
    .sort((a,b)=>b.venduti-a.venduti);
  return {
    valuta:'EUR',
    totali:{ entrate:+income.toFixed(2), uscite:+expense.toFixed(2), margineNetto:+net.toFixed(2),
      marginePct: income? +((net/income)*100).toFixed(1):0, movimenti:txs.length },
    trendUltimi6Mesi:months, perPiattaforma:piattaforme, topArtistiRoyalty:artisti, nonRecouped:recoup,
    merch: merch.length?merch:undefined
  };
}
let aiBusy=false, aiLastResult=null;
function aiEntitled(){ return can('ai') || !!aiLocalKey(); }
/* preprompt utili in base al contesto/dati */
function contextPrompts(){
  const it=(window.LFI18N?window.LFI18N.lang:'it')!=='en';
  const p=[];
  p.push({ icon:'✦', label: it?'Analizza la situazione':'Analyze the situation',
    q: it?"Fammi un'analisi generale della situazione finanziaria dell'etichetta: punti di forza, criticità e i 3 prossimi passi più importanti.":"Give me a general analysis of the label's finances: strengths, issues and the 3 most important next steps." });
  p.push({ icon:'📉', label: it?'Dove perdo margine?':'Where am I losing margin?',
    q: it?'Quali piattaforme, release o spese stanno erodendo il mio margine e dove posso intervenire concretamente?':'Which platforms, releases or expenses are eroding my margin and where can I act concretely?' });
  if((DB.recoup||[]).length || releases().length)
    p.push({ icon:'💸', label: it?'Artisti da recoupare':'Artists to recoup',
      q: it?'Quali artisti non hanno ancora recuperato anticipi/costi, quanto manca e come gestirli?':'Which artists have not recouped advances/costs yet, how much is left and how to manage them?' });
  if((DB.merch||[]).length)
    p.push({ icon:'👕', label: it?'Come va il merch?':'How is merch doing?',
      q: it?'Analizza le vendite del merch: cosa vende di più, margini, scorte e cosa conviene spingere.':'Analyze merch sales: best sellers, margins, stock and what to push.' });
  p.push({ icon:'🔮', label: it?'Previsione prossimi mesi':'Next months forecast',
    q: it?'In base al trend recente, cosa posso aspettarmi nei prossimi 3 mesi e come migliorare i risultati?':'Based on the recent trend, what can I expect in the next 3 months and how to improve results?' });
  return p;
}
function aiPopBody(){
  const body=$('#ai-body'); if(!body) return;
  if(!aiEntitled()){
    body.innerHTML=`<div class="ai-upsell"><p>${tt('ai.locked')}</p><button class="btn btn-primary" data-goto="offers">${tt('ai.see_plans')}</button></div>`;
    return;
  }
  const prompts=contextPrompts();
  body.innerHTML=`<div class="ai-prompts" id="ai-prompts"><p class="ai-pop-sub muted small">${tt('ai.sub')}</p>
      <div class="ai-chips">${prompts.map((p,i)=>`<button class="ai-chip" data-aiq="${i}"><span class="ai-chip-i">${p.icon}</span>${esc(p.label)}</button>`).join('')}</div></div>
    <div class="ai-out" id="ai-out"></div>`;
  body._prompts=prompts;
  body.querySelectorAll('.ai-chip').forEach(b=>b.addEventListener('click',()=>{ const p=body._prompts[+b.dataset.aiq]; runAiQuestion(p.q,p.label); }));
}
function aiShowPrompts(e){ if(e&&e.stopPropagation) e.stopPropagation(); aiPopBody(); }   // torna sempre al menu del bot
function openAiPop(){ const pop=$('#ai-pop'); if(!pop) return; aiPopBody(); pop.hidden=false; document.body.classList.add('ai-open');
  const f=$('#ai-fab'); if(f){ f.setAttribute('aria-expanded','true'); f.classList.add('is-open'); } }
function closeAiPop(){ const pop=$('#ai-pop'); if(!pop) return; pop.hidden=true; document.body.classList.remove('ai-open');
  const f=$('#ai-fab'); if(f){ f.setAttribute('aria-expanded','false'); f.classList.remove('is-open'); } }
function toggleAiPop(){ const pop=$('#ai-pop'); if(pop) (pop.hidden?openAiPop():closeAiPop()); }
const AI_KEY_LS='labelfinance.aikey';
function aiLocalKey(){ try{ return localStorage.getItem(AI_KEY_LS)||''; }catch(e){ return ''; } }
async function aiAdviseDirect(payload){
  const key=aiLocalKey(); if(!key) return { error:'no_key' };
  const lang=payload.lang==='en'?'en':'it';
  const system = lang==='en'
    ? `You are a financial advisor for independent record labels. Analyze the label's data and give concrete, prioritized, actionable advice in clear English. Point out declining months, low-margin platforms, unrecouped artists, anomalous expenses and concrete next steps. Use short paragraphs and bullets. Never invent numbers not in the data. Keep it under ~350 words.`
    : `Sei un consulente finanziario per etichette discografiche indipendenti. Analizza i dati e dai consigli concreti, prioritari e azionabili in italiano. Segnala mesi in calo, piattaforme a basso margine, artisti non recouped, spese anomale e i prossimi passi. Usa paragrafi brevi ed elenchi. Non inventare numeri non presenti nei dati. Max ~350 parole.`;
  const q=(payload.question||'').trim();
  const userContent=(q?(q+'\n\n'):'')+'Dati dell\'etichetta (JSON):\n```json\n'+JSON.stringify(payload.summary||{},null,2)+'\n```';
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{ method:'POST',
      headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({ model:'claude-opus-4-8', max_tokens:1500, system, messages:[{role:'user',content:userContent}] }) });
    if(!r.ok){ let d=''; try{ d=await r.text(); }catch{} return { error:`ai_http_${r.status}`, detail:d.slice(0,400) }; }
    const data=await r.json();
    if(data&&data.stop_reason==='refusal') return { error:'refused' };
    const text=Array.isArray(data&&data.content)?data.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'):'';
    return { text, model:data&&data.model };
  }catch(e){ return { error:e.message||'ai_error' }; }
}
async function runAiQuestion(question, label){
  if(aiBusy) return; aiBusy=true;
  const prompts=$('#ai-prompts'); if(prompts) prompts.style.display='none';
  const out=$('#ai-out'); if(!out){ aiBusy=false; return; }
  out.innerHTML=`<div class="ai-result-top"><button class="ai-back" id="ai-back">‹ ${tt('ai.back')}</button>
      <span class="ai-q-echo">${esc(label||question)}</span></div>
    <div id="ai-result"><p class="ai-thinking muted">${tt('ai.thinking')}</p></div>`;
  $('#ai-back')?.addEventListener('click', aiShowPrompts);
  const summary=buildAiSummary();
  const payload={ summary, question, lang:(window.LFI18N?window.LFI18N.lang:'it') };
  let res={error:'offline'};
  try{
    if(aiLocalKey()) res=await aiAdviseDirect(payload);
    else if(window.LF_aiAdvise) res=await window.LF_aiAdvise(payload);
  }catch(e){ res={error:e.message}; }
  aiBusy=false;
  const rb=$('#ai-result'); if(!rb) return;
  if(res && res.text){
    aiLastResult={ label:label||question, question, text:res.text, summary, model:res.model, when:new Date() };
    rb.innerHTML=`<div class="ai-answer">${aiFormat(res.text)}</div>
      <div class="ai-out-actions"><button class="btn btn-ghost btn-sm" id="ai-back2">‹ ${tt('ai.back')}</button><button class="btn btn-ghost btn-sm" id="ai-export">⤓ ${tt('ai.export')}</button></div>`;
    $('#ai-export')?.addEventListener('click', exportAiAnalysis);
    $('#ai-back2')?.addEventListener('click', aiShowPrompts);
  } else {
    const map={ upgrade_required:tt('ai.err_plan'), unauthorized:tt('ai.err_auth'), offline:tt('ai.err_offline'),
      ai_not_configured:tt('ai.err_config'), refused:tt('ai.err_refused') };
    const code=res&&res.error, known=code&&map[code];
    let html=`<p class="ai-err">${known||tt('ai.err_generic')}${(code&&!known)?` <span class="muted small">(${esc(String(code))})</span>`:''}</p>`;
    if(res&&res.detail) html+=`<p class="muted small" style="white-space:pre-wrap;margin-top:6px">${esc(String(res.detail).slice(0,300))}</p>`;
    html+=`<div class="ai-out-actions"><button class="btn btn-ghost btn-sm" id="ai-back2">‹ ${tt('ai.back')}</button></div>`;
    rb.innerHTML=html;
    $('#ai-back2')?.addEventListener('click', aiShowPrompts);
  }
}
function aiReadableData(s){
  const it=(window.LFI18N?window.LFI18N.lang:'it')!=='en';
  const L = it
    ? {tot:'Totali',inc:'Entrate',exp:'Uscite',net:'Margine netto',mov:'movimenti',trend:'Andamento mensile (netto)',plat:'Per piattaforma',art:'Top artisti (royalty)',rec:'Da recuperare (recoupment)',merch:'Merch più venduto',units:'venduti'}
    : {tot:'Totals',inc:'Income',exp:'Expenses',net:'Net margin',mov:'transactions',trend:'Monthly trend (net)',plat:'By platform',art:'Top artists (royalty)',rec:'To recoup',merch:'Best-selling merch',units:'sold'};
  const money=n=>'€'+(Number(n)||0).toLocaleString(it?'it-IT':'en-US',{maximumFractionDigits:2});
  const t=s.totali||{}; const rows=[];
  rows.push(`<b>${L.tot}:</b> ${L.inc} ${money(t.entrate)} · ${L.exp} ${money(t.uscite)} · ${L.net} ${money(t.margineNetto)} (${t.marginePct||0}%) · ${t.movimenti||0} ${L.mov}`);
  if(s.trendUltimi6Mesi&&s.trendUltimi6Mesi.length) rows.push(`<b>${L.trend}:</b> ${s.trendUltimi6Mesi.map(m=>esc(m.mese)+' '+money(m.netto)).join(' · ')}`);
  if(s.perPiattaforma&&s.perPiattaforma.length) rows.push(`<b>${L.plat}:</b> ${s.perPiattaforma.map(p=>esc(p.nome)+' '+money(p.netto)).join(' · ')}`);
  if(s.topArtistiRoyalty&&s.topArtistiRoyalty.length) rows.push(`<b>${L.art}:</b> ${s.topArtistiRoyalty.map(a=>esc(a.nome)+' '+money(a.royalty)).join(' · ')}`);
  if(s.nonRecouped&&s.nonRecouped.length) rows.push(`<b>${L.rec}:</b> ${s.nonRecouped.map(x=>esc(x.artista)+' '+money(x.nonRecuperato)).join(' · ')}`);
  if(s.merch&&s.merch.length) rows.push(`<b>${L.merch}:</b> ${s.merch.slice(0,8).map(m=>esc(m.nome)+' ('+(m.venduti||0)+' '+L.units+', '+money(m.ricavi)+')').join(' · ')}`);
  return rows.map(r=>`<p style="margin:0 0 7px;line-height:1.5">${r}</p>`).join('');
}
function exportAiAnalysis(){
  if(!aiLastResult) return; const r=aiLastResult;
  const fname='analisi-ai-'+isoD(new Date());
  if(typeof html2pdf==='undefined'){ // fallback testuale leggibile se la libreria PDF non c'è
    const plain=h=>String(h).replace(/<[^>]+>/g,'');
    const md=`${tt('ai.study_title')} — ${labelName()}\n${r.when.toLocaleString()}\n\n${tt('ai.q')}\n${r.question}\n\n${tt('ai.answer')}\n${r.text}\n\n${tt('ai.data')}\n${plain(aiReadableData(r.summary)).replace(/\s*\n\s*/g,'\n')}`;
    download(fname+'.txt', md, 'text/plain;charset=utf-8'); return;
  }
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-99999px;top:0;width:760px;background:#fff';
  host.innerHTML=`<div style="font-family:Inter,Arial,sans-serif;color:#1a1a1a;padding:26px 30px;background:#fff">
    <div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3e3e8;padding-bottom:14px;margin-bottom:18px">
      <img src="icon.png?v=3" style="width:32px;height:32px;border-radius:8px">
      <div><div style="font-weight:800;font-size:17px;letter-spacing:-.3px">Label<span style="color:#7c3aed">Finance</span> — ${esc(tt('ai.study_title'))}</div>
        <div style="font-size:12px;color:#777">${esc(labelName())} · ${esc(r.when.toLocaleString())}${r.model?(' · '+esc(r.model)):''}</div></div>
    </div>
    <h3 style="margin:0 0 4px;font-size:14px;color:#15131f">${esc(tt('ai.q'))}</h3>
    <p style="margin:0 0 16px;line-height:1.55">${esc(r.question)}</p>
    <h3 style="margin:0 0 6px;font-size:14px;color:#15131f">${esc(tt('ai.answer'))}</h3>
    <div style="line-height:1.65;font-size:14px">${aiFormat(r.text)}</div>
    <h3 style="margin:20px 0 6px;font-size:14px;color:#15131f">${esc(tt('ai.data'))}</h3>
    <div style="background:#f7f6fb;border:1px solid #e7e3f2;border-radius:8px;padding:14px 16px;font-size:12.5px;color:#333">${aiReadableData(r.summary)}</div>
  </div>`;
  document.body.appendChild(host);
  toast(tt('con.pdf_wait'));
  const opt={ margin:[8,8,8,8], filename:fname+'.pdf', image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',windowWidth:800},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}, pagebreak:{mode:['css','legacy']} };
  html2pdf().set(opt).from(host.firstElementChild).save().then(()=>host.remove(), ()=>host.remove());
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
    const map={ kpi:view.querySelector('.kpi-grid'),
      chart:$('#chart-monthly')&&$('#chart-monthly').closest('.panel'),
      g_release:$('#table-release')&&$('#table-release').closest('.panel'),
      g_artist:$('#table-artist')&&$('#table-artist').closest('.panel'),
      g_platform:$('#table-platform')&&$('#table-platform').closest('.panel'),
      g_type:$('#table-type')&&$('#table-type').closest('.panel'),
      forecast:$('#w-forecast'), w_top:$('#w-top'), recent:$('#w-recent'), merch:$('#w-merch'),
      nextrel:$('#w-nextrel'), nextevt:$('#w-nextevt'), support:$('#w-support'), disco:$('#w-disco') };
    const grid2=view.querySelector('.grid-2');
    // posiziona il contenitore prima delle card dati (dove c'erano i KPI)
    map.kpi.parentNode.insertBefore(cont, map.kpi);
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
    w.classList.toggle('is-hidden', l.hidden.includes(id));
  });
  renderHiddenTray();
}
function renderHiddenTray(){
  const tray=$('#dash-tray'); if(!tray) return; const l=dashLayout();
  const names={ ai:tt('ai.title'), kpi:'KPI', chart:tt('dash.chart.title'),
    g_release:tt('dash.byrelease'), g_artist:tt('dash.byartist'), g_platform:tt('dash.byplatform'), g_type:tt('dash.bytype'),
    forecast:tt('dash.forecast'), w_top:tt('dash.top_artists'), recent:tt('dash.recent'), merch:tt('mch.title'),
    nextrel:tt('dash.next_rel'), nextevt:tt('dash.next_evt'), support:tt('dash.sup_top'), disco:tt('dash.disco') };
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
  // Merch più venduto (per unità)
  const mb=$('#merch-body');
  if(mb){
    const items=(DB.merch||[]).filter(m=>(+m.sold||0)>0).sort((a,b)=>(+b.sold||0)-(+a.sold||0)).slice(0,6);
    const max=Math.max(1,...items.map(m=>+m.sold||0));
    mb.innerHTML = items.length ? items.map(m=>`
      <div class="top-row"><span class="top-name">${(MERCH_ICON[m.type]||'📦')} ${esc(m.name)}</span>
        <span class="top-bar"><i style="width:${Math.round((+m.sold||0)/max*100)}%"></i></span>
        <span class="top-val">${m.sold||0}</span></div>`).join('')
      : `<p class="muted">${tt('mch.none_sold')}</p>`;
  }
  const todayStr=isoD(new Date());
  // Prossime uscite (da Pianificazione)
  const nrb=$('#nextrel-body');
  if(nrb){
    const up=(DB.planning||[]).filter(p=>p.date && p.date>=todayStr && p.status!=='done')
      .sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
    nrb.innerHTML = up.length ? up.map(p=>`<div class="wrow" data-goto="planning">
        <span class="wrow-date">${esc(fmtDate(p.date))}</span>
        <span class="wrow-main"><b>${esc(p.title)}</b>${p.artist?`<span class="muted small"> · ${esc(p.artist)}</span>`:''}</span>
        <span class="wrow-tag">${tt(PLN_KIND[p.kind]||'pln.k_release')}</span></div>`).join('')
      : `<p class="muted">${tt('dash.next_rel_none')}</p>`;
  }
  // Prossimi eventi
  const neb=$('#nextevt-body');
  if(neb){
    const up=(DB.events||[]).filter(e=>e.date && e.date>=todayStr)
      .sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||''))).slice(0,6);
    neb.innerHTML = up.length ? up.map(e=>`<div class="wrow" data-goto="events">
        <span class="wrow-date">${esc(fmtDate(e.date))}${e.time?(' · '+esc(e.time)):''}</span>
        <span class="wrow-main"><b>${esc(e.title)}</b>${e.city?`<span class="muted small"> · ${esc(e.city)}</span>`:''}</span>
        <span class="wrow-tag">${tt(EVT_KIND[e.kind]||'evt.k_other')}</span></div>`).join('')
      : `<p class="muted">${tt('dash.next_evt_none')}</p>`;
  }
  // Support nel mondo (top paesi)
  const sb=$('#support-body');
  if(sb){
    const byC={}; (DB.supports||[]).forEach(s=>{ const c=(s.country||'—').trim()||'—'; byC[c]=(byC[c]||0)+1; });
    const rows=Object.entries(byC).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const max=Math.max(1,...rows.map(r=>r[1]));
    sb.innerHTML = rows.length ? rows.map(([c,n])=>`<div class="top-row"><span class="top-name">${esc(c)}</span>
        <span class="top-bar"><i style="width:${Math.round(n/max*100)}%"></i></span><span class="top-val">${n}</span></div>`).join('')
      : `<p class="muted">${tt('dash.sup_none')}</p>`;
  }
  // Discografia
  const db=$('#disco-body'), dc=$('#disco-count');
  if(db){
    const rels=releases();
    if(dc) dc.textContent = rels.length+' '+tt('dash.disco_count');
    const last=rels.slice().sort((a,b)=>String(b.year||'').localeCompare(String(a.year||''))||String(b.catalog||'').localeCompare(String(a.catalog||''))).slice(0,6);
    db.innerHTML = last.length ? last.map(r=>`<div class="wrow" data-goto="releases">
        <span class="wrow-date">${esc(r.catalog||'')}</span>
        <span class="wrow-main"><b>${esc(r.title||'—')}</b></span>
        <span class="wrow-tag">${esc(r.year||'')}</span></div>`).join('')
      : `<p class="muted">${tt('dash.disco_none')}</p>`;
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
let artSort={col:'name',dir:1};
function sortArtists(arr){
  const k=artSort.col, d=artSort.dir;
  return arr.slice().sort((a,b)=>{
    if(k==='split') return ((+a.split||0)-(+b.split||0))*d;
    return String(a[k]||'').toLowerCase().localeCompare(String(b[k]||'').toLowerCase())*d;
  });
}
function renderArtists(){
  const grid=$('#artists-grid'); if(!grid) return;
  const q=($('#art-search')&&$('#art-search').value||'').toLowerCase().trim();
  let all=(DB.artists||[]).filter(a=> !q || (a.name+' '+(a.legal||'')+' '+(a.email||'')).toLowerCase().includes(q));
  all=colSort('artists', all, artSort);
  $('#artists-empty').hidden = (DB.artists||[]).length>0;
  const info=paginate(all,'artists'); const list=info.slice;
  const mode=getVM('artists','cards');
  const av=a=>`<div class="art-av">${a.photo?`<img src="${a.photo}" alt="">`:`<span>${esc(initials(a.name))}</span>`}</div>`;
  const acts=a=>`<div class="art-actions">
        <button class="icon-btn-sm" data-art-edit="${a.id}" title="${tt('common.edit')}">✎</button>
        <button class="icon-btn-sm" data-art-del="${a.id}" title="${tt('common.delete')}">🗑</button></div>`;
  if(mode==='list'){
    grid.className='dbl';
    const cols=colsFor('artists');
    const sel=selOpt('artists');
    grid.innerHTML = dbHead(cols,artSort,{leadW:44,actions:1,sel}) + dbRows(list,cols,{leadW:44,lead:av,actions:a=>rowActs('art',a.id),sel});
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
  updateConSendBtn();
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
function cdSigCell(sig, role){
  if(sig) return `<div class="cd-sgn"><span class="cd-sgn-role">${role}</span>
    <img class="cd-sig-img" src="${sig.dataUrl}" alt="signature">
    <div class="cd-sig-meta"><b>${esc(sig.name||'')}</b><br>${esc(sig.date||'')}${sig.time?(' '+esc(sig.time)):''}${sig.place?(' · '+esc(sig.place)):''}</div></div>`;
  return `<div class="cd-sgn"><span class="cd-sgn-role">${role}</span><div class="cd-sgn-blank"><span>Date / Signature</span><hr></div></div>`;
}
function buildContractDoc(c){
  const L=esc(c.label), aPct=c.artistPct, lPct=100-c.artistPct;
  const sig = `<div class="cd-signs">
    ${cdSigCell(c.labelSign, 'For the Label — '+L)}
    ${cdSigCell(c.artistSign||c.signed, 'For the Artist — '+(esc(c.fullName)||'Artist'))}</div>`;
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
async function sendContract(){
  if(!currentContract) return; const c=currentContract;
  if(!c.labelSign){ toast(tt('con.need_label_sign')); return; }   // firma etichetta obbligatoria
  if(window.LF_sendForSignature){
    const sendBtn=$('#con-send'); if(sendBtn) sendBtn.disabled=true;
    toast(tt('con.sending'));
    const r=await window.LF_sendForSignature(c);
    if(sendBtn) sendBtn.disabled=false;
    if(r && r.link){
      c.token=r.token; if(c.status==='draft'||!c.status) c.status='sent'; c.sentAt=Date.now();
      saveCurrentContract(); renderContracts();
      // invio email automatico se EmailJS è configurato e c'è l'indirizzo
      if(ejReady() && c.email){
        toast(tt('con.emailing'));
        const er=await sendContractEmail(c, r.link);
        if(er && er.ok) toast(tt('con.email_sent').replace('{email}',c.email));
        else toast(tt('con.email_fail')+((er&&er.error)?` (${er.error})`:''));
      }
      openShareModal(r.link, c);
      return;
    }
    // se manca il backend firma (tabella non creata), fallback su email
    toast((r&&r.error)?(`${tt('con.send_fail')} (${r.error})`):tt('con.send_fail'));
  }
  // fallback: apre l'email con il testo del contratto
  if(c.status==='draft'||!c.status){ c.status='sent'; c.sentAt=Date.now(); saveCurrentContract(); renderContracts(); }
  const subject=encodeURIComponent(`Release Authorization — ${c.titles} · ${c.label}`);
  const body=encodeURIComponent(tt('con.mail_intro').replace('{label}',c.label)+'\n\n'+contractPlainText(c)+'\n\n'+tt('con.mail_foot'));
  if(c.email) window.location.href=`mailto:${encodeURIComponent(c.email)}?subject=${subject}&body=${body}`;
}
/* ---------- Invio email automatico (EmailJS, lato browser) ---------- */
const EJ_LS='labelfinance.emailjs';
function ejCfg(){ try{ return JSON.parse(localStorage.getItem(EJ_LS))||null; }catch(e){ return null; } }
function ejReady(){ const c=ejCfg(); return !!(c&&c.service&&c.template&&c.key); }
async function sendContractEmail(c, link){
  const cfg=ejCfg(); if(!ejReady()) return {error:'not_configured'};
  if(!c.email) return {error:'no_email'};
  const params={ to_email:c.email, email:c.email, to_name:(c.fullName||c.projectName||''),
    label:c.label, titles:c.titles||'', sign_link:link, message:tt('con.mail_intro').replace('{label}',c.label), reply_to:'' };
  try{
    const r=await fetch('https://api.emailjs.com/api/v1.0/email/send',{ method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ service_id:cfg.service, template_id:cfg.template, user_id:cfg.key, template_params:params }) });
    if(!r.ok){ let d=''; try{ d=await r.text(); }catch{} return {error:`ej_http_${r.status}`, detail:d.slice(0,200)}; }
    return {ok:true};
  }catch(e){ return {error:e.message||'ej_error'}; }
}
const EJ_TEMPLATE=`<!-- Template email per EmailJS — incollalo nel campo "Content" (modalità HTML).
     Imposta "To email" = {{to_email}}.  Variabili usate: label, titles, sign_link, to_name, message -->
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:14px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:26px 28px;color:#fff">
    <div style="font-size:20px;font-weight:800;letter-spacing:-.4px">{{label}}</div>
    <div style="opacity:.9;font-size:13px;margin-top:2px">Authorization to Release</div>
  </div>
  <div style="padding:26px 28px;color:#222;font-size:15px;line-height:1.6">
    <p>Ciao {{to_name}},</p>
    <p>{{message}}</p>
    <p style="margin:18px 0">Opera/Release: <b>{{titles}}</b></p>
    <p style="text-align:center;margin:26px 0">
      <a href="{{sign_link}}" style="background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px;display:inline-block">Leggi e firma il contratto</a>
    </p>
    <p style="font-size:13px;color:#666">Potrai leggere il contratto, firmarlo se sei d'accordo, oppure rifiutarlo indicando il motivo per un diverso accordo.</p>
    <p style="font-size:13px;color:#666">Se il pulsante non funziona, copia questo link:<br>{{sign_link}}</p>
  </div>
  <div style="padding:14px 28px;background:#faf8ff;color:#999;font-size:12px;text-align:center">Inviato con Label Finance</div>
</div>`;
function openShareModal(link, c){
  const m=$('#share-modal'); if(!m){ prompt(tt('con.share_link'), link); return; }
  $('#share-link').value=link;
  const msg=tt('con.share_msg').replace('{label}',c.label).replace('{titles}',c.titles||'');
  const wa=`https://wa.me/?text=${encodeURIComponent(msg+'\n'+link)}`;
  const subj=encodeURIComponent(`Firma il contratto — ${c.label}`);
  const mail=`mailto:${encodeURIComponent(c.email||'')}?subject=${subj}&body=${encodeURIComponent(msg+'\n\n'+link)}`;
  $('#share-wa').href=wa; $('#share-mail').href=mail;
  m.hidden=false;
}
async function refreshContractStatuses(){
  if(!window.LF_refreshContractStatuses) return;
  const rows=await window.LF_refreshContractStatuses(); if(!rows) return;
  let changed=false;
  rows.forEach(r=>{ const c=(DB.contracts||[]).find(x=>x.token===r.token); if(!c) return;
    if(r.status && r.status!==c.status){ c.status=r.status; changed=true; }
    if(r.signature && !c.artistSign){ c.artistSign=r.signature; changed=true; }   // firma artista
    if(r.reject_reason && c.rejectReason!==r.reject_reason){ c.rejectReason=r.reject_reason; changed=true; }
  });
  if(changed){ save(); renderContracts();
    // se sto guardando proprio quel contratto, aggiorna l'anteprima senza refresh
    if(currentContract && $('#con-preview') && !$('#con-preview').hidden){
      const fresh=(DB.contracts||[]).find(x=>x.id===currentContract.id);
      if(fresh){ currentContract=fresh; $('#contract-doc').innerHTML=buildContractDoc(fresh); }
    }
  }
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
  const safe=s=>String(s||'').replace(/[\\/:*?"<>|]+/g,'').trim();
  const fname=`${safe(currentContract.label||labelName())||'Label'} – Release Authorization`;
  toast(tt('con.pdf_wait'));
  el.classList.add('pdf-exporting');                 // toglie bordo/ombra/angoli durante la cattura
  const cleanup=()=>el.classList.remove('pdf-exporting');
  const opt={ margin:[6,6,6,6], filename:fname+'.pdf',
    image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2, useCORS:true, backgroundColor:'#ffffff', windowWidth:820},
    jsPDF:{unit:'mm', format:'a4', orientation:'portrait'},
    pagebreak:{ mode:['css','legacy'], before:'.cd-page--copy' } };
  html2pdf().set(opt).from(el).save().then(cleanup, ()=>{ cleanup(); printContract(); });
}
function openContract(id){ const c=DB.contracts.find(x=>x.id===id); if(!c) return;
  currentContract=c; $('#contract-doc').innerHTML=buildContractDoc(c);
  $('#con-form').hidden=true; $('#con-preview').hidden=false; goto('contracts');
  updateConSendBtn();
  $('#con-preview').scrollIntoView({behavior:'smooth',block:'start'}); }
function deleteContract(id){ const c=DB.contracts.find(x=>x.id===id); if(!c) return;
  if(!confirm(tt('con.del_confirm'))) return;
  DB.contracts=DB.contracts.filter(x=>x.id!==id); save(); renderContracts(); }
function conStatusPill(s){
  if(s==='signed') return `<span class="pill pill-ok">${tt('con.st_signed')}</span>`;
  if(s==='rejected') return `<span class="pill pill-bad">${tt('con.st_rejected')}</span>`;
  if(s==='sent') return `<span class="pill pill-sent">${tt('con.st_sent')}</span>`;
  return `<span class="pill">${tt('con.st_draft')}</span>`;
}
/* tag di stato: verdi se la situazione è risolta, rossi se ancora incompleta */
function conTags(c){
  // firmato da entrambi = risolto
  if(c.status==='signed' || (c.labelSign && c.artistSign)) return [{l:tt('con.tg_signed'),k:'ok'}];
  const t=[];
  if(c.status==='rejected'){ t.push({l:tt('con.tg_rejected'),k:'bad'}); }
  else if(!c.labelSign){ t.push({l:tt('con.tg_need_label'),k:'bad'}); }
  else if(c.status==='sent'){ t.push({l:tt('con.tg_waiting'),k:'bad'}); }
  else { t.push({l:tt('con.tg_ready'),k:'bad'}); }
  if(!c.email) t.push({l:tt('con.tg_noemail'),k:'bad'});
  return t;
}
function renderContracts(){
  const tb=$('#contracts-table'); if(!tb) return;
  const cq=($('#con-search')&&$('#con-search').value||'').toLowerCase().trim();
  let all=(DB.contracts||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  if(cq) all=all.filter(c=>((c.titles||'')+' '+(c.fullName||'')+' '+(c.projectName||'')+' '+(c.artistNames||'')+' '+(c.label||'')).toLowerCase().includes(cq));
  $('#contracts-empty').hidden=(DB.contracts||[]).length>0;
  if(!all.length){ tb.innerHTML=''; mountPager(tb,'contracts',{total:0}); return; }
  const info=paginate(all,'contracts'); const list=info.slice;
  const head=`<thead><tr><th>${tt('con.titles')}</th><th>${tt('con.fullname')}</th><th>${tt('con.split_short')}</th><th>${tt('con.date')}</th><th>${tt('con.status')}</th><th></th></tr></thead>`;
  const rows=list.map(c=>{
    const who=esc(c.projectName||c.fullName||c.artistNames||'—');
    const reason = c.status==='rejected'&&c.rejectReason ? `<div class="con-reason">“${esc(c.rejectReason)}”</div>` : '';
    const tags = `<div class="con-tags">${conTags(c).map(x=>`<span class="ctag ctag-${x.k}">${esc(x.l)}</span>`).join('')}</div>`;
    return `<tr><td><b>${esc(c.titles||'—')}</b></td><td class="muted small">${who}</td><td>${c.artistPct}/${100-c.artistPct}</td><td>${esc(c.date)}</td><td>${tags}${reason}</td>
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
  $('#sign-place').value=''; $('#sign-name').value=(DB.profile&&DB.profile.name)||currentContract.label||labelName();
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
  // firma dell'ETICHETTA (obbligatoria prima dell'invio all'artista)
  currentContract.labelSign={ dataUrl:sigPad.cv.toDataURL('image/png'),
    name:$('#sign-name').value.trim()||currentContract.label||labelName(),
    place:$('#sign-place').value.trim(),
    date:isoD(now), time:now.toTimeString().slice(0,5) };
  if(currentContract.status==='draft'||!currentContract.status) currentContract.status='ready';
  saveCurrentContract(); renderContracts();
  $('#contract-doc').innerHTML=buildContractDoc(currentContract);
  updateConSendBtn();
  closeSignPad(); toast(tt('con.signed_label_ok'));
}
function updateConSendBtn(){
  const b=$('#con-send'); if(!b) return;
  const ok=!!(currentContract && currentContract.labelSign);
  b.disabled=!ok; b.classList.toggle('is-disabled',!ok);
  b.title = ok ? '' : tt('con.need_label_sign');
}

/* ---------- Task ---------- */
function tskKey(t){ return (t.due||'9999-99-99')+'T'+(t.time||'99:99'); }
function renderTasks(){
  const cont=$('#tasks-list'); if(!cont) return;
  const tq=($('#tsk-search')&&$('#tsk-search').value||'').toLowerCase().trim();
  const list=tq?(DB.tasks||[]).filter(t=>(t.title||'').toLowerCase().includes(tq)):(DB.tasks||[]);
  $('#tasks-empty').hidden=(DB.tasks||[]).length>0;
  const today=isoD(new Date());
  const open=list.filter(t=>!t.done).sort((a,b)=>tskKey(a).localeCompare(tskKey(b)));
  const done=list.filter(t=>t.done).sort((a,b)=>tskKey(b).localeCompare(tskKey(a)));
  const icon={payment:'💸',contract:'📄',other:'•'};
  const row=t=>{
    const overdue=t.due && !t.done && tskKey(t) < (today+'T'+new Date().toTimeString().slice(0,5));
    const soon=t.due && !t.done && t.due===today;
    const when = t.due?`<span class="tsk-due ${overdue?'over':''} ${soon?'today':''}">${overdue?'⚠ ':''}${esc(t.due)}${t.time?(' · '+esc(t.time)):''}</span>`:'';
    const bell = (t.remind&&t.due&&!t.done)?`<span class="tsk-bell" title="${tt('tsk.remind')}">🔔</span>`:'';
    return `<div class="tsk-row ${t.done?'is-done':''}" data-id="${t.id}">
      <button class="tsk-check" data-tsk-toggle="${t.id}" aria-label="done">${t.done?'✓':''}</button>
      <span class="tsk-ico">${icon[t.type]||'•'}</span>
      <span class="tsk-title">${esc(t.title)}</span>
      ${bell}${when}
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
  DB.tasks.push({ id:newId(), title, type:$('#tsk-type').value, due:$('#tsk-due').value||'',
    time:$('#tsk-time').value||'', remind:+($('#tsk-remind')&&$('#tsk-remind').value)||0, done:false, createdAt:Date.now() });
  save(); $('#tsk-title').value=''; $('#tsk-due').value=''; $('#tsk-time').value='';
  renderTasks(); toast(tt('tsk.added'));
  ensureNotifyPermission();
}
function toggleTask(id){ const t=(DB.tasks||[]).find(x=>x.id===id); if(!t) return; t.done=!t.done; save(); renderTasks(); }
function deleteTask(id){ DB.tasks=(DB.tasks||[]).filter(x=>x.id!==id); save(); renderTasks(); }

/* ---------- Avvisi task: suoneria + notifica ---------- */
let lfAudioCtx=null;
function lfAudio(){ try{ lfAudioCtx=lfAudioCtx||new (window.AudioContext||window.webkitAudioContext)(); if(lfAudioCtx.state==='suspended') lfAudioCtx.resume(); }catch(e){} return lfAudioCtx; }
function playChime(){
  const ctx=lfAudio(); if(!ctx) return;
  try{
    const t0=ctx.currentTime, notes=[523.25,659.25,783.99,1046.5]; // Do-Mi-Sol-Do, arpeggio dolce
    notes.forEach((f,i)=>{ const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=f; const s=t0+i*0.13;
      g.gain.setValueAtTime(0,s); g.gain.linearRampToValueAtTime(0.16,s+0.02); g.gain.exponentialRampToValueAtTime(0.0001,s+0.55);
      o.connect(g).connect(ctx.destination); o.start(s); o.stop(s+0.6); });
  }catch(e){}
}
function ensureNotifyPermission(){ try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission().then(updateNotifHint); }catch(e){} updateNotifHint(); }
function updateNotifHint(){ const h=$('#tsk-notif-hint'); if(!h) return;
  h.hidden = !('Notification' in window) || Notification.permission!=='default'; }
function taskDateTime(t){ if(!t.due) return null; const d=new Date(t.due+'T'+((t.time||'09:00'))+':00'); return isNaN(d.getTime())?null:d.getTime(); }
function fireTaskAlert(t, kind){
  const icon={payment:'💸',contract:'📄',other:'•'}[t.type]||'•';
  const title = kind==='pre' ? tt('tsk.notif_pre') : tt('tsk.notif_due');
  const body = `${icon} ${t.title}`+(t.due?` — ${t.due}${t.time?(' '+t.time):''}`:'');
  playChime();
  let shown=false;
  if('Notification' in window && Notification.permission==='granted'){
    try{ const n=new Notification('Label Finance · '+title, { body, icon:'icon.png?v=3', tag:'lf-task-'+t.id, renotify:true });
      n.onclick=()=>{ try{ window.focus(); }catch(e){} goto('tasks'); n.close(); }; shown=true; }catch(e){}
  }
  showTaskPopup(title, body); // mostra sempre anche il popup in-app
}
function showTaskPopup(title, body){
  let wrap=$('#lf-alerts'); if(!wrap){ wrap=document.createElement('div'); wrap.id='lf-alerts'; wrap.className='lf-alerts'; document.body.appendChild(wrap); }
  const el=document.createElement('div'); el.className='lf-alert';
  el.innerHTML=`<div class="lf-alert-ic">🔔</div><div class="lf-alert-tx"><b>${esc(title)}</b><span>${esc(body)}</span></div>
    <button class="lf-alert-x" aria-label="Chiudi">✕</button>`;
  el.querySelector('.lf-alert-x').onclick=()=>el.remove();
  el.querySelector('.lf-alert-tx').onclick=()=>{ goto('tasks'); el.remove(); };
  wrap.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),400); }, 12000);
}
function checkTaskAlerts(){
  const now=Date.now(); let changed=false; const WINDOW=12*3600000;
  (DB.tasks||[]).forEach(t=>{ if(t.done) return; const due=taskDateTime(t); if(!due) return;
    const pre = due - (t.remind||0)*60000;
    if((t.remind||0)>0 && !t.notifiedPre && now>=pre){ if(now-pre<WINDOW && now<due) fireTaskAlert(t,'pre'); t.notifiedPre=true; changed=true; }
    if(!t.notifiedDue && now>=due){ if(now-due<WINDOW) fireTaskAlert(t,'due'); t.notifiedDue=true; changed=true; }
  });
  if(changed) save();
}

/* ---------- Merch ---------- */
const MERCH_TYPES={tshirt:'mch.t_tshirt',vinyl:'mch.t_vinyl',cd:'mch.t_cd',hoodie:'mch.t_hoodie',poster:'mch.t_poster',other:'mch.t_other'};
const MERCH_ICON={tshirt:'👕',vinyl:'🎵',cd:'💿',hoodie:'🧥',poster:'🖼️',other:'📦'};
let editingMerchId=null;
function merchById(id){ return (DB.merch||[]).find(m=>m.id===id); }
function merchRevenue(m){ return (+m.price||0)*(+m.sold||0); }
function merchMargin(m){ return ((+m.price||0)-(+m.cost||0))*(+m.sold||0); }
let merchSort={col:'sold',dir:-1};   // di default: più venduti
function sortMerch(arr){
  const k=merchSort.col, d=merchSort.dir;
  return arr.slice().sort((a,b)=>{
    if(k==='name') return String(a.name||'').toLowerCase().localeCompare(String(b.name||'').toLowerCase())*d;
    let va,vb;
    if(k==='price'){ va=+a.price||0; vb=+b.price||0; }
    else if(k==='revenue'){ va=merchRevenue(a); vb=merchRevenue(b); }
    else if(k==='stock'){ va=a.stock==null?-1:+a.stock; vb=b.stock==null?-1:+b.stock; }
    else { va=+a.sold||0; vb=+b.sold||0; }
    return (va-vb)*d;
  });
}
function renderMerch(){
  const grid=$('#merch-grid'); if(!grid) return;
  const q=($('#mch-search')&&$('#mch-search').value||'').toLowerCase().trim();
  const allItems=(DB.merch||[]);
  // statistiche
  const totRev=allItems.reduce((s,m)=>s+merchRevenue(m),0);
  const totUnits=allItems.reduce((s,m)=>s+(+m.sold||0),0);
  const totMargin=allItems.reduce((s,m)=>s+merchMargin(m),0);
  const top=allItems.slice().sort((a,b)=>(+b.sold||0)-(+a.sold||0))[0];
  const st=$('#mch-stats');
  if(st) st.innerHTML = allItems.length ? `
    <div class="mch-stat"><span class="mch-stat-l">${tt('mch.revenue')}</span><span class="mch-stat-v pos">${fmtMoney(totRev)}</span></div>
    <div class="mch-stat"><span class="mch-stat-l">${tt('mch.margin')}</span><span class="mch-stat-v ${totMargin>=0?'pos':'neg'}">${fmtMoney(totMargin)}</span></div>
    <div class="mch-stat"><span class="mch-stat-l">${tt('mch.units')}</span><span class="mch-stat-v">${totUnits}</span></div>
    <div class="mch-stat"><span class="mch-stat-l">${tt('mch.top')}</span><span class="mch-stat-v">${top&&top.sold?esc(top.name):'—'}</span></div>` : '';
  const list=allItems.filter(m=> !q || (m.name||'').toLowerCase().includes(q));
  $('#merch-empty').hidden = allItems.length>0;
  const sorted=colSort('merch', list, merchSort);
  const info=paginate(sorted,'merch'); const page=info.slice;
  const mode=getVM('merch','cards');
  const lowStock=m=>(m.stock!=null && +m.stock<=3);
  if(mode==='list'){
    grid.className='dbl';
    const cols=colsFor('merch');
    const acts=m=>`<button class="btn btn-sm btn-income" data-mch-sell="${m.id}">+ ${tt('mch.sell')}</button><button class="icon-btn-sm" data-mch-edit="${m.id}">✎</button><button class="icon-btn-sm" data-mch-del="${m.id}">🗑</button>`;
    const sel=selOpt('merch');
    grid.innerHTML = dbHead(cols,merchSort,{actions:1,actW:170,sel}) + dbRows(page,cols,{actions:acts,actW:170,sel});
  } else {
    grid.className='mch-grid';
    grid.innerHTML=page.map(m=>`
      <div class="mch-card" data-id="${m.id}">
        <div class="mch-card-head"><span class="mch-ico-lg">${MERCH_ICON[m.type]||'📦'}</span>
          <div><div class="mch-cname">${esc(m.name)}</div><div class="mch-meta">${tt(MERCH_TYPES[m.type]||'mch.t_other')} · ${fmtMoney(m.price)}</div></div>
        </div>
        <div class="mch-kpis">
          <div><span>${tt('mch.sold_u')}</span><b>${m.sold||0}</b></div>
          <div><span>${tt('mch.revenue')}</span><b class="pos">${fmtMoney(merchRevenue(m))}</b></div>
          <div><span>${tt('mch.stock')}</span><b class="${lowStock(m)?'mch-low':''}">${m.stock!=null?m.stock:'—'}</b></div>
        </div>
        <div class="mch-card-act">
          <button class="btn btn-sm btn-income" data-mch-sell="${m.id}">+ ${tt('mch.sell')}</button>
          <button class="icon-btn-sm" data-mch-edit="${m.id}">✎</button>
          <button class="icon-btn-sm" data-mch-del="${m.id}">🗑</button>
        </div>
      </div>`).join('');
  }
  mountPager(grid,'merch',info);
  syncVMButtons();
}
function openMerchForm(id){
  editingMerchId=id||null; const m=id?merchById(id):null;
  $('#mch-form-title').textContent = m?tt('mch.edit'):tt('mch.new');
  $('#mch-name').value=m?m.name||'':''; $('#mch-type').value=m?m.type||'other':'tshirt';
  $('#mch-price').value=m?(m.price??''):''; $('#mch-cost').value=m?(m.cost??''):'';
  $('#mch-stock').value=m?(m.stock??''):''; $('#mch-sold').value=m?(m.sold||0):0;
  $('#mch-form').hidden=false; $('#mch-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function saveMerch(){
  const name=$('#mch-name').value.trim(); if(!name){ toast(tt('mch.need_name')); return; }
  const price=+$('#mch-price').value; if(!price&&price!==0){ toast(tt('mch.need_price')); return; }
  const data={ name, type:$('#mch-type').value, price:price||0, cost:+$('#mch-cost').value||0,
    stock:$('#mch-stock').value===''?null:(+$('#mch-stock').value||0), sold:+$('#mch-sold').value||0 };
  if(editingMerchId){ const m=merchById(editingMerchId); if(m) Object.assign(m,data); }
  else DB.merch.push(Object.assign({id:newId()},data));
  save(); $('#mch-form').hidden=true; editingMerchId=null; renderMerch(); toast(tt('mch.saved'));
}
function sellMerch(id){
  const m=merchById(id); if(!m) return;
  const qtyStr=prompt(tt('mch.sell_qty'),'1'); if(qtyStr===null) return;
  const qty=Math.max(1,Math.floor(+qtyStr||0)); if(!qty) return;
  m.sold=(+m.sold||0)+qty;
  if(m.stock!=null) m.stock=Math.max(0,(+m.stock||0)-qty);
  save(); renderMerch(); toast(tt('mch.sold_ok').replace('{n}',qty));
}
function deleteMerch(id){ const m=merchById(id); if(!m) return;
  if(!confirm(tt('mch.del_confirm').replace('{name}',m.name))) return;
  DB.merch=DB.merch.filter(x=>x.id!==id); save(); renderMerch(); }

/* ============================================================================
   PIANIFICAZIONE · EVENTI · SUPPORT DJ  (liste ordinabili + calendario)
   ============================================================================ */
function calLang(){ return (window.LFI18N&&window.LFI18N.lang==='en')?'en-US':'it-IT'; }
function ymdStr(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function sortBy(arr, st, numKeys){
  const k=st.col, d=st.dir, isNum=(numKeys||[]).includes(k);
  return arr.slice().sort((a,b)=>{
    if(isNum) return ((+a[k]||0)-(+b[k]||0))*d;
    return String(a[k]||'').toLowerCase().localeCompare(String(b[k]||'').toLowerCase())*d;
  });
}
function dblTmpl(cols, leadW, actW, selW){ return (selW?selW+'px ':'')+(leadW?leadW+'px ':'')+cols.map(c=>c.w?c.w+'px':`minmax(0,${c.grow||1}fr)`).join(' ')+(actW?` ${actW}px`:''); }
function colLab(c){ return typeof c.label==='function'?c.label():c.label; }
function dbHead(cols, st, opt){ opt=opt||{}; const sw=opt.sel?34:0; const t=dblTmpl(cols,opt.leadW,opt.actions?(opt.actW||66):0,sw); const arrow=c=>st.col===c?(st.dir>0?' ▲':' ▼'):'';
  return `<div class="dbl-row dbl-head" style="grid-template-columns:${t}">`
    +(opt.sel?`<span class="dbl-sel"><input type="checkbox" data-selall="${opt.sel.sec}"></span>`:'')
    +(opt.leadW?'<span></span>':'')
    +cols.map(c=>`<span class="dbl-sort" data-sort="${c.key}">${esc(colLab(c))}${arrow(c.key)}</span>`).join('')
    +(opt.actions?'<span></span>':'')+`</div>`; }
function dbRows(items, cols, opt){ opt=opt||{}; const sw=opt.sel?34:0; const t=dblTmpl(cols,opt.leadW,opt.actions?(opt.actW||66):0,sw);
  return items.map(it=>`<div class="dbl-row ${opt.rowCls||''}" data-id="${it.id}" style="grid-template-columns:${t}">`
    +(opt.sel?`<span class="dbl-sel"><input type="checkbox" data-sel="${opt.sel.sec}|${it.id}" ${opt.sel.set&&opt.sel.set.has(it.id)?'checked':''}></span>`:'')
    +(opt.lead?`<span class="dbl-lead">${opt.lead(it)}</span>`:'')
    +cols.map(c=>`<span class="${c.cls||''}">${c.cell(it)||'—'}</span>`).join('')
    +(opt.actions?`<span class="dbl-act">${opt.actions(it)}</span>`:'')+`</div>`).join('');
}
/* registro colonne per sezione + configurazione (mostra/nascondi/ordina) */
function relSplitText(r){ const tot=(r.splits||[]).reduce((s,x)=>s+(+x.pct||0),0); const lbl=Math.max(0,100-tot);
  return (r.splits||[]).map(s=>esc(s.name)+' '+(+s.pct||0)+'%').join(' · ')+(lbl?` · Label ${lbl}%`:''); }
function colCfg(sec){ DB.colCfg=DB.colCfg||{}; const all=(COLDEFS[sec]||[]).map(c=>c.key);
  let cfg=DB.colCfg[sec]; if(!cfg||!Array.isArray(cfg.order)) cfg=DB.colCfg[sec]={order:all.slice(),hidden:[]};
  all.forEach(k=>{ if(!cfg.order.includes(k)) cfg.order.push(k); });
  cfg.order=cfg.order.filter(k=>all.includes(k)); cfg.hidden=(cfg.hidden||[]).filter(k=>all.includes(k));
  return cfg; }
function colsFor(sec){ const cfg=colCfg(sec), defs=COLDEFS[sec]||[];
  return cfg.order.map(k=>defs.find(c=>c.key===k)).filter(c=>c && !cfg.hidden.includes(c.key)); }
function colSort(sec, arr, st){ if(!st||!st.col) return arr.slice(); const def=(COLDEFS[sec]||[]).find(c=>c.key===st.col), d=st.dir;
  const val=it=> def&&def.sortVal?def.sortVal(it):(def&&def.num?(+it[st.col]||0):String(it[st.col]||'').toLowerCase());
  return arr.slice().sort((a,b)=>{ const va=val(a),vb=val(b); if(typeof va==='number'&&typeof vb==='number') return (va-vb)*d; return String(va).localeCompare(String(vb))*d; }); }
const rowActs=(pfx,id)=>`<button class="icon-btn-sm" data-${pfx}-edit="${id}" title="${tt('common.edit')}">✎</button><button class="icon-btn-sm" data-${pfx}-del="${id}" title="${tt('common.delete')}">🗑</button>`;
const ctag=(label,k)=>`<span class="ctag ctag-${k}">${esc(label)}</span>`;
const fmtDate=ds=>{ if(!ds) return ''; try{ return new Date(ds+'T00:00:00').toLocaleDateString(calLang(),{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return ds; } };

const COLDEFS = {
  releases:[
    {key:'catalog',label:()=>tt('col.catalog'),w:116,cell:r=>esc(r.catalog),cls:'release-cat'},
    {key:'title',label:()=>tt('rel.c_title'),grow:1.5,cell:r=>esc(r.title)||'—',cls:'dbl-strong'},
    {key:'artist',label:()=>tt('r.artist'),grow:1.2,cell:r=>artNameLink(r.artist),cls:'muted small'},
    {key:'order',label:()=>tt('r.order').replace(' *',''),w:122,cell:r=>fmtDate(r.orderDate),sortVal:r=>r.orderDate||''},
    {key:'upc',label:()=>tt('r.upc'),w:130,cell:r=>esc(r.upc),cls:'muted small'},
    {key:'preorder',label:()=>tt('r.preorder'),w:122,cell:r=>fmtDate(r.preorder),sortVal:r=>r.preorder||''},
    {key:'year',label:()=>tt('rel.c_year'),w:64,cell:r=>r.year||'',cls:'muted small',num:true},
    {key:'split',label:()=>tt('rel.c_split'),grow:1.7,cell:r=>relSplitText(r),cls:'muted small',sortVal:r=>(r.splits&&r.splits[0]&&r.splits[0].name||'').toLowerCase()},
    {key:'exclusive',label:()=>tt('r.exclusive'),w:120,cell:r=>r.exclusive?ctag(esc(r.exclusivePlatform||tt('common.yes')),'info'):'',sortVal:r=>r.exclusive?0:1},
    {key:'isrc',label:()=>'ISRC',w:78,cell:r=>(r.tracks&&r.tracks.length)?`<span class="release-ltag">${r.tracks.length}</span>`:'',sortVal:r=>(r.tracks||[]).length},
    {key:'note',label:()=>tt('r.note'),grow:1.4,cell:r=>esc(r.note),cls:'muted small'},
  ],
  planning:[
    {key:'date',label:()=>tt('pln.f_date'),w:122,cell:p=>fmtDate(p.date)},
    {key:'kind',label:()=>tt('pln.f_kind'),w:98,cell:p=>tt(PLN_KIND[p.kind]||'pln.k_release')},
    {key:'title',label:()=>tt('pln.f_title').replace(' *',''),grow:1.6,cell:p=>`<b>${esc(p.title)}</b>`,cls:'dbl-strong'},
    {key:'artist',label:()=>tt('pln.f_artist'),grow:1,cell:p=>artNameLink(p.artist),cls:'muted small'},
    {key:'status',label:()=>tt('pln.f_status'),w:122,cell:p=>ctag(tt(PLN_STATUS[p.status]||'pln.s_idea'),PLN_STK[p.status]||'mut')},
    {key:'platform',label:()=>tt('pln.f_platform'),grow:1,cell:p=>esc(p.platform),cls:'muted small'},
    {key:'note',label:()=>tt('pln.f_note'),grow:1.2,cell:p=>esc(p.note),cls:'muted small'},
  ],
  events:[
    {key:'date',label:()=>tt('evt.f_date'),w:150,cell:e=>fmtDate(e.date)+(e.time?(' · '+esc(e.time)):'')},
    {key:'kind',label:()=>tt('evt.f_kind'),w:98,cell:e=>tt(EVT_KIND[e.kind]||'evt.k_other')},
    {key:'title',label:()=>tt('evt.f_title').replace(' *',''),grow:1.5,cell:e=>`<b>${esc(e.title)}</b>`,cls:'dbl-strong'},
    {key:'venue',label:()=>tt('evt.f_venue'),grow:1.2,cell:e=>esc(e.venue),cls:'muted small'},
    {key:'city',label:()=>tt('evt.f_city'),grow:1,cell:e=>esc(e.city)},
    {key:'country',label:()=>tt('evt.f_country'),grow:.85,cell:e=>esc(e.country),cls:'muted small'},
    {key:'note',label:()=>tt('evt.f_note'),grow:1.2,cell:e=>esc(e.note),cls:'muted small'},
  ],
  supports:[
    {key:'date',label:()=>tt('sup.f_date'),w:122,cell:s=>fmtDate(s.date)},
    {key:'dj',label:()=>tt('sup.f_dj').replace(' *',''),grow:1.2,cell:s=>`<b>${esc(s.dj)}</b>`,cls:'dbl-strong'},
    {key:'track',label:()=>tt('sup.f_track'),grow:1.2,cell:s=>esc(s.track),cls:'muted small'},
    {key:'venue',label:()=>tt('sup.f_venue'),grow:1.2,cell:s=>esc(s.venue)},
    {key:'city',label:()=>tt('sup.f_city'),grow:1,cell:s=>esc(s.city)},
    {key:'country',label:()=>tt('sup.f_country'),grow:.85,cell:s=>esc(s.country),cls:'muted small'},
    {key:'note',label:()=>tt('sup.f_note'),grow:1.2,cell:s=>esc(s.note),cls:'muted small'},
  ],
  artists:[
    {key:'name',label:()=>tt('art.h_name'),grow:1.6,cell:a=>`<b>${esc(a.name)}</b>`,cls:'dbl-strong'},
    {key:'legal',label:()=>tt('art.h_legal'),grow:1.3,cell:a=>esc(a.legal),cls:'muted small'},
    {key:'email',label:()=>tt('art.h_email'),grow:1.6,cell:a=>esc(a.email),cls:'muted small'},
    {key:'phone',label:()=>tt('art.h_phone'),grow:1,cell:a=>esc(a.phone),cls:'muted small'},
    {key:'split',label:()=>tt('art.h_split'),w:80,cell:a=>a.split?`<span class="art-split">${esc(a.split)}%</span>`:'',num:true},
    {key:'iban',label:()=>'IBAN',grow:1.3,cell:a=>esc(a.iban),cls:'muted small'},
  ],
  merch:[
    {key:'name',label:()=>tt('mch.name_h'),grow:1.4,cell:m=>`${MERCH_ICON[m.type]||'📦'} <b>${esc(m.name)}</b>`,cls:'dbl-strong'},
    {key:'type',label:()=>tt('mch.type'),w:104,cell:m=>tt(MERCH_TYPES[m.type]||'mch.t_other'),cls:'muted small'},
    {key:'price',label:()=>tt('mch.price_h'),w:92,cell:m=>fmtMoney(m.price),num:true},
    {key:'sold',label:()=>tt('mch.sold_h'),w:96,cell:m=>String(m.sold||0),num:true},
    {key:'revenue',label:()=>tt('mch.revenue'),w:110,cell:m=>`<span class="pos">${fmtMoney(merchRevenue(m))}</span>`,sortVal:m=>merchRevenue(m)},
    {key:'stock',label:()=>tt('mch.stock'),w:96,cell:m=>m.stock!=null?String(m.stock):'—',sortVal:m=>m.stock==null?-1:+m.stock},
  ],
};

/* ---- Gestione colonne (mostra/nascondi/ordina) ---- */
let colCfgSec=null;
function rerenderSec(sec){ ({releases:renderReleases,planning:renderPlanning,events:renderEvents,supports:renderSupports,artists:renderArtists,merch:renderMerch}[sec]||function(){})(); }

/* ---- Selezione multipla + svuota lista (tutte le sezioni) ---- */
const bulkSel = {};
function selOpt(sec){ return { sec, set:(bulkSel[sec] ||= new Set()) }; }
function secArr(sec){ return {transactions:'transactions',artists:'artists',releases:'releases',planning:'planning',events:'events',supports:'supports',merch:'merch',contracts:'contracts',tasks:'tasks'}[sec]; }
function bulkRerender(sec){
  const f={ transactions:()=>{ if(typeof applyTxFilters==='function') applyTxFilters(); else renderTx(); renderRoyalties&&renderRoyalties(); },
    releases:()=>{ renderReleases(); renderRoyalties&&renderRoyalties(); }, artists:renderArtists, planning:renderPlanning,
    events:renderEvents, supports:renderSupports, merch:renderMerch, contracts:renderContracts, tasks:renderTasks }[sec];
  if(f) f();
}
function bulkBar(sec){ const bar=$('#bulk-bar'); if(!bar) return; const n=(bulkSel[sec]||new Set()).size;
  if(!n){ bar.hidden=true; bar.dataset.sec=''; return; }
  bar.dataset.sec=sec; const c=$('#bulk-count'); if(c) c.textContent=n; bar.hidden=false; }
function bulkToggleAll(sec,on){ document.querySelectorAll(`[data-sel^="${sec}|"]`).forEach(cb=>{ cb.checked=on;
    const id=cb.dataset.sel.split('|').slice(1).join('|'); (bulkSel[sec]||=new Set()); on?bulkSel[sec].add(id):bulkSel[sec].delete(id); });
  bulkBar(sec); }
function bulkDeleteSel(){ const bar=$('#bulk-bar'); const sec=bar&&bar.dataset.sec; const set=bulkSel[sec]; if(!set||!set.size) return;
  if(!confirm(tt('bulk.del_q').replace('{n}',set.size))) return;
  const arr=secArr(sec); if(arr) DB[arr]=(DB[arr]||[]).filter(x=>!set.has(x.id));
  set.clear(); save(); bulkRerender(sec); bulkBar(sec); }
function bulkClearAll(sec){ const arr=secArr(sec); const len=(DB[arr]||[]).length;
  if(!len){ toast(tt('bulk.empty_already')); return; }
  if(!confirm(tt('bulk.clear_q').replace('{n}',len))) return;
  DB[arr]=[]; bulkSel[sec]&&bulkSel[sec].clear(); save(); bulkRerender(sec); bulkBar(sec); }
document.addEventListener('change', e=>{
  const one=e.target.closest('[data-sel]'); if(one){ const p=one.dataset.sel.split('|'); const sec=p[0], id=p.slice(1).join('|');
    (bulkSel[sec]||=new Set()); one.checked?bulkSel[sec].add(id):bulkSel[sec].delete(id); bulkBar(sec); return; }
  const all=e.target.closest('[data-selall]'); if(all){ bulkToggleAll(all.dataset.selall, all.checked); }
});
document.addEventListener('click', e=>{ const c=e.target.closest('[data-clear]'); if(c) bulkClearAll(c.dataset.clear); });
if($('#bulk-del')) $('#bulk-del').onclick=bulkDeleteSel;
if($('#bulk-cancel')) $('#bulk-cancel').onclick=()=>{ const bar=$('#bulk-bar'); const sec=bar&&bar.dataset.sec; if(sec){ bulkSel[sec]&&bulkSel[sec].clear(); bulkRerender(sec); bulkBar(sec); } };
function openColCfg(sec){ if(!COLDEFS[sec]) return; colCfgSec=sec; renderColCfgList(); const m=$('#colcfg-modal'); if(m) m.hidden=false; }
function renderColCfgList(){ const sec=colCfgSec; if(!sec) return; const cfg=colCfg(sec), defs=COLDEFS[sec]; const box=$('#colcfg-list'); if(!box) return;
  box.innerHTML = cfg.order.map(k=>{ const d=defs.find(c=>c.key===k); if(!d) return '';
    return `<li class="col-item" data-col="${k}">
      <label class="col-check"><input type="checkbox" ${cfg.hidden.includes(k)?'':'checked'} data-ccol-toggle="${k}"><span>${esc(colLab(d))}</span></label>
      <span class="col-moves"><button type="button" data-ccol-up="${k}" title="↑">↑</button><button type="button" data-ccol-down="${k}" title="↓">↓</button></span>
    </li>`; }).join('');
  $$('[data-ccol-toggle]').forEach(b=>b.onchange=()=>{ const k=b.dataset.ccolToggle, c=colCfg(colCfgSec);
    if(b.checked) c.hidden=c.hidden.filter(x=>x!==k); else if(!c.hidden.includes(k)) c.hidden.push(k);
    save(); rerenderSec(colCfgSec); });
  $$('[data-ccol-up]').forEach(b=>b.onclick=()=>moveColCfg(b.dataset.ccolUp,-1));
  $$('[data-ccol-down]').forEach(b=>b.onclick=()=>moveColCfg(b.dataset.ccolDown,1));
}
function moveColCfg(k,dir){ const c=colCfg(colCfgSec), i=c.order.indexOf(k), j=i+dir;
  if(i<0||j<0||j>=c.order.length) return; [c.order[i],c.order[j]]=[c.order[j],c.order[i]];
  save(); renderColCfgList(); rerenderSec(colCfgSec); }
document.addEventListener('click',e=>{ const b=e.target.closest('[data-colcfg]'); if(b) openColCfg(b.dataset.colcfg); });
if($('#colcfg-close')) $('#colcfg-close').onclick=()=>$('#colcfg-modal').hidden=true;
if($('#colcfg-done')) $('#colcfg-done').onclick=()=>$('#colcfg-modal').hidden=true;
if($('#colcfg-modal')) $('#colcfg-modal').onclick=e=>{ if(e.target.id==='colcfg-modal') $('#colcfg-modal').hidden=true; };
if($('#colcfg-reset')) $('#colcfg-reset').onclick=()=>{ if(!colCfgSec) return; DB.colCfg[colCfgSec]={order:COLDEFS[colCfgSec].map(c=>c.key),hidden:[]}; save(); renderColCfgList(); rerenderSec(colCfgSec); };

/* ---- Calendario riutilizzabile ---- */
let calState={planning:new Date(), events:new Date()};
function renderCalendar(sec, items, chip, cont){
  const cur=calState[sec]; const y=cur.getFullYear(), m=cur.getMonth();
  const dows=(window.LFI18N&&window.LFI18N.lang==='en')?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const startDow=(new Date(y,m,1).getDay()+6)%7, days=new Date(y,m+1,0).getDate(), today=ymdStr(new Date());
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<div class="cal-cell cal-out"></div>';
  for(let d=1;d<=days;d++){
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const its=items.filter(x=>x.date===ds);
    cells+=`<div class="cal-cell${ds===today?' cal-today':''}" data-calday="${ds}"><span class="cal-d">${d}</span><div class="cal-items">${its.map(chip).join('')}</div></div>`;
  }
  const label=cur.toLocaleDateString(calLang(),{month:'long',year:'numeric'});
  cont.innerHTML=`<div class="cal-head">
      <button class="cal-nav" data-calnav="-1" aria-label="prev">‹</button>
      <span class="cal-title">${label.charAt(0).toUpperCase()+label.slice(1)}</span>
      <button class="cal-nav" data-calnav="1" aria-label="next">›</button>
      <button class="cal-nav cal-today-btn" data-calnav="0">${tt('cal.today')}</button>
    </div>
    <div class="cal">${dows.map(w=>`<div class="cal-dow">${w}</div>`).join('')}${cells}</div>`;
}
function calMove(sec, delta){ if(delta===0) calState[sec]=new Date(); else calState[sec]=new Date(calState[sec].getFullYear(), calState[sec].getMonth()+delta, 1); }
function clearPager(anchor){ const m=anchor&&anchor.nextElementSibling; if(m&&m.classList&&m.classList.contains('pager-mount')) m.innerHTML=''; }

/* ---- Pianificazione ---- */
let plnSort={col:'date',dir:1}, editingPlnId=null;
const PLN_KIND={release:'pln.k_release',premiere:'pln.k_premiere'};
const PLN_STATUS={idea:'pln.s_idea',planned:'pln.s_planned',confirmed:'pln.s_confirmed',done:'pln.s_done'};
const PLN_STK={idea:'mut',planned:'warn',confirmed:'info',done:'ok'};
function plnById(id){ return (DB.planning||[]).find(x=>x.id===id); }
function plnChip(p){ return `<span class="cal-chip cal-k-${p.kind}" data-pln="${p.id}" title="${esc(p.title)}">${esc(p.title)}</span>`; }
function renderPlanning(){
  const listC=$('#planning-list'), calC=$('#planning-cal'); if(!listC) return;
  const pq=($('#pln-search')&&$('#pln-search').value||'').toLowerCase().trim();
  const allRaw=DB.planning||[];
  const all=pq?allRaw.filter(p=>((p.title||'')+' '+(p.artist||'')+' '+(p.platform||'')+' '+(p.note||'')).toLowerCase().includes(pq)):allRaw;
  $('#planning-empty').hidden=allRaw.length>0;
  const mode=getVM('planning','list');
  listC.hidden=(mode==='cal'); calC.hidden=(mode!=='cal');
  if(mode==='cal'){ clearPager(listC); renderCalendar('planning', all, plnChip, calC); syncVMButtons(); return; }
  const cols=colsFor('planning');
  const info=paginate(colSort('planning',all,plnSort),'planning');
  listC.className='dbl';
  const sel=selOpt('planning');
  listC.innerHTML=dbHead(cols,plnSort,{actions:1,sel})+dbRows(info.slice,cols,{actions:p=>rowActs('pln',p.id),sel});
  mountPager(listC,'planning',info); syncVMButtons();
}
function openPlnForm(id){ editingPlnId=id||null; const p=id?plnById(id):null;
  $('#pln-form-title').textContent = p?tt('common.edit'):tt('pln.new');
  $('#pln-title').value=p?p.title||'':''; $('#pln-kind').value=p?p.kind||'release':'release';
  $('#pln-artist').value=p?p.artist||'':''; $('#pln-date').value=p?p.date||'':( $('#pln-date').value||'');
  $('#pln-status').value=p?p.status||'idea':'idea'; $('#pln-platform').value=p?p.platform||'':''; $('#pln-note').value=p?p.note||'':'';
  $('#pln-form').hidden=false; $('#pln-form').scrollIntoView({behavior:'smooth',block:'start'}); }
function savePlanning(){
  const title=$('#pln-title').value.trim(); if(!title){ toast(tt('pln.need_title')); return; }
  const data={ title, kind:$('#pln-kind').value, artist:$('#pln-artist').value.trim(), date:$('#pln-date').value||'',
    status:$('#pln-status').value, platform:$('#pln-platform').value.trim(), note:$('#pln-note').value.trim() };
  if(editingPlnId){ const p=plnById(editingPlnId); if(p) Object.assign(p,data); } else DB.planning.push(Object.assign({id:newId()},data));
  save(); $('#pln-form').hidden=true; editingPlnId=null; renderPlanning(); toast(tt('common.saved')); }
function deletePlanning(id){ const p=plnById(id); if(!p) return; if(!confirm(tt('common.del_q'))) return;
  DB.planning=DB.planning.filter(x=>x.id!==id); save(); renderPlanning(); }

/* ---- Eventi ---- */
let evtSort={col:'date',dir:1}, editingEvtId=null;
const EVT_KIND={showcase:'evt.k_showcase',radio:'evt.k_radio',live:'evt.k_live',club:'evt.k_club',festival:'evt.k_festival',other:'evt.k_other'};
function evtById(id){ return (DB.events||[]).find(x=>x.id===id); }
function evtChip(e){ return `<span class="cal-chip cal-k-${e.kind}" data-evt="${e.id}" title="${esc(e.title)}">${e.time?('<b>'+esc(e.time)+'</b> '):''}${esc(e.title)}</span>`; }
function renderEvents(){
  const listC=$('#events-list'), calC=$('#events-cal'); if(!listC) return;
  const eq=($('#evt-search')&&$('#evt-search').value||'').toLowerCase().trim();
  const allRaw=DB.events||[];
  const all=eq?allRaw.filter(e=>((e.title||'')+' '+(e.venue||'')+' '+(e.city||'')+' '+(e.country||'')+' '+(e.note||'')).toLowerCase().includes(eq)):allRaw;
  $('#events-empty').hidden=allRaw.length>0;
  const mode=getVM('events','list');
  listC.hidden=(mode==='cal'); calC.hidden=(mode!=='cal');
  if(mode==='cal'){ clearPager(listC); renderCalendar('events', all, evtChip, calC); syncVMButtons(); return; }
  const cols=colsFor('events');
  const info=paginate(colSort('events',all,evtSort),'events');
  listC.className='dbl';
  const sel=selOpt('events');
  listC.innerHTML=dbHead(cols,evtSort,{actions:1,sel})+dbRows(info.slice,cols,{actions:e=>rowActs('evt',e.id),sel});
  mountPager(listC,'events',info); syncVMButtons();
}
function openEvtForm(id){ editingEvtId=id||null; const e=id?evtById(id):null;
  $('#evt-form-title').textContent = e?tt('common.edit'):tt('evt.new');
  $('#evt-title').value=e?e.title||'':''; $('#evt-kind').value=e?e.kind||'showcase':'showcase';
  $('#evt-date').value=e?e.date||'':( $('#evt-date').value||''); $('#evt-time').value=e?e.time||'':'';
  $('#evt-venue').value=e?e.venue||'':''; $('#evt-city').value=e?e.city||'':''; $('#evt-country').value=e?e.country||'':''; $('#evt-note').value=e?e.note||'':'';
  $('#evt-form').hidden=false; $('#evt-form').scrollIntoView({behavior:'smooth',block:'start'}); }
function saveEvent(){
  const title=$('#evt-title').value.trim(); if(!title){ toast(tt('evt.need_title')); return; }
  const data={ title, kind:$('#evt-kind').value, date:$('#evt-date').value||'', time:$('#evt-time').value||'',
    venue:$('#evt-venue').value.trim(), city:$('#evt-city').value.trim(), country:$('#evt-country').value.trim(), note:$('#evt-note').value.trim() };
  if(editingEvtId){ const e=evtById(editingEvtId); if(e) Object.assign(e,data); } else DB.events.push(Object.assign({id:newId()},data));
  save(); $('#evt-form').hidden=true; editingEvtId=null; renderEvents(); toast(tt('common.saved')); }
function deleteEvent(id){ const e=evtById(id); if(!e) return; if(!confirm(tt('common.del_q'))) return;
  DB.events=DB.events.filter(x=>x.id!==id); save(); renderEvents(); }

/* ---- Support DJ ---- */
let supSort={col:'date',dir:-1}, editingSupId=null;
function supById(id){ return (DB.supports||[]).find(x=>x.id===id); }
function renderSupports(){
  const listC=$('#supports-list'); if(!listC) return;
  const q=($('#sup-search')&&$('#sup-search').value||'').toLowerCase().trim();
  const all=(DB.supports||[]).filter(s=> !q || (s.dj+' '+(s.track||'')+' '+(s.venue||'')+' '+(s.city||'')+' '+(s.country||'')).toLowerCase().includes(q));
  $('#supports-empty').hidden=(DB.supports||[]).length>0;
  const cols=colsFor('supports');
  const info=paginate(colSort('supports',all,supSort),'supports');
  listC.className='dbl';
  const sel=selOpt('supports');
  listC.innerHTML=dbHead(cols,supSort,{actions:1,sel})+dbRows(info.slice,cols,{actions:s=>rowActs('sup',s.id),sel});
  mountPager(listC,'supports',info);
}
function openSupForm(id){ editingSupId=id||null; const s=id?supById(id):null;
  $('#sup-form-title').textContent = s?tt('common.edit'):tt('sup.new');
  $('#sup-dj').value=s?s.dj||'':''; $('#sup-track').value=s?s.track||'':''; $('#sup-venue').value=s?s.venue||'':'';
  $('#sup-city').value=s?s.city||'':''; $('#sup-country').value=s?s.country||'':''; $('#sup-date').value=s?s.date||'':''; $('#sup-note').value=s?s.note||'':'';
  $('#sup-form').hidden=false; $('#sup-form').scrollIntoView({behavior:'smooth',block:'start'}); }
function saveSupport(){
  const dj=$('#sup-dj').value.trim(); if(!dj){ toast(tt('sup.need_dj')); return; }
  const data={ dj, track:$('#sup-track').value.trim(), venue:$('#sup-venue').value.trim(), city:$('#sup-city').value.trim(),
    country:$('#sup-country').value.trim(), date:$('#sup-date').value||'', note:$('#sup-note').value.trim() };
  if(editingSupId){ const s=supById(editingSupId); if(s) Object.assign(s,data); } else DB.supports.push(Object.assign({id:newId()},data));
  save(); $('#sup-form').hidden=true; editingSupId=null; renderSupports(); toast(tt('common.saved')); }
function deleteSupport(id){ const s=supById(id); if(!s) return; if(!confirm(tt('common.del_q'))) return;
  DB.supports=DB.supports.filter(x=>x.id!==id); save(); renderSupports(); }

/* ---- Esportazioni ---- */
registerExport('planning', ()=>({ title:tt('pln.title'), headers:[tt('pln.f_date'),tt('pln.f_kind'),tt('pln.f_title').replace(' *',''),tt('pln.f_artist'),tt('pln.f_status'),tt('pln.f_platform'),tt('pln.f_note')],
  rows:sortBy(DB.planning||[],plnSort).map(p=>[p.date||'',tt(PLN_KIND[p.kind]||''),p.title||'',p.artist||'',tt(PLN_STATUS[p.status]||''),p.platform||'',p.note||'']) }));
registerExport('events', ()=>({ title:tt('evt.title'), headers:[tt('evt.f_date'),tt('evt.f_time'),tt('evt.f_kind'),tt('evt.f_title').replace(' *',''),tt('evt.f_venue'),tt('evt.f_city'),tt('evt.f_country'),tt('evt.f_note')],
  rows:sortBy(DB.events||[],evtSort).map(e=>[e.date||'',e.time||'',tt(EVT_KIND[e.kind]||''),e.title||'',e.venue||'',e.city||'',e.country||'',e.note||'']) }));
registerExport('supports', ()=>({ title:tt('sup.title'), headers:[tt('sup.f_date'),tt('sup.f_dj').replace(' *',''),tt('sup.f_track'),tt('sup.f_venue'),tt('sup.f_city'),tt('sup.f_country'),tt('sup.f_note')],
  rows:sortBy(DB.supports||[],supSort).map(s=>[s.date||'',s.dj||'',s.track||'',s.venue||'',s.city||'',s.country||'',s.note||'']) }));

/* ---- Wiring sezioni agenda ---- */
function wireAgenda(){
  // ricerca per sezione
  $('#rel-search')?.addEventListener('input',renderReleases);
  $('#pln-search')?.addEventListener('input',renderPlanning);
  $('#evt-search')?.addEventListener('input',renderEvents);
  $('#con-search')?.addEventListener('input',renderContracts);
  $('#tsk-search')?.addEventListener('input',renderTasks);
  // Pianificazione
  $('#pln-new')?.addEventListener('click',()=>openPlnForm());
  $('#pln-cancel')?.addEventListener('click',()=>{ $('#pln-form').hidden=true; editingPlnId=null; });
  $('#pln-save')?.addEventListener('click',savePlanning);
  $('#planning-list')?.addEventListener('click',e=>{
    const so=e.target.closest('[data-sort]'); if(so){ const c=so.dataset.sort; if(plnSort.col===c) plnSort.dir*=-1; else plnSort={col:c,dir:1}; renderPlanning(); return; }
    const ed=e.target.closest('[data-pln-edit]'); if(ed) return openPlnForm(ed.dataset.plnEdit);
    const dl=e.target.closest('[data-pln-del]'); if(dl) return deletePlanning(dl.dataset.plnDel);
  });
  $('#planning-cal')?.addEventListener('click',e=>{
    const nv=e.target.closest('[data-calnav]'); if(nv){ calMove('planning',+nv.dataset.calnav); renderPlanning(); return; }
    const ch=e.target.closest('[data-pln]'); if(ch){ openPlnForm(ch.dataset.pln); return; }
    const day=e.target.closest('[data-calday]'); if(day){ openPlnForm(); $('#pln-date').value=day.dataset.calday; }
  });
  // Eventi
  $('#evt-new')?.addEventListener('click',()=>openEvtForm());
  $('#evt-cancel')?.addEventListener('click',()=>{ $('#evt-form').hidden=true; editingEvtId=null; });
  $('#evt-save')?.addEventListener('click',saveEvent);
  $('#events-list')?.addEventListener('click',e=>{
    const so=e.target.closest('[data-sort]'); if(so){ const c=so.dataset.sort; if(evtSort.col===c) evtSort.dir*=-1; else evtSort={col:c,dir:1}; renderEvents(); return; }
    const ed=e.target.closest('[data-evt-edit]'); if(ed) return openEvtForm(ed.dataset.evtEdit);
    const dl=e.target.closest('[data-evt-del]'); if(dl) return deleteEvent(dl.dataset.evtDel);
  });
  $('#events-cal')?.addEventListener('click',e=>{
    const nv=e.target.closest('[data-calnav]'); if(nv){ calMove('events',+nv.dataset.calnav); renderEvents(); return; }
    const ch=e.target.closest('[data-evt]'); if(ch){ openEvtForm(ch.dataset.evt); return; }
    const day=e.target.closest('[data-calday]'); if(day){ openEvtForm(); $('#evt-date').value=day.dataset.calday; }
  });
  // Support DJ
  $('#sup-new')?.addEventListener('click',()=>openSupForm());
  $('#sup-cancel')?.addEventListener('click',()=>{ $('#sup-form').hidden=true; editingSupId=null; });
  $('#sup-save')?.addEventListener('click',saveSupport);
  $('#sup-search')?.addEventListener('input',renderSupports);
  $('#supports-list')?.addEventListener('click',e=>{
    const so=e.target.closest('[data-sort]'); if(so){ const c=so.dataset.sort; if(supSort.col===c) supSort.dir*=-1; else supSort={col:c,dir:1}; renderSupports(); return; }
    const ed=e.target.closest('[data-sup-edit]'); if(ed) return openSupForm(ed.dataset.supEdit);
    const dl=e.target.closest('[data-sup-del]'); if(dl) return deleteSupport(dl.dataset.supDel);
  });
}

/* ============================================================================
   NOTIFICHE  (tendina in alto a destra)
   ============================================================================ */
const NOTIF_KEY='labelfinance.notifs';
let NOTIFS=(function(){ try{ const n=JSON.parse(localStorage.getItem(NOTIF_KEY)); if(n&&Array.isArray(n.list)) return {list:n.list, dismissed:n.dismissed||[]}; }catch(e){} return {list:[],dismissed:[]}; })();
function notifSave(){ try{ localStorage.setItem(NOTIF_KEY, JSON.stringify(NOTIFS)); }catch(e){} }
function notifScan(){
  if(typeof DB==='undefined'||!DB) return;
  const unlinked=new Set();
  (DB.transactions||[]).forEach(t=>{ const p=(t.product||'').trim(); if(!p) return; if(!releaseForTx(t)) unlinked.add(p); });
  const ukeys=new Set([...unlinked].map(p=>p.toLowerCase()));
  NOTIFS.list=NOTIFS.list.filter(n=> n.type!=='unlinked' || ukeys.has((n.ref||'').toLowerCase()));   // risolti via
  NOTIFS.dismissed=(NOTIFS.dismissed||[]).filter(k=>ukeys.has(k));
  unlinked.forEach(p=>{ const lk=p.toLowerCase(), key='unlinked:'+lk;
    if((NOTIFS.dismissed||[]).includes(lk)) return;
    if(NOTIFS.list.some(n=>n.key===key)) return;
    NOTIFS.list.unshift({ id:newId(), key, type:'unlinked', ref:p, read:false, ts:Date.now() }); });
  // dati aggiuntivi (UPC/ISRC/catalogo/artista…) trovati in Movimenti per release esistenti
  const enrN=txEnrichments().length;
  const prevEnr=NOTIFS.list.find(n=>n.type==='enrich');
  NOTIFS.list=NOTIFS.list.filter(n=>n.type!=='enrich');
  if(enrN && !(NOTIFS.dismissed||[]).includes('enrich:'+enrN))
    NOTIFS.list.unshift(prevEnr ? {...prevEnr, count:enrN} : { id:newId(), key:'enrich', type:'enrich', count:enrN, read:false, ts:Date.now() });
  notifSave(); renderNotifs();
}
function notifText(n){
  const T=(k,fb)=>{ const v=tt(k); return (v&&v!==k)?v:fb; };   // fallback se i18n non aggiornata (cache)
  if(n.type==='unlinked') return {
    title: T('notif.unlinked_t','Prodotto non collegato'),
    body: T('notif.unlinked_b','Il prodotto «{p}» non è collegato a nessuna release: registralo in Discografia perché i calcoli tornino.').replace('{p}', n.ref||'') };
  if(n.type==='enrich') return {
    title: T('notif.enrich_t','Dati aggiuntivi trovati'),
    body: T('notif.enrich_b','In Movimenti ci sono {n} dati utili (UPC, ISRC, catalogo, artista…) per release già presenti. Apri per arricchire la Discografia.').replace('{n}', n.count||0) };
  return { title:n.title||'', body:n.body||'' };
}
function notifTime(ts){ try{ return new Date(ts).toLocaleString(calLang(),{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
function renderNotifs(){
  const badge=$('#notif-badge'); const unread=NOTIFS.list.filter(n=>!n.read).length;
  if(badge){ badge.textContent=unread>9?'9+':String(unread); badge.hidden=unread===0; }
  const list=$('#notif-list'); if(!list) return;
  if(!NOTIFS.list.length){ list.innerHTML=`<div class="notif-empty">${tt('notif.empty')}</div>`; return; }
  list.innerHTML=NOTIFS.list.map(it=>{ const tx=notifText(it);
    return `<div class="notif-item${it.read?'':' unread'}" data-nid="${it.id}">
      <span class="notif-dot"></span>
      <div class="notif-body">
        <div class="notif-t">${esc(tx.title)}</div>
        <div class="notif-b">${esc(tx.body)}</div>
        <div class="notif-time">${esc(notifTime(it.ts))}</div>
      </div>
      <div class="notif-item-acts">
        ${it.type==='enrich'?`<button class="notif-mini notif-act" data-naction="${it.id}">${tt('notif.enrich_btn')}</button>`:''}
        <button class="notif-mini" data-ntoggle="${it.id}" title="${it.read?tt('notif.mark_unread'):tt('notif.mark_read')}">${it.read?'○':'●'}</button>
        <button class="notif-mini" data-ndel="${it.id}" title="${tt('common.delete')}">✕</button>
      </div></div>`; }).join('');
}
function notifToggle(id){ const it=NOTIFS.list.find(x=>x.id===id); if(!it) return; it.read=!it.read; notifSave(); renderNotifs(); }
// click su una notifica → porta alla cosa collegata
function notifOpen(it){
  if(!it) return;
  it.read=true; notifSave(); renderNotifs();
  const p=$('#notif-panel'); if(p) p.hidden=true;
  if(it.type==='enrich'){ openEnrichModal(); return; }
  if(it.type==='unlinked'){
    // il prodotto non è collegato: apri Discografia con una nuova release già intitolata
    goto('releases'); openRelease(null);
    const ti=$('#r-title'); if(ti){ ti.value=it.ref||''; ti.focus(); }
    return;
  }
  if(it.relId){ goto('releases'); openRelease(it.relId); return; }   // notifiche legate a una release
  if(it.view){ goto(it.view); }                                       // tipi futuri (task, contratti…)
}
function notifDismiss(it){ if(!it) return;
  if(it.type==='unlinked') NOTIFS.dismissed=[...new Set([...(NOTIFS.dismissed||[]),(it.ref||'').toLowerCase()])];
  else if(it.type==='enrich') NOTIFS.dismissed=[...new Set([...(NOTIFS.dismissed||[]),'enrich:'+(it.count||0)])]; }
function notifDelete(id){ const it=NOTIFS.list.find(x=>x.id===id); notifDismiss(it);
  NOTIFS.list=NOTIFS.list.filter(x=>x.id!==id); notifSave(); renderNotifs(); }
function notifReadAll(){ NOTIFS.list.forEach(n=>n.read=true); notifSave(); renderNotifs(); }
function notifClear(){ NOTIFS.list.forEach(notifDismiss); NOTIFS.list=[]; notifSave(); renderNotifs(); }
/* ---------- Menu a gruppi (accordion) ---------- */
const NAVGRP_KEY='labelfinance.navgroups';
let navGrpState=(function(){ try{ return JSON.parse(localStorage.getItem(NAVGRP_KEY))||{}; }catch(e){ return {}; } })();
function applyNavGroups(){ document.querySelectorAll('.nav-group').forEach(g=>g.classList.toggle('collapsed', !!navGrpState[g.dataset.group])); }
function wireNavGroups(){
  document.querySelectorAll('.nav-group-h').forEach(h=>h.addEventListener('click',()=>{
    const g=h.closest('.nav-group'); if(!g) return; const k=g.dataset.group;
    const now=!g.classList.contains('collapsed'); g.classList.toggle('collapsed', now);
    navGrpState[k]=now; try{ localStorage.setItem(NAVGRP_KEY, JSON.stringify(navGrpState)); }catch(e){}
  }));
  applyNavGroups();
}
function expandActiveGroup(){ const act=document.querySelector('.nav-item.is-active'); const g=act&&act.closest('.nav-group'); if(g) g.classList.remove('collapsed'); }
function wireNotifs(){
  $('#notif-btn')?.addEventListener('click',e=>{ e.stopPropagation(); const p=$('#notif-panel'); if(p) p.hidden=!p.hidden; });
  $('#notif-readall')?.addEventListener('click',notifReadAll);
  $('#notif-clear')?.addEventListener('click',notifClear);
  $('#notif-list')?.addEventListener('click',e=>{
    const ac=e.target.closest('[data-naction]'); if(ac){ const it=NOTIFS.list.find(x=>x.id===ac.dataset.naction);
      if(it&&it.type==='enrich'){ $('#notif-panel')&&($('#notif-panel').hidden=true); openEnrichModal(); } return; }
    const tg=e.target.closest('[data-ntoggle]'); if(tg){ notifToggle(tg.dataset.ntoggle); return; }
    const dl=e.target.closest('[data-ndel]'); if(dl){ notifDelete(dl.dataset.ndel); return; }
    const item=e.target.closest('.notif-item'); if(item){ notifOpen(NOTIFS.list.find(x=>x.id===item.dataset.nid)); }
  });
  document.addEventListener('click',e=>{ const p=$('#notif-panel'); if(!p||p.hidden) return;
    if(!e.target.closest('#notif-panel') && !e.target.closest('#notif-btn')) p.hidden=true; });
}

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
    const so=e.target.closest('[data-sort]'); if(so){ const c=so.dataset.sort;
      if(artSort.col===c) artSort.dir*=-1; else artSort={col:c,dir:1}; renderArtists(); return; }
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
  // Chiave AI locale (fallback senza Edge Function)
  const aiStat=()=>{ const s=$('#ai-key-status'); if(s) s.textContent = aiLocalKey()?tt('set.ai_set'):tt('set.ai_unset'); };
  if($('#ai-key')){ $('#ai-key').value=''; aiStat(); }
  $('#ai-key-save')?.addEventListener('click',()=>{ const v=$('#ai-key').value.trim();
    if(!v){ toast(tt('set.ai_need')); return; }
    try{ localStorage.setItem(AI_KEY_LS,v); }catch(e){} $('#ai-key').value=''; aiStat();
    if($('#ai-pop') && !$('#ai-pop').hidden) aiPopBody(); toast(tt('set.ai_saved')); });
  $('#ai-key-clear')?.addEventListener('click',()=>{ try{ localStorage.removeItem(AI_KEY_LS); }catch(e){} aiStat(); toast(tt('set.ai_removed')); });
  // EmailJS (invio automatico contratti)
  const ejStat=()=>{ const s=$('#ej-status'); if(s) s.textContent= ejReady()?tt('set.email_set'):tt('set.email_unset'); };
  { const c=ejCfg(); if(c){ if($('#ej-service'))$('#ej-service').value=c.service||''; if($('#ej-template'))$('#ej-template').value=c.template||''; if($('#ej-key'))$('#ej-key').value=c.key||''; } ejStat(); }
  $('#ej-save')?.addEventListener('click',()=>{ const cfg={service:$('#ej-service').value.trim(),template:$('#ej-template').value.trim(),key:$('#ej-key').value.trim()};
    if(!cfg.service||!cfg.template||!cfg.key){ toast(tt('set.email_need')); return; }
    try{ localStorage.setItem(EJ_LS,JSON.stringify(cfg)); }catch(e){} ejStat(); toast(tt('set.email_saved')); });
  $('#ej-clear')?.addEventListener('click',()=>{ try{ localStorage.removeItem(EJ_LS); }catch(e){} ['ej-service','ej-template','ej-key'].forEach(id=>{const e=$('#'+id); if(e)e.value='';}); ejStat(); toast(tt('set.email_removed')); });
  $('#ej-template-btn')?.addEventListener('click',()=>{ const b=$('#ej-template-box'); if(!b) return; b.hidden=!b.hidden; if(!b.dataset.set){ b.textContent=EJ_TEMPLATE; b.dataset.set='1'; } });
  // Condivisione link firma
  $('#share-close')?.addEventListener('click',()=>{ $('#share-modal').hidden=true; });
  $('#share-modal')?.addEventListener('click',e=>{ if(e.target.id==='share-modal') $('#share-modal').hidden=true; });
  $('#share-copy')?.addEventListener('click',()=>{ const i=$('#share-link'); i.select();
    try{ navigator.clipboard.writeText(i.value); }catch(e){ document.execCommand&&document.execCommand('copy'); }
    toast(tt('con.link_copied')); });
  // Firma
  $('#sign-close')?.addEventListener('click',closeSignPad);
  $('#sign-clear')?.addEventListener('click',()=>{ if(sigPad) sigPad.clear(); });
  $('#sign-confirm')?.addEventListener('click',confirmSign);
  $('#sign-modal')?.addEventListener('click',e=>{ if(e.target.id==='sign-modal') closeSignPad(); });
  // Assistente AI (bolla flottante)
  $('#ai-fab')?.addEventListener('click',toggleAiPop);
  $('#ai-pop-x')?.addEventListener('click',closeAiPop);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && $('#ai-pop') && !$('#ai-pop').hidden) closeAiPop(); });
  // chiudi cliccando fuori dal popover
  document.addEventListener('click',e=>{ const pop=$('#ai-pop'); if(!pop||pop.hidden) return;
    if(!e.target.isConnected) return;   // target rimosso dal DOM (es. rebuild): non chiudere
    if(!e.target.closest('#ai-pop') && !e.target.closest('#ai-fab')) closeAiPop(); });
  // Merch
  $('#mch-new')?.addEventListener('click',()=>openMerchForm());
  $('#mch-cancel')?.addEventListener('click',()=>{ $('#mch-form').hidden=true; editingMerchId=null; });
  $('#mch-save')?.addEventListener('click',saveMerch);
  $('#mch-search')?.addEventListener('input',renderMerch);
  $('#merch-grid')?.addEventListener('click',e=>{
    const so=e.target.closest('[data-sort]'); if(so){ const c=so.dataset.sort;
      if(merchSort.col===c) merchSort.dir*=-1; else merchSort={col:c,dir:(c==='name'?1:-1)}; renderMerch(); return; }
    const s=e.target.closest('[data-mch-sell]'); if(s) return sellMerch(s.dataset.mchSell);
    const ed=e.target.closest('[data-mch-edit]'); if(ed) return openMerchForm(ed.dataset.mchEdit);
    const dl=e.target.closest('[data-mch-del]'); if(dl) return deleteMerch(dl.dataset.mchDel);
  });
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
wireAgenda();
wireNotifs();
notifScan();
wireNavGroups();

/* ---------- Avvisi task: scheduler + audio sbloccato al primo gesto ---------- */
document.addEventListener('pointerdown', ()=>lfAudio(), {once:true});
setTimeout(checkTaskAlerts, 4000);
setInterval(checkTaskAlerts, 30000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') checkTaskAlerts(); });
try{ updateNotifHint(); }catch(e){}

/* ---------- Aggiornamento automatico contratti (firma/rifiuto in tempo reale) ---------- */
window.addEventListener('lf-contracts-changed', ()=>{ if(typeof refreshContractStatuses==='function') refreshContractStatuses(); });
setInterval(()=>{ if(document.visibilityState==='visible' && document.querySelector('#view-contracts.is-active') && typeof refreshContractStatuses==='function') refreshContractStatuses(); }, 10000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && document.querySelector('#view-contracts.is-active') && typeof refreshContractStatuses==='function') refreshContractStatuses(); });
