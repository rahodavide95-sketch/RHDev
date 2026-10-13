/* ============================================================================
   safety.js — rete di sicurezza contro le cancellazioni sbagliate
   · Cestino: tutto ciò che elimini resta 30 giorni ed è recuperabile, anche
     subito dal pulsante "Annulla" che compare dopo l'eliminazione.
   · Versioni sul dispositivo: una copia completa ogni 6 ore e prima delle
     operazioni pericolose (cancella tutto, ripristino backup o versione).
   · Versioni nel cloud (con account): il database salva la versione precedente
     a ogni modifica, al massimo una all'ora, per 30 giorni (supabase/schema.sql).
   Usa le funzioni globali di app.js (DB, ACCOUNT, save, tt, esc, …).
   ============================================================================ */

/* ---------------- Cestino ---------------- */
const TRASH_DAYS=30, TRASH_MAX_ITEMS=5000;
// sezione → array dei dati, nome leggibile di un elemento, funzione di ridisegno
const TRASH_KINDS={
  transactions:{ arr:'transactions', name:t=>[t.product||t.platform||'', t.date?fmtDate(t.date):''].filter(Boolean).join(' · ') },
  releases:{ arr:'releases', name:r=>[r.catalog, r.title].filter(Boolean).join(' · ') },
  artists:{ arr:'artists', name:a=>a.name||'' },
  contracts:{ arr:'contracts', name:c=>[c.titles, c.projectName||c.fullName].filter(Boolean).join(' · ') },
  merch:{ arr:'merch', name:m=>m.name||'' },
  tasks:{ arr:'tasks', name:t=>t.title||'' },
  planning:{ arr:'planning', name:p=>p.title||'' },
  events:{ arr:'events', name:e=>e.title||'' },
  supports:{ arr:'supports', name:s=>[s.dj, s.track].filter(Boolean).join(' · ') },
  payouts:{ arr:'payouts', name:p=>[p.artist, fmtMoney(p.amount||0)].filter(Boolean).join(' · ') },
  recoup:{ arr:'recoup', name:r=>[r.artist, fmtMoney(r.amount||0)].filter(Boolean).join(' · ') },
};
function trashList(){ return Array.isArray(DB.trash)?DB.trash:(DB.trash=[]); }
function trashCount(){ return trashList().length; }
function trashPrune(){
  const list=trashList(), limit=Date.now()-TRASH_DAYS*864e5;
  let keep=list.filter(e=>e && Date.parse(e.at)>limit);
  let n=0; keep=keep.filter(e=>{ n+=(e.items||[]).length; return n<=TRASH_MAX_ITEMS || e===keep[0]; });
  if(keep.length!==list.length) DB.trash=keep;
}
/* mette nel cestino gli elementi (copie) e restituisce l'id della voce */
function trashPut(kind, items, label){
  items=(items||[]).filter(Boolean); if(!items.length || !TRASH_KINDS[kind]) return null;
  const k=TRASH_KINDS[kind];
  const entry={ id:'tr_'+newId(), kind, at:new Date().toISOString(),
    label: label || (items.length===1 ? (k.name(items[0])||'') : ''),
    items: JSON.parse(JSON.stringify(items)) };
  trashList().unshift(entry); trashPrune();
  return entry.id;
}
function trashRestore(id, quiet){
  const list=trashList(), e=list.find(x=>x.id===id); if(!e) return false;
  const k=TRASH_KINDS[e.kind]; if(!k) return false;
  const arr=Array.isArray(DB[k.arr])?DB[k.arr]:(DB[k.arr]=[]);
  const have=new Set(arr.map(x=>x&&x.id));
  e.items.forEach(it=>{
    if(!it || have.has(it.id)) return;
    const copy=JSON.parse(JSON.stringify(it));
    // contratto: il link di firma è stato cancellato insieme al contratto
    if(e.kind==='contracts'){ delete copy.token; if(copy.status==='sent'||copy.status==='rejected') copy.status='draft'; }
    if(Array.isArray(copy._linkedTasks)){ DB.tasks=DB.tasks||[]; const th=new Set(DB.tasks.map(t=>t&&t.id));
      copy._linkedTasks.forEach(t=>{ if(t && !th.has(t.id)) DB.tasks.push(t); }); }
    delete copy._linkedTasks;
    arr.push(copy);
  });
  DB.trash=list.filter(x=>x.id!==id);
  save(); if(typeof reloadViews==='function') reloadViews();
  if(!quiet) toast(tt('trash.restored'));
  renderTrashCount();
  return true;
}
function trashDeleteForever(id){ DB.trash=trashList().filter(x=>x.id!==id); save(); renderTrashCount(); }
function trashEmpty(){ if(!trashCount()) return; if(!confirm(tt('trash.empty_q'))) return; DB.trash=[]; save(); renderTrashCount(); renderTrashModal(); }

/* messaggio con "Annulla" subito dopo un'eliminazione */
function undoToast(msg, trashId){
  let t=document.getElementById('undo-toast');
  if(!t){ t=document.createElement('div'); t.id='undo-toast'; t.className='toast toast--undo'; t.setAttribute('role','status');
    t.innerHTML='<span class="ut-msg"></span><button type="button" class="ut-btn"></button>'; document.body.appendChild(t); }
  t.querySelector('.ut-msg').textContent=msg;
  const b=t.querySelector('.ut-btn'); b.textContent=tt('trash.undo');
  b.onclick=()=>{ t.hidden=true; if(trashId) trashRestore(trashId); };
  b.hidden=!trashId;
  const plain=document.getElementById('toast'); if(plain) plain.hidden=true;
  t.hidden=false; clearTimeout(t._t); t._t=setTimeout(()=>{ t.hidden=true; }, 7000);
}
/* elimina dagli array gli elementi indicati passando dal cestino; restituisce l'id della voce */
// attività create in automatico che vanno via (e tornano) insieme all'elemento:
// checklist di uscita della release, promemoria F24 del pagamento (se non ancora fatto)
const LINKED_TASKS={ releases: it=>t=>t && t.relId===it.id && t.ckStep!=null, payouts: it=>t=>t && t.autoKey==='f24:'+it.id && !t.done };
function trashRemove(kind, ids, label){
  const k=TRASH_KINDS[kind]; if(!k) return null; const set=new Set(ids);
  const arr=DB[k.arr]||[]; const gone=arr.filter(x=>x&&set.has(x.id));
  if(LINKED_TASKS[kind]) gone.forEach(it=>{ const pred=LINKED_TASKS[kind](it), lt=(DB.tasks||[]).filter(pred);
    if(lt.length){ it._linkedTasks=lt; DB.tasks=DB.tasks.filter(t=>!pred(t)); } });
  const tid=trashPut(kind, gone, label);
  DB[k.arr]=arr.filter(x=>!(x&&set.has(x.id)));
  return tid;
}

/* ---------------- Versioni sul dispositivo ---------------- */
const SNAP_KEY='snaps', SNAP_MAX=10, SNAP_EVERY=6*3600e3, SNAP_TS='labelfinance.snapTs';
function accountItems(a){ return ((a&&a.labels)||[]).reduce((n,l)=>n+(l.transactions||[]).length+(l.releases||[]).length+(l.artists||[]).length+(l.contracts||[]).length,0); }
async function snapList(){ try{ const l=await window.LFStore.get(SNAP_KEY); return Array.isArray(l)?l:[]; }catch(e){ return []; } }
async function snapTake(reason){
  try{
    const json=JSON.stringify(ACCOUNT); const list=await snapList();
    if(list[0] && list[0].json===json) return;                    // niente doppioni identici
    if(!accountItems(ACCOUNT) && reason==='auto') return;          // account vuoto: nulla da proteggere
    list.unshift({ id:'s'+Date.now(), ts:Date.now(), reason:reason||'auto', items:accountItems(ACCOUNT), json });
    while(list.length>SNAP_MAX) list.pop();
    await window.LFStore.set(SNAP_KEY, list);
    try{ localStorage.setItem(SNAP_TS, String(Date.now())); }catch(e){}
  }catch(e){}
}
// chiamata da save(): una copia ogni 6 ore al massimo, senza rallentare
function safetyOnSave(){
  let last=0; try{ last=+(localStorage.getItem(SNAP_TS)||0); }catch(e){}
  if(Date.now()-last>SNAP_EVERY){ try{ localStorage.setItem(SNAP_TS, String(Date.now())); }catch(e){} setTimeout(()=>snapTake('auto'), 1500); }
  renderTrashCount();
}
async function restoreAccountJson(json, msgKey){
  await snapTake('before_restore');
  if(window.LF_snapshotNow) try{ await window.LF_snapshotNow(); }catch(e){}
  ACCOUNT=migrateAccount(typeof json==='string'?JSON.parse(json):json); DB=activeLabel();
  save(); if(typeof reloadViews==='function') reloadViews(); if(typeof rebuildAccountMenu==='function') rebuildAccountMenu();
  toast(tt(msgKey||'ver.restored'));
}

/* ---------------- Interfaccia: cestino ---------------- */
function renderTrashCount(){ const b=document.getElementById('trash-open'); if(!b) return;
  const n=trashCount(); const c=b.querySelector('.trash-n'); if(c){ c.textContent=n?String(n):''; c.hidden=!n; } }
const fmtDT=iso=>{ try{ const d=new Date(iso); return fmtDate(LFCore.ymd(d))+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch(e){ return iso||''; } };
function renderTrashModal(){
  const body=document.getElementById('trash-body'); if(!body) return;
  trashPrune();
  const list=trashList();
  if(!list.length){ body.innerHTML=`<p class="muted">${esc(tt('trash.none'))}</p>`; return; }
  body.innerHTML=`<ul class="trash-list">`+list.map(e=>{
    const n=(e.items||[]).length, days=Math.max(0, TRASH_DAYS-Math.floor((Date.now()-Date.parse(e.at))/864e5));
    const what=tt('trash.k_'+e.kind)+(n>1?` · ${n} ${tt('trash.items')}`:'');
    return `<li class="trash-item">
      <div class="trash-main"><b>${esc(e.label||what)}</b>
        <span class="muted small">${esc(e.label?what:'')}${e.label?' · ':''}${esc(fmtDT(e.at))} · ${esc(tt('trash.days_left').replace('{n}',days))}</span></div>
      <div class="trash-acts"><button class="btn btn-sm" data-trash-restore="${esc(e.id)}">${esc(tt('trash.restore'))}</button>
        <button class="icon-btn-sm" data-trash-del="${esc(e.id)}" title="${esc(tt('trash.delete_forever'))}" aria-label="${esc(tt('trash.delete_forever'))}">✕</button></div>
    </li>`; }).join('')+`</ul>`;
}
function openTrash(){ const m=document.getElementById('trash-modal'); if(!m) return; renderTrashModal(); m.hidden=false; }

/* ---------------- Interfaccia: versioni ---------------- */
async function renderVersionsModal(){
  const loc=document.getElementById('ver-local'), cl=document.getElementById('ver-cloud'); if(!loc||!cl) return;
  const snaps=await snapList();
  loc.innerHTML = snaps.length ? `<ul class="trash-list">`+snaps.map(s=>`<li class="trash-item">
      <div class="trash-main"><b>${esc(fmtDT(new Date(s.ts).toISOString()))}</b>
        <span class="muted small">${esc(tt('ver.r_'+(s.reason||'auto')))} · ${esc(tt('ver.items').replace('{n}', s.items||0))}</span></div>
      <div class="trash-acts"><button class="btn btn-sm" data-ver-local="${esc(s.id)}">${esc(tt('ver.restore'))}</button></div></li>`).join('')+`</ul>`
    : `<p class="muted small">${esc(tt('ver.local_none'))}</p>`;
  if(!window.LF_listVersions){ cl.innerHTML=`<p class="muted small">${esc(tt('ver.cloud_login'))}</p>`; return; }
  cl.innerHTML=`<p class="muted small">${esc(tt('ver.loading'))}</p>`;
  const res=await window.LF_listVersions();
  if(!res){ cl.innerHTML=`<p class="muted small">${esc(tt('ver.cloud_login'))}</p>`; return; }
  if(res.error){ cl.innerHTML=`<p class="muted small">${esc(tt('ver.cloud_unavailable'))}</p>`; return; }
  cl.innerHTML = res.length ? `<ul class="trash-list">`+res.map(v=>`<li class="trash-item">
      <div class="trash-main"><b>${esc(fmtDT(v.created_at))}</b><span class="muted small">${esc(tt('ver.cloud_hint'))}</span></div>
      <div class="trash-acts"><button class="btn btn-sm" data-ver-cloud="${esc(String(v.id))}">${esc(tt('ver.restore'))}</button></div></li>`).join('')+`</ul>`
    : `<p class="muted small">${esc(tt('ver.cloud_none'))}</p>`;
}
function openVersions(){ const m=document.getElementById('ver-modal'); if(!m) return; m.hidden=false; renderVersionsModal(); }

/* ---------------- Collegamenti ---------------- */
document.addEventListener('click', async e=>{
  const r=e.target.closest('[data-trash-restore]'); if(r){ trashRestore(r.dataset.trashRestore); renderTrashModal(); return; }
  const d=e.target.closest('[data-trash-del]'); if(d){ if(confirm(tt('trash.delete_forever_q'))){ trashDeleteForever(d.dataset.trashDel); renderTrashModal(); } return; }
  const vl=e.target.closest('[data-ver-local]'); if(vl){
    if(!confirm(tt('ver.restore_q'))) return;
    const s=(await snapList()).find(x=>x.id===vl.dataset.verLocal); if(s){ await restoreAccountJson(s.json); document.getElementById('ver-modal').hidden=true; }
    return; }
  const vc=e.target.closest('[data-ver-cloud]'); if(vc){
    if(!confirm(tt('ver.restore_q'))) return;
    const data=window.LF_getVersion ? await window.LF_getVersion(vc.dataset.verCloud) : null;
    if(!data || data.error){ toast(tt('ver.cloud_unavailable')); return; }
    await restoreAccountJson(data); document.getElementById('ver-modal').hidden=true;
    return; }
});
(function wireSafety(){
  const on=(id,ev,fn)=>{ const el=document.getElementById(id); if(el) el.addEventListener(ev,fn); };
  on('trash-open','click',openTrash);
  on('ver-open','click',openVersions);
  on('trash-empty','click',trashEmpty);
  ['trash','ver'].forEach(p=>{
    on(p+'-close','click',()=>{ document.getElementById(p+'-modal').hidden=true; });
    on(p+'-modal','click',e=>{ if(e.target.id===p+'-modal') e.currentTarget.hidden=true; });
  });
  document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; ['trash-modal','ver-modal'].forEach(id=>{ const m=document.getElementById(id); if(m) m.hidden=true; }); });
  renderTrashCount();
})();
