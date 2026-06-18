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
const PLAN_LIMITS = { free:1, studio:3, agency:Infinity };
const newId = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const defaultRates = ()=>({ EUR:1, USD:0.92, GBP:1.17, CHF:1.04 });
function defaultLabel(name='La mia etichetta'){
  return { id:newId(), name, transactions:[], releases:[], profile:{name:'',label:name},
    rates:defaultRates(), mappings:{},
    txOrder:DEFAULT_TX_ORDER.slice(), txHidden:DEFAULT_TX_ORDER.filter(c=>!DEFAULT_TX_VISIBLE.includes(c)) };
}
function ensureLabelShape(l){
  l.id=l.id||newId();
  l.transactions=l.transactions||[]; l.releases=l.releases||[];
  l.profile=l.profile||{name:'',label:l.name||''};
  l.rates=l.rates||defaultRates(); l.mappings=l.mappings||{};
  l.txOrder=l.txOrder||DEFAULT_TX_ORDER.slice();
  l.txHidden=l.txHidden||DEFAULT_TX_ORDER.filter(c=>!DEFAULT_TX_VISIBLE.includes(c));
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
function reloadViews(){ renderDashboard(); renderTx(); renderReleases(); renderRoyalties(); renderOffers(); renderSettings(); }
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
const VIEW_TITLES={dashboard:'Dashboard',transactions:'Movimenti',releases:'Release',royalties:'Royalty',import:'Importa CSV',settings:'Impostazioni',about:'Chi siamo',offers:'Offerte & Piani',faq:'Aiuto & FAQ'};
function goto(view){
  $$('.nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('is-active',v.id==='view-'+view));
  const sec=$('#topbar-section'); if(sec) sec.textContent=VIEW_TITLES[view]||'';
  if(view==='dashboard') renderDashboard();
  if(view==='transactions') renderTx();
  if(view==='releases') renderReleases();
  if(view==='royalties') renderRoyalties();
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
  const g=$('#account-greet'); if(g) g.textContent=(DB.profile&&DB.profile.name)?DB.profile.name:'Le tue etichette';
  const pn=$('#account-plan'); if(pn) pn.textContent='Piano '+((PLAN_INFO[ACCOUNT.plan]||{}).name||'Starter');
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
    const btn=c.querySelector('.plan-btn'); if(btn){ btn.textContent=active?'Piano attuale':'Attiva'; btn.disabled=active; }
    const m=+c.dataset.monthly||0;
    const priceEl=c.querySelector('.plan-price'), noteEl=c.querySelector('.plan-note');
    if(priceEl){
      if(billing==='annual'){
        priceEl.innerHTML=`${fmtEur(m*0.7)}<span>/mese</span> <s class="plan-old">${fmtEur(m)}</s>`;
        if(noteEl) noteEl.textContent=`fatturato annualmente · ${fmtEur(m*12*0.7)}/anno invece di ${fmtEur(m*12)}`;
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
}

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
}
/* card dashboard con filtro + ordinamento */
const GROUP_TABLES=[
  {sel:'#table-release',key:'catalog',label:'Catalogo',i18n:'col.catalog'},
  {sel:'#table-artist',key:'artist',label:'Artista',i18n:'col.artist'},
  {sel:'#table-platform',key:'platform',label:'Piattaforma',i18n:'col.platform'},
  {sel:'#table-type',key:'type',label:'Tipologia',i18n:'col.type'},
];
let dashTxs=[]; const dashSort={}, dashFilter={};
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
  const rows=computeGroup(cfg);
  const cols=[['k',label,0],['in',gin,1],['out',gout,1],['net',gmar,1]];
  const head=cols.map(([id,lab,num])=>{ const act=sort.col===id?(sort.dir>0?' ▲':' ▼'):'';
    return `<th class="th-sort ${num?'num':''}" data-col="${id}">${esc(lab)}${act}</th>`; }).join('');
  const body=rows.length?rows.map(r=>`<tr><td data-label="${esc(label)}">${esc(r.k)}</td>
     <td class="num pos" data-label="${esc(gin)}">${fmtMoney(r.in)}</td><td class="num neg" data-label="${esc(gout)}">${fmtMoney(r.out)}</td>
     <td class="num ${r.net>=0?'pos':'neg'}" data-label="${esc(gmar)}">${fmtMoney(r.net)}</td></tr>`).join('')
     :'<tr><td colspan="4" class="muted">—</td></tr>';
  $(sel).innerHTML=`<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
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
  const cols=visibleCols();
  const head=cols.map(c=>{ const act=txSort.col===c?(txSort.dir>0?' ▲':' ▼'):'';
    return `<th class="th-sort ${TX_COLS[c].num?'num':''}" data-col="${c}">${esc(colLabel(c))}${act}</th>`; }).join('');
  const body=rows.length
    ? rows.map(t=>`<tr data-id="${t.id}">${cols.map(c=>`<td class="${TX_COLS[c].num?'num':''}" data-label="${esc(colLabel(c))}">${TX_COLS[c].cell(t)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length||1}" class="muted">${tt('empty.notx')}</td></tr>`;
  $('#table-tx').innerHTML=`<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
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
  const list=releases().slice().sort((a,b)=>(a.catalog||'').localeCompare(b.catalog||''));
  $('#rel-count-label').textContent=`${list.length} release`;
  $('#releases-cards').innerHTML = list.length ? list.map(r=>{
    const tot=(r.splits||[]).reduce((s,x)=>s+(+x.pct||0),0);
    const label=Math.max(0,100-tot);
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
  }).join('') : `<p class="muted">${tt('empty.norel')}</p>`;
  $$('#releases-cards .release-card').forEach(c=>c.onclick=()=>openRelease(c.dataset.id));
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
  $('#rel-modal-title').textContent = r ? 'Modifica release' : 'Nuova release';
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
function renderRoyalties(){
  const hasRel=releases().length>0;
  $('#roy-empty').hidden = hasRel;
  const { byArtist, labelTotal } = computeRoyalties();
  const rows=Object.entries(byArtist).map(([name,v])=>({name,...v})).sort((a,b)=>b.total-a.total);
  const tbl=$('#table-roy-artist');
  if(!hasRel){ tbl.innerHTML=''; $('#roy-detail-panel').hidden=true; return; }
  tbl.innerHTML=`<thead><tr><th>${tt('roy.h.artist')}</th><th class="num">${tt('roy.h.amount')}</th></tr></thead>
    <tbody>${rows.map(r=>`<tr data-artist="${esc(r.name)}" style="cursor:pointer">
      <td data-label="Artista">${esc(r.name)}</td><td class="num pos" data-label="Royalty (€)">${fmtMoney(r.total)}</td></tr>`).join('')}
      <tr><td data-label=""><strong>${tt('roy.label_residual')}</strong></td><td class="num" data-label="${tt('roy.h.amount')}"><strong>${fmtMoney(labelTotal)}</strong></td></tr>
      ${rows.length?'':`<tr><td colspan="2" class="muted">${tt('empty.noroy')}</td></tr>`}</tbody>`;
  $$('#table-roy-artist tbody tr[data-artist]').forEach(tr=>tr.onclick=()=>showRoyaltyDetail(tr.dataset.artist,byArtist[tr.dataset.artist]));
}
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
  $('#tx-modal-title').textContent = t ? 'Modifica movimento' : (curKind==='expense'?'Nuova uscita':'Nuova entrata');
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

/* ---------- Cambio lingua: rigenera i contenuti dinamici ---------- */
window.addEventListener('langchange', ()=>{
  try{ reloadViews(); rebuildAccountMenu(); }catch(e){}
});

/* ---------- Avvio ---------- */
renderDashboard();
renderOffers();
rebuildAccountMenu();
initFAQ();
