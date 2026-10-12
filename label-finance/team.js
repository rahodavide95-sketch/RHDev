/* ============================================================================
   team.js — scheda "Team" nelle Impostazioni (piano Agency)
   Il titolare invita un'email come "sola lettura" o "può modificare"; la persona
   invitata, entrando con quell'email, trova l'etichetta nel menu account.
   Le regole di accesso stanno nel database (team_members + lf_role in schema.sql);
   qui c'è solo l'interfaccia. Il cambio di etichetta lo fa sync.js.
   ============================================================================ */
let teamCache=null;
async function renderTeam(force){
  const box=document.getElementById('team-box'); if(!box) return;
  const ws=window.LF_workspace ? window.LF_workspace() : null;
  if(ws){   // si sta lavorando sull'etichetta di un altro titolare: il suo team lo gestisce lui
    box.innerHTML=`<p class="small">${esc(tt(ws.role==='viewer'?'team.banner_viewer':'team.banner_editor').replace('{who}', ws.label||ws.email||'—'))}</p>
      <button class="btn btn-sm" type="button" data-ws="">${esc(tt('team.back'))}</button>`;
    return;
  }
  if(!window.LF_isSignedIn || !window.LF_isSignedIn()){ box.innerHTML=`<p class="muted small">${esc(tt('team.need_login'))}</p>`; return; }
  if(!can('team')){
    box.innerHTML=`<p class="small">${esc(tt('team.need_plan'))}</p><button class="btn btn-sm" type="button" data-goto="offers">${esc(tt('team.see_plans'))}</button>`;
    return;
  }
  if(force || !teamCache){ box.innerHTML=`<p class="muted small">${esc(tt('ver.loading'))}</p>`; teamCache=await window.LF_teamList(); }
  const list=teamCache;
  if(list && list.error){ box.innerHTML=`<p class="muted small">${esc(tt('team.unavailable'))}</p>`; return; }
  const rows=(list||[]).map(m=>`<div class="team-row"><div class="trash-main"><b>${esc(m.email)}</b>
      <span class="muted small">${esc(tt(m.role==='editor'?'team.role_editor':'team.role_viewer'))}</span></div>
      <div class="trash-acts"><select class="select team-role-sel" data-team-role="${esc(m.email)}" aria-label="${esc(tt('team.role'))}">
        <option value="viewer"${m.role==='viewer'?' selected':''}>${esc(tt('team.role_viewer'))}</option>
        <option value="editor"${m.role==='editor'?' selected':''}>${esc(tt('team.role_editor'))}</option></select>
      <button class="icon-btn-sm" type="button" data-team-del="${esc(m.email)}" title="${esc(tt('team.remove'))}" aria-label="${esc(tt('team.remove'))}">✕</button></div></div>`).join('');
  box.innerHTML=(rows||`<p class="muted small">${esc(tt('team.none'))}</p>`)
    +`<div class="team-invite">
        <input class="input" id="team-email" type="email" autocomplete="off" placeholder="${esc(tt('team.email_ph'))}" aria-label="Email">
        <select class="select" id="team-role" aria-label="${esc(tt('team.role'))}"><option value="viewer">${esc(tt('team.role_viewer'))}</option><option value="editor">${esc(tt('team.role_editor'))}</option></select>
        <button class="btn btn-primary btn-sm" id="team-add" type="button">${esc(tt('team.invite'))}</button>
      </div>
      <p class="muted small">${esc(tt('team.how'))}</p>`;
}
async function teamInvite(){
  const em=document.getElementById('team-email'), role=document.getElementById('team-role').value;
  const r=await window.LF_teamInvite(em.value, role, labelName());
  if(r && r.ok){ toast(tt('team.invited').replace('{e}', em.value.trim())); teamCache=null; renderTeam(true); return; }
  toast(tt(r && r.error==='email' ? 'team.err_email' : r && r.error==='self' ? 'team.err_self' : 'team.unavailable'));
}
document.addEventListener('click', async e=>{
  if(e.target.closest('#team-add')){ teamInvite(); return; }
  const d=e.target.closest('[data-team-del]'); if(d){
    if(!confirm(tt('team.remove_q').replace('{e}', d.dataset.teamDel))) return;
    const r=await window.LF_teamRemove(d.dataset.teamDel); if(r && r.ok){ teamCache=null; renderTeam(true); toast(tt('team.removed')); } else toast(tt('team.unavailable'));
  }
});
document.addEventListener('change', async e=>{
  const s=e.target.closest('[data-team-role]'); if(!s) return;
  const r=await window.LF_teamInvite(s.dataset.teamRole, s.value, labelName());
  if(r && r.ok){ teamCache=null; toast(tt('common.saved')); renderTeam(true); } else toast(tt('team.unavailable'));
});
document.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target && e.target.id==='team-email'){ e.preventDefault(); teamInvite(); } });
