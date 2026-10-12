/* artista.js — portale artista: statement royalty in sola lettura.
   Lo statement lo calcola la Edge Function artist-statement (solo le righe di
   questo artista); qui viene solo mostrato. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const q=new URLSearchParams(location.search);
  const token=q.get('t')||q.get('token');
  const cfg=window.LF_CONFIG||{};
  const sb=(window.supabase&&cfg.supabaseUrl)?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
  const EUR=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(+n||0);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtD=d=>{ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||''); return m ? m[3]+'/'+m[2]+'/'+m[1] : esc(d||''); };
  function show(id){ ['loading','error','content'].forEach(x=>$(x).classList.toggle('hidden',x!==id)); }
  // ultimi n mesi interi, in ora locale
  function period(n){
    if(!n) return {from:null,to:null,label:'Tutti i periodi'};
    const now=new Date();
    return { from:LFCore.ymd(new Date(now.getFullYear(), now.getMonth()-(n-1), 1)), to:LFCore.today(), label:'Ultimi '+n+' mesi' };
  }
  async function load(n){
    const p=period(n);
    if(!token||!sb){ show('error'); return; }
    show('loading');
    try{
      const { data, error } = await sb.functions.invoke('artist-statement',{ body:{ token, from:p.from, to:p.to } });
      if(error||!data||data.error||!data.ok){ show('error'); return; }
      render(data, p);
    }catch(e){ show('error'); }
  }
  function render(d, p){
    const L=d.label||{}; const labelName=L.name||'Label';
    $('lh-name').textContent=labelName; $('f-label').textContent=labelName;
    const logo=LFCore.safeImgSrc(L.logo);
    if(logo){ $('lh-logo').src=logo; $('lh-logo').classList.remove('hidden'); } else $('lh-logo').classList.add('hidden');
    $('lh-date').textContent=new Date().toLocaleDateString('it-IT');
    const s=d.statement||{};
    $('m-artist').textContent=s.artist||'';
    $('m-period').textContent=p.label;
    const rows=s.lines||[];
    $('rows').innerHTML = rows.length ? rows.map(l=>`<tr>
       <td>${fmtD(l.date)}</td><td>${esc(l.product)||'—'}</td><td>${esc(l.catalog)}</td>
       <td class="r">${EUR(l.gross)}</td><td class="r">${esc(+l.pct||0)}%</td><td class="r b pos">${EUR(l.share)}</td></tr>`).join('')
       : `<tr><td colspan="6" class="mut">Nessuna royalty nel periodo selezionato.</td></tr>`;
    $('t-total').textContent=EUR(s.total);
    if(s.recoupable>0){ $('recoup').classList.remove('hidden');
      $('r-recoupable').textContent=EUR(s.recoupable); $('r-recouped').textContent=EUR(s.recouped); $('r-residual').textContent=EUR(s.residual);
    } else $('recoup').classList.add('hidden');
    $('t-net').textContent=EUR(s.netPay);
    if(s.paidToDate>0 || s.paidInPeriod>0){ $('paid').classList.remove('hidden');
      $('p-period').textContent=EUR(s.paidInPeriod); $('p-total').textContent=EUR(s.paidToDate); $('p-balance').textContent=EUR(s.balance);
    } else $('paid').classList.add('hidden');
    show('content');
  }
  $('periods').addEventListener('click',e=>{ const b=e.target.closest('button[data-n]'); if(!b) return;
    document.querySelectorAll('#periods button[data-n]').forEach(x=>x.classList.toggle('on',x===b));
    load(+b.dataset.n); });
  $('btn-print').addEventListener('click',()=>window.print());
  load(0);
})();
