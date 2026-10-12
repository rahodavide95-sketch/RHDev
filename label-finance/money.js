/* ============================================================================
   money.js — soldi e documenti
   · Cambi automatici BCE (media mensile per valuta, da api.frankfurter.app)
   · Chiusura del periodo e statement a tutti gli artisti con un clic
   · Ritenuta d'acconto e ricevuta di pagamento per l'artista
   Usa le funzioni globali di app.js (DB, save, tt, esc, toast, fmtMoney, …).
   ============================================================================ */

/* ============================================================================
   1. CAMBI AUTOMATICI BCE
   I dati BCE arrivano da Frankfurter (servizio gratuito, senza chiave, che
   ripubblica i cambi di riferimento della Banca Centrale Europea). Si salva la
   media di ogni mese: core.js (rateFor) la usa per ogni movimento in valuta.
   ============================================================================ */
const FX_API='https://api.frankfurter.app', FX_STALE=2*864e5;
let fxBusy=false;
function fxState(){ return DB.fx || (DB.fx={ auto:false, months:{}, updatedAt:null }); }
// valute diverse dall'euro presenti nei movimenti, con la data più vecchia di ciascuna
function fxNeeded(){
  const out={};
  (DB.transactions||[]).forEach(t=>{ const c=String(t.currency||'').toUpperCase().trim(); if(!c||c==='EUR'||!/^[A-Z]{3}$/.test(c)) return;
    const d=(t.date||'').slice(0,10); if(!out[c] || (d && d<out[c])) out[c]=d||out[c]||''; });
  return out;
}
const fxPrevMonth=m=>{ const [y,mo]=m.split('-').map(Number); const d=new Date(y, mo-2, 1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); };
async function fxFetchJson(url){
  const ctl=typeof AbortController!=='undefined'?new AbortController():null; const tm=setTimeout(()=>ctl&&ctl.abort(), 15000);
  try{ const r=await fetch(url, ctl?{signal:ctl.signal}:{}); if(!r.ok) return null; return await r.json(); }
  catch(e){ return null; } finally{ clearTimeout(tm); }
}
/* scarica i cambi che mancano (o tutti, con force); restituisce {ok, cur:[…], failed:[…]} */
async function fxRefresh(opt){
  opt=opt||{};
  if(fxBusy) return { ok:false, busy:true };
  const st=fxState(), need=fxNeeded(), curs=Object.keys(need).sort();
  if(!curs.length){ st.updatedAt=new Date().toISOString(); st.failed=[]; if(!opt.quiet) save(); renderFx(); return { ok:true, cur:[], failed:[] }; }
  fxBusy=true; renderFx();
  const today=LFCore.ymd(new Date()), failed=[], done=[];
  try{
    for(const cur of curs){
      const have=(st.months&&st.months[cur])||{};
      const months=Object.keys(have).sort();
      // dal mese più vecchio che serve; se ci sono già dati, solo dall'ultimo mese salvato (ricalcolato)
      let from=(need[cur]||'').slice(0,10) || LFCore.addMonths(today,-24);
      if(from<'1999-01-04') from='1999-01-04';
      if(!opt.force && months.length && months[0]<=from.slice(0,7)) from=fxPrevMonth(months[months.length-1])+'-01';
      const j=await fxFetchJson(`${FX_API}/${from}..${today}?from=${encodeURIComponent(cur)}&to=EUR`);
      if(!j || !j.rates){ failed.push(cur); continue; }
      const m=LFCore.monthlyAverages(j.rates,'EUR');
      if(!Object.keys(m).length){ failed.push(cur); continue; }
      st.months=st.months||{}; st.months[cur]=Object.assign({}, have, m); done.push(cur);
    }
    if(done.length || !failed.length) st.updatedAt=new Date().toISOString();
    st.failed=failed;
    save();
  } finally { fxBusy=false; }
  renderFx();
  if(typeof reloadViews==='function' && done.length) reloadViews();
  return { ok:!failed.length, cur:done, failed };
}
// all'avvio e dopo un import: se i cambi automatici sono attivi e i dati sono vecchi o mancano valute
function fxMaybeRefresh(){
  const st=fxState(); if(!st.auto || fxBusy || (typeof navigator!=='undefined' && navigator.onLine===false)) return;
  const need=Object.keys(fxNeeded()), missing=need.some(c=>!(st.months&&st.months[c]) && !(st.failed||[]).includes(c));
  const stale=!st.updatedAt || (Date.now()-Date.parse(st.updatedAt))>FX_STALE;
  if(need.length && (missing || stale)) fxRefresh({ quiet:true });
}
function renderFx(){
  const cb=document.getElementById('fx-auto'); if(!cb) return;
  const st=fxState(); cb.checked=!!st.auto;
  const box=document.getElementById('fx-box'); if(box) box.hidden=!st.auto;
  const hint=document.getElementById('fx-rates-hint'); if(hint) hint.textContent=tt(st.auto?'fx.manual_fallback':'set.rates_hint');
  const info=document.getElementById('fx-info'), btn=document.getElementById('fx-refresh');
  if(btn){ btn.disabled=fxBusy; btn.textContent=tt(fxBusy?'fx.loading':'fx.refresh'); }
  const curs=Object.keys(st.months||{}).sort();
  if(info){
    const parts=[];
    if(st.updatedAt) parts.push(tt('fx.updated').replace('{d}', fmtDate(st.updatedAt.slice(0,10))));
    if(curs.length) parts.push(curs.join(', '));
    if((st.failed||[]).length) parts.push(tt('fx.failed').replace('{c}', st.failed.join(', ')));
    if(!Object.keys(fxNeeded()).length) parts.push(tt('fx.none_needed'));
    info.textContent=parts.join(' · ');
  }
  const tb=document.getElementById('fx-table');
  if(tb){
    if(!curs.length){ tb.innerHTML=`<p class="muted small">${esc(tt('fx.no_data'))}</p>`; return; }
    const months=[...new Set(curs.flatMap(c=>Object.keys(st.months[c])))].sort().reverse().slice(0,24);
    tb.innerHTML=`<div class="table-wrap"><table class="data-table fx-tbl"><thead><tr><th>${esc(tt('fx.month'))}</th>${curs.map(c=>`<th class="num">${esc(c)} → EUR</th>`).join('')}</tr></thead><tbody>`
      +months.map(m=>`<tr><td>${esc(m.slice(5)+'/'+m.slice(0,4))}</td>${curs.map(c=>{ const v=st.months[c][m]; return `<td class="num">${v!=null?Number(v).toFixed(4):'—'}</td>`; }).join('')}</tr>`).join('')
      +`</tbody></table></div>`;
  }
}
(function wireFx(){
  const cb=document.getElementById('fx-auto');
  if(cb) cb.addEventListener('change',()=>{ const st=fxState(); st.auto=cb.checked; save(); renderFx();
    if(typeof reloadViews==='function') reloadViews();
    if(st.auto) fxRefresh().then(r=>{ if(r && r.cur && r.cur.length) toast(tt('fx.done')); else if(r && r.failed && r.failed.length) toast(tt('fx.offline')); }); });
  const b=document.getElementById('fx-refresh');
  if(b) b.addEventListener('click',()=>fxRefresh({ force:true }).then(r=>toast(tt(r&&r.ok?'fx.done':'fx.offline'))));
  // all'avvio (dopo il caricamento dei dati salvati) e quando la scheda torna visibile
  const go=()=>{ try{ renderFx(); fxMaybeRefresh(); }catch(e){} };
  if(typeof lfReady!=='undefined' && lfReady && lfReady.then) lfReady.then(()=>setTimeout(go, 1500)); else setTimeout(go, 1500);
  window.addEventListener('online', go);
})();

/* ============================================================================
   2. CHIUSURA DEL PERIODO E STATEMENT A TUTTI
   · DB.periods.closed = [{id, from, to, closedAt, artists:{chiave:{name,total,netPay,balance}}}]
   · dopo la chiusura, le vendite con data nel periodo chiuso importate più tardi
     prendono t.acct = primo giorno aperto (core.js: acctDate) → prossimo statement
   · modificare/eliminare una vendita di un periodo chiuso chiede conferma
   ============================================================================ */
function perState(){ const p=DB.periods||(DB.periods={}); p.closed=p.closed||[]; return p; }
function perLockDate(){ return perState().closed.reduce((m,c)=>(c.to>m?c.to:m), ''); }
function perIsClosedTx(t){ const lock=perLockDate(); return !!(lock && t && t.kind==='income' && LFCore.acctDate(t)<=lock); }
/* righe nuove con data in un periodo chiuso → nel primo giorno aperto; restituisce quante */
function markLateLines(recs){
  const lock=perLockDate(); if(!lock) return 0;
  const next=LFCore.addDays(lock,1); let n=0;
  (recs||[]).forEach(r=>{ if(r && r.kind==='income' && r.date && r.date<=lock && !r.acct){ r.acct=next; n++; } });
  return n;
}
// trimestri/semestri/anni come intervalli di date
const qStart=(y,q)=>`${y}-${String(q*3-2).padStart(2,'0')}-01`;
const monthEnd=(y,m)=>LFCore.ymd(new Date(y, m, 0));
function perOptions(){
  const today=new Date(), y=today.getFullYear(), q=Math.floor(today.getMonth()/3)+1, out=[];
  const lock=perLockDate();
  if(lock){   // il periodo subito dopo l'ultimo chiuso, fino alla fine del suo trimestre
    const f=LFCore.addDays(lock,1), fd=LFCore.parseYmd(f), fq=Math.floor(fd.getMonth()/3)+1;
    out.push({ v:f+'|'+monthEnd(fd.getFullYear(), fq*3), l:tt('per.next')+' · '+fmtDate(f)+' – '+fmtDate(monthEnd(fd.getFullYear(), fq*3)) });
  }
  for(let i=1;i<=6;i++){ let qq=q-i, yy=y; while(qq<1){ qq+=4; yy--; } out.push({ v:qStart(yy,qq)+'|'+monthEnd(yy,qq*3), l:`Q${qq} ${yy}` }); }
  const h=today.getMonth()<6?1:2;
  for(let i=1;i<=3;i++){ let hh=h-i, yy=y; while(hh<1){ hh+=2; yy--; } out.push({ v:`${yy}-${hh===1?'01':'07'}-01|`+monthEnd(yy, hh*6), l:`${tt('per.semester')} ${hh} ${yy}` }); }
  for(let i=1;i<=2;i++) out.push({ v:`${y-i}-01-01|${y-i}-12-31`, l:`${tt('per.year')} ${y-i}` });
  out.push({ v:'custom', l:tt('per.custom') });
  return out;
}
function perRange(){
  const sel=document.getElementById('per-range'); if(!sel) return { from:'', to:'' };
  if(sel.value==='custom') return { from:document.getElementById('per-from').value||'', to:document.getElementById('per-to').value||'' };
  const [from,to]=(sel.value||'|').split('|'); return { from, to };
}
function perArtists(from, to){
  const idx=LFCore.relIndex(DB.releases);
  const names=new Map();
  artistBalances().forEach(b=>names.set(b.key, b.name));
  Object.values(LFCore.computeRoyalties(DB, { idx, from, to }).byArtist).forEach(a=>{ if(!names.has(a.key)) names.set(a.key, a.name); });
  const rows=[];
  names.forEach((name,key)=>{
    const st=Object.assign(LFCore.computeStatement(DB, name, from, to, { idx }), { range:{ from, to } });
    if(Math.abs(st.total)<0.005 && st.balance<0.005 && st.netPay<0.005) return;
    rows.push(st);
  });
  return tieSort(rows, r=>r.netPay, -1, [r=>r.name]);
}
function perOverlap(from, to){ return perState().closed.find(c=>!(to<c.from || from>c.to)); }
function perPortalLink(name){ const tok=labelShares()[(name||'').trim().toLowerCase()]; return tok && window.LF_artistPortalLink ? window.LF_artistPortalLink(tok) : ''; }
function perPeriodLabel(from,to){ return fmtDate(from)+' – '+fmtDate(to); }
function perMailto(st){
  const a=(typeof findArtist==='function')?findArtist(st.name):null, link=perPortalLink(st.name);
  const subj=tt('per.mail_subject').replace('{label}', labelName()).replace('{period}', perPeriodLabel(st.from, st.to));
  const body=tt('per.mail_body').replace('{name}', st.name).replace('{period}', perPeriodLabel(st.from, st.to))
    .replace('{net}', fmtMoney(st.netPay)).replace('{balance}', fmtMoney(st.balance))
    .replace('{link}', link || tt('per.mail_nolink')).replace('{label}', labelName());
  return `mailto:${encodeURIComponent((a&&a.email)||'')}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
}
let perRows=[];
function renderPeriods(){
  const panel=document.getElementById('per-panel'); if(!panel) return;
  const sel=document.getElementById('per-range');
  const opts=perOptions(), cur=sel.value;
  const sig=opts.map(o=>o.v).join(',');
  if(sel.dataset.sig!==sig){ sel.innerHTML=opts.map(o=>`<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(''); sel.dataset.sig=sig;
    sel.value=opts.some(o=>o.v===cur)?cur:opts[0].v; }
  const custom=sel.value==='custom';
  document.getElementById('per-from').hidden=!custom; document.getElementById('per-to').hidden=!custom;
  const { from, to }=perRange();
  const lock=perLockDate();
  const lk=document.getElementById('per-lock'); if(lk) lk.textContent=lock?tt('per.locked_until').replace('{d}', fmtDate(lock)):'';
  const tbl=document.getElementById('per-table'), note=document.getElementById('per-note');
  if(!from || !to || from>to){ perRows=[]; tbl.innerHTML=''; if(note){ note.textContent=tt('per.pick'); note.hidden=false; } return; }
  perRows=perArtists(from, to);
  const ov=perOverlap(from, to);
  if(note){ note.hidden=!ov; if(ov) note.textContent=tt('per.already_closed').replace('{p}', perPeriodLabel(ov.from, ov.to)).replace('{d}', fmtDate(ov.closedAt.slice(0,10))); }
  const closeBtn=document.getElementById('per-close'); if(closeBtn) closeBtn.disabled=!!ov || !perRows.length;
  tbl.innerHTML = perRows.length ? `<thead><tr><th>${esc(tt('stmt.artist'))}</th><th class="num">${esc(tt('per.c_total'))}</th><th class="num">${esc(tt('per.c_net'))}</th><th class="num">${esc(tt('per.c_balance'))}</th><th>${esc(tt('per.c_portal'))}</th><th></th></tr></thead><tbody>`
    + perRows.map((st,i)=>{ const link=perPortalLink(st.name);
      return `<tr><td>${artNameLink(st.name)}</td><td class="num">${fmtMoney(st.total)}</td><td class="num pos">${fmtMoney(st.netPay)}</td><td class="num ${st.balance>0.005?'neg':''}">${fmtMoney(st.balance)}</td>
        <td>${link?`<span class="ctag ctag-ok">✓ ${esc(tt('per.portal_ok'))}</span>`:'<span class="muted small">—</span>'}</td>
        <td class="per-row-act"><button class="icon-btn-sm" data-per-pdf="${i}" title="${esc(tt('per.pdf_one'))}">⤓</button>
          ${link?`<button class="icon-btn-sm" data-per-copy="${i}" title="${esc(tt('per.copy_one'))}">🔗</button>`:''}
          <a class="icon-btn-sm" href="${esc(perMailto(st))}" title="${esc(tt('per.mail_one'))}">✉</a></td></tr>`; }).join('')
    + `<tr class="per-tot"><td><b>${esc(tt('stmt.total'))}</b></td><td class="num"><b>${fmtMoney(perRows.reduce((s,r)=>s+r.total,0))}</b></td><td class="num pos"><b>${fmtMoney(perRows.reduce((s,r)=>s+r.netPay,0))}</b></td><td class="num"><b>${fmtMoney(perRows.reduce((s,r)=>s+r.balance,0))}</b></td><td></td><td></td></tr></tbody>`
    : `<tbody><tr><td class="muted">${esc(tt('per.no_rows'))}</td></tr></tbody>`;
  renderPeriodHistory();
}
function renderPeriodHistory(){
  const box=document.getElementById('per-history-list'), det=document.getElementById('per-history'); if(!box) return;
  const list=perState().closed.slice().sort((a,b)=>b.to.localeCompare(a.to));
  if(det) det.hidden=!list.length;
  box.innerHTML=list.map((c,i)=>{
    const snap=Object.values(c.artists||{}).reduce((s,a)=>s+(+a.total||0),0);
    const live=perArtists(c.from, c.to).reduce((s,r)=>s+r.total,0), diff=live-snap;
    const ok=Math.abs(diff)<0.01;
    return `<div class="per-h-item"><div class="trash-main"><b>${esc(perPeriodLabel(c.from,c.to))}</b>
      <span class="muted small">${esc(tt('per.closed_on').replace('{d}', fmtDate(c.closedAt.slice(0,10))))} · ${Object.keys(c.artists||{}).length} ${esc(tt('per.artists'))} · ${fmtMoney(snap)}</span>
      <span class="small ${ok?'pos':'neg'}">${ok?'✓ '+esc(tt('per.unchanged')):'⚠ '+esc(tt('per.changed').replace('{d}', (diff>0?'+':'')+fmtMoney(diff)))}</span></div>
      ${i===0?`<button class="btn btn-sm" data-per-reopen="${esc(c.id)}">${esc(tt('per.reopen'))}</button>`:''}</div>`; }).join('');
}
async function perStatementBlob(st){
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-9999px;top:0;width:800px;background:#fff';
  host.innerHTML=`<div class="stmt-pdf">${statementHTML(st)}</div>`;
  document.body.appendChild(host);
  try{
    return await html2pdf().set({ margin:[8,8,8,8], image:{type:'jpeg',quality:0.95},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',windowWidth:840},
      jsPDF:{unit:'mm',format:'a4',orientation:'portrait'} }).from(host.firstElementChild).outputPdf('blob');
  } finally { host.remove(); }
}
const safeName=s=>String(s||'').replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,' ').trim()||'file';
function downloadBlob(name, blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000); }
async function perZipAll(){
  if(!perRows.length) return;
  if(typeof html2pdf==='undefined'){ toast(tt('per.pdf_unavailable')); return; }
  const btn=document.getElementById('per-zip'); if(btn) btn.disabled=true;
  const files=[];
  try{
    for(let i=0;i<perRows.length;i++){
      const st=perRows[i]; toast(tt('per.zip_progress').replace('{i}', i+1).replace('{n}', perRows.length));
      const blob=await perStatementBlob(st);
      files.push({ name:`Statement ${safeName(st.name)} ${st.from}_${st.to}.pdf`, data:new Uint8Array(await blob.arrayBuffer()) });
    }
    const { from, to }=perRange();
    downloadBlob(`${safeName(labelName())} – Statement ${from}_${to}.zip`, makeZip(files));
    toast(tt('per.zip_done').replace('{n}', files.length));
  }catch(e){ toast(tt('per.zip_fail')); }
  finally{ if(btn) btn.disabled=false; }
}
async function perOnePdf(i){
  const st=perRows[i]; if(!st) return;
  if(typeof html2pdf==='undefined'){ toast(tt('per.pdf_unavailable')); return; }
  toast(tt('stmt.wait'));
  try{ downloadBlob(`${safeName(labelName())} – Statement ${safeName(st.name)}.pdf`, await perStatementBlob(st)); }catch(e){ toast(tt('per.zip_fail')); }
}
async function perCreateLinks(){
  if(!window.LF_shareArtist){ toast(tt('portal.offline')); return; }
  const missing=perRows.filter(st=>!perPortalLink(st.name)); if(!missing.length){ toast(tt('per.links_all_ok')); return; }
  const btn=document.getElementById('per-links'); if(btn) btn.disabled=true;
  let ok=0, fail=0;
  for(const st of missing){
    const r=await window.LF_shareArtist(activeLabel().id, st.name);
    if(r && r.token){ labelShares()[(st.name||'').trim().toLowerCase()]=r.token; ok++; } else fail++;
  }
  if(ok) save();
  if(btn) btn.disabled=false;
  renderPeriods();
  toast(fail ? tt('per.links_partial').replace('{ok}', ok).replace('{fail}', fail) : tt('per.links_done').replace('{n}', ok));
}
function perCopyAll(){
  const lines=perRows.map(st=>{ const l=perPortalLink(st.name); return `${st.name}: ${fmtMoney(st.netPay)}${l?' — '+l:''}`; });
  if(!lines.length) return;
  const text=tt('per.copy_head').replace('{period}', perPeriodLabel(perRows[0].from, perRows[0].to))+'\n'+lines.join('\n');
  try{ navigator.clipboard.writeText(text).then(()=>toast(tt('per.copied')), ()=>prompt('', text)); }catch(e){ prompt('', text); }
}
function perClose(){
  const { from, to }=perRange(); if(!from||!to||!perRows.length) return;
  if(perOverlap(from,to)){ toast(tt('per.overlap')); return; }
  if(!confirm(tt('per.close_q').replace('{p}', perPeriodLabel(from,to)))) return;
  const artists={}; perRows.forEach(st=>{ artists[st.key]={ name:st.name, total:+st.total.toFixed(2), netPay:+st.netPay.toFixed(2), balance:+st.balance.toFixed(2) }; });
  perState().closed.push({ id:'per_'+newId(), from, to, closedAt:new Date().toISOString(), artists });
  save(); renderPeriods(); toast(tt('per.closed_done'));
}
function perReopen(id){
  if(!confirm(tt('per.reopen_q'))) return;
  const p=perState(); p.closed=p.closed.filter(c=>c.id!==id); save(); renderPeriods(); toast(tt('per.reopened'));
}
(function wirePeriods(){
  const on=(id,ev,fn)=>{ const el=document.getElementById(id); if(el) el.addEventListener(ev,fn); };
  on('per-range','change',renderPeriods); on('per-from','change',renderPeriods); on('per-to','change',renderPeriods);
  on('per-zip','click',perZipAll); on('per-links','click',perCreateLinks); on('per-copy','click',perCopyAll); on('per-close','click',perClose);
  document.addEventListener('click',e=>{
    const p=e.target.closest('[data-per-pdf]'); if(p){ perOnePdf(+p.dataset.perPdf); return; }
    const c=e.target.closest('[data-per-copy]'); if(c){ const st=perRows[+c.dataset.perCopy]; const l=st&&perPortalLink(st.name); if(l){ try{ navigator.clipboard.writeText(l); }catch(_){} toast(tt('portal.copied')); } return; }
    const r=e.target.closest('[data-per-reopen]'); if(r){ perReopen(r.dataset.perReopen); }
  });
})();

/* ---------- ZIP senza compressione (statement, pacchetto per il commercialista) ---------- */
const CRC_TABLE=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC_TABLE[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
/* files: [{name, data:Uint8Array|string}] → Blob application/zip */
function makeZip(files){
  const enc=new TextEncoder(), parts=[], central=[]; let offset=0;
  const d=new Date(), dosTime=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), dosDate=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  const used=new Set();
  for(const f of files){
    let name=f.name; for(let k=2; used.has(name); k++) name=f.name.replace(/(\.[^.\/]+)?$/, ` (${k})$1`); used.add(name);
    const nm=enc.encode(name), data=typeof f.data==='string'?enc.encode(f.data):f.data, crc=crc32(data);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,0,true);
    lh.setUint16(10,dosTime,true); lh.setUint16(12,dosDate,true); lh.setUint32(14,crc,true);
    lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true); lh.setUint16(26,nm.length,true); lh.setUint16(28,0,true);
    parts.push(lh.buffer, nm, data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
    ch.setUint16(12,dosTime,true); ch.setUint16(14,dosDate,true); ch.setUint32(16,crc,true); ch.setUint32(20,data.length,true); ch.setUint32(24,data.length,true);
    ch.setUint16(28,nm.length,true); ch.setUint32(42,offset,true);
    central.push(ch.buffer, nm);
    offset+=30+nm.length+data.length;
  }
  const csize=central.reduce((s,b)=>s+(b.byteLength!=null?b.byteLength:b.length),0);
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,csize,true); end.setUint32(16,offset,true);
  return new Blob([...parts, ...central, end.buffer], { type:'application/zip' });
}

/* ============================================================================
   3. RITENUTA D'ACCONTO E RICEVUTA DI PAGAMENTO
   Il regime fiscale si sceglie nella scheda dell'artista (rubrica):
   · prestazione occasionale → ritenuta 20% sul compenso
   · diritti d'autore → 20% sul 75% (deduzione forfettaria del 25%)
   · diritti d'autore, under 35 → 20% sul 60%
   · Partita IVA / estero / non impostato → nessuna ritenuta calcolata qui
   Il pagamento registrato resta il lordo (scala il saldo dell'artista); si
   salvano ritenuta e netto bonificato, e si crea il promemoria per l'F24.
   ============================================================================ */
const WH_RATE=0.20, WH_BASE={ occasional:1, copyright:0.75, copyright35:0.60 }, WH_STAMP_MIN=77.47;
const r2=n=>Math.round((+n||0)*100)/100;
function whFor(name){
  const a=(typeof findArtist==='function')?findArtist(name):null;
  return (a && WH_BASE[a.taxRegime]!=null) ? { regime:a.taxRegime, base:WH_BASE[a.taxRegime], rate:WH_RATE, artist:a } : null;
}
function whCalc(gross, w){ const wh=r2(gross*w.base*w.rate); return { withholding:wh, net:r2(gross-wh) }; }
/* chiamata da recordPayout: false = l'utente ha annullato */
function whApplyToPayout(po){
  const w=whFor(po.artist); if(!w) return true;
  const c=whCalc(po.amount, w);
  const msg=tt('wh.confirm').replace('{name}', po.artist).replace('{gross}', fmtMoney(po.amount)).replace('{rule}', tt('wh.rule_'+w.regime))
    .replace('{wh}', fmtMoney(c.withholding)).replace('{net}', fmtMoney(c.net));
  if(!confirm(msg)) return false;
  Object.assign(po, { withholding:c.withholding, net:c.net, regime:w.regime, base:w.base, rate:w.rate });
  // promemoria: la ritenuta si versa con l'F24 entro il 16 del mese successivo
  const d=LFCore.parseYmd(po.date)||new Date(), due=LFCore.ymd(new Date(d.getFullYear(), d.getMonth()+1, 16));
  DB.tasks=DB.tasks||[];
  DB.tasks.push({ id:newId(), title:tt('wh.task').replace('{amt}', fmtMoney(c.withholding)).replace('{name}', po.artist), type:'payment', due, time:'', remind:1440, done:false, autoKey:'f24:'+po.id });
  return true;
}
// numero progressivo della ricevuta nell'anno (in ordine di data)
function receiptNumber(po){
  const y=(po.date||'').slice(0,4);
  const same=(DB.payouts||[]).filter(p=>(p.date||'').slice(0,4)===y).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
  return (same.findIndex(p=>p.id===po.id)+1)+'/'+y;
}
function receiptHTML(po){
  const a=(typeof findArtist==='function')?findArtist(po.artist):null;
  const logo=LFCore.safeImgSrc((DB.profile&&DB.profile.logo)||'');
  const head=(DB.profile&&DB.profile.docHeader)||'';
  const gross=+po.amount||0, wh=+po.withholding||0, net=po.net!=null?+po.net:gross;
  const stamp=!wh || po.regime==='vat' || po.regime==='foreign' ? false : gross>WH_STAMP_MIN;
  const line=(l,v,b)=>`<tr><td>${b?'<b>':''}${esc(l)}${b?'</b>':''}</td><td class="r">${b?'<b>':''}${v}${b?'</b>':''}</td></tr>`;
  return `<div class="stmt-lh">${logo?`<img class="stmt-lh-logo" src="${esc(logo)}" alt="">`:''}<div class="stmt-lh-name">${esc(labelName())}</div></div>
   ${head?`<p class="rcpt-head">${esc(head).replace(/\n/g,'<br>')}</p>`:''}
   <h1 class="stmt-h1">${esc(tt('wh.r_title'))} <span class="rcpt-n">${esc(tt('wh.r_number'))} ${esc(receiptNumber(po))}</span></h1>
   <div class="stmt-meta">
     <div><span>${esc(tt('wh.r_payee'))}:</span> <b>${esc((a&&a.legal)||po.artist)}</b>${a&&a.legal&&a.legal!==po.artist?` (${esc(po.artist)})`:''}</div>
     ${a&&a.address?`<div><span>${esc(tt('art.address'))}:</span> <b>${esc(a.address)}</b></div>`:''}
     ${a&&a.taxId?`<div><span>${esc(tt('wh.tax_id'))}:</span> <b>${esc(a.taxId)}</b></div>`:''}
     <div><span>${esc(tt('wh.r_date'))}:</span> <b>${esc(fmtDate(po.date||''))}</b></div>
   </div>
   <p class="rcpt-text">${esc(tt('wh.r_text').replace('{payee}', (a&&a.legal)||po.artist).replace('{label}', labelName()))}</p>
   <table class="stmt-sum rcpt-tbl"><tbody>
     ${line(tt('wh.r_gross'), fmtMoney(gross))}
     ${wh?line(tt('wh.r_base').replace('{p}', Math.round((po.base||1)*100)), fmtMoney(r2(gross*(po.base||1)))):''}
     ${wh?line(tt('wh.r_wh').replace('{p}', Math.round((po.rate||WH_RATE)*100)), '− '+fmtMoney(wh)):''}
     ${line(tt('wh.r_net'), fmtMoney(net), true)}
   </tbody></table>
   ${stamp?`<p class="stmt-note">${esc(tt('wh.r_stamp'))}</p>`:''}
   ${po.regime==='vat'?`<p class="stmt-note">${esc(tt('wh.r_vat_note'))}</p>`:''}
   <div class="rcpt-sign"><div><span>${esc(tt('wh.r_place'))}</span><i></i></div><div><span>${esc(tt('wh.r_sign'))}</span><i></i></div></div>
   <p class="stmt-foot">${esc(tt('wh.r_foot'))}</p>`;
}
async function downloadReceipt(id){
  const po=(DB.payouts||[]).find(p=>p.id===id); if(!po) return;
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-9999px;top:0;width:800px;background:#fff';
  host.innerHTML=`<div class="stmt-pdf rcpt-pdf">${receiptHTML(po)}</div>`;
  document.body.appendChild(host);
  const fname=`${tt('wh.r_file')} ${safeName(po.artist)} ${po.date||''}.pdf`;
  try{
    if(typeof html2pdf==='undefined'){ toast(tt('per.pdf_unavailable')); return; }
    toast(tt('stmt.wait'));
    const blob=await html2pdf().set({ margin:[10,10,10,10], image:{type:'jpeg',quality:0.95},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',windowWidth:840}, jsPDF:{unit:'mm',format:'a4',orientation:'portrait'} }).from(host.firstElementChild).outputPdf('blob');
    downloadBlob(fname, blob);
  }catch(e){ toast(tt('per.zip_fail')); }
  finally{ host.remove(); }
}
(function wireWithholding(){
  document.addEventListener('click',e=>{ const b=e.target.closest('.po-rcpt'); if(b) downloadReceipt(b.dataset.id); });
  const dh=document.getElementById('doc-header');
  if(dh) dh.addEventListener('change',()=>{ DB.profile=DB.profile||{}; DB.profile.docHeader=dh.value.trim(); save(); toast(tt('common.saved')); });
})();
