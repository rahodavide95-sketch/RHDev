/* Impostazioni: dati dell'etichetta (nome, logo, firma), avvisi email, indirizzo dei link,
   sicurezza (chiave di cifratura, codice di recupero, verifica in due passaggi). */

import { h, swap, icon, clear, append, imageToDataUrl, pickFile } from '../../ui/dom.js';
import { attachSignature } from '../../ui/signature.js';
import * as C from '../../core/crypto.js';
import { safeImage } from '../../core/theme.js';
import { A, artistBase } from '../state.js';
import * as K from '../keys.js';
import { btn, field, input, toast, friendly, toggle, modal, confirmBox, copyText } from '../ui.js';
import { showRecovery } from '../app.js';

export async function render(el) {
  A.settings = await A.api.getSettings();
  const s = A.settings;
  const saveNow = async (patch, msg = 'Salvato') => {
    try { A.settings = await A.api.saveSettings(patch); toast(msg, { type: 'ok' }); return true; }
    catch (x) { toast(friendly(x), { type: 'error' }); return false; }
  };

  /* etichetta */
  const name = input({ type: 'text', maxlength: 120, value: s.label_name || '' });
  const signer = input({ type: 'text', maxlength: 120, value: s.label_signer || '', placeholder: 'Chi firma per l\'etichetta (es. Davide Raho)' });
  const logoBox = h('div.logo-box');
  const drawLogo = () => {
    clear(logoBox);
    const src = safeImage(A.settings.logo || '');
    append(logoBox, [src ? h('img', { src, alt: 'Logo' }) : h('span.muted.small', 'Nessun logo'),
      btn(src ? 'Cambia' : 'Carica logo', async () => {
        const f = await pickFile('image/png,image/jpeg,image/webp');
        if (!f) return;
        try { const d = await imageToDataUrl(f, { max: 512, maxChars: 300000, keepAlpha: true }); if (await saveNow({ logo: d }, 'Logo salvato')) drawLogo(); }
        catch { toast('Scegli un\'immagine PNG, JPG o WebP', { type: 'error' }); }
      }, { ic: 'image', kind: 'ghost small' }),
      src ? btn('Togli', async () => { if (await saveNow({ logo: '' }, 'Logo tolto')) drawLogo(); }, { ic: 'x', kind: 'ghost small' }) : null]);
  };
  drawLogo();
  const sigBox = h('div.sig-box');
  const drawSig = () => {
    clear(sigBox);
    const src = safeImage(A.settings.label_signature || '');
    if (src) { sigBox.append(h('img.sig-img', { src, alt: 'Firma dell\'etichetta' }), h('div.row', btn('Rifai la firma', () => { A.settings.label_signature = ''; drawSigPad(); }, { ic: 'pen', kind: 'ghost small' }), btn('Togli', async () => { if (await saveNow({ label_signature: '' }, 'Firma tolta')) drawSig(); }, { ic: 'x', kind: 'ghost small' }))); }
    else drawSigPad();
  };
  const drawSigPad = () => {
    clear(sigBox);
    const cv = h('canvas.sig-canvas');
    const msg = h('p.muted.small');
    let pad;
    sigBox.append(cv, msg, h('div.row',
      btn('Cancella', () => pad && pad.clear(), { ic: 'x', kind: 'ghost small' }),
      btn('Carica da foto', async () => { const f = await pickFile('image/*'); if (f && pad) { try { await pad.loadFile(f); msg.textContent = 'Firma caricata ✓'; } catch { msg.textContent = 'Non vedo una firma nell\'immagine.'; } } }, { ic: 'image', kind: 'ghost small' }),
      btn('Salva firma', async () => { if (!pad || pad.isEmpty()) { toast('Firma nel riquadro'); return; } if (await saveNow({ label_signature: pad.png() }, 'Firma salvata')) drawSig(); }, { ic: 'check', kind: 'small' })));
    requestAnimationFrame(() => { pad = attachSignature(cv, { height: 150 }); });
  };
  drawSig();

  /* avvisi */
  const notify = input({ type: 'email', maxlength: 254, value: s.notify_email || '', placeholder: 'dove ricevere gli avvisi' });
  const mailState = h('span.muted.small', 'Controllo…');
  A.api.mailPing().then(on => { mailState.textContent = on ? 'Email attive ✓' : 'Email non ancora attive: gli avvisi li vedi qui nell\'app. Per attivarle segui docs/SETUP.md (Resend).'; }).catch(() => { mailState.textContent = ''; });

  /* link */
  const pub = input({ type: 'url', maxlength: 300, value: s.public_url || '', placeholder: new URL('invio.html', location.href.replace(/#.*$/, '')).href });

  /* sicurezza */
  const fp = h('code', '…');
  C.keyFingerprint(s.label_key.pub).then(x => { fp.textContent = x; });
  const rememberT = h('div');
  K.remembered().then(on => rememberT.append(toggle('Ricorda la chiave su questo dispositivo', on, async v => {
    if (v) { toast('Per ricordarla: blocca e sblocca spuntando "Ricorda su questo dispositivo"'); } else { await K.forget(); toast('Questo dispositivo non la ricorda più'); }
  }, 'Solo su un dispositivo tuo e protetto')));

  const changePass = () => {
    const m = modal({ title: 'Cambia password di cifratura' });
    const cur = input({ type: 'password', autocomplete: 'current-password', placeholder: 'Password attuale' });
    const nw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Nuova (almeno 10 caratteri)' });
    const nw2 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Ripeti la nuova' });
    const err = h('div.err');
    const ok = btn('Cambia', async () => {
      err.textContent = '';
      const p = C.passwordProblem(nw.value);
      if (p) { err.textContent = p; return; }
      if (nw.value !== nw2.value) { err.textContent = 'Le due password non sono uguali.'; return; }
      ok.disabled = true;
      try { const rec = await C.changeLabelPassphrase(A.settings.label_key, cur.value, nw.value); await saveNow({ label_key: rec }, 'Password di cifratura cambiata'); m.close(); }
      catch (x) { err.textContent = x instanceof C.WrongSecret ? 'Password attuale sbagliata.' : friendly(x); ok.disabled = false; }
    });
    m.body.append(h('div.stack', h('p.muted', 'Gli invii degli artisti non cambiano: si richiude solo la chiave con la nuova password.'), field('Password attuale', cur), field('Nuova password', nw), field('Ripeti', nw2), err));
    m.foot.append(btn('Annulla', () => m.close(), { kind: 'ghost' }), ok);
  };
  const newCode = () => {
    const m = modal({ title: 'Nuovo codice di recupero' });
    const cur = input({ type: 'password', autocomplete: 'current-password', placeholder: 'Password di cifratura' });
    const err = h('div.err');
    const ok = btn('Crea nuovo codice', async () => {
      ok.disabled = true;
      try {
        const { record, code } = await C.newLabelRecoveryCode(A.settings.label_key, cur.value);
        if (!(await saveNow({ label_key: record }, 'Nuovo codice creato'))) { ok.disabled = false; return; }
        clear(m.body); clear(m.foot);
        m.body.append(h('p.muted', 'Il vecchio codice non funziona più. Salva questo:'), ...showRecovery(code, () => m.close(), { inShell: true }));
      } catch (x) { err.textContent = x instanceof C.WrongSecret ? 'Password sbagliata.' : friendly(x); ok.disabled = false; }
    });
    m.body.append(h('div.stack', field('Password di cifratura', cur), err));
    m.foot.append(btn('Annulla', () => m.close(), { kind: 'ghost' }), ok);
  };

  const twoFa = h('span.muted.small', A.demo ? 'Nella prova non c\'è accesso.' : 'Attiva ✓ (serve per entrare)');

  swap(el, 
    h('div.page-head', h('div', h('h1', 'Impostazioni'), h('p.muted', A.demo ? 'Modalità prova' : (A.user && A.user.email) || ''))),
    h('section.card.set-sec', h('h2', icon('disc', 18), 'Etichetta'),
      h('div.row2', field('Nome', name), field('Firma per l\'etichetta di', signer)),
      btn('Salva', () => saveNow({ label_name: name.value.trim(), label_signer: signer.value.trim() }), { ic: 'check', kind: 'small' }),
      h('div.fld', h('span.fld-l', 'Logo (in alto nel modulo e nel contratto)'), logoBox),
      h('div.fld', h('span.fld-l', 'Firma dell\'etichetta (va nei contratti)'), sigBox)),
    h('section.card.set-sec', h('h2', icon('bell', 18), 'Avvisi'),
      field('Email per gli avvisi', notify, 'Ti scriviamo qui a ogni invio, modifica o firma. È anche l\'email suggerita agli artisti per condividere le cartelle.'),
      h('div.row', btn('Salva', () => {
        const v = notify.value.trim();
        if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { toast('Email non valida', { type: 'error' }); return; }
        saveNow({ notify_email: v.toLowerCase() });
      }, { ic: 'check', kind: 'small' }),
        A.demo ? null : btn('Manda un\'email di prova', async () => { const r = await A.api.mailTest(); toast(r && r.ok ? 'Email di prova mandata ✓' : r && r.error === 'email_off' ? 'Email non ancora attive (vedi SETUP)' : 'Email non partita', { type: r && r.ok ? 'ok' : 'error' }); }, { ic: 'send', kind: 'ghost small' })),
      mailState),
    h('section.card.set-sec', h('h2', icon('link', 18), 'Indirizzo dei link'),
      field('Pagina per gli artisti', pub, 'Lascia vuoto per usare questo sito. Quando avrai il dominio (es. https://invio.subconsciousculture.com/) scrivilo qui: i link nuovi useranno quello.'),
      h('div.row', btn('Salva', async () => {
        const v = pub.value.trim();
        if (v) { try { const u = new URL(v); if (u.protocol !== 'https:') throw 0; } catch { toast('Deve essere un indirizzo https://', { type: 'error' }); return; } }
        await saveNow({ public_url: v });
      }, { ic: 'check', kind: 'small' }), h('span.muted.small', 'Ora: ' + artistBase()))),
    h('section.card.set-sec', h('h2', icon('shield', 18), 'Sicurezza'),
      h('div.kv', h('span', 'Impronta della chiave'), fp),
      h('p.muted.small', 'I dati degli artisti si aprono solo con la chiave dell\'etichetta, sbloccata dalla tua password di cifratura (diversa da quella dell\'account) o dal codice di recupero.'),
      h('div.row', btn('Cambia password di cifratura', changePass, { ic: 'key', kind: 'ghost small' }), btn('Nuovo codice di recupero', newCode, { ic: 'refresh', kind: 'ghost small' })),
      rememberT,
      h('div.kv', h('span', 'Verifica in due passaggi'), twoFa),
      A.demo ? null : h('div.row', btn('Esci da tutti i dispositivi', async () => {
        if (!(await confirmBox({ title: 'Uscire ovunque?', text: 'Chiude l\'accesso su tutti i dispositivi, anche su questo.', ok: 'Esci ovunque', danger: true }))) return;
        await K.lock(); await A.api.auth.signOut('global'); location.reload();
      }, { ic: 'logout', kind: 'ghost small danger' }))),
    A.demo ? h('section.card.set-sec', h('h2', icon('sparkle', 18), 'Prova'),
      h('p.muted.small', 'I dati di prova sono solo in questo browser.'),
      btn('Cancella i dati di prova', async () => {
        if (!(await confirmBox({ title: 'Cancellare la prova?', text: 'Spariscono release, moduli e invii di prova.', ok: 'Cancella', danger: true }))) return;
        (await import('../../api/demo.js')).resetDemo(); await K.lock(); location.reload();
      }, { ic: 'trash', kind: 'ghost small danger' })) : null,
    h('p.muted.small.center', 'Consegne · i dati degli artisti sono cifrati nel loro browser e si aprono solo nel tuo.'));
}
