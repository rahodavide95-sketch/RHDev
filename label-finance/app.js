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
const defaultData = () => ({
  transactions: [],
  releases: [],
  profile: { name:'', label:'' },
  rates: { EUR:1, USD:0.92, GBP:1.17, CHF:1.04 },
  mappings: {},
  txOrder: DEFAULT_TX_ORDER.slice(),
  txHidden: DEFAULT_TX_ORDER.filter(c=>!DEFAULT_TX_VISIBLE.includes(c)),
});
let DB = load();
function load(){
  try { const r = JSON.parse(localStorage.getItem(STORE_KEY));
    return r && r.transactions ? Object.assign(defaultData(), r) : defaultData(); }
  catch { return defaultData(); }
}
function saveLocal(){ localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
function save(){ saveLocal(); if(window.LF_push) window.LF_push(); }
/* API minimale per il modulo di sincronizzazione cloud (sync.js) */
window.LF = {
  data(){ return DB; },
  applyCloud(d){ DB = Object.assign(defaultData(), d||{}); saveLocal(); reloadViews(); },
  profile(){ return DB.profile || (DB.profile={name:'',label:''}); },
  setProfile(p){ DB.profile = Object.assign(this.profile(), p||{}); save(); if(typeof updateIdentity==='function') updateIdentity(); },
};
function reloadViews(){ renderDashboard(); renderTx(); renderReleases(); renderRoyalties(); renderSettings(); }
// integra eventuali colonne nuove non ancora presenti nell'ordine salvato
function ensureCols(){
  DB.txOrder = DB.txOrder || DEFAULT_TX_ORDER.slice();
  DB.txHidden = DB.txHidden || [];
  DEFAULT_TX_ORDER.forEach(c=>{ if(!DB.txOrder.includes(c)){ DB.txOrder.push(c); DB.txHidden.push(c); } });
}

/* ---------- Utils ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
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
const VIEW_TITLES={dashboard:'Dashboard',transactions:'Movimenti',releases:'Release',royalties:'Royalty',import:'Importa CSV',settings:'Impostazioni',about:'Chi siamo'};
function goto(view){
  $$('.nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('is-active',v.id==='view-'+view));
  const sec=$('#topbar-section'); if(sec) sec.textContent=VIEW_TITLES[view]||'';
  if(view==='dashboard') renderDashboard();
  if(view==='transactions') renderTx();
  if(view==='releases') renderReleases();
  if(view==='royalties') renderRoyalties();
  if(view==='settings') renderSettings();
  $('.main').scrollTop=0;
}
$$('.nav-item').forEach(b=>b.onclick=()=>goto(b.dataset.view));
document.addEventListener('click',e=>{ const g=e.target.closest('[data-goto]'); if(g) goto(g.dataset.goto); });
$('#btn-account').onclick=()=>goto('settings');
$('#btn-about').onclick=()=>goto('about');
$('#nav-reopen').onclick=()=>toggleNav(false);

/* identità: saluto in dashboard + nome label nella topbar */
function updateIdentity(){
  const p=(DB.profile)||{};
  const g=$('#greeting'); if(g) g.textContent = p.name ? `Ciao, ${p.name}` : 'Dashboard';
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
  const btn=$('#nav-collapse'); if(btn) btn.textContent=c?'»':'«';
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
function periodFilter(txs){
  const p=$('#dash-period').value; if(p==='all') return txs;
  const now=new Date(); let from=new Date(0);
  if(p==='ytd') from=new Date(now.getFullYear(),0,1);
  if(p==='12m') from=new Date(now.getFullYear(),now.getMonth()-11,1);
  if(p==='6m') from=new Date(now.getFullYear(),now.getMonth()-5,1);
  if(p==='3m') from=new Date(now.getFullYear(),now.getMonth()-2,1);
  const f=from.toISOString().slice(0,10);
  return txs.filter(t=>t.date>=f);
}
function renderDashboard(){
  updateIdentity();
  const all=DB.transactions;
  $('#dash-empty').hidden = all.length>0;
  const txs=periodFilter(all);
  let inc=0,exp=0;
  txs.forEach(t=>{ const v=toEur(t.net,t.currency); if(t.kind==='income') inc+=v; else exp+=Math.abs(v); });
  $('#kpi-income').textContent=fmtMoney(inc);
  $('#kpi-expense').textContent=fmtMoney(exp);
  $('#kpi-net').textContent=fmtMoney(inc-exp);
  $('#kpi-net').style.color = (inc-exp)>=0?'var(--in)':'var(--out)';
  $('#kpi-count').textContent=txs.length;
  $('#dash-range-label').textContent = $('#dash-period selected, #dash-period option:checked')?.textContent || $('#dash-period').selectedOptions[0].textContent;

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
    </div>`).join('') : '<p class="muted">Nessun dato nel periodo.</p>';

  groupTable('#table-release','catalog','Catalogo',txs);
  groupTable('#table-artist','artist','Artista',txs);
  groupTable('#table-platform','platform','Piattaforma',txs);
  groupTable('#table-type','type','Tipologia',txs);
}
function groupTable(sel,key,label,txs){
  const g={};
  txs.forEach(t=>{ const k=(t[key]||'—'); (g[k]??={in:0,out:0}); const v=toEur(t.net,t.currency);
    if(t.kind==='income') g[k].in+=v; else g[k].out+=Math.abs(v); });
  const rows=Object.entries(g).map(([k,v])=>({k,...v,net:v.in-v.out})).sort((a,b)=>b.net-a.net);
  $(sel).innerHTML = `<thead><tr><th>${label}</th><th class="num">Entrate</th><th class="num">Uscite</th><th class="num">Margine</th></tr></thead>
   <tbody>${rows.length?rows.map(r=>`<tr><td>${esc(r.k)}</td>
     <td class="num pos">${fmtMoney(r.in)}</td>
     <td class="num neg">${fmtMoney(r.out)}</td>
     <td class="num ${r.net>=0?'pos':'neg'}">${fmtMoney(r.net)}</td></tr>`).join('')
     :'<tr><td colspan="4" class="muted">—</td></tr>'}</tbody>`;
}
$('#dash-period').onchange=renderDashboard;
$('#btn-print').onclick=()=>{ document.body.classList.add('printing'); window.print(); setTimeout(()=>document.body.classList.remove('printing'),500); };

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
  platSel.innerHTML='<option value="">Tutte le piattaforme</option>'+plats.map(p=>`<option>${esc(p)}</option>`).join('');
  applyTxFilters();
}
function applyTxFilters(){
  const q=$('#tx-search').value.toLowerCase().trim();
  const kind=$('#tx-filter-kind').value, plat=$('#tx-filter-platform').value;
  const from=$('#tx-from').value, to=$('#tx-to').value;
  let rows=DB.transactions.slice();
  if(kind) rows=rows.filter(t=>t.kind===kind);
  if(plat) rows=rows.filter(t=>t.platform===plat);
  if(from) rows=rows.filter(t=>(t.date||'')>=from);
  if(to)   rows=rows.filter(t=>(t.date||'')<=to);
  if(q) rows=rows.filter(t=>[t.product,t.artist,t.catalog,t.platform,t.isrc,t.upc,t.code,t.note].join(' ').toLowerCase().includes(q));
  const k=txSort.col;
  rows.sort((a,b)=>{ const va=txSortKey(k,a), vb=txSortKey(k,b);
    const r=(typeof va==='number')?(va-vb):String(va).localeCompare(String(vb)); return r*txSort.dir; });
  $('#tx-count-label').textContent=`${rows.length} movimenti`;
  const cols=visibleCols();
  const head=cols.map(c=>{ const act=txSort.col===c?(txSort.dir>0?' ▲':' ▼'):'';
    return `<th class="th-sort ${TX_COLS[c].num?'num':''}" data-col="${c}">${esc(TX_COLS[c].label)}${act}</th>`; }).join('');
  const body=rows.length
    ? rows.map(t=>`<tr data-id="${t.id}">${cols.map(c=>`<td class="${TX_COLS[c].num?'num':''}">${TX_COLS[c].cell(t)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length||1}" class="muted">Nessun movimento.</td></tr>`;
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

/* ---------- Gestione colonne (mostra/nascondi + ordine) ---------- */
function renderColsManager(){
  ensureCols();
  $('#cols-list').innerHTML = DB.txOrder.filter(c=>TX_COLS[c]).map(c=>`
    <li class="col-item" data-col="${c}">
      <label class="col-check"><input type="checkbox" ${DB.txHidden.includes(c)?'':'checked'} data-col-toggle="${c}">
        <span>${esc(TX_COLS[c].label)||'(tipo IN/OUT)'}</span></label>
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
    </div>`;
  }).join('') : '<p class="muted">Nessuna release. Creane una per iniziare a calcolare le royalty.</p>';
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
function bindSplitRows(){
  $$('#r-splits .split-del').forEach(b=>b.onclick=()=>{ b.closest('.split-row').remove(); refreshSplitTotal(); });
  $$('#r-splits .split-pct').forEach(i=>i.oninput=refreshSplitTotal);
}
function openRelease(id){
  const r = id ? releases().find(x=>x.id===id) : null;
  artistDatalist();
  $('#rel-modal-title').textContent = r ? 'Modifica release' : 'Nuova release';
  $('#r-id').value=r?.id||'';
  $('#r-catalog').value=r?.catalog||''; $('#r-title').value=r?.title||''; $('#r-year').value=r?.year||'';
  const splits = (r?.splits&&r.splits.length) ? r.splits : [{name:'',pct:''}];
  $('#r-splits').innerHTML = splits.map(s=>splitRowHTML(s.name,s.pct)).join('');
  bindSplitRows(); refreshSplitTotal();
  $('#r-delete').hidden=!r;
  $('#rel-modal').hidden=false;
}
$('#btn-add-release').onclick=()=>openRelease(null);
$('#rel-modal-close').onclick=$('#r-cancel').onclick=()=>$('#rel-modal').hidden=true;
$('#rel-modal').onclick=e=>{ if(e.target.id==='rel-modal') $('#rel-modal').hidden=true; };
$('#r-add-split').onclick=()=>{ $('#r-splits').insertAdjacentHTML('beforeend',splitRowHTML()); bindSplitRows(); refreshSplitTotal(); };
$('#r-delete').onclick=()=>{
  const id=$('#r-id').value;
  DB.releases=releases().filter(r=>r.id!==id); save();
  $('#rel-modal').hidden=true; renderReleases(); renderRoyalties(); toast('Release eliminata');
};
$('#rel-form').onsubmit=e=>{
  e.preventDefault();
  const id=$('#r-id').value;
  const splits=[];
  $$('#r-splits .split-row').forEach(row=>{
    const name=row.querySelector('.split-name').value.trim();
    const pct=+row.querySelector('.split-pct').value||0;
    if(name) splits.push({name,pct});
  });
  const rec={ id:id||uid(), catalog:$('#r-catalog').value.trim(), title:$('#r-title').value.trim(),
    year:Number($('#r-year').value)||'', splits };
  if(!rec.catalog){ toast('Inserisci il catalogo'); return; }
  if(id){ const i=releases().findIndex(r=>r.id===id); DB.releases[i]=rec; }
  else releases().push(rec);
  save(); $('#rel-modal').hidden=true; renderReleases(); renderRoyalties(); toast('Release salvata');
};

/* ============================================================================
   ROYALTY — ripartizione per artista basata sulle quote delle release
   ============================================================================ */
function royaltyPeriod(txs){
  const p=$('#roy-period').value; if(p==='all') return txs;
  const now=new Date(); let from=new Date(0);
  if(p==='ytd') from=new Date(now.getFullYear(),0,1);
  if(p==='12m') from=new Date(now.getFullYear(),now.getMonth()-11,1);
  if(p==='6m') from=new Date(now.getFullYear(),now.getMonth()-5,1);
  if(p==='3m') from=new Date(now.getFullYear(),now.getMonth()-2,1);
  const f=from.toISOString().slice(0,10);
  return txs.filter(t=>t.date>=f);
}
// calcola { artist -> {total, byRelease:{catalog->amount}} } e label total
function computeRoyalties(){
  const txs=royaltyPeriod(DB.transactions.filter(t=>t.kind==='income'));
  const byArtist={}; let labelTotal=0;
  txs.forEach(t=>{
    const eur=toEur(t.net,t.currency);
    const rel=releaseByCatalog(t.catalog);
    if(!rel||!rel.splits||!rel.splits.length){ labelTotal+=eur; return; }
    let assigned=0;
    rel.splits.forEach(s=>{
      const share=eur*(+s.pct||0)/100; assigned+=share;
      const a=(byArtist[s.name] ??= {total:0, byRelease:{}});
      a.total+=share; a.byRelease[rel.catalog]=(a.byRelease[rel.catalog]||0)+share;
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
  tbl.innerHTML=`<thead><tr><th>Artista</th><th class="num">Royalty (€)</th></tr></thead>
    <tbody>${rows.map(r=>`<tr data-artist="${esc(r.name)}" style="cursor:pointer">
      <td>${esc(r.name)}</td><td class="num pos">${fmtMoney(r.total)}</td></tr>`).join('')}
      <tr><td><strong>Label (quota residua)</strong></td><td class="num"><strong>${fmtMoney(labelTotal)}</strong></td></tr>
      ${rows.length?'':'<tr><td colspan="2" class="muted">Nessuna entrata con catalogo collegato a una release.</td></tr>'}</tbody>`;
  $$('#table-roy-artist tbody tr[data-artist]').forEach(tr=>tr.onclick=()=>showRoyaltyDetail(tr.dataset.artist,byArtist[tr.dataset.artist]));
}
let royDetail=null;   // {name, data} dell'artista mostrato
function showRoyaltyDetail(name,data){
  if(!data) return;
  royDetail={name,data};
  $('#roy-detail-title').textContent='Dettaglio — '+name;
  const rows=Object.entries(data.byRelease).map(([cat,amt])=>({cat,amt})).sort((a,b)=>b.amt-a.amt);
  $('#table-roy-detail').innerHTML=`<thead><tr><th>Release</th><th class="num">Royalty (€)</th></tr></thead>
    <tbody>${rows.map(r=>{ const rel=releaseByCatalog(r.cat); const t=rel&&rel.title?` — ${esc(rel.title)}`:'';
      return `<tr><td>${esc(r.cat)}${t}</td><td class="num pos">${fmtMoney(r.amt)}</td></tr>`; }).join('')}
      <tr><td><strong>Totale</strong></td><td class="num pos"><strong>${fmtMoney(data.total)}</strong></td></tr></tbody>`;
  $('#roy-detail-panel').hidden=false;
  $('#roy-detail-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('#roy-detail-close').onclick=()=>$('#roy-detail-panel').hidden=true;
$('#roy-period').onchange=renderRoyalties;
$('#roy-detail-pdf').onclick=()=>{
  if(!royDetail) return;
  const { name, data } = royDetail;
  const period=$('#roy-period').selectedOptions[0].textContent;
  const rows=Object.entries(data.byRelease).map(([cat,amt])=>({cat,amt})).sort((a,b)=>b.amt-a.amt);
  $('#print-area').innerHTML=`<div class="stmt">
    <div class="stmt-head">
      <img src="icon.png" alt="" class="stmt-logo">
      <div><div class="stmt-brand">Label<strong>Finance</strong></div>
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
  $('#tx-modal').hidden=true; renderTx(); toast('Movimento eliminato');
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
  save(); $('#tx-modal').hidden=true; renderTx(); toast('Salvato');
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
  buildMapFields(autoMap(importHeaders));
  renderPreview();
}
$('#map-delim').onchange=refreshParse;
['#map-kind','#map-datefmt','#map-currency','#map-platform'].forEach(s=>$(s).addEventListener('input',renderPreview));

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
  if(map.net==null && map.gross==null){ toast('Mappa almeno Netto o Lordo'); return; }
  let recs=importRows.map(r=>rowToRec(r,map));
  let skipped=0;
  if($('#import-dedup').checked){
    const seen=new Set(DB.transactions.map(txSig));
    recs=recs.filter(r=>{ const s=txSig(r); if(seen.has(s)){ skipped++; return false; } seen.add(s); return true; });
  }
  DB.transactions.push(...recs); save();
  $('#import-config').hidden=true; $('#file-input').value='';
  toast(`${recs.length} importati${skipped?` · ${skipped} doppioni saltati`:''}`); goto('transactions');
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
  const name=$('#map-preset-name').value.trim(); if(!name){ toast('Dai un nome al preset'); return; }
  DB.mappings[name]=snapshotPreset(); save(); populatePresets(); $('#map-preset').value=name; toast('Preset salvato');
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
  if(!c||!v){ toast('Inserisci valuta e tasso'); return; }
  DB.rates[c]=v; save(); $('#rate-cur').value=$('#rate-val').value=''; renderSettings();
};
$('#export-json').onclick=()=>download('label-finance-backup.json',JSON.stringify(DB,null,2),'application/json');
$('#export-csv').onclick=()=>{
  const head=['kind',...CANON.map(c=>c[0]),'note'];
  const lines=[head.join(',')].concat(DB.transactions.map(t=>head.map(h=>csvCell(t[h])).join(',')));
  download('movimenti.csv',lines.join('\n'),'text/csv');
};
$('#import-json').onclick=()=>$('#json-input').click();
$('#json-input').onchange=e=>{
  const f=e.target.files[0]; if(!f) return; const r=new FileReader();
  r.onload=()=>{ try{ const d=JSON.parse(r.result); if(!d.transactions) throw 0;
    DB=Object.assign(defaultData(),d); save(); renderSettings(); toast('Backup ripristinato'); goto('dashboard'); }
    catch{ toast('File non valido'); } };
  r.readAsText(f);
};
$('#wipe').onclick=()=>{ if(confirm('Cancellare TUTTI i dati da questo dispositivo? Operazione irreversibile.')){
  DB=defaultData(); save(); renderSettings(); toast('Dati cancellati'); goto('dashboard'); } };

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

/* ---------- Avvio ---------- */
renderDashboard();
