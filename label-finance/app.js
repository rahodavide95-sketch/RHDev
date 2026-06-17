/* ============================================================================
   Label Finance — MVP gestionale entrate/uscite per etichette
   100% client-side. I dati restano nel browser (localStorage).
   Schema canonico movimento:
   { id, kind:'income'|'expense', date(ISO), platform, type, catalog,
     product, artist, code, qty, gross, fees, net, currency, note }
   ============================================================================ */
'use strict';

const STORE_KEY = 'labelfinance.v1';
const CANON = [
  ['date','Data'], ['platform','Piattaforma'], ['type','Tipologia'],
  ['catalog','Catalogo'], ['product','Prodotto/Titolo'], ['artist','Artista'],
  ['code','ISRC/UPC'], ['qty','Quantità'], ['gross','Lordo'],
  ['fees','Commissioni'], ['net','Netto'], ['currency','Valuta'],
];

/* ---------- Store ---------- */
const defaultData = () => ({
  transactions: [],
  rates: { EUR:1, USD:0.92, GBP:1.17, CHF:1.04 },
  mappings: {},
});
let DB = load();
function load(){
  try { const r = JSON.parse(localStorage.getItem(STORE_KEY)); return r && r.transactions ? r : defaultData(); }
  catch { return defaultData(); }
}
function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }

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
  code:['isrc','upc','ean','barcode','code'],
  qty:['qty','quantity','quantità','units','copies','count'],
  gross:['gross','lordo','amount','sale','price','revenue','subtotal'],
  fees:['fee','fees','commission','commissioni','charge'],
  net:['net','netto','payout','net amount','net revenue','earnings','royalt'],
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
function goto(view){
  $$('.nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('is-active',v.id==='view-'+view));
  if(view==='dashboard') renderDashboard();
  if(view==='transactions') renderTx();
  if(view==='settings') renderSettings();
}
$$('.nav-item').forEach(b=>b.onclick=()=>goto(b.dataset.view));
document.addEventListener('click',e=>{ const g=e.target.closest('[data-goto]'); if(g) goto(g.dataset.goto); });

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

  // by release
  groupTable('#table-release','catalog','Catalogo',txs);
  // by platform
  groupTable('#table-platform','platform','Piattaforma',txs);
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

/* ============================================================================
   MOVIMENTI
   ============================================================================ */
function renderTx(){
  const platSel=$('#tx-filter-platform');
  const plats=[...new Set(DB.transactions.map(t=>t.platform).filter(Boolean))].sort();
  platSel.innerHTML='<option value="">Tutte le piattaforme</option>'+plats.map(p=>`<option>${esc(p)}</option>`).join('');
  applyTxFilters();
}
function applyTxFilters(){
  const q=$('#tx-search').value.toLowerCase().trim();
  const kind=$('#tx-filter-kind').value, plat=$('#tx-filter-platform').value;
  let rows=DB.transactions.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(kind) rows=rows.filter(t=>t.kind===kind);
  if(plat) rows=rows.filter(t=>t.platform===plat);
  if(q) rows=rows.filter(t=>[t.product,t.artist,t.catalog,t.platform,t.code,t.note].join(' ').toLowerCase().includes(q));
  $('#tx-count-label').textContent=`${rows.length} movimenti`;
  $('#table-tx').innerHTML=`<thead><tr>
     <th>Data</th><th></th><th>Piattaforma</th><th>Catalogo</th><th>Prodotto</th><th>Artista</th>
     <th class="num">Q.tà</th><th class="num">Netto</th><th class="num">€</th></tr></thead>
   <tbody>${rows.map(t=>`<tr data-id="${t.id}">
     <td>${esc(t.date)}</td>
     <td><span class="pill ${t.kind==='income'?'pill--in':'pill--out'}">${t.kind==='income'?'IN':'OUT'}</span></td>
     <td>${esc(t.platform)}</td><td>${esc(t.catalog)}</td><td>${esc(t.product)}</td><td>${esc(t.artist)}</td>
     <td class="num">${t.qty||''}</td>
     <td class="num">${fmtMoney(t.net,t.currency||'EUR')}</td>
     <td class="num ${t.kind==='income'?'pos':'neg'}">${fmtMoney((t.kind==='income'?1:-1)*toEur(t.net,t.currency))}</td>
   </tr>`).join('')||'<tr><td colspan="9" class="muted">Nessun movimento.</td></tr>'}</tbody>`;
  $$('#table-tx tbody tr[data-id]').forEach(tr=>tr.onclick=()=>openTx(tr.dataset.id));
}
['#tx-search','#tx-filter-kind','#tx-filter-platform'].forEach(s=>{
  $(s).addEventListener('input',applyTxFilters); $(s).addEventListener('change',applyTxFilters);
});

/* ---------- Modal movimento ---------- */
function openTx(id){
  const t = id ? DB.transactions.find(x=>x.id===id) : null;
  $('#tx-modal-title').textContent = t ? 'Modifica movimento' : (curKind==='expense'?'Nuova uscita':'Nuova entrata');
  const k = t ? t.kind : curKind;
  $('#f-id').value=t?.id||''; $('#f-kind').value=k;
  $('#f-date').value=t?.date||new Date().toISOString().slice(0,10);
  $('#f-platform').value=t?.platform||''; $('#f-type').value=t?.type||(k==='expense'?'expense':'digital');
  $('#f-catalog').value=t?.catalog||''; $('#f-product').value=t?.product||'';
  $('#f-artist').value=t?.artist||''; $('#f-code').value=t?.code||'';
  $('#f-qty').value=t?.qty??1; $('#f-gross').value=t?.gross??''; $('#f-fees').value=t?.fees??'';
  $('#f-net').value=t?.net??''; $('#f-currency').value=t?.currency||'EUR'; $('#f-note').value=t?.note||'';
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
    id:id||uid(), kind:$('#f-kind').value, date:$('#f-date').value,
    platform:$('#f-platform').value.trim(), type:$('#f-type').value,
    catalog:$('#f-catalog').value.trim(), product:$('#f-product').value.trim(),
    artist:$('#f-artist').value.trim(), code:$('#f-code').value.trim(),
    qty:Number($('#f-qty').value)||0, gross:parseAmount($('#f-gross').value),
    fees:parseAmount($('#f-fees').value), net:parseAmount($('#f-net').value),
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
    id:uid(), kind, date:parseDate(get('date'),fmt),
    platform:(get('platform')||$('#map-platform').value).trim(),
    type:get('type').trim()||(kind==='expense'?'expense':'digital'),
    catalog:get('catalog').trim(), product:get('product').trim(), artist:get('artist').trim(),
    code:get('code').trim(), qty:Number(parseAmount(get('qty')))||(map.qty!=null?0:1),
    gross, fees, net, currency:(get('currency')||defCur).toUpperCase().slice(0,3), note:'',
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
$('#import-confirm').onclick=()=>{
  const map=currentMap();
  if(map.net==null && map.gross==null){ toast('Mappa almeno Netto o Lordo'); return; }
  const recs=importRows.map(r=>rowToRec(r,map));
  DB.transactions.push(...recs); save();
  $('#import-config').hidden=true; $('#file-input').value='';
  toast(`${recs.length} movimenti importati`); goto('transactions');
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

/* ---------- Avvio ---------- */
renderDashboard();
