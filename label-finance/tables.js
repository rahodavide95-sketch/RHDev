/* ============================================================================
   tables.js — colonne regolabili come in Excel, per tutte le tabelle della app
   (.data-table) e per gli elenchi a righe (.dbl):
   · trascina il bordo destro di un'intestazione per allargare/stringere la colonna
   · doppio clic sul bordo: la colonna si adatta al contenuto più lungo
   · le larghezze restano salvate su questo dispositivo (per tabella e colonna)
   · se la tabella è più larga dello spazio disponibile, scorre di lato dentro il
     suo riquadro (con l'intestazione sempre visibile)
   Solo su schermi larghi: su telefono tabelle ed elenchi diventano schede.
   ============================================================================ */
(function(root){
  'use strict';
  const LS='labelfinance.colw', MIN_W=48, MAX_W=900, MAX_COLS_SAVED=80;
  let store={};
  try{ store=JSON.parse(localStorage.getItem(LS)||'{}')||{}; }catch(e){ store={}; }
  const persist=()=>{ try{ localStorage.setItem(LS, JSON.stringify(store)); }catch(e){} };
  // Movimenti ora ha colonne a larghezza fissa uguali in tutte le schede: le larghezze salvate col vecchio sistema si azzerano una volta
  if(!store.__txV2){ delete store['table-tx']; store.__txV2=1; persist(); }
  const wide=()=>root.matchMedia('(min-width:761px)').matches;

  /* ---------- identità di tabelle e colonne ---------- */
  function boxKey(el){
    if(el.id) return el.id;
    const v=el.closest('.view'), sel=el.matches('table')?'table.data-table':'.dbl';
    const i=v?[...v.querySelectorAll(sel)].indexOf(el):-1;
    return (v?v.id:'app')+':'+i;
  }
  const cleanLabel=t=>(t||'').replace(/[▲▼]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  function thKey(th, i){ return th.dataset.col || th.dataset.k || cleanLabel(th.textContent) || ('#'+i); }

  /* ---------- elementi delle colonne ---------- */
  // per una tabella: celle di intestazione (ultima riga del thead)
  function tableHeads(t){ const tr=t.tHead && t.tHead.rows[t.tHead.rows.length-1]; return tr?[...tr.cells]:[]; }
  function dblHead(d){ return [...d.children].find(c=>c.classList && c.classList.contains('dbl-head')) || null; }
  const dblRows=d=>[...d.children].filter(c=>c.classList && c.classList.contains('dbl-row'));
  const resizable=el=>!el.classList.contains('dbl-sel') && !!(el.dataset.col || el.dataset.sort || (el.matches('th') && cleanLabel(el.textContent)));

  function ensureHandles(cells){
    cells.forEach(c=>{ if(!resizable(c) || c.querySelector(':scope > .col-rs')) return;
      const h=document.createElement('span'); h.className='col-rs'; h.setAttribute('aria-hidden','true');
      h.title=(root.t?root.t('cols.resize_hint'):'')||'';
      c.appendChild(h); c.classList.add('col-rs-host'); });
  }

  /* ---------- misura del contenuto (per il doppio clic) ---------- */
  let meter=null;
  function natural(cell){
    if(!meter){ meter=document.createElement('div'); meter.setAttribute('aria-hidden','true');
      meter.style.cssText='position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none;';
      document.body.appendChild(meter); }
    const cs=getComputedStyle(cell);
    meter.style.font=cs.font; meter.style.letterSpacing=cs.letterSpacing; meter.style.textTransform=cs.textTransform;
    meter.innerHTML=cell.innerHTML;
    meter.querySelectorAll('.col-rs').forEach(x=>x.remove());
    const w=meter.scrollWidth + (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0) + 14;
    meter.innerHTML='';
    return Math.ceil(w);
  }

  /* ---------- tabelle <table> ---------- */
  function layoutTable(t){
    const heads=tableHeads(t); if(!heads.length) return;
    ensureHandles(heads);
    const saved=store[boxKey(t)];
    // ripristina il layout automatico e misura le larghezze "naturali"
    t.classList.remove('cols-fixed'); t.style.width=''; heads.forEach(h=>{ h.style.width=''; });
    if(saved && Object.keys(saved).length && wide()){
      const nat=heads.map(h=>h.offsetWidth);
      const ws=heads.map((h,i)=>{ const v=saved[thKey(h,i)]; return v?Math.max(MIN_W,v):nat[i]; });
      fitToBox(ws, heads, t.parentElement ? t.parentElement.clientWidth : 0);
      heads.forEach((h,i)=>{ h.style.width=ws[i]+'px'; });
      t.style.width=ws.reduce((a,b)=>a+b,0)+'px';
      t.classList.add('cols-fixed');
    }
    markWide(t.closest('.table-wrap'), t);
  }
  // se le colonne non riempiono lo spazio, l'avanzo va all'ultima colonna regolabile
  function fitToBox(ws, cells, boxW){
    const sum=ws.reduce((a,b)=>a+b,0); if(!boxW || sum>=boxW) return;
    for(let i=cells.length-1;i>=0;i--){ if(resizable(cells[i])){ ws[i]+=boxW-sum; return; } }
    ws[ws.length-1]+=boxW-sum;
  }
  function markWide(wrap, inner){
    if(!wrap) return;
    const on=wide() && inner.scrollWidth > wrap.clientWidth + 2;
    wrap.classList.toggle('is-wide', on);
  }

  /* ---------- elenchi .dbl (righe a griglia) ---------- */
  function dblTracks(row){ return (row.style.gridTemplateColumns||'').trim().split(/\s+(?![^(]*\))/).filter(Boolean); }
  // larghezza che servirebbe alla riga: colonne (già risolte in px) + spazi + bordi
  function dblNeed(row){ const cs=getComputedStyle(row);
    const tr=(cs.gridTemplateColumns||'').split(/\s+/).map(parseFloat).filter(n=>!isNaN(n));
    const gap=parseFloat(cs.columnGap)||0;
    return Math.ceil(tr.reduce((a,b)=>a+b,0) + gap*Math.max(0,tr.length-1) + (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0)
      + (parseFloat(cs.borderLeftWidth)||0) + (parseFloat(cs.borderRightWidth)||0)); }
  function layoutDbl(d){
    const head=dblHead(d); if(!head) return;
    const cells=[...head.children]; ensureHandles(cells);
    const rows=dblRows(d);
    // template originale (quello scritto dal render) conservato sulla riga
    rows.forEach(r=>{ if(!r.dataset.tpl) r.dataset.tpl=r.style.gridTemplateColumns||''; else r.style.gridTemplateColumns=r.dataset.tpl; r.style.minWidth=''; });
    d.classList.remove('cols-fixed');
    // colonne che non stanno nello spazio: tutte le righe si allargano insieme (restano allineate)
    if(wide()){ const need=dblNeed(head); if(need > head.getBoundingClientRect().width + 1) rows.forEach(r=>{ r.style.minWidth=need+'px'; }); }
    const saved=store[boxKey(d)];
    if(saved && Object.keys(saved).length && wide()){
      const tracks=dblTracks(head); if(tracks.length!==cells.length){ markWide(d, d); return; }
      const gap=parseFloat(getComputedStyle(head).columnGap)||0;
      const pad=(parseFloat(getComputedStyle(head).paddingLeft)||0)+(parseFloat(getComputedStyle(head).paddingRight)||0)+2;
      const ws=cells.map((c,i)=>{ const v=c.dataset.sort && saved[c.dataset.sort]; return v?Math.max(MIN_W,v):Math.round(c.getBoundingClientRect().width); });
      const extra=gap*(cells.length-1)+pad;
      fitToBox(ws, cells, d.clientWidth-extra);
      const tpl=ws.map(w=>w+'px').join(' '), total=ws.reduce((a,b)=>a+b,0)+extra;
      rows.forEach(r=>{ if(dblTracks(r).length===ws.length){ r.style.gridTemplateColumns=tpl; r.style.minWidth=total+'px'; } });
      d.classList.add('cols-fixed');
    }
    markWide(d, d);
  }

  /* ---------- trascinamento e doppio clic ---------- */
  let drag=null, suppressUntil=0;
  function owner(cell){ return cell.closest('table.data-table') || cell.closest('.dbl'); }
  function colIndex(cell){ return [...cell.parentElement.children].indexOf(cell); }
  function colKeyOf(box, cell){ return box.matches('table') ? thKey(cell, colIndex(cell)) : cell.dataset.sort; }
  function setWidth(box, cell, w, save){
    const key=boxKey(box), ck=colKeyOf(box, cell); if(!ck) return;
    store[key]=store[key]||{};
    store[key][ck]=Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
    const ks=Object.keys(store[key]); if(ks.length>MAX_COLS_SAVED) delete store[key][ks[0]];
    if(save) persist();
    box.matches('table') ? layoutTable(box) : layoutDbl(box);
  }
  function autoFit(box, cell){
    const i=colIndex(cell); let w=natural(cell);
    if(box.matches('table')){
      const rows=[...box.rows].slice(0,400);
      rows.forEach(r=>{ const c=r.cells[i]; if(c && c.colSpan===1 && c!==cell) w=Math.max(w, natural(c)); });
    } else {
      dblRows(box).slice(0,400).forEach(r=>{ const c=r.children[i]; if(c && c!==cell) w=Math.max(w, natural(c)); });
    }
    setWidth(box, cell, w, true);
  }

  document.addEventListener('pointerdown',e=>{
    const h=e.target.closest && e.target.closest('.col-rs'); if(!h || e.button>0) return;
    const cell=h.parentElement, box=owner(cell); if(!box) return;
    e.preventDefault(); e.stopPropagation();
    drag={ box, cell, x:e.clientX, w:cell.getBoundingClientRect().width, id:e.pointerId, moved:false };
    try{ h.setPointerCapture(e.pointerId); }catch(_){}
    document.body.classList.add('col-resizing');
  }, true);
  document.addEventListener('pointermove',e=>{
    if(!drag || e.pointerId!==drag.id) return;
    const dx=e.clientX-drag.x; if(!drag.moved && Math.abs(dx)<3) return;
    drag.moved=true; setWidth(drag.box, drag.cell, drag.w+dx, false); e.preventDefault();
  }, true);
  const endDrag=e=>{ if(!drag || (e && e.pointerId!==drag.id)) return;
    if(drag.moved){ persist(); suppressUntil=Date.now()+400; }
    drag=null; document.body.classList.remove('col-resizing'); };
  document.addEventListener('pointerup',endDrag,true);
  document.addEventListener('pointercancel',endDrag,true);
  // i clic sul bordo (o subito dopo un trascinamento) non devono riordinare la colonna
  document.addEventListener('click',e=>{
    if((e.target.closest && e.target.closest('.col-rs')) || (Date.now()<suppressUntil && e.target.closest && e.target.closest('th,.dbl-head'))){
      e.stopPropagation(); e.preventDefault(); }
  }, true);
  document.addEventListener('dblclick',e=>{
    const h=e.target.closest && e.target.closest('.col-rs'); if(!h) return;
    e.stopPropagation(); e.preventDefault();
    const cell=h.parentElement, box=owner(cell); if(box) autoFit(box, cell);
  }, true);

  /* ---------- quando le tabelle cambiano ---------- */
  let pending=new Set(), scheduled=false, mo=null;
  function process(){
    scheduled=false;
    const list=[...pending]; pending.clear();
    list.forEach(b=>{ if(!b.isConnected || !b.offsetParent) return;
      try{ b.matches('table') ? layoutTable(b) : layoutDbl(b); }catch(err){ /* mai bloccare la pagina per l'impaginazione */ } });
    if(mo) mo.takeRecords();   // ignora le modifiche fatte qui sopra
  }
  function queue(b){ if(!b) return; pending.add(b); if(!scheduled){ scheduled=true; queueMicrotask(process); } }
  function boxesIn(node){
    if(!node || node.nodeType!==1) return [];
    const out=[]; const own=node.closest('table.data-table, .dbl'); if(own) out.push(own);
    if(node.querySelectorAll) node.querySelectorAll('table.data-table, .dbl').forEach(x=>out.push(x));
    return out;
  }
  function refresh(){ document.querySelectorAll('table.data-table, .dbl').forEach(queue); }
  function start(){
    const scope=document.querySelector('.main') || document.body;
    mo=new MutationObserver(recs=>{ recs.forEach(r=>{
      if(r.type==='attributes'){ if(r.target.classList && r.target.classList.contains('dbl')) queue(r.target); return; }
      boxesIn(r.target).forEach(queue); }); });
    // anche il cambio di classe: un contenitore diventa .dbl passando da "schede" a "elenco"
    mo.observe(scope, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    let rt=null; root.addEventListener('resize',()=>{ clearTimeout(rt); rt=setTimeout(refresh,120); });
    refresh();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start); else start();

  root.LFTables={ refresh, reset(key){ if(key) delete store[key]; else store={}; persist(); refresh(); } };
})(window);
