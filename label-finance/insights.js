/* ============================================================================
   insights.js — l'app che ragiona sui dati
   · Avvisi intelligenti nel centro notifiche (report mancanti, contratti non
     firmati, saldi alti da pagare, periodo da chiudere, cambi BCE non attivi)
   · Conto economico per release (entrate, quota artisti, spese, margine, pari)
   · Checklist automatica di uscita: attività in Task calcolate dalla data release
   Usa le funzioni globali di app.js (DB, save, tt, esc, NOTIFS, …).
   ============================================================================ */

/* ============================================================================
   1. AVVISI INTELLIGENTI
   Ogni avviso: {key, type:'smart', kind, view, params} — il testo si calcola al
   momento (smartText) così segue la lingua scelta.
   ============================================================================ */
const SMART_OWED_MIN=500;          // € dovuti a un artista oltre i quali avvisare
const SMART_SENT_DAYS=14;          // giorni senza firma dopo l'invio del contratto
const monthKeyOf=d=>String(d||'').slice(0,7);
const monthLabel=m=>{ const [y,mo]=m.split('-').map(Number); try{ return new Date(y, mo-1, 1).toLocaleDateString((window.LFI18N&&LFI18N.lang)||'it', { month:'long', year:'numeric' }); }catch(e){ return m; } };
function monthsBetween(a, b){ const out=[]; let [y,m]=a.split('-').map(Number); const [y2,m2]=b.split('-').map(Number);
  while(y<y2 || (y===y2 && m<=m2)){ out.push(y+'-'+String(m).padStart(2,'0')); m++; if(m>12){ m=1; y++; } if(out.length>240) break; } return out; }
/* piattaforme con report regolari a cui manca uno o più mesi (gli ultimi 12, fino a 2 mesi fa) */
function smartMissingReports(){
  const today=new Date(), expected=LFCore.ymd(new Date(today.getFullYear(), today.getMonth()-2, 1)).slice(0,7);
  const oldest=LFCore.ymd(new Date(today.getFullYear(), today.getMonth()-13, 1)).slice(0,7);
  const byPlat={};
  (DB.transactions||[]).forEach(t=>{ if(t.kind!=='income' || !t.platform || t._recur) return; const m=monthKeyOf(t.date); if(!m) return;
    (byPlat[t.platform]||(byPlat[t.platform]=new Set())).add(m); });
  const out=[];
  Object.entries(byPlat).forEach(([plat, set])=>{
    if(set.size<4) return;                                         // non abbastanza regolare per dirlo
    const months=[...set].sort(); const first=months[0];
    const from=first>oldest?first:oldest; if(from>expected) return;
    const missing=monthsBetween(from, expected).filter(m=>!set.has(m));
    if(missing.length && missing.length<=6) out.push({ plat, missing });
  });
  return out;
}
function smartAlerts(){
  const out=[];
  // 1) report mancanti
  smartMissingReports().forEach(r=>out.push({ key:'miss:'+r.plat.toLowerCase()+':'+r.missing.join(','), kind:'missing', view:'import', params:{ plat:r.plat, months:r.missing } }));
  // 2) contratti inviati e non firmati da più di 14 giorni
  const lim=Date.now()-SMART_SENT_DAYS*864e5;
  (DB.contracts||[]).forEach(c=>{ if(c.status!=='sent') return; const at=+c.sentAt||Date.parse(c.date||'')||0; if(!at || at>lim) return;
    out.push({ key:'unsigned:'+c.id, kind:'unsigned', view:'contracts', params:{ who:c.projectName||c.fullName||c.artistNames||'—', title:c.titles||'', days:Math.floor((Date.now()-at)/864e5) } }); });
  // 3) saldi alti da pagare (l'avviso si rinnova quando il saldo cresce di 250 €)
  if(typeof artistBalances==='function') artistBalances().forEach(b=>{ if(b.payable<SMART_OWED_MIN) return;
    out.push({ key:'owed:'+b.key+':'+Math.floor(b.payable/250), kind:'owed', view:'royalties', params:{ name:b.name, amt:b.payable } }); });
  // 4) periodo da chiudere: trimestre finito da più di 15 giorni, con royalty, non ancora chiuso
  if(typeof perState==='function'){
    const t=new Date(); let q=Math.floor(t.getMonth()/3), y=t.getFullYear(); if(q===0){ q=4; y--; }
    const from=`${y}-${String(q*3-2).padStart(2,'0')}-01`, to=LFCore.ymd(new Date(y, q*3, 0));
    const lock=perLockDate(), late=(Date.now()-Date.parse(to+'T00:00:00'))>15*864e5;
    if(late && lock<to && !perOverlap(from,to)){
      const roy=LFCore.computeRoyalties(DB,{ from, to });
      if(Object.keys(roy.byArtist).length) out.push({ key:'close:'+from, kind:'close', view:'royalties', params:{ q:`Q${q} ${y}` } });
    }
  }
  // 5) movimenti in valuta ma cambi automatici BCE spenti
  if(DB.fx && !DB.fx.auto && typeof fxNeeded==='function'){ const c=Object.keys(fxNeeded()); if(c.length) out.push({ key:'fx:'+c.join(','), kind:'fx', view:'settings', params:{ cur:c.join(', ') } }); }
  return out;
}
/* sincronizza gli avvisi intelligenti con il centro notifiche (chiamata da notifScan) */
function smartScan(){
  if(typeof NOTIFS==='undefined') return;
  const now=smartAlerts(), keys=new Set(now.map(a=>a.key));
  const prev={}; NOTIFS.list.forEach(n=>{ if(n.type==='smart') prev[n.key]=n; });
  NOTIFS.list=NOTIFS.list.filter(n=>n.type!=='smart' || keys.has(n.key));        // risolti: spariscono da soli
  now.forEach(a=>{
    if((NOTIFS.dismissed||[]).includes(a.key)) return;
    const p=prev[a.key];
    if(p){ p.params=a.params; return; }
    NOTIFS.list.unshift({ id:newId(), key:a.key, type:'smart', kind:a.kind, view:a.view, params:a.params, read:false, ts:Date.now() });
  });
}
function smartText(n){
  const p=n.params||{};
  switch(n.kind){
    case 'missing': return { title:tt('smart.missing_t').replace('{p}', p.plat),
      body:tt('smart.missing_b').replace('{p}', p.plat).replace('{m}', (p.months||[]).map(monthLabel).join(', ')) };
    case 'unsigned': return { title:tt('smart.unsigned_t'), body:tt('smart.unsigned_b').replace('{who}', p.who).replace('{t}', p.title||'').replace('{d}', p.days) };
    case 'owed': return { title:tt('smart.owed_t').replace('{name}', p.name), body:tt('smart.owed_b').replace('{name}', p.name).replace('{amt}', fmtMoney(p.amt||0)) };
    case 'close': return { title:tt('smart.close_t').replace('{q}', p.q), body:tt('smart.close_b').replace('{q}', p.q) };
    case 'fx': return { title:tt('smart.fx_t'), body:tt('smart.fx_b').replace('{c}', p.cur) };
  }
  return { title:'', body:'' };
}
function smartOpen(n){
  goto(n.view||'dashboard');
  setTimeout(()=>{
    if(n.kind==='fx'){ const el=document.getElementById('fx-auto'); if(el) el.closest('.panel').scrollIntoView({ behavior:'smooth', block:'center' }); }
    if(n.kind==='close'){ const el=document.getElementById('per-panel'); if(el) el.scrollIntoView({ behavior:'smooth', block:'start' }); }
    if(n.kind==='owed'){ const el=document.getElementById('pay-center'); if(el && !el.hidden) el.scrollIntoView({ behavior:'smooth', block:'start' }); }
  }, 80);
}

/* ============================================================================
   2. CONTO ECONOMICO PER RELEASE
   Entrate = vendite collegate alla release; quota artisti = la loro parte secondo
   gli split; spese = uscite collegate (catalogo/UPC/titolo nel movimento).
   Margine etichetta = entrate − quota artisti − spese. Anticipi/recoupment esclusi.
   ============================================================================ */
function releasePL(rel, idx){
  idx=idx||LFCore.relIndex(DB.releases);
  const out={ rel, revenue:0, artists:0, costs:0, months:{}, firstSale:'', lastSale:'' };
  (DB.transactions||[]).forEach(t=>{
    const r=LFCore.releaseForTx(idx, t); if(r!==rel) return;
    const eur=LFCore.txEur(DB, t), m=monthKeyOf(t.date)||'—';
    const mo=out.months[m]||(out.months[m]={ rev:0, art:0, cost:0 });
    if(t.kind==='income'){
      out.revenue+=eur; mo.rev+=eur;
      const sp=LFCore.splitsForTx(idx, t); const pct=sp?(sp.splits||[]).reduce((s,x)=>s+(+x.pct||0),0):0;
      const a=LFCore.cents(eur*pct/100); out.artists+=a; mo.art+=a;   // stesse quote delle royalty (anche se una release supera il 100%)
      if(t.date){ if(!out.firstSale || t.date<out.firstSale) out.firstSale=t.date; if(!out.lastSale || t.date>out.lastSale) out.lastSale=t.date; }
    } else { const c=Math.abs(eur); out.costs+=c; mo.cost+=c; }
  });
  out.margin=out.revenue-out.artists-out.costs;
  // pareggio: primo mese in cui il margine progressivo torna ≥ 0 dopo le spese
  let cum=0, wasNeg=false; out.breakEven='';
  Object.keys(out.months).filter(m=>m!=='—').sort().forEach(m=>{ const mo=out.months[m]; cum+=mo.rev-mo.art-mo.cost;
    if(cum<0) wasNeg=true; else if(wasNeg && !out.breakEven) out.breakEven=m; });
  if(out.costs>0 && out.margin>=0 && !out.breakEven){ const ms=Object.keys(out.months).filter(m=>m!=='—').sort(); out.breakEven=ms[0]||''; }
  // previsione: media del margine degli ultimi 3 mesi con vendite
  const recent=Object.keys(out.months).filter(m=>m!=='—').sort().slice(-3).map(m=>{ const mo=out.months[m]; return mo.rev-mo.art; });
  const avg=recent.length?recent.reduce((s,v)=>s+v,0)/recent.length:0;
  out.monthsToEven=(out.margin<0 && avg>0) ? Math.ceil(-out.margin/avg) : null;
  return out;
}
function plStatus(pl){
  if(!pl.revenue && !pl.costs) return { cls:'mut', txt:tt('pl.no_data') };
  if(pl.margin>=0) return { cls:'ok', txt: pl.costs>0 && pl.breakEven ? tt('pl.even_since').replace('{m}', monthLabel(pl.breakEven)) : tt('pl.positive') };
  return { cls:'bad', txt: pl.monthsToEven ? tt('pl.to_even_eta').replace('{amt}', fmtMoney(-pl.margin)).replace('{n}', pl.monthsToEven) : tt('pl.to_even').replace('{amt}', fmtMoney(-pl.margin)) };
}
function plBoxHTML(pl){
  const st=plStatus(pl);
  return `<div class="pl-box">
    <div class="pl-head"><b>${esc(tt('pl.title'))}</b><span class="ctag ctag-${st.cls}">${esc(st.txt)}</span></div>
    <div class="as-stats pl-stats">
      <div><span class="muted small">${esc(tt('pl.revenue'))}</span><b>${fmtMoney(pl.revenue)}</b></div>
      <div><span class="muted small">${esc(tt('pl.artists'))}</span><b>${fmtMoney(pl.artists)}</b></div>
      <div><span class="muted small">${esc(tt('pl.costs'))}</span><b>${fmtMoney(pl.costs)}</b></div>
      <div><span class="muted small">${esc(tt('pl.margin'))}</span><b class="${pl.margin<0?'neg':'pos'}">${fmtMoney(pl.margin)}</b></div>
    </div>
    <p class="muted small">${esc(tt('pl.hint'))}</p>
  </div>`;
}
let plSort={ col:'margin', dir:-1 };
function renderPLModal(){
  const box=document.getElementById('pl-body'); if(!box) return;
  const idx=LFCore.relIndex(DB.releases);
  const rows=(DB.releases||[]).map(r=>releasePL(r, idx)).filter(p=>p.revenue||p.costs);
  if(!rows.length){ box.innerHTML=`<p class="muted">${esc(tt('pl.none'))}</p>`; return; }
  const key={ release:p=>(p.rel.catalog||'')+' '+(p.rel.title||''), revenue:p=>p.revenue, artists:p=>p.artists, costs:p=>p.costs, margin:p=>p.margin }[plSort.col];
  const list=tieSort(rows, key, plSort.dir, [p=>p.rel.catalog||'', p=>p.rel.title||'']);
  const th=(c,l,num)=>`<th class="th-sort ${num?'num':''}" data-pl-sort="${c}">${esc(l)}${plSort.col===c?(plSort.dir>0?' ▲':' ▼'):''}</th>`;
  const tot=k=>rows.reduce((s,p)=>s+p[k],0);
  box.innerHTML=`<div class="table-wrap"><table class="data-table" id="pl-table"><thead><tr>${th('release',tt('pl.release'))}${th('revenue',tt('pl.revenue'),1)}${th('artists',tt('pl.artists'),1)}${th('costs',tt('pl.costs'),1)}${th('margin',tt('pl.margin'),1)}<th>${esc(tt('pl.status'))}</th></tr></thead><tbody>`
    +list.map(p=>{ const st=plStatus(p); return `<tr><td><span class="lf-link" data-rel-open="${esc(p.rel.id)}"><b>${esc(p.rel.catalog||'')}</b> ${esc(p.rel.title||'')}</span></td>
      <td class="num">${fmtMoney(p.revenue)}</td><td class="num">${fmtMoney(p.artists)}</td><td class="num">${fmtMoney(p.costs)}</td>
      <td class="num ${p.margin<0?'neg':'pos'}"><b>${fmtMoney(p.margin)}</b></td><td><span class="ctag ctag-${st.cls}">${esc(st.txt)}</span></td></tr>`; }).join('')
    +`<tr class="per-tot"><td><b>${esc(tt('pl.total'))}</b></td><td class="num"><b>${fmtMoney(tot('revenue'))}</b></td><td class="num"><b>${fmtMoney(tot('artists'))}</b></td><td class="num"><b>${fmtMoney(tot('costs'))}</b></td><td class="num"><b>${fmtMoney(tot('margin'))}</b></td><td></td></tr></tbody></table></div>`;
}
function openPLModal(){ const m=document.getElementById('pl-modal'); if(!m) return; renderPLModal(); m.hidden=false; }

/* ============================================================================
   3. CHECKLIST AUTOMATICA DI USCITA
   Dalla data di uscita (orderDate) si creano le attività in Task, una per passo,
   con scadenza relativa. Se la data cambia, le attività non fatte si spostano.
   ============================================================================ */
const CK_STEPS=[ [-42,'ck.s_master'], [-35,'ck.s_codes'], [-28,'ck.s_deliver'], [-21,'ck.s_pitch'], [-14,'ck.s_presave'],
  [-7,'ck.s_press'], [0,'ck.s_release'], [7,'ck.s_results'], [30,'ck.s_reports'] ];
function ckTasks(rel){ return (DB.tasks||[]).filter(t=>t.relId===rel.id && t.ckStep!=null); }
function ckTitle(rel, i){ return tt(CK_STEPS[i][1])+' — '+[rel.catalog, rel.title].filter(Boolean).join(' · '); }
/* crea o aggiorna la checklist; restituisce quante attività ha creato.
   create=false: sposta solo le attività rimaste (quelle eliminate dall'utente non tornano);
   skipPast: in automatico non crea passi già scaduti */
function ckSync(rel, create, skipPast){
  if(!rel || !rel.orderDate) return 0;
  DB.tasks=DB.tasks||[];
  const have=ckTasks(rel); let made=0; const today=LFCore.ymd(new Date());
  if(!have.length && !create) return 0;
  CK_STEPS.forEach(([off], i)=>{
    const due=LFCore.addDays(rel.orderDate, off);
    const t=have.find(x=>x.ckStep===i);
    if(t){ if(!t.done){ if(t.due!==due){ t.due=due; delete t.notifiedDue; delete t.notifiedPre; } t.title=ckTitle(rel, i); } return; }
    if(!create || (skipPast && due<today)) return;
    DB.tasks.push({ id:'ck_'+rel.id+'_'+i, title:ckTitle(rel, i), type:'other', due, time:'', remind:i>=2&&i<=6?1440:0, done:false, relId:rel.id, ckStep:i });
    made++;
  });
  if(create){ rel.checklist=true; delete rel.checklistOff; }
  return made;
}
function ckProgress(rel){ const ts=ckTasks(rel); return { done:ts.filter(t=>t.done).length, total:ts.length, next:ts.filter(t=>!t.done).sort((a,b)=>String(a.due).localeCompare(String(b.due)))[0]||null }; }
function ckBoxHTML(rel){
  const p=ckProgress(rel);
  if(!p.total) return `<div class="ck-box"><div class="pl-head"><b>${esc(tt('ck.title'))}</b></div>
    <p class="muted small">${esc(rel.orderDate?tt('ck.hint'):tt('ck.need_date'))}</p>
    ${rel.orderDate?`<button class="btn btn-sm" type="button" data-ck-create="${esc(rel.id)}">${esc(tt('ck.create'))}</button>`:''}</div>`;
  return `<div class="ck-box"><div class="pl-head"><b>${esc(tt('ck.title'))}</b><span class="ctag ctag-${p.done===p.total?'ok':'info'}">${esc(tt('ck.progress').replace('{d}',p.done).replace('{n}',p.total))}</span></div>
    ${p.next?`<p class="small">${esc(tt('ck.next'))}: <b>${esc(tt(CK_STEPS[p.next.ckStep][1]))}</b> · ${esc(fmtDate(p.next.due))}</p>`:`<p class="small pos">${esc(tt('ck.all_done'))}</p>`}
    <button class="btn btn-sm" type="button" data-goto="tasks">${esc(tt('ck.open_tasks'))}</button></div>`;
}
/* dopo il salvataggio di una release: checklist automatica se l'uscita è futura */
function ckAfterSave(rel){
  if(!rel || !rel.orderDate) return 0;
  const today=LFCore.ymd(new Date());
  if(ckTasks(rel).length){ ckSync(rel, false); return 0; }
  if(rel.checklist){ rel.checklistOff=true; return 0; }   // creata in passato e poi tolta dall'utente: non si ricrea da sola
  if(rel.orderDate>=today && !rel.checklistOff) return ckSync(rel, true, true);
  return 0;
}

/* ---------- riquadro extra nel modulo release (conto economico + checklist) ---------- */
function renderRelExtra(rel){
  const box=document.getElementById('rel-extra'); if(!box) return;
  if(!rel){ box.hidden=true; box.innerHTML=''; return; }
  box.innerHTML=plBoxHTML(releasePL(rel))+ckBoxHTML(rel);
  box.hidden=false;
}

/* ---------- collegamenti ---------- */
document.addEventListener('click', e=>{
  const c=e.target.closest('[data-ck-create]'); if(c){
    const rel=(DB.releases||[]).find(r=>r.id===c.dataset.ckCreate); if(!rel) return;
    const n=ckSync(rel, true); save(); renderRelExtra(rel); if(typeof renderTasks==='function') renderTasks();
    toast(tt('ck.created').replace('{n}', n)); return; }
  const s=e.target.closest('[data-pl-sort]'); if(s){ const k=s.dataset.plSort; if(plSort.col===k) plSort.dir*=-1; else plSort={ col:k, dir:k==='release'?1:-1 }; renderPLModal(); }
});
(function wireInsights(){
  const on=(id,ev,fn)=>{ const el=document.getElementById(id); if(el) el.addEventListener(ev,fn); };
  on('rel-pl-btn','click',openPLModal);
  on('pl-close','click',()=>{ document.getElementById('pl-modal').hidden=true; });
  on('pl-modal','click',e=>{ if(e.target.id==='pl-modal') e.currentTarget.hidden=true; });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ const m=document.getElementById('pl-modal'); if(m) m.hidden=true; } });
  // il link a una release dalla tabella del conto economico chiude la finestra
  document.addEventListener('click',e=>{ if(e.target.closest('#pl-modal [data-rel-open]')){ const m=document.getElementById('pl-modal'); if(m) m.hidden=true; } }, true);
})();
