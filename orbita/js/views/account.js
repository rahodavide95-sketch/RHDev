/* ============================================================================
   account.js — Profilo (stile Impostazioni): profilo, account, sicurezza, dati
   ============================================================================ */
import { app } from '../ctx.js';
import * as store from '../store.js';
import * as cloud from '../cloud.js';
import { countries, searchPlaces } from '../geo.js';
import { esc, flag, icon, toast, openModal, confirmDialog, promptDialog, downloadFile, initials, todayStr, fmtDate } from '../util.js';
import { openAuth, openNewPassword, rememberInvite } from './auth.js';
import { attachAC, placeRow } from './editor.js';

const row = ({ ic, color, title, sub = '', val = '', act = '', chev = true, tag = 'button', extra = '' }) =>
  `<${tag} class="list-row has-icon" ${tag === 'button' ? 'type="button"' : ''} ${act ? `data-act="${act}"` : ''}>
    <span class="app-ic" style="--c:${color}">${icon(ic)}</span>
    <span class="grow"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    ${val ? `<span class="val">${esc(val)}</span>` : ''}${extra}${chev ? icon('chev', 'chev') : ''}
  </${tag}>`;

let mfaCache = null;
let handledInvite = '';

export function render(el, params) {
  const user = cloud.getUser();
  const st = store.get();
  const p = st.profile;
  const s = app.stats;
  const configured = cloud.isConfigured();
  const { status, lastError } = cloud.getStatus();
  const inviteId = params[0] === 'invite' ? params[1] : null;

  if (inviteId && user && handledInvite !== inviteId) {
    handledInvite = inviteId;
    // invito aperto da utente già collegato: sincronizza e apri il viaggio
    cloud.sync().then(() => {
      if (store.findTrip(inviteId)) app.go(`#/viaggio/${encodeURIComponent(inviteId)}`);
      else { toast('Questo invito non è per questo account: entra con l\'email a cui è arrivato.', { type: 'error', ms: 7000 }); app.go('#/account'); }
    });
  }

  let html = `<div class="nav-row"><h1 class="large-title">Profilo</h1></div>
    <div class="profile-head">
      <div class="big-avatar">${esc(initials(p.name, user && user.email) || '🙂')}</div>
      <h2>${esc(p.name || 'Viaggiatore')}</h2>
      <div class="footnote secondary">${user ? esc(user.email) : configured ? 'Non hai ancora fatto l\'accesso' : 'Dati salvati solo su questo dispositivo'}</div>
      <div style="margin-top:10px"><span class="pill yellow">${s.level.emoji} ${esc(s.level.name)}</span></div>
    </div>`;

  if (inviteId && !user) {
    rememberInvite(inviteId);
    html += `<div class="widget w2 vivid" style="--c:var(--indigo);margin-top:18px">
      <div class="w-label">${icon('mail')}Hai un invito</div>
      <div class="headline" style="margin-top:8px">Qualcuno ha condiviso un viaggio con te ✈️</div>
      <div class="w-sub">Entra (o registrati) con l'email a cui è arrivato l'invito per vederlo.</div>
      <div class="row" style="margin-top:12px"><button class="btn btn-sm" type="button" data-act="signin" style="background:#fff;color:#000">Accedi</button><button class="btn btn-sm" type="button" data-act="signup">Registrati</button></div>
    </div>`;
  }

  // --- profilo ---
  html += `<div class="list-header">Il mio profilo</div><div class="list">
    ${row({ ic: 'user', color: 'var(--blue)', title: 'Nome', val: p.name || 'Aggiungi', act: 'name' })}
    ${row({ ic: 'home', color: 'var(--orange)', title: 'Casa', val: p.home ? p.home.name : 'Scegli', act: 'home' })}
    <label class="list-row has-icon"><span class="app-ic" style="--c:var(--green)">${icon('passport')}</span><span class="grow"><b>Nazionalità</b></span>
      <select class="select" data-act="nat" style="width:auto;height:34px;background-color:transparent;text-align:right;padding-right:30px" aria-label="Nazionalità">
        <option value="">—</option>${[...countries.values()].filter(c => c.s).map(c => `<option value="${c.c}" ${p.nat === c.c ? 'selected' : ''}>${flag(c.c)} ${esc(c.n)}</option>`).join('')}
      </select></label>
    <label class="list-row has-icon"><span class="app-ic" style="--c:var(--teal)">${icon('globe')}</span><span class="grow"><b>Conta il paese di casa</b><small>Il paese dove vivi vale come visitato</small></span>
      <span class="switch"><input type="checkbox" data-act="counthome" ${p.countHome ? 'checked' : ''}><span></span></span></label>
  </div>`;

  // --- aspetto ---
  const look = p.look === 'minimal' ? 'minimal' : 'color';
  html += `<div class="list-header">Aspetto</div><div class="list"><div class="look-grid" role="radiogroup" aria-label="Tema">
    ${[['color', 'Colori'], ['minimal', 'Minimal']].map(([k, l]) => `<button class="look-opt" type="button" role="radio" data-look="${k}" aria-pressed="${look === k}" aria-checked="${look === k}">
      <span class="look-swatch ${k}"></span>${l}<span class="look-check">${look === k ? icon('check') : ''}</span></button>`).join('')}
  </div></div>
  <p class="list-footer">Colori: blu notte e toni gioiello. Minimal: nero, grafite e avorio.</p>`;

  // --- account e cloud ---
  if (!configured) {
    html += `<div class="list-header">Account</div><div class="list">
      ${row({ ic: 'cloud', color: '#8e8e93', title: 'Cloud non ancora attivo', sub: 'L\'app funziona già: i dati restano su questo dispositivo', chev: false, tag: 'div' })}
    </div><p class="list-footer">Per account, sincronizzazione tra dispositivi e inviti via email serve un progetto Supabase gratuito: la guida passo passo è in <b>orbita/docs/SETUP.md</b>.</p>`;
  } else if (!user) {
    html += `<div class="list-header">Account</div><div class="list" style="padding:12px 16px">
        <div class="benefit"><span class="app-ic" style="--c:var(--blue)">${icon('cloud')}</span><div><b>Sempre con te</b><small>I viaggi su telefono, tablet e computer, sincronizzati.</small></div></div>
        <div class="benefit"><span class="app-ic" style="--c:var(--purple)">${icon('share')}</span><div><b>Condividi i viaggi</b><small>Invita i compagni di viaggio via email.</small></div></div>
        <div class="benefit"><span class="app-ic" style="--c:var(--green)">${icon('shield')}</span><div><b>Privato e sicuro</b><small>Solo tu (e chi inviti) vedi i tuoi dati. Niente pubblicità, niente tracciamento.</small></div></div>
        <div class="row" style="margin-top:12px"><button class="btn btn-prominent grow" type="button" data-act="signup">Crea account</button><button class="btn grow" type="button" data-act="signin">Accedi</button></div>
      </div>`;
  } else {
    const last = st.sync.last ? new Date(st.sync.last) : null;
    const syncSub = status === 'syncing' ? 'Sincronizzazione in corso…' : status === 'error' ? (lastError || 'Errore di sincronizzazione') : status === 'offline' ? 'Offline: sincronizzerò appena torni online' : last ? `Aggiornato ${last.toDateString() === new Date().toDateString() ? 'oggi' : fmtDate(todayStr(last), 'short')} alle ${last.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Mai sincronizzato';
    const verified = !!user.email_confirmed_at;
    html += `<div class="list-header">Account e sicurezza</div><div class="list">
      ${row({ ic: 'mail', color: 'var(--blue)', title: 'Email', sub: user.email, val: verified ? 'Verificata' : 'Da verificare', chev: false, tag: 'div' })}
      ${row({ ic: 'cloud', color: status === 'error' ? 'var(--red)' : 'var(--teal)', title: 'Sincronizzazione', sub: syncSub, act: 'sync' })}
      ${row({ ic: 'key', color: '#8e8e93', title: 'Cambia password', act: 'password' })}
      ${row({ ic: 'shield', color: 'var(--green)', title: 'Verifica in due passaggi', sub: 'Codice dall\'app di autenticazione', val: mfaCache === null ? '' : mfaCache.length ? 'Attiva' : 'Disattiva', act: 'mfa' })}
    </div>
    <div class="list" style="margin-top:12px">
      <button class="list-row danger" type="button" data-act="signout">Esci</button>
      <button class="list-row danger" type="button" data-act="signout-all">Esci da tutti i dispositivi</button>
    </div>`;
    if (mfaCache === null) cloud.mfaFactors().then(f => { mfaCache = f; if (app.route.name === 'account') app.render(); }).catch(() => { mfaCache = []; });
  }

  // --- dati ---
  html += `<div class="list-header">I tuoi dati</div><div class="list">
    ${row({ ic: 'download', color: 'var(--indigo)', title: 'Esporta tutto', sub: 'Un file JSON con viaggi e profilo', act: 'export' })}
    <label class="list-row has-icon" style="cursor:pointer"><span class="app-ic" style="--c:var(--purple)">${icon('upload')}</span><span class="grow"><b>Importa da file</b><small>Da un export di Orbita</small></span><input type="file" accept="application/json,.json" data-act="import" hidden></label>
    ${row({ ic: 'lock', color: 'var(--green)', title: 'Come proteggiamo i tuoi dati', act: 'privacy' })}
  </div>
  <div class="list" style="margin-top:12px">
    ${user ? '<button class="list-row danger" type="button" data-act="delete-account">Elimina account e dati</button>' : '<button class="list-row danger" type="button" data-act="wipe">Cancella i dati da questo dispositivo</button>'}
  </div>
  <p class="list-footer" style="text-align:center;margin-top:26px">Orbita 1.0 · Confini: Natural Earth · Città: GeoNames (CC BY 4.0) · Aeroporti: OurAirports · Globo: globe.gl</p>`;

  el.innerHTML = html;
  bind(el);
}

function bind(el) {
  el.onclick = async e => {
    const lk = e.target.closest('[data-look]');
    if (lk) {
      const look = lk.dataset.look;
      // ogni tema ha la sua colorazione del globo: la si cambia insieme (resta modificabile dai Livelli)
      if (look !== store.get().profile.look) store.updateProfile({ look, colorMode: look === 'minimal' ? 'mono' : 'continent' });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const act = b.dataset.act;
    if (act === 'signin' || act === 'signup') openAuth({ mode: act, message: app.route.params[0] === 'invite' ? 'Usa l\'email a cui è arrivato l\'invito.' : '' });
    if (act === 'name') {
      const v = await promptDialog({ title: 'Il tuo nome', value: store.get().profile.name, placeholder: 'Nome e cognome', ok: 'Salva', maxlength: 80 });
      if (v !== null) store.updateProfile({ name: v.trim() });
    }
    if (act === 'home') openHomePicker();
    if (act === 'sync') { await cloud.sync(); toast(cloud.getStatus().status === 'ok' ? 'Tutto sincronizzato ✓' : cloud.getStatus().lastError, { type: cloud.getStatus().status === 'ok' ? 'ok' : 'error' }); app.render(); }
    if (act === 'password') openNewPassword();
    if (act === 'mfa') openMfa();
    if (act === 'signout' || act === 'signout-all') {
      if (store.get().sync.dirty.length || store.get().sync.deleted.length) await cloud.sync();
      if (store.get().sync.dirty.length && !(await confirmDialog({ title: 'Modifiche non ancora salvate', text: 'Alcune modifiche non sono arrivate al cloud (sei offline?). Se esci adesso andranno perse.', ok: 'Esci comunque', danger: true }))) return;
      await cloud.signOut(act === 'signout-all' ? 'global' : 'local');
      mfaCache = null;
      toast('Sei uscito. I dati dell\'account sono stati tolti da questo dispositivo.');
    }
    if (act === 'export') {
      downloadFile(`orbita-${todayStr()}.json`, JSON.stringify(store.exportData(), null, 2));
      toast('Export scaricato', { type: 'ok' });
    }
    if (act === 'privacy') openPrivacy();
    if (act === 'wipe') {
      if (!(await confirmDialog({ title: 'Cancellare tutto?', text: 'Viaggi, profilo e paesi segnati verranno eliminati da questo dispositivo. Non si può annullare: esporta prima, se vuoi tenerli.', ok: 'Cancella tutto', danger: true }))) return;
      store.wipe();
      store.load('guest');
      toast('Dati cancellati');
      app.go('#/');
    }
    if (act === 'delete-account') {
      if (!(await confirmDialog({ title: 'Eliminare l\'account?', text: 'Account, viaggi e inviti verranno cancellati per sempre dai nostri server. I viaggi che altri hanno condiviso con te restano loro.', ok: 'Continua', danger: true }))) return;
      const v = await promptDialog({ title: 'Conferma', text: 'Scrivi ELIMINA per confermare.', placeholder: 'ELIMINA', ok: 'Elimina per sempre' });
      if (v === null || v.trim().toUpperCase() !== 'ELIMINA') { toast('Eliminazione annullata'); return; }
      try { await cloud.deleteAccount(); toast('Account eliminato. Buon viaggio 👋'); }
      catch (x) { toast(cloud.friendlyError(x), { type: 'error' }); }
    }
  };
  el.onchange = async e => {
    const t = e.target;
    if (t.dataset.act === 'nat') store.updateProfile({ nat: t.value });
    if (t.dataset.act === 'counthome') store.updateProfile({ countHome: t.checked });
    if (t.dataset.act === 'import' && t.files[0]) {
      const f = t.files[0];
      if (f.size > 5e6) { toast('File troppo grande (max 5 MB)', { type: 'error' }); return; }
      try { const n = store.importData(JSON.parse(await f.text())); toast(`Importati ${n} viaggi`, { type: 'ok' }); }
      catch (x) { toast(x.message || 'File non valido', { type: 'error' }); }
      t.value = '';
    }
  };
}

function openHomePicker() {
  const m = openModal({ title: 'Dove vivi?', body: `<p class="secondary">La tua casa è il punto di partenza sul globo e per le distanze.</p>
    <div class="ac"><input class="input" data-home placeholder="Cerca la tua città" autocomplete="off"></div>
    ${store.get().profile.home ? '<button class="btn btn-plain btn-block" type="button" data-clear style="margin-top:10px">Rimuovi casa</button>' : ''}` });
  const inp = m.body.querySelector('[data-home]');
  attachAC(inp, {
    search: q => searchPlaces(q, 7).then(r => r.filter(x => x.type === 'city')),
    render: placeRow,
    onPick: p => {
      store.updateProfile({ home: { name: p.name, cc: p.cc, lat: p.lat, lng: p.lng, region: p.region, regionKey: p.regionKey } });
      m.close();
      toast(`🏠 Casa: ${p.name}`, { type: 'ok' });
      if (app.globe) app.globe.flyTo(p.lat, p.lng, undefined, 1200);
    },
  });
  setTimeout(() => inp.focus(), 120);
  const c = m.body.querySelector('[data-clear]');
  if (c) c.onclick = () => { store.updateProfile({ home: null }); m.close(); };
}

async function openMfa() {
  const m = openModal({ title: 'Verifica in due passaggi', body: '<p class="secondary">Carico…</p>' });
  const show = async () => {
    let factors = [];
    try { factors = await cloud.mfaFactors(); } catch (x) { m.body.innerHTML = `<p class="secondary">${esc(cloud.friendlyError(x))}</p>`; return; }
    mfaCache = factors;
    if (factors.length) {
      m.body.innerHTML = `<div class="auth-hero"><div class="orb">🔐</div><h2 class="title2">Attiva</h2>
        <p class="secondary" style="margin-top:6px">Per entrare serve la password e il codice dell'app di autenticazione. Anche chi scoprisse la tua password resterebbe fuori.</p></div>
        <button class="btn btn-destructive btn-block" type="button" data-off>Disattiva</button>`;
      m.body.querySelector('[data-off]').onclick = async () => {
        if (!(await confirmDialog({ title: 'Disattivare?', text: 'Il tuo account sarà protetto solo dalla password.', ok: 'Disattiva', danger: true }))) return;
        try { for (const f of factors) await cloud.mfaRemove(f.id); toast('Verifica in due passaggi disattivata'); show(); app.render(); }
        catch (x) { toast(cloud.friendlyError(x), { type: 'error' }); }
      };
      return;
    }
    m.body.innerHTML = `<div class="auth-hero"><div class="orb">🛡️</div><h2 class="title2">Proteggi il tuo account</h2>
      <p class="secondary" style="margin-top:6px">Oltre alla password, ti chiederemo un codice che cambia ogni 30 secondi, generato da un'app come Password di Apple, Google Authenticator o 1Password.</p></div>
      <button class="btn btn-prominent btn-block" type="button" data-on>Configura</button>`;
    m.body.querySelector('[data-on]').onclick = async () => {
      let en;
      try { en = await cloud.mfaEnroll(); } catch (x) { toast(cloud.friendlyError(x), { type: 'error' }); return; }
      const qrOk = typeof en.qr === 'string' && en.qr.startsWith('data:image/svg+xml');
      m.body.innerHTML = `<p class="secondary">1. Inquadra il codice con l'app di autenticazione (o tocca a lungo per aprirlo).</p>
        ${qrOk ? `<div class="qr"><img alt="Codice QR per la verifica in due passaggi" src="${esc(en.qr)}"></div>` : ''}
        <p class="caption secondary">Oppure inserisci a mano questa chiave:</p><div class="secret">${esc(en.secret)}</div>
        <p class="secondary" style="margin-top:14px">2. Scrivi il codice a 6 cifre che vedi nell'app.</p>
        <form class="stack" novalidate><input class="input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Codice a 6 cifre">
        <div class="form-msg err" hidden></div><button class="btn btn-prominent btn-block" type="submit">Attiva</button></form>`;
      const form = m.body.querySelector('form');
      form.code.oninput = () => { form.code.value = form.code.value.replace(/\D/g, '').slice(0, 6); };
      form.onsubmit = async ev => {
        ev.preventDefault();
        try { await cloud.mfaVerify(en.id, form.code.value); toast('Verifica in due passaggi attiva 🔐', { type: 'ok' }); mfaCache = null; m.close(); app.render(); }
        catch (x) { const msg = form.querySelector('.form-msg'); msg.textContent = cloud.friendlyError(x); msg.hidden = false; }
      };
    };
  };
  show();
}

function openPrivacy() {
  openModal({ title: 'Privacy e sicurezza', body: `<div class="stack">
    <div class="benefit"><span class="app-ic" style="--c:var(--green)">${icon('lock')}</span><div><b>Solo tu vedi i tuoi viaggi</b><small>Ogni riga del database è protetta da regole (Row Level Security): il server stesso rifiuta chi non è il proprietario o un invitato.</small></div></div>
    <div class="benefit"><span class="app-ic" style="--c:var(--blue)">${icon('mail')}</span><div><b>Inviti legati all'email</b><small>Un viaggio condiviso si apre solo entrando con l'indirizzo invitato e verificato. Puoi revocare l'accesso in ogni momento.</small></div></div>
    <div class="benefit"><span class="app-ic" style="--c:var(--indigo)">${icon('shield')}</span><div><b>Accesso protetto</b><small>Password robuste, verifica in due passaggi facoltativa, connessione sempre cifrata (HTTPS). All'uscita i dati dell'account vengono tolti dal dispositivo.</small></div></div>
    <div class="benefit"><span class="app-ic" style="--c:var(--orange)">${icon('search')}</span><div><b>Ricerche private</b><small>Città e aeroporti si cercano dentro l'app, senza mandare le tue ricerche a nessuno. Niente pubblicità, niente tracciamento, nessuna libreria esterna caricata da altri siti.</small></div></div>
    <div class="benefit"><span class="app-ic" style="--c:var(--purple)">${icon('download')}</span><div><b>I dati sono tuoi</b><small>Esportali quando vuoi in un file. Se elimini l'account, viaggi e inviti spariscono anche dal server.</small></div></div>
  </div>` });
}
