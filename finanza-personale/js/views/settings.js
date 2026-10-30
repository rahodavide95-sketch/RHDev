/* Impostazioni: profilo, aspetto, sicurezza, backup, categorie, regole, valute, mercati. */

import { h, icon, download, pickFile, readText } from '../ui/dom.js';
import { field, textInput, selectInput, toggle, toast, confirmDialog, promptDialog, openSheet, numberInput, segmented, twoTap } from '../ui/components.js';
import { ui } from '../ui/fmt.js';
import { card } from './common.js';
import { categoryEditor, undoToast } from './editors.js';
import { openImporter } from './importer.js';
import * as A from '../actions.js';
import * as session from '../session.js';
import { S, cloudLine } from '../session.js';
import { usage, persistStatus, requestPersist } from '../store.js';
import { passwordStrength, PBKDF2_ITER, WrongSecret } from '../core/crypto.js';
import { CURRENCIES, formatNumber } from '../core/money.js';
import { today, formatDate } from '../core/dates.js';
import { ecbRates } from '../market.js';
import { categoryManager } from './categories.js';
import { askMarketConsent } from './investments.js';
import { applyTheme } from '../ui/theme.js';


const VERSION = '3.2.1';

function section(id, title, sub, ...body) {
  return h('section.card.set-card', { id: 'set-' + id }, h('div.card-head', h('div.card-titles', h('h2.card-title', title), sub ? h('p.card-sub', sub) : null)), ...body);
}
const setRow = (label, hint, ctl) => h('div.set-row', h('div.set-text', h('span.set-label', label), hint ? h('span.set-hint', hint) : null), ctl);

async function doBackup() {
  const blob = await session.backupBlob();
  download(blob, `Analisi-Finanziarie-backup-${today()}.json`);
  session.markBackup();
  toast('Backup cifrato scaricato. Tienilo in un posto sicuro (cloud, chiavetta).', { kind: 'ok' });
}

async function restoreBackup(ctx) {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let parsed;
  try { parsed = session.parseBackup(await readText(f)); } catch (e) { toast(e?.message || 'File non valido', { kind: 'err' }); return; }
  let st;
  if (parsed.kind === 'plain') {
    if (!(await confirmDialog({ title: 'Importare il file non cifrato?', message: 'I dati attuali verranno sostituiti da quelli del file (potrai annullare subito dopo). Dopo l\'import, cancella il file non cifrato dal dispositivo.', confirm: 'Sostituisci', danger: true }))) return;
    st = parsed.data;
  } else {
    let opened = null;
    const ok = await promptDialog({
      title: 'Apri il backup', label: 'Password del backup (o codice di recupero)', type: 'password', autocomplete: 'current-password', confirm: 'Apri',
      message: `Backup del ${new Date(parsed.vault.exported || parsed.vault.updated).toLocaleString('it-IT')}.`,
      validate: async v => { try { opened = await session.openBackup(parsed.vault, v); return ''; } catch (e) { return e instanceof WrongSecret ? 'Password o codice non corretti.' : (e?.message || String(e)); } },
    });
    if (!ok || !opened) return;
    const n = opened.state.transactions.length;
    if (!(await confirmDialog({ title: 'Sostituire i dati attuali?', message: `Il backup contiene ${opened.state.accounts.length} conti e ${n} movimenti. I dati di adesso verranno sostituiti (la password resta quella attuale). Potrai annullare subito dopo.`, confirm: 'Ripristina', danger: true }))) return;
    st = opened.state;
  }
  await session.replaceState(st);
  undoToast('Backup ripristinato');
  void ctx;
}

async function autoCopiesSheet() {
  const list = await session.autoCopies();
  const s = openSheet({
    title: 'Copie automatiche', subtitle: 'Una al giorno, ultime 7, cifrate su questo dispositivo',
    body: list.length ? h('div.rows', list.map(c => h('div.row.static',
      h('span.row-main', h('span.row-title', formatDate(c.day, { long: true, year: true })), h('span.row-sub', `Com'erano i dati all'inizio della giornata · salvataggio n. ${c.rev}`)),
      h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: 'Tornare a questa copia?', message: 'I dati attuali verranno sostituiti. Potrai annullare subito dopo.', confirm: 'Ripristina', danger: true }))) return;
        try { await session.restoreAutoCopy(c); s.close(true); undoToast('Copia ripristinata'); } catch (e) { toast('Copia non leggibile: ' + (e?.message || e), { kind: 'err' }); }
      } }, 'Ripristina')))) : h('p.muted', 'Ancora nessuna copia: la prima si crea con la prima modifica di domani.'),
  });
}

async function changePassword() {
  let cur = '';
  const ok1 = await promptDialog({ title: 'Cambia password', label: 'Password attuale', type: 'password', autocomplete: 'current-password', validate: async v => ((await session.verifyPassword(v)) ? (cur = v, '') : 'Password non corretta.') });
  if (!ok1) return;
  let next = '';
  const ok2 = await promptDialog({ title: 'Nuova password', label: 'Nuova password (almeno 8 caratteri)', type: 'password', autocomplete: 'new-password', message: 'Meglio una frase di 4 o più parole.', validate: v => (v.length < 8 ? 'Almeno 8 caratteri.' : passwordStrength(v).score < 2 && v.length < 14 ? 'Troppo facile da indovinare.' : v === cur ? 'È uguale a quella di adesso.' : (next = v, '')) });
  if (!ok2) return;
  const ok3 = await promptDialog({ title: 'Ripeti la nuova password', label: 'Nuova password', type: 'password', autocomplete: 'new-password', confirm: 'Cambia', validate: async v => {
    if (v !== next) return 'Non coincide.';
    try { await session.changePassword(cur, next); return ''; } catch (e) { return e?.message || String(e); }
  } });
  if (ok3) toast('Password cambiata. I backup vecchi si aprono con la password di allora.', { kind: 'ok' });
}

async function newRecovery() {
  let code = '';
  const ok = await promptDialog({ title: 'Nuovo codice di recupero', label: 'Password attuale', type: 'password', autocomplete: 'current-password', message: 'Il codice vecchio smetterà di funzionare (anche nei backup futuri).', confirm: 'Crea nuovo codice', validate: async v => {
    if (!(await session.verifyPassword(v))) return 'Password non corretta.';
    try { code = await session.newRecoveryCode(v); return ''; } catch (e) { return e?.message || String(e); }
  } });
  if (!ok || !code) return;
  openSheet({
    title: 'Il tuo nuovo codice di recupero', size: 'sm',
    body: h('div.stack', h('p.muted', 'Salvalo fuori da questo dispositivo. È l\'unico modo per aprire i dati se dimentichi la password.'), h('div.code-box', code.split('-').map(g => h('span', g))),
      h('div.row-2', h('button.btn.btn-soft', { type: 'button', onclick: () => download(new Blob([`Analisi Finanziarie — codice di recupero\n\n${code}\n`], { type: 'text/plain' }), 'Analisi-Finanziarie-codice-di-recupero.txt') }, icon('download', 18), 'Scarica'),
        h('button.btn.btn-soft', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copiato', { kind: 'ok' }); } catch { /* */ } } }, icon('copy', 18), 'Copia'))),
  });
}

function exportPlain(ctx) {
  confirmDialog({ title: 'Esportare i dati NON cifrati?', message: 'Il file conterrà tutti i tuoi dati leggibili da chiunque lo apra. Usalo solo per passare a un altro programma, e cancellalo subito dopo. Per i backup usa "Scarica backup cifrato".', confirm: 'Esporta in chiaro', danger: true }).then(ok => {
    if (!ok) return;
    const blob = new Blob([JSON.stringify({ format: 'rh-finance-plain', v: 1, exported: Date.now(), data: ctx.st }, null, 1)], { type: 'application/json' });
    download(blob, `Analisi-Finanziarie-dati-NON-cifrati-${today()}.json`);
  });
}

/* ─── Account e sincronizzazione ─── */
function accountSheet(ctx, create) {
  const em = textInput({ type: 'email', placeholder: 'Email', autocomplete: 'username', max: 120 });
  const pw = textInput({ type: 'password', placeholder: create ? 'Password (almeno 10 caratteri)' : 'Password', autocomplete: create ? 'new-password' : 'current-password', max: 200 });
  const pw2 = create ? textInput({ type: 'password', placeholder: 'Ripetila', autocomplete: 'new-password', max: 200 }) : null;
  const err = h('p.field-err', { hidden: true, role: 'alert' });
  const btn = h('button.btn.btn-primary', { type: 'button' }, create ? 'Crea e collega' : 'Accedi e collega');
  const run = async (localPassword) => {
    const email = em.value.trim(), password = pw.value;
    let msg = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) msg = 'Scrivi un\'email valida.';
    else if (!password) msg = 'Scrivi la password.';
    else if (create && password.length < 10) msg = 'Usa almeno 10 caratteri.';
    else if (create && passwordStrength(password).score < 2 && password.length < 14) msg = 'Password troppo facile da indovinare.';
    else if (create && password !== pw2.value) msg = 'Le due password non sono uguali.';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Collego…';
    try {
      const r = await session.linkAccount(email, password, { create, localPassword });
      if (r.confirm) { s.close(true); toast(`Ti ho mandato un'email a ${email}: conferma e poi torna qui e premi "Accedi".`, { ms: 9000 }); return; }
      if (r.needLocal) {
        btn.disabled = false; btn.textContent = create ? 'Crea e collega' : 'Accedi e collega';
        const lp = await promptDialog({ title: 'Password di questa app', label: 'Password attuale dell\'app', type: 'password', autocomplete: 'current-password', message: 'Da ora per aprire l\'app userai la password dell\'account: scrivi quella che usi adesso per confermare.', validate: async v => ((await session.verifyPassword(v)) ? '' : 'Password non corretta.') });
        if (lp) return run(lp);
        return;
      }
      if (r.needOld) {
        btn.disabled = false; btn.textContent = 'Accedi e collega';
        err.textContent = 'I dati online sono chiusi con una password diversa da quella dell\'account: accedi prima da un dispositivo che li apre.'; err.hidden = false;
        return;
      }
      s.close(true);
      toast(r.adopted ? 'Collegato: dati uniti a quelli online. Da ora valgono la password e il codice di recupero dell\'account.' : 'Collegato: i dati ora si sincronizzano, cifrati.', { kind: 'ok', ms: 8000 });
    } catch (e) {
      btn.disabled = false; btn.textContent = create ? 'Crea e collega' : 'Accedi e collega';
      err.textContent = e?.message || String(e); err.hidden = false;
    }
  };
  btn.addEventListener('click', () => run(null));
  const s = openSheet({
    title: create ? 'Crea un account' : 'Accedi con il tuo account', size: 'sm',
    body: h('form.stack', { onsubmit: e => { e.preventDefault(); run(null); } },
      h('p.muted', create ? 'Con l\'account i dati sono su tutti i tuoi dispositivi. Partono già cifrati con la password: online nessuno può leggerli.' : 'Lo stesso account di [RH] Documents. I dati di questo dispositivo si uniscono a quelli che hai già online.'),
      field('Email', em), field('Password', pw), pw2 ? field('Ripeti la password', pw2) : null, err, h('button', { type: 'submit', hidden: true })),
    footer: [btn],
  });
}

function accountCard(ctx) {
  const c = ctx.S.cloud;
  if (ctx.S.mode === 'demo') return null;
  if (!c.linked) {
    return section('account', 'Account e sincronizzazione', 'Accedi per avere i dati su telefono e computer. Online arrivano già cifrati con la tua password: nessuno può leggerli.',
      h('div.row-btns',
        h('button.btn.btn-primary', { type: 'button', onclick: () => accountSheet(ctx, false) }, icon('refresh', 18), 'Accedi'),
        h('button.btn.btn-soft', { type: 'button', onclick: () => accountSheet(ctx, true) }, 'Crea un account')),
      h('p.set-hint', 'Senza account i dati restano solo su questo dispositivo: ricordati i backup.'));
  }
  return section('account', 'Account e sincronizzazione', 'I dati sono cifrati qui con la tua password e solo dopo salvati online.',
    h('div.acct-row', h('span.acct-av', (c.email || '?').charAt(0).toUpperCase()), h('div.acct-main', h('b', c.email), h('span.set-hint', { id: 'cloud-status' }, cloudLine()))),
    h('div.row-btns',
      h('button.btn.btn-soft', { type: 'button', onclick: () => session.cloudSync().then(() => toast(ctx.S.cloud.status === 'ok' ? 'Tutto sincronizzato' : cloudLine())) }, icon('refresh', 18), 'Sincronizza ora'),
      twoTap('Esci da questo dispositivo', async () => { await session.unlinkAccount(); toast('Account scollegato: i dati restano su questo dispositivo'); ctx.rerender(); }, { cls: 'btn btn-ghost', iconName: 'logout', confirmLabel: 'Tocca di nuovo per uscire' })),
    h('p.set-hint', 'La password dell\'account è anche quella che apre e cifra i dati: cambiarla qui la cambia ovunque (anche in [RH] Documents).'));
}

function categoriesCard(ctx) {
  const { st } = ctx;
  let kind = 'expense';
  const listEl = h('div');
  const draw = () => {
    const cats = st.categories.filter(c => c.kind === kind);
    const groups = [...new Set(cats.map(c => c.group))];
    const used = new Map();
    for (const t of st.transactions) if (t.category) used.set(t.category, (used.get(t.category) || 0) + 1);
    listEl.replaceChildren(...groups.map(g => h('div.cat-group', h('div.cat-group-t', g), h('div.cat-grid', cats.filter(c => c.group === g).map(c => h('button.cat-chip', { type: 'button', onclick: () => categoryEditor(c) }, h('span.cat-emoji', c.emoji), h('span', c.name), used.get(c.id) ? h('span.muted.small', String(used.get(c.id))) : null))))),
      h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => categoryEditor(null, kind) }, icon('plus', 16), 'Nuova categoria'));
  };
  draw();
  return section('cat', 'Categorie', 'Categorie e sottocategorie, come vuoi tu', h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => categoryManager(ctx, kind === 'income' ? 'income' : 'expense') }, icon('edit', 16), 'Gestisci categorie e colori'), segmented([{ value: 'expense', label: 'Uscite' }, { value: 'income', label: 'Entrate' }], kind, v => { kind = v; draw(); }, { small: true }), listEl);
}

function rulesCard(ctx) {
  const { st, d } = ctx;
  const edit = r => {
    const match = textInput({ value: r?.match || '', placeholder: 'es. esselunga, netflix', autofocus: true, max: 80 });
    const cats = st.categories.filter(c => !c.archived).map(c => ({ value: c.id, label: `${c.emoji} ${c.name}`, group: (c.kind === 'income' ? 'Entrate · ' : 'Uscite · ') + c.group }));
    const sel = selectInput(cats, r?.category || cats[0]?.value);
    const payee = textInput({ value: r?.payee || '', placeholder: 'Facoltativo, es. "Netflix"', max: 120 });
    const s = openSheet({
      title: r ? 'Modifica regola' : 'Nuova regola', size: 'sm',
      body: h('div.stack', field('Se la descrizione contiene', match), field('Usa la categoria', sel), field('E rinomina in', payee, { hint: 'Utile per descrizioni lunghe della banca' })),
      footer: [r ? twoTap('Elimina', () => { A.deleteRule(r.id); s.close(true); }, { iconName: 'trash' }) : null, h('button.btn.btn-primary', { type: 'button', onclick: () => { if (!match.value.trim()) return; A.saveRule({ id: r?.id, match: match.value, category: sel.querySelector('select').value, payee: payee.value.trim() }); s.close(true); } }, 'Salva')],
    });
  };
  return section('rules', 'Regole automatiche', 'Categoria e nome giusti da soli, anche negli import', st.rules.length ? h('div.rows', st.rules.map(r => {
    const c = d.catById.get(r.category);
    return h('button.row', { type: 'button', onclick: () => edit(r) }, h('span.row-main', h('span.row-title', `"${r.match}"`), h('span.row-sub', `→ ${c ? c.emoji + ' ' + c.name : 'categoria eliminata'}${r.payee ? ' · rinomina in ' + r.payee : ''}`)), icon('chevR', 16));
  })) : h('p.muted', 'Nessuna regola. Puoi crearle anche dal movimento, con "Ricorda la categoria".'), h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: () => edit(null) }, icon('plus', 16), 'Nuova regola'));
}

function fxCard(ctx) {
  const { st } = ctx;
  const base = st.settings.currency;
  const used = [...new Set([...st.accounts.map(a => a.currency), ...st.holdings.map(x => x.currency)])].filter(c => c !== base);
  const rows = used.map(c => {
    const inp = numberInput({ value: st.fx.rates[c] ? formatNumber(st.fx.rates[c], 6).replace(/\./g, '') : '', placeholder: 'es. 1,08' });
    inp.input.addEventListener('change', () => { const v = inp.getValue(); if (v && v > 0) { A.setFx({ [c]: v }); toast('Cambio salvato', { kind: 'ok' }); } });
    return setRow(`1 ${base} =`, `${c} · ${CURRENCIES[c]?.name || ''}`, h('div.fx-in', inp, h('span.muted', c)));
  });
  return section('fx', 'Valute e cambi', st.fx.date ? `Cambi BCE del ${formatDate(st.fx.date, { year: true })}` : 'Servono per sommare conti e titoli in valute diverse',
    used.length ? h('div.set-rows', rows) : h('p.muted', 'Tutti i conti sono in ' + base + '.'),
    h('button.btn.btn-soft.btn-sm', { type: 'button', onclick: async () => {
      if (!(await askMarketConsent(ctx))) return;
      try { const r = await ecbRates(base); A.setFx(r.rates, r.date); toast('Cambi aggiornati dalla BCE', { kind: 'ok' }); } catch { toast('BCE non raggiungibile ora', { kind: 'err' }); }
    } }, icon('refresh', 16), 'Aggiorna dalla BCE'));
}

export default {
  render(ctx) {
    const { st } = ctx;
    const s = st.settings;
    const demo = S.mode === 'demo';
    const q = ctx.route.query;
    if (q.import && !ctx._imported) { setTimeout(() => { history.replaceState(null, '', '#/impostazioni'); openImporter(ctx); }, 50); }
    const nameIn = textInput({ value: s.name, placeholder: 'Facoltativo, per il saluto', max: 60 });
    nameIn.addEventListener('change', () => A.setSetting('name', nameIn.value.trim()));
    const usageEl = h('span.set-hint');
    const persistEl = h('span.set-hint');
    usage().then(u => { if (u) usageEl.textContent = `${formatNumber(u.used / 1048576, 1)} MB usati su questo dispositivo`; });
    persistStatus().then(p => { persistEl.textContent = p === 'persisted' ? 'Il browser non cancellerà i dati da solo ✓' : p === 'best-effort' ? 'Il browser potrebbe cancellarli se manca spazio: installa l\'app o chiedi la protezione' : ''; });
    const backupAge = st.meta.lastBackup ? `Ultimo: ${new Date(st.meta.lastBackup).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Mai fatto';

    const node = h('div.settings',
      demo ? h('section.card.callout.span-all', icon('sparkle', 20), h('div', h('b', 'Stai usando la modalità prova.'), h('p.muted', 'Le modifiche qui non vengono salvate. Per usare l\'app davvero esci dalla prova e crea la tua cassaforte.'))) : null,
      accountCard(ctx),
      section('profile', 'Profilo', null,
        setRow('Il tuo nome', 'Solo per il saluto nella panoramica', nameIn),
        setRow('Valuta principale', 'Totali e patrimonio sono in questa valuta', selectInput(Object.keys(CURRENCIES).map(c => ({ value: c, label: `${c} · ${CURRENCIES[c].name}` })), s.currency, v => {
          const known = !!st.fx.rates[v];
          A.setBaseCurrency(v);
          toast(known ? 'Valuta cambiata, cambi ricalcolati' : 'Valuta cambiata: inserisci i cambi qui sotto');
        }))),
      section('look', 'Aspetto', null,
        h('div.theme-pick', [['auto', 'Automatico', 'monitor'], ['light', 'Chiaro', 'sun'], ['dark', 'Scuro', 'moon']].map(([v, l, ic]) => h('button.theme-opt', { type: 'button', class: s.theme === v ? 'on' : '', onclick: () => { A.setSetting('theme', v); applyTheme(v); } },
          h('span.theme-prev', { class: 'tp-' + v }, h('i'), h('i'), h('i')), h('span', icon(ic, 16), l)))),
        toggle('Nascondi gli importi all\'apertura', s.hideAmounts, v => A.setSetting('hideAmounts', v), { hint: 'Utile in pubblico. Si mostrano con l\'occhio in alto o il tasto H' })),
      section('security', 'Sicurezza', 'I dati sono cifrati con AES-256-GCM. La chiave nasce dalla tua password (PBKDF2-SHA256, ' + PBKDF2_ITER.toLocaleString('it-IT') + ' passaggi) e non lascia mai il dispositivo.',
        setRow('Blocco automatico', 'Dopo quanto tempo senza attività si chiude', selectInput([[1, '1 minuto'], [2, '2 minuti'], [5, '5 minuti'], [10, '10 minuti'], [15, '15 minuti'], [30, '30 minuti'], [60, '1 ora'], [0, 'Mai (sconsigliato)']].map(([v, l]) => ({ value: v, label: l })), s.lockMinutes, v => A.setSetting('lockMinutes', Number(v)))),
        h('div.row-btns',
          h('button.btn.btn-soft', { type: 'button', disabled: demo, onclick: changePassword }, icon('key', 18), 'Cambia password'),
          h('button.btn.btn-soft', { type: 'button', disabled: demo, onclick: newRecovery }, icon('shield', 18), 'Nuovo codice di recupero'),
          h('button.btn.btn-soft', { type: 'button', onclick: () => session.lock() }, icon('lock', 18), 'Blocca ora')),
        setRow('Protezione dei dati sul dispositivo', null, h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: async () => { const ok = await requestPersist(); toast(ok ? 'Fatto: il browser terrà i dati' : 'Il browser non lo permette: aggiungi l\'app alla schermata Home'); ctx.rerender(); } }, 'Chiedi protezione')),
        persistEl),
      section('backup', 'Backup e dati', 'I dati esistono solo su questo dispositivo: un backup cifrato li protegge se lo perdi o cambi telefono.',
        setRow('Backup cifrato', backupAge + ' · si apre solo con la tua password (o il codice di recupero)', h('button.btn.btn-primary', { type: 'button', disabled: demo, onclick: doBackup }, icon('download', 18), 'Scarica backup')),
        setRow('Ripristina', 'Da un file di backup (sostituisce i dati attuali)', h('button.btn.btn-soft', { type: 'button', disabled: demo, onclick: () => restoreBackup(ctx) }, icon('upload', 18), 'Carica backup')),
        setRow('Copie automatiche', 'Una al giorno, ultime 7 giornate', h('button.btn.btn-soft', { type: 'button', disabled: demo, onclick: autoCopiesSheet }, icon('refresh', 18), 'Vedi copie')),
        setRow('Promemoria del backup', null, selectInput([[0, 'Mai'], [7, 'Ogni settimana'], [14, 'Ogni 2 settimane'], [30, 'Ogni mese']].map(([v, l]) => ({ value: v, label: l })), s.backupDays, v => A.setSetting('backupDays', Number(v)))),
        h('div.set-sep'),
        setRow('Importa estratto conto', 'CSV della banca o della carta', h('button.btn.btn-soft', { type: 'button', onclick: () => openImporter(ctx) }, icon('upload', 18), 'Importa CSV')),
        setRow('Esporta i movimenti', 'CSV per Excel o Numbers', h('a.btn.btn-soft', { href: '#/movimenti?tutto=1' }, icon('list', 18), 'Vai ai movimenti')),
        setRow('Esporta tutto in chiaro', 'JSON non cifrato, per passare ad altri programmi', h('button.btn.btn-ghost', { type: 'button', onclick: () => exportPlain(ctx) }, icon('file', 18), 'Esporta JSON')),
        usageEl),
      categoriesCard(ctx),
      rulesCard(ctx),
      fxCard(ctx),
      section('market', 'Dati di mercato online', 'Facoltativi. Si inviano solo simboli di titoli pubblici, mai i tuoi dati.',
        toggle('Prezzi online', s.market.enabled, v => A.setSetting('market.enabled', v), { hint: 'Titoli da onvista.de per codice ISIN (LS Exchange, Tradegate, Xetra), crypto da Binance e CoinGecko, cambi dalla BCE. Si aggiornano da soli all\'apertura. Viene inviato solo il codice del titolo, mai quantità o importi.' })),
      section('danger', 'Zona pericolosa', null,
        setRow('Cancella tutto da questo dispositivo', 'Cassaforte, copie automatiche e impostazioni. Fai prima un backup!', h('button.btn.btn-danger', { type: 'button', disabled: demo, onclick: async () => {
          const ok = await promptDialog({ title: 'Cancellare tutto?', label: 'Scrivi CANCELLA per confermare', confirm: 'Cancella tutto', message: 'Senza un backup i dati sono persi per sempre.', validate: v => (v.trim().toUpperCase() === 'CANCELLA' ? '' : 'Scrivi CANCELLA') });
          if (ok) { await session.wipeAll(); toast('Dati cancellati'); }
        } }, icon('trash', 18), 'Cancella'))),
      h('section.card.about',
        h('div.brand-big', h('img.brand-ic', { src: 'icons/icon.svg', alt: '', width: 34, height: 34 }), h('span', 'Analisi Finanziarie')),
        h('p.muted', `Versione ${VERSION} · Funziona offline · Dati cifrati prima di partire · Nessun tracciamento, nessuna pubblicità.`),
        h('p.muted', 'Sviluppato con cura da Davide Raho · © 2026'),
        h('p.fine', 'I calcoli fiscali seguono le regole italiane per le persone fisiche (2026) e sono indicativi: per la dichiarazione dei redditi rivolgiti a un commercialista.')));
    if (q.backup) setTimeout(() => { const el = document.getElementById('set-backup'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); } }, 80);
    void ui;
    return { title: 'Impostazioni', node };
  },
};
