/* ============================================================================
   search.js — ricerca globale (Ctrl+K / ⌘K, oppure la lente in alto)
   Un solo campo per trovare sezioni, artisti, release e tracce, contratti,
   movimenti, task, merch, eventi e pianificazione. Frecce per scegliere,
   Invio per aprire, Esc per chiudere.
   Usa le funzioni globali di app.js (DB, goto, openRelease, openTx, …).
   ============================================================================ */
const GS_MAX_PER_GROUP=6, GS_MAX_TX=8;
const gsNorm=s=>String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
let gsItems=[], gsResults=[], gsSel=0;

function gsSectionName(v){ const k='nav.'+v, t=tt(k); return (t && t!==k) ? t : (VIEW_TITLES[v]||v); }
/* tutto ciò che si può cercare, con il testo su cui cercare (hay) e cosa fare all'apertura */
function gsBuild(){
  const items=[];
  const add=(group, title, sub, hay, open, icon)=>items.push({ group, title:String(title||''), sub:String(sub||''), hay:gsNorm(hay+' '+title+' '+sub), open, icon:icon||'' });
  // sezioni
  Object.keys(VIEW_TITLES).forEach(v=>{ if(v==='consolidated' && !document.querySelector('.nav-item[data-view="consolidated"]:not([hidden])')) return;
    add('sections', gsSectionName(v), '', v+' '+VIEW_TITLES[v], ()=>goto(v), '→'); });
  // artisti: rubrica + nomi trovati in release e movimenti
  const seen=new Set();
  (DB.artists||[]).forEach(a=>{ seen.add(normArt(a.name)); add('artists', a.name, [a.legal, a.email].filter(Boolean).join(' · '), [a.legal,a.email,a.phone,a.iban].join(' '), ()=>openArtistSheet(a.name), '👤'); });
  const extra=new Map();
  (DB.releases||[]).forEach(r=>{ splitArtistNames(r.artist).forEach(n=>extra.set(normArt(n), n.trim())); (r.splits||[]).forEach(s=>extra.set(normArt(s.name), (s.name||'').trim())); });
  (DB.transactions||[]).forEach(t=>splitArtistNames(t.artist).forEach(n=>{ const k=normArt(n); if(k && !extra.has(k)) extra.set(k, n.trim()); }));
  extra.forEach((n,k)=>{ if(!k || seen.has(k) || ART_NOLINK.has(n.toLowerCase())) return; seen.add(k); add('artists', n, tt('art.sheet_not_in'), '', ()=>openArtistSheet(n), '👤'); });
  // release e tracce
  (DB.releases||[]).forEach(r=>{
    add('releases', [r.catalog, r.title].filter(Boolean).join(' · '), [r.artist, r.type, r.year].filter(Boolean).join(' · '), [r.upc, r.note].join(' '), ()=>openRelease(r.id), '💿');
    (r.tracks||[]).forEach(tr=>{ if(!tr.title && !tr.isrc) return;
      add('tracks', tr.title||tr.isrc, [r.catalog, tr.artist||r.artist, tr.isrc].filter(Boolean).join(' · '), [tr.isrc, tr.writtenBy, tr.producedBy].join(' '), ()=>openRelease(r.id), '🎵'); });
  });
  // contratti
  (DB.contracts||[]).forEach(c=>add('contracts', c.titles||'—', [c.projectName||c.fullName, c.status?tt('con.st_'+c.status):''].filter(Boolean).join(' · '), [c.fullName,c.projectName,c.artistNames,c.email].join(' '), ()=>{ goto('contracts'); openContract(c.id); }, '📄'));
  // task, merch, pianificazione, eventi, support
  (DB.tasks||[]).forEach(t=>add('tasks', t.title, [t.due?fmtDate(t.due):'', t.done?'✓':''].filter(Boolean).join(' · '), '', ()=>goto('tasks'), '☑'));
  (DB.merch||[]).forEach(m=>add('merch', m.name, fmtMoney(m.price||0), m.type, ()=>{ goto('merch'); openMerchForm(m.id); }, '👕'));
  (DB.planning||[]).forEach(p=>add('planning', p.title, [p.date?fmtDate(p.date):'', p.artist].filter(Boolean).join(' · '), p.note, ()=>{ goto('planning'); openPlnForm(p.id); }, '🗓'));
  (DB.events||[]).forEach(e=>add('events', e.title, [e.date?fmtDate(e.date):'', e.venue, e.city].filter(Boolean).join(' · '), e.note, ()=>{ goto('events'); openEvtForm(e.id); }, '🎤'));
  (DB.supports||[]).forEach(s=>add('supports', [s.dj, s.track].filter(Boolean).join(' — '), [s.date?fmtDate(s.date):'', s.venue].filter(Boolean).join(' · '), s.note, ()=>{ goto('supports'); openSupForm(s.id); }, '🎧'));
  // movimenti (i più recenti prima)
  (DB.transactions||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).forEach(t=>{
    const amt=(t.kind==='income'?'+':'−')+fmtMoney(Math.abs(+t.net||0), t.currency||'EUR');
    add('transactions', t.product||t.platform||'—', [t.date?fmtDate(t.date):'', t.platform, t.artist, amt].filter(Boolean).join(' · '), [t.catalog,t.isrc,t.upc,t.code,t.note,t.territory].join(' '), ()=>openTx(t.id), t.kind==='income'?'↗':'↘');
  });
  return items;
}
function gsSearch(q){
  const words=gsNorm(q).split(/\s+/).filter(Boolean);
  if(!words.length) return gsItems.filter(i=>i.group==='sections');
  const scored=[];
  for(const it of gsItems){
    if(!words.every(w=>it.hay.includes(w))) continue;
    const tl=gsNorm(it.title); let s=0;
    if(tl===words.join(' ')) s+=100; else if(tl.startsWith(words[0])) s+=40; else if(tl.includes(words[0])) s+=15;
    if(it.group==='sections') s+=5;
    scored.push({ it, s });
  }
  scored.sort((a,b)=>b.s-a.s);
  const per={}, out=[];
  for(const { it } of scored){
    const lim=it.group==='transactions'?GS_MAX_TX:GS_MAX_PER_GROUP;
    per[it.group]=(per[it.group]||0)+1; if(per[it.group]>lim) continue;
    out.push(it);
  }
  const order=['sections','artists','releases','tracks','contracts','tasks','merch','planning','events','supports','transactions'];
  return out.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group));
}
function gsRender(){
  const list=document.getElementById('gs-list'); if(!list) return;
  const q=document.getElementById('gs-input').value;
  gsResults=gsSearch(q); if(gsSel>=gsResults.length) gsSel=Math.max(0, gsResults.length-1);
  if(!gsResults.length){ list.innerHTML=`<div class="gs-empty">${esc(tt('gs.none'))}</div>`; return; }
  let last='', html='';
  gsResults.forEach((it,i)=>{
    if(it.group!==last){ html+=`<div class="gs-group">${esc(tt('gs.g_'+it.group))}</div>`; last=it.group; }
    html+=`<button type="button" class="gs-item${i===gsSel?' is-sel':''}" data-gs="${i}" role="option" aria-selected="${i===gsSel}">
      <span class="gs-ico" aria-hidden="true">${esc(it.icon)}</span><span class="gs-txt"><b>${esc(it.title)}</b>${it.sub?`<span class="muted small">${esc(it.sub)}</span>`:''}</span></button>`;
  });
  list.innerHTML=html;
  const sel=list.querySelector('.gs-item.is-sel'); if(sel) sel.scrollIntoView({ block:'nearest' });
}
function gsOpen(){
  const m=document.getElementById('gs-modal'); if(!m) return;
  gsItems=gsBuild(); gsSel=0;
  const inp=document.getElementById('gs-input'); inp.value='';
  m.hidden=false; gsRender(); setTimeout(()=>inp.focus(), 20);
}
function gsClose(){ const m=document.getElementById('gs-modal'); if(m) m.hidden=true; }
function gsPick(i){ const it=gsResults[i]; if(!it) return; gsClose(); try{ it.open(); }catch(e){} }
(function wireSearch(){
  const inp=document.getElementById('gs-input'); if(!inp) return;
  inp.addEventListener('input',()=>{ gsSel=0; gsRender(); });
  inp.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); gsSel=Math.min(gsResults.length-1, gsSel+1); gsRender(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); gsSel=Math.max(0, gsSel-1); gsRender(); }
    else if(e.key==='Enter'){ e.preventDefault(); gsPick(gsSel); }
    else if(e.key==='Escape'){ e.preventDefault(); gsClose(); }
  });
  document.getElementById('gs-list').addEventListener('click',e=>{ const b=e.target.closest('[data-gs]'); if(b) gsPick(+b.dataset.gs); });
  document.getElementById('gs-modal').addEventListener('click',e=>{ if(e.target.id==='gs-modal') gsClose(); });
  const btn=document.getElementById('gs-btn'); if(btn) btn.addEventListener('click',gsOpen);
  // Ctrl+K / ⌘K ovunque; "/" quando non si sta scrivendo in un campo
  document.addEventListener('keydown',e=>{
    if(document.body.classList.contains('gated')) return;
    const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||'') || (e.target&&e.target.isContentEditable);
    if((e.ctrlKey||e.metaKey) && !e.altKey && (e.key==='k'||e.key==='K')){ e.preventDefault(); const m=document.getElementById('gs-modal'); (m&&!m.hidden)?gsClose():gsOpen(); }
    else if(e.key==='/' && !typing && !e.ctrlKey && !e.metaKey){ e.preventDefault(); gsOpen(); }
  });
  // suggerimento della scorciatoia (⌘K su Mac)
  const mac=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent||'');
  const k=document.getElementById('gs-kbd'); if(k) k.textContent=mac?'⌘K':'Ctrl K';
})();
