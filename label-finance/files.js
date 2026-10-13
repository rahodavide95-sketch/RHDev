/* ============================================================================
   files.js — ricevute allegate ai movimenti e pacchetto per il commercialista
   · Allegati: foto o PDF di ricevute/fatture su un movimento. Il file resta su
     questo dispositivo (IndexedDB) e, con l'account, anche nel cloud (Supabase
     Storage, cartella privata dell'etichetta) così lo vedi da ogni dispositivo.
     Le foto vengono ridotte (max 1800 px) per non pesare.
   · Pacchetto per il commercialista: un anno in uno ZIP con movimenti, riepilogo
     per categoria e piattaforma, pagamenti agli artisti con ritenute e tutte le
     ricevute.
   Usa le funzioni globali di app.js e money.js (DB, save, tt, makeZip, …).
   ============================================================================ */
const ATT_MAX=8*1024*1024, ATT_IMG_MAX=1800, ATT_KEYS='attKeys';
let attPending=[];                   // allegati di un movimento nuovo, non ancora salvato

/* ---------- copia sul dispositivo (IndexedDB) ---------- */
async function attKeysGet(){ try{ const k=await window.LFStore.get(ATT_KEYS); return Array.isArray(k)?k:[]; }catch(e){ return []; } }
async function attPutLocal(id, rec){ try{ await window.LFStore.set('att:'+id, rec); const k=await attKeysGet(); if(!k.includes(id)){ k.push(id); await window.LFStore.set(ATT_KEYS, k); } }catch(e){} }
async function attGetLocal(id){ try{ return await window.LFStore.get('att:'+id); }catch(e){ return null; } }
async function attDelLocal(id){ try{ await window.LFStore.del('att:'+id); const k=(await attKeysGet()).filter(x=>x!==id); await window.LFStore.set(ATT_KEYS, k); }catch(e){} }
// uscita dall'account: niente file dell'etichetta rimasti sul dispositivo
async function attWipeLocal(){ const k=await attKeysGet(); for(const id of k){ try{ await window.LFStore.del('att:'+id); }catch(e){} } try{ await window.LFStore.del(ATT_KEYS); }catch(e){} }

/* ---------- preparazione del file ---------- */
function attShrinkImage(file){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(file), img=new Image();
    img.onload=()=>{ URL.revokeObjectURL(url);
      const k=Math.min(1, ATT_IMG_MAX/Math.max(img.naturalWidth, img.naturalHeight));
      if(k===1 && file.size<700*1024){ resolve(file); return; }
      const c=document.createElement('canvas'); c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k);
      const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
      // tieni la versione ridotta solo se pesa davvero meno (alcune grafiche PNG sono già leggere)
      c.toBlob(b=>resolve(b && b.size<file.size ? b : file), 'image/jpeg', 0.82); };
    img.onerror=()=>{ URL.revokeObjectURL(url); resolve(file); };
    img.src=url;
  });
}
async function attPrepare(file){
  if(!file) throw new Error('none');
  const isImg=/^image\//.test(file.type||''), isPdf=(file.type==='application/pdf') || /\.pdf$/i.test(file.name||'');
  if(!isImg && !isPdf) throw new Error('type');
  if(file.size>(isImg?25*1024*1024:ATT_MAX)) throw new Error('size');
  let blob=file, name=file.name||'ricevuta', type=file.type||(isPdf?'application/pdf':'image/jpeg');
  if(isImg && !/gif|svg/.test(type)){ blob=await attShrinkImage(file); if(blob!==file){ type='image/jpeg'; name=name.replace(/\.[^.]+$/,'')+'.jpg'; } }
  if(blob.size>ATT_MAX) throw new Error('size');
  return { blob, name, type };
}
const attMsg=e=>tt(e && e.message==='type' ? 'att.err_type' : e && e.message==='size' ? 'att.err_size' : 'att.err');

/* ---------- aggiunta, apertura, rimozione ---------- */
async function attStore(file){
  const p=await attPrepare(file);
  const id='at_'+newId();
  await attPutLocal(id, { name:p.name, type:p.type, blob:p.blob });
  const meta={ id, name:p.name, type:p.type, size:p.blob.size, at:new Date().toISOString() };
  if(window.LF_uploadReceipt){ const r=await window.LF_uploadReceipt(id+'-'+safeName(p.name).replace(/\s+/g,'_'), p.blob, p.type); if(r && r.path) meta.path=r.path; }
  return meta;
}
async function attBlob(meta){
  const loc=await attGetLocal(meta.id); if(loc && loc.blob) return loc.blob;
  if(meta.path && window.LF_downloadReceipt){ const b=await window.LF_downloadReceipt(meta.path); if(b){ attPutLocal(meta.id, { name:meta.name, type:meta.type, blob:b }); return b; } }
  return null;
}
async function attOpen(meta){
  const b=await attBlob(meta); if(!b){ toast(tt('att.unavailable')); return; }
  if(/^image\//.test(meta.type||b.type)){   // le foto si vedono subito, i PDF si scaricano
    const m=document.getElementById('att-view'), img=document.getElementById('att-view-img');
    if(m && img){ const url=URL.createObjectURL(b); img.onload=()=>{}; img.src=url; img.dataset.url=url;
      document.getElementById('att-view-name').textContent=meta.name; m.hidden=false; return; }
  }
  downloadBlob(meta.name, b);
}
function attCloseView(){ const m=document.getElementById('att-view'), img=document.getElementById('att-view-img'); if(!m) return; m.hidden=true; if(img && img.dataset.url){ URL.revokeObjectURL(img.dataset.url); img.removeAttribute('src'); delete img.dataset.url; } }
function attCurrentTx(){ const id=(document.getElementById('f-id')||{}).value; return id ? (DB.transactions||[]).find(t=>t.id===id) : null; }
function attList(){ const t=attCurrentTx(); return t ? (t.att||[]) : attPending; }
function renderAtt(){
  const box=document.getElementById('f-att-list'); if(!box) return;
  const list=attList();
  box.innerHTML = list.length ? list.map(a=>`<span class="att-chip"><button type="button" class="att-open" data-att-open="${esc(a.id)}" title="${esc(tt('att.open'))}">${/^image\//.test(a.type)?'🖼':'📄'} ${esc(a.name)}</button>
      <span class="muted small">${Math.max(1,Math.round((a.size||0)/1024))} KB${a.path?' · ☁':''}</span>
      <button type="button" class="att-del" data-att-del="${esc(a.id)}" title="${esc(tt('att.remove'))}" aria-label="${esc(tt('att.remove'))}">✕</button></span>`).join('')
    : `<span class="muted small">${esc(tt('att.none'))}</span>`;
}
async function attAddFiles(files){
  const t=attCurrentTx(); let added=0;
  for(const f of files){
    try{ toast(tt('att.uploading')); const meta=await attStore(f);
      if(t){ t.att=(t.att||[]).concat(meta); } else attPending.push(meta);
      added++;
    }catch(e){ toast(attMsg(e)); }
  }
  if(added){ if(t) save(); renderAtt(); toast(tt('att.added').replace('{n}', added)); if(t && typeof applyTxFilters==='function') applyTxFilters(); }
}
async function attRemove(id){
  const t=attCurrentTx(), list=attList(), meta=list.find(a=>a.id===id); if(!meta) return;
  if(!confirm(tt('att.remove_q').replace('{n}', meta.name))) return;
  if(t){ t.att=(t.att||[]).filter(a=>a.id!==id); save(); } else attPending=attPending.filter(a=>a.id!==id);
  attDelLocal(id);
  if(meta.path && window.LF_deleteReceipt) window.LF_deleteReceipt(meta.path);
  renderAtt(); if(t && typeof applyTxFilters==='function') applyTxFilters();
}
/* chiamate da app.js */
function attOnOpenTx(){ attDropPending(); renderAtt(); }
// movimento nuovo chiuso senza salvare: le ricevute caricate non restano orfane sul dispositivo/cloud
function attDropPending(){ attPending.forEach(a=>{ try{ attDelLocal(a.id); if(a.cloud && window.LF_deleteReceipt) window.LF_deleteReceipt(a.cloud); }catch(e){} }); attPending=[]; }
function attOnTxSave(rec, prev){ if(!prev && attPending.length){ rec.att=(rec.att||[]).concat(attPending); } attPending=[]; }

/* ============================================================================
   PACCHETTO PER IL COMMERCIALISTA
   ============================================================================ */
function packYears(){
  const ys=new Set(); (DB.transactions||[]).forEach(t=>{ const y=(t.date||'').slice(0,4); if(/^\d{4}$/.test(y)) ys.add(y); });
  (DB.payouts||[]).forEach(p=>{ const y=(p.date||'').slice(0,4); if(/^\d{4}$/.test(y)) ys.add(y); });
  return [...ys].sort().reverse();
}
// stesso CSV degli altri export: ";" e virgola decimale nelle lingue europee, BOM, celle-formula protette
function packCsv(rows){ return csvText(rows, { fixed2:true }); }
async function buildAccountantPack(year){
  const txs=(DB.transactions||[]).filter(t=>(t.date||'').slice(0,4)===year).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const files=[], fileNames={};
  // ricevute (cartella ricevute/)
  for(const t of txs){
    for(const a of t.att||[]){
      const b=await attBlob(a); if(!b) continue;
      const name=`${tt('pack.dir_receipts')}/${t.date||''}_${safeName(t.product||t.platform||'movimento').slice(0,40)}_${safeName(a.name)}`;
      files.push({ name, data:new Uint8Array(await b.arrayBuffer()) });
      (fileNames[t.id]||(fileNames[t.id]=[])).push(name.split('/').pop());
    }
  }
  const H=k=>tt('pack.h_'+k);
  // movimenti
  const mov=[[H('date'),H('kind'),H('platform'),H('category'),H('description'),H('artist'),H('catalog'),H('currency'),H('amount'),H('amount_eur'),tt('col.paid'),H('note'),H('receipts')]];
  let inc=0, exp=0; const byPlat={}, byCat={};
  txs.forEach(t=>{
    const eur=LFCore.txEur(DB, t), isInc=t.kind==='income', cat=isInc?'':tt('ecat.'+expenseCategory(t));
    // uscite non pagate: nell'elenco (colonna "Pagato") ma non nei totali, come nell'app
    const counts=isInc || t.paid!==false;
    if(isInc){ inc+=eur; byPlat[t.platform||'—']=(byPlat[t.platform||'—']||0)+eur; } else if(counts){ exp+=Math.abs(eur); byCat[cat]=(byCat[cat]||0)+Math.abs(eur); }
    mov.push([t.date||'', tt(isInc?'pack.income':'pack.expense'), t.platform||'', cat, t.product||'', t.artist||'', t.catalog||'', (t.currency||'EUR').toUpperCase(),
      isInc?(+t.net||0):-Math.abs(+t.net||0), isInc?eur:-Math.abs(eur), isInc?'':tt(counts?'paid.yes':'paid.no'), t.note||'', (fileNames[t.id]||[]).join(' | ')]);   // entrate col loro segno (un rimborso resta negativo, come nei totali)
  });
  files.push({ name:`${tt('pack.f_movements')}_${year}.csv`, data:packCsv(mov) });
  // pagamenti agli artisti con ritenute
  const pays=(DB.payouts||[]).filter(p=>(p.date||'').slice(0,4)===year).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const payRows=[[H('date'),H('artist'),H('legal'),H('tax_id'),H('regime'),H('gross'),H('withholding'),H('net')]];
  let pg=0, pw=0, pn=0;
  pays.forEach(p=>{ const a=(typeof findArtist==='function')?findArtist(p.artist):null; const g=+p.amount||0, w=+p.withholding||0, n=p.net!=null?+p.net:g; pg+=g; pw+=w; pn+=n;
    payRows.push([p.date||'', p.artist, (a&&a.legal)||'', (a&&a.taxId)||'', p.regime?tt('wh.r_'+p.regime):'', g, w, n]); });
  files.push({ name:`${tt('pack.f_payouts')}_${year}.csv`, data:packCsv(payRows) });
  // riepilogo
  const roy=LFCore.computeRoyalties(DB, { from:year+'-01-01', to:year+'-12-31' });
  const artistsTot=Object.values(roy.byArtist).reduce((s,a)=>s+a.total,0);
  const sum=[[tt('pack.s_item'), tt('pack.s_amount')], [tt('pack.s_income'), inc], [tt('pack.s_expense'), exp], [tt('pack.s_margin'), inc-exp], ['',''],
    [tt('pack.s_by_platform'), '']].concat(Object.entries(byPlat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>['  '+k, v]))
    .concat([['',''],[tt('pack.s_by_category'), '']]).concat(Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>['  '+k, v]))
    .concat([['',''],[tt('pack.s_royalties'), artistsTot],[tt('pack.s_paid_gross'), pg],[tt('pack.s_withholding'), pw],[tt('pack.s_paid_net'), pn]]);
  files.push({ name:`${tt('pack.f_summary')}_${year}.csv`, data:packCsv(sum) });
  files.push({ name:`${tt('pack.f_readme')}.txt`, data:tt('pack.readme').replace(/\{label\}/g, labelName()).replace(/\{year\}/g, year).replace('{n}', txs.length).replace('{r}', files.filter(f=>f.name.includes('/')).length) });
  return files;
}
function openPackModal(){
  const m=document.getElementById('pack-modal'); if(!m) return;
  const sel=document.getElementById('pack-year'), ys=packYears();
  sel.innerHTML=ys.length?ys.map(y=>`<option>${y}</option>`).join(''):`<option value="">—</option>`;
  const prev=String(new Date().getFullYear()-1); if(ys.includes(prev)) sel.value=prev;
  document.getElementById('pack-go').disabled=!ys.length;
  m.hidden=false;
}
async function packDownload(){
  const y=document.getElementById('pack-year').value; if(!y) return;
  const b=document.getElementById('pack-go'); b.disabled=true; toast(tt('pack.preparing'));
  try{ const files=await buildAccountantPack(y); downloadBlob(`${safeName(labelName())} – ${tt('pack.zip')} ${y}.zip`, makeZip(files)); toast(tt('pack.done')); document.getElementById('pack-modal').hidden=true; }
  catch(e){ toast(tt('att.err')); }
  finally{ b.disabled=false; }
}

/* ---------- collegamenti ---------- */
document.addEventListener('click', e=>{
  const o=e.target.closest('[data-att-open]'); if(o){ const a=attList().find(x=>x.id===o.dataset.attOpen); if(a) attOpen(a); return; }
  const d=e.target.closest('[data-att-del]'); if(d){ attRemove(d.dataset.attDel); return; }
  const c=e.target.closest('[data-tx-att]'); if(c){ e.stopPropagation(); const t=(DB.transactions||[]).find(x=>x.id===c.dataset.txAtt); if(t && t.att && t.att[0]) attOpen(t.att[0]); }
}, true);
(function wireFiles(){
  const on=(id,ev,fn)=>{ const el=document.getElementById(id); if(el) el.addEventListener(ev,fn); };
  on('f-att-add','click',()=>document.getElementById('f-att-input').click());
  on('f-att-input','change',e=>{ const fs=[...e.target.files]; e.target.value=''; if(fs.length) attAddFiles(fs); });
  on('att-view-close','click',attCloseView);
  on('att-view','click',e=>{ if(e.target.id==='att-view') attCloseView(); });
  on('pack-open','click',openPackModal);
  on('pack-go','click',packDownload);
  on('pack-close','click',()=>{ document.getElementById('pack-modal').hidden=true; });
  on('pack-modal','click',e=>{ if(e.target.id==='pack-modal') e.currentTarget.hidden=true; });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ attCloseView(); const m=document.getElementById('pack-modal'); if(m) m.hidden=true; } });
})();
